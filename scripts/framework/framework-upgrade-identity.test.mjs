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
import { toolingRoot } from "../filesystem/repository-files.mjs";
import { compareUpgradeFile, upgradeFileContent } from "./framework-upgrade-merge.mjs";
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

test("baseline policy updates pristine files and reports competing product edits before writing", async () => {
  const data = fixture();
  for (const [file, marker] of [
    ["AGENTS.md", "portable-agent-entry"],
    ["instructions.md", "portable-policy"],
  ]) {
    const source = path.join(data.sourceRoot, file);
    const end = `<!-- codexrig:${marker}:end -->`;
    const previous = readFileSync(source, "utf8");
    assert.ok(previous.includes(end));
    writeFileSync(source, previous.replace(end, `A new portable fixture rule.\n\n${end}`));
  }
  const productPolicy = path.join(data.targetRoot, "instructions.md");
  const before = readFileSync(productPolicy, "utf8");
  const custom =
    before.replace("# Project Instructions", "# Customer engineering guide") +
    "\nProduct-owned rule.\n";
  writeFileSync(productPolicy, custom);
  const conflict = buildFrameworkUpgradePlan(data);
  assert.deepEqual(conflict.conflicts, ["instructions.md"]);
  assert.ok(conflict.operations.some((op) => op.path === "AGENTS.md"));
  await assert.rejects(applyFrameworkUpgrade(conflict), /conflicts/u);
  assert.equal(readFileSync(productPolicy, "utf8"), custom);
  assert.doesNotMatch(
    readFileSync(path.join(data.targetRoot, "AGENTS.md"), "utf8"),
    /new portable fixture rule/u,
  );
  const { kind, ...binding } = conflict.differences.find((item) => item.path === "instructions.md");
  const resolved = buildFrameworkUpgradePlan({
    ...data,
    resolutions: [
      {
        ...binding,
        action: "source",
        reason: "Adopt the portable rule at the overlapping paragraph.",
      },
    ],
  });
  const resolution = resolved.operations.find((op) => op.path === "instructions.md");
  assert.deepEqual(resolved.conflicts, []);
  assert.match(resolution.content, /# Customer engineering guide/u);
  assert.match(resolution.content, /new portable fixture rule/u);
  assert.doesNotMatch(resolution.content, /Product-owned rule|<<<<<<<|>>>>>>>/u);
  writeFileSync(productPolicy, before);
  const plan = buildFrameworkUpgradePlan(data);
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.operations.map((op) => op.path).sort(), ["AGENTS.md", "instructions.md"]);
  assert.equal((await applyFrameworkUpgrade(plan)).changed, true);
  for (const file of ["AGENTS.md", "instructions.md"])
    assert.match(
      readFileSync(path.join(data.targetRoot, file), "utf8"),
      /new portable fixture rule/u,
    );
  assert.deepEqual(buildFrameworkUpgradePlan(data).operations, []);
  assert.deepEqual(
    buildFrameworkUpgradePlan({ sourceRoot: data.sourceRoot, targetRoot: data.targetRoot })
      .differences,
    [],
  );
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
  const { kind, ...registryBinding } = preview.differences.find(
    (item) => item.path === verificationPath,
  );
  const invalid = structuredClone(current);
  invalid.exactConsumers["src/probe.mjs"] = ["absent-product-check"];
  const invalidPlan = buildFrameworkUpgradePlan({
    ...options,
    resolutions: [
      {
        ...registryBinding,
        action: "replace",
        reason: "Exercise a dangling project verification binding.",
        content: JSON.stringify(invalid),
        mode: 0o644,
      },
    ],
  });
  assert.match(invalidPlan.conflictDetails[verificationPath][0], /unselected command/u);
  await assert.rejects(applyFrameworkUpgrade(invalidPlan), /conflicts/u);
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
  assert.deepEqual(repeated.conflicts, []);
  assert.deepEqual(repeated.operations, []);
  assert.deepEqual(await applyFrameworkUpgrade(repeated), { changed: false });
});

