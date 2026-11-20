/** Owns artifact identity checks and stable descriptor-bound file snapshots. */
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";

function artifactType(stats) {
  if (stats.isDirectory()) return "directory";
  if (stats.isFile()) return "file";
  return "other";
}

export function readStableFileSnapshot(target, label, maximumBytes) {
  const initial = safeArtifactStats(target, "file", label);
  if (maximumBytes !== undefined && initial.size > maximumBytes) {
    throw new Error(`Repository path safety refused oversized ${label}.`);
  }
  const descriptor = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor);
    if (!sameStableIdentity(initial, opened)) {
      throw new Error(`Repository path safety detected an identity change in ${label}.`);
    }
    const buffer = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (!sameStableIdentity(opened, after) || buffer.length !== after.size) {
      throw new Error(`Repository path safety detected a content change in ${label}.`);
    }
    return { buffer, stats: after };
  } finally {
    closeSync(descriptor);
  }
}

export function sameObjectIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    artifactType(left) === artifactType(right)
  );
}

export function sameStableIdentity(left, right) {
  return (
    sameObjectIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

export function safeArtifactStats(artifactPath, expectedType, label) {
  const stats = lstatSync(artifactPath);
  if (expectedType === "symlink") {
    if (!stats.isSymbolicLink()) {
      throw new Error(`Owned path safety refused malformed ${label}.`);
    }
    return stats;
  }
  const type = artifactType(stats);
  if (stats.isSymbolicLink() || type !== expectedType) {
    throw new Error(`Owned path safety refused malformed ${label}.`);
  }
  if (type === "file" && stats.nlink !== 1) {
    throw new Error(`Owned path safety refused hardlinked ${label}.`);
  }
  return stats;
}
