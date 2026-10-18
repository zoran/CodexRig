/** Owns platform configuration state behavior for the Git provider integration boundary. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { resolveRepositoryPath, serializeCanonicalJson } from "../filesystem/repository-files.mjs";
import {
  atomicWriteOwnedFile,
  ensureOwnedDirectoryChain,
  readOptionalOwnedFile,
  removeOwnedRegularFile,
} from "../filesystem/owned-file-operations.mjs";
import {
  closeOwnedDirectoryBinding,
  createExclusiveOwnedFile,
  openOwnedDirectoryBinding,
  sameStableIdentity,
} from "../filesystem/owned-path-safety.mjs";
import { withRuntimeLifecycleUpdateMutex } from "../repository/runtime-lifecycle-mutex.mjs";
import { ensureRuntimeDirectory } from "../repository/runtime-owned-state.mjs";
import {
  captureProcessIdentity,
  inspectProcessIdentity,
} from "../repository/runtime-process-identity.mjs";

const stateRelativePath = ".project-state/platform-configuration.json";
const lockRelativePath = ".project-state/platform-configuration.lock";
const maximumStateBytes = 64 * 1024;
const maximumLockBytes = 4 * 1024;

function stateDigest(plan) {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

function statePath(root) {
  ensureOwnedDirectoryChain(root, ".project-state", "platform configuration state", {
    createdMode: 0o700,
  });
  return resolveRepositoryPath(root, stateRelativePath);
}

function lockPath(root) {
  statePath(root);
  return resolveRepositoryPath(root, lockRelativePath);
}

function readLockSnapshot(root) {
  const target = resolveRepositoryPath(root, lockRelativePath);
  const snapshot = readOptionalOwnedFile(root, target, "platform configuration lock", {
    maximumBytes: maximumLockBytes,
  });
  if (!snapshot.exists) return snapshot;
  if (
    (snapshot.stats.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && snapshot.stats.uid !== process.getuid())
  ) {
    throw new Error("Platform configuration lock is unsafe.");
  }
  return snapshot;
}

/** Only the current schema has owner semantics; all other lock bytes remain opaque. */
function currentLockOwner(snapshot) {
  let owner;
  try {
    owner = JSON.parse(snapshot.buffer.toString("utf8"));
  } catch {
    return null;
  }
  if (
    owner?.schemaVersion !== 2 ||
    Object.keys(owner).sort().join(",") !== "identity,schemaVersion,token" ||
    typeof owner.token !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(owner.token)
  ) {
    return null;
  }
  try {
    return { owner, processStatus: inspectProcessIdentity(owner.identity) };
  } catch {
    return null;
  }
}

function readLock(root) {
  const snapshot = readLockSnapshot(root);
  if (!snapshot.exists) throw new Error("Platform configuration lock is missing.");
  const current = currentLockOwner(snapshot);
  if (!current) throw new Error("Platform configuration lock is invalid.");
  return { ...current, stats: snapshot.stats };
}

function processIsAlive(identity) {
  const status = inspectProcessIdentity(identity);
  if (status === "unknown")
    throw new Error("Platform configuration lock owner cannot be verified.");
  return status === "active";
}

function acquireLock(root) {
  const target = lockPath(root);
  if (existsSync(target)) {
    const current = readLock(root);
    if (processIsAlive(current.owner.identity)) {
      throw new Error("Another platform configuration is active.");
    }
    removeOwnedRegularFile(root, target, "stale platform configuration lock", {
      expectedIdentity: current.stats,
    });
  }
  const identity = captureProcessIdentity(process.pid);
  if (!identity) throw new Error("Could not capture the platform configuration owner identity.");
  const owner = Object.freeze({ schemaVersion: 2, identity, token: randomUUID() });
  const parent = openOwnedDirectoryBinding(root, path.dirname(target), "platform lock parent");
  try {
    const stats = createExclusiveOwnedFile(
      parent,
      path.basename(target),
      serializeCanonicalJson(owner),
      "platform configuration lock",
    );
    return Object.freeze({ owner, stats });
  } finally {
    closeOwnedDirectoryBinding(parent);
  }
}

function assertLockOwner(root, expected) {
  const current = readLock(root);
  if (
    !sameStableIdentity(current.stats, expected.stats) ||
    serializeCanonicalJson(current.owner) !== serializeCanonicalJson(expected.owner)
  ) {
    throw new Error("Platform configuration lock ownership changed.");
  }
  return current;
}

function releaseLock(root, owner) {
  if (!owner) return;
  const current = assertLockOwner(root, owner);
  removeOwnedRegularFile(root, lockPath(root), "platform configuration lock", {
    expectedIdentity: current.stats,
  });
}

function withPlatformMutation(root, action) {
  ensureRuntimeDirectory(root);
  return withRuntimeLifecycleUpdateMutex(root, action);
}

function lockRecoveryFingerprint(root, snapshot) {
  const { dev, ino, mode, nlink, uid, gid, size, mtimeMs, ctimeMs } = snapshot.stats;
  return createHash("sha256")
    .update(
      serializeCanonicalJson({
        root: path.resolve(root),
        path: lockRelativePath,
        content: createHash("sha256").update(snapshot.buffer).digest("hex"),
        identity: { dev, ino, mode, nlink, uid, gid, size, mtimeMs, ctimeMs },
      }),
    )
    .digest("hex");
}

