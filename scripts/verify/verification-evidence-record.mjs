/** Owns verification evidence record behavior for the repository verification boundary. */
import { normalizedVerificationGitBasis } from "./verification-git-basis.mjs";
import { normalizedVerificationRiskFingerprints } from "./verification-risk-profile.mjs";
import { canonicalJson, digest, exactKeys, validDigest } from "./verification-record-helpers.mjs";
import { normalizedVerificationRuntimeIdentity } from "./verification-runtime-identity.mjs";

const evidenceKind = "project-verification-evidence";

function stateFrom(inputs, gitBasis, refreshedAt) {
  return {
    artifactDigest: inputs.artifactDigest,
    artifactManifest: inputs.artifactManifest,
    broadFingerprint: inputs.broadFingerprint,
    configurationDigest: inputs.configurationDigest,
    deliveryEnvironment: inputs.deliveryEnvironment,
    deliveryPlanDigest: inputs.deliveryPlanDigest,
    fingerprint: inputs.exactFingerprint,
    gitBasis: normalizedVerificationGitBasis(gitBasis),
    planDigest: inputs.planDigest,
    refreshedAt,
    riskFingerprints: inputs.riskFingerprints,
    runtime: inputs.runtime,
    runtimeDigest: inputs.runtimeDigest,
    sourceCommit: inputs.sourceCommit,
  };
}

function unsignedRecord(record) {
  const { recordDigest: _recordDigest, ...unsigned } = record;
  return unsigned;
}

function signedRecord(record) {
  return { ...record, recordDigest: digest(canonicalJson(unsignedRecord(record))) };
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateState(state) {
  if (
    !exactKeys(state, [
      "artifactDigest",
      "artifactManifest",
      "broadFingerprint",
      "configurationDigest",
      "deliveryEnvironment",
      "deliveryPlanDigest",
      "fingerprint",
      "gitBasis",
      "planDigest",
      "refreshedAt",
      "riskFingerprints",
      "runtime",
      "runtimeDigest",
      "sourceCommit",
    ]) ||
    !validDigest(state.broadFingerprint) ||
    !validDigest(state.fingerprint) ||
    !validDigest(state.planDigest) ||
    !validDigest(state.runtimeDigest) ||
    !["dev", "staging", "prod"].includes(state.deliveryEnvironment) ||
    (state.artifactDigest !== "" && !/^sha256:[a-f0-9]{64}$/u.test(state.artifactDigest)) ||
    typeof state.artifactManifest !== "string" ||
    (state.configurationDigest !== "" && !validDigest(state.configurationDigest)) ||
    (state.deliveryPlanDigest !== "" && !validDigest(state.deliveryPlanDigest)) ||
    typeof state.sourceCommit !== "string" ||
    (state.deliveryEnvironment === "dev" &&
      (state.artifactDigest ||
        state.artifactManifest ||
        state.configurationDigest ||
        state.deliveryPlanDigest ||
        state.sourceCommit)) ||
    (state.deliveryEnvironment !== "dev" &&
      (!state.artifactDigest ||
        !state.artifactManifest ||
        !state.configurationDigest ||
        !state.deliveryPlanDigest ||
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(state.sourceCommit))) ||
    !validTimestamp(state.refreshedAt)
  ) {
    throw new Error("Verification evidence state is invalid.");
  }
  normalizedVerificationGitBasis(state.gitBasis);
  normalizedVerificationRiskFingerprints(state.riskFingerprints);
  normalizedVerificationRuntimeIdentity(state.runtime);
  return state;
}

export function fullVerificationEvidenceRecord(inputs, gitBasis, now = new Date().toISOString()) {
  const current = stateFrom(inputs, gitBasis, now);
  return signedRecord({
    current,
    checks: [],
    observedFiles: inputs.sourceFiles,
    foundation: {
      fingerprint: current.fingerprint,
      gitBasis: current.gitBasis,
      recordedAt: now,
    },
    kind: evidenceKind,
    recordedAt: now,
    schemaVersion: 4,
    transitionCount: 0,
  });
}

export function refreshedVerificationEvidenceRecord(
  record,
  inputs,
  gitBasis,
  now = new Date().toISOString(),
) {
  return signedRecord({
    ...unsignedRecord(record),
    current: stateFrom(inputs, gitBasis, now),
    observedFiles: inputs.sourceFiles,
    recordedAt: now,
    transitionCount: record.transitionCount + 1,
  });
}

/** A partial run updates the same record without claiming publication acceptance. */
export function checkpointVerificationEvidenceRecord(record, checks, sourceFiles) {
  const now = new Date().toISOString();
  return signedRecord({
    ...(record
      ? unsignedRecord(record)
      : {
          current: null,
          foundation: null,
          kind: evidenceKind,
          schemaVersion: 4,
          transitionCount: 0,
        }),
    checks,
    observedFiles: sourceFiles,
    recordedAt: now,
  });
}

export function validateVerificationEvidenceRecord(record) {
  if (
    !exactKeys(record, [
      "current",
      "checks",
      "observedFiles",
      "foundation",
      "kind",
      "recordDigest",
      "recordedAt",
      "schemaVersion",
      "transitionCount",
    ]) ||
    record.kind !== evidenceKind ||
    record.schemaVersion !== 4 ||
    !validDigest(record.recordDigest) ||
    !validTimestamp(record.recordedAt) ||
    !Number.isSafeInteger(record.transitionCount) ||
    record.transitionCount < 0 ||
    !Array.isArray(record.checks) ||
    record.checks.length > 2000 ||
    record.checks.some(
      (item, index) =>
        !exactKeys(item, ["key", "fingerprint"]) ||
        !/^[a-z0-9][a-z0-9:_-]*$/u.test(item.key) ||
        !validDigest(item.fingerprint) ||
        record.checks.findIndex((entry) => entry.key === item.key) !== index,
    ) ||
    !Array.isArray(record.observedFiles) ||
    record.observedFiles.length > 50000 ||
    record.observedFiles.some(
      (item, index) =>
        !exactKeys(item, ["path", "fingerprint", "semanticFingerprint"]) ||
        typeof item.path !== "string" ||
        !item.path ||
        /[\0\r\n]/u.test(item.path) ||
        !validDigest(item.fingerprint) ||
        !validDigest(item.semanticFingerprint) ||
        (index > 0 && record.observedFiles[index - 1].path >= item.path),
    ) ||
    (record.current === null) !== (record.foundation === null) ||
    (record.foundation !== null &&
      (!exactKeys(record.foundation, ["fingerprint", "gitBasis", "recordedAt"]) ||
        !validDigest(record.foundation.fingerprint) ||
        !validTimestamp(record.foundation.recordedAt)))
  ) {
    throw new Error("Verification evidence cache entry has an invalid schema.");
  }
  if (record.current !== null) {
    normalizedVerificationGitBasis(record.foundation.gitBasis);
    validateState(record.current);
  }
  if (digest(canonicalJson(unsignedRecord(record))) !== record.recordDigest) {
    throw new Error("Verification evidence record digest does not match its content.");
  }
  return record;
}
