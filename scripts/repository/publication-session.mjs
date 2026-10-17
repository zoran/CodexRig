/** Owns publication admission for the calling canonical session and competing worktree writers. */
import { inspectRuntimeSessionLease } from "./runtime-session-lease.mjs";
import {
  inspectProcessIdentity,
  isCurrentProcessDescendantOf,
} from "./runtime-process-identity.mjs";
import { reconcileRepositoryWorktreeState } from "./worktree-recovery.mjs";
import { lstatSync } from "node:fs";
import path from "node:path";
import { resolveOwnedGitMetadata } from "./git-runtime-isolation.mjs";

/** Returns the exact permitted session, or null outside Codex; never grants publication authority. */
export function inspectPublicationSession(root, { isolated = false } = {}) {
  const state = reconcileRepositoryWorktreeState({ root });
  // Linked worktrees share hooks, configuration and refs mutated by publication. A frozen release
  // uses its own ordinary clone; development clones retain their sessions and mutable outputs.
  if (isolated) {
    const metadata = resolveOwnedGitMetadata(root);
    if (
      metadata?.gitDirectory !== path.join(root, ".git") ||
      state.inventory.worktrees.length !== 1 ||
      ["commondir", "objects/info/alternates"].some((file) =>
        lstatSync(path.join(metadata.gitDirectory, file), { throwIfNoEntry: false }),
      ) ||
      ["HEAD", "index", "config", "objects", "refs", "hooks"].some((file) => {
        const stats = lstatSync(path.join(metadata.gitDirectory, file), { throwIfNoEntry: false });
        return stats?.isSymbolicLink() || (stats?.isFile() && stats.nlink !== 1);
      })
    ) {
      throw new Error(
        "A frozen release candidate requires a separate clone without shared Git metadata or alternates.",
      );
    }
  }
  if (!state.inventory.complete || state.blockingFindings.length > 0) {
    throw new Error(`Worktree settlement blocks publication: ${state.blockingFindings.join("; ")}`);
  }
  let caller = null;
  for (const worktree of state.inventory.worktrees) {
    if (!["active", "unknown", "invalid"].includes(worktree.session.status)) continue;
    const current = worktree.path === root ? inspectRuntimeSessionLease({ root }) : null;
    const lease = current?.lease;
    if (
      current?.status !== "active" ||
      lease?.phase !== "active" ||
      lease.writerPhase !== "bound" ||
      ![lease.process, lease.writerProcess, lease.codexProcess].every(
        (identity) => identity && inspectProcessIdentity(identity) === "active",
      ) ||
      !isCurrentProcessDescendantOf(lease.codexProcess)
    ) {
      throw new Error(
        "Publication is blocked by other active Codex sessions or unverified session ownership. " +
          "Use the owning canonical session with competing writers in this clone resolved, or publish after this clone's sessions exit.",
      );
    }
    caller = lease;
  }
  return caller;
}
