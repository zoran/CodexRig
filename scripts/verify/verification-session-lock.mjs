/** Owns verification serialization and its repository-wide runtime lifecycle exclusion. */
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { frameworkRoot, serializeCanonicalJson } from "../contracts/framework-contract.mjs";
import {
  closeOwnedDirectoryBinding,
  createExclusiveOwnedFile,
  ensureOwnedPrivateDirectory,
  openPrivateOwnedDirectory,
  ownedDirectoryChildPath,
  readStableOwnedFile,
  removeStableOwnedFile,
} from "../filesystem/owned-path-safety.mjs";
import {
  acquireRuntimeLifecycleLock,
  releaseRuntimeLifecycleLock,
} from "../repository/runtime-session-lease.mjs";
import {
  repositoryCodexRuntimeCacheDirectory,
  repositoryCodexRuntimeDirectory,
} from "../repository/source-inventory.mjs";
import { runHeldVerificationCommand } from "./verification-executor.mjs";

const capabilities = new Map();
const ownerFileName = "session.lock";
const verificationStateRelativePath = `${repositoryCodexRuntimeCacheDirectory}/project-verification`;
export const verificationSessionLockPath = `${verificationStateRelativePath}/${ownerFileName}`;
const lockedMessage =
  "Verification session is already locked; do not overlap full, changed, closure, pre-push, publication, or reset workflows.";

function processStatus(pid) {
  try {
    process.kill(pid, 0);
    return "active";
  } catch (error) {
    return error?.code === "ESRCH" ? "stale" : "unknown";
  }
}

function exactOwner(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !== "pid\nstartedAt\ntoken" ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    typeof value.startedAt !== "string" ||
    !Number.isFinite(Date.parse(value.startedAt)) ||
    typeof value.token !== "string" ||
    !/^[a-f0-9-]{36}$/u.test(value.token)
  ) {
    throw new Error("Verification session lock owner is invalid.");
  }
  return Object.freeze(value);
}

function verificationStatePath(root) {
  return path.join(root, ...verificationStateRelativePath.split("/"));
}

function ensureVerificationState(root, { testHooks } = {}) {
  const cache = path.join(root, ...repositoryCodexRuntimeCacheDirectory.split("/"));
  const state = verificationStatePath(root);
  ensureOwnedPrivateDirectory(root, cache, "verification cache directory", { testHooks });
  ensureOwnedPrivateDirectory(root, state, "verification state directory", { testHooks });
  return openPrivateOwnedDirectory(root, state, "verification state directory");
}

function openVerificationState(root) {
  const state = verificationStatePath(root);
  if (!existsSync(state)) return null;
  return openPrivateOwnedDirectory(root, state, "verification state directory");
}

function readOwner(directory) {
  const target = ownedDirectoryChildPath(directory, ownerFileName, "verification session lock");
  if (!existsSync(target)) return Object.freeze({ status: "absent" });
  const snapshot = readStableOwnedFile(directory, ownerFileName, "verification session lock", {
    maximumBytes: 4_096,
  });
  if (
    (snapshot.stats.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && snapshot.stats.uid !== process.getuid())
  ) {
    throw new Error("Verification session lock owner is unsafe.");
  }
  let owner;
  try {
    owner = exactOwner(JSON.parse(snapshot.buffer.toString("utf8")));
  } catch (error) {
    throw new Error("Verification session lock owner is invalid.", { cause: error });
  }
  return Object.freeze({ owner, stats: snapshot.stats, status: processStatus(owner.pid) });
}

export function inspectVerificationSessionLock({ repositoryRoot = frameworkRoot } = {}) {
  const root = realpathSync.native(path.resolve(repositoryRoot));
  const directory = openVerificationState(root);
  if (!directory) return Object.freeze({ status: "absent" });
  try {
    const current = readOwner(directory);
    return Object.freeze({ owner: current.owner, status: current.status });
  } finally {
    closeOwnedDirectoryBinding(directory);
  }
}

function releaseLifecycle(root, owner, testHooks, finalize) {
  releaseRuntimeLifecycleLock({ root, owner, finalize, testHooks });
}

