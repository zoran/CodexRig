#!/usr/bin/env node
/** Maintains the startup toolchain, compatible dependencies, and CI pins through repository-owned transactions. */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { readToolchainConfiguration } from "../contracts/toolchain-configuration.mjs";
import {
  candidateMiseLockFindings,
  validateMinimalMiseTools,
} from "../contracts/mise-toolchain-configuration.mjs";
import { readToolingConfiguration } from "../contracts/tooling-configuration.mjs";
import { toolingRoot, serializeCanonicalJson } from "../filesystem/repository-files.mjs";
import { verifyInputRecords } from "../deps/dependency-inputs.mjs";
import { stageDependencyInstallationInputs } from "../deps/install-compatible.mjs";
import { prepareProjectToolDirectories } from "../repository/project-tool-environment.mjs";
import {
  installProjectBootstrapTools,
  retireReplacedProjectTools,
} from "./project-tool-installation.mjs";
import { assertInstalledProjectTools } from "./project-runtime-admission.mjs";
import { pnpmHooksDisabledEnvironment } from "../repository/pnpm-workspace-manifests.mjs";
import {
  acquireRuntimeLifecycleLock,
  releaseRuntimeLifecycleLock,
  runtimeLifecycleBusyErrorCode,
} from "../repository/runtime-session-lease.mjs";
import { spawnRuntimeLifecycleCommandSync } from "../repository/runtime-lifecycle-process.mjs";
import {
  inspectRepositoryWorktrees,
  reconcileRepositoryWorktreeState,
  formatWorktreeRecoveryJson,
} from "../repository/worktree-recovery.mjs";
import {
  applyHousekeepingWrites,
  recoverInterruptedHousekeepingWrites,
} from "../repository/repository-housekeeping-transaction.mjs";
import { formatContextError } from "../terminal/terminal-output.mjs";
import { showStartupIntro, startupStatus } from "../terminal/startup-presentation.mjs";
import { ciAdapterContractViolations } from "./ci-toolchain-contract.mjs";
import { resolveToolchainReleases, refreshGithubActions } from "./toolchain-releases.mjs";
import {
  projectToolchainConfiguration,
  toolchainConfigurationPaths,
  toolchainMaintenanceInputs,
} from "./toolchain-maintenance-inputs.mjs";

/** Inventories every worktree before writes; canonical start requires all writers to be quiescent. */
export function assertMaintenanceInventory(inventory, { startup = false } = {}) {
  const unsafe = inventory.worktrees.filter(
    (worktree) =>
      (worktree.problem && worktree.directoryStatus !== "missing") ||
      ["invalid", "unknown"].includes(worktree.session.status) ||
      (worktree.session.status === "active" && (startup || !worktree.current)),
  );
  if (unsafe.length)
    throw new Error(
      `Toolchain maintenance preserves unsafe or active worktrees: ${unsafe.map((worktree) => worktree.path).join(", ")}. Exit their owning sessions before canonical startup.`,
    );
}

function stageWrite(stage, relativePath, content) {
  const target = path.join(stage, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, { mode: 0o600 });
}

function assertCandidateLock(stage, candidate) {
  const configuration = validateMinimalMiseTools(
    readFileSync(path.join(stage, ".codex/mise.toml"), "utf8"),
  );
  const findings = [
    ...configuration.errors,
    ...candidateMiseLockFindings(
      readFileSync(path.join(stage, ".codex/mise.lock"), "utf8"),
      configuration.versionLists,
    ),
  ];
  for (const tool of ["node", "pnpm"])
    if (configuration.versions[tool] !== candidate.stable[tool].version)
      findings.push(`mise.toml ${tool} must match the selected candidate version`);
  if (findings.length)
    throw new Error(`Candidate toolchain lock is invalid: ${findings.join("; ")}.`);
}