test("a pristine ancestor merges independent product text, modes and JSON through a repeatable upgrade", async () => {
  const options = fixture();
  const read = (root, file) => readFileSync(path.join(root, file), "utf8");
  const sourceAgents = path.join(options.sourceRoot, "AGENTS.md");
  const marker = "<!-- codexrig:portable-agent-entry:end -->";
  writeFileSync(
    sourceAgents,
    read(options.sourceRoot, "AGENTS.md").replace(
      marker,
      `Carry the shared operational revision.\n\n${marker}`,
    ),
  );
  const targetAgents = path.join(options.targetRoot, "AGENTS.md");
  const agents = read(options.targetRoot, "AGENTS.md");
  writeFileSync(targetAgents, agents.replace("# AGENTS.md", "# Product maintenance guide"));
  chmodSync(targetAgents, 0o640);

  for (const [file, shared, legacy, local] of [
    [
      "README.md",
      "## Setup And Start",
      "## Setup With Earlier Tools",
      "## Product deployment notes",
    ],
    [
      "docs/project.md",
      "## System Shape",
      "## Earlier System Description",
      "## Integrated product runtime",
    ],
    [
      ".codex/README.md",
      "# Project Session Configuration",
      "Previous configuration heading",
      "## Product operator settings",
    ],
  ]) {
    const original = read(options.baselineRoot, file);
    assert.ok(original.includes(shared));
    const old = original.replace(shared, legacy);
    writeFileSync(path.join(options.baselineRoot, file), old);
    writeFileSync(path.join(options.targetRoot, file), old + "\n" + local + "\n");
  }
  const rootTooling = readTooling(options.sourceRoot);
  rootTooling.startup.attestationMaxAgeSeconds += 60;
  writeTooling(options.sourceRoot, rootTooling);
  const productTooling = readTooling(options.targetRoot);
  productTooling.platform.protection.requiredApprovals += 1;
  writeTooling(options.targetRoot, productTooling);

  const plan = buildFrameworkUpgradePlan(options);
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(
    plan.operations.map((op) => op.path).sort(),
    [".codex/README.md", toolingPath, "AGENTS.md", "README.md", "docs/project.md"].sort(),
  );
  assert.deepEqual(await applyFrameworkUpgrade(plan), { changed: true });
  assert.match(read(options.targetRoot, "AGENTS.md"), /# Product maintenance guide/u);
  assert.match(read(options.targetRoot, "AGENTS.md"), /Carry the shared operational revision/u);
  assert.equal(statSync(targetAgents).mode & 0o777, 0o640);
  for (const [file, shared, local] of [
    ["README.md", "## Setup And Start", "## Product deployment notes"],
    ["docs/project.md", "## System Shape", "## Integrated product runtime"],
    [".codex/README.md", "# Project Session Configuration", "## Product operator settings"],
  ]) {
    const content = read(options.targetRoot, file);
    assert.ok(content.includes(shared) && content.includes(local));
  }
  const result = readTooling(options.targetRoot);
  assert.equal(
    result.platform.protection.requiredApprovals,
    productTooling.platform.protection.requiredApprovals,
  );
  assert.equal(
    result.startup.attestationMaxAgeSeconds,
    rootTooling.startup.attestationMaxAgeSeconds,
  );
  const settled = buildFrameworkUpgradePlan(options);
  assert.deepEqual(settled.conflicts, []);
  assert.deepEqual(settled.operations, []);
  assert.deepEqual(await applyFrameworkUpgrade(settled), { changed: false });
});

test("reapplying a reorganized policy preserves the merged local rule without a decision", () => {
  // Repeated blank lines around deleted sections give Git ambiguous hunk boundaries on replay.
  const headings = "\nStart\n\n\n\nNotes\n";
  const before = upgradeFileContent(headings + "\nSetup\n\n\n\n\nLegacy\n\n\n\n");
  const desired = upgradeFileContent(headings + "\n".repeat(5));
  const productRule = "Product rule\n\n";
  const compare = (current) =>
    compareUpgradeFile({
      sourceRoot: toolingRoot,
      file: "instructions.md",
      before,
      current,
      desired,
    });
  const merged = compare(upgradeFileContent(productRule + before.content));
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.next.content, productRule + desired.content);
  assert.deepEqual(compare(merged.next), merged);
});

