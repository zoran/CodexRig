#!/usr/bin/env node
/** Owns compatibility track preparation in a disposable CI checkout, never the published stable pins. */
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readCompatibilityMatrix } from "../contracts/framework-contract.mjs";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import { maintainToolchain } from "../deps/maintain-toolchain.mjs";
import { resolveCompatibilityToolchain } from "../deps/toolchain-releases.mjs";
import { frameworkVersionReconciliationPlan } from "./framework-version.mjs";
import { acquireVerificationSessionLock } from "../verify/verification-session-lock.mjs";
import { applyHousekeepingWrites } from "../repository/repository-housekeeping-transaction.mjs";

/** Candidate pins, package manager and lock are migrated together in this explicitly disposable test fixture. */
export async function prepareCompatibilityTrack({ root = toolingRoot, trackId, ...testing } = {}) {
  const matrix = readCompatibilityMatrix(root);
  const track = matrix.canaries.find((entry) => entry.id === trackId);
  if (!track) throw new Error("Unknown declared compatibility track.");
  const before = frameworkVersionReconciliationPlan({ root, review: true });
  if (before.blockingFindings.length || before.driftFindings.length)
    throw new Error(
      "The source release must pass its unmodified version check before an experiment.",
    );
  const result = await maintainToolchain({
    ...testing,
    root,
    startup: true,
    locked: true,
    candidateResolver: (current, options) => resolveCompatibilityToolchain(current, track, options),
  });
  // The release gate remains exercised by full verification. Only this disposable fixture's
  // version mirrors advance to account for its deliberate experiment; no source is published.
  const lock = acquireVerificationSessionLock({ repositoryRoot: root });
  try {
    const plan = frameworkVersionReconciliationPlan({ root, review: true });
    if (plan.blockingFindings.length) throw new Error(plan.blockingFindings.join("; "));
    applyHousekeepingWrites({ root, writes: plan.writes });
  } finally {
    lock.release();
  }
  await maintainToolchain({ ...testing, root, startup: true, locked: true });
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [attestation, trackId, ...extra] = process.argv.slice(2);
  if (attestation !== "--disposable-checkout" || !trackId || extra.length)
    throw new Error(
      "Usage: node scripts/framework/prepare-compatibility-track.mjs --disposable-checkout <declared-track>",
    );
  prepareCompatibilityTrack({ trackId, onProgress: console.log }).catch((error) => {
    console.error(`Compatibility preparation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
