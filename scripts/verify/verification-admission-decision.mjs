/** Owns verification admission decision behavior for the repository verification boundary. */
import { isFullRelevantPath } from "./adaptive-state.mjs";

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

export function omitAlreadyCoveredPaths({
  basis,
  changedScope,
  expectedInputs,
  simulated = false,
}) {
  const inputsUnchanged =
    basis?.current?.broadFingerprint === expectedInputs?.broadFingerprint &&
    basis?.current?.fingerprint === expectedInputs?.exactFingerprint &&
    basis?.current?.planDigest === expectedInputs?.planDigest &&
    basis?.current?.runtimeDigest === expectedInputs?.runtimeDigest &&
    JSON.stringify(basis?.current?.riskFingerprints ?? []) ===
      JSON.stringify(expectedInputs?.riskFingerprints ?? []);
  const basisRelationKnown =
    changedScope.basisChanged === true || changedScope.basisChanged === false;
  const contentIdenticalCommit =
    changedScope.basisChanged === true &&
    changedScope.basis?.complete === true &&
    changedScope.basis.dirtyPaths.length === 0 &&
    basis?.current?.gitBasis?.complete === true &&
    JSON.stringify(changedScope.paths) === JSON.stringify(basis.current.gitBasis.dirtyPaths);
  if (
    !simulated &&
    basis?.trusted &&
    basis.current &&
    !changedScope.incomplete &&
    basisRelationKnown &&
    inputsUnchanged &&
    (changedScope.basisChanged === false || contentIdenticalCommit)
  ) {
    return {
      ...changedScope,
      paths: [],
      reason:
        changedScope.basisChanged === true
          ? "successful evidence already covers the content; only the Git basis changed"
          : "exact-current successful evidence already covers this Git basis",
    };
  }
  if (
    !simulated &&
    basis?.trusted &&
    basis.current?.fingerprint !== expectedInputs?.exactFingerprint &&
    changedScope.basisChanged === false &&
    !changedScope.incomplete &&
    changedScope.paths.length === 0
  ) {
    return {
      ...changedScope,
      incomplete: true,
      reason: "exact source fingerprint changed without a classified Git delta",
    };
  }
  return changedScope;
}

export function decideVerificationAdmission({
  basis,
  changed,
  forceFull = false,
  forceReason = "",
  ownersByPath,
  productLayout,
  broadOnlyRisks = [],
  coveredBroadRisks = [],
}) {
  const routeByPath = new Map(ownersByPath.map((entry) => [entry.path, entry]));
  const fullRelevantPaths = uniqueSorted(
    ownersByPath
      .filter((entry) => isFullRelevantPath(entry.path, { productLayout }))
      .map((entry) => entry.path),
  );
  const unknownPaths = uniqueSorted(
    ownersByPath
      .filter((entry) => entry.categories.includes("unknown or incomplete change scope"))
      .map((entry) => entry.path),
  );
  const uncoveredFullRelevantPaths = fullRelevantPaths.filter(
    (relativePath) => (routeByPath.get(relativePath)?.ownerKeys.length ?? 0) === 0,
  );
  const focusedCommandOwners = ownersByPath
    .filter((entry) => entry.ownerKeys.length > 0)
    .map((entry) => ({ ownerKeys: entry.ownerKeys, path: entry.path }));

  let mode = "targeted";
  let reason = "all full-relevant delta paths have focused verifier owners";
  if (forceFull) {
    const structuredForceReason =
      /^(owner-request|uncovered-risk): ([a-z0-9][a-z0-9._/-]{1,63}) - /iu.exec(forceReason);
    if (
      structuredForceReason?.[1].toLowerCase() === "uncovered-risk" &&
      !broadOnlyRisks.some((risk) => risk.riskId === structuredForceReason[2])
    ) {
      throw new Error(
        `Forced uncovered risk ${structuredForceReason[2]} is not present in the current uncovered risk registry.`,
      );
    }
    mode = "full";
    reason = `owner forced full coverage: ${forceReason}`;
  } else if (!basis.trusted) {
    mode = "full";
    reason = `no trusted successful basis${basis.reason ? `: ${basis.reason}` : ""}`;
  } else if (changed.incomplete) {
    mode = "full";
    reason = `changed-path classification is incomplete: ${changed.reason}`;
  } else if (unknownPaths.length > 0) {
    mode = "full";
    reason = `unknown changed paths require fail-closed coverage: ${unknownPaths.join(", ")}`;
  } else if (uncoveredFullRelevantPaths.length > 0) {
    mode = "full";
    reason = `full-relevant paths have no focused verifier owner: ${uncoveredFullRelevantPaths.join(", ")}`;
  } else if (broadOnlyRisks.length > 0) {
    mode = "full";
    reason = `broad-only global invariants are uncovered: ${broadOnlyRisks
      .map((risk) => `${risk.riskId} at ${risk.path}: ${risk.reason}`)
      .join("; ")}`;
  }
  if (mode === "full" && !reason) {
    throw new Error("Full verification admission requires a concrete uncovered reason.");
  }

  return {
    canAdvanceSuccessfulBasis:
      mode === "targeted" &&
      !changed.incomplete &&
      (changed.paths.length > 0 || changed.basisChanged === true) &&
      unknownPaths.length === 0 &&
      uncoveredFullRelevantPaths.length === 0,
    coveredBroadRisks,
    focusedCommandOwners,
    fullRelevantPaths,
    mode,
    reason,
    uncoveredBroadRisks: broadOnlyRisks,
    uncoveredFullRelevantPaths,
    unknownPaths,
    unknownReasons: unknownPaths.map((relativePath) => ({
      path: relativePath,
      reason: "no safe exact path classification",
    })),
  };
}
