/** Owns repository-root-bound regular-file and directory mutations for framework tooling. */
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
} from "node:fs";
import path from "node:path";
import {
  atomicReplaceOwnedFile,
  claimAndRemove,
  closeOwnedDirectoryBinding,
  openOwnedDirectoryBinding,
  ownedDirectoryChildPath,
  readStableOwnedFile,
  removeStableOwnedFile,
  safeArtifactStats,
  sameObjectIdentity,
  validateOwnedDirectoryBinding,
} from "./owned-path-safety.mjs";

function ownedRoot(rootPath, label) {
  const requested = path.resolve(rootPath);
  const stats = lstatSync(requested);
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    realpathSync.native(requested) !== requested
  ) {
    throw new Error(`Owned file operations require a real owned root for ${label}.`);
  }
  return requested;
}

function relativeOwnedPath(root, targetPath, label) {
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Owned file operations refused ${label} outside its owned root.`);
  }
  return relative;
}

function normalizedRelativeDirectory(value, label) {
  const normalized = String(value ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "");
  if (normalized === "." || normalized === "") return ".";
  if (
    normalized.startsWith("/") ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Owned file operations refused an invalid directory for ${label}.`);
  }
  return normalized;
}

/** Creates missing repository-owned directory segments through held parent descriptors. */
export function ensureOwnedDirectoryChain(
  rootPath,
  relativeDirectory,
  label,
  { createdMode = 0o700, testHooks } = {},
) {
  const root = ownedRoot(rootPath, label);
  const normalized = normalizedRelativeDirectory(relativeDirectory, label);
  if (normalized === ".") return root;
  let logicalDirectory = root;
  for (const segment of normalized.split("/")) {
    const parent = openOwnedDirectoryBinding(root, logicalDirectory, `${label} parent`);
    try {
      const child = ownedDirectoryChildPath(parent, segment, label);
      if (!existsSync(child)) {
        testHooks?.beforeDirectoryCreate?.({ label, parent, segment });
        validateOwnedDirectoryBinding(parent, `${label} parent`);
        mkdirSync(child, { mode: createdMode });
        fsyncSync(parent.descriptor);
      }
      const stats = safeArtifactStats(child, "directory", label);
      if (stats.dev !== parent.stats.dev) {
        throw new Error(`Owned file operations refused foreign-filesystem ${label}.`);
      }
      validateOwnedDirectoryBinding(parent, `${label} parent`);
    } finally {
      closeOwnedDirectoryBinding(parent);
    }
    logicalDirectory = path.join(logicalDirectory, segment);
  }
  const binding = openOwnedDirectoryBinding(root, logicalDirectory, label);
  closeOwnedDirectoryBinding(binding);
  return logicalDirectory;
}

/** Creates one repository-owned directory exclusively through its held parent descriptor. */
export function createExclusiveOwnedDirectory(rootPath, targetPath, label, mode = 0o700) {
  const root = ownedRoot(rootPath, label);
  const target = path.resolve(targetPath);
  relativeOwnedPath(root, target, label);
  const parent = openOwnedDirectoryBinding(root, path.dirname(target), `${label} parent`);
  try {
    const boundTarget = ownedDirectoryChildPath(parent, path.basename(target), label);
    validateOwnedDirectoryBinding(parent, `${label} parent`);
    mkdirSync(boundTarget, { mode });
    fsyncSync(parent.descriptor);
    safeArtifactStats(boundTarget, "directory", label);
    validateOwnedDirectoryBinding(parent, `${label} parent`);
    return target;
  } finally {
    closeOwnedDirectoryBinding(parent);
  }
}

