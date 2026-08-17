/** Owns the exact persistent session-lease schema and parent-bound file transitions. */
import { randomUUID } from "node:crypto";
import process from "node:process";
import {
  frameworkRoot,
  resolveFrameworkPath,
  serializeCanonicalJson,
} from "../contracts/framework-contract.mjs";
import { repositoryCodexRuntimeDirectory } from "./source-inventory.mjs";
import {
  closeOwnedDirectoryBinding,
  createExclusiveOwnedFile,
  removeStableOwnedFile,
} from "../filesystem/owned-path-safety.mjs";
import {
  closeRuntimeFile,
  openRuntimeDirectory,
  repositoryRuntimeRootIdentity,
  runtimeFile,
} from "./runtime-owned-state.mjs";

export const runtimeSessionLeasePath = `${repositoryCodexRuntimeDirectory}/codexrig-session.json`;

const runtimeSessionLeaseKeys = Object.freeze({
  1: "pid\nroot\nschemaVersion\nstartedAt",
  2: "pid\nroot\nschemaVersion\nsessionId\nstartedAt",
});

function processStatus(pid) {
  try {
    process.kill(pid, 0);
    return "active";
  } catch (error) {
    return error?.code === "ESRCH" ? "stale" : "unknown";
  }
}

function readRuntimeSessionLease(root) {
  const target = resolveFrameworkPath(root, runtimeSessionLeasePath);
  const file = runtimeFile(root, "codexrig-session.json", "Codex runtime session lease");
  if (file.status === "absent") {
    closeRuntimeFile(file);
    return { path: target, status: "absent" };
  }
  let lease;
  try {
    lease = JSON.parse(file.snapshot.buffer.toString("utf8"));
  } catch {
    closeRuntimeFile(file);
    throw new Error("Codex runtime session lease is invalid.");
  }
  const identity = repositoryRuntimeRootIdentity(root);
  const leaseKeys =
    lease && typeof lease === "object" && !Array.isArray(lease)
      ? Object.keys(lease).sort().join("\n")
      : "";
  const supportedKeys = runtimeSessionLeaseKeys[lease?.schemaVersion];
  if (
    !lease ||
    typeof lease !== "object" ||
    Array.isArray(lease) ||
    supportedKeys === undefined ||
    leaseKeys !== supportedKeys ||
    !Number.isSafeInteger(lease.pid) ||
    lease.pid <= 0 ||
    typeof lease.startedAt !== "string" ||
    !Number.isFinite(Date.parse(lease.startedAt)) ||
    (lease.schemaVersion === 2 &&
      (typeof lease.sessionId !== "string" || !/^[a-f0-9-]{36}$/u.test(lease.sessionId)))
  ) {
    closeRuntimeFile(file);
    throw new Error("Codex runtime session lease is invalid or uses an unsupported schema.");
  }
  if (JSON.stringify(lease.root) !== JSON.stringify(identity)) {
    closeRuntimeFile(file);
    throw new Error("Codex runtime session lease does not match this framework root.");
  }
  return {
    directory: file.directory,
    fileIdentity: `${file.snapshot.stats.dev}:${file.snapshot.stats.ino}`,
    lease,
    leaseIdentity: serializeCanonicalJson(lease),
    path: target,
    stats: file.snapshot.stats,
    status: processStatus(lease.pid),
  };
}

function unlinkStableRuntimeSessionLease(root, expected, { testHooks } = {}) {
  const current = readRuntimeSessionLease(root);
  try {
    if (
      current.status === "absent" ||
      current.fileIdentity !== expected.fileIdentity ||
      current.leaseIdentity !== expected.leaseIdentity
    ) {
      throw new Error("Codex runtime session lease changed before removal.");
    }
    testHooks?.beforeSessionLeaseRemove?.({ current });
    removeStableOwnedFile(
      current.directory,
      "codexrig-session.json",
      current.stats,
      "Codex runtime session lease",
    );
  } finally {
    closeRuntimeFile(current);
  }
}

export function inspectRuntimeSessionLease({ root = frameworkRoot } = {}) {
  const current = readRuntimeSessionLease(root);
  try {
    return Object.freeze({
      fileIdentity: current.fileIdentity,
      lease: current.lease,
      path: current.path,
      status: current.status,
    });
  } finally {
    closeRuntimeFile(current);
  }
}

/** Clears state only while the caller holds the repository session-management capability. */
export function clearStaleRuntimeSessionLeaseState({ root, testHooks } = {}) {
  const current = readRuntimeSessionLease(root);
  try {
    if (current.status === "absent") return false;
    if (current.status !== "stale") {
      throw new Error("Codex runtime session is still active or cannot be verified as stopped.");
    }
    unlinkStableRuntimeSessionLease(root, current, { testHooks });
    return true;
  } finally {
    closeRuntimeFile(current);
  }
}

/** Creates state only while the caller holds the repository session-management capability. */
export function issueRuntimeSessionLeaseState({ root, pid, testHooks } = {}) {
  const current = readRuntimeSessionLease(root);
  try {
    if (current.status === "active" || current.status === "unknown") {
      throw new Error("Another Codex session already owns this repository runtime.");
    }
    if (current.status === "stale") unlinkStableRuntimeSessionLease(root, current, { testHooks });
  } finally {
    closeRuntimeFile(current);
  }
  const lease = {
    schemaVersion: 2,
    pid,
    sessionId: randomUUID(),
    startedAt: new Date().toISOString(),
    root: repositoryRuntimeRootIdentity(root),
  };
  const directory = openRuntimeDirectory(root, "Codex runtime session lease parent");
  try {
    testHooks?.beforeSessionLeaseCreate?.({ directory, lease });
    createExclusiveOwnedFile(
      directory,
      "codexrig-session.json",
      serializeCanonicalJson(lease),
      "Codex runtime session lease",
    );
  } finally {
    closeOwnedDirectoryBinding(directory);
  }
  return lease;
}

/** Removes state only while the caller holds the repository session-management capability. */
export function releaseRuntimeSessionLeaseState({ root, pid, testHooks } = {}) {
  const current = readRuntimeSessionLease(root);
  try {
    if (current.status === "absent") return false;
    if (!Number.isSafeInteger(pid) || current.lease.pid !== pid) {
      throw new Error("Codex runtime session lease is owned by a different process.");
    }
    unlinkStableRuntimeSessionLease(root, current, { testHooks });
    return true;
  } finally {
    closeRuntimeFile(current);
  }
}
