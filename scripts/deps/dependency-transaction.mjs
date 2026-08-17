/** Owns journaled application and recovery of a previously reviewed dependency plan. */
import { existsSync } from "node:fs";
import {
  contentHash,
  DependencyTransactionError,
  projectIdentity,
  readOptionalFile,
  safeRepositoryPath,
  verifyInputRecords,
} from "./dependency-inputs.mjs";
import {
  atomicWrite,
  dependencyTransactionPaths,
  readJsonFile,
  withDependencyTransactionLock,
} from "./dependency-transaction-state.mjs";
import { removeOwnedRegularFile } from "../filesystem/owned-file-operations.mjs";
import {
  assertDependencyPlanRederivable,
  createDependencyPlan,
  dependencyPlanHash,
  dependencyTransactionSchemaVersion,
  normalizeDependencyOutputPath,
  normalizeDependencyRequest,
  stableDependencyJson,
  validateDependencyPlan,
} from "./dependency-plan.mjs";

export { contentHash, DependencyTransactionError } from "./dependency-inputs.mjs";
export {
  createDependencyPlan,
  dependencyPlanHash,
  normalizeDependencyRequest,
  updatedDependencySpec,
  validateDependencyPlan,
} from "./dependency-plan.mjs";
export {
  acquireDependencyTransactionLock,
  dependencyTransactionPaths,
  releaseDependencyTransactionLock,
  withDependencyTransactionLock,
} from "./dependency-transaction-state.mjs";

const schemaVersion = dependencyTransactionSchemaVersion;

export function storeDependencyPlan(projectRoot, plan) {
  validateDependencyPlan(plan);
  const paths = dependencyTransactionPaths(projectRoot);
  if (existsSync(paths.journal)) {
    throw new DependencyTransactionError(
      "An interrupted dependency transaction must be recovered before replacing its plan.",
      75,
    );
  }
  atomicWrite(projectRoot, paths.plan, `${JSON.stringify(plan, null, 2)}\n`);
  return paths.plan;
}

export function loadDependencyPlan(projectRoot) {
  const plan = readJsonFile(
    projectRoot,
    dependencyTransactionPaths(projectRoot).plan,
    "reviewed dependency plan",
  );
  return validateDependencyPlan(plan);
}

function currentOutputHash(projectRoot, output) {
  const current = readOptionalFile(projectRoot, output.path);
  return current.exists ? current.hash : null;
}

function journalOriginal(projectRoot, relativePath) {
  const current = readOptionalFile(projectRoot, relativePath);
  return {
    path: relativePath,
    existed: current.exists,
    hash: current.hash,
    content: current.content,
  };
}

function writeRepositoryOutput(projectRoot, output) {
  const relativePath = normalizeDependencyOutputPath(output.path);
  const target = safeRepositoryPath(projectRoot, relativePath, { allowMissing: true });
  atomicWrite(projectRoot, target, String(output.content), 0o644);
}

function journalRecoveryEntries(journal) {
  const expectedByPath = new Map();
  for (const expected of journal.expectedOutputs) {
    const relativePath = normalizeDependencyOutputPath(expected.path);
    if (expectedByPath.has(relativePath) || typeof expected.hash !== "string") {
      throw new DependencyTransactionError(
        "Dependency transaction journal is invalid; manual recovery is required.",
        75,
      );
    }
    expectedByPath.set(relativePath, expected);
  }

  const seenOriginals = new Set();
  const entries = journal.originals.map((original) => {
    const relativePath = normalizeDependencyOutputPath(original.path);
    const expected = expectedByPath.get(relativePath);
    const validOriginal =
      typeof original.existed === "boolean" &&
      (original.existed
        ? typeof original.hash === "string" &&
          contentHash(String(original.content)) === original.hash
        : original.hash === null && original.content === null);
    if (seenOriginals.has(relativePath) || !expected || !validOriginal) {
      throw new DependencyTransactionError(
        "Dependency transaction journal is invalid; manual recovery is required.",
        75,
      );
    }
    seenOriginals.add(relativePath);
    return { expected, original: { ...original, path: relativePath } };
  });

  if (seenOriginals.size !== expectedByPath.size) {
    throw new DependencyTransactionError(
      "Dependency transaction journal is invalid; manual recovery is required.",
      75,
    );
  }
  return entries;
}

function outputMatchesOriginal(current, original) {
  return current.exists === original.existed && current.hash === original.hash;
}

function outputMatchesExpected(current, expected) {
  return current.exists && current.hash === expected.hash;
}

