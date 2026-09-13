#!/usr/bin/env node
/** Owns repository housekeeping behavior for the goal closure and repository housekeeping boundary. */
import { spawnSyncWithBoundedIo as spawnSync } from "../repository/runtime-process-io.mjs";
import { lstatSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { deliveryReconciliationPlan } from "../docs/delivery-manifest.mjs";
import { formatContextError, sanitizeMultilineForTerminal } from "../terminal/terminal-output.mjs";
import { verificationChildEnvironment } from "../verify/verification-runtime-identity.mjs";
import { acquireVerificationSessionLock } from "../verify/verification-session-lock.mjs";
import { reconcileRepositoryWorktreeState } from "../repository/worktree-recovery.mjs";
import {
  applyHousekeepingWrites,
  housekeepingStateDirectory,
  recoverInterruptedHousekeepingWrites,
} from "../repository/repository-housekeeping-transaction.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");

function parseArgs(argv) {
  const argumentsWithoutDelimiter = argv.filter((argument) => argument !== "--");
  const allowed = new Set(["--apply", "--check", "--online", "--help", "-h"]);
  const unknown = argumentsWithoutDelimiter.find((argument) => !allowed.has(argument));
  if (unknown) throw new Error(`Unknown repository housekeeping option: ${unknown}`);
  if (
    argumentsWithoutDelimiter.includes("--apply") &&
    argumentsWithoutDelimiter.includes("--check")
  ) {
    throw new Error("Repository housekeeping accepts either --check or --apply, not both.");
  }
  return {
    apply: argumentsWithoutDelimiter.includes("--apply"),
    help: argumentsWithoutDelimiter.some((argument) => argument === "--help" || argument === "-h"),
    online: argumentsWithoutDelimiter.includes("--online"),
  };
}

function usage() {
  return `Usage: pnpm repo:housekeeping [-- --check|--apply] [--online]

  --check   Read-only drift and repository-health check. This is the default.
  --apply   Reconcile unambiguous delivery inventory, manifest projection, and formatting, then check.
  --online  Also check registry/tool freshness without changing dependency version lines.
`;
}

function runNode(relativeScript, args = []) {
  const result = spawnSync(process.execPath, [path.join(repositoryRoot, relativeScript), ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: verificationChildEnvironment(),
    input: "",
    stdio: "pipe",
    timeout: 180_000,
  });
  if (result.error || result.status !== 0) {
    const detail = formatContextError(
      result.error?.message || result.stderr || result.stdout || "check failed",
      repositoryRoot,
    );
    throw new Error(`${relativeScript} failed${detail ? `: ${detail}` : ""}`);
  }
  const output = `${result.stdout}${result.stderr}`.trim();
  if (output) console.log(output);
}

function runRepositoryHealthChecks({ online }) {
  const checks = [
    ["scripts/verify/delivery-environments.mjs", []],
    ["scripts/verify/docs.mjs", []],
    ["scripts/verify/identity-access.mjs", []],
    ["scripts/verify/localization.mjs", []],
    ["scripts/verify/tenant-isolation.mjs", []],
    ["scripts/verify/white-label.mjs", []],
    ["scripts/verify/path-hygiene.mjs", []],
    ["scripts/verify/patterns.mjs", []],
    ["scripts/verify/stack-standards.mjs", []],
    ["scripts/verify/secrets.mjs", []],
    ["scripts/verify/dependencies.mjs", []],
    ["scripts/verify/skill-paths.mjs", []],
    ["scripts/setup/validate-codex-model-policy.mjs", []],
    ["scripts/setup/tooling-doctor.mjs", online ? ["--online"] : []],
    ["scripts/verify/repository-smoke.mjs", []],
    ["scripts/verify/format-project.mjs", ["--check"]],
  ];
  for (const [relativeScript, args] of checks) runNode(relativeScript, args);
  if (online) runNode("scripts/deps/report.mjs");
}

function failFromPlan(plan) {
  const findings = [...plan.blockingFindings, ...plan.driftFindings];
  if (findings.length === 0) return;
  throw new Error(
    [
      "Repository housekeeping found unresolved drift:",
      ...findings.map((item) => `- ${item}`),
    ].join("\n"),
  );
}

export async function runRepositoryHousekeeping(options, { reconcileOwnedState } = {}) {
  if (options.help) {
    console.log(usage());
    return;
  }
  const lock = acquireVerificationSessionLock({ repositoryRoot });
  try {
    const interruptedState = path.join(repositoryRoot, housekeepingStateDirectory);
    if (!options.apply && lstatSync(interruptedState, { throwIfNoEntry: false })) {
      throw new Error(
        "Repository housekeeping has durable interrupted state; run --apply to recover it before checking.",
      );
    }
    const worktreePlan = reconcileRepositoryWorktreeState({
      root: repositoryRoot,
      apply: options.apply,
      lifecycleCapability: lock.lifecycleCapability,
    });
    for (const advisory of worktreePlan.advisoryFindings) {
      console.warn(
        `Repository housekeeping preserved advisory: ${sanitizeMultilineForTerminal(advisory, repositoryRoot)}`,
      );
    }
    failFromPlan(worktreePlan);
    if (options.apply) recoverInterruptedHousekeepingWrites(repositoryRoot);
    if (reconcileOwnedState)
      await reconcileOwnedState({
        root: repositoryRoot,
        apply: options.apply,
        lifecycleCapability: lock.lifecycleCapability,
      });

    let plan = deliveryReconciliationPlan({ root: repositoryRoot });
    if (plan.blockingFindings.length > 0) failFromPlan(plan);
    if (options.apply && plan.writes.length > 0) {
      applyHousekeepingWrites({ root: repositoryRoot, writes: plan.writes });
      plan = deliveryReconciliationPlan({ root: repositoryRoot });
    }
    failFromPlan(plan);
    if (options.apply) runNode("scripts/verify/format-project.mjs", ["--write"]);
    runRepositoryHealthChecks({ online: options.online });
    console.log(
      `Repository housekeeping passed in ${options.apply ? "apply" : "check"} mode; no deployment or external environment was changed.`,
    );
  } finally {
    lock.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Repository housekeeping failed: ${formatContextError(error, repositoryRoot)}`);
    process.exitCode = 1;
  });
}
