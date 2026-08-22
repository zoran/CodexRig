/** Owns dependency transaction state behavior for the dependency and toolchain maintenance boundary. */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { DependencyTransactionError, projectIdentity } from "./dependency-inputs.mjs";
import {
  atomicWriteOwnedFile,
  createExclusiveOwnedDirectory,
  removeOwnedArtifact,
  removeOwnedEmptyDirectory,
  renameOwnedArtifact,
} from "../filesystem/owned-file-operations.mjs";
import {
  closeOwnedDirectoryBinding,
  ensureOwnedPrivateDirectory,
  openPrivateOwnedDirectory,
  readStableOwnedFile,
} from "../filesystem/owned-path-safety.mjs";
import {
  acquireRuntimeLifecycleLock,
  releaseRuntimeLifecycleLock,
  retainRuntimeLifecycleLock,
} from "../repository/runtime-session-lease.mjs";

export function dependencyTransactionPaths(projectRoot) {
  const { root } = projectIdentity(projectRoot);
  const projectState = path.join(root, ".project-state");
  const state = path.join(projectState, "dependency-update");
  return {
    root,
    state,
    plan: path.join(state, "plan.json"),
    journal: path.join(state, "journal.json"),
    lock: path.join(state, "transaction.lock"),
  };
}

function ensureDependencyTransactionState(paths) {
  ensureOwnedPrivateDirectory(paths.root, path.dirname(paths.state), "dependency project state");
  ensureOwnedPrivateDirectory(paths.root, paths.state, "dependency transaction state");
}

export function atomicWrite(projectRoot, filePath, content, mode = 0o600, options = {}) {
  try {
    return atomicWriteOwnedFile(projectRoot, filePath, content, mode, {
      label: options.label ?? "dependency transaction output",
      testHooks: options.testHooks,
    });
  } catch (error) {
    throw new DependencyTransactionError(error.message, 75);
  }
}

export function readJsonFile(projectRoot, filePath, label) {
  const directory = openPrivateOwnedDirectory(
    projectRoot,
    path.dirname(filePath),
    `${label} parent`,
  );
  try {
    if (!existsSync(filePath)) throw new DependencyTransactionError(`Missing ${label}.`);
    const snapshot = readStableOwnedFile(directory, path.basename(filePath), label, {
      maximumBytes: 32 * 1024 * 1024,
    });
    try {
      return JSON.parse(snapshot.buffer.toString("utf8"));
    } catch {
      throw new DependencyTransactionError(`${label} contains invalid JSON.`);
    }
  } finally {
    closeOwnedDirectoryBinding(directory);
  }
}

function validLockOwner(owner) {
  const acquiredAt = Date.parse(owner?.acquiredAt ?? "");
  return Boolean(
    owner &&
    typeof owner === "object" &&
    !Array.isArray(owner) &&
    Object.keys(owner).sort().join("\n") === "acquiredAt\nlifecycleNonce\npid\ntoken" &&
    Number.isSafeInteger(owner.pid) &&
    owner.pid > 0 &&
    typeof owner.token === "string" &&
    owner.token.length > 0 &&
    !/[\0\r\n]/u.test(owner.token) &&
    typeof owner.lifecycleNonce === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
      owner.lifecycleNonce,
    ) &&
    typeof owner.acquiredAt === "string" &&
    Number.isFinite(acquiredAt) &&
    new Date(acquiredAt).toISOString() === owner.acquiredAt,
  );
}

function readLockState(projectRoot, lockDirectory) {
  const directory = openPrivateOwnedDirectory(
    projectRoot,
    lockDirectory,
    "dependency transaction lock",
  );
  try {
    const snapshot = readStableOwnedFile(directory, "owner.json", "dependency transaction owner", {
      maximumBytes: 4_096,
    });
    const owner = JSON.parse(snapshot.buffer.toString("utf8"));
    return {
      directoryIdentity: directory.stats,
      owner: validLockOwner(owner) ? owner : null,
    };
  } catch {
    return { directoryIdentity: directory.stats, owner: null };
  } finally {
    closeOwnedDirectoryBinding(directory);
  }
}

