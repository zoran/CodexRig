/** Owns parent-bound private runtime-directory and regular-file access for lifecycle state. */
import { existsSync, realpathSync, statSync } from "node:fs";
import process from "node:process";
import { resolveRepositoryPath } from "../filesystem/repository-files.mjs";
import { repositoryCodexRuntimeDirectory } from "./source-inventory.mjs";
import {
  closeOwnedDirectoryBinding,
  ensureOwnedPrivateDirectory,
  openPrivateOwnedDirectory,
  ownedDirectoryChildPath,
  readStableOwnedFile,
} from "../filesystem/owned-path-safety.mjs";

export function repositoryRuntimeRootIdentity(root) {
  const canonical = realpathSync.native(root);
  const stats = statSync(canonical);
  if (!stats.isDirectory()) throw new Error("Runtime lease root must be a directory.");
  return { device: String(stats.dev), inode: String(stats.ino), path: canonical };
}

export function ensureRuntimeDirectory(root, { testHooks } = {}) {
  const codexDirectory = resolveRepositoryPath(root, ".codex");
  const target = resolveRepositoryPath(root, repositoryCodexRuntimeDirectory);
  ensureOwnedPrivateDirectory(root, codexDirectory, "Codex policy and runtime directory", {
    testHooks,
  });
  ensureOwnedPrivateDirectory(root, target, "Codex runtime directory", {
    testHooks: {
      beforeDirectoryCreate: ({ parent }) =>
        testHooks?.beforeRuntimeDirectoryCreate?.({ parentBinding: parent, runtimePath: target }),
      beforeDirectoryModeRepair: ({ parent }) =>
        testHooks?.beforeRuntimeDirectoryChmod?.({ parentBinding: parent, runtimePath: target }),
    },
  });
}

export function openRuntimeDirectory(root, label) {
  const target = resolveRepositoryPath(root, repositoryCodexRuntimeDirectory);
  if (!existsSync(target)) return null;
  return openPrivateOwnedDirectory(root, target, label);
}

export function runtimeFile(root, basename, label, maximumBytes = 8_192) {
  const directory = openRuntimeDirectory(root, label);
  if (!directory) return { directory: null, path: null, status: "absent" };
  const target = ownedDirectoryChildPath(directory, basename, label);
  if (!existsSync(target)) return { directory, path: target, status: "absent" };
  let snapshot;
  try {
    snapshot = readStableOwnedFile(directory, basename, label, { maximumBytes });
  } catch (error) {
    closeOwnedDirectoryBinding(directory);
    throw error;
  }
  if (
    (snapshot.stats.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && snapshot.stats.uid !== process.getuid())
  ) {
    closeOwnedDirectoryBinding(directory);
    throw new Error(`${label} is unsafe.`);
  }
  return { directory, path: target, snapshot, status: "present" };
}

export function closeRuntimeFile(record) {
  if (record.directory) closeOwnedDirectoryBinding(record.directory);
}
