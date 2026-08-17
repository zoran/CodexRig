/** Owns clean context index behavior for the repository-local semantic context boundary. */
import { lstatSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { withRebuildLock } from "./context-lock.mjs";
import {
  assertOwnedIndexDirectory,
  assertSafeIndexDirectory,
  ensureOwnedDirectory,
  resolveOwnedDirectory,
  resolveRepositoryRoot,
} from "./context-paths.mjs";
import { formatContextError } from "../terminal/terminal-output.mjs";
import { claimAndRemove } from "./context-maintenance-safety.mjs";

export async function removeOwnedContextIndex({ repositoryRoot, indexDirectory, rebuildLockPath }) {
  const root = resolveRepositoryRoot(repositoryRoot);
  const ownedIndexDirectory = assertSafeIndexDirectory(root, indexDirectory);
  const ownedRebuildLockPath = resolveOwnedDirectory({
    repositoryRoot: root,
    configuredPath: rebuildLockPath,
    label: "Context rebuild lock directory",
  });
  ensureOwnedDirectory({
    repositoryRoot: root,
    configuredPath: path.dirname(ownedRebuildLockPath),
    label: "Context runtime cache directory",
  });
  await withRebuildLock(
    {
      rebuildLockPath: ownedRebuildLockPath,
      toPosix: (value) => path.relative(root, value).split(path.sep).join("/") || ".",
    },
    async () => {
      assertOwnedIndexDirectory({
        repositoryRoot: root,
        indexDirectory: ownedIndexDirectory,
      });
      claimAndRemove({
        artifactPath: ownedIndexDirectory,
        expectedType: "directory",
        label: "owned context index",
        ownedRootPath: root,
        ownerDevice: lstatSync(root).dev,
      });
    },
  );
}

async function main() {
  const { indexDirectory, rebuildLockPath, root } = await import("./context-index-lib.mjs");
  await removeOwnedContextIndex({
    repositoryRoot: root,
    indexDirectory,
    rebuildLockPath,
  });
  console.log("Removed generated context index state after acquiring the maintenance lock.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`Context index cleanup failed: ${formatContextError(error)}`);
    process.exitCode = 1;
  }
}
