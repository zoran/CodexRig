/** Owns repository-bound session leases and the single cross-mutation lifecycle capability. */
import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  toolingRoot,
  resolveRepositoryPath,
  serializeCanonicalJson,
} from "../filesystem/repository-files.mjs";
import { repositoryCodexRuntimeDirectory } from "./source-inventory.mjs";
import {
  atomicReplaceOwnedFile,
  closeOwnedDirectoryBinding,
  createExclusiveOwnedFile,
  ownedDirectoryChildPath,
  removeStableOwnedFile,
  validateOwnedDirectoryBinding,
} from "../filesystem/owned-path-safety.mjs";
import {
  captureProcessIdentity,
  inspectGuardHolders,
  inspectProcessIdentity,
} from "./runtime-process-identity.mjs";
import { withRuntimeLifecycleUpdateMutex } from "./runtime-lifecycle-mutex.mjs";
import {
  lifecycleGuardIdentity,
  runtimeLifecycleOperationPattern,
  runtimeLifecycleStatus,
  sameLifecycleGuardIdentity,
  validRuntimeLifecycleOwner,
} from "./runtime-lifecycle-schema.mjs";
import {
  closeRuntimeFile,
  ensureRuntimeDirectory,
  openRuntimeDirectory,
  repositoryRuntimeRootIdentity,
  runtimeFile,
} from "./runtime-owned-state.mjs";
import {
  activateRuntimeSessionLeaseState,
  clearStaleRuntimeSessionLeaseState,
  issueRuntimeSessionLeaseState,
  releaseRuntimeSessionLeaseState,
  reserveRuntimeSessionLeaseState,
  transitionRuntimeSessionWriterProcessState,
} from "./runtime-session-state.mjs";
export {
  inactiveRuntimeSessionWriterErrorCode,
  inspectRuntimeSessionLease,
  inspectRuntimeSessionPlan,
  inspectRuntimeSessionRecovery,
  invalidRuntimeSessionLeaseErrorCode,
  runtimeSessionLeasePath,
  runtimeSessionRecoveryPath,
  validCodexSessionId,
} from "./runtime-session-state.mjs";
export const runtimeLifecycleLockName = "codexrig-lifecycle.lock";
export const runtimeLifecycleGuardName = "codexrig-lifecycle.guard";
export const runtimeLifecycleLockPath = `${repositoryCodexRuntimeDirectory}/${runtimeLifecycleLockName}`;
const runtimeLifecycleGuardPath = `${repositoryCodexRuntimeDirectory}/${runtimeLifecycleGuardName}`;
const lifecycleCapabilities = new Map();
export { repositoryRuntimeRootIdentity } from "./runtime-owned-state.mjs";
function readRuntimeLifecycleLock(root) {
  const target = resolveRepositoryPath(root, runtimeLifecycleLockPath);
  const file = runtimeFile(root, runtimeLifecycleLockName, "Codex runtime lifecycle lock", 128_000);
  if (file.status === "absent") {
    closeRuntimeFile(file);
    return { path: target, status: "absent" };
  }
  let owner;
  try {
    owner = JSON.parse(file.snapshot.buffer.toString("utf8"));
  } catch {
    closeRuntimeFile(file);
    throw new Error("Codex runtime lifecycle lock is invalid.");
  }
  if (!validRuntimeLifecycleOwner(owner, repositoryRuntimeRootIdentity(root))) {
    closeRuntimeFile(file);
    throw new Error("Codex runtime lifecycle lock does not match this framework root.");
  }
  return {
    directory: file.directory,
    fileIdentity: `${file.snapshot.stats.dev}:${file.snapshot.stats.ino}`,
    owner,
    path: target,
    stats: file.snapshot.stats,
    status: runtimeLifecycleStatus(owner),
  };
}

function readRuntimeLifecycleGuard(root) {
  return runtimeFile(root, runtimeLifecycleGuardName, "Codex runtime lifecycle guard", 4_096);
}

function removeRuntimeLifecycleGuard(root, owner) {
  const guard = readRuntimeLifecycleGuard(root);
  try {
    if (guard.status === "absent") {
      if (owner.guard !== null) {
        const holders = inspectGuardHolders(owner.guard);
        if (holders.status !== "stale") {
          throw new Error("Codex runtime lifecycle guard disappeared while still held.");
        }
      }
      return;
    }
    if (owner.guard && !sameLifecycleGuardIdentity(guard.snapshot.stats, owner.guard)) {
      throw new Error("Codex runtime lifecycle guard identity changed.");
    }
    if (guard.snapshot.buffer.toString("utf8") !== `${owner.nonce}\n`) {
      throw new Error("Codex runtime lifecycle guard does not match its owner.");
    }
    removeStableOwnedFile(
      guard.directory,
      runtimeLifecycleGuardName,
      guard.snapshot.stats,
      "Codex runtime lifecycle guard",
    );
  } finally {
    closeRuntimeFile(guard);
  }
}

