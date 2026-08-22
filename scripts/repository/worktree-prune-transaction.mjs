/** Owns the crash-recoverable transaction around native Git worktree pruning. */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  closeOwnedDirectoryBinding,
  createExclusiveOwnedFile,
  openOwnedDirectoryBinding,
  ownedDirectoryChildPath,
  readStableOwnedFile,
  removeStableOwnedFile,
} from "../filesystem/owned-path-safety.mjs";
import { captureProcessIdentity, inspectProcessIdentity } from "./runtime-process-identity.mjs";
import {
  clearStaleWorktreePathReservation,
  reserveMissingWorktreePaths,
} from "./worktree-path-reservation.mjs";
import {
  createWorktreePreservationLockReason,
  inspectWorktreePreservationLock,
} from "./worktree-preservation-lock.mjs";

const transactionFileName = "codexrig-worktree-prune-transaction.json";
const transactionKind = "codexrig-worktree-prune-transaction";
const transactionMaximumBytes = 128_000;
const transactionSchemaVersion = 1;
const tokenPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

function validIsoInstant(value) {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function validCandidate(candidate) {
  return (
    typeof candidate === "string" &&
    path.isAbsolute(candidate) &&
    path.resolve(candidate) === candidate &&
    candidate !== path.parse(candidate).root
  );
}

function sameProcessIdentity(left, right) {
  return left?.pid === right?.pid && left?.startIdentity === right?.startIdentity;
}

function openTransactionDirectory(commonGitDirectory) {
  if (
    typeof commonGitDirectory !== "string" ||
    !path.isAbsolute(commonGitDirectory) ||
    path.resolve(commonGitDirectory) !== commonGitDirectory
  ) {
    throw new Error("Worktree prune transaction requires a canonical Git common directory.");
  }
  return openOwnedDirectoryBinding(
    commonGitDirectory,
    commonGitDirectory,
    "worktree prune transaction directory",
  );
}

function validTransactionStats(stats, contentBytes) {
  return (
    stats.isFile() &&
    !stats.isSymbolicLink() &&
    stats.nlink === 1 &&
    stats.size === contentBytes &&
    (stats.mode & 0o777) === 0o400 &&
    (typeof process.getuid !== "function" || stats.uid === process.getuid())
  );
}

function exactTransaction(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !==
      "createdAt\nkind\nowner\npaths\npreservationReason\nschemaVersion\ntoken" ||
    value.schemaVersion !== transactionSchemaVersion ||
    value.kind !== transactionKind ||
    !validIsoInstant(value.createdAt) ||
    typeof value.token !== "string" ||
    !tokenPattern.test(value.token) ||
    !Array.isArray(value.paths) ||
    value.paths.length === 0 ||
    new Set(value.paths).size !== value.paths.length ||
    value.paths.some((candidate) => !validCandidate(candidate))
  ) {
    return null;
  }
  const preservation = inspectWorktreePreservationLock(value.preservationReason);
  if (!preservation || !sameProcessIdentity(preservation.owner, value.owner)) return null;
  let ownerStatus;
  try {
    ownerStatus = inspectProcessIdentity(value.owner);
  } catch {
    return null;
  }
  const record = Object.freeze({
    ...value,
    owner: Object.freeze({ ...value.owner }),
    paths: Object.freeze([...value.paths]),
  });
  return Object.freeze({ ownerStatus, record });
}

function readTransaction(binding) {
  const target = ownedDirectoryChildPath(
    binding,
    transactionFileName,
    "worktree prune transaction",
  );
  if (!existsSync(target)) return null;
  const snapshot = readStableOwnedFile(binding, transactionFileName, "worktree prune transaction", {
    maximumBytes: transactionMaximumBytes,
  });
  if (!validTransactionStats(snapshot.stats, snapshot.buffer.length)) return false;
  let value;
  try {
    value = JSON.parse(snapshot.buffer.toString("utf8"));
  } catch {
    return false;
  }
  const exact = exactTransaction(value);
  return exact ? Object.freeze({ ...exact, snapshot }) : false;
}

/** Reports only the one current shared prune-transaction contract. */
export function inspectWorktreePruneTransaction(commonGitDirectory) {
  let binding;
  try {
    binding = openTransactionDirectory(commonGitDirectory);
    const current = readTransaction(binding);
    if (current === null) return Object.freeze({ status: "absent" });
    if (current === false) return Object.freeze({ status: "unrecognized" });
    return Object.freeze({ status: current.ownerStatus, transaction: current.record });
  } catch {
    return Object.freeze({ status: "unrecognized" });
  } finally {
    if (binding) closeOwnedDirectoryBinding(binding);
  }
}

