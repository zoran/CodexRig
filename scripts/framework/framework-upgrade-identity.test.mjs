/** Verifies generated policy parity, adaptation gates and launcher identity across child upgrades. */
import assert from "node:assert/strict";
import { chmodSync, cpSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { applyFrameworkUpgrade, buildFrameworkUpgradePlan } from "./framework-upgrade.mjs";
import {
  cleanupTemporaryRoots,
  isolatedTrackedFrameworkSource,
  runProjectGenerator,
  temporaryRoot,
} from "../setup/project-initialization-test-helpers.mjs";

const toolingPath = ".codex/tooling.json";
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