function unlinkStableRuntimeLifecycleLock(root, expected, { testHooks } = {}) {
  const current = readRuntimeLifecycleLock(root);
  try {
    if (
      current.status === "absent" ||
      current.fileIdentity !== expected.fileIdentity ||
      current.owner.nonce !== expected.owner.nonce
    ) {
      throw new Error("Codex runtime lifecycle lock changed before removal.");
    }
    removeRuntimeLifecycleGuard(root, current.owner);
    testHooks?.beforeLifecycleLockRemove?.({ current });
    removeStableOwnedFile(
      current.directory,
      runtimeLifecycleLockName,
      current.stats,
      "Codex runtime lifecycle lock",
    );
  } finally {
    closeRuntimeFile(current);
  }
}

function replaceLifecycleOwner(root, nonce, change, { testHooks } = {}) {
  return withRuntimeLifecycleUpdateMutex(root, () => {
    const current = readRuntimeLifecycleLock(root);
    try {
      if (current.status === "absent" || current.owner.nonce !== nonce) {
        throw new Error("Codex runtime lifecycle capability changed before update.");
      }
      const next = change(structuredClone(current.owner));
      if (!validRuntimeLifecycleOwner(next, repositoryRuntimeRootIdentity(root))) {
        throw new Error("Codex runtime lifecycle update produced an invalid owner.");
      }
      testHooks?.beforeLifecycleOwnerReplace?.({ current, next });
      atomicReplaceOwnedFile(
        current.directory,
        runtimeLifecycleLockName,
        serializeCanonicalJson(next),
        "Codex runtime lifecycle lock",
        { mode: 0o600 },
      );
      return next;
    } finally {
      closeRuntimeFile(current);
    }
  });
}

function openRuntimeLifecycleGuard(root, expected) {
  const directory = openRuntimeDirectory(root, "Codex runtime lifecycle guard parent");
  if (!directory) throw new Error("Codex runtime lifecycle guard parent disappeared.");
  try {
    const target = ownedDirectoryChildPath(
      directory,
      runtimeLifecycleGuardName,
      "Codex runtime lifecycle guard",
    );
    const before = lstatSync(target);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      !sameLifecycleGuardIdentity(before, expected)
    ) {
      throw new Error("Codex runtime lifecycle guard is unsafe.");
    }
    const descriptor = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    validateOwnedDirectoryBinding(directory, "Codex runtime lifecycle guard parent");
    if (!sameLifecycleGuardIdentity(opened, expected) || !opened.isFile()) {
      closeSync(descriptor);
      throw new Error("Codex runtime lifecycle guard changed while opening.");
    }
    return descriptor;
  } finally {
    closeOwnedDirectoryBinding(directory);
  }
}

function capabilityHandle(record) {
  const handle = Object.freeze({
    nonce: record.nonce,
    operation: record.operation,
    root: record.root,
  });
  record.handles.add(handle);
  return handle;
}

function runLifecycleFinalizer(record, handle, finalize) {
  if (finalize !== undefined && typeof finalize !== "function") {
    throw new Error("Runtime lifecycle finalizer must be a function.");
  }
  if (record.finalizedHandles.has(handle) || !finalize) return;
  finalize();
  record.finalizedHandles.add(handle);
}

function capabilityRecord(root, handle) {
  const canonical = realpathSync.native(root);
  const record = lifecycleCapabilities.get(canonical);
  if (!record || !record.handles.has(handle) || record.nonce !== handle?.nonce) {
    throw new Error("Codex runtime lifecycle capability is not owned by this process.");
  }
  return record;
}

function assertCoordinatorQuiescent(record) {
  replaceLifecycleOwner(record.root, record.nonce, (current) => {
    current.descendants = current.descendants.filter(
      ({ identity }) => inspectProcessIdentity(identity) !== "stale",
    );
    return current;
  });
  const current = readRuntimeLifecycleLock(record.root);
  try {
    if (current.status === "absent" || current.owner.nonce !== record.nonce) {
      throw new Error("Codex runtime lifecycle lock is owned by a different operation.");
    }
    if (current.owner.descendants.length > 0 || current.owner.delegations.length > 0) {
      throw new Error("Codex runtime lifecycle descendants must finish before release.");
    }
    if (process.platform === "linux") {
      const guardHolders = inspectGuardHolders(current.owner.guard, {
        excludePids: [process.pid],
      });
      if (guardHolders.status !== "stale") {
        throw new Error("Codex runtime lifecycle guard holders must finish before release.");
      }
    }
  } finally {
    closeRuntimeFile(current);
  }
}

