/** Owns source git state behavior for the portable clean-project generation boundary. */
import { realpathSync } from "node:fs";
import { listPortableTransferFiles } from "../repository/source-inventory.mjs";
import { captureStableRepositoryFileIdentity } from "../repository/stable-file-snapshot.mjs";
import {
  cleanGitEnvironment,
  isolatedGitArguments,
  isolatedGitResultCompleted,
  resolveOwnedGitMetadata,
} from "../repository/git-runtime-isolation.mjs";
import { spawnSyncWithBoundedIo as spawnSync } from "../repository/runtime-process-io.mjs";
import { fail } from "./project-options.mjs";

function runGit(metadata, args, label) {
  const invocationArguments = isolatedGitArguments({ args, ...metadata });
  const result = spawnSync("git", invocationArguments, {
    cwd: metadata.workTree,
    encoding: null,
    env: cleanGitEnvironment(),
    input: Buffer.alloc(0),
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 120_000,
  });
  if (
    !isolatedGitResultCompleted(result, {
      args: invocationArguments,
      encoding: null,
      maximumOutputBytes: 64 * 1024 * 1024,
    })
  ) {
    const detail = result.error?.message ?? `status ${result.status}`;
    fail(`${label} failed (${detail}).`);
  }
  return result.stdout;
}

function requireSourceGitMetadata(sourceRoot) {
  let gitMetadata;
  try {
    gitMetadata = resolveOwnedGitMetadata(sourceRoot);
  } catch {
    fail("Source repository must have safe project-owned Git metadata.");
  }
  if (!gitMetadata) fail("Source repository must be the root of a real Git worktree.");
  const gitRoot = runGit(gitMetadata, ["rev-parse", "--show-toplevel"], "Source Git root probe")
    .toString("utf8")
    .trim();
  if (!gitRoot || realpathSync(gitRoot) !== gitMetadata.workTree) {
    fail("Source repository must be the root of a real Git worktree.");
  }
  return gitMetadata;
}

export function sourceHasGitChanges(sourceRoot) {
  const gitMetadata = requireSourceGitMetadata(sourceRoot);
  return (
    runGit(
      gitMetadata,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      "Source Git change probe",
    ).length > 0
  );
}

export function captureSourceGitState(sourceRoot) {
  const gitMetadata = requireSourceGitMetadata(sourceRoot);
  const trackedState = runGit(
    gitMetadata,
    ["status", "--porcelain=v1", "-z", "--untracked-files=no"],
    "Source Git state capture",
  );
  const portableWorkingTree = listPortableTransferFiles({
    root: gitMetadata.workTree,
    includeUntracked: true,
  });
  const portableIdentities = portableWorkingTree.flatMap((relativePath) => {
    const { bytes, identity } = captureStableRepositoryFileIdentity({
      repositoryRoot: gitMetadata.workTree,
      relativePath,
    });
    return [relativePath, String(bytes), identity];
  });
  return Buffer.concat([
    trackedState,
    Buffer.from("\0portable-working-tree\0"),
    Buffer.from(`${portableIdentities.join("\0")}\0`),
  ]);
}

export function assertSourceGitStateUnchanged(sourceRoot, before) {
  const after = captureSourceGitState(sourceRoot);
  if (!after.equals(before)) {
    fail(
      "Source framework changed during project creation; staging was discarded and no project was published.",
    );
  }
}
