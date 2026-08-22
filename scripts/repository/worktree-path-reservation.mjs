/** Owns exclusive filesystem reservations that hold a missing Git worktree path during cleanup. */
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  closeOwnedDirectoryBinding,
  createExclusiveOwnedFile,
  openOwnedDirectoryBinding,
  ownedDirectoryChildPath,
  readStableOwnedFile,
  removeStableOwnedFile,
  validateOwnedDirectoryBinding,
} from "../filesystem/owned-path-safety.mjs";
import { captureProcessIdentity, inspectProcessIdentity } from "./runtime-process-identity.mjs";

const reservationConflictCodes = new Set([
  "EACCES",
  "EEXIST",
  "ENOENT",
  "ENOTDIR",
  "EPERM",
  "EROFS",
]);
const reservationKind = "codexrig-worktree-path-reservation";
const reservationMaximumBytes = 4_096;
const reservationSchemaVersion = 1;
const ownerTokenPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

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

function openReservationParent(candidate) {
  const parent = path.dirname(candidate);
  const parentStats = lstatSync(parent);
  if (
    parentStats.isSymbolicLink() ||
    !parentStats.isDirectory() ||
    realpathSync.native(parent) !== parent
  ) {
    throw new Error("Worktree path reservation rejected an unsafe parent directory.");
  }
  return openOwnedDirectoryBinding(parent, parent, "worktree path reservation parent");
}

function exactReservation(value, candidate) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !== "createdAt\nkind\nowner\npath\nschemaVersion\ntoken" ||
    value.schemaVersion !== reservationSchemaVersion ||
    value.kind !== reservationKind ||
    value.path !== candidate ||
    !validIsoInstant(value.createdAt) ||
    typeof value.token !== "string" ||
    !ownerTokenPattern.test(value.token)
  ) {
    return null;
  }
  let ownerStatus;
  try {
    ownerStatus = inspectProcessIdentity(value.owner);
  } catch {
    return null;
  }
  return Object.freeze({ ownerStatus, record: Object.freeze(value) });
}

function validReservationStats(stats, contentBytes) {
  return (
    stats.isFile() &&
    !stats.isSymbolicLink() &&
    stats.nlink === 1 &&
    stats.size === contentBytes &&
    (stats.mode & 0o777) === 0o400 &&
    (typeof process.getuid !== "function" || stats.uid === process.getuid())
  );
}

function readReservation(binding, candidate) {
  const snapshot = readStableOwnedFile(
    binding,
    path.basename(candidate),
    "worktree path reservation",
    { maximumBytes: reservationMaximumBytes },
  );
  if (!validReservationStats(snapshot.stats, snapshot.buffer.length)) return null;
  let value;
  try {
    value = JSON.parse(snapshot.buffer.toString("utf8"));
  } catch {
    return null;
  }
  const exact = exactReservation(value, candidate);
  return exact ? Object.freeze({ ...exact, snapshot }) : null;
}

function reservationIsIntact(reservation) {
  validateOwnedDirectoryBinding(reservation.binding, "worktree path reservation parent");
  let current;
  try {
    current = readReservation(reservation.binding, reservation.path);
  } catch {
    return false;
  }
  return (
    current !== null &&
    current.record.token === reservation.token &&
    current.snapshot.stats.dev === reservation.stats.dev &&
    current.snapshot.stats.ino === reservation.stats.ino
  );
}

/** Reports only the current self-identifying reservation contract; arbitrary path content is opaque. */
export function inspectWorktreePathReservation(candidate) {
  if (!validCandidate(candidate)) {
    throw new Error("Worktree path reservation inspection requires a canonical absolute path.");
  }
  let binding;
  try {
    binding = openReservationParent(candidate);
    const target = ownedDirectoryChildPath(
      binding,
      path.basename(candidate),
      "worktree path reservation",
    );
    if (!existsSync(target)) return Object.freeze({ status: "absent" });
    const current = readReservation(binding, candidate);
    return current
      ? Object.freeze({ owner: current.record.owner, status: current.ownerStatus })
      : Object.freeze({ status: "unrecognized" });
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error?.code)) {
      return Object.freeze({ status: "absent" });
    }
    return Object.freeze({ status: "unrecognized" });
  } finally {
    if (binding) closeOwnedDirectoryBinding(binding);
  }
}