/** Exclusively records every path that a native prune transaction may make undiscoverable. */
export function beginWorktreePruneTransaction(
  commonGitDirectory,
  paths,
  owner,
  preservationReason,
) {
  const record = {
    schemaVersion: transactionSchemaVersion,
    kind: transactionKind,
    owner,
    paths,
    preservationReason,
    createdAt: new Date().toISOString(),
    token: randomUUID(),
  };
  const content = `${JSON.stringify(record, null, 2)}\n`;
  if (Buffer.byteLength(content) > transactionMaximumBytes) {
    throw new Error("Worktree prune transaction exceeds its bounded size.");
  }
  const binding = openTransactionDirectory(commonGitDirectory);
  let created;
  try {
    created = createExclusiveOwnedFile(
      binding,
      transactionFileName,
      content,
      "worktree prune transaction",
      0o400,
    );
    const current = readTransaction(binding);
    if (!current || current === false || current.record.token !== record.token) {
      throw new Error("Worktree prune transaction changed during acquisition.");
    }
    let released = false;
    return Object.freeze({
      record: current.record,
      release() {
        if (released) throw new Error("Worktree prune transaction was already released.");
        const latest = readTransaction(binding);
        if (
          !latest ||
          latest === false ||
          latest.record.token !== record.token ||
          latest.snapshot.stats.dev !== created.dev ||
          latest.snapshot.stats.ino !== created.ino
        ) {
          throw new Error("Worktree prune transaction changed before release.");
        }
        removeStableOwnedFile(
          binding,
          transactionFileName,
          latest.snapshot.stats,
          "worktree prune transaction",
        );
        closeOwnedDirectoryBinding(binding);
        released = true;
      },
    });
  } catch (error) {
    try {
      if (created) {
        removeStableOwnedFile(
          binding,
          transactionFileName,
          created,
          "incomplete worktree prune transaction",
        );
      }
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Worktree prune transaction acquisition failed and preserved changed state.",
      );
    } finally {
      closeOwnedDirectoryBinding(binding);
    }
    throw error;
  }
}

function clearStaleTransaction(commonGitDirectory, expectedToken, { testHooks } = {}) {
  const binding = openTransactionDirectory(commonGitDirectory);
  try {
    const current = readTransaction(binding);
    if (current === null) return "absent";
    if (current === false || current.record.token !== expectedToken) return "unrecognized";
    if (current.ownerStatus !== "stale") return current.ownerStatus;
    testHooks?.beforeStaleWorktreePruneTransactionRemove?.({ current });
    removeStableOwnedFile(
      binding,
      transactionFileName,
      current.snapshot.stats,
      "stale worktree prune transaction",
    );
    return "removed";
  } finally {
    closeOwnedDirectoryBinding(binding);
  }
}

function protectNonMissingWorktrees(metadata, inventory, locks, reason, runGit) {
  for (const worktree of inventory.worktrees) {
    if (worktree.current || worktree.directoryStatus === "missing" || worktree.locked) continue;
    runGit(metadata, ["worktree", "lock", "--reason", reason, worktree.path]);
    locks.push({ path: worktree.path, reason });
  }
}

