/** Admits one canonical Codex writer across all worktrees sharing a Git directory. */
import { toolingRoot } from "../filesystem/repository-files.mjs";
import {
  acquireRuntimeLifecycleLock,
  inspectRuntimeLifecycleLock,
  inspectRuntimeSessionPlan,
  releaseRuntimeLifecycleLock,
  withSessionManagementCapability,
} from "./runtime-session-lease.mjs";
import {
  releaseRuntimeSessionLeaseState,
  reserveRuntimeSessionLeaseState,
} from "./runtime-session-state.mjs";
import { inspectRepositoryWorktrees } from "./worktree-recovery.mjs";

function writerInventory(root) {
  const inventory = inspectRepositoryWorktrees({ root });
  if (
    !inventory.complete ||
    inventory.worktrees.some(
      (worktree) => !worktree.current && !["absent", "stale"].includes(worktree.session.status),
    )
  )
    throw new Error(
      "Project writer admission requires all other worktrees to have a known, inactive session.",
    );
  return inventory;
}

function assertPeerOperationsSettled(inventory) {
  for (const worktree of inventory.worktrees) {
    if (worktree.current || !worktree.available) continue;
    const lifecycle = inspectRuntimeLifecycleLock({ root: worktree.path });
    if (["active", "unknown"].includes(lifecycle.status))
      throw new Error(
        "Another worktree has a running or unresolved operation. Retry startup after its owner finishes.",
      );
  }
}

export function projectSessionPlan({ root = toolingRoot } = {}) {
  assertPeerOperationsSettled(writerInventory(root));
  return inspectRuntimeSessionPlan({ root });
}

export function reserveProjectSession({ root = toolingRoot, pid } = {}) {
  const { commonGitDirectory } = writerInventory(root);
  // Serialize competing pickers in common Git metadata. The controller's worktree
  // lease owns the entire session and its existing crash recovery.
  const owner = commonGitDirectory
    ? acquireRuntimeLifecycleLock({ root: commonGitDirectory, operation: "writer-admission" })
    : null;
  try {
    return withSessionManagementCapability({ root }, () => {
      const reservation = reserveRuntimeSessionLeaseState({ root, pid });
      try {
        const inventory = writerInventory(root);
        if (inventory.commonGitDirectory !== commonGitDirectory)
          throw new Error("The project's Git directory changed during writer admission.");
        // Maintenance publishes its lifecycle lock before checking session leases.
        // Publish ours first so overlapping admission and maintenance cannot both succeed.
        assertPeerOperationsSettled(inventory);
        return reservation;
      } catch (error) {
        releaseRuntimeSessionLeaseState({ root, pid });
        throw error;
      }
    });
  } finally {
    if (owner) releaseRuntimeLifecycleLock({ root: commonGitDirectory, owner });
  }
}