/** Removes only an unchanged current-contract reservation whose exact owner is proven stale. */
export function clearStaleWorktreePathReservation(candidate, { testHooks } = {}) {
  if (!validCandidate(candidate)) {
    throw new Error("Worktree path reservation cleanup requires a canonical absolute path.");
  }
  let binding;
  try {
    try {
      binding = openReservationParent(candidate);
    } catch (error) {
      return ["ENOENT", "ENOTDIR"].includes(error?.code) ? "absent" : "unrecognized";
    }
    const target = ownedDirectoryChildPath(
      binding,
      path.basename(candidate),
      "worktree path reservation",
    );
    if (!existsSync(target)) return "absent";
    let current;
    try {
      current = readReservation(binding, candidate);
    } catch {
      return "unrecognized";
    }
    if (!current) return "unrecognized";
    if (current.ownerStatus !== "stale") return current.ownerStatus;
    testHooks?.beforeStaleWorktreeReservationRemove?.({ candidate, current });
    removeStableOwnedFile(
      binding,
      path.basename(candidate),
      current.snapshot.stats,
      "stale worktree path reservation",
    );
    return "removed";
  } finally {
    if (binding) closeOwnedDirectoryBinding(binding);
  }
}

/** Atomically replaces each still-missing directory path with a recoverable read-only file. */
export function reserveMissingWorktreePaths(paths) {
  if (
    !Array.isArray(paths) ||
    new Set(paths).size !== paths.length ||
    paths.some((candidate) => !validCandidate(candidate))
  ) {
    throw new Error("Worktree path reservation requires unique canonical absolute paths.");
  }
  const owner = captureProcessIdentity(process.pid);
  if (!owner) throw new Error("Worktree path reservation could not bind its owner process.");
  const reservations = [];
  let complete = true;
  for (const candidate of paths) {
    let binding;
    let createdStats;
    let basename;
    try {
      binding = openReservationParent(candidate);
      basename = path.basename(candidate);
      const token = randomUUID();
      const content = `${JSON.stringify(
        {
          schemaVersion: reservationSchemaVersion,
          kind: reservationKind,
          owner,
          path: candidate,
          createdAt: new Date().toISOString(),
          token,
        },
        null,
        2,
      )}\n`;
      if (Buffer.byteLength(content) > reservationMaximumBytes) {
        complete = false;
        break;
      }
      createdStats = createExclusiveOwnedFile(
        binding,
        basename,
        content,
        "worktree path reservation",
        0o400,
      );
      if (!validReservationStats(createdStats, Buffer.byteLength(content)))
        throw new Error("Worktree reservation is not a safe file.");
      const stable = readReservation(binding, candidate);
      if (!stable || stable.record.token !== token) {
        throw new Error("Worktree reservation changed during acquisition.");
      }
      reservations.push(
        Object.freeze({
          basename,
          binding,
          path: candidate,
          stats: stable.snapshot.stats,
          token,
        }),
      );
      binding = null;
    } catch (error) {
      if (createdStats && binding) {
        try {
          removeStableOwnedFile(
            binding,
            basename,
            createdStats,
            "incomplete worktree path reservation",
          );
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Worktree path reservation acquisition failed and preserved changed state.",
          );
        }
      }
      if (!reservationConflictCodes.has(error?.code)) throw error;
      complete = false;
      break;
    } finally {
      if (binding) closeOwnedDirectoryBinding(binding);
    }
  }
  return Object.freeze({
    complete,
    reservations: Object.freeze(reservations),
    /** Proves every exclusive reservation still owns its path at the mutation boundary. */
    intact() {
      return reservations.every(reservationIsIntact);
    },
    /** Releases only unchanged reservation files and preserves paths whose ownership changed. */
    release() {
      const changedPaths = [];
      let failure = null;
      for (const reservation of [...reservations].reverse()) {
        try {
          if (reservationIsIntact(reservation)) {
            removeStableOwnedFile(
              reservation.binding,
              reservation.basename,
              reservation.stats,
              "worktree path reservation",
            );
          } else changedPaths.push(reservation.path);
        } catch (error) {
          failure ??= error;
        } finally {
          try {
            closeOwnedDirectoryBinding(reservation.binding);
          } catch (error) {
            failure ??= error;
          }
        }
      }
      if (failure) throw failure;
      return Object.freeze(changedPaths.reverse());
    },
  });
}
