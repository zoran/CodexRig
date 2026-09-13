#!/usr/bin/env node
/** Composes source release reconciliation with shared repository housekeeping. Never exported. */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { toolingRoot as repositoryRoot } from "../filesystem/repository-files.mjs";
import { licensingFindings } from "../verify/licensing.mjs";
import { frameworkVersionReconciliationPlan } from "./framework-version.mjs";
import { runRepositoryHousekeeping } from "../goals/repository-housekeeping.mjs";
import { applyHousekeepingWrites } from "../repository/repository-housekeeping-transaction.mjs";
import { spawnRuntimeLifecycleCommandSync } from "../repository/runtime-lifecycle-process.mjs";
import { verificationChildEnvironment } from "../verify/verification-runtime-identity.mjs";
function failFromPlan(plan) {
  const findings = [...plan.blockingFindings, ...plan.driftFindings];
  if (findings.length) throw new Error(findings.join("; "));
}
/** Reconciles source release metadata and its derived installation, including interrupted retries. */
export function reconcileHousekeepingVersion({ root, apply, lifecycleCapability }) {
  let plan = frameworkVersionReconciliationPlan({ root });
  if (plan.blockingFindings.length > 0) failFromPlan(plan);
  if (apply && plan.writes.length > 0) {
    applyHousekeepingWrites({ root, writes: plan.writes });
    plan = frameworkVersionReconciliationPlan({ root });
  }
  failFromPlan(plan);
  if (apply && plan.applicable) {
    try {
      const result = spawnRuntimeLifecycleCommandSync({
        command: process.execPath,
        args: [
          path.join(repositoryRoot, "scripts/deps/install-compatible.mjs"),
          "--reproduce-locked",
        ],
        commandDelegation: { operation: "dependency", role: "housekeeping-dependency" },
        lifecycleCapability,
        repositoryRoot: root,
        role: "housekeeping-deps-supervisor",
        options: {
          cwd: root,
          encoding: "utf8",
          env: verificationChildEnvironment(),
          input: "",
          stdio: "pipe",
          timeout: 240_000,
        },
      });
      if (result.error || result.status !== 0) {
        throw new Error(
          result.error?.message || result.stderr || "Dependency reproduction failed.",
        );
      }
    } catch (error) {
      throw new Error(
        `${error.message} Source housekeeping is incomplete. Retry with mise exec --locked -- node scripts/framework/source-housekeeping.mjs --apply; this also works when pnpm's pre-script guard rejects stale installation metadata.`,
        { cause: error },
      );
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  if (
    args.some((value) => !["--apply", "--check", "--online"].includes(value)) ||
    (args.includes("--apply") && args.includes("--check"))
  )
    throw new Error("Unsupported source housekeeping arguments.");
  await runRepositoryHousekeeping(
    { apply: args.includes("--apply"), online: args.includes("--online") },
    {
      reconcileOwnedState: (options) => {
        reconcileHousekeepingVersion(options);
        const findings = licensingFindings({ root: options.root });
        if (findings.length) throw new Error(findings.join("; "));
      },
    },
  );
}
