/** Verifies production policy routing and reusable verification input coverage. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  isRepositoryCodexHomePath,
  repositoryCodexHomeRuntimeProbePaths,
} from "../repository/source-inventory.mjs";
import { completeVerificationCommands } from "./adaptive-runner.mjs";
import { internalDependencies, route } from "./adaptive-runner-test-helpers.mjs";
import { commandCoversTest } from "./verification-admission-commands.mjs";
import { readVerificationConfiguration } from "./verification-configuration.mjs";
import {
  pendingVerificationPlan,
  successfulVerificationCommands,
  verificationCheckFingerprints,
  verificationExecutionUnits,
} from "./verification-check-inputs.mjs";
import { digest } from "./verification-record-helpers.mjs";
import { executableFingerprint } from "./verification-source-inputs.mjs";

test("license and required-notice changes route to the licensing owner", () => {
  const plan = route(["LICENSE", "NOTICE"]);
  assert.deepEqual(plan.admission.unknownPaths, []);
  assert.deepEqual(plan.admission.uncoveredFullRelevantPaths, []);
  assert.ok(
    plan.classifiedPaths.every((entry) =>
      entry.categories.includes("licensing and attribution contract"),
    ),
  );
  assert.ok(plan.readOnlyCommands.some((command) => command.key === "licensing"));
});

test("native Codex home deltas retain an exclusion owner when source policy changes", () => {
  const nativePaths = [
    ...repositoryCodexHomeRuntimeProbePaths.filter(isRepositoryCodexHomePath),
    "sessions/untrusted.test.mjs",
    "skills/.system/untrusted.test.mjs",
    ".codex/runtime/cache/untrusted.test.mjs",
  ];
  assert.ok(nativePaths.includes("session_index.jsonl"));
  const plan = route([...nativePaths, ".gitignore"]);
  const owners = new Map(
    plan.admission.focusedCommandOwners.map((entry) => [entry.path, entry.ownerKeys]),
  );
  assert.equal(plan.admission.mode, "targeted");
  assert.deepEqual(plan.admission.fullRelevantPaths, [".gitignore"]);
  assert.deepEqual(plan.admission.unknownPaths, []);
  for (const relativePath of nativePaths) {
    assert.deepEqual(owners.get(relativePath), ["codex-config"], relativePath);
  }
  assert.ok(
    plan.readOnlyCommands.every((command) =>
      command.args.every((argument) => !nativePaths.includes(argument)),
    ),
  );
  assert.equal(plan.workspaceCommands.length, 0);
});

test("non-Codex local runtime markers are ignored instead of becoming unknown paths", () => {
  const plan = route([
    ...repositoryCodexHomeRuntimeProbePaths.filter((entry) => !isRepositoryCodexHomePath(entry)),
    ".project-state/active.json",
  ]);
  assert.equal(plan.admission.mode, "targeted");
  assert.deepEqual(plan.admission.fullRelevantPaths, []);
  assert.deepEqual(plan.admission.unknownPaths, []);
  assert.equal(plan.readOnlyCommands.length, 0);
  assert.equal(plan.workspaceCommands.length, 0);

  const productMarker = route(["src/cache/runtime-state"], {
    workspaceManifests: [
      {
        directory: ".",
        internalDependencyNames: internalDependencies(),
        name: "root",
        scripts: { "test:unit": "unit" },
      },
    ],
  });
  assert.deepEqual(productMarker.admission.fullRelevantPaths, ["src/cache/runtime-state"]);
});

test("repository ignore policy routes to exact focused consumers", () => {
  const plan = route([".gitignore"]);
  const keys = new Set(plan.readOnlyCommands.map((command) => command.key));
  assert.equal(plan.admission.mode, "targeted");
  assert.deepEqual(plan.admission.unknownPaths, []);
  assert.deepEqual(plan.admission.uncoveredFullRelevantPaths, []);
  for (const key of ["codex-config", "path-hygiene", "repository-smoke"]) {
    assert.ok(keys.has(key), key);
  }
});

test("ordinary policy documentation retains its lightweight verification owners", () => {
  const plan = route([
    ".agents/skills/ui-ux-review/SKILL.md",
    ".codex/config.toml",
    ".codex/README.md",
  ]);
  const owners = new Map(
    plan.admission.focusedCommandOwners.map((entry) => [entry.path, entry.ownerKeys]),
  );
  assert.deepEqual(owners.get(".agents/skills/ui-ux-review/SKILL.md"), [
    "delivery-environments",
    "docs",
    "language",
    "path-hygiene",
    "secrets",
    "skills",
  ]);
  assert.deepEqual(owners.get(".codex/config.toml"), ["codex-config"]);
  assert.deepEqual(owners.get(".codex/README.md"), [
    "delivery-environments",
    "docs",
    "language",
    "path-hygiene",
    "secrets",
  ]);
  assert.equal(
    plan.readOnlyCommands.some((command) => command.args.includes("--test")),
    false,
  );
});

test("executable policy inputs select their explicit generation consumers without broad suites", () => {
  const consumers = [
    "scripts/setup/project-creator-contract.source.test.mjs",
    "scripts/setup/project-initialization.source.test.mjs",
    "scripts/setup/staged-project-validator.test.mjs",
    "scripts/framework/framework-upgrade.test.mjs",
  ];
  for (const source of [
    "AGENTS.md",
    "instructions.md",
    "scripts/framework/templates/project-instructions.md",
    "scripts/framework/generated-project-documents.mjs",
    "scripts/docs/document-context.mjs",
  ]) {
    const plan = route([source]);
    assert.equal(plan.admission.mode, "targeted", source);
    const keys = new Set(plan.readOnlyCommands.map((command) => command.key));
    for (const consumer of consumers) {
      assert.ok(
        plan.readOnlyCommands.some((command) => commandCoversTest(command, consumer)),
        `${source} must select ${consumer}`,
      );
    }
    for (const broadOwner of ["setup-regressions", "framework-regressions"]) {
      assert.equal(keys.has(broadOwner), false, `${source} must remain focused`);
    }
    if (source.endsWith(".md")) assert.ok(keys.has("docs"), source);
    const owners = plan.admission.focusedCommandOwners.find((entry) => entry.path === source);
    assert.ok(
      owners.ownerKeys.every((key) => keys.has(key)),
      source,
    );
  }
});

test("production policy consumers invalidate focused and full receipts while unrelated tests remain reusable", () => {
  const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");
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
      "scripts/framework/templates/project-instructions.md",
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
  const snapshot = (file, content) => ({
    path: file,
    fingerprint: digest(content),
    semanticFingerprint: executableFingerprint(repositoryRoot, file, content),
  });
  const sourceFiles = cases.map(([file]) =>
    snapshot(file, readFileSync(path.join(repositoryRoot, file))),
  );
  const fingerprints = (files) =>
    verificationCheckFingerprints({
      commands,
      configuration,
      repositoryRoot,
      workspaceManifests: [],
      inputs: { sourceFiles: files, runtimeDigest: "unchanged-runtime" },
    });
  const before = fingerprints(sourceFiles);
  const checks = [...before].map(([key, fingerprint]) => ({ key, fingerprint }));
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
    const after = fingerprints(sourceFiles.map((file) => (file.path === source ? changed : file)));
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

test("identity consumers preserve existing complete owners and reusable unrelated evidence", async (t) => {
  const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");
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
  // These are the complete owners selected before explicit identity consumers were added.
  // The additional tests exercise the source through its existing callers and test helpers.
  // Identity coverage must preserve both the prior owners and those demonstrated consumers.
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
  const sourceFiles = cases.map(([file]) => {
    const content = readFileSync(path.join(repositoryRoot, file));
    return {
      path: file,
      fingerprint: digest(content),
      semanticFingerprint: executableFingerprint(repositoryRoot, file, content),
    };
  });
  const fingerprints = (files) =>
    verificationCheckFingerprints({
      commands,
      configuration,
      repositoryRoot,
      workspaceManifests: [],
      inputs: { sourceFiles: files, runtimeDigest: "unchanged-runtime" },
    });
  const before = fingerprints(sourceFiles);
  const checks = [...before].map(([key, fingerprint]) => ({ key, fingerprint }));
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
      const changed = {
        path: source,
        fingerprint: digest(changedContent),
        semanticFingerprint: executableFingerprint(
          repositoryRoot,
          source,
          Buffer.from(changedContent),
        ),
      };
      const after = fingerprints(
        sourceFiles.map((file) => (file.path === source ? changed : file)),
      );
      const focused = route([source]);
      const expectedOwners =
        completeOwner === "framework-regressions"
          ? ["framework-version", completeOwner]
          : [completeOwner];
      for (const owner of expectedOwners) {
        assert.ok(
          focused.readOnlyCommands.some((command) => command.key === owner),
          `${source}: retain existing owner ${owner}`,
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
  test(`foundational input ${source} retains conservative invalidation`, () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");
    const configuration = readVerificationConfiguration(repositoryRoot);
    const commands = completeVerificationCommands();
    const content = readFileSync(path.join(repositoryRoot, source), "utf8");
    const fingerprints = (text) =>
      verificationCheckFingerprints({
        commands,
        configuration,
        repositoryRoot,
        workspaceManifests: [],
        inputs: {
          runtimeDigest: "unchanged-runtime",
          sourceFiles: [
            {
              path: source,
              fingerprint: digest(text),
              semanticFingerprint: executableFingerprint(repositoryRoot, source, Buffer.from(text)),
            },
          ],
        },
      });
    const before = fingerprints(content);
    const after = fingerprints(
      `${content}\nexport const verificationSharedContractProbe = true;\n`,
    );
    const checks = [...before].map(([key, fingerprint]) => ({ key, fingerprint }));
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