export function acquireDependencyTransactionLock(projectRoot, options = {}) {
  const paths = dependencyTransactionPaths(projectRoot);
  let lifecycleCapability;
  try {
    lifecycleCapability = options.lifecycleCapability
      ? retainRuntimeLifecycleLock({
          root: paths.root,
          owner: options.lifecycleCapability,
          operation: "dependency",
        })
      : acquireRuntimeLifecycleLock({ root: paths.root, operation: "dependency" });
  } catch (error) {
    throw new DependencyTransactionError(
      `Dependency update cannot overlap another repository mutation: ${error.message}`,
      75,
    );
  }
  try {
    ensureDependencyTransactionState(paths);
  } catch (error) {
    releaseRuntimeLifecycleLock({ root: paths.root, owner: lifecycleCapability });
    throw error;
  }
  const owner = {
    token: options.token ?? randomUUID(),
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    lifecycleNonce: lifecycleCapability.nonce,
  };

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let created = false;
      try {
        createExclusiveOwnedDirectory(paths.root, paths.lock, "dependency transaction lock");
        created = true;
        atomicWrite(
          paths.root,
          path.join(paths.lock, "owner.json"),
          `${JSON.stringify(owner)}\n`,
          0o600,
          { label: "dependency transaction owner" },
        );
        return Object.freeze({
          lifecycleCapability,
          owner: Object.freeze(owner),
          path: paths.lock,
          root: paths.root,
        });
      } catch (error) {
        if (created) {
          removeOwnedArtifact(
            paths.root,
            paths.lock,
            "directory",
            "failed dependency transaction lock",
          );
          throw error;
        }
        if (error?.code !== "EEXIST") throw error;
        const existing = readLockState(paths.root, paths.lock);
        if (!existing.owner) {
          throw new DependencyTransactionError(
            "Dependency update lock owner is invalid; manual recovery is required.",
            75,
          );
        }
        const belongsToCurrentCapability =
          existing.owner?.lifecycleNonce === lifecycleCapability.nonce;
        if (belongsToCurrentCapability) {
          const summary = existing.owner?.pid ? `process ${existing.owner.pid}` : "another process";
          throw new DependencyTransactionError(`Dependency update is locked by ${summary}.`, 75);
        }
        const quarantine = `${paths.lock}.stale-${randomUUID()}`;
        renameOwnedArtifact(
          paths.root,
          paths.lock,
          quarantine,
          "directory",
          "stale dependency transaction lock",
          { expectedIdentity: existing.directoryIdentity },
        );
        const quarantined = readLockState(paths.root, quarantine);
        if (quarantined.owner?.token !== existing.owner?.token) {
          if (!existsSync(paths.lock)) {
            renameOwnedArtifact(
              paths.root,
              quarantine,
              paths.lock,
              "directory",
              "restored dependency transaction lock",
              { expectedIdentity: quarantined.directoryIdentity },
            );
          }
          throw new DependencyTransactionError(
            "Dependency lock ownership changed during stale-lock recovery.",
            75,
          );
        }
        removeOwnedArtifact(
          paths.root,
          quarantine,
          "directory",
          "stale dependency transaction quarantine",
          { expectedIdentity: quarantined.directoryIdentity },
        );
      }
    }
    throw new DependencyTransactionError("Could not acquire the dependency update lock.", 75);
  } catch (error) {
    releaseRuntimeLifecycleLock({ root: paths.root, owner: lifecycleCapability });
    throw error;
  }
}

export function releaseDependencyTransactionLock(handle) {
  if (!handle?.root) {
    throw new DependencyTransactionError("Dependency lock handle is invalid.", 75);
  }
  const paths = dependencyTransactionPaths(handle.root);
  if (handle.path !== paths.lock) {
    throw new DependencyTransactionError(
      "Dependency lock handle does not match its repository root.",
      75,
    );
  }
  if (!existsSync(handle.path)) {
    throw new DependencyTransactionError(
      "Dependency lock disappeared before lifecycle release.",
      75,
    );
  }
  const projectRoot = paths.root;
  const current = readLockState(projectRoot, handle.path);
  if (current.owner?.token !== handle.owner.token) {
    throw new DependencyTransactionError(
      "Dependency lock ownership changed; refusing to remove it.",
      75,
    );
  }
  releaseRuntimeLifecycleLock({
    root: projectRoot,
    owner: handle.lifecycleCapability,
    finalize() {
      removeOwnedArtifact(projectRoot, handle.path, "directory", "dependency transaction lock", {
        expectedIdentity: current.directoryIdentity,
      });
      const stateDirectory = path.dirname(handle.path);
      for (const directory of [stateDirectory, path.dirname(stateDirectory)]) {
        try {
          removeOwnedEmptyDirectory(
            path.dirname(path.dirname(stateDirectory)),
            directory,
            "empty dependency state",
          );
        } catch (error) {
          if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) throw error;
        }
      }
    },
  });
}

export function withDependencyTransactionLock(projectRoot, action, options = {}) {
  const handle = acquireDependencyTransactionLock(projectRoot, options);
  try {
    return action(handle);
  } finally {
    releaseDependencyTransactionLock(handle);
  }
}
