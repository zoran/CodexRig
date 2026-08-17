/** Owns install compatible behavior for the dependency and toolchain maintenance boundary. */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { formatContextError } from "../terminal/terminal-output.mjs";
import { spawnRuntimeLifecycleCommandSync } from "../repository/runtime-lifecycle-process.mjs";
import {
  assertTrustedPnpmConfiguration,
  pnpmHooksDisabledEnvironment,
  repositoryPnpmHookPaths,
} from "../repository/pnpm-workspace-manifests.mjs";
import {
  copyLocalInput,
  DependencyTransactionError,
  discoverLocalInputs,
  inputRecord,
  readOptionalFile,
  safeRepositoryPath,
  verifyInputRecords,
} from "./dependency-inputs.mjs";
import { packageManifests, root, validatePolicy } from "./dependency-policy.mjs";
import {
  atomicWrite,
  dependencyTransactionPaths,
  withDependencyTransactionLock,
} from "./dependency-transaction-state.mjs";
import { spawnTrustedPnpm, trustedPnpmCommand } from "./trusted-pnpm-command.mjs";

export const compatibleUpdateArgs = [
  "update",
  "--recursive",
  "--no-save",
  "--ignore-scripts",
  "--ignore-pnpmfile",
  "--lockfile-only",
];
export const compatibleInstallArgs = [
  "install",
  "--frozen-lockfile",
  "--ignore-scripts",
  "--ignore-pnpmfile",
];

const portableInputPaths = [
  ".npmrc",
  "dependency-policy.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
];

function projectPolicy(projectRoot) {
  const source = readOptionalFile(projectRoot, "dependency-policy.json");
  if (!source.exists) return { pins: [] };
  try {
    return JSON.parse(source.content);
  } catch {
    throw new DependencyTransactionError("dependency-policy.json contains invalid JSON.");
  }
}

function requirePortableInput(projectRoot, relativePath) {
  const record = inputRecord(projectRoot, relativePath);
  if (!record.exists || record.kind !== "file") {
    throw new DependencyTransactionError(`Missing required dependency input: ${relativePath}`);
  }
  return record;
}

function pnpmHookInputs(projectRoot) {
  return repositoryPnpmHookPaths.map((hookPath) => {
    const record = inputRecord(projectRoot, hookPath);
    if (record.exists) {
      throw new DependencyTransactionError(
        `${hookPath} is executable dependency-resolution code; use a reviewed project-specific install workflow.`,
      );
    }
    return record;
  });
}

