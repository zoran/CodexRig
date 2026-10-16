/** Owns parent-bound private runtime-directory and regular-file access for lifecycle state. */
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  statSync,
} from "node:fs";
import process from "node:process";
import path from "node:path";
import { userToolPaths } from "./user-tool-storage.mjs";
import { resolveRepositoryPath } from "../filesystem/repository-files.mjs";
import { repositoryCodexRuntimeDirectory } from "./source-inventory.mjs";
import { sameLifecycleGuardIdentity } from "./runtime-lifecycle-schema.mjs";
import {
  closeOwnedDirectoryBinding,
  ensureOwnedPrivateDirectory,
  openPrivateOwnedDirectory,
  ownedDirectoryChildPath,
  readStableOwnedFile,
  validateOwnedDirectoryBinding,
} from "../filesystem/owned-path-safety.mjs";

export const runtimeLifecycleGuardName = "codexrig-lifecycle.guard";

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

/** Opens the lifecycle guard only while its file and private parent identities still match. */
export function openRuntimeLifecycleGuard(root, expected) {
  const directory = openRuntimeDirectory(root, "Codex runtime lifecycle guard parent");
  if (!directory) throw new Error("Codex runtime lifecycle guard parent disappeared.");
  try {
    const target = ownedDirectoryChildPath(
      directory,
      runtimeLifecycleFileName(root, runtimeLifecycleGuardName),
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

/** Shared installations use one portable lifecycle namespace; private repository names stay intact. */
export function runtimeLifecycleFileName(root, name) {
  if (path.resolve(root) !== userToolPaths().lifecycle) return name;
  const suffix = name.split("-lifecycle.")[1];
  if (!["lock", "guard", "update"].includes(suffix))
    throw new Error("Invalid shared lifecycle filename.");
  // Preserve an earlier source-owned lock instead of silently starting a second owner beside it.
  for (const kind of ["lock", "guard", "update"]) {
    const legacy = ["codex", "rig-lifecycle.", kind].join("");
    if (existsSync(path.join(root, repositoryCodexRuntimeDirectory, legacy)))
      throw new Error("Legacy shared lifecycle state requires recovery with its original owner.");
  }
  return `project-lifecycle.${suffix}`;
}
