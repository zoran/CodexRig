/** Owns framework upgrade io behavior for the framework lifecycle and child upgrade boundary. */
import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  desiredManagedFileContentFromRaw,
  resolveFrameworkPath,
  sha256,
} from "../contracts/framework-contract.mjs";
import {
  atomicWriteOwnedFile,
  ensureOwnedDirectoryChain,
  readOptionalOwnedFile,
} from "../filesystem/owned-file-operations.mjs";

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
  const snapshot = readOptionalOwnedFile(
    root,
    absolutePath,
    `framework upgrade target ${relativePath}`,
  );
  if (!snapshot.exists) return { exists: false, mode: null, sha256: null };
  const content = snapshot.buffer.toString("utf8");
  return {
    content,
    exists: true,
    mode: snapshot.stats.mode & 0o777,
    sha256: sha256(content),
  };
}

export function managedUpgradeSourceState(sourceRoot, relativePath) {
  const absolutePath = resolveFrameworkPath(sourceRoot, relativePath);
  const snapshot = readOptionalOwnedFile(
    sourceRoot,
    absolutePath,
    `framework upgrade source ${relativePath}`,
  );
  if (!snapshot.exists) throw new Error(`Missing framework upgrade source: ${relativePath}.`);
  return {
    content: desiredManagedFileContentFromRaw(relativePath, snapshot.buffer.toString("utf8")),
    mode: snapshot.stats.mode & 0o777,
  };
}

export function ensureUpgradeDirectoryChain(root, relativeDirectory) {
  const ownedRoot = realUpgradeDirectory(root, "framework upgrade target");
  return ensureOwnedDirectoryChain(
    ownedRoot,
    relativeDirectory,
    "framework upgrade output directory",
  );
}

export function atomicWriteUpgradeFile(root, relativePath, content, mode, { testHooks } = {}) {
  ensureUpgradeDirectoryChain(root, path.posix.dirname(relativePath));
  const target = resolveFrameworkPath(root, relativePath);
  return atomicWriteOwnedFile(root, target, content, mode, {
    label: `framework upgrade output ${relativePath}`,
    testHooks,
  });
}
