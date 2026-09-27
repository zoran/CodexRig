/** Owns publication admission for the calling canonical session and competing worktree writers. */
import { inspectRuntimeSessionLease } from "./runtime-session-lease.mjs";
import {
  inspectProcessIdentity,
  isCurrentProcessDescendantOf,
} from "./runtime-process-identity.mjs";
import { reconcileRepositoryWorktreeState } from "./worktree-recovery.mjs";

/** Returns the exact permitted session, or null outside Codex; never grants publication authority. */
export function inspectPublicationSession(root) {
  const state = reconcileRepositoryWorktreeState({ root });
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
          "Run from the owning canonical session after draining its writers, or after all sessions exit.",
      );
    }
    caller = lease;
  }
  return caller;
}
