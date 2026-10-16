/** Verifies verification evidence behavior for the repository verification boundary. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import {
  VerificationEvidenceError,
  readSuccessfulVerificationBasis,
  recordSuccessfulFullEvidence,
  verificationEvidenceCachePath,
} from "./verification-evidence.mjs";
import { omitAlreadyCoveredPaths } from "./verification-admission.mjs";
import { resolveDeliveryArtifactBinding } from "./delivery-artifact.mjs";
import {
  broadPlan,
  cleanupTemporaryEvidenceRoots,
  configureDeliveryFixture,
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

test("Git-basis refresh cannot accept documentation or verifier source deltas", () => {
  for (const relativePath of ["docs/project.md", "scripts/verify/adaptive.mjs"]) {
    const root = fixture();
    record(root);
    const initial = readFileSync(verificationEvidenceCachePath(root));
    writeFileSync(path.join(root, relativePath), "// Unverified changed content\n", "utf8");
    const result = refresh(root);
    assert.equal(result.refreshed, false);
    assert.match(result.reason, /cannot accept changed source, plan, runtime or delivery inputs/u);
    assert.deepEqual(readFileSync(verificationEvidenceCachePath(root)), initial);
    assert.throws(() => validate(root), VerificationEvidenceError);
  }
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
  const result = refresh(root, expectedInputs);
  assert.equal(result.refreshed, true, result.reason);
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
  assert.throws(
    () =>
      validate(root, {
        broadPlan: broadPlan.map((command) => ({ ...command, diagnosticAfterMs: 1000 })),
      }),
    (error) =>
      error instanceof VerificationEvidenceError &&
      error.findings.includes("broad command plan changed"),
  );
});

test("verification evidence cannot cross delivery targets or artifact identities", () => {
  const root = fixture();
  record(root);
  const staging = configureDeliveryFixture(root, "staging");
  assert.throws(
    () =>
      validate(root, {
        artifactManifest: staging.artifactManifest,
        deliveryEnvironment: "staging",
      }),
    (error) =>
      error instanceof VerificationEvidenceError &&
      error.findings.includes("delivery target or artifact changed"),
  );
  assert.throws(() => inputs(root, { deliveryEnvironment: "prod" }), /artifact-manifest/u);
});

test("stronger-target evidence derives its artifact, configuration, and command identities", () => {
  const root = fixture();
  const staging = configureDeliveryFixture(root, "staging");
  const binding = resolveDeliveryArtifactBinding({
    root,
    artifactManifest: staging.artifactManifest,
    targetEnvironment: "staging",
  });
  assert.match(binding.artifactDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(binding.configurationDigest, /^[a-f0-9]{64}$/u);
  assert.match(binding.deliveryPlanDigest, /^[a-f0-9]{64}$/u);
  assert.equal(binding.verificationCommand.key, "delivery:staging");
  assert.equal(binding.verificationCommand.phase, "delivery");
  assert.ok(binding.verificationCommand.args.includes("verify:staging"));

  const evidenceInputs = inputs(root, {
    artifactManifest: staging.artifactManifest,
    broadPlan: [...broadPlan, binding.verificationCommand],
    deliveryEnvironment: "staging",
  });
  assert.equal(evidenceInputs.artifactDigest, binding.artifactDigest);
  assert.equal(evidenceInputs.configurationDigest, binding.configurationDigest);
  assert.equal(evidenceInputs.deliveryPlanDigest, binding.deliveryPlanDigest);

  chmodSync(path.join(root, staging.artifactPath), 0o755);
  const executableBinding = resolveDeliveryArtifactBinding({
    root,
    artifactManifest: staging.artifactManifest,
    targetEnvironment: "staging",
  });
  assert.notEqual(executableBinding.artifactDigest, binding.artifactDigest);
  chmodSync(path.join(root, staging.artifactPath), 0o644);

  const targetPlan = [...broadPlan, binding.verificationCommand];
  const lock = acquireVerificationSessionLock({ repositoryRoot: root });
  try {
    assert.throws(
      () =>
        recordSuccessfulFullEvidence({
          root,
          artifactManifest: staging.artifactManifest,
          broadPlan: targetPlan,
          deliveryEnvironment: "staging",
          expectedGitBasis: captureVerificationGitBasis({ repositoryRoot: root }),
          expectedInputs: evidenceInputs,
          runtimeIdentity,
          successfulCommandKeys: broadPlan.map((command) => command.key),
        }),
      /missing successful commands: delivery:staging/u,
    );
  } finally {
    lock.release();
  }

  writeFileSync(path.join(root, staging.artifactPath), "mutated artifact\n", "utf8");
  assert.throws(
    () =>
      resolveDeliveryArtifactBinding({
        root,
        artifactManifest: staging.artifactManifest,
        targetEnvironment: "staging",
      }),
    /digest does not match current bytes/u,
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