/** Retires one reviewed lock only; the provider reconciliation journal is never changed here. */
export function recoverPlatformConfigurationLock(
  root,
  { apply = false, confirmQuiescent = false, expectedFingerprint } = {},
) {
  if (!apply) {
    if (confirmQuiescent || expectedFingerprint !== undefined)
      throw new Error("Lock recovery attestation and fingerprint require explicit --apply.");
    const snapshot = readLockSnapshot(root);
    return {
      applied: false,
      lockPresent: snapshot.exists,
      fingerprint: snapshot.exists ? lockRecoveryFingerprint(root, snapshot) : null,
      ownerStatus: snapshot.exists
        ? (currentLockOwner(snapshot)?.processStatus ?? "unknown")
        : "absent",
    };
  }
  if (confirmQuiescent !== true)
    throw new Error(
      "Lock recovery requires explicit confirmation that all platform writers are quiescent.",
    );
  if (!/^[a-f0-9]{64}$/u.test(expectedFingerprint ?? ""))
    throw new Error("Lock recovery requires the reviewed expected lock fingerprint.");
  return withPlatformMutation(root, () => {
    const snapshot = readLockSnapshot(root);
    if (!snapshot.exists || lockRecoveryFingerprint(root, snapshot) !== expectedFingerprint)
      throw new Error("Platform configuration lock changed after recovery review.");
    if (currentLockOwner(snapshot)?.processStatus === "active")
      throw new Error("Lock recovery refused a live platform configuration owner.");
    removeOwnedRegularFile(root, snapshot.path, "reviewed platform configuration lock", {
      expectedIdentity: snapshot.stats,
    });
    return { applied: true, lockPresent: false, fingerprint: expectedFingerprint };
  });
}

function validateState(value, digest, plan) {
  if (
    value?.schemaVersion !== 1 ||
    value.digest !== digest ||
    value.provider !== plan.provider ||
    value.repository !== plan.repository ||
    !Number.isSafeInteger(value.startedAt) ||
    value.startedAt < 0 ||
    !Array.isArray(value.completed) ||
    value.completed.length > 20 ||
    value.completed.some(
      (entry, index) =>
        typeof entry !== "string" ||
        !entry ||
        entry.length > 128 ||
        /[\0\r\n]/u.test(entry) ||
        value.completed.indexOf(entry) !== index,
    )
  ) {
    throw new Error("Platform configuration recovery state is invalid.");
  }
  return value;
}

function readState(root, digest, plan) {
  const target = statePath(root);
  const snapshot = readOptionalOwnedFile(root, target, "platform configuration recovery state", {
    maximumBytes: maximumStateBytes,
  });
  if (!snapshot.exists) {
    throw new Error("Platform configuration recovery state is unsafe.");
  }
  try {
    return {
      value: validateState(JSON.parse(snapshot.buffer.toString("utf8")), digest, plan),
      stats: snapshot.stats,
    };
  } catch (error) {
    if (/recovery state/u.test(error.message)) throw error;
    throw new Error("Platform configuration recovery state is invalid.");
  }
}

function atomicWriteState(root, value) {
  atomicWriteOwnedFile(root, statePath(root), serializeCanonicalJson(value), 0o600, {
    label: "platform configuration recovery state",
  });
}

export function platformConfigurationState(root, plan) {
  const digest = stateDigest(plan);
  let owner = null;
  return {
    acquire() {
      if (owner) throw new Error("Platform configuration lock is already active.");
      owner = withPlatformMutation(root, () => acquireLock(root));
    },
    begin() {
      if (!owner) throw new Error("Platform configuration inventory requires its owned lock.");
      return withPlatformMutation(root, () => {
        assertLockOwner(root, owner);
        try {
          const target = statePath(root);
          if (existsSync(target)) {
            const { value } = readState(root, digest, plan);
            return { resumed: true, completed: [...value.completed] };
          }
          atomicWriteState(root, {
            schemaVersion: 1,
            digest,
            provider: plan.provider,
            repository: plan.repository,
            startedAt: Date.now(),
            completed: [],
          });
          return { resumed: false, completed: [] };
        } catch (error) {
          releaseLock(root, owner);
          owner = null;
          throw error;
        }
      });
    },
    record(operation) {
      if (!owner) throw new Error("Platform configuration state is not active.");
      withPlatformMutation(root, () => {
        assertLockOwner(root, owner);
        const { value } = readState(root, digest, plan);
        if (!value.completed.includes(operation)) value.completed.push(operation);
        atomicWriteState(root, value);
      });
    },
    complete() {
      if (!owner) throw new Error("Platform configuration state is not active.");
      withPlatformMutation(root, () => {
        assertLockOwner(root, owner);
        const current = readState(root, digest, plan);
        removeOwnedRegularFile(root, statePath(root), "platform configuration recovery state", {
          expectedIdentity: current.stats,
        });
        releaseLock(root, owner);
        owner = null;
      });
    },
    release() {
      if (!owner) return;
      withPlatformMutation(root, () => {
        releaseLock(root, owner);
        owner = null;
      });
    },
  };
}