export function inspectRuntimeLifecycleLock({ root = toolingRoot } = {}) {
  const current = readRuntimeLifecycleLock(root);
  try {
    return Object.freeze({ owner: current.owner, path: current.path, status: current.status });
  } finally {
    closeRuntimeFile(current);
  }
}

export function acquireRuntimeLifecycleLock({
  root = toolingRoot,
  operation = "runtime-session",
  testHooks,
} = {}) {
  if (!runtimeLifecycleOperationPattern.test(operation)) {
    throw new Error("Invalid runtime lifecycle operation.");
  }
  const canonical = realpathSync.native(root);
  if (lifecycleCapabilities.has(canonical)) {
    throw new Error("Another Codex runtime lifecycle operation is active.");
  }
  ensureRuntimeDirectory(canonical, { testHooks });
  const current = readRuntimeLifecycleLock(canonical);
  try {
    if (current.status === "active" || current.status === "unknown") {
      throw new Error("Another Codex runtime lifecycle operation is active.");
    }
    if (current.status === "stale")
      unlinkStableRuntimeLifecycleLock(canonical, current, { testHooks });
  } finally {
    closeRuntimeFile(current);
  }
  const coordinator = captureProcessIdentity(process.pid);
  if (!coordinator) throw new Error("Could not capture the lifecycle coordinator identity.");
  const owner = {
    schemaVersion: 2,
    coordinator,
    delegations: [],
    descendants: [],
    guard: null,
    nonce: randomUUID(),
    operation,
    root: repositoryRuntimeRootIdentity(canonical),
    startedAt: new Date().toISOString(),
  };
  let descriptor;
  let lockCreated = false;
  try {
    const directory = openRuntimeDirectory(canonical, "Codex runtime lifecycle lock parent");
    try {
      testHooks?.beforeLifecycleLockCreate?.({ directory, owner });
      createExclusiveOwnedFile(
        directory,
        runtimeLifecycleLockName,
        serializeCanonicalJson(owner),
        "Codex runtime lifecycle lock",
      );
      lockCreated = true;
      const guardStats = createExclusiveOwnedFile(
        directory,
        runtimeLifecycleGuardName,
        `${owner.nonce}\n`,
        "Codex runtime lifecycle guard",
      );
      owner.guard = lifecycleGuardIdentity(guardStats);
    } finally {
      closeOwnedDirectoryBinding(directory);
    }
    replaceLifecycleOwner(canonical, owner.nonce, () => owner, { testHooks });
    descriptor = openRuntimeLifecycleGuard(canonical, owner.guard);
    const record = {
      descriptor,
      finalizedHandles: new Set(),
      handles: new Set(),
      kind: "coordinator",
      nonce: owner.nonce,
      operation,
      root: canonical,
    };
    lifecycleCapabilities.set(canonical, record);
    return capabilityHandle(record);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (lockCreated) {
      try {
        const failed = readRuntimeLifecycleLock(canonical);
        try {
          if (failed.owner?.nonce === owner.nonce) {
            unlinkStableRuntimeLifecycleLock(canonical, failed, { testHooks });
          }
        } finally {
          closeRuntimeFile(failed);
        }
      } catch {
        // Residual capability state remains fail-closed for explicit recovery.
      }
    }
    throw error;
  }
}

export function retainRuntimeLifecycleLock({ root = toolingRoot, owner, operation } = {}) {
  const record = capabilityRecord(root, owner);
  if (operation !== record.operation) {
    throw new Error("Runtime lifecycle reentrancy requires the same delegated operation.");
  }
  return capabilityHandle(record);
}

export function currentRuntimeLifecycleCapability({ root = toolingRoot, operation } = {}) {
  const canonical = realpathSync.native(root);
  const record = lifecycleCapabilities.get(canonical);
  if (!record || (operation && record.operation !== operation)) return null;
  return [...record.handles][0] ?? null;
}

export function runtimeLifecycleGuardDescriptor({ root = toolingRoot, owner } = {}) {
  return capabilityRecord(root, owner).descriptor;
}

