/** Verifies generated policy parity, adaptation gates and launcher identity across child upgrades. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { applyFrameworkUpgrade, buildFrameworkUpgradePlan } from "./framework-upgrade.mjs";
import { selectedProjectVerification } from "./project-tool-selection.mjs";
import {
  cleanupTemporaryRoots,
  isolatedTrackedFrameworkSource,
  runProjectGenerator,
  temporaryRoot,
} from "../setup/project-initialization-test-helpers.mjs";

const toolingPath = ".codex/tooling.json";
const verificationPath = ".codex/verification.json";
const readTooling = (root) => JSON.parse(readFileSync(path.join(root, toolingPath), "utf8"));
const writeTooling = (root, configuration) =>
  writeFileSync(path.join(root, toolingPath), JSON.stringify(configuration, null, 2) + "\n");
after(cleanupTemporaryRoots);

function fixture() {
  const sourceRoot = isolatedTrackedFrameworkSource("identity-source-");
  const parent = temporaryRoot("identity-product-");
  const created = runProjectGenerator([
    "--source",
    sourceRoot,
    "--name",
    "Cedar Product",
    "--directory",
    "cedar",
    "--output-parent",
    parent,
  ]);
  assert.equal(created.status, 0, created.stderr);
  const baselineRoot = path.join(parent, "cedar/code");
  const targetRoot = path.join(parent, "target");
  cpSync(baselineRoot, targetRoot, { recursive: true });
  return { sourceRoot, targetRoot, baselineRoot };
}

test("project verification projects canonical dependencies without adding blanket consumers", () => {
  const command = {
    key: "module-check",
    label: "Module contract",
    executable: "node",
    args: ["--test", "scripts/module.test.mjs"],
    reuseMaxAgeMs: 30_000,
    outputs: ["dist/module-result.json"],
  };
  const projected = selectedProjectVerification(
    {
      schemaVersion: 1,
      commands: [command, { key: "source-only" }],
      risks: [],
      sharedInputs: ["scripts/module.mjs", "scripts/omitted.mjs"],
      workspaceOutputs: { "packages/core": { build: ["dist/index.js"] } },
      testConsumers: {
        "scripts/module.mjs": ["scripts/module.test.mjs", "scripts/omitted.test.mjs"],
        "scripts/setup/runtime.mjs": ["scripts/setup/runtime-safety.test.mjs"],
        "scripts/omitted.mjs": ["scripts/setup/runtime-safety.test.mjs"],
      },
      exactConsumers: {
        "scripts/module.mjs": ["module-check", "source-only"],
        "scripts/omitted.mjs": ["module-check"],
      },
      ownedCategories: { "framework scripts": ["module-check", "source-only"] },
    },
    {
      verificationCommands: ["module-check"],
      files: [
        "scripts/module.mjs",
        "scripts/module.test.mjs",
        "scripts/setup/runtime.mjs",
        "scripts/setup/runtime-safety.test.mjs",
      ],
    },
  );
  assert.deepEqual(projected.testConsumers, {
    "scripts/module.mjs": ["scripts/module.test.mjs"],
    "scripts/setup/runtime.mjs": ["scripts/setup/runtime-safety.test.mjs"],
  });
  assert.deepEqual(projected.exactConsumers, { "scripts/module.mjs": ["module-check"] });
  assert.deepEqual(projected.commands, [command]);
  assert.deepEqual(projected.sharedInputs, ["scripts/module.mjs"]);
  assert.deepEqual(projected.workspaceOutputs, {
    "packages/core": { build: ["dist/index.js"] },
  });
  assert.deepEqual(projected.ownedCategories, { "framework scripts": ["module-check"] });
});

test("current-output review preserves fresh policy parity and intentional policy/tooling adaptations", () => {
  const { sourceRoot, targetRoot } = fixture();
  const options = { sourceRoot, targetRoot };
  const initial = buildFrameworkUpgradePlan(options);
  assert.deepEqual(initial.conflicts, []);
  assert.deepEqual(initial.operations, []);
  assert.deepEqual(initial.differences, []);

  // Real generation formats shared policy; review must match it without normalizing child edits.
  const instructionsPath = path.join(targetRoot, "instructions.md");
  const originalInstructions = readFileSync(instructionsPath, "utf8");
  const originalMode = statSync(instructionsPath).mode & 0o777;
  const adaptedInstructions = `${originalInstructions}\nPreserve the product's reviewed policy.\n`;
  writeFileSync(instructionsPath, adaptedInstructions);
  const policy = buildFrameworkUpgradePlan(options);
  assert.deepEqual(policy.conflicts, ["instructions.md"]);
  const { kind, ...binding } = policy.differences[0];
  const resolutions = [{ ...binding, action: "keep", reason: "Retain reviewed product policy." }];
  const kept = buildFrameworkUpgradePlan({ ...options, resolutions });
  assert.deepEqual(kept.conflicts, []);
  assert.deepEqual(kept.operations, []);
  assert.deepEqual(
    kept.deviations.map(({ path: file }) => file),
    ["instructions.md"],
  );
  assert.equal(readFileSync(instructionsPath, "utf8"), adaptedInstructions);
  writeFileSync(instructionsPath, `${adaptedInstructions}\n`);
  assert.throws(
    () => buildFrameworkUpgradePlan({ ...options, resolutions }),
    /Stale reconciliation decision: instructions\.md/u,
  );
  writeFileSync(instructionsPath, adaptedInstructions);
  chmodSync(instructionsPath, originalMode ^ 0o100);
  assert.throws(
    () => buildFrameworkUpgradePlan({ ...options, resolutions }),
    /Stale reconciliation decision: instructions\.md/u,
  );
  chmodSync(instructionsPath, originalMode);
  writeFileSync(instructionsPath, originalInstructions);

  const tooling = readTooling(targetRoot);
  tooling.startup.displayName = "Cedar Workshop";
  writeTooling(targetRoot, tooling);
  assert.deepEqual(buildFrameworkUpgradePlan(options).differences, []);

  tooling.startup.attestationMaxAgeSeconds += 60;
  writeTooling(targetRoot, tooling);
  const adapted = buildFrameworkUpgradePlan(options);
  assert.deepEqual(adapted.conflicts, [toolingPath]);
  assert.deepEqual(adapted.operations, []);
  assert.deepEqual(readTooling(targetRoot), tooling);
});

test("baseline-backed tooling updates retain the child's launcher name and converge", async () => {
  const options = fixture();
  const sourceTooling = readTooling(options.sourceRoot);
  sourceTooling.startup.attestationMaxAgeSeconds += 60;
  writeTooling(options.sourceRoot, sourceTooling);
  const plan = buildFrameworkUpgradePlan(options);
  assert.deepEqual(plan.conflicts, []);
  const operation = plan.operations.find(({ path: file }) => file === toolingPath);
  assert.equal(JSON.parse(operation.content).startup.displayName, "Cedar Product");
  await applyFrameworkUpgrade(plan);
  assert.deepEqual(readTooling(options.targetRoot).startup, {
    ...sourceTooling.startup,
    displayName: "Cedar Product",
  });
  assert.deepEqual(buildFrameworkUpgradePlan(options).operations, []);
  const current = buildFrameworkUpgradePlan({
    sourceRoot: options.sourceRoot,
    targetRoot: options.targetRoot,
  });
  assert.deepEqual(current.conflicts, []);
  assert.deepEqual(current.operations, []);
});

test("present tooling identity is validated while absent tooling retains its existing fallback", () => {
  const options = fixture();
  const tooling = readTooling(options.targetRoot);
  tooling.startup.displayName = "";
  writeTooling(options.targetRoot, tooling);
  for (const baselineRoot of [undefined, options.baselineRoot])
    assert.throws(
      () => buildFrameworkUpgradePlan({ ...options, baselineRoot }),
      /startup\.displayName must be a non-empty string/u,
    );

  rmSync(path.join(options.targetRoot, toolingPath));
  for (const regenerate of [false, true]) {
    const missing = buildFrameworkUpgradePlan({ ...options, baselineRoot: undefined, regenerate });
    assert.deepEqual(missing.conflicts, []);
    const operation = missing.operations.find(({ path: file }) => file === toolingPath);
    assert.equal(JSON.parse(operation.content).startup.displayName, "Project");
  }
  assert.deepEqual(buildFrameworkUpgradePlan(options).conflicts, [toolingPath]);
});

function addProductCheck(root) {
  const configuration = JSON.parse(readFileSync(path.join(root, verificationPath), "utf8"));
  configuration.commands.push({
    key: "product-probe",
    label: "Product module contract",
    executable: "$node",
    args: ["--test", "src/probe.test.mjs"],
    phase: "preflight",
    reason: "The project owns its module contract.",
    reuseMaxAgeMs: 60_000,
    outputs: ["dist/probe-result.json"],
  });
  configuration.workspaceOutputs = { "packages/core": { build: ["dist/index.js"] } };
  configuration.exactConsumers["src/probe.mjs"] = ["product-probe"];
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src/probe.mjs"), "export const value = 42;\n");
  writeFileSync(
    path.join(root, "src/probe.test.mjs"),
    'import assert from "node:assert/strict";\n' +
      'import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";\n' +
      'import { value } from "./probe.mjs";\n' +
      "assert.equal(value, 42);\n" +
      'mkdirSync("dist", { recursive: true });\n' +
      'writeFileSync("dist/probe-result.json", JSON.stringify({ value }));\n' +
      'appendFileSync(".codex/runtime/probe-dispatches", "run\\n");\n',
  );
  writeFileSync(path.join(root, verificationPath), JSON.stringify(configuration, null, 2) + "\n");
  return configuration;
}

function observeProductDispatches(root) {
  mkdirSync(path.join(root, ".codex/runtime"), { recursive: true });
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildFocusedVerification } from "./scripts/verify/verification-admission.mjs";
import { runPlan } from "./scripts/verify/verification-executor.mjs";
import { withVerificationSessionLock } from "./scripts/verify/verification-session-lock.mjs";
import { readVerificationConfiguration } from "./scripts/verify/verification-configuration.mjs";
import { pendingVerificationPlan, verificationCheckFingerprints } from "./scripts/verify/verification-check-inputs.mjs";
import { digest } from "./scripts/verify/verification-record-helpers.mjs";
const configuration = readVerificationConfiguration();
const commands = configuration.commands.filter(command => command.key === "product-probe");
const classifiedPaths = [{path: "src/probe.mjs", categories: ["app/package/service/runtime source"]}];
const focused = buildFocusedVerification({classifiedPaths, completeCommands: commands, repositoryRoot: process.cwd(), workspaceManifests: []});
assert.deepEqual(focused.readOnlyCommands.map(command => command.key), ["product-probe"]);
const inputs = {
  runtimeDigest: digest(process.version + process.platform + process.arch),
  sourceFiles: ["src/probe.mjs", "src/probe.test.mjs"].map(path => {
    const fingerprint = digest(readFileSync(path));
    return {path, fingerprint, semanticFingerprint: fingerprint};
  }),
};
const fingerprints = verificationCheckFingerprints({commands, inputs, configuration, repositoryRoot: process.cwd(), workspaceManifests: []});
const plan = { ...focused, classifiedPaths, verificationScope: "targeted", options: {mode: "repo", printPlan: false, simulatedPaths: []}, admission: {mode: "targeted", reason: "Project module fixture"} };
const checks = [], dispatches = [];
await withVerificationSessionLock(async () => {
for (let attempt = 0; attempt < 2; attempt++) {
  const result = await runPlan(pendingVerificationPlan(plan, fingerprints, checks, {repositoryRoot: process.cwd()}), {
    onResult(result) {
      assert.equal(result.status, 0);
      assert.match(result.outputFingerprint, /^[a-f0-9]{64}$/);
      checks.push({key: result.command.key, fingerprint: fingerprints.get(result.command.key), completedAt: new Date().toISOString(), elapsedMs: result.elapsedMs, outputFingerprint: result.outputFingerprint});
    },
  });
  dispatches.push(result.successfulCommandKeys.length);
}
}, {repositoryRoot: process.cwd()});
assert.deepEqual(dispatches, [1, 0]);
assert.equal(readFileSync(".codex/runtime/probe-dispatches", "utf8"), "run\\n");
console.log("PRODUCT_DISPATCHES=" + JSON.stringify({dispatches, elapsedMs: checks.map(check => check.elapsedMs)}));
`,
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, PROJECT_TOOL_STORAGE_HOME: temporaryRoot("product-check-tools-") },
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const observation = result.stdout.match(/PRODUCT_DISPATCHES=(.+)/u);
  assert.ok(observation, result.stdout);
  return JSON.parse(observation[1]);
}

test("generated and reviewed-updated projects reuse dispatched checks and preserve custom contracts", async (t) => {
  const { sourceRoot, targetRoot, baselineRoot } = fixture();
  const current = addProductCheck(baselineRoot);
  const generated = observeProductDispatches(baselineRoot);

  const adapted = addProductCheck(targetRoot);
  for (const consumers of Object.values(adapted.testConsumers))
    if (!consumers.includes("scripts/setup/runtime-safety.test.mjs"))
      consumers.push("scripts/setup/runtime-safety.test.mjs");
  writeFileSync(path.join(targetRoot, verificationPath), JSON.stringify(adapted, null, 2) + "\n");
  const executorPath = "scripts/verify/verification-check-inputs.mjs";
  writeFileSync(path.join(targetRoot, executorPath), 'throw new Error("legacy executor");\n');
  const requirements = "# Product requirements\n\nPreserve the customer's module contract.\n";
  writeFileSync(path.join(targetRoot, "docs/requirements.md"), requirements);

  const options = { sourceRoot, targetRoot };
  const preview = buildFrameworkUpgradePlan(options);
  assert.deepEqual(preview.conflicts, [verificationPath, executorPath]);
  assert.deepEqual(preview.operations, []);
  const resolutions = preview.differences.map(({ kind, ...binding }) =>
    binding.path === verificationPath
      ? {
          ...binding,
          action: "replace",
          reason: "Apply current dependency ownership while retaining the project check.",
          content: JSON.stringify(current, null, 2) + "\n",
          mode: 0o644,
        }
      : { ...binding, action: "source", reason: "Adopt the current modular verifier." },
  );
  await applyFrameworkUpgrade(buildFrameworkUpgradePlan({ ...options, resolutions }));
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(targetRoot, verificationPath), "utf8")),
    current,
  );
  assert.equal(readFileSync(path.join(targetRoot, "docs/requirements.md"), "utf8"), requirements);
  const updated = observeProductDispatches(targetRoot);
  t.diagnostic(JSON.stringify({ generated, updated }));

  const repeated = buildFrameworkUpgradePlan(options);
  assert.deepEqual(repeated.conflicts, [verificationPath]);
  const [{ kind, ...binding }] = repeated.differences;
  const settled = buildFrameworkUpgradePlan({
    ...options,
    resolutions: [{ ...binding, action: "keep", reason: "Retain the reviewed project check." }],
  });
  assert.deepEqual(settled.operations, []);
  assert.deepEqual(await applyFrameworkUpgrade(settled), { changed: false });
});
