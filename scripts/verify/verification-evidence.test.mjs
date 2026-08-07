import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import {
  VerificationEvidenceError,
  readSuccessfulVerificationBasis,
  recordSuccessfulFullEvidence,
  refreshExactAttestationAfterPreflight,
  verificationEvidenceCachePath,
} from "./verification-evidence.mjs";
import { omitAlreadyCoveredPaths } from "./verification-admission.mjs";
import {
  broadPlan,
  cleanupTemporaryEvidenceRoots,
  fixture,
  inputs,
  overwriteEvidence,
  record,
  refresh,
  runtimeIdentity,
  validate,
} from "./verification-evidence-test-helpers.mjs";
import {
  captureVerificationGitBasis,
  changedPathsSinceVerificationBasis,
} from "./verification-git-basis.mjs";
import { acquireVerificationSessionLock } from "./verification-session-lock.mjs";

after(cleanupTemporaryEvidenceRoots);

test("full evidence requires every command in the admitted broad plan to succeed", () => {
  const root = fixture();
  const expectedInputs = inputs(root);
  const expectedGitBasis = captureVerificationGitBasis({ repositoryRoot: root });
  const lock = acquireVerificationSessionLock({ repositoryRoot: root });
  try {
    assert.throws(
      () =>
        recordSuccessfulFullEvidence({
          root,
          broadPlan,
          expectedGitBasis,
          expectedInputs,
          runtimeIdentity,
          successfulCommandKeys: [broadPlan[0].key],
        }),
      /missing successful commands: workspace:build/u,
    );
  } finally {
    lock.release();
  }
});

test("focused owner coverage advances exact-current evidence without another broad run", () => {
  const root = fixture();
  record(root);
  const initial = validate(root).record;
  writeFileSync(path.join(root, "docs/project.md"), "# Focused documentation change\n", "utf8");
  const result = refresh(root);
  assert.equal(result.refreshed, true, result.reason);
  const current = validate(root).record;
  assert.equal(current.transitionCount, 1);
  assert.deepEqual(current.foundation, initial.foundation);
  assert.notEqual(current.current.fingerprint, initial.current.fingerprint);
});

test("an unrelated successful command cannot cover a changed path", () => {
  const root = fixture();
  record(root);
  writeFileSync(path.join(root, "docs/project.md"), "# Needs its owner\n", "utf8");
  const result = refresh(root, inputs(root), {
    successfulCommandKeys: [broadPlan[1].key],
  });
  assert.equal(result.refreshed, false);
  assert.match(result.reason, /lacks successful focused owner coverage/u);
  assert.throws(() => validate(root), VerificationEvidenceError);
});

test("committing attested dirty content advances only the Git basis without verifier coverage", () => {
  const root = fixture();
  writeFileSync(path.join(root, "docs/project.md"), "# Verified dirty content\n", "utf8");
  record(root);
  const basis = readSuccessfulVerificationBasis({ broadPlan, root });
  for (const args of [
    ["add", "."],
    ["commit", "-qm", "materialize verified content"],
  ]) {
    const committed = spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    });
    assert.equal(committed.status, 0, committed.stderr);
  }
  const expectedInputs = inputs(root);
  const changedScope = changedPathsSinceVerificationBasis(basis.current.gitBasis, {
    repositoryRoot: root,
  });
  assert.deepEqual(changedScope.paths, ["docs/project.md"]);
  assert.equal(changedScope.basisChanged, true);
  const covered = omitAlreadyCoveredPaths({
    basis,
    changedScope,
    expectedInputs,
  });
  assert.deepEqual(covered.paths, []);
  assert.deepEqual(
    omitAlreadyCoveredPaths({
      basis,
      changedScope: {
        ...changedScope,
        paths: [...changedScope.paths, "unexpected/unattested-path"],
      },
      expectedInputs,
    }).paths,
    ["docs/project.md", "unexpected/unattested-path"],
  );
  const result = refresh(root, expectedInputs, {
    basisChanged: true,
    focusedCommandOwners: [],
    paths: [],
    successfulCommandKeys: [],
  });
  assert.equal(result.refreshed, true, result.reason);
  assert.equal(validate(root).valid, true);
});

test("changed repository state cannot advance without complete path ownership", () => {
  const root = fixture();
  record(root);
  writeFileSync(path.join(root, "docs/project.md"), "# Uncovered\n", "utf8");
  const expectedInputs = inputs(root);
  const expectedGitBasis = captureVerificationGitBasis({ repositoryRoot: root });
  const basis = readSuccessfulVerificationBasis({ broadPlan, root });
  const lock = acquireVerificationSessionLock({ repositoryRoot: root });
  try {
    const result = refreshExactAttestationAfterPreflight({
      root,
      broadPlan,
      coverage: {
        basisChanged: true,
        broadRisks: [],
        complete: true,
        focusedCommandOwners: [],
        paths: expectedGitBasis.dirtyPaths,
      },
      expectedBasisToken: basis.token,
      expectedGitBasis,
      expectedInputs,
      runtimeIdentity,
      successfulCommandKeys: [],
    });
    assert.equal(result.refreshed, false);
    assert.match(result.reason, /lacks successful focused owner coverage/u);
  } finally {
    lock.release();
  }
});

test("named broad-risk changes require their successful focused owner", () => {
  const root = fixture();
  record(root);
  writeFileSync(
    path.join(root, "scripts/verify/adaptive.mjs"),
    "export const changedAdmission = true;\n",
    "utf8",
  );
  const uncovered = refresh(root);
  assert.equal(uncovered.refreshed, false);
  assert.match(uncovered.reason, /named broad risk adaptive-entrypoint/u);

  const covered = refresh(root, inputs(root), {
    broadRisks: [
      {
        ownerKeys: [broadPlan[0].key],
        path: "scripts/verify/adaptive.mjs",
        riskId: "adaptive-entrypoint",
      },
    ],
  });
  assert.equal(covered.refreshed, true, covered.reason);
  assert.equal(validate(root).valid, true);
});

test("broad plan and tool-runtime drift invalidate successful evidence", () => {
  const root = fixture();
  record(root);
  const revisedPlan = [
    ...broadPlan,
    {
      args: ["--test", "src/integration.test.mjs"],
      executable: "node",
      key: "integration-regressions",
      phase: "workspace-test",
    },
  ];
  assert.throws(
    () => validate(root, { broadPlan: revisedPlan }),
    (error) =>
      error instanceof VerificationEvidenceError &&
      error.findings.includes("broad command plan changed"),
  );
  assert.throws(
    () => validate(root, { runtimeIdentity: { ...runtimeIdentity, node: "fixture-node-next" } }),
    (error) =>
      error instanceof VerificationEvidenceError && error.findings.includes("tool runtime changed"),
  );
});

test("tampered or incomplete evidence fails closed", () => {
  {
    const root = fixture();
    record(root);
    const evidencePath = verificationEvidenceCachePath(root);
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    evidence.current.fingerprint = "f".repeat(64);
    overwriteEvidence(root, `${JSON.stringify(evidence)}\n`);
    assert.throws(() => validate(root), /record digest/u);
    assert.equal(readSuccessfulVerificationBasis({ broadPlan, root }).trusted, false);
  }
  {
    const root = fixture();
    record(root);
    overwriteEvidence(root, '{"schemaVersion":1}\n');
    assert.throws(() => validate(root), VerificationEvidenceError);
  }
});
