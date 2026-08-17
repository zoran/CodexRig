/** Owns identity-bound filesystem safety operations for repository-owned state. */
import { randomUUID } from "node:crypto";
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
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const maximumRemovalTreeEntries = 100_000;

function descriptorDirectoryPath(descriptor, expectedPath) {
  for (const candidate of [`/proc/self/fd/${descriptor}`, `/dev/fd/${descriptor}`]) {
    try {
      if (realpathSync.native(candidate) === realpathSync.native(expectedPath)) return candidate;
    } catch {
      // Continue to the next operating-system descriptor namespace.
    }
  }
  throw new Error("Repository path safety requires a stable directory-descriptor namespace.");
}

function decodeMountInfoPath(value) {
  return value.replace(/\\([0-7]{3})/gu, (_match, digits) =>
    String.fromCharCode(Number.parseInt(digits, 8)),
  );
}

export function linuxMountPointsFrom(content) {
  const mountPoints = [];
  for (const line of String(content).split("\n")) {
    if (!line) continue;
    const separator = line.indexOf(" - ");
    const fields = (separator === -1 ? line : line.slice(0, separator)).split(" ");
    if (fields.length < 5) throw new Error("Owned path safety received malformed mount data.");
    mountPoints.push(path.resolve(decodeMountInfoPath(fields[4])));
  }
  return [...new Set(mountPoints)].sort();
}

function currentMountPoints() {
  if (process.platform !== "linux") return [];
  try {
    return linuxMountPointsFrom(readFileSync("/proc/self/mountinfo", "utf8"));
  } catch {
    throw new Error("Owned path safety could not establish Linux mount boundaries.");
  }
}

function refusesNestedMount(rootPath, mountPoints, label) {
  const root = realpathSync.native(rootPath);
  const nested = mountPoints.some((mountPoint) => {
    const relative = path.relative(root, path.resolve(mountPoint));
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
  });
  if (nested) throw new Error(`Owned path safety refused mounted content in ${label}.`);
}

function artifactType(stats) {
  if (stats.isDirectory()) return "directory";
  if (stats.isFile()) return "file";
  return "other";
}

function safeOwnedDirectory(directoryPath, label) {
  const stats = lstatSync(directoryPath);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Owned path safety refused an unsafe parent for ${label}.`);
  }
  if (realpathSync.native(directoryPath) !== path.resolve(directoryPath)) {
    throw new Error(`Owned path safety refused a redirected parent for ${label}.`);
  }
  return stats;
}

export function captureOwnedParentBinding(ownedRootPath, artifactPath, label) {
  const root = path.resolve(ownedRootPath);
  const target = path.resolve(artifactPath);
  const relative = path.relative(root, target);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Owned path safety refused ${label} outside its owned root.`);
  }
  const directories = [];
  let current = root;
  directories.push({ path: current, stats: safeOwnedDirectory(current, label) });
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    current = path.join(current, segment);
    directories.push({ path: current, stats: safeOwnedDirectory(current, label) });
  }
  const ownerDevice = directories[0].stats.dev;
  if (directories.some((entry) => entry.stats.dev !== ownerDevice)) {
    throw new Error(`Owned path safety refused a foreign-filesystem parent for ${label}.`);
  }
  return Object.freeze({
    directories: Object.freeze(
      directories.map((entry) => Object.freeze({ path: entry.path, stats: entry.stats })),
    ),
    ownerDevice,
    root,
    target,
  });
}

export function validateOwnedParentBinding(binding, label) {
  for (const entry of binding.directories) {
    const current = safeOwnedDirectory(entry.path, label);
    if (
      entry.stats.dev !== current.dev ||
      entry.stats.ino !== current.ino ||
      current.dev !== binding.ownerDevice
    ) {
      throw new Error(`Owned path safety detected a parent identity change in ${label}.`);
    }
  }
}

