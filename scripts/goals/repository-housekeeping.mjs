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
import {
  acquireVerificationSessionLock,
  assertVerificationSessionLockOwned,
} from "../verify/verification-session-lock.mjs";
import { readVerificationConfiguration } from "../verify/verification-configuration.mjs";
import { captureVerificationGitBasis } from "../verify/verification-git-basis.mjs";
import { discoverProductLayout } from "../repository/product-roots.mjs";
import { reconcileRepositoryWorktreeState } from "../repository/worktree-recovery.mjs";
import { inspectRepositoryWorktrees } from "../repository/worktree-recovery.mjs";
import { reconcileToolStorage } from "../deps/tool-storage-housekeeping.mjs";
import {
  runStorageHousekeeping,
  reconcileRepositoryStorage,
  repositoryStorageSummary,
} from "../repository/repository-storage.mjs";
import {
  applyHousekeepingWrites,
  housekeepingStateDirectory,
  recoverInterruptedHousekeepingWrites,
} from "../repository/repository-housekeeping-transaction.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");

function parseArgs(argv) {
  const argumentsWithoutDelimiter = argv.filter((argument) => argument !== "--");
  const allowed = new Set(["--apply", "--check", "--online", "--storage-only", "--help", "-h"]);
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
    storageOnly: argumentsWithoutDelimiter.includes("--storage-only"),
  };
}

function usage() {
  return `Usage: pnpm repo:housekeeping [-- --check|--apply] [--online] [--storage-only]

  --check   Read-only drift and repository-health check. This is the default.
  --apply   Reconcile unambiguous delivery inventory, manifest projection, and formatting, then check.
  --online  Also check registry/tool freshness without changing dependency version lines.
  --storage-only  Inspect storage or reclaim abandoned scratch, native cache garbage and replaced installations; no formatting, installation or product checks.
`;
}