export function acquireVerificationSessionLock({ repositoryRoot = frameworkRoot, testHooks } = {}) {
  const root = realpathSync.native(path.resolve(repositoryRoot));
  if (capabilities.has(root)) throw new Error(lockedMessage);

  let lifecycleOwner;
  try {
    lifecycleOwner = acquireRuntimeLifecycleLock({
      root,
      operation: "verification",
      testHooks,
    });
  } catch (error) {
    if (error?.message === "Another Codex runtime lifecycle operation is active.") {
      throw new Error(lockedMessage, { cause: error });
    }
    throw error;
  }

  let directory;
  let created;
  try {
    directory = ensureVerificationState(root, { testHooks });
    let current;
    try {
      current = readOwner(directory);
    } catch (error) {
      throw new Error(lockedMessage, { cause: error });
    }
    if (current.status === "active" || current.status === "unknown") {
      throw new Error(lockedMessage);
    }
    if (current.status === "stale") {
      removeStableOwnedFile(
        directory,
        ownerFileName,
        current.stats,
        "stale verification session lock",
      );
    }

    const owner = Object.freeze({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      token: randomUUID(),
    });
    testHooks?.beforeVerificationLockCreate?.({ directory, owner });
    created = createExclusiveOwnedFile(
      directory,
      ownerFileName,
      serializeCanonicalJson(owner),
      "verification session lock",
      0o600,
    );
    const stable = readOwner(directory);
    if (
      stable.owner.pid !== owner.pid ||
      stable.owner.token !== owner.token ||
      stable.stats.dev !== created.dev ||
      stable.stats.ino !== created.ino
    ) {
      throw new Error("Verification session lock owner changed during acquisition.");
    }
    capabilities.set(
      root,
      Object.freeze({ lifecycleOwner, stats: stable.stats, token: owner.token }),
    );

    let released = false;
    return Object.freeze({
      lifecycleCapability: lifecycleOwner,
      release() {
        if (released) throw new Error("Verification session lock was already released.");
        releaseLifecycle(root, lifecycleOwner, testHooks, () => {
          const capability = capabilities.get(root);
          const state = openVerificationState(root);
          if (!state) throw new Error("Verification session lock disappeared before release.");
          try {
            const currentOwner = readOwner(state);
            if (
              currentOwner.status === "absent" ||
              currentOwner.owner.pid !== process.pid ||
              currentOwner.owner.token !== owner.token ||
              capability?.token !== owner.token ||
              currentOwner.stats.dev !== capability.stats.dev ||
              currentOwner.stats.ino !== capability.stats.ino
            ) {
              throw new Error("Verification session lock ownership changed before release.");
            }
            testHooks?.beforeVerificationLockRemove?.({ directory: state, owner });
            removeStableOwnedFile(
              state,
              ownerFileName,
              currentOwner.stats,
              "verification session lock",
            );
          } finally {
            closeOwnedDirectoryBinding(state);
          }
        });
        capabilities.delete(root);
        released = true;
      },
    });
  } catch (error) {
    if (directory && created) {
      try {
        removeStableOwnedFile(
          directory,
          ownerFileName,
          created,
          "failed verification session lock",
        );
      } catch {
        // Preserve suspicious state and the original failure; later acquisition remains fail-closed.
      }
    }
    capabilities.delete(root);
    try {
      releaseLifecycle(root, lifecycleOwner, testHooks);
    } catch {
      // The primary acquisition error remains authoritative; a residual lifecycle lock is fail-closed.
    }
    throw error;
  } finally {
    if (directory) closeOwnedDirectoryBinding(directory);
  }
}

export function assertVerificationSessionLockOwned({ repositoryRoot = frameworkRoot } = {}) {
  const root = realpathSync.native(path.resolve(repositoryRoot));
  const directory = openVerificationState(root);
  if (!directory) {
    throw new Error(
      "Verification evidence publication requires this process to own the session lock.",
    );
  }
  try {
    const stable = readOwner(directory);
    const capability = capabilities.get(root);
    if (
      stable.status === "absent" ||
      stable.owner.pid !== process.pid ||
      capability?.token !== stable.owner.token ||
      capability?.stats.dev !== stable.stats.dev ||
      capability?.stats.ino !== stable.stats.ino
    ) {
      throw new Error(
        "Verification evidence publication requires this process to own the session lock.",
      );
    }
    return Object.freeze({ token: stable.owner.token });
  } finally {
    closeOwnedDirectoryBinding(directory);
  }
}

export async function withVerificationSessionLock(action, options) {
  const lock = acquireVerificationSessionLock(options);
  try {
    return await action(lock);
  } finally {
    lock.release();
  }
}

function parseHeldCommand(args) {
  const usage =
    "Usage: node scripts/verify/verification-session-lock.mjs --hold [--root <repository-root>] <command> [args...]";
  if (args[0] !== "--hold") throw new Error(usage);
  let index = 1;
  let repositoryRoot = frameworkRoot;
  if (args[index] === "--root") {
    if (!args[index + 1]) throw new Error(usage);
    repositoryRoot = path.resolve(args[index + 1]);
    index += 2;
  }
  if (!args[index]) throw new Error(usage);
  return Object.freeze({
    command: args[index],
    commandArgs: args.slice(index + 1),
    repositoryRoot,
  });
}

async function main() {
  const heldCommand = parseHeldCommand(process.argv.slice(2));
  const lock = acquireVerificationSessionLock({ repositoryRoot: heldCommand.repositoryRoot });
  try {
    process.exitCode = await runHeldVerificationCommand(heldCommand);
  } finally {
    lock.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