/** Holds a verified directory inode so child operations cannot follow a swapped repository parent. */
export function openOwnedDirectoryBinding(ownedRootPath, directoryPath, label) {
  const root = path.resolve(ownedRootPath);
  const directory = path.resolve(directoryPath);
  const rootStats = safeOwnedDirectory(root, label);
  const parentBinding =
    directory === root
      ? Object.freeze({
          directories: Object.freeze([Object.freeze({ path: root, stats: rootStats })]),
          ownerDevice: rootStats.dev,
          root,
          target: root,
        })
      : captureOwnedParentBinding(root, directory, label);
  validateOwnedParentBinding(parentBinding, label);
  const initial = safeOwnedDirectory(directory, label);
  const descriptor = openSync(
    directory,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = fstatSync(descriptor);
    if (!sameObjectIdentity(initial, opened)) {
      throw new Error(`Repository path safety detected a directory identity change in ${label}.`);
    }
    validateOwnedParentBinding(parentBinding, label);
    return Object.freeze({
      descriptor,
      directory,
      operationPath: descriptorDirectoryPath(descriptor, directory),
      parentBinding,
      stats: opened,
    });
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

export function validateOwnedDirectoryBinding(binding, label) {
  validateOwnedParentBinding(binding.parentBinding, label);
  const opened = fstatSync(binding.descriptor);
  if (
    binding.stats.dev !== opened.dev ||
    binding.stats.ino !== opened.ino ||
    !opened.isDirectory()
  ) {
    throw new Error(`Repository path safety detected a directory identity change in ${label}.`);
  }
  const rebound = statSync(binding.operationPath);
  if (opened.dev !== rebound.dev || opened.ino !== rebound.ino || !rebound.isDirectory()) {
    throw new Error(`Repository path safety detected a rebound directory in ${label}.`);
  }
  const logical = safeOwnedDirectory(binding.directory, label);
  if (opened.dev !== logical.dev || opened.ino !== logical.ino) {
    throw new Error(`Repository path safety detected a logical directory rebind in ${label}.`);
  }
}

export function closeOwnedDirectoryBinding(binding) {
  closeSync(binding.descriptor);
}

export function ensureOwnedPrivateDirectory(
  ownedRootPath,
  directoryPath,
  label,
  { repairMode = true, testHooks } = {},
) {
  const directory = path.resolve(directoryPath);
  const parent = openOwnedDirectoryBinding(
    ownedRootPath,
    path.dirname(directory),
    `${label} parent`,
  );
  let created = false;
  try {
    const boundTarget = ownedDirectoryChildPath(parent, path.basename(directory), label);
    if (!existsSync(boundTarget)) {
      testHooks?.beforeDirectoryCreate?.({ directoryPath: directory, label, parent });
      validateOwnedDirectoryBinding(parent, `${label} parent`);
      mkdirSync(boundTarget, { mode: 0o700 });
      fsyncSync(parent.descriptor);
      created = true;
    }
    const initial = lstatSync(boundTarget);
    if (
      initial.isSymbolicLink() ||
      !initial.isDirectory() ||
      (typeof process.getuid === "function" && initial.uid !== process.getuid())
    ) {
      throw new Error(`Repository path safety refused unsafe ${label}.`);
    }
    const descriptor = openSync(
      boundTarget,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const opened = fstatSync(descriptor);
      if (initial.dev !== opened.dev || initial.ino !== opened.ino || !opened.isDirectory()) {
        throw new Error(`Repository path safety detected an identity change in ${label}.`);
      }
      if ((opened.mode & 0o077) !== 0) {
        if (!repairMode) {
          throw new Error(`Repository path safety requires private mode for ${label}.`);
        }
        testHooks?.beforeDirectoryModeRepair?.({ directoryPath: directory, label, parent });
        validateOwnedDirectoryBinding(parent, `${label} parent`);
        fchmodSync(descriptor, 0o700);
      }
      validateOwnedDirectoryBinding(parent, `${label} parent`);
    } finally {
      closeSync(descriptor);
    }
    return Object.freeze({ created, path: directory });
  } finally {
    closeOwnedDirectoryBinding(parent);
  }
}

export function openPrivateOwnedDirectory(ownedRootPath, directoryPath, label) {
  const binding = openOwnedDirectoryBinding(ownedRootPath, directoryPath, label);
  if (
    (binding.stats.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && binding.stats.uid !== process.getuid())
  ) {
    closeOwnedDirectoryBinding(binding);
    throw new Error(`Repository path safety requires private owner-controlled ${label}.`);
  }
  return binding;
}

export function ownedDirectoryChildPath(binding, basename, label) {
  if (
    typeof basename !== "string" ||
    !basename ||
    basename !== path.basename(basename) ||
    basename === "." ||
    basename === ".."
  ) {
    throw new Error(`Repository path safety refused an invalid child name in ${label}.`);
  }
  validateOwnedDirectoryBinding(binding, label);
  return path.join(binding.operationPath, basename);
}

export function createExclusiveOwnedFile(binding, basename, content, label, mode = 0o600) {
  const target = ownedDirectoryChildPath(binding, basename, label);
  let descriptor;
  try {
    descriptor = openSync(
      target,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      mode,
    );
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.nlink !== 1) {
      throw new Error(`Repository path safety created an unsafe ${label}.`);
    }
    validateOwnedDirectoryBinding(binding, label);
    fsyncSync(binding.descriptor);
    return stats;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function atomicReplaceOwnedFile(
  binding,
  basename,
  content,
  label,
  { mode = 0o600, testHooks } = {},
) {
  const target = ownedDirectoryChildPath(binding, basename, label);
  if (existsSync(target)) safeArtifactStats(target, "file", label);
  const temporaryName = `.${basename}.${process.pid}.${randomUUID()}.tmp`;
  const temporary = ownedDirectoryChildPath(binding, temporaryName, label);
  let created;
  try {
    created = createExclusiveOwnedFile(binding, temporaryName, content, label, mode);
    testHooks?.beforeAtomicReplace?.({ binding, label, target, temporary });
    validateOwnedDirectoryBinding(binding, label);
    renameSync(temporary, target);
    validateOwnedDirectoryBinding(binding, label);
    const published = safeArtifactStats(target, "file", label);
    if (!sameObjectIdentity(created, published)) {
      throw new Error(`Repository path safety detected a publication identity change in ${label}.`);
    }
    fsyncSync(binding.descriptor);
    return published;
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

export function listOwnedDirectory(binding, label, options) {
  validateOwnedDirectoryBinding(binding, label);
  const entries = readdirSync(binding.operationPath, options);
  validateOwnedDirectoryBinding(binding, label);
  return entries;
}

export function readStableOwnedFile(binding, basename, label, { maximumBytes } = {}) {
  const target = ownedDirectoryChildPath(binding, basename, label);
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
    validateOwnedDirectoryBinding(binding, label);
    return { buffer, stats: after };
  } finally {
    closeSync(descriptor);
  }
}

export function removeStableOwnedFile(binding, basename, expectedIdentity, label) {
  const target = ownedDirectoryChildPath(binding, basename, label);
  const initial = safeArtifactStats(target, "file", label);
  if (expectedIdentity && !sameStableIdentity(expectedIdentity, initial)) {
    throw new Error(`Repository path safety detected an unexpected identity in ${label}.`);
  }
  const claim = ownedDirectoryChildPath(binding, `.repository-removal-file-${randomUUID()}`, label);
  validateOwnedDirectoryBinding(binding, label);
  renameSync(target, claim);
  try {
    validateOwnedDirectoryBinding(binding, label);
    const claimed = safeArtifactStats(claim, "file", label);
    if (!sameObjectIdentity(initial, claimed)) {
      throw new Error(`Repository path safety detected an identity change in ${label}.`);
    }
    rmSync(claim, { force: true });
    fsyncSync(binding.descriptor);
  } catch (error) {
    try {
      validateOwnedDirectoryBinding(binding, label);
      restoreClaim(claim, target);
    } catch {
      throw new Error(`Repository path safety preserved claimed state after unsafe ${label}.`, {
        cause: error,
      });
    }
    throw error;
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

export function validateRemovalTree(
  rootPath,
  expectedType,
  label,
  ownerDevice,
  { allowSymlinkEntries = false, mountPointReader = currentMountPoints } = {},
) {
  const rootStats = safeArtifactStats(rootPath, expectedType, label);
  if (ownerDevice !== undefined && rootStats.dev !== ownerDevice) {
    throw new Error(`Owned path safety refused foreign-filesystem ${label}.`);
  }
  if (expectedType === "file" || expectedType === "symlink") return rootStats;
  refusesNestedMount(rootPath, mountPointReader(), label);
  let visited = 0;
  const pending = [rootPath];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      visited += 1;
      if (visited > maximumRemovalTreeEntries) {
        throw new Error(`Owned path safety refused oversized ${label}.`);
      }
      const entryPath = path.join(directory, entry.name);
      const stats = lstatSync(entryPath);
      if (stats.dev !== rootStats.dev) {
        throw new Error(`Owned path safety refused foreign-filesystem content in ${label}.`);
      }
      if (stats.isSymbolicLink()) {
        if (!allowSymlinkEntries) {
          throw new Error(`Owned path safety refused symlinked content in ${label}.`);
        }
        // An allowed link is validated as a leaf and is never queued for directory descent.
        continue;
      }
      if (stats.isDirectory()) pending.push(entryPath);
      else if (!stats.isFile()) {
        throw new Error(`Owned path safety refused special content in ${label}.`);
      } else if (stats.nlink !== 1) {
        throw new Error(`Owned path safety refused hardlinked content in ${label}.`);
      }
    }
  }
  return rootStats;
}

export function validateDirectoryChain(rootPath, targetPath, label) {
  const relative = path.relative(rootPath, targetPath);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Owned path safety refused ${label} outside its owned root.`);
  }
  let current = rootPath;
  const rootStats = safeArtifactStats(current, "directory", label);
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stats = safeArtifactStats(current, "directory", label);
    if (stats.dev !== rootStats.dev) {
      throw new Error(`Owned path safety refused foreign-filesystem ${label}.`);
    }
  }
}

export function readStableArtifactFile(artifactPath, label) {
  const initialStats = safeArtifactStats(artifactPath, "file", label);
  let descriptor;
  try {
    descriptor = openSync(artifactPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = fstatSync(descriptor);
    if (!sameStableIdentity(initialStats, before)) {
      throw new Error(`Owned path safety detected an identity change in ${label}.`);
    }
    const buffer = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (!sameStableIdentity(before, after) || buffer.length !== after.size) {
      throw new Error(`Owned path safety detected a content change in ${label}.`);
    }
    return { buffer, stats: after };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function restoreClaim(claimPath, originalPath) {
  if (existsSync(claimPath) && !existsSync(originalPath)) renameSync(claimPath, originalPath);
}

export function claimAndRemove({
  allowSymlinkEntries = false,
  artifactPath,
  expectedIdentity,
  expectedType,
  label,
  mountPointReader,
  ownedRootPath = path.dirname(artifactPath),
  ownerDevice,
  testHooks,
}) {
  const directory = openOwnedDirectoryBinding(
    ownedRootPath,
    path.dirname(artifactPath),
    `${label} parent`,
  );
  try {
    if (ownerDevice !== undefined && directory.parentBinding.ownerDevice !== ownerDevice) {
      throw new Error(`Owned path safety refused foreign-filesystem parent for ${label}.`);
    }
    const boundArtifactPath = ownedDirectoryChildPath(
      directory,
      path.basename(artifactPath),
      label,
    );
    const claimName = `.context-removal-${expectedType}-${randomUUID()}`;
    const claimPath = ownedDirectoryChildPath(directory, claimName, label);
    testHooks?.afterParentBindingCapture?.({
      artifactPath,
      label,
      parentBinding: directory.parentBinding,
    });
    const removalTreeOptions = {
      allowSymlinkEntries,
      ...(mountPointReader ? { mountPointReader } : {}),
    };
    const initialStats = validateRemovalTree(
      boundArtifactPath,
      expectedType,
      label,
      ownerDevice,
      removalTreeOptions,
    );
    if (expectedIdentity && !sameStableIdentity(expectedIdentity, initialStats)) {
      throw new Error(`Owned path safety detected an unexpected identity in ${label}.`);
    }
    testHooks?.afterArtifactValidation?.({ artifactPath, label });
    validateOwnedDirectoryBinding(directory, `${label} parent`);
    const beforeClaim = validateRemovalTree(
      boundArtifactPath,
      expectedType,
      label,
      ownerDevice,
      removalTreeOptions,
    );
    if (!sameStableIdentity(initialStats, beforeClaim)) {
      throw new Error(`Owned path safety detected an identity change in ${label}.`);
    }
    testHooks?.beforeClaim?.({ artifactPath, label, parentBinding: directory.parentBinding });
    validateOwnedDirectoryBinding(directory, `${label} parent`);
    testHooks?.beforeBoundClaim?.({ artifactPath, directory, label });
    renameSync(boundArtifactPath, claimPath);
    try {
      fsyncSync(directory.descriptor);
      testHooks?.afterClaim?.({ artifactPath, claimPath, directory, label });
      const claimedStats = safeArtifactStats(claimPath, expectedType, label);
      if (!sameObjectIdentity(beforeClaim, claimedStats)) {
        throw new Error(`Owned path safety detected an identity change in ${label}.`);
      }
      validateRemovalTree(claimPath, expectedType, label, ownerDevice, removalTreeOptions);
      // Node's recursive rm follows POSIX rm semantics and unlinks symlink leaves without
      // traversing their targets.
      rmSync(claimPath, { recursive: expectedType === "directory", force: true });
      fsyncSync(directory.descriptor);
      validateOwnedDirectoryBinding(directory, `${label} parent`);
    } catch (error) {
      try {
        restoreClaim(claimPath, boundArtifactPath);
        fsyncSync(directory.descriptor);
      } catch {
        throw new Error(
          `Owned path safety detected an unsafe parent change in ${label}; claimed state was preserved.`,
          { cause: error },
        );
      }
      throw error;
    }
  } finally {
    closeOwnedDirectoryBinding(directory);
  }
}