function assertRecoveryOutputOwned(projectRoot, entry) {
  const current = readOptionalFile(projectRoot, entry.original.path);
  if (
    !outputMatchesOriginal(current, entry.original) &&
    !outputMatchesExpected(current, entry.expected)
  ) {
    throw new DependencyTransactionError(
      `Dependency recovery refused to overwrite ${entry.original.path} because it contains an unrelated change; journal preserved for manual recovery.`,
      75,
    );
  }
  return current;
}

function restoreJournal(projectRoot, journal) {
  const entries = journalRecoveryEntries(journal);
  for (const entry of entries) assertRecoveryOutputOwned(projectRoot, entry);
  for (const entry of entries) {
    const current = assertRecoveryOutputOwned(projectRoot, entry);
    const { original } = entry;
    if (outputMatchesOriginal(current, original)) continue;
    const relativePath = original.path;
    const target = safeRepositoryPath(projectRoot, relativePath, { allowMissing: true });
    if (original.existed) atomicWrite(projectRoot, target, String(original.content), 0o644);
    else removeOwnedRegularFile(projectRoot, target, `dependency rollback ${relativePath}`);
  }
}

function verifyJournalRestored(projectRoot, journal) {
  for (const original of journal.originals) {
    const current = readOptionalFile(projectRoot, original.path);
    if (current.exists !== original.existed || current.hash !== original.hash) {
      throw new DependencyTransactionError(
        `Dependency rollback verification failed for ${original.path}; journal was preserved.`,
        75,
      );
    }
  }
}

function removePlanIfOwned(projectRoot, paths, planHashValue) {
  if (!existsSync(paths.plan)) return;
  try {
    const plan = validateDependencyPlan(
      readJsonFile(projectRoot, paths.plan, "reviewed dependency plan"),
    );
    if (plan.hash === planHashValue) {
      removeOwnedRegularFile(projectRoot, paths.plan, "reviewed dependency plan");
    }
  } catch {
    // Preserve an invalid or unrelated plan for explicit inspection.
  }
}

function recoverUnderLock(projectRoot) {
  const paths = dependencyTransactionPaths(projectRoot);
  if (!existsSync(paths.journal)) return { recovered: false, result: null };
  const journal = readJsonFile(projectRoot, paths.journal, "dependency transaction journal");
  const { hash: journalHash, ...journalPayload } = journal ?? {};
  if (
    journal?.version !== schemaVersion ||
    journalHash !== dependencyPlanHash(journalPayload) ||
    typeof journal?.planHash !== "string" ||
    !Array.isArray(journal?.originals) ||
    !Array.isArray(journal?.expectedOutputs)
  ) {
    throw new DependencyTransactionError(
      "Dependency transaction journal is invalid; manual recovery is required.",
      75,
    );
  }
  const recoveryEntries = journalRecoveryEntries(journal);
  const fullyApplied = recoveryEntries.every(({ expected }) => {
    const current = readOptionalFile(projectRoot, expected.path);
    return outputMatchesExpected(current, expected);
  });
  if (fullyApplied) {
    removeOwnedRegularFile(projectRoot, paths.journal, "dependency transaction journal");
    removePlanIfOwned(projectRoot, paths, journal.planHash);
    return {
      recovered: true,
      result: "finalized",
      changed: journal.changed ?? [],
      skipped: journal.skipped ?? [],
      planHash: journal.planHash,
      request: journal.request,
    };
  }
  restoreJournal(projectRoot, journal);
  verifyJournalRestored(projectRoot, journal);
  removeOwnedRegularFile(projectRoot, paths.journal, "dependency transaction journal");
  return { recovered: true, result: "rolled-back" };
}

function journalWithHash(payload) {
  return { ...payload, hash: dependencyPlanHash(payload) };
}

export function recoverDependencyTransaction(projectRoot, options = {}) {
  return withDependencyTransactionLock(
    projectRoot,
    () => recoverUnderLock(projectRoot),
    options.lockOptions,
  );
}

function injectedInterruption(point, requestedPoint) {
  if (requestedPoint !== point) return;
  const error = new DependencyTransactionError(`Injected dependency interruption at ${point}.`, 86);
  error.simulatedInterruption = true;
  throw error;
}

