#!/usr/bin/env node
/** Owns project command execution with repository-local state; provider admission remains with its owner. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import { assertInstalledProjectTools } from "../deps/project-runtime-admission.mjs";
import { inspectRepositoryWorktrees } from "../repository/worktree-recovery.mjs";
import {
  prepareProjectToolDirectories,
  projectToolEnvironment,
} from "../repository/project-tool-environment.mjs";
import {
  projectManagedToolLayout,
  verifyProjectToolBundle,
} from "../repository/project-tool-executables.mjs";
import { formatContextError } from "../terminal/terminal-output.mjs";
import {
  createProjectTemporaryScope,
  temporaryEnvironment,
} from "../repository/project-temporary-storage.mjs";

/** Inventories before creating private state and forwards signals only to the child it spawned. */
export async function runProjectCommand({
  root = toolingRoot,
  command,
  args = [],
  inherited = process.env,
  miseExecutable,
}) {
  if (
    typeof command !== "string" ||
    !command ||
    command.includes("\0") ||
    args.some((value) => typeof value !== "string" || value.includes("\0"))
  )
    throw new Error("Project command requires one executable and literal argument values.");
  const inventory = inspectRepositoryWorktrees({ root });
  const unsafe = inventory.worktrees.some(
    (worktree) =>
      (worktree.problem && worktree.directoryStatus !== "missing") ||
      ["invalid", "unknown"].includes(worktree.session.status),
  );
  if (!inventory.complete || unsafe)
    throw new Error("Project command refused unsafe repository/worktree ownership.");
  const locations = prepareProjectToolDirectories(root);
  const environment = projectToolEnvironment({ root, inherited });
  // The injectable executable is for an explicit programmatic bootstrap/test owner. The public
  // command always uses the integrity-checked project installation, including Mise self-updates.
  if (!miseExecutable) {
    const layout = projectManagedToolLayout(root, undefined, { environment });
    miseExecutable = verifyProjectToolBundle(root, layout.mise);
    verifyProjectToolBundle(root, layout.codex);
    environment.PATH = [
      path.dirname(miseExecutable),
      path.dirname(layout.codex.executable),
      environment.PATH ?? "",
    ].join(path.delimiter);
  }
  if (existsSync(path.join(root, ".codex", "toolchain.json")))
    assertInstalledProjectTools({ root, miseExecutable, environment });
  const temporary = createProjectTemporaryScope({
    root,
    parent: locations.temporary,
    protectedPaths: inventory.worktrees.map((worktree) => worktree.path),
  });
  let status;
  try {
    status = await new Promise((resolve, reject) => {
      const child = spawn(miseExecutable, ["exec", "--locked", "--", command, ...args], {
        cwd: root,
        env: temporaryEnvironment(environment, temporary.directory),
        stdio: "inherit",
      });
      const handlers = new Map();
      const cleanup = () => {
        for (const [signal, handler] of handlers) process.off(signal, handler);
      };
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
        const handler = () => {
          if (child.pid && child.exitCode === null && child.signalCode === null) child.kill(signal);
        };
        handlers.set(signal, handler);
        process.on(signal, handler);
      }
      child.once("error", (error) => {
        cleanup();
        reject(error);
      });
      child.once("close", (code, signal) => {
        cleanup();
        resolve(signal ? 128 + (os.constants.signals[signal] ?? 0) : (code ?? 1));
      });
    });
    return status;
  } finally {
    try {
      if (!temporary.release())
        console.warn(
          "Project temporary storage retained for active or unobservable consumers; housekeeping will reconcile it.",
        );
    } catch (error) {
      const message = `Project temporary cleanup retained state: ${formatContextError(error, root)}`;
      if (status === 0) throw new Error(message, { cause: error });
      console.error(message);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  if (!args.length) {
    console.error("Usage: node scripts/setup/project-command.mjs -- <command> [arguments...]");
    process.exitCode = 64;
  } else {
    runProjectCommand({ command: args[0], args: args.slice(1) })
      .then((status) => {
        process.exitCode = status;
      })
      .catch((error) => {
        console.error(`Project command failed: ${formatContextError(error, toolingRoot)}`);
        process.exitCode = 1;
      });
  }
}
