import { createHash } from "node:crypto";

const digestPattern = /^[a-f0-9]{64}$/u;
const pathPattern = /^[A-Za-z0-9._/-]+$/u;
const riskIdPattern = /^[a-z0-9][a-z0-9-]*$/u;

export const verificationRiskRegistry = Object.freeze([
  { path: "scripts/git-hooks/pre-push", riskId: "pre-push-control-chain" },
  {
    path: "scripts/repository/git-runtime-isolation.mjs",
    riskId: "git-runtime-isolation",
  },
  { path: "scripts/repository/source-inventory.mjs", riskId: "source-inventory" },
  {
    path: "scripts/repository/stable-file-snapshot.mjs",
    riskId: "stable-source-snapshot",
  },
  { path: "scripts/verify/adaptive.mjs", riskId: "adaptive-entrypoint" },
  { path: "scripts/verify/adaptive-options.mjs", riskId: "adaptive-entrypoint" },
  { path: "scripts/verify/adaptive-runner.mjs", riskId: "verification-plan-routing" },
  { path: "scripts/verify/adaptive-state.mjs", riskId: "changed-state-classification" },
  { path: "scripts/setup/install-git-hooks.mjs", riskId: "pre-push-control-chain" },
  { path: "scripts/setup/install-git-hooks.sh", riskId: "pre-push-control-chain" },
  {
    path: "scripts/setup/portable-project-contract.mjs",
    riskId: "portable-project-publication",
  },
  { path: "scripts/setup/resolve-git-hooks-path.mjs", riskId: "pre-push-control-chain" },
  {
    path: "scripts/setup/stage-project-export.mjs",
    riskId: "portable-project-publication",
  },
  {
    path: "scripts/setup/validate-staged-project.mjs",
    riskId: "portable-project-publication",
  },
  { path: "scripts/verify/pre-push.sh", riskId: "pre-push-control-chain" },
  { path: "scripts/verify/pre-push-steps.sh", riskId: "pre-push-control-chain" },
  { path: "scripts/verify/verification-admission.mjs", riskId: "verification-admission" },
  {
    path: "scripts/verify/verification-evidence.mjs",
    riskId: "successful-evidence-publication",
  },
  {
    path: "scripts/verify/verification-evidence-record.mjs",
    riskId: "successful-evidence-publication",
  },
  {
    path: "scripts/verify/verification-entrypoints.mjs",
    riskId: "adaptive-entrypoint",
  },
  { path: "scripts/verify/verification-executor.mjs", riskId: "verification-execution" },
  { path: "scripts/verify/verification-git-basis.mjs", riskId: "verification-git-basis" },
  {
    path: "scripts/verify/verification-risk-profile.mjs",
    riskId: "verification-risk-profile",
  },
  {
    path: "scripts/verify/verification-record-helpers.mjs",
    riskId: "verification-record-encoding",
  },
  {
    path: "scripts/verify/verification-runtime-identity.mjs",
    riskId: "verification-runtime-identity",
  },
  {
    path: "scripts/verify/verification-session-lock.mjs",
    riskId: "verification-session-serialization",
  },
  {
    path: "scripts/verify/workspace-verification.mjs",
    riskId: "workspace-verification-routing",
  },
]);

const riskByPath = new Map(
  verificationRiskRegistry.map((entry) => [entry.path, Object.freeze({ ...entry })]),
);

export function verificationRiskForPath(relativePath) {
  return riskByPath.get(relativePath) ?? null;
}

function riskKey(risk) {
  return `${risk.riskId}\0${risk.path}`;
}

export function normalizedVerificationRiskFingerprints(value) {
  if (
    !Array.isArray(value) ||
    value.length > verificationRiskRegistry.length ||
    value.some(
      (entry, index) =>
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        Object.keys(entry).sort().join("\n") !== "fingerprint\npath\nriskId" ||
        !digestPattern.test(entry.fingerprint) ||
        !pathPattern.test(entry.path) ||
        !riskIdPattern.test(entry.riskId) ||
        (index > 0 && riskKey(value[index - 1]) >= riskKey(entry)),
    )
  ) {
    throw new Error("Verification evidence contains invalid named risk fingerprints.");
  }
  return Object.freeze(value.map((entry) => Object.freeze({ ...entry })));
}

export function verificationRiskFingerprint({ buffer, path, prefix, riskId }) {
  return Object.freeze({
    fingerprint: createHash("sha256")
      .update("verification-risk-v1\0")
      .update(riskId)
      .update("\0")
      .update(prefix)
      .update(buffer)
      .update("\0")
      .digest("hex"),
    path,
    riskId,
  });
}

export function changedVerificationRisks(previous, current) {
  const previousRisks = new Map(
    normalizedVerificationRiskFingerprints(previous).map((risk) => [riskKey(risk), risk]),
  );
  const currentRisks = new Map(
    normalizedVerificationRiskFingerprints(current).map((risk) => [riskKey(risk), risk]),
  );
  const changed = [];
  for (const key of [...new Set([...previousRisks.keys(), ...currentRisks.keys()])].sort()) {
    const before = previousRisks.get(key);
    const after = currentRisks.get(key);
    if (before?.fingerprint === after?.fingerprint) continue;
    const risk = after ?? before;
    changed.push(Object.freeze({ path: risk.path, riskId: risk.riskId }));
  }
  return Object.freeze(changed);
}

export function verificationBasisProfileRisks(basis, inputs, { focusedCommandOwners = [] } = {}) {
  if (!basis?.trusted || !basis.current) {
    return Object.freeze({ covered: Object.freeze([]), uncovered: Object.freeze([]) });
  }
  const ownersByPath = new Map(
    focusedCommandOwners.map((entry) => [entry.path, [...entry.ownerKeys].sort()]),
  );
  const covered = [];
  const uncovered = [];
  for (const risk of changedVerificationRisks(
    basis.current.riskFingerprints,
    inputs.riskFingerprints,
  )) {
    const ownerKeys = ownersByPath.get(risk.path) ?? [];
    const finding = Object.freeze({
      ...risk,
      ownerKeys: Object.freeze(ownerKeys),
      reason: `${risk.riskId} changed at ${risk.path}`,
    });
    (ownerKeys.length > 0 ? covered : uncovered).push(finding);
  }
  if (basis.current.planDigest !== inputs.planDigest) {
    uncovered.push(
      Object.freeze({
        ownerKeys: Object.freeze([]),
        path: "<verification-plan>",
        reason: "the ordered broad command plan changed",
        riskId: "broad-plan-coverage",
      }),
    );
  }
  if (basis.current.runtimeDigest !== inputs.runtimeDigest) {
    uncovered.push(
      Object.freeze({
        ownerKeys: Object.freeze([]),
        path: "<verification-runtime>",
        reason: "the effective verification tool runtime changed",
        riskId: "tool-runtime-coverage",
      }),
    );
  }
  return Object.freeze({
    covered: Object.freeze(covered),
    uncovered: Object.freeze(uncovered),
  });
}
