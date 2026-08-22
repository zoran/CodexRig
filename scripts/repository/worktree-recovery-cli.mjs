#!/usr/bin/env node
/** Owns the command-line adapter for same-clone worktree recovery inventory. */
import process from "node:process";
import {
  formatWorktreeRecoveryJson,
  formatWorktreeRecoveryLine,
  inspectRepositoryWorktrees,
  parseWorktreeRecoveryArguments,
} from "./worktree-recovery.mjs";

try {
  const options = parseWorktreeRecoveryArguments(process.argv.slice(2));
  const inventory = inspectRepositoryWorktrees();
  if (options.json) process.stdout.write(`${formatWorktreeRecoveryJson(inventory)}\n`);
  else {
    for (const worktree of inventory.worktrees) {
      process.stdout.write(`${formatWorktreeRecoveryLine(worktree)}\n`);
    }
  }
} catch (error) {
  console.error(`Worktree recovery inventory failed: ${error.message}`);
  process.exit(1);
}