function dependencyInputs(projectRoot, manifests) {
  const policyFailures = validatePolicy(projectPolicy(projectRoot));
  if (policyFailures.length > 0) throw new DependencyTransactionError(policyFailures.join("; "));

  const manifestSources = new Map(
    manifests.map((manifest) => [manifest.relativePath, { data: manifest.data }]),
  );
  const records = new Map();
  for (const manifest of manifests) {
    const record = requirePortableInput(projectRoot, manifest.relativePath);
    records.set(record.path, record);
  }
  for (const record of pnpmHookInputs(projectRoot)) records.set(record.path, record);
  for (const relativePath of portableInputPaths) {
    const record = inputRecord(projectRoot, relativePath);
    records.set(record.path, record);
  }
  for (const requiredPath of ["pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
    const record = records.get(requiredPath);
    if (!record?.exists || record.kind !== "file") {
      throw new DependencyTransactionError(`Missing required dependency input: ${requiredPath}`);
    }
  }
  for (const record of discoverLocalInputs(projectRoot, manifestSources)) {
    records.set(record.path, record);
  }
  return [...records.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function runPnpm(spawnPnpm, args, cwd, projectRoot, lifecycleCapability) {
  const environment = pnpmHooksDisabledEnvironment({ ...process.env });
  if (spawnPnpm !== spawnSync) {
    return spawnTrustedPnpm({
      args,
      repositoryRoot: projectRoot,
      spawnPnpm,
      options: {
        cwd,
        encoding: "utf8",
        env: environment,
        input: "",
        maxBuffer: 16 * 1024 * 1024,
        stdio: "pipe",
        timeout: 180_000,
      },
    });
  }
  const lifecycleSpawn = (command, commandArgs, options) =>
    spawnRuntimeLifecycleCommandSync({
      args: commandArgs,
      command,
      lifecycleCapability,
      options,
      repositoryRoot: projectRoot,
      role: "dependency-supervisor",
    });
  const command = trustedPnpmCommand({
    repositoryRoot: projectRoot,
    environment,
    spawn: lifecycleSpawn,
  });
  return spawnTrustedPnpm({
    args,
    command,
    repositoryRoot: projectRoot,
    spawnPnpm: lifecycleSpawn,
    options: {
      cwd,
      encoding: "utf8",
      env: environment,
      input: "",
      maxBuffer: 16 * 1024 * 1024,
      stdio: "pipe",
      timeout: 180_000,
    },
  });
}

function commandFailure(result, label) {
  if (result.error) {
    return new DependencyTransactionError(`${label} failed to start: ${result.error.message}`);
  }
  return new DependencyTransactionError(`${label} failed with status ${result.status}.`);
}

function copyDependencyStage(projectRoot, stageRoot, inputs) {
  for (const record of inputs) {
    if (record.exists) copyLocalInput(projectRoot, stageRoot, record);
  }
}

function refreshedLockfile(stageRoot, inputs) {
  if (existsSync(path.join(stageRoot, "node_modules"))) {
    throw new DependencyTransactionError(
      "Compatible dependency resolution wrote node_modules instead of remaining lockfile-only.",
    );
  }
  verifyInputRecords(
    stageRoot,
    inputs.filter((record) => record.path !== "pnpm-lock.yaml"),
  );
  const lockfile = readOptionalFile(stageRoot, "pnpm-lock.yaml");
  if (!lockfile.exists) {
    throw new DependencyTransactionError("Compatible dependency resolution produced no lockfile.");
  }
  return lockfile;
}

function rollbackLockfile(projectRoot, original, expectedHash, mode) {
  const current = readOptionalFile(projectRoot, "pnpm-lock.yaml");
  if (!current.exists || current.hash !== expectedHash) {
    throw new DependencyTransactionError(
      "Dependency installation failed and pnpm-lock.yaml changed concurrently; refusing rollback.",
      75,
    );
  }
  atomicWrite(
    projectRoot,
    safeRepositoryPath(projectRoot, "pnpm-lock.yaml"),
    original.content,
    mode,
  );
}

export function installLatestCompatibleDependencies(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? root);
  const spawnPnpm = options.spawnPnpm ?? spawnSync;

  return withDependencyTransactionLock(
    projectRoot,
    (lock) => {
      assertTrustedPnpmConfiguration({ repositoryRoot: projectRoot });
      pnpmHookInputs(projectRoot);
      const manifests = options.manifests ?? packageManifests({ repositoryRoot: projectRoot });
      const transactionPaths = dependencyTransactionPaths(projectRoot);
      if (existsSync(transactionPaths.plan) || existsSync(transactionPaths.journal)) {
        throw new DependencyTransactionError(
          "Finish or clear the reviewed dependency update transaction before compatible installation.",
          75,
        );
      }

      const inputs = dependencyInputs(projectRoot, manifests);
      const original = readOptionalFile(projectRoot, "pnpm-lock.yaml");
      const lockfilePath = safeRepositoryPath(projectRoot, "pnpm-lock.yaml");
      const lockfileMode = lstatSync(lockfilePath).mode & 0o777;
      const stageRoot = mkdtempSync(
        path.join(options.temporaryParent ?? os.tmpdir(), "deps-compatible-"),
      );
      chmodSync(stageRoot, 0o700);

      try {
        copyDependencyStage(projectRoot, stageRoot, inputs);
        const update = runPnpm(
          spawnPnpm,
          compatibleUpdateArgs,
          stageRoot,
          projectRoot,
          lock.lifecycleCapability,
        );
        if (update.error || update.status !== 0) {
          throw new DependencyTransactionError(
            `${commandFailure(update, "Compatible registry resolution").message} Dependency freshness is indeterminate; durable project inputs were left unchanged.`,
          );
        }
        const refreshed = refreshedLockfile(stageRoot, inputs);
        verifyInputRecords(projectRoot, inputs);
        if (refreshed.hash !== original.hash) {
          options.beforeLockfileWrite?.({ content: refreshed.content, hash: refreshed.hash });
          atomicWrite(projectRoot, lockfilePath, refreshed.content, lockfileMode);
        }

        const install = runPnpm(
          spawnPnpm,
          compatibleInstallArgs,
          projectRoot,
          projectRoot,
          lock.lifecycleCapability,
        );
        if (install.error || install.status !== 0) {
          let rollbackSummary = "The compatible lockfile was unchanged";
          if (refreshed.hash !== original.hash) {
            rollbackLockfile(projectRoot, original, refreshed.hash, lockfileMode);
            rollbackSummary = "The prior lockfile was restored";
          }
          throw new DependencyTransactionError(
            `${commandFailure(install, "Frozen dependency installation").message} ${rollbackSummary}; installation is incomplete.`,
          );
        }
        try {
          verifyInputRecords(
            projectRoot,
            inputs.filter((record) => record.path !== "pnpm-lock.yaml"),
          );
          const installedLockfile = readOptionalFile(projectRoot, "pnpm-lock.yaml");
          if (!installedLockfile.exists || installedLockfile.hash !== refreshed.hash) {
            throw new DependencyTransactionError(
              "Frozen dependency installation did not preserve the reviewed compatible lockfile.",
            );
          }
        } catch (error) {
          if (refreshed.hash !== original.hash) {
            try {
              rollbackLockfile(projectRoot, original, refreshed.hash, lockfileMode);
            } catch (rollbackError) {
              throw new DependencyTransactionError(
                `${error.message} Automatic lockfile rollback stopped safely: ${rollbackError.message}`,
                75,
              );
            }
            throw new DependencyTransactionError(
              `${error.message} The prior lockfile was restored; installation is incomplete.`,
              75,
            );
          }
          throw error;
        }
        return {
          lockfileUpdated: refreshed.hash !== original.hash,
          manifestCount: manifests.length,
        };
      } finally {
        rmSync(stageRoot, { recursive: true, force: true });
      }
    },
    options.lifecycleCapability ? { lifecycleCapability: options.lifecycleCapability } : {},
  );
}

function main() {
  const result = installLatestCompatibleDependencies();
  console.log(
    `Installed the newest compatible dependency resolution for ${result.manifestCount} workspace manifest(s).`,
  );
  console.log(
    result.lockfileUpdated
      ? "pnpm-lock.yaml was refreshed and then installed reproducibly with lifecycle scripts disabled."
      : "pnpm-lock.yaml was already current and was installed reproducibly with lifecycle scripts disabled.",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Compatible dependency installation failed: ${formatContextError(error, root)}`);
    process.exit(error?.exitCode ?? 1);
  }
}