export function applyStoredDependencyPlan(options) {
  const projectRoot = projectIdentity(options.projectRoot).root;
  const reviewedPlanHash = String(options.planHash ?? "");
  if (!/^[a-f0-9]{64}$/u.test(reviewedPlanHash)) {
    throw new DependencyTransactionError(
      "Apply requires the exact --plan-hash printed by the reviewed dependency preview.",
      64,
    );
  }
  return withDependencyTransactionLock(
    projectRoot,
    () => {
      const recovery = recoverUnderLock(projectRoot);
      if (recovery.result === "finalized") {
        if (recovery.planHash !== reviewedPlanHash) {
          throw new DependencyTransactionError(
            "The supplied plan hash does not match the finalized dependency transaction.",
            64,
          );
        }
        if (
          stableDependencyJson(normalizeDependencyRequest(options.request)) !==
          stableDependencyJson(recovery.request)
        ) {
          throw new DependencyTransactionError(
            "A prior dependency transaction was finalized, but its request differs from this apply command.",
            64,
          );
        }
        return {
          changed: recovery.changed,
          skipped: recovery.skipped,
          planHash: recovery.planHash,
          recovered: recovery.result,
        };
      }
      const plan = loadDependencyPlan(projectRoot);
      if (plan.hash !== reviewedPlanHash) {
        throw new DependencyTransactionError(
          "The stored dependency plan differs from the explicitly reviewed plan hash; generate and review a new preview.",
          64,
        );
      }
      const request = normalizeDependencyRequest(options.request);
      if (stableDependencyJson(request) !== stableDependencyJson(plan.request)) {
        throw new DependencyTransactionError(
          "Apply arguments do not match the reviewed dependency preview; use the same options.",
          64,
        );
      }
      verifyInputRecords(projectRoot, plan.inputs);
      assertDependencyPlanRederivable(projectRoot, plan);
      const outputs = [...plan.outputs.manifests, plan.outputs.lockfile];
      const originals = outputs.map((output) => journalOriginal(projectRoot, output.path));
      const paths = dependencyTransactionPaths(projectRoot);
      const journalPayload = {
        version: schemaVersion,
        planHash: plan.hash,
        startedAt: new Date().toISOString(),
        request: plan.request,
        changed: plan.outputs.manifests.map((output) => output.path),
        skipped: plan.skipped,
        originals,
        expectedOutputs: outputs.map((output) => ({ path: output.path, hash: output.hash })),
      };
      const journal = journalWithHash(journalPayload);
      atomicWrite(projectRoot, paths.journal, `${JSON.stringify(journal, null, 2)}\n`);

      try {
        for (const output of plan.outputs.manifests) writeRepositoryOutput(projectRoot, output);
        injectedInterruption("after-manifests", options.injectedFailure);
        writeRepositoryOutput(projectRoot, plan.outputs.lockfile);
        injectedInterruption("after-lockfile", options.injectedFailure);
        for (const output of outputs) {
          if (currentOutputHash(projectRoot, output) !== output.hash) {
            throw new DependencyTransactionError(
              `Dependency transaction output verification failed: ${output.path}`,
            );
          }
        }
        removeOwnedRegularFile(projectRoot, paths.journal, "dependency transaction journal");
        removePlanIfOwned(projectRoot, paths, plan.hash);
        return {
          changed: plan.outputs.manifests.map((output) => output.path),
          skipped: plan.skipped,
          planHash: plan.hash,
          recovered: recovery.result,
        };
      } catch (error) {
        if (error?.simulatedInterruption) throw error;
        try {
          restoreJournal(projectRoot, journal);
          verifyJournalRestored(projectRoot, journal);
          removeOwnedRegularFile(projectRoot, paths.journal, "dependency transaction journal");
        } catch (rollbackError) {
          throw new DependencyTransactionError(
            `${error.message}; automatic rollback failed: ${rollbackError.message}. Journal preserved at ${paths.journal}`,
            75,
          );
        }
        throw error;
      }
    },
    options.lockOptions,
  );
}

export function prepareDependencyPlan(options) {
  return withDependencyTransactionLock(
    options.projectRoot,
    () => {
      recoverUnderLock(options.projectRoot);
      const plan = createDependencyPlan(options);
      const planPath = storeDependencyPlan(options.projectRoot, plan);
      return { plan, planPath };
    },
    options.lockOptions,
  );
}

export function clearStoredDependencyPlan(projectRoot) {
  return withDependencyTransactionLock(projectRoot, () => {
    const paths = dependencyTransactionPaths(projectRoot);
    recoverUnderLock(projectRoot);
    if (existsSync(paths.plan)) {
      removeOwnedRegularFile(projectRoot, paths.plan, "reviewed dependency plan");
    }
  });
}
