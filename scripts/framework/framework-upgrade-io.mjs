import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  desiredManagedFileContent,
  readRegularFrameworkFile,
  resolveFrameworkPath,
  sha256,
} from "./framework-contract.mjs";

export function realUpgradeDirectory(value, label) {
  const resolved = path.resolve(value);
  if (!existsSync(resolved)) throw new Error(`Missing ${label}.`);
  const stats = lstatSync(resolved);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a real directory.`);
  }
  return realpathSync.native(resolved);
}

export function targetUpgradeFileState(root, relativePath) {
  const absolutePath = resolveFrameworkPath(root, relativePath);
  if (!existsSync(absolutePath)) return { exists: false, mode: null, sha256: null };
  const stats = lstatSync(absolutePath);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) {
    throw new Error(`Upgrade target must be a single-link regular file: ${relativePath}.`);
  }
  const content = readRegularFrameworkFile(root, relativePath);
  return { content, exists: true, mode: stats.mode & 0o777, sha256: sha256(content) };
}

export function managedUpgradeSourceState(sourceRoot, relativePath) {
  const absolutePath = resolveFrameworkPath(sourceRoot, relativePath);
  const stats = lstatSync(absolutePath);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) {
    throw new Error(`Upgrade source must be a single-link regular file: ${relativePath}.`);
  }
  return {
    content: desiredManagedFileContent({ sourceRoot, relativePath }),
    mode: stats.mode & 0o777,
  };
}

export function ensureUpgradeDirectoryChain(root, relativeDirectory) {
  const ownedRoot = realUpgradeDirectory(root, "framework upgrade target");
  let cursor = ownedRoot;
  for (const segment of relativeDirectory.split("/").filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (existsSync(cursor)) {
      const stats = lstatSync(cursor);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error("Framework upgrade output parent is not a real directory.");
      }
    } else {
      mkdirSync(cursor, { mode: 0o700 });
    }
  }
}

export function atomicWriteUpgradeFile(root, relativePath, content, mode) {
  ensureUpgradeDirectoryChain(root, path.posix.dirname(relativePath));
  const target = resolveFrameworkPath(root, relativePath);
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error(`Refusing symlinked framework upgrade output: ${relativePath}.`);
  }
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.codexrig-${process.pid}-${randomUUID()}`,
  );
  const descriptor = openSync(temporary, "wx", mode);
  try {
    writeFileSync(descriptor, content, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, target);
    chmodSync(target, mode);
    const directoryDescriptor = openSync(path.dirname(target), "r");
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } finally {
    rmSync(temporary, { force: true });
  }
}
