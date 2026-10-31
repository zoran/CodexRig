#!/usr/bin/env node
/** Composes source release reconciliation with shared repository housekeeping. Never exported. */
import path from "node:path";
import { existsSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { toolingRoot as repositoryRoot } from "../filesystem/repository-files.mjs";
import { licensingFindings } from "../verify/licensing.mjs";
import { frameworkVersionReconciliationPlan } from "./framework-version.mjs";
import { runRepositoryHousekeeping } from "../goals/repository-housekeeping.mjs";
import { applyHousekeepingWrites } from "../repository/repository-housekeeping-transaction.mjs";
import { spawnRuntimeLifecycleCommandSync } from "../repository/runtime-lifecycle-process.mjs";
import { verificationChildEnvironment } from "../verify/verification-runtime-identity.mjs";
import { dependencyTransactionPaths } from "../deps/dependency-transaction-state.mjs";
import { trustedPnpmCommand } from "../deps/trusted-pnpm-command.mjs";
import { assertTrustedPnpmConfiguration } from "../repository/pnpm-workspace-manifests.mjs";
function failFromPlan(plan) {
  const findings = [...plan.blockingFindings, ...plan.driftFindings];
  if (findings.length) throw new Error(findings.join("; "));
}
/** Reconciles source release metadata and its derived installation, including interrupted retries. */
export function reconcileHousekeepingVersion({
  root,
  apply,
  lifecycleCapability,
  runCommand = spawnRuntimeLifecycleCommandSync,
}) {
  let plan = frameworkVersionReconciliationPlan({ root });
  if (plan.blockingFindings.length > 0) failFromPlan(plan);
  if (apply && plan.applicable) {
    const transaction = dependencyTransactionPaths(root);
    if (existsSync(transaction.plan) || existsSync(transaction.journal))
      throw new Error(
        "Finish or clear the reviewed dependency update transaction before source housekeeping. Source housekeeping is incomplete.",
      );
  }
  if (apply && plan.writes.length > 0) {
    applyHousekeepingWrites({ root, writes: plan.writes });
    plan = frameworkVersionReconciliationPlan({ root });
  }
  failFromPlan(plan);
  if (apply && plan.applicable) {
    try {
      assertTrustedPnpmConfiguration({ repositoryRoot: root });
      const environment = verificationChildEnvironment(process.env, root);
      const pnpm = trustedPnpmCommand({ repositoryRoot: root, environment });
      const run = (command, args, timeout, commandDelegation) =>
        runCommand({
          command,
          args,
          commandDelegation,
          lifecycleCapability,
          repositoryRoot: root,
          role: "housekeeping-deps-supervisor",
          options: {
            cwd: root,
            encoding: "utf8",
            env: environment,
            input: "",
            stdio: "pipe",
            timeout,
            maxBuffer: 1024 * 1024,
          },
        });
      const prepared = run(
        pnpm.executable,
        [
          ...pnpm.argsPrefix,
          "--config.verify-deps-before-run=error",
          "exec",
          process.execPath,
          "-e",
          "",
        ],
        30_000,
      );
      if (!prepared.error && !prepared.signal && prepared.status === 0) return;
      if (
        prepared.error ||
        prepared.signal ||
        prepared.status !== 1 ||
        !/\bERR_PNPM_VERIFY_DEPS_BEFORE_RUN\b/u.test(`${prepared.stdout}\n${prepared.stderr}`)
      )
        throw new Error(
          prepared.error?.message ||
            prepared.stderr ||
            prepared.stdout ||
            "Could not determine prepared dependency state.",
        );
      const result = run(
        process.execPath,
        [path.join(repositoryRoot, "scripts/deps/install-compatible.mjs"), "--reproduce-locked"],
        240_000,
        { operation: "dependency", role: "housekeeping-dependency" },
      );
      if (result.error || result.signal || result.status !== 0) {
        throw new Error(
          result.error?.message || result.stderr || "Dependency reproduction failed.",
        );
      }
    } catch (error) {
      throw new Error(
        `${error.message} Source housekeeping is incomplete. Retry with bash -p scripts/setup/run-project.sh node scripts/framework/source-housekeeping.mjs --apply; this also works when pnpm's pre-script guard rejects stale installation metadata.`,
        { cause: error },
      );
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  if (
    args.some((value) => !["--apply", "--check", "--online", "--storage-only"].includes(value)) ||
    (args.includes("--apply") && args.includes("--check"))
  )
    throw new Error("Unsupported source housekeeping arguments.");
  await runRepositoryHousekeeping(
    {
      apply: args.includes("--apply"),
      online: args.includes("--online"),
      storageOnly: args.includes("--storage-only"),
    },
    {
      reconcileOwnedState: (options) => {
        reconcileHousekeepingVersion(options);
        const findings = licensingFindings({ root: options.root });
        if (findings.length) throw new Error(findings.join("; "));
      },
    },
  );
}
