#!/usr/bin/env node
/** Composes the source-only update reset with the preloaded native session controller. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { settlePostUpdateReset } from "./framework-reset.mjs";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import { formatContextError } from "../terminal/terminal-output.mjs";
import {
  runStartupSessionController,
  startupControllerFailureMessage,
} from "../setup/startup-session-controller.mjs";

function finishPendingReset(root) {
  let status;
  try {
    status = settlePostUpdateReset(root);
  } catch (error) {
    console.warn(
      `Framework post-update reset deferred. ${formatContextError(error, root)} The launcher retries cleanup on exit and before the next session.`,
    );
    return;
  }
  if (status === "complete") console.log("Framework post-update session reset complete.");
  if (status === "pending")
    console.warn(
      "Framework post-update reset is pending until session, verification and recovery work settles.",
    );
}

export async function runFrameworkSession({ root = toolingRoot, argv = process.argv } = {}) {
  finishPendingReset(root);
  try {
    return await runStartupSessionController({ argv, root });
  } finally {
    finishPendingReset(root);
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runFrameworkSession();
  } catch (error) {
    console.error(startupControllerFailureMessage(error));
    process.exitCode = 1;
  }
}