function runNode(relativeScript, args = []) {
  const result = spawnSync(process.execPath, [path.join(repositoryRoot, relativeScript), ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: verificationChildEnvironment(process.env, repositoryRoot),
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

/** Composes partial health evidence under the caller's lock; never establishes full acceptance. */
export async function runRepositoryHealthChecks({
  online = false,
  root = repositoryRoot,
  runtimeIdentity,
  checkState = runNode,
} = {}) {
  assertVerificationSessionLockOwned({ repositoryRoot: root });
  // The verifier loads its registry at import time; storage-only recovery must stay independent.
  const [evidence, checkInputs, executor, workspace] = await Promise.all([
    import("../verify/verification-evidence.mjs"),
    import("../verify/verification-check-inputs.mjs"),
    import("../verify/verification-executor.mjs"),
    import("../verify/workspace-verification.mjs"),
  ]);
  const {
    currentVerificationEvidenceInputs,
    readVerificationCheckpoint,
    recordVerificationCheckpoint,
  } = evidence;
  const { pendingVerificationPlan, verificationCheckFingerprints } = checkInputs;
  const { runPlan } = executor;
  const { discoverWorkspaceManifests } = workspace;
  const configuration = readVerificationConfiguration(root);
  const selected = [
    "delivery-environments",
    "docs",
    "identity-access",
    "localization",
    "tenant-isolation",
    "white-label",
    "path-hygiene",
    "patterns",
    "surface-quality",
    "secrets",
    "dependencies",
    "skills",
    "repository-smoke",
    "format",
  ].map((key) => {
    const command = configuration.commands.find((entry) => entry.key === key);
    if (!command)
      throw new Error(`Housekeeping requires the canonical verification check: ${key}.`);
    return command;
  });
  const expectedGitBasis = captureVerificationGitBasis({ repositoryRoot: root });
  const evidenceOptions = { root, runtimeIdentity, broadPlan: selected };
  const expectedInputs = currentVerificationEvidenceInputs(evidenceOptions);
  const checkpoint = readVerificationCheckpoint({ root });
  const relativePaths = expectedInputs.sourceFiles.map((file) => file.path);
  const fingerprints = verificationCheckFingerprints({
    commands: selected,
    inputs: expectedInputs,
    configuration,
    repositoryRoot: root,
    workspaceManifests: discoverWorkspaceManifests({ repositoryRoot: root, relativePaths }),
    productLayout: discoverProductLayout({ repositoryRoot: root, relativePaths }),
  });
  // Other units remain available for their consumers to validate against their own inputs.
  const checks = new Map(checkpoint.checks.map((check) => [check.key, check]));
  const pending = pendingVerificationPlan(
    {
      options: { mode: "housekeeping", printPlan: false },
      admission: { mode: "targeted", reason: "repository health after owned-state reconciliation" },
      verificationScope: "housekeeping health only; publication coverage remains separate",
      classifiedPaths: [],
      readOnlyCommands: selected,
      workspaceCommands: [],
    },
    fingerprints,
    checkpoint.checks,
    { repositoryRoot: root },
  );
  for (const key of pending.evidence.invalidatedKeys) checks.delete(key);
  let failure;
  try {
    await runPlan(pending, {
      repositoryRoot: root,
      onResult(result) {
        const key = result.command.key;
        if (result.status === 0 && !result.error && !result.diagnosticRequired)
          checks.set(key, {
            key,
            fingerprint: fingerprints.get(key),
            completedAt: new Date().toISOString(),
            elapsedMs: result.elapsedMs,
            ...(result.outputFingerprint ? { outputFingerprint: result.outputFingerprint } : {}),
          });
        else checks.delete(key);
      },
    });
  } catch (error) {
    failure = error;
  }
  if (
    failure ||
    pending.readOnlyCommands.length ||
    JSON.stringify(checkpoint.sourceFiles) !== JSON.stringify(expectedInputs.sourceFiles)
  )
    recordVerificationCheckpoint({
      ...evidenceOptions,
      expectedInputs,
      expectedGitBasis,
      failed: Boolean(failure),
      checks: [...checks.values()].filter(
        (check) =>
          !fingerprints.has(check.key) || fingerprints.get(check.key) === check.fingerprint,
      ),
    });
  if (failure) throw failure;
  // Installation/model admission and external freshness observe actual state on every invocation.
  await checkState("scripts/setup/validate-codex-model-policy.mjs", []);
  await checkState("scripts/setup/tooling-doctor.mjs", online ? ["--online"] : []);
  if (online) await checkState("scripts/deps/report.mjs", []);
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

export async function runRepositoryHousekeeping(
  options,
  { reconcileOwnedState, root = repositoryRoot } = {},
) {
  if (options.help) {
    console.log(usage());
    return;
  }
  const storage = (owner) => {
    const inventory = inspectRepositoryWorktrees({ root });
    if (!inventory.complete)
      throw new Error("Storage cleanup requires a complete worktree inventory.");
    const tools = reconcileToolStorage({ root, apply: options.apply, owner });
    for (const action of tools.actions) console.log(`Tool storage: ${action}.`);
    for (const reason of tools.deferred) console.log(`Tool storage retained: ${reason}.`);
    const report = reconcileRepositoryStorage({
      root,
      apply: options.apply,
      protectedPaths: inventory.worktrees.map((worktree) => worktree.path),
    });
    console.log(repositoryStorageSummary(report));
    if (report.reviewRequired)
      throw new Error(
        "Repository storage requires owner reconciliation; retained data was not deleted.",
      );
    return { ...report, tools };
  };
  if (options.storageOnly && !options.apply) return storage();
  if (!options.storageOnly && !options.apply) runStorageHousekeeping({ root });
  const lock = acquireVerificationSessionLock({ repositoryRoot: root });
  try {
    if (options.storageOnly) return storage(lock.lifecycleCapability);
    if (root !== repositoryRoot)
      throw new Error("Full housekeeping must run from its owning repository entry point.");
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
    storage(lock.lifecycleCapability);
    if (options.apply) runStorageHousekeeping({ root, apply: true });
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
    await runRepositoryHealthChecks({ online: options.online });
    runStorageHousekeeping({ root });
    console.log(
      `Repository housekeeping passed in ${options.apply ? "apply" : "check"} mode; no deployment or external environment was changed.`,
    );
  } finally {
    lock.release();
  }
}

async function main() {
  await runRepositoryHousekeeping(parseArgs(process.argv.slice(2)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Repository housekeeping failed: ${formatContextError(error, repositoryRoot)}`);
    process.exitCode = 1;
  });
}
