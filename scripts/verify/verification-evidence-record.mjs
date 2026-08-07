import { normalizedVerificationGitBasis } from "./verification-git-basis.mjs";
import { normalizedVerificationRiskFingerprints } from "./verification-risk-profile.mjs";
import { canonicalJson, digest, exactKeys, validDigest } from "./verification-record-helpers.mjs";
import { normalizedVerificationRuntimeIdentity } from "./verification-runtime-identity.mjs";

const evidenceKind = "project-verification-evidence";

function stateFrom(inputs, gitBasis, refreshedAt) {
  return {
    broadFingerprint: inputs.broadFingerprint,
    fingerprint: inputs.exactFingerprint,
    gitBasis: normalizedVerificationGitBasis(gitBasis),
    planDigest: inputs.planDigest,
    refreshedAt,
    riskFingerprints: inputs.riskFingerprints,
    runtime: inputs.runtime,
    runtimeDigest: inputs.runtimeDigest,
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
      "broadFingerprint",
      "fingerprint",
      "gitBasis",
      "planDigest",
      "refreshedAt",
      "riskFingerprints",
      "runtime",
      "runtimeDigest",
    ]) ||
    !validDigest(state.broadFingerprint) ||
    !validDigest(state.fingerprint) ||
    !validDigest(state.planDigest) ||
    !validDigest(state.runtimeDigest) ||
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
    foundation: {
      fingerprint: current.fingerprint,
      gitBasis: current.gitBasis,
      recordedAt: now,
    },
    kind: evidenceKind,
    recordedAt: now,
    schemaVersion: 1,
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
    recordedAt: now,
    transitionCount: record.transitionCount + 1,
  });
}

export function validateVerificationEvidenceRecord(record) {
  if (
    !exactKeys(record, [
      "current",
      "foundation",
      "kind",
      "recordDigest",
      "recordedAt",
      "schemaVersion",
      "transitionCount",
    ]) ||
    record.kind !== evidenceKind ||
    record.schemaVersion !== 1 ||
    !validDigest(record.recordDigest) ||
    !validTimestamp(record.recordedAt) ||
    !Number.isSafeInteger(record.transitionCount) ||
    record.transitionCount < 0 ||
    !exactKeys(record.foundation, ["fingerprint", "gitBasis", "recordedAt"]) ||
    !validDigest(record.foundation.fingerprint) ||
    !validTimestamp(record.foundation.recordedAt)
  ) {
    throw new Error("Verification evidence cache entry has an invalid schema.");
  }
  normalizedVerificationGitBasis(record.foundation.gitBasis);
  validateState(record.current);
  if (digest(canonicalJson(unsignedRecord(record))) !== record.recordDigest) {
    throw new Error("Verification evidence record digest does not match its content.");
  }
  return record;
}