/** Reconciles only stale exact artifacts and keeps live/unknown transactions as blockers. */
export function reconcileWorktreePruneArtifacts({
  commonGitDirectory,
  inspectInventory,
  inventory,
  metadata,
  runGit,
  testHooks,
}) {
  const blockingFindings = [];
  const transaction = inspectWorktreePruneTransaction(commonGitDirectory);
  if (["active", "unknown", "unrecognized"].includes(transaction.status)) {
    blockingFindings.push(
      `shared worktree prune transaction is ${transaction.status} and blocks native prune`,
    );
  } else if (transaction.status === "stale") {
    for (const candidate of transaction.transaction.paths) {
      const status = clearStaleWorktreePathReservation(candidate, { testHooks });
      if (!["absent", "removed"].includes(status)) {
        blockingFindings.push(
          `stale worktree prune reservation at ${JSON.stringify(candidate)} is ${status}`,
        );
      }
    }
    inventory = inspectInventory();
    for (const worktree of inventory.worktrees) {
      if (worktree.lockReason !== transaction.transaction.preservationReason) continue;
      testHooks?.beforeStaleWorktreePreservationUnlock?.({ worktree });
      runGit(metadata, ["worktree", "unlock", worktree.path]);
    }
    inventory = inspectInventory();
    if (
      inventory.worktrees.some(
        (worktree) => worktree.lockReason === transaction.transaction.preservationReason,
      )
    ) {
      blockingFindings.push("stale worktree prune preservation locks remain");
    }
    if (blockingFindings.length === 0) {
      const status = clearStaleTransaction(commonGitDirectory, transaction.transaction.token, {
        testHooks,
      });
      if (status !== "removed" && status !== "absent") {
        blockingFindings.push(`stale worktree prune transaction is ${status}`);
      }
    }
  }

  inventory = inspectInventory();
  for (const worktree of inventory.worktrees) {
    const preservation = inspectWorktreePreservationLock(worktree.lockReason);
    if (!worktree.locked || preservation?.status !== "stale") continue;
    testHooks?.beforeStaleWorktreePreservationUnlock?.({ worktree });
    runGit(metadata, ["worktree", "unlock", worktree.path]);
  }
  inventory = inspectInventory();
  for (const worktree of inventory.worktrees) {
    if (!worktree.prunable || worktree.directoryStatus !== "unsafe") continue;
    clearStaleWorktreePathReservation(worktree.path, { testHooks });
  }
  return Object.freeze({
    blockingFindings: Object.freeze(blockingFindings),
    inventory: inspectInventory(),
  });
}

/** Runs native prune behind exact locks, reservations, and a shared crash-recovery journal. */
export function pruneMissingWorktreeRegistrations({
  commonGitDirectory,
  inspectInventory,
  inventory,
  metadata,
  runGit,
  testHooks,
}) {
  const preservationLocks = [];
  const owner = captureProcessIdentity(process.pid);
  if (!owner) throw new Error("Worktree prune transaction could not bind its owner process.");
  const preservationReason = createWorktreePreservationLockReason({ owner });
  let transaction = null;
  let reserved = null;
  let failure = null;
  let cleanupFailure = null;
  let changedPaths = [];
  const blockingFindings = [];
  try {
    if (
      inventory.complete &&
      inventory.worktrees.some(
        (worktree) => worktree.prunable && worktree.directoryStatus === "missing",
      )
    ) {
      protectNonMissingWorktrees(
        metadata,
        inventory,
        preservationLocks,
        preservationReason,
        runGit,
      );
      inventory = inspectInventory();
      protectNonMissingWorktrees(
        metadata,
        inventory,
        preservationLocks,
        preservationReason,
        runGit,
      );
      inventory = inspectInventory();
      const missingPaths = inventory.worktrees
        .filter((worktree) => worktree.prunable && worktree.directoryStatus === "missing")
        .map((worktree) => worktree.path);
      if (missingPaths.length > 0) {
        transaction = beginWorktreePruneTransaction(
          commonGitDirectory,
          missingPaths,
          owner,
          preservationReason,
        );
        reserved = reserveMissingWorktreePaths(missingPaths);
        testHooks?.beforeMissingWorktreePrune?.({ inventory, reservations: reserved.reservations });
        if (
          reserved.complete &&
          reserved.reservations.length === missingPaths.length &&
          reserved.intact()
        ) {
          runGit(metadata, ["worktree", "prune", "--expire=now"]);
        }
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    try {
      changedPaths = reserved?.release() ?? [];
    } catch (error) {
      cleanupFailure ??= error;
    }
    for (const lock of preservationLocks.reverse()) {
      try {
        const owned = inspectInventory().worktrees.some(
          (worktree) => worktree.path === lock.path && worktree.lockReason === lock.reason,
        );
        if (!owned) throw new Error("Repository worktree preservation lock ownership changed.");
        runGit(metadata, ["worktree", "unlock", lock.path]);
      } catch (error) {
        cleanupFailure ??= error;
      }
    }
    if (transaction && cleanupFailure === null) {
      const visiblePaths = new Set(inspectInventory().worktrees.map((worktree) => worktree.path));
      const undiscoverable = changedPaths.filter((candidate) => !visiblePaths.has(candidate));
      if (undiscoverable.length > 0) {
        blockingFindings.push(
          "a changed reservation outlived its pruned Git registration; the shared transaction remains for recovery",
        );
      } else {
        try {
          transaction.release();
        } catch (error) {
          cleanupFailure ??= error;
        }
      }
    }
  }
  if (cleanupFailure) failure ??= cleanupFailure;
  if (failure) throw failure;
  return Object.freeze({
    blockingFindings: Object.freeze(blockingFindings),
    inventory: inspectInventory(),
  });
}
