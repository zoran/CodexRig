import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";
import test from "node:test";
import { buildRiskBoundPlan, parseArgs } from "./adaptive.mjs";
import { buildPlan } from "./adaptive-runner.mjs";
import { decideVerificationAdmission, omitAlreadyCoveredPaths } from "./verification-admission.mjs";
import { printPlan } from "./verification-executor.mjs";

const productLayout = {
  findings: [],
  sourceRoots: ["src"],
  units: [
    {
      declaredBy: "fixture",
      kind: "default",
      root: ".",
      sourceRoots: ["src"],
      surfaceRoot: "src",
    },
  ],
};

test("cache bypass and incomplete force requests fail before planning", () => {
  assert.throws(() => parseArgs(["--no-cache"]), /forbidden/u);
  assert.throws(() => parseArgs(["--path", "src/product.ts"]), /--path requires --print-plan/u);
  assert.throws(() => parseArgs(["--path=src/product.ts"]), /--path requires --print-plan/u);
  assert.throws(() => parseArgs(["--force-full"]), /owner-request.*uncovered-risk/u);
  assert.throws(
    () => parseArgs(["--force-full", "--force-reason", "tests failed"]),
    /owner-request.*uncovered-risk/u,
  );
  for (const reason of [
    "owner-request: project-owner - full coverage because aggregate tests failed",
    "uncovered-risk: invented-risk - retry after cache miss and failed test",
    "owner-request: project-owner - full coverage because profile miss",
  ]) {
    assert.throws(
      () => parseArgs(["--force-full", "--force-reason", reason]),
      /prior failure or cache miss is not sufficient/u,
    );
  }
  assert.throws(
    () => parseArgs(["--force-full", "--force-reason", "risk foo bar"]),
    /owner-request.*uncovered-risk/u,
  );
  assert.throws(
    () => parseArgs(["--force-full", "--force-reason", "architecture validation request"]),
    /owner-request.*uncovered-risk/u,
  );
  assert.throws(
    () =>
      parseArgs([
        "--force-full",
        "--force-reason",
        "retry after authentication integration tests failed",
      ]),
    /owner-request.*uncovered-risk/u,
  );
  assert.throws(
    () => parseArgs(["--force-reason", "authentication upgrade risk"]),
    /requires --force-full/u,
  );
});

test("the adaptive flow resolves risks before binding an uncovered-risk force request", () => {
  const options = parseArgs([
    "--force-full",
    "--force-reason",
    "uncovered-risk: verification-admission - cross-owner admission contract coverage",
  ]);
  let observedOwnerCount = 0;
  const plan = buildRiskBoundPlan(
    options,
    {
      basis: { reason: "", trusted: true },
      changedScope: {
        basisChanged: false,
        incomplete: false,
        paths: ["scripts/verify/verification-admission.mjs"],
        reason: "fixture",
      },
      productLayout,
      repositoryRoot: process.cwd(),
      workspaceManifests: [],
    },
    { planDigest: "plan", riskFingerprints: [], runtimeDigest: "runtime" },
    (_basis, _inputs, { focusedCommandOwners }) => {
      observedOwnerCount = focusedCommandOwners.length;
      return {
        covered: [],
        uncovered: [
          {
            ownerKeys: [],
            path: "scripts/verify/verification-admission.mjs",
            reason: "cross-owner admission contract changed",
            riskId: "verification-admission",
          },
        ],
      };
    },
  );
  assert.ok(observedOwnerCount > 0);
  assert.equal(plan.admission.mode, "full");
  assert.match(plan.admission.reason, /uncovered-risk: verification-admission/u);
});

test("forced uncovered risks must name a currently uncovered registered risk", () => {
  const base = {
    basis: { reason: "", trusted: true },
    changed: { basisChanged: false, incomplete: false, paths: [], reason: "" },
    coveredBroadRisks: [],
    forceFull: true,
    ownersByPath: [],
    productLayout,
  };
  assert.throws(
    () =>
      decideVerificationAdmission({
        ...base,
        broadOnlyRisks: [],
        forceReason: "uncovered-risk: invented-risk - concrete architecture invariant coverage",
      }),
    /not present in the current uncovered risk registry/u,
  );
  assert.equal(
    decideVerificationAdmission({
      ...base,
      broadOnlyRisks: [
        {
          path: "scripts/verify/adaptive.mjs",
          reason: "cross-owner admission contract changed",
          riskId: "verification-admission",
        },
      ],
      forceReason:
        "uncovered-risk: verification-admission - cross-owner admission contract coverage",
    }).mode,
    "full",
  );
});

test("explicit force requires a concrete reason and produces a marked full plan", () => {
  const options = parseArgs([
    "--force-full",
    "--force-reason",
    "owner-request: project-owner - authentication boundary upgrade coverage",
  ]);
  const plan = buildPlan(options, {
    basis: { reason: "", trusted: true },
    changedPaths: ["docs/project.md"],
    gitAvailable: true,
    productLayout,
    workspaceManifests: [],
  });
  assert.equal(plan.admission.mode, "full");
  assert.match(plan.admission.reason, /owner forced full coverage: owner-request/u);
});

test("missing successful basis is a concrete full admission rather than a cache-miss retry", () => {
  const plan = buildPlan(parseArgs(["--mode", "full"]), {
    basis: { reason: "evidence file is missing", trusted: false },
    changedPaths: ["docs/project.md"],
    gitAvailable: true,
    productLayout,
    workspaceManifests: [],
  });
  assert.equal(plan.admission.mode, "full");
  assert.match(plan.admission.reason, /^no trusted successful basis:/u);
});

