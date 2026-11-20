/** Verifies policy inputs, production consumer coverage and independent receipt invalidation. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { completeVerificationCommands } from "./adaptive-runner.mjs";
import { route } from "./adaptive-runner-test-helpers.mjs";
import { readVerificationConfiguration } from "./verification-configuration.mjs";
import {
  pendingVerificationPlan,
  successfulVerificationCommands,
  verificationCheckFingerprints,
  verificationExecutionUnits,
} from "./verification-check-inputs.mjs";

import { receipt, policyFixture } from "./verification-policy-test-helpers.mjs";

test("production policy consumers invalidate focused and full receipts while unrelated tests remain reusable", (t) => {
  const { repositoryRoot, snapshot, sourceFiles, productLayout } = policyFixture(t);
  const configuration = readVerificationConfiguration(repositoryRoot);
  const commands = completeVerificationCommands();
  const fullPlan = { readOnlyCommands: commands, workspaceCommands: [] };
  const consumers = [
    "scripts/setup/project-creator-contract.source.test.mjs",
    "scripts/setup/project-initialization.source.test.mjs",
    "scripts/setup/staged-project-validator.test.mjs",
    "scripts/framework/framework-upgrade.test.mjs",
  ];
  const unrelatedTest = "scripts/terminal/terminal-output.test.mjs";
  const bootstrapTest = "scripts/setup/bootstrap-entry.test.mjs";
  const cases = [
    ...[
      "AGENTS.md",
      "instructions.md",
      "scripts/framework/generated-project-documents.mjs",
      "scripts/docs/document-context.mjs",
    ].map((source) => [source, consumers]),
    [
      "scripts/framework/framework-upgrade-review.mjs",
      [
        "scripts/setup/staged-project-validator.test.mjs",
        "scripts/framework/framework-upgrade.test.mjs",
      ],
    ],
    ["README.md", [bootstrapTest]],
  ];
  const fingerprints = (files) =>
    verificationCheckFingerprints({
      commands,
      configuration,
      repositoryRoot,
      workspaceManifests: [],
      inputs: { sourceFiles: files, runtimeDigest: "unchanged-runtime" },
      productLayout,
    });
  const before = fingerprints(sourceFiles);
  const checks = [...before].map(receipt);
  const observedUnits = commands
    .flatMap(verificationExecutionUnits)
    .filter((unit) => [...consumers, bootstrapTest, unrelatedTest].includes(unit.testFile));
  assert.equal(observedUnits.length, consumers.length + 2);
  assert.equal(pendingVerificationPlan(fullPlan, before, checks).readOnlyCommands.length, 0);

  for (const [source, affectedTests] of cases) {
    const content = readFileSync(path.join(repositoryRoot, source), "utf8");
    const amendment = source.endsWith(".md")
      ? "\nA changed executable policy input.\n"
      : "\nexport const verificationConsumerProbe = true;\n";
    const changed = snapshot(source, Buffer.from(content + amendment));
    writeFileSync(path.join(repositoryRoot, source), content + amendment);
    const after = fingerprints(sourceFiles.map((file) => (file.path === source ? changed : file)));
    writeFileSync(path.join(repositoryRoot, source), content);
    const focused = route([source]);
    const pendingFull = pendingVerificationPlan(fullPlan, after, checks);
    const pendingFocused = pendingVerificationPlan(focused, after, checks);
    for (const unit of observedUnits) {
      const affected = affectedTests.includes(unit.testFile);
      assert.equal(
        before.get(unit.key) !== after.get(unit.key),
        affected,
        `${source}: receipt invalidation for ${unit.testFile}`,
      );
      for (const [label, pending] of [
        ["full", pendingFull],
        ["focused", pendingFocused],
      ]) {
        assert.equal(
          pending.readOnlyCommands.some((command) => command.key === unit.key),
          affected,
          `${source}: ${label} pending selection for ${unit.testFile}`,
        );
      }
    }
    const accepted = successfulVerificationCommands(commands, after, checks);
    for (const owner of new Set(observedUnits.map((unit) => unit.acceptanceKey))) {
      const affected = observedUnits.some(
        (unit) => unit.acceptanceKey === owner && affectedTests.includes(unit.testFile),
      );
      assert.equal(accepted.includes(owner), !affected, `${source}: complete owner ${owner}`);
    }
  }
});

test("identity consumers preserve required files and reusable unrelated evidence", async (t) => {
  const { repositoryRoot, snapshot, sourceFiles, productLayout } = policyFixture(t);
  const configuration = readVerificationConfiguration(repositoryRoot);
  const commands = completeVerificationCommands();
  const units = commands.flatMap(verificationExecutionUnits);
  const fullPlan = { readOnlyCommands: commands, workspaceCommands: [] };
  const identityTest = "scripts/framework/framework-upgrade-identity.test.mjs";
  const unrelatedTest = "scripts/terminal/terminal-output.test.mjs";
  const upgradeTest = "scripts/framework/framework-upgrade.test.mjs";
  const stagedTest = "scripts/setup/staged-project-validator.test.mjs";
  const initializationTests = [
    "scripts/setup/project-initialization.source.test.mjs",
    "scripts/setup/project-initialization-boundaries.source.test.mjs",
    "scripts/setup/project-initialization-transfer.source.test.mjs",
  ];
  // Preserve demonstrated consumers without invalidating every file in their complete suites.
  const cases = [
    ["scripts/framework/framework-upgrade.mjs", "framework-regressions", [upgradeTest, stagedTest]],
    [
      "scripts/framework/generated-project-tooling.mjs",
      "framework-regressions",
      [
        "scripts/framework/compatibility-integrity.test.mjs",
        upgradeTest,
        ...initializationTests,
        stagedTest,
      ],
    ],
    [
      "scripts/framework/project-output-projection.mjs",
      "framework-regressions",
      [upgradeTest, ...initializationTests, stagedTest],
    ],
    [
      "scripts/framework/create-project-from-framework.mjs",
      "framework-regressions",
      [upgradeTest, ...initializationTests],
    ],
    [
      "scripts/framework/prepare-project.mjs",
      "framework-regressions",
      [upgradeTest, ...initializationTests, stagedTest],
    ],
    [
      "scripts/setup/project-initialization-test-helpers.mjs",
      "setup-regressions",
      [upgradeTest, ...initializationTests, stagedTest],
    ],
    [
      "scripts/setup/setup-regression-test-helpers.mjs",
      "setup-regressions",
      [
        upgradeTest,
        ...initializationTests,
        stagedTest,
        "scripts/setup/setup-regression.test.mjs",
        "scripts/setup/startup-session-controller.test.mjs",
      ],
    ],
    [".codex/tooling.json", "codex-config", []],
  ];
  const fingerprints = (files) =>
    verificationCheckFingerprints({
      commands,
      configuration,
      repositoryRoot,
      workspaceManifests: [],
      inputs: { sourceFiles: files, runtimeDigest: "unchanged-runtime" },
      productLayout,
    });
  const before = fingerprints(sourceFiles);
  const checks = [...before].map(receipt);
  const unrelated = units.find((unit) => unit.testFile === unrelatedTest);
  assert.ok(unrelated);
  assert.equal(pendingVerificationPlan(fullPlan, before, checks).readOnlyCommands.length, 0);

  for (const [source, completeOwner, additionalTests] of cases) {
    await t.test(source, () => {
      const content = readFileSync(path.join(repositoryRoot, source), "utf8");
      const changedContent = source.endsWith(".json")
        ? JSON.stringify({
            ...JSON.parse(content),
            startup: { ...JSON.parse(content).startup, displayName: "Changed project identity" },
          })
        : `${content}\nexport const verificationIdentityConsumerProbe = true;\n`;
      const changed = snapshot(source, Buffer.from(changedContent));
      writeFileSync(path.join(repositoryRoot, source), changedContent);
      const after = fingerprints(
        sourceFiles.map((file) => (file.path === source ? changed : file)),
      );
      writeFileSync(path.join(repositoryRoot, source), content);
      const focused = route([source]);
      const expectedOwners =
        completeOwner === "framework-regressions"
          ? ["framework-version"]
          : completeOwner === "codex-config"
            ? [completeOwner]
            : [];
      for (const owner of expectedOwners) {
        assert.ok(
          focused.readOnlyCommands.some((command) => command.key === owner),
          `${source}: retain required static owner ${owner}`,
        );
      }
      const testConsumers = [identityTest, ...additionalTests];
      const expected = units.filter(
        (unit) =>
          expectedOwners.includes(unit.acceptanceKey) || testConsumers.includes(unit.testFile),
      );
      for (const testFile of testConsumers) {
        assert.ok(
          expected.some((unit) => unit.testFile === testFile),
          testFile,
        );
      }
      assert.ok(expected.some((unit) => unit.acceptanceKey === completeOwner));
      for (const unit of expected) {
        assert.notEqual(before.get(unit.key), after.get(unit.key), `${source}: ${unit.label}`);
      }
      for (const [label, plan] of [
        ["full", fullPlan],
        ["focused", focused],
      ]) {
        const pending = pendingVerificationPlan(plan, after, checks);
        const keys = new Set(pending.readOnlyCommands.map((command) => command.key));
        for (const unit of expected) {
          assert.ok(
            keys.has(unit.key),
            `${source}: ${label} must rerun ${unit.testFile ?? unit.key}`,
          );
        }
        assert.equal(
          keys.has(unrelated.key),
          false,
          `${source}: ${label} unrelated evidence reuse`,
        );
      }
      assert.equal(before.get(unrelated.key), after.get(unrelated.key));
      const accepted = successfulVerificationCommands(commands, after, checks);
      for (const owner of new Set(expected.map((unit) => unit.acceptanceKey))) {
        assert.equal(accepted.includes(owner), false, `${source}: complete owner ${owner}`);
      }
    });
  }
});

for (const source of [
  "scripts/contracts/tooling-configuration.mjs",
  "scripts/repository/runtime-process-io.mjs",
  "scripts/repository/runtime-process-cancellation.mjs",
  "scripts/repository/runtime-process-identity.mjs",
]) {
  test(`foundational input ${source} retains conservative invalidation`, (t) => {
    const { repositoryRoot, snapshot, sourceFiles, productLayout } = policyFixture(t);
    const configuration = readVerificationConfiguration(repositoryRoot);
    const commands = completeVerificationCommands();
    const content = readFileSync(path.join(repositoryRoot, source), "utf8");
    const fingerprints = (text) => {
      writeFileSync(path.join(repositoryRoot, source), text);
      return verificationCheckFingerprints({
        commands,
        configuration,
        repositoryRoot,
        workspaceManifests: [],
        productLayout,
        inputs: {
          runtimeDigest: "unchanged-runtime",
          sourceFiles: sourceFiles.map((file) =>
            file.path === source ? snapshot(source, Buffer.from(text)) : file,
          ),
        },
      });
    };
    const before = fingerprints(content);
    const after = fingerprints(
      `${content}\nexport const verificationSharedContractProbe = true;\n`,
    );
    const checks = [...before].map(receipt);
    const fullPlan = { readOnlyCommands: commands, workspaceCommands: [] };
    assert.equal(pendingVerificationPlan(fullPlan, before, checks).readOnlyCommands.length, 0);
    const pending = new Set(
      pendingVerificationPlan(fullPlan, after, checks).readOnlyCommands.map(
        (command) => command.key,
      ),
    );
    for (const unit of commands.flatMap(verificationExecutionUnits)) {
      assert.notEqual(before.get(unit.key), after.get(unit.key), unit.testFile ?? unit.key);
      assert.ok(pending.has(unit.key), unit.testFile ?? unit.key);
    }
    assert.deepEqual(successfulVerificationCommands(commands, after, checks), []);
  });
}
