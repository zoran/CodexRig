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
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readToolchainConfiguration } from "../contracts/toolchain-configuration.mjs";
import { toolingRoot, serializeCanonicalJson } from "../filesystem/repository-files.mjs";
import { verifyInputRecords } from "../deps/dependency-inputs.mjs";
import { stageDependencyInstallationInputs } from "../deps/install-compatible.mjs";
import { pnpmHooksDisabledEnvironment } from "../repository/pnpm-workspace-manifests.mjs";
import {
  acquireRuntimeLifecycleLock,
  releaseRuntimeLifecycleLock,
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
import { ciAdapterContractViolations } from "./toolchain-archives.mjs";
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

function commandRunner(root, capability) {
  return (command, args, { cwd = root, delegation, env = {} } = {}) => {
    const environment = pnpmHooksDisabledEnvironment({ ...process.env, ...env });
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

/** Reviews in isolation and commits one recoverable batch only after the candidate installs. */
export async function maintainToolchain({
  root = toolingRoot,
  startup = false,
  fetchImpl = globalThis.fetch,
  runCommand,
  onInventory = () => {},
  onProgress = () => {},
} = {}) {
  root = realpathSync.native(root);
  const inventory = inspectRepositoryWorktrees({ root });
  onInventory(inventory);
  assertMaintenanceInventory(inventory, { startup });
  const capability = acquireRuntimeLifecycleLock({ root, operation: "toolchain-maintenance" });
  let stage;
  try {
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
    stage = mkdtempSync(path.join(os.tmpdir(), "codexrig-toolchain-"));
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
      "Checking official stable tool releases, CI action pins and compatible workspace packages.",
    );
    const candidate = await resolveToolchainReleases(current, { fetchImpl });
    const projected = projectToolchainConfiguration(inputs.contents, current, candidate);
    projected[".github/workflows/ci.yml"] = await refreshGithubActions(
      projected[".github/workflows/ci.yml"],
      { fetchImpl },
    );
    for (const [provider, relativePath] of [
      ["github", ".github/workflows/ci.yml"],
      ["gitlab", ".gitlab-ci.yml"],
    ]) {
      const violations = ciAdapterContractViolations(provider, projected[relativePath], candidate);
      if (violations.length)
        throw new Error(`Candidate ${provider} CI contract is invalid: ${violations.join(", ")}.`);
    }
    verifyInputRecords(root, allInputs);
    // Host updates use their supported native controls. Failure always stops before admission.
    const miseVersion = run("mise", ["--version"]).match(/\b\d+\.\d+\.\d+\b/u)?.[0];
    if (miseVersion !== candidate.ci.miseVersion)
      run("mise", ["self-update", "--yes", "--no-plugins", candidate.ci.miseVersion]);
    run("codex", ["update"]);
    for (const relativePath of toolchainConfigurationPaths)
      stageWrite(stage, relativePath, projected[relativePath]);
    const packageJson = JSON.parse(readFileSync(path.join(stage, "package.json"), "utf8"));
    packageJson.packageManager = `pnpm@${candidate.stable.pnpm.version}`;
    if (packageJson.packageManager !== JSON.parse(originals["package.json"]).packageManager)
      stageWrite(stage, "package.json", serializeCanonicalJson(packageJson));
    const stageOptions = {
      cwd: stage,
      env: { MISE_TRUSTED_CONFIG_PATHS: path.join(stage, "mise.toml"), MISE_CEILING_PATHS: stage },
    };
    if (
      current.stable.node.version !== candidate.stable.node.version ||
      current.stable.pnpm.version !== candidate.stable.pnpm.version
    )
      run("mise", ["lock", "node", "pnpm"], stageOptions);
    onProgress("Installing and validating the isolated candidate toolchain and dependency graph.");
    run("mise", ["install", "--locked", "node", "pnpm"], stageOptions);
    run(
      "mise",
      [
        "exec",
        "--locked",
        "--",
        "node",
        path.join(toolingRoot, "scripts/deps/install-compatible.mjs"),
        "--stage-toolchain",
      ],
      stageOptions,
    );
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
          "mise",
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
    return { changedPaths: writes.map((entry) => entry.relativePath), matrix: candidate };
  } finally {
    if (stage) rmSync(stage, { recursive: true, force: true });
    releaseRuntimeLifecycleLock({ root, owner: capability });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--startup") || args.length > 1)
    throw new Error("Usage: node scripts/deps/maintain-toolchain.mjs [--startup]");
  const result = await maintainToolchain({
    startup: args.includes("--startup"),
    onInventory: (inventory) => console.log(formatWorktreeRecoveryJson(inventory)),
    onProgress: console.log,
  });
  console.log(
    `Startup maintenance passed; ${result.changedPaths.length} project input(s) updated.`,
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(`Startup maintenance failed: ${formatContextError(error, toolingRoot)}`);
    process.exitCode = 1;
  });