function commandRunner(root, capability) {
  return (command, args, { cwd = root, delegation, env = {} } = {}) => {
    const environment = { ...pnpmHooksDisabledEnvironment(process.env, root), ...env };
    // Private parent controls must not become apparent authority for unrelated staged commands.
    for (const key of Object.keys(environment))
      if (key.startsWith("CODEXRIG_LIFECYCLE_DELEGATION_")) delete environment[key];
    const result = spawnRuntimeLifecycleCommandSync({
      command,
      args,
      commandDelegation: delegation,
      lifecycleCapability: capability,
      repositoryRoot: root,
      role: "toolchain-supervisor",
      options: {
        cwd,
        env: environment,
        encoding: "utf8",
        input: "",
        stdio: "pipe",
        timeout: 600_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    });
    if (result.error || result.status !== 0)
      throw new Error(
        `${command} ${args[0]} failed: ${result.error?.message || result.stderr || result.stdout || result.status}`,
      );
    return result.stdout.trim();
  };
}

async function acquireMaintenanceCapability(root, { startup, onLifecycleWait, signal, timeout }) {
  const started = performance.now();
  let nextNotice = 0;
  for (;;) {
    signal?.throwIfAborted();
    try {
      return acquireRuntimeLifecycleLock({ root, operation: "toolchain-maintenance" });
    } catch (error) {
      if (
        !startup ||
        error.code !== runtimeLifecycleBusyErrorCode ||
        error.lifecycle.status !== "active"
      )
        throw error;
      const elapsed = performance.now() - started;
      const { operation, pid, startedAt } = error.lifecycle;
      const owner = `${operation} (coordinator PID ${pid}, started ${startedAt})`;
      if (elapsed >= timeout)
        throw new Error(
          `Timed out waiting for ${owner}. The operation and its lock were preserved; retry after it finishes.`,
          { cause: error },
        );
      if (elapsed >= nextNotice) {
        await onLifecycleWait(
          `Waiting for ${owner}; ${Math.floor(elapsed / 1000)}s elapsed, up to ${Math.ceil(timeout / 1000)}s. Ctrl-C cancels this startup only.`,
        );
        nextNotice = elapsed + 10_000;
      }
      await delay(
        Math.min(1_000, Math.max(1, timeout - (performance.now() - started))),
        undefined,
        { signal },
      );
    }
  }
}

/** Reviews in isolation and commits one recoverable batch only after the candidate installs. */
export async function maintainToolchain({
  root = toolingRoot,
  startup = false,
  locked = false,
  candidateResolver = resolveToolchainReleases,
  fetchImpl = globalThis.fetch,
  spawnGit,
  runCommand,
  installBootstrapTools = installProjectBootstrapTools,
  admitProjectTools = assertInstalledProjectTools,
  onInventory = () => {},
  onProgress = () => {},
  onReleaseNotice = () => {},
  onLifecycleWait = () => {},
  lifecycleWaitTimeoutMilliseconds = 600_000,
  signal,
} = {}) {
  if (
    !Number.isSafeInteger(lifecycleWaitTimeoutMilliseconds) ||
    lifecycleWaitTimeoutMilliseconds < 0 ||
    lifecycleWaitTimeoutMilliseconds > 600_000
  )
    throw new Error("Lifecycle startup wait must be between zero and 600000 milliseconds.");
  root = realpathSync.native(root);
  const inventory = inspectRepositoryWorktrees({ root });
  onInventory(inventory);
  assertMaintenanceInventory(inventory, { startup });
  const capability = await acquireMaintenanceCapability(root, {
    startup,
    onLifecycleWait,
    signal,
    timeout: lifecycleWaitTimeoutMilliseconds,
  });
  let stage;
  try {
    assertMaintenanceInventory(inspectRepositoryWorktrees({ root }), { startup });
    const settlement = reconcileRepositoryWorktreeState({
      root,
      apply: true,
      lifecycleCapability: capability,
    });
    assertMaintenanceInventory(settlement.inventory, { startup });
    if (settlement.blockingFindings.length) throw new Error(settlement.blockingFindings.join("; "));
    recoverInterruptedHousekeepingWrites(root);
    const inputs = toolchainMaintenanceInputs(root);
    const current = readToolchainConfiguration(root);
    const locations = prepareProjectToolDirectories(root);
    stage = mkdtempSync(path.join(locations.temporary, "toolchain-"));
    chmodSync(stage, 0o700);
    const dependencyInputs = stageDependencyInstallationInputs({
      projectRoot: root,
      stageRoot: stage,
    });
    const allInputs = [...inputs.records, ...dependencyInputs];
    const originals = {
      ...inputs.contents,
      ...Object.fromEntries(
        ["package.json", "pnpm-lock.yaml"].map((relativePath) => [
          relativePath,
          readFileSync(path.join(stage, relativePath), "utf8"),
        ]),
      ),
    };
    const run = runCommand ?? commandRunner(root, capability);
    onProgress(
      locked
        ? "Reproducing reviewed tool pins and the existing dependency lockfile."
        : "Checking official tool releases, CI action pins and workspace dependencies.",
    );
    const candidate =
      locked && candidateResolver === resolveToolchainReleases
        ? current
        : await candidateResolver(current, { fetchImpl, onProgress: onReleaseNotice });
    const projected = projectToolchainConfiguration(inputs.contents, current, candidate);
    if (!locked)
      projected[".github/workflows/ci.yml"] = await refreshGithubActions(
        projected[".github/workflows/ci.yml"],
        { root, spawnGit },
      );
    for (const [provider, relativePath] of [
      ["github", ".github/workflows/ci.yml"],
      ["gitlab", ".gitlab-ci.yml"],
    ]) {
      const violations = ciAdapterContractViolations(provider, projected[relativePath]);
      if (violations.length)
        throw new Error(`Candidate ${provider} CI contract is invalid: ${violations.join(", ")}.`);
    }
    verifyInputRecords(root, allInputs);
    const bootstrap = await installBootstrapTools({ root, matrix: candidate, run, fetchImpl });
    for (const relativePath of toolchainConfigurationPaths)
      stageWrite(stage, relativePath, projected[relativePath]);
    const packageJson = JSON.parse(readFileSync(path.join(stage, "package.json"), "utf8"));
    packageJson.packageManager = `pnpm@${candidate.stable.pnpm.version}`;
    if (packageJson.packageManager !== JSON.parse(originals["package.json"]).packageManager)
      stageWrite(stage, "package.json", serializeCanonicalJson(packageJson));
    const stageOptions = {
      cwd: stage,
      env: {
        MISE_OVERRIDE_CONFIG_FILENAMES: path.join(stage, ".codex/mise.toml"),
        MISE_TRUSTED_CONFIG_PATHS: path.join(stage, ".codex/mise.toml"),
        MISE_CEILING_PATHS: path.dirname(stage),
      },
    };
    if (
      current.stable.node.version !== candidate.stable.node.version ||
      current.stable.pnpm.version !== candidate.stable.pnpm.version
    )
      run(bootstrap.mise, ["lock", "node", "pnpm"], stageOptions);
    assertCandidateLock(stage, candidate);
    onProgress("Installing and validating the isolated candidate toolchain and dependency graph.");
    run(bootstrap.mise, ["install", "--locked"], stageOptions);
    admitProjectTools({
      root,
      configurationRoot: stage,
      miseExecutable: bootstrap.mise,
      environment: { ...pnpmHooksDisabledEnvironment(process.env, root), ...stageOptions.env },
    });
    run(
      bootstrap.mise,
      [
        "exec",
        "--locked",
        "--",
        "node",
        path.join(toolingRoot, "scripts/deps/install-compatible.mjs"),
        locked ? "--stage-locked" : "--stage-toolchain",
        root,
      ],
      { ...stageOptions, delegation: { operation: "dependency", role: "toolchain-dependency" } },
    );
    assertCandidateLock(stage, candidate);
    const desired = Object.fromEntries(
      [...toolchainConfigurationPaths, "package.json", "pnpm-lock.yaml"].map((relativePath) => [
        relativePath,
        readFileSync(path.join(stage, relativePath), "utf8"),
      ]),
    );
    verifyInputRecords(root, allInputs);
    assertMaintenanceInventory(inspectRepositoryWorktrees({ root }), { startup });
    const writes = Object.entries(desired)
      .map(([relativePath, after]) => ({ relativePath, before: originals[relativePath], after }))
      .filter((entry) => entry.before !== entry.after);
    onProgress("Publishing the verified inputs and reproducing the project installation offline.");
    applyHousekeepingWrites({
      root,
      writes,
      afterApply: () => {
        run(
          bootstrap.mise,
          [
            "exec",
            "--locked",
            "--",
            "node",
            path.join(toolingRoot, "scripts/deps/install-compatible.mjs"),
            "--reproduce-toolchain",
          ],
          { delegation: { operation: "dependency", role: "toolchain-dependency" } },
        );
        verifyInputRecords(
          root,
          allInputs.filter((record) => !Object.hasOwn(desired, record.path)),
        );
      },
    });
    if (startup)
      retireReplacedProjectTools({ root, previousMatrix: current, owner: capability, run });
    return { changedPaths: writes.map((entry) => entry.relativePath), matrix: candidate };
  } finally {
    if (stage) rmSync(stage, { recursive: true, force: true });
    releaseRuntimeLifecycleLock({ root, owner: capability });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--startup", "--locked"].includes(arg)) || args.length > 1)
    throw new Error("Usage: node scripts/deps/maintain-toolchain.mjs [--startup|--locked]");
  const startup = args.includes("--startup");
  if (startup)
    await showStartupIntro({ label: readToolingConfiguration(toolingRoot).startup.displayName });
  let phase = 1;
  const result = await maintainToolchain({
    startup,
    locked: args.includes("--locked"),
    onInventory: (inventory) => {
      if (startup)
        startupStatus("1/5", `Workspace inventory: ${inventory.worktrees.length} worktree(s).`);
      else console.log(formatWorktreeRecoveryJson(inventory));
    },
    onProgress: (message) => {
      if (startup) startupStatus(`${++phase}/5`, message);
      else console.log(message);
    },
    onReleaseNotice: (message) => {
      if (startup) startupStatus("pnpm", message);
      else console.log(message);
    },
    onLifecycleWait: (message) => startupStatus("wait", message),
  });
  const completed = `Toolchain ready; ${result.changedPaths.length} project input(s) updated.`;
  if (startup) startupStatus("OK", completed);
  else console.log(completed);
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(`Startup maintenance failed: ${formatContextError(error, toolingRoot)}`);
    process.exitCode = 1;
  });