test("cache and profile misses alone cannot broaden a fully owned delta", () => {
  const plan = buildPlan(parseArgs(["--mode", "full"]), {
    basis: { reason: "", trusted: true },
    cacheMiss: true,
    changedPaths: ["src/product.ts"],
    gitAvailable: true,
    productLayout,
    profileMiss: true,
    workspaceManifests: [
      {
        directory: ".",
        internalDependencyNames: {
          dependencies: [],
          devDependencies: [],
          optionalDependencies: [],
          peerDependencies: [],
        },
        name: "fixture",
        scripts: { "test:unit": "unit" },
      },
    ],
  });
  assert.equal(plan.admission.mode, "targeted");
  assert.deepEqual(plan.admission.uncoveredFullRelevantPaths, []);
});

test("a deleted test path routes to surviving orchestration owners", () => {
  const removedPath = "scripts/verify/removed-owner.test.mjs";
  const plan = buildPlan(parseArgs(["--mode", "full"]), {
    basis: { reason: "", trusted: true },
    changedPaths: [removedPath],
    gitAvailable: true,
    productLayout,
    repositoryRoot: process.cwd(),
    workspaceManifests: [],
  });
  assert.equal(plan.admission.mode, "targeted");
  assert.equal(
    plan.readOnlyCommands.some((command) => command.args.includes(removedPath)),
    false,
  );
  assert.equal(
    plan.readOnlyCommands.some(
      (command) => command.key === "verification-orchestration-regressions",
    ),
    true,
  );

  const removedManifest = buildPlan(parseArgs(["--mode", "full"]), {
    basis: { reason: "", trusted: true },
    changedPaths: ["packages/removed/package.json"],
    gitAvailable: true,
    productLayout,
    repositoryRoot: process.cwd(),
    workspaceManifests: [],
  });
  assert.equal(removedManifest.admission.mode, "targeted");
  assert.equal(
    removedManifest.readOnlyCommands.some((command) => command.key.startsWith("focused-manifest:")),
    false,
  );
});

test("an exact-current dirty Git basis does not rerun its already covered paths", () => {
  const inputs = {
    broadFingerprint: "broad",
    exactFingerprint: "exact",
    planDigest: "plan",
    runtimeDigest: "runtime",
  };
  const changedScope = {
    basisChanged: false,
    incomplete: false,
    paths: ["src/already-covered.ts"],
    reason: "",
  };
  assert.deepEqual(
    omitAlreadyCoveredPaths({
      basis: {
        current: {
          broadFingerprint: inputs.broadFingerprint,
          fingerprint: inputs.exactFingerprint,
          planDigest: inputs.planDigest,
          runtimeDigest: inputs.runtimeDigest,
        },
        trusted: true,
      },
      changedScope,
      expectedInputs: inputs,
    }).paths,
    [],
  );
  assert.deepEqual(
    omitAlreadyCoveredPaths({
      basis: {
        current: {
          broadFingerprint: inputs.broadFingerprint,
          fingerprint: "older",
          planDigest: inputs.planDigest,
          runtimeDigest: inputs.runtimeDigest,
        },
        trusted: true,
      },
      changedScope,
      expectedInputs: inputs,
    }).paths,
    ["src/already-covered.ts"],
  );
});

test("unclassified exact fingerprint drift fails closed to a full plan", () => {
  const inputs = {
    broadFingerprint: "broad",
    exactFingerprint: "changed-exact",
    planDigest: "plan",
    runtimeDigest: "runtime",
  };
  const basis = {
    current: {
      broadFingerprint: inputs.broadFingerprint,
      fingerprint: "published-exact",
      planDigest: inputs.planDigest,
      runtimeDigest: inputs.runtimeDigest,
    },
    trusted: true,
  };
  const changedScope = omitAlreadyCoveredPaths({
    basis,
    changedScope: { basisChanged: false, incomplete: false, paths: [], reason: "" },
    expectedInputs: inputs,
  });
  assert.equal(changedScope.incomplete, true);
  assert.match(changedScope.reason, /fingerprint changed without a classified Git delta/u);
  const plan = buildPlan(parseArgs(["--mode", "repo"]), {
    basis,
    changedScope,
    gitAvailable: true,
    productLayout,
    workspaceManifests: [],
  });
  assert.equal(plan.admission.mode, "full");
  assert.match(plan.admission.reason, /changed-path classification is incomplete/u);
});

test("print plan exposes admission paths, owners, reason, and basis advancement", () => {
  const plan = buildPlan(parseArgs(["--print-plan", "--path", "docs/project.md"]), {
    basis: { reason: "", trusted: true },
    gitAvailable: true,
    productLayout,
    workspaceManifests: [],
  });
  const output = [];
  const original = console.log;
  console.log = (...values) => output.push(values.join(" "));
  try {
    printPlan(plan);
  } finally {
    console.log = original;
  }
  const text = output.join("\n");
  assert.match(text, /Admission mode: targeted/u);
  assert.match(text, /Full-relevant paths: none/u);
  assert.match(text, /Unknown paths: none/u);
  assert.match(text, /Uncovered full-relevant paths: none/u);
  assert.match(text, /Focused command owners:/u);
  assert.match(text, /Successful basis can advance: yes/u);
});

test("importing adaptive CLI is side-effect free", () => {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", 'await import("./scripts/verify/adaptive.mjs")'],
    { cwd: process.cwd(), encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
