/** Verifies the installed project runtime for commands and for session startup after a failed refresh. */
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateMinimalMiseTools } from "../contracts/mise-toolchain-configuration.mjs";
import { readToolchainConfiguration } from "../contracts/toolchain-configuration.mjs";
import { parseJsonFile, readRepositoryFile, toolingRoot } from "../filesystem/repository-files.mjs";
import { userToolPaths, assertUserToolParents } from "../repository/user-tool-storage.mjs";
import { spawnSyncWithBoundedIo } from "../repository/runtime-process-io.mjs";
import { assertCandidateToolchainLock } from "./toolchain-maintenance-inputs.mjs";
import {
  projectManagedToolLayout,
  verifyProjectToolBundle,
} from "../repository/project-tool-executables.mjs";
import {
  assertTrustedPnpmConfiguration,
  pnpmHooksDisabledEnvironment,
} from "../repository/pnpm-workspace-manifests.mjs";
import {
  acquireRuntimeLifecycleLock,
  releaseRuntimeLifecycleLock,
} from "../repository/runtime-session-lease.mjs";
import { reconcileRepositoryWorktreeState } from "../repository/worktree-recovery.mjs";
import { formatContextError } from "../terminal/terminal-output.mjs";

/** Mise can warn and continue after failed resolution even with --locked; require actual installs. */
export function assertInstalledProjectTools({
  root,
  configurationRoot = root,
  miseExecutable,
  environment,
}) {
  const configured = validateMinimalMiseTools(
    readRepositoryFile(configurationRoot, ".codex/mise.toml"),
  );
  if (configured.errors.length)
    throw new Error(`Project tool configuration is invalid: ${configured.errors.join("; ")}.`);
  const query = (args) => {
    const result = spawnSyncWithBoundedIo(miseExecutable, args, {
      cwd: configurationRoot,
      env: environment,
      encoding: "utf8",
      input: "",
      stdio: "pipe",
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
    if (result.error || result.signal || result.status !== 0)
      throw new Error(
        `Project runtime ${args[0]} failed; run canonical maintenance before retrying.`,
      );
    return result.stdout;
  };
  const inventory = query(["ls", "--current", "--json", "--locked"]);
  let actual;
  try {
    actual = JSON.parse(inventory);
  } catch {
    throw new Error("Project runtime inventory is not valid JSON.");
  }
  const missing = () => {
    throw new Error(
      "Project runtimes are missing or outside their locked user installation; run canonical maintenance. Host fallback is forbidden.",
    );
  };
  if (
    !actual ||
    typeof actual !== "object" ||
    Array.isArray(actual) ||
    Object.keys(actual).sort().join("\n") !== Object.keys(configured.versionLists).sort().join("\n")
  )
    missing();
  const storage = userToolPaths(environment);
  const installations = new Map();
  for (const [tool, pins] of Object.entries(configured.versionLists)) {
    const entries = actual[tool];
    if (
      !Array.isArray(entries) ||
      entries.length !== pins.length ||
      new Set(entries.map((entry) => entry?.requested_version)).size !== pins.length
    )
      missing();
    const parent = path.join(storage.miseData, "installs", tool);
    for (const pin of pins) {
      const entry = entries.find((entry) => entry?.requested_version === pin);
      if (
        !entry ||
        entry.installed !== true ||
        entry.requested_version !== pin ||
        entry.source?.path !== path.join(configurationRoot, ".codex/mise.toml") ||
        typeof entry.install_path !== "string" ||
        path.dirname(entry.install_path) !== parent
      )
        missing();
      try {
        assertUserToolParents(storage.root, path.join(entry.install_path, "entry"));
        if (
          realpathSync.native(entry.install_path) !== entry.install_path ||
          installations.has(entry.install_path)
        )
          missing();
        installations.set(entry.install_path, `${tool}@${pin}`);
      } catch {
        missing();
      }
    }
  }
  // Successful inventory alone is insufficient: plugin resolution can warn, omit a tool's
  // bin directory, and still exit zero. Every pin must contribute a real contained path.
  const output = query(["bin-paths", "--locked"]);
  const bins = output.replace(/\r\n/gu, "\n").split("\n");
  if (bins.pop() !== "" || !bins.length || bins.length > 256 || new Set(bins).size !== bins.length)
    throw new Error("Project runtime bin paths are incomplete or ambiguous.");
  const covered = new Set();
  for (const bin of bins) {
    if (
      !path.isAbsolute(bin) ||
      path.resolve(bin) !== bin ||
      /[\x00-\x1f]/u.test(bin) ||
      bin.includes(path.delimiter)
    )
      missing();
    const installation = [...installations.keys()].find(
      (directory) => bin === directory || bin.startsWith(`${directory}${path.sep}`),
    );
    if (!installation) missing();
    try {
      assertUserToolParents(storage.root, path.join(bin, "entry"));
      if (realpathSync.native(bin) !== bin) missing();
    } catch {
      missing();
    }
    covered.add(installation);
  }
  const omitted = [...installations]
    .filter(([directory]) => !covered.has(directory))
    .map(([, pin]) => pin);
  if (omitted.length)
    throw new Error(
      `Project runtime bin paths are missing for ${omitted.join(", ")}; host fallback is forbidden.`,
    );
}

function requireIdleStartupWorktrees(root) {
  const { inventory, blockingFindings } = reconcileRepositoryWorktreeState({ root });
  if (
    !inventory.complete ||
    blockingFindings.length ||
    inventory.worktrees.some(({ session }) => session.status === "active")
  )
    throw new Error(
      "Installed toolchain startup requires settled worktrees with no active session.",
    );
}

/** A failed refresh can leave the existing installation usable. Check it under both lifecycle
 * locks without installing tools, replaying a journal or adopting any candidate inputs. */
export function checkInstalledStartupToolchain(root = toolingRoot) {
  requireIdleStartupWorktrees(root);
  const owner = acquireRuntimeLifecycleLock({ root, operation: "toolchain-maintenance" });
  try {
    const shared = userToolPaths().lifecycle;
    const installation = acquireRuntimeLifecycleLock({
      root: shared,
      operation: "toolchain-maintenance",
    });
    try {
      requireIdleStartupWorktrees(root);
      const current = readToolchainConfiguration(root);
      assertTrustedPnpmConfiguration({ repositoryRoot: root });
      assertCandidateToolchainLock(root, current);
      if (
        parseJsonFile(root, "package.json", "Project package manifest").packageManager !==
        `pnpm@${current.stable.pnpm.version}`
      )
        throw new Error("The project package manager does not match the installed toolchain pin.");
      const environment = pnpmHooksDisabledEnvironment(process.env, root);
      const layout = projectManagedToolLayout(root, current, { environment });
      verifyProjectToolBundle(root, layout.codex);
      const miseExecutable = verifyProjectToolBundle(root, layout.mise);
      assertInstalledProjectTools({ root, miseExecutable, environment });
    } finally {
      releaseRuntimeLifecycleLock({ root: shared, owner: installation });
    }
  } finally {
    releaseRuntimeLifecycleLock({ root, owner });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2)
      throw new Error("Installed toolchain admission takes no arguments.");
    checkInstalledStartupToolchain();
    console.log("Installed project toolchain verified for session startup.");
  } catch (error) {
    console.error(
      `Installed toolchain admission failed: ${formatContextError(error, toolingRoot)}`,
    );
    process.exitCode = 1;
  }
}
