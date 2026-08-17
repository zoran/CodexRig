/** Serializes short lifecycle-owner transitions without becoming a competing capability owner. */
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { serializeCanonicalJson } from "../contracts/framework-contract.mjs";
import {
  closeOwnedDirectoryBinding,
  createExclusiveOwnedFile,
  removeStableOwnedFile,
} from "../filesystem/owned-path-safety.mjs";
import { captureProcessIdentity, inspectProcessIdentity } from "./runtime-process-identity.mjs";
import { closeRuntimeFile, openRuntimeDirectory, runtimeFile } from "./runtime-owned-state.mjs";

const updateMutexName = "codexrig-lifecycle.update";
const waitState = new Int32Array(new SharedArrayBuffer(4));

function validMutexOwner(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\n") === "identity\nnonce" &&
    typeof value.nonce === "string" &&
    /^[a-f0-9-]{36}$/u.test(value.nonce) &&
    (() => {
      try {
        inspectProcessIdentity(value.identity);
        return true;
      } catch {
        return false;
      }
    })()
  );
}

function readMutex(root) {
  const current = runtimeFile(root, updateMutexName, "Codex lifecycle update mutex", 4_096);
  if (current.status === "absent") return current;
  let owner;
  try {
    owner = JSON.parse(current.snapshot.buffer.toString("utf8"));
  } catch {
    closeRuntimeFile(current);
    throw new Error("Codex lifecycle update mutex is invalid.");
  }
  if (!validMutexOwner(owner)) {
    closeRuntimeFile(current);
    throw new Error("Codex lifecycle update mutex is invalid.");
  }
  return { ...current, owner, processStatus: inspectProcessIdentity(owner.identity) };
}

function removeStaleMutex(root, expected) {
  const current = readMutex(root);
  try {
    if (
      current.status === "absent" ||
      current.owner.nonce !== expected.owner.nonce ||
      current.snapshot.stats.dev !== expected.snapshot.stats.dev ||
      current.snapshot.stats.ino !== expected.snapshot.stats.ino
    ) {
      return false;
    }
    if (current.processStatus !== "stale") return false;
    removeStableOwnedFile(
      current.directory,
      updateMutexName,
      current.snapshot.stats,
      "stale Codex lifecycle update mutex",
    );
    return true;
  } finally {
    closeRuntimeFile(current);
  }
}

function acquireMutex(root) {
  const identity = captureProcessIdentity(process.pid);
  if (!identity) throw new Error("Could not capture the lifecycle update owner identity.");
  const owner = Object.freeze({ identity, nonce: randomUUID() });
  const deadline = performance.now() + 10_000;
  while (performance.now() <= deadline) {
    const directory = openRuntimeDirectory(root, "Codex lifecycle update mutex parent");
    if (!directory) throw new Error("Codex lifecycle update mutex parent disappeared.");
    try {
      const stats = createExclusiveOwnedFile(
        directory,
        updateMutexName,
        serializeCanonicalJson(owner),
        "Codex lifecycle update mutex",
      );
      return Object.freeze({ owner, root, stats });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    } finally {
      closeOwnedDirectoryBinding(directory);
    }

    let current;
    try {
      current = readMutex(root);
    } catch (error) {
      if (
        error?.code === "ENOENT" ||
        /detected (?:a content|an identity) change in Codex lifecycle update mutex/u.test(
          error?.message ?? "",
        )
      ) {
        continue;
      }
      throw error;
    }
    try {
      if (current.status === "absent") continue;
      if (current.processStatus === "unknown") {
        throw new Error("Codex lifecycle update mutex owner cannot be verified.");
      }
      if (current.processStatus === "stale") {
        try {
          removeStaleMutex(root, current);
        } catch (error) {
          if (!/changed|disappeared|missing/u.test(error?.message ?? "")) throw error;
        }
        continue;
      }
    } finally {
      closeRuntimeFile(current);
    }
    Atomics.wait(waitState, 0, 0, 5);
  }
  throw new Error("Timed out waiting for the Codex lifecycle update mutex.");
}

function releaseMutex(mutex) {
  const current = readMutex(mutex.root);
  try {
    if (
      current.status === "absent" ||
      current.owner.nonce !== mutex.owner.nonce ||
      current.snapshot.stats.dev !== mutex.stats.dev ||
      current.snapshot.stats.ino !== mutex.stats.ino
    ) {
      throw new Error("Codex lifecycle update mutex ownership changed before release.");
    }
    removeStableOwnedFile(
      current.directory,
      updateMutexName,
      current.snapshot.stats,
      "Codex lifecycle update mutex",
    );
  } finally {
    closeRuntimeFile(current);
  }
}

/** Runs one synchronous lifecycle-owner transition under its subordinate update mutex. */
export function withRuntimeLifecycleUpdateMutex(root, action) {
  const mutex = acquireMutex(root);
  try {
    return action();
  } finally {
    releaseMutex(mutex);
  }
}