/** Proves a coordinator has no pending or living child work before a mutation phase changes. */
export function assertRuntimeLifecycleQuiescent({ root = toolingRoot, owner } = {}) {
  const record = capabilityRecord(root, owner);
  if (record.kind !== "coordinator") {
    throw new Error("Only the lifecycle coordinator may assert repository mutation quiescence.");
  }
  assertCoordinatorQuiescent(record);
}

export function createRuntimeLifecycleDelegation({
  root = toolingRoot,
  owner,
  operation,
  role,
} = {}) {
  const record = capabilityRecord(root, owner);
  if (
    !runtimeLifecycleOperationPattern.test(operation) ||
    !runtimeLifecycleOperationPattern.test(role)
  ) {
    throw new Error("Invalid runtime lifecycle delegation.");
  }
  const delegation = {
    issuedAt: new Date().toISOString(),
    operation,
    role,
    token: randomUUID(),
  };
  replaceLifecycleOwner(record.root, record.nonce, (current) => {
    current.delegations.push(delegation);
    return current;
  });
  return Object.freeze({ ...delegation });
}

export function cancelRuntimeLifecycleDelegation({ root = toolingRoot, owner, token } = {}) {
  const record = capabilityRecord(root, owner);
  let removed = false;
  replaceLifecycleOwner(record.root, record.nonce, (current) => {
    const next = current.delegations.filter((entry) => entry.token !== token);
    removed = next.length !== current.delegations.length;
    current.delegations = next;
    return current;
  });
  return removed;
}