test("current output adds missing framework commands alongside project tools and reports exact shared-key conflicts", async () => {
  const { sourceRoot, targetRoot } = fixture();
  const options = { sourceRoot, targetRoot };
  const packagePath = path.join(targetRoot, "package.json");
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  const command = pkg.scripts["context:map"];
  delete pkg.scripts["context:map"];
  pkg.scripts["product:check"] = "node scripts/product/verify.mjs";
  pkg.dependencies = { "product-library": "1.2.3" };
  pkg.license = "MIT";
  writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");
  mkdirSync(path.join(targetRoot, "scripts/product"));
  writeFileSync(path.join(targetRoot, "scripts/product/verify.mjs"), "// Product verifier.\n");
  const opaque = Buffer.from([0xff, 0x12]);
  writeFileSync(path.join(targetRoot, "scripts/product/example.bin"), opaque);
  const registry = addProductCheck(targetRoot);
  const [first] = registry.commands.splice(0, 1);
  writeFileSync(path.join(targetRoot, verificationPath), JSON.stringify(registry, null, 2) + "\n");

  const plan = buildFrameworkUpgradePlan(options);
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(
    plan.operations.map((op) => op.path),
    [verificationPath, "package.json"],
  );
  await applyFrameworkUpgrade(plan);
  const mergedRegistry = JSON.parse(readFileSync(path.join(targetRoot, verificationPath), "utf8"));
  assert.deepEqual(mergedRegistry.commands, [first, ...registry.commands]);
  assert.deepEqual(mergedRegistry.workspaceOutputs, registry.workspaceOutputs);
  assert.equal(
    readFileSync(path.join(targetRoot, "scripts/product/verify.mjs"), "utf8"),
    "// Product verifier.\n",
  );
  assert.deepEqual(readFileSync(path.join(targetRoot, "scripts/product/example.bin")), opaque);
  const mergedPackage = JSON.parse(readFileSync(packagePath, "utf8"));
  assert.deepEqual(mergedPackage, { ...pkg, scripts: { ...pkg.scripts, "context:map": command } });
  assert.deepEqual(await applyFrameworkUpgrade(buildFrameworkUpgradePlan(options)), {
    changed: false,
  });

  mergedPackage.scripts["context:map"] = "node scripts/product/verify.mjs";
  writeFileSync(packagePath, JSON.stringify(mergedPackage, null, 2) + "\n");
  const conflict = buildFrameworkUpgradePlan(options);
  assert.deepEqual(conflict.conflicts, ["package.json"]);
  assert.deepEqual(conflict.conflictDetails["package.json"], ["/scripts/context:map"]);
  await assert.rejects(applyFrameworkUpgrade(conflict), /conflicts/u);
  assert.deepEqual(JSON.parse(readFileSync(packagePath, "utf8")), mergedPackage);
});

test("a baseline conflict can be reconciled against all three inputs without losing product fields", async () => {
  const options = fixture();
  const locate = (root) => path.join(root, "package.json");
  const setCommand = (root, value) => {
    const pkg = JSON.parse(readFileSync(locate(root), "utf8"));
    pkg.scripts["context:map"] = value;
    if (root === options.targetRoot) pkg.scripts["product:build"] = "node product-build.mjs";
    writeFileSync(locate(root), JSON.stringify(pkg, null, 2) + "\n");
  };
  setCommand(options.baselineRoot, "node old-map.mjs");
  setCommand(options.targetRoot, "node product-map.mjs");
  const plan = buildFrameworkUpgradePlan(options);
  assert.deepEqual(plan.conflicts, ["package.json"]);
  const { kind, ...binding } = plan.differences.find((item) => item.path === "package.json");
  const resolutions = [
    {
      ...binding,
      action: "source",
      reason: "Adopt the shared command and retain the product build.",
    },
  ];
  assert.deepEqual(buildFrameworkUpgradePlan({ ...options, resolutions }).conflicts, []);
  setCommand(options.baselineRoot, "node other-reference.mjs");
  assert.throws(
    () => buildFrameworkUpgradePlan({ ...options, resolutions }),
    /Stale reconciliation/u,
  );
  setCommand(options.baselineRoot, "node old-map.mjs");
  await applyFrameworkUpgrade(buildFrameworkUpgradePlan({ ...options, resolutions }));
  const merged = JSON.parse(readFileSync(locate(options.targetRoot), "utf8"));
  assert.equal(merged.scripts["product:build"], "node product-build.mjs");
  assert.notEqual(merged.scripts["context:map"], "node product-map.mjs");
  assert.deepEqual(await applyFrameworkUpgrade(buildFrameworkUpgradePlan(options)), {
    changed: false,
  });
});