/** Reads an optional regular file while retaining its complete repository parent binding. */
export function readOptionalOwnedFile(rootPath, targetPath, label, { maximumBytes } = {}) {
  const root = ownedRoot(rootPath, label);
  const target = path.resolve(targetPath);
  relativeOwnedPath(root, target, label);
  const requestedParent = path.dirname(target);
  let existingParent = requestedParent;
  while (existingParent !== root && !existsSync(existingParent)) {
    existingParent = path.dirname(existingParent);
  }
  const parent = openOwnedDirectoryBinding(root, existingParent, `${label} parent`);
  try {
    if (existingParent !== requestedParent) {
      validateOwnedDirectoryBinding(parent, `${label} parent`);
      return Object.freeze({ exists: false, path: target });
    }
    const boundTarget = ownedDirectoryChildPath(parent, path.basename(target), label);
    if (!existsSync(boundTarget)) {
      validateOwnedDirectoryBinding(parent, `${label} parent`);
      return Object.freeze({ exists: false, path: target });
    }
    const snapshot = readStableOwnedFile(parent, path.basename(target), label, { maximumBytes });
    return Object.freeze({
      buffer: snapshot.buffer,
      exists: true,
      path: target,
      stats: snapshot.stats,
    });
  } finally {
    closeOwnedDirectoryBinding(parent);
  }
}

/** Atomically replaces one repository-owned regular file through a held parent descriptor. */
export function atomicWriteOwnedFile(
  rootPath,
  targetPath,
  content,
  mode = 0o600,
  { label = "repository output", testHooks } = {},
) {
  const root = ownedRoot(rootPath, label);
  const target = path.resolve(targetPath);
  relativeOwnedPath(root, target, label);
  const parent = openOwnedDirectoryBinding(root, path.dirname(target), `${label} parent`);
  try {
    return atomicReplaceOwnedFile(parent, path.basename(target), content, label, {
      mode,
      testHooks,
    });
  } finally {
    closeOwnedDirectoryBinding(parent);
  }
}

/** Removes one identity-matched repository-owned regular file through a held parent descriptor. */
export function removeOwnedRegularFile(
  rootPath,
  targetPath,
  label,
  { expectedIdentity, testHooks } = {},
) {
  const root = ownedRoot(rootPath, label);
  const target = path.resolve(targetPath);
  relativeOwnedPath(root, target, label);
  const parent = openOwnedDirectoryBinding(root, path.dirname(target), `${label} parent`);
  try {
    const boundTarget = ownedDirectoryChildPath(parent, path.basename(target), label);
    if (!existsSync(boundTarget)) return false;
    const current = safeArtifactStats(boundTarget, "file", label);
    testHooks?.beforeFileRemove?.({ label, parent, target });
    removeStableOwnedFile(parent, path.basename(target), expectedIdentity ?? current, label);
    return true;
  } finally {
    closeOwnedDirectoryBinding(parent);
  }
}

/** Claims and removes one repository-owned file or directory without following parent swaps. */
export function removeOwnedArtifact(
  rootPath,
  targetPath,
  expectedType,
  label,
  { expectedIdentity, testHooks } = {},
) {
  const root = ownedRoot(rootPath, label);
  const target = path.resolve(targetPath);
  relativeOwnedPath(root, target, label);
  if (!existsSync(target)) return false;
  claimAndRemove({
    artifactPath: target,
    expectedIdentity,
    expectedType,
    label,
    ownedRootPath: root,
    ownerDevice: lstatSync(root).dev,
    testHooks,
  });
  return true;
}