export function adoptRuntimeLifecycleDelegation({
  root = toolingRoot,
  operation,
  role,
  token,
} = {}) {
  const canonical = realpathSync.native(root);
  if (lifecycleCapabilities.has(canonical)) {
    throw new Error("This process already owns a runtime lifecycle capability for the repository.");
  }
  const identity = captureProcessIdentity(process.pid);
  if (!identity) throw new Error("Could not capture the delegated process identity.");
  let nonce;
  let guard;
  let descriptor;
  const current = readRuntimeLifecycleLock(canonical);
  try {
    const matches = current.owner?.delegations?.filter(
      (entry) => entry.token === token && entry.operation === operation && entry.role === role,
    );
    if (current.status === "absent" || current.status === "stale" || matches?.length !== 1) {
      throw new Error("Runtime lifecycle delegation is missing or does not match its owner.");
    }
    nonce = current.owner.nonce;
    guard = current.owner.guard;
  } finally {
    closeRuntimeFile(current);
  }
  descriptor = openRuntimeLifecycleGuard(canonical, guard);
  try {
    replaceLifecycleOwner(canonical, nonce, (owner) => {
      const matches = owner.delegations.filter(
        (entry) => entry.token === token && entry.operation === operation && entry.role === role,
      );
      if (matches.length !== 1) {
        throw new Error("Runtime lifecycle delegation changed before use.");
      }
      owner.delegations = owner.delegations.filter((entry) => entry.token !== token);
      const existing = owner.descendants.find(
        (entry) =>
          entry.identity.pid === identity.pid &&
          entry.identity.startIdentity === identity.startIdentity,
      );
      if (existing) {
        existing.registeredAt = new Date().toISOString();
        existing.role = role;
      } else {
        owner.descendants.push({ identity, registeredAt: new Date().toISOString(), role });
      }
      return owner;
    });
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
  const record = {
    descriptor,
    finalizedHandles: new Set(),
    handles: new Set(),
    identity,
    kind: "delegated",
    nonce,
    operation,
    root: canonical,
    role,
  };
  lifecycleCapabilities.set(canonical, record);
  return capabilityHandle(record);
}

export function registerRuntimeLifecycleDescendant({
  allowExisting = false,
  root = toolingRoot,
  owner,
  pid,
  role,
} = {}) {
  const record = capabilityRecord(root, owner);
  if (!runtimeLifecycleOperationPattern.test(role)) {
    throw new Error("Invalid runtime lifecycle descendant role.");
  }
  const identity = captureProcessIdentity(pid);
  if (!identity) return null;
  let registered = false;
  replaceLifecycleOwner(record.root, record.nonce, (current) => {
    const existing = current.descendants.some(
      (entry) =>
        entry.identity.pid === identity.pid &&
        entry.identity.startIdentity === identity.startIdentity,
    );
    if (existing && !allowExisting) {
      throw new Error("Runtime lifecycle descendant is already registered.");
    }
    if (existing) return current;
    current.descendants.push({ identity, registeredAt: new Date().toISOString(), role });
    registered = true;
    return current;
  });
  return registered ? Object.freeze({ identity, role }) : null;
}

export function unregisterRuntimeLifecycleDescendant({
  root = toolingRoot,
  owner,
  registration,
} = {}) {
  if (!registration) return false;
  const record = capabilityRecord(root, owner);
  let removed = false;
  replaceLifecycleOwner(record.root, record.nonce, (current) => {
    const next = current.descendants.filter(
      (entry) =>
        entry.identity.pid !== registration.identity.pid ||
        entry.identity.startIdentity !== registration.identity.startIdentity ||
        entry.role !== registration.role,
    );
    removed = next.length !== current.descendants.length;
    current.descendants = next;
    return current;
  });
  return removed;
}

export function releaseRuntimeLifecycleLock({
  root = toolingRoot,
  owner,
  finalize,
  testHooks,
} = {}) {
  const record = capabilityRecord(root, owner);
  if (record.handles.size > 1) {
    runLifecycleFinalizer(record, owner, finalize);
    record.handles.delete(owner);
    record.finalizedHandles.delete(owner);
    return;
  }
  if (record.kind === "coordinator") {
    assertCoordinatorQuiescent(record);
  }
  const current = readRuntimeLifecycleLock(record.root);
  try {
    if (current.status === "absent" || current.owner.nonce !== record.nonce) {
      throw new Error("Codex runtime lifecycle lock is owned by a different operation.");
    }
    if (record.kind === "coordinator") {
      runLifecycleFinalizer(record, owner, finalize);
      unlinkStableRuntimeLifecycleLock(record.root, current, { testHooks });
    } else {
      runLifecycleFinalizer(record, owner, finalize);
      const registration = { identity: record.identity, role: record.role };
      unregisterRuntimeLifecycleDescendant({ root: record.root, owner, registration });
    }
  } finally {
    closeRuntimeFile(current);
  }
  record.handles.delete(owner);
  record.finalizedHandles.delete(owner);
  closeSync(record.descriptor);
  lifecycleCapabilities.delete(record.root);
}

function withSessionManagementCapability(root, testHooks, operation) {
  const lifecycleOwner = acquireRuntimeLifecycleLock({
    root,
    operation: "session-management",
    testHooks,
  });
  try {
    return operation();
  } finally {
    releaseRuntimeLifecycleLock({ root, owner: lifecycleOwner, testHooks });
  }
}

export function clearStaleRuntimeSessionLease({
  root = toolingRoot,
  lifecycleCapability,
  testHooks,
} = {}) {
  if (lifecycleCapability) {
    assertRuntimeLifecycleQuiescent({ root, owner: lifecycleCapability });
    return clearStaleRuntimeSessionLeaseState({ root, testHooks });
  }
  return withSessionManagementCapability(root, testHooks, () =>
    clearStaleRuntimeSessionLeaseState({ root, testHooks }),
  );
}

export function issueRuntimeSessionLease({ root = toolingRoot, pid, testHooks } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("Codex runtime session lease requires a positive process id.");
  }
  return withSessionManagementCapability(root, testHooks, () =>
    issueRuntimeSessionLeaseState({
      root,
      pid,
      testHooks,
    }),
  );
}
/** Atomically reserves the repository while the native resume picker selects a thread. */
export function reserveRuntimeSessionLease({ root = toolingRoot, pid, testHooks } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("Codex runtime session reservation requires a positive process id.");
  }
  return withSessionManagementCapability(root, testHooks, () =>
    reserveRuntimeSessionLeaseState({ root, pid, testHooks }),
  );
}
export function activateRuntimeSessionLease({
  root = toolingRoot,
  pid,
  runtimeSessionId,
  codexSessionId,
  testHooks,
} = {}) {
  return withSessionManagementCapability(root, testHooks, () =>
    activateRuntimeSessionLeaseState({
      root,
      pid,
      runtimeSessionId,
      codexSessionId,
      testHooks,
    }),
  );
}
export function transitionRuntimeSessionWriterProcess({
  root = toolingRoot,
  pid,
  runtimeSessionId,
  transition,
  writerPid,
  testHooks,
} = {}) {
  return withSessionManagementCapability(root, testHooks, () =>
    transitionRuntimeSessionWriterProcessState({
      root,
      pid,
      runtimeSessionId,
      transition,
      writerPid,
      testHooks,
    }),
  );
}
export function releaseRuntimeSessionLease({ root = toolingRoot, pid, testHooks } = {}) {
  return withSessionManagementCapability(root, testHooks, () =>
    releaseRuntimeSessionLeaseState({ root, pid, testHooks }),
  );
}
