/** Owns the exact persistent session-lease schema and parent-bound file transitions. */
import { randomUUID } from "node:crypto";
import {
  frameworkRoot,
  resolveFrameworkPath,
  serializeCanonicalJson,
} from "../contracts/framework-contract.mjs";
import { repositoryCodexRuntimeDirectory } from "./source-inventory.mjs";
import {
  atomicReplaceOwnedFile,
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
import { captureProcessIdentity, inspectProcessIdentity } from "./runtime-process-identity.mjs";

export const runtimeSessionLeasePath = `${repositoryCodexRuntimeDirectory}/codexrig-session.json`;
export const runtimeSessionRecoveryPath = `${repositoryCodexRuntimeDirectory}/codexrig-session-recovery.json`;
export const inactiveRuntimeSessionWriterErrorCode = "CODEXRIG_CODEX_PROCESS_INACTIVE";
export const invalidRuntimeSessionLeaseErrorCode = "CODEXRIG_RUNTIME_SESSION_LEASE_INVALID";

const runtimeSessionLeaseKeys =
  "codexProcess\ncodexSessionId\nphase\nprocess\nresumeSessionId\nroot\nschemaVersion\nsessionId\nsessionSource\nstartedAt\nwriterPhase\nwriterProcess";

const codexSessionIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u;
const runtimeSessionRecoveryKeys = "codexSessionId\nroot\nschemaVersion\nupdatedAt";
const runtimeSessionIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

function validIsoInstant(value) {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

export function validCodexSessionId(value) {
  return typeof value === "string" && codexSessionIdPattern.test(value);
}

function validProcessIdentity(value) {
  try {
    inspectProcessIdentity(value);
    return true;
  } catch {
    return false;
  }
}

function runtimeSessionLeaseStatus(lease) {
  const states = [inspectProcessIdentity(lease.process)];
  if (lease.writerProcess !== null) states.push(inspectProcessIdentity(lease.writerProcess));
  if (lease.codexProcess !== null) states.push(inspectProcessIdentity(lease.codexProcess));
  if (states.includes("active")) return "active";
  if (states.includes("unknown")) return "unknown";
  // Once the supervisor has been allowed to spawn Codex, its death before the exact child PID is
  // bound cannot prove that no orphan writer survived. Preserve that narrow crash window as an
  // ownership-confirmation blocker instead of reclaiming a merely PID-stale lease.
  if (lease.writerPhase === "handoff") return "unknown";
  return "stale";
}

function validWriterBinding(lease) {
  const writerValid = lease.writerProcess === null || validProcessIdentity(lease.writerProcess);
  const codexValid = lease.codexProcess === null || validProcessIdentity(lease.codexProcess);
  if (!writerValid || !codexValid) return false;
  if (lease.writerPhase === "unbound") {
    return lease.writerProcess === null && lease.codexProcess === null;
  }
  if (["gated", "handoff"].includes(lease.writerPhase)) {
    return lease.writerProcess !== null && lease.codexProcess === null;
  }
  if (lease.writerPhase === "completed") return lease.writerProcess !== null;
  return (
    lease.writerPhase === "bound" && lease.writerProcess !== null && lease.codexProcess !== null
  );
}

function validSessionSelection(source, resumeSessionId) {
  return source === "startup"
    ? resumeSessionId === null
    : source === "resume" && validCodexSessionId(resumeSessionId);
}

function invalidRuntimeSessionLease(message) {
  const error = new Error(message);
  error.code = invalidRuntimeSessionLeaseErrorCode;
  return error;
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
    throw invalidRuntimeSessionLease("Codex runtime session lease is invalid.");
  }
  const identity = repositoryRuntimeRootIdentity(root);
  const leaseKeys =
    lease && typeof lease === "object" && !Array.isArray(lease)
      ? Object.keys(lease).sort().join("\n")
      : "";
  if (
    !lease ||
    typeof lease !== "object" ||
    Array.isArray(lease) ||
    lease.schemaVersion !== 5 ||
    leaseKeys !== runtimeSessionLeaseKeys ||
    !validIsoInstant(lease.startedAt) ||
    !runtimeSessionIdPattern.test(lease.sessionId ?? "") ||
    !validProcessIdentity(lease.process) ||
    !["active", "launching"].includes(lease.phase) ||
    !validSessionSelection(lease.sessionSource, lease.resumeSessionId) ||
    (lease.phase === "launching" && lease.codexSessionId !== null) ||
    (lease.phase === "active" && !validCodexSessionId(lease.codexSessionId)) ||
    (lease.phase === "active" &&
      lease.resumeSessionId !== null &&
      lease.codexSessionId !== lease.resumeSessionId) ||
    !validWriterBinding(lease) ||
    (lease.phase === "active" && !["handoff", "bound", "completed"].includes(lease.writerPhase))
  ) {
    closeRuntimeFile(file);
    throw invalidRuntimeSessionLease(
      "Codex runtime session lease is invalid or uses an unsupported schema.",
    );
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
    status: runtimeSessionLeaseStatus(lease),
  };
}

function readRuntimeSessionRecovery(root) {
  const target = resolveFrameworkPath(root, runtimeSessionRecoveryPath);
  const file = runtimeFile(
    root,
    "codexrig-session-recovery.json",
    "Codex runtime session recovery state",
  );
  if (file.status === "absent") {
    closeRuntimeFile(file);
    return { path: target, status: "absent" };
  }
  let recovery;
  try {
    recovery = JSON.parse(file.snapshot.buffer.toString("utf8"));
  } catch {
    closeRuntimeFile(file);
    return {
      path: target,
      reason: "Codex runtime session recovery state is invalid.",
      status: "invalid",
    };
  }
  if (
    !recovery ||
    typeof recovery !== "object" ||
    Array.isArray(recovery) ||
    Object.keys(recovery).sort().join("\n") !== runtimeSessionRecoveryKeys ||
    recovery.schemaVersion !== 1 ||
    !validCodexSessionId(recovery.codexSessionId) ||
    !validIsoInstant(recovery.updatedAt) ||
    JSON.stringify(recovery.root) !== JSON.stringify(repositoryRuntimeRootIdentity(root))
  ) {
    closeRuntimeFile(file);
    return {
      path: target,
      reason: "Codex runtime session recovery state is invalid or unsupported.",
      status: "invalid",
    };
  }
  return {
    directory: file.directory,
    path: target,
    recovery,
    status: "present",
  };
}

function recordRuntimeSessionRecovery(root, codexSessionId, { now = Date.now } = {}) {
  if (!validCodexSessionId(codexSessionId)) {
    throw new Error("Codex runtime session recovery requires a valid session identifier.");
  }
  const updatedAt = new Date(now()).toISOString();
  const recovery = {
    schemaVersion: 1,
    codexSessionId,
    root: repositoryRuntimeRootIdentity(root),
    updatedAt,
  };
  const directory = openRuntimeDirectory(root, "Codex runtime session recovery parent");
  if (!directory) {
    throw new Error("Codex runtime session recovery parent disappeared.");
  }
  try {
    atomicReplaceOwnedFile(
      directory,
      "codexrig-session-recovery.json",
      serializeCanonicalJson(recovery),
      "Codex runtime session recovery state",
      { mode: 0o600 },
    );
  } finally {
    closeOwnedDirectoryBinding(directory);
  }
  return recovery;
}

function runtimeSessionLease(root, pid, sessionSource, resumeSessionId) {
  const processIdentity = captureProcessIdentity(pid);
  if (!processIdentity) {
    throw new Error("Codex runtime session process is not active.");
  }
  const normalizedResumeSessionId = resumeSessionId === "" ? null : resumeSessionId;
  if (!validSessionSelection(sessionSource, normalizedResumeSessionId)) {
    throw new Error("Codex runtime session selection is invalid.");
  }
  return {
    schemaVersion: 5,
    codexProcess: null,
    codexSessionId: null,
    phase: "launching",
    process: processIdentity,
    resumeSessionId: normalizedResumeSessionId,
    sessionId: randomUUID(),
    sessionSource,
    startedAt: new Date().toISOString(),
    writerPhase: "unbound",
    writerProcess: null,
    root: repositoryRuntimeRootIdentity(root),
  };
}

function assertRuntimeSessionOwnerCaller(pid) {
  if (pid !== process.pid) {
    throw new Error("Codex runtime session mutation must be performed by its owning process.");
  }
}

function replaceStableRuntimeSessionLease(root, expected, lease, { testHooks } = {}) {
  const current = readRuntimeSessionLease(root);
  try {
    if (
      current.status === "absent" ||
      current.fileIdentity !== expected.fileIdentity ||
      current.leaseIdentity !== expected.leaseIdentity
    ) {
      throw new Error("Codex runtime session lease changed before replacement.");
    }
    testHooks?.beforeSessionLeaseReplace?.({ current, lease });
    atomicReplaceOwnedFile(
      current.directory,
      "codexrig-session.json",
      serializeCanonicalJson(lease),
      "Codex runtime session lease",
      { mode: 0o600 },
    );
  } finally {
    closeRuntimeFile(current);
  }
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

export function inspectRuntimeSessionRecovery({ root = frameworkRoot } = {}) {
  const current = readRuntimeSessionRecovery(root);
  try {
    return Object.freeze({
      path: current.path,
      reason: current.reason,
      recovery: current.recovery,
      status: current.status,
    });
  } finally {
    closeRuntimeFile(current);
  }
}

function preserveExactRecoveryFromActiveLease(root, current) {
  if (current.lease.phase !== "active" || !validCodexSessionId(current.lease.codexSessionId)) {
    return false;
  }
  const recovery = readRuntimeSessionRecovery(root);
  try {
    // The separate marker is the canonical latest verified thread and is written before an active
    // lease is published. Preserve any valid marker, including a mismatched newer recovery ID.
    if (recovery.status === "present") return false;
  } finally {
    closeRuntimeFile(recovery);
  }
  recordRuntimeSessionRecovery(root, current.lease.codexSessionId);
  return true;
}

function runtimeSessionPlan(current, recovery) {
  if (current.status === "active" || current.status === "unknown") {
    throw new Error("Another Codex session already owns this repository runtime.");
  }
  if (recovery.status === "present") {
    return Object.freeze({
      mode: "resume-id",
      resumeSessionId: recovery.recovery.codexSessionId,
    });
  }
  if (current.status === "absent") {
    return Object.freeze({ mode: "startup", resumeSessionId: null });
  }
  if (current.lease.phase === "active") {
    return Object.freeze({
      mode: "resume-id",
      resumeSessionId: current.lease.codexSessionId,
    });
  }
  if (current.lease.sessionSource === "resume") {
    return Object.freeze({
      mode: "resume-id",
      resumeSessionId: current.lease.resumeSessionId,
    });
  }
  return Object.freeze({ mode: "startup", resumeSessionId: null });
}

/** Reads the canonical next-session selection without reserving a writer lease. */
export function inspectRuntimeSessionPlan({ root = frameworkRoot } = {}) {
  const current = readRuntimeSessionLease(root);
  try {
    const recovery = readRuntimeSessionRecovery(root);
    try {
      return runtimeSessionPlan(current, recovery);
    } finally {
      closeRuntimeFile(recovery);
    }
  } finally {
    closeRuntimeFile(current);
  }
}

function createRuntimeSessionLease(root, lease, { testHooks } = {}) {
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
}

/** Selects the latest safe repository session and reserves its writer lease under one capability. */
export function reserveRuntimeSessionLeaseState({ root, pid, testHooks } = {}) {
  assertRuntimeSessionOwnerCaller(pid);
  const current = readRuntimeSessionLease(root);
  try {
    const recovery = readRuntimeSessionRecovery(root);
    let plan;
    try {
      plan = runtimeSessionPlan(current, recovery);
    } finally {
      closeRuntimeFile(recovery);
    }
    if (current.status === "stale") {
      preserveExactRecoveryFromActiveLease(root, current);
      unlinkStableRuntimeSessionLease(root, current, { testHooks });
    }
    const lease = runtimeSessionLease(
      root,
      pid,
      plan.mode === "startup" ? "startup" : "resume",
      plan.resumeSessionId ?? "",
    );
    createRuntimeSessionLease(root, lease, { testHooks });
    return Object.freeze({ lease, plan });
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
    preserveExactRecoveryFromActiveLease(root, current);
    unlinkStableRuntimeSessionLease(root, current, { testHooks });
    return true;
  } finally {
    closeRuntimeFile(current);
  }
}

/** Creates state only while the caller holds the repository session-management capability. */
export function issueRuntimeSessionLeaseState({
  root,
  pid,
  sessionSource = "startup",
  resumeSessionId = "",
  testHooks,
} = {}) {
  assertRuntimeSessionOwnerCaller(pid);
  const current = readRuntimeSessionLease(root);
  try {
    if (current.status === "active" || current.status === "unknown") {
      throw new Error("Another Codex session already owns this repository runtime.");
    }
    if (current.status === "stale") {
      preserveExactRecoveryFromActiveLease(root, current);
      unlinkStableRuntimeSessionLease(root, current, { testHooks });
    }
  } finally {
    closeRuntimeFile(current);
  }
  const lease = runtimeSessionLease(root, pid, sessionSource, resumeSessionId);
  createRuntimeSessionLease(root, lease, { testHooks });
  return lease;
}

/** Advances the gated supervisor-to-Codex PID handoff without an unowned process window. */
export function transitionRuntimeSessionWriterProcessState({
  root,
  pid,
  runtimeSessionId,
  transition,
  writerPid,
  testHooks,
} = {}) {
  assertRuntimeSessionOwnerCaller(pid);
  const current = readRuntimeSessionLease(root);
  try {
    if (
      current.status !== "active" ||
      current.lease.process.pid !== pid ||
      current.lease.sessionId !== runtimeSessionId
    ) {
      throw new Error("Session writer transition does not match the owned launcher lease.");
    }
    let lease;
    if (
      transition === "supervisor" &&
      current.lease.phase === "launching" &&
      current.lease.writerPhase === "unbound"
    ) {
      const writerProcess = captureProcessIdentity(writerPid);
      if (!writerProcess) throw new Error("Session writer supervisor is not active.");
      lease = { ...current.lease, writerPhase: "gated", writerProcess };
    } else if (
      transition === "handoff" &&
      current.lease.phase === "launching" &&
      current.lease.writerPhase === "gated" &&
      inspectProcessIdentity(current.lease.writerProcess) === "active"
    ) {
      lease = { ...current.lease, writerPhase: "handoff" };
    } else if (
      transition === "complete" &&
      ["launching", "active"].includes(current.lease.phase) &&
      ["handoff", "bound"].includes(current.lease.writerPhase)
    ) {
      // Only the issue-time controller may reach this transition, after it validates the
      // supervisor's nonce-bound terminal child proof. Persist completion before release so the
      // state owner, not a finally-block convention, enforces the terminal boundary.
      lease = { ...current.lease, writerPhase: "completed" };
    } else if (
      transition === "codex" &&
      ["launching", "active"].includes(current.lease.phase) &&
      current.lease.writerPhase === "handoff"
    ) {
      const codexProcess = captureProcessIdentity(writerPid);
      if (!codexProcess) {
        const error = new Error("Exact Codex writer process is not active.");
        error.code = inactiveRuntimeSessionWriterErrorCode;
        throw error;
      }
      lease = { ...current.lease, codexProcess, writerPhase: "bound" };
    } else {
      throw new Error("Session writer transition is invalid for the current lease state.");
    }
    replaceStableRuntimeSessionLease(root, current, lease, { testHooks });
    return lease;
  } finally {
    closeRuntimeFile(current);
  }
}

/** Atomically replaces an unactivated owned resume attempt with a fresh-start lease. */
export function fallbackRuntimeSessionLeaseState({ root, pid, runtimeSessionId, testHooks } = {}) {
  assertRuntimeSessionOwnerCaller(pid);
  const current = readRuntimeSessionLease(root);
  try {
    if (
      current.status !== "active" ||
      current.lease.process.pid !== pid ||
      current.lease.sessionId !== runtimeSessionId ||
      current.lease.phase !== "launching" ||
      current.lease.sessionSource !== "resume"
    ) {
      throw new Error("Fresh-session fallback does not match the unactivated resume lease.");
    }
    if (
      current.lease.writerProcess !== null &&
      inspectProcessIdentity(current.lease.writerProcess) !== "stale"
    ) {
      throw new Error("Fresh-session fallback cannot outlive an active or indeterminate writer.");
    }
    if (current.lease.writerPhase !== "completed") {
      throw new Error("Fresh-session fallback requires a proven terminal Codex writer handoff.");
    }
    const lease = runtimeSessionLease(root, pid, "startup", "");
    replaceStableRuntimeSessionLease(root, current, lease, { testHooks });
    return lease;
  } finally {
    closeRuntimeFile(current);
  }
}

/** Binds a verified Codex main thread to the active launcher-owned repository session. */
export function activateRuntimeSessionLeaseState({
  root,
  pid,
  runtimeSessionId,
  codexSessionId,
  testHooks,
} = {}) {
  assertRuntimeSessionOwnerCaller(pid);
  if (!validCodexSessionId(codexSessionId)) {
    throw new Error("Codex runtime session activation requires a valid Codex session identifier.");
  }
  const current = readRuntimeSessionLease(root);
  try {
    if (
      current.status !== "active" ||
      current.lease.process.pid !== pid ||
      current.lease.sessionId !== runtimeSessionId
    ) {
      throw new Error("Codex runtime session activation does not match the active launcher lease.");
    }
    if (current.lease.phase === "active") {
      if (current.lease.codexSessionId !== codexSessionId) {
        throw new Error("Codex runtime session is already bound to a different Codex session.");
      }
      recordRuntimeSessionRecovery(root, codexSessionId);
      return current.lease;
    }
    if (
      current.lease.resumeSessionId !== null &&
      current.lease.resumeSessionId !== codexSessionId
    ) {
      throw new Error("Codex runtime session differs from the planned exact resume session.");
    }
    if (
      current.lease.writerProcess === null ||
      inspectProcessIdentity(current.lease.writerProcess) !== "active" ||
      !["handoff", "bound"].includes(current.lease.writerPhase)
    ) {
      throw new Error("Codex session writer identity is missing or inactive.");
    }
    const lease = {
      ...current.lease,
      codexSessionId,
      phase: "active",
    };
    // Persist exact recovery first. If activation is interrupted afterward, the still-launching
    // lease may be cleared as stale without discarding the already verified Codex session id.
    recordRuntimeSessionRecovery(root, codexSessionId);
    testHooks?.beforeSessionLeaseActivate?.({ current, lease });
    replaceStableRuntimeSessionLease(root, current, lease, { testHooks });
    return lease;
  } finally {
    closeRuntimeFile(current);
  }
}

/** Removes state only while the caller holds the repository session-management capability. */
export function releaseRuntimeSessionLeaseState({ root, pid, testHooks } = {}) {
  assertRuntimeSessionOwnerCaller(pid);
  const current = readRuntimeSessionLease(root);
  try {
    if (current.status === "absent") return false;
    const releasingProcess =
      Number.isSafeInteger(pid) && pid > 0 ? captureProcessIdentity(pid) : null;
    if (
      releasingProcess === null ||
      current.lease.process.pid !== releasingProcess.pid ||
      current.lease.process.startIdentity !== releasingProcess.startIdentity
    ) {
      throw new Error("Codex runtime session lease is owned by a different process identity.");
    }
    const preSpawnRelease =
      current.lease.writerPhase === "unbound" ||
      (current.lease.writerPhase === "gated" &&
        inspectProcessIdentity(current.lease.writerProcess) === "stale");
    if (!preSpawnRelease && current.lease.writerPhase !== "completed") {
      throw new Error("Codex runtime session release requires proven terminal child completion.");
    }
    preserveExactRecoveryFromActiveLease(root, current);
    unlinkStableRuntimeSessionLease(root, current, { testHooks });
    return true;
  } finally {
    closeRuntimeFile(current);
  }
}