/** Moves one regular file between two repository-bound parents without following logical swaps. */
export function renameOwnedArtifact(
  rootPath,
  sourcePath,
  targetPath,
  expectedType,
  label,
  { expectedIdentity, testHooks } = {},
) {
  const root = ownedRoot(rootPath, label);
  const source = path.resolve(sourcePath);
  const target = path.resolve(targetPath);
  relativeOwnedPath(root, source, label);
  relativeOwnedPath(root, target, label);
  const sourceParent = openOwnedDirectoryBinding(
    root,
    path.dirname(source),
    `${label} source parent`,
  );
  const targetParent = openOwnedDirectoryBinding(
    root,
    path.dirname(target),
    `${label} target parent`,
  );
  try {
    const boundSource = ownedDirectoryChildPath(sourceParent, path.basename(source), label);
    const boundTarget = ownedDirectoryChildPath(targetParent, path.basename(target), label);
    const before = safeArtifactStats(boundSource, expectedType, label);
    if (expectedIdentity && !sameObjectIdentity(expectedIdentity, before)) {
      throw new Error(`Owned file operations detected an unexpected identity in ${label}.`);
    }
    if (existsSync(boundTarget)) {
      throw new Error(`Owned file operations refused an existing target in ${label}.`);
    }
    testHooks?.beforeBoundRename?.({ label, sourceParent, targetParent });
    validateOwnedDirectoryBinding(sourceParent, `${label} source parent`);
    validateOwnedDirectoryBinding(targetParent, `${label} target parent`);
    // Both paths are reached through held directory descriptors, so logical parent swaps cannot
    // redirect this cross-directory mutation outside the selected repository root.
    renameSync(boundSource, boundTarget);
    fsyncSync(sourceParent.descriptor);
    if (sourceParent.descriptor !== targetParent.descriptor) fsyncSync(targetParent.descriptor);
    const after = safeArtifactStats(boundTarget, expectedType, label);
    if (!sameObjectIdentity(before, after)) {
      throw new Error(`Owned file operations detected a moved-file identity change in ${label}.`);
    }
    validateOwnedDirectoryBinding(sourceParent, `${label} source parent`);
    validateOwnedDirectoryBinding(targetParent, `${label} target parent`);
    return after;
  } finally {
    closeOwnedDirectoryBinding(targetParent);
    closeOwnedDirectoryBinding(sourceParent);
  }
}

export function renameOwnedRegularFile(rootPath, sourcePath, targetPath, label, options) {
  return renameOwnedArtifact(rootPath, sourcePath, targetPath, "file", label, options);
}

/** Removes an empty repository-owned directory through its held parent descriptor. */
export function removeOwnedEmptyDirectory(rootPath, targetPath, label) {
  const root = ownedRoot(rootPath, label);
  const target = path.resolve(targetPath);
  relativeOwnedPath(root, target, label);
  const parent = openOwnedDirectoryBinding(root, path.dirname(target), `${label} parent`);
  try {
    const boundTarget = ownedDirectoryChildPath(parent, path.basename(target), label);
    if (!existsSync(boundTarget)) return false;
    safeArtifactStats(boundTarget, "directory", label);
    const directory = openOwnedDirectoryBinding(root, target, label);
    try {
      if (readdirSync(directory.operationPath).length > 0) return false;
      validateOwnedDirectoryBinding(directory, label);
    } finally {
      closeOwnedDirectoryBinding(directory);
    }
    validateOwnedDirectoryBinding(parent, `${label} parent`);
    rmdirSync(boundTarget);
    fsyncSync(parent.descriptor);
    validateOwnedDirectoryBinding(parent, `${label} parent`);
    return true;
  } finally {
    closeOwnedDirectoryBinding(parent);
  }
}

/** Changes mode through an O_NOFOLLOW descriptor whose identity is checked before and after. */
export function chmodOwnedRegularFile(rootPath, targetPath, expectedIdentity, mode, label) {
  const root = ownedRoot(rootPath, label);
  const target = path.resolve(targetPath);
  relativeOwnedPath(root, target, label);
  const parent = openOwnedDirectoryBinding(root, path.dirname(target), `${label} parent`);
  let descriptor;
  try {
    const boundTarget = ownedDirectoryChildPath(parent, path.basename(target), label);
    descriptor = openSync(boundTarget, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = fstatSync(descriptor);
    if (!before.isFile() || (expectedIdentity && !sameObjectIdentity(expectedIdentity, before))) {
      throw new Error(`Owned file operations detected an identity change in ${label}.`);
    }
    fchmodSync(descriptor, mode);
    const after = fstatSync(descriptor);
    if (!sameObjectIdentity(before, after)) {
      throw new Error(`Owned file operations detected a mode-change identity change in ${label}.`);
    }
    validateOwnedDirectoryBinding(parent, `${label} parent`);
    return after;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    closeOwnedDirectoryBinding(parent);
  }
}
