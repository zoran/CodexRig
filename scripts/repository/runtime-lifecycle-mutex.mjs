/** Serializes short lifecycle-owner transitions without becoming a competing capability owner. */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { serializeCanonicalJson } from "../contracts/framework-contract.mjs";
import {
  closeOwnedDirectoryBinding,
  createExclusiveOwnedFile,
  ownedDirectoryChildPath,
  removeStableOwnedFile,
  safeArtifactStats,
  sameStableIdentity,
  validateOwnedDirectoryBinding,
} from "../filesystem/owned-path-safety.mjs";
import { captureProcessIdentity, inspectProcessIdentity } from "./runtime-process-identity.mjs";
import { closeRuntimeFile, openRuntimeDirectory, runtimeFile } from "./runtime-owned-state.mjs";

const updateMutexName = "codexrig-lifecycle.update";
const waitState = new Int32Array(new SharedArrayBuffer(4));

function stagingName(owner) {
  return `.${updateMutexName}.${owner.nonce}.tmp`;
}

function publicationChanged() {
  return Object.assign(new Error("Codex lifecycle update mutex publication changed."), {
    code: "ERR_CODEXRIG_MUTEX_PUBLICATION_CHANGED",
  });
}

function publicationAlias(directory, owner, expected) {
  const target = ownedDirectoryChildPath(
    directory,
    updateMutexName,
    "Codex lifecycle update mutex",
  );
  const temporary = ownedDirectoryChildPath(
    directory,
    stagingName(owner),
    "Codex lifecycle update mutex staging",
  );
  const current = lstatSync(target);
  const alias = lstatSync(temporary);
  if (!sameStableIdentity(expected, current)) throw publicationChanged();
  if (!alias.isFile() || alias.nlink !== 2 || !sameStableIdentity(current, alias)) {
    throw new Error("Codex lifecycle update mutex publication alias is unsafe.");
  }
  return temporary;
}

function publishMutex(directory, owner) {
  const label = "Codex lifecycle update mutex";
  const target = ownedDirectoryChildPath(directory, updateMutexName, label);
  if (lstatSync(target, { throwIfNoEntry: false })) {
    throw Object.assign(new Error("Codex lifecycle update mutex already exists."), {
      code: "EEXIST",
    });
  }
  const temporaryName = stagingName(owner);
  const temporary = ownedDirectoryChildPath(directory, temporaryName, label);
  let created;
  let published = false;
  try {
    // Only a complete, durable owner record becomes authoritative. A crash before linking may
    // leave .codexrig-lifecycle.update.<nonce>.tmp; that unpublished state belongs to full reset,
    // never to mutex acquisition or speculative process cleanup.
    created = createExclusiveOwnedFile(
      directory,
      temporaryName,
      serializeCanonicalJson(owner),
      label,
    );
    if (!sameStableIdentity(created, safeArtifactStats(temporary, "file", label))) {
      throw publicationChanged();
    }
    validateOwnedDirectoryBinding(directory, label);
    linkSync(temporary, target);
    published = true;
    const linked = lstatSync(target);
    if (
      linked.dev !== created.dev ||
      linked.ino !== created.ino ||
      linked.nlink !== 2 ||
      linked.size !== created.size ||
      linked.mtimeMs !== created.mtimeMs
    ) {
      throw new Error("Codex lifecycle update mutex publication identity is unsafe.");
    }
    unlinkSync(publicationAlias(directory, owner, linked));
    fsyncSync(directory.descriptor);
    validateOwnedDirectoryBinding(directory, label);
    const complete = safeArtifactStats(target, "file", label);
    if (complete.dev !== created.dev || complete.ino !== created.ino) throw publicationChanged();
    return complete;
  } finally {
    if (created && !published) {
      removeStableOwnedFile(
        directory,
        temporaryName,
        created,
        "unpublished lifecycle update mutex",
      );
    }
  }
}

function validMutexOwner(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\n") === "identity\nnonce" &&
    typeof value.nonce === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value.nonce) &&
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

function recoverPublication(root) {
  const label = "Codex lifecycle update mutex";
  const directory = openRuntimeDirectory(root, label);
  if (!directory) return;
  let descriptor;
  try {
    const target = ownedDirectoryChildPath(directory, updateMutexName, label);
    const initial = lstatSync(target);
    if (initial.isFile() && initial.nlink === 1) return;
    if (
      !initial.isFile() ||
      initial.nlink !== 2 ||
      initial.size > 4_096 ||
      (initial.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && initial.uid !== process.getuid())
    ) {
      throw new Error("Codex lifecycle update mutex publication is unsafe.");
    }
    descriptor = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!sameStableIdentity(initial, opened)) throw publicationChanged();
    const buffer = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (!sameStableIdentity(opened, after) || buffer.length !== after.size) {
      throw publicationChanged();
    }
    validateOwnedDirectoryBinding(directory, label);
    let owner;
    try {
      owner = JSON.parse(buffer.toString("utf8"));
    } catch {
      throw new Error("Codex lifecycle update mutex is invalid.");
    }
    if (!validMutexOwner(owner)) throw new Error("Codex lifecycle update mutex is invalid.");
    const temporary = publicationAlias(directory, owner, after);
    const status = inspectProcessIdentity(owner.identity);
    if (status === "unknown")
      throw new Error("Codex lifecycle update mutex owner cannot be verified.");
    // The publisher alone removes its live staging alias. Only an exact, proven-dead pair may
    // be normalized here; the unchanged regular-file reader then owns stale mutex reclamation.
    if (status === "stale") {
      publicationAlias(directory, owner, after);
      unlinkSync(temporary);
      fsyncSync(directory.descriptor);
      validateOwnedDirectoryBinding(directory, label);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    closeOwnedDirectoryBinding(directory);
  }
}

function retryableMutexRead(error) {
  return (
    error?.code === "ENOENT" ||
    error?.code === "ERR_CODEXRIG_MUTEX_PUBLICATION_CHANGED" ||
    /detected (?:a content|an identity) change in Codex lifecycle update mutex/u.test(
      error?.message ?? "",
    )
  );
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
      const stats = publishMutex(directory, owner);
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
      if (retryableMutexRead(error)) continue;
      if (error?.message === "Owned path safety refused hardlinked Codex lifecycle update mutex.") {
        try {
          recoverPublication(root);
        } catch (publicationError) {
          if (!retryableMutexRead(publicationError)) throw publicationError;
        }
        Atomics.wait(waitState, 0, 0, 5);
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
