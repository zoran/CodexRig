/** Verifies production policy routing and reusable verification input coverage. */
import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import {
  isRepositoryCodexHomePath,
  listPortableTransferFiles,
  repositoryCodexHomeRuntimeProbePaths,
} from "../repository/source-inventory.mjs";
import { completeVerificationCommands } from "./adaptive-runner.mjs";
import { internalDependencies, route } from "./adaptive-runner-test-helpers.mjs";
import { discoverProductLayout } from "../repository/product-roots.mjs";
import { commandCoversTest, focusedManifestCommand } from "./verification-admission-commands.mjs";
import { readVerificationConfiguration } from "./verification-configuration.mjs";
import {
  pendingVerificationPlan,
  successfulVerificationCommands,
  verificationCheckFingerprints,
  verificationExecutionUnits,
} from "./verification-check-inputs.mjs";
import { digest } from "./verification-record-helpers.mjs";
import { executableFingerprint } from "./verification-source-inputs.mjs";
import { runPlan } from "./verification-executor.mjs";
import { withVerificationSessionLock } from "./verification-session-lock.mjs";
import {
  checkpointVerificationEvidenceRecord,
  validateVerificationEvidenceRecord,
} from "./verification-evidence-record.mjs";

const receipt = ([key, fingerprint]) => ({
  key,
  fingerprint,
  completedAt: new Date().toISOString(),
  elapsedMs: 1,
});

// Exercise shipped policy against stable, real inputs without mutating this checkout. A synthetic
// digest cannot prove the executable import closure that scoped static commands now require.
function policyFixture(t) {
  const sourceRoot = path.resolve(import.meta.dirname, "..", "..");
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "verification-policy-"));
  t.after(() => rmSync(repositoryRoot, { recursive: true, force: true }));
  const snapshot = (file, content) => {
    const mode = lstatSync(path.join(repositoryRoot, file)).mode & 0o7777;
    return {
      path: file,
      fingerprint: digest(`${mode}\0${digest(content)}`),
      semanticFingerprint: digest(
        `${mode & 0o111}\0${executableFingerprint(sourceRoot, file, content)}`,
      ),
    };
  };
  const sourceFiles = listPortableTransferFiles({ root: sourceRoot, includeUntracked: true })
    .sort()
    .map((file) => {
      const target = path.join(repositoryRoot, file);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(sourceRoot, file), target);
      return snapshot(file, readFileSync(target));
    });
  const productLayout = discoverProductLayout({
    repositoryRoot,
    relativePaths: sourceFiles.map((file) => file.path),
  });
  return { repositoryRoot, snapshot, sourceFiles, productLayout };
}

test("scoped static checks reuse unrelated test edits but bind data, imports and inventory", async (t) => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "scoped-verification-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  mkdirSync(path.join(repositoryRoot, "checks"));
  const sources = {
    "checks/scoped.mjs": `import {value} from './helper.mjs';
import {appendFileSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
assert.ok(value > 0 && JSON.parse(readFileSync('policy.json','utf8')).valid);
appendFileSync('dispatch.log','scoped\\n');\n`,
    "checks/helper.mjs": "export const value = 1;\n",
    "checks/global.mjs":
      "import {appendFileSync} from 'node:fs'; appendFileSync('dispatch.log','global\\n');\n",
    "policy.json": '{"valid":true}\n',
    "unrelated.test.mjs": "// independent test content\n",
  };
  for (const [file, content] of Object.entries(sources))
    writeFileSync(path.join(repositoryRoot, file), content);
  const commands = ["scoped", "global"].map((key) => ({
    key,
    label: key,
    reason: "fixture input coverage",
    phase: "preflight",
    executable: process.execPath,
    args: [`checks/${key}.mjs`],
    ...(key === "scoped" ? { inputScope: "owners" } : {}),
  }));
  const configuration = {
    commands,
    exactConsumers: { "policy.json": ["scoped"] },
    testConsumers: {},
    ownedCategories: {},
  };
  const snapshot = () =>
    Object.keys(sources)
      .sort()
      .filter((file) => existsSync(path.join(repositoryRoot, file)))
      .map((file) => {
        const content = readFileSync(path.join(repositoryRoot, file));
        const fingerprint = digest(
          `${lstatSync(path.join(repositoryRoot, file)).mode & 0o7777}\0${digest(content)}`,
        );
        return { path: file, fingerprint, semanticFingerprint: fingerprint };
      });
  const fingerprints = (sourceFiles = snapshot()) =>
    verificationCheckFingerprints({
      commands,
      configuration,
      repositoryRoot,
      workspaceManifests: [],
      inputs: { sourceFiles, runtimeDigest: "fixture-runtime" },
      productLayout: discoverProductLayout({ repositoryRoot, relativePaths: Object.keys(sources) }),
    });
  let checks = [];
  const execute = async (expected) => {
    const current = fingerprints();
    const pending = pendingVerificationPlan(
      {
        options: { mode: "full" },
        admission: { mode: "full", reason: "fixture" },
        classifiedPaths: [],
        readOnlyCommands: commands,
        workspaceCommands: [],
      },
      current,
      checks,
    );
    assert.deepEqual(
      pending.readOnlyCommands.map((command) => command.key),
      expected,
    );
    const observed = new Map(checks.map((check) => [check.key, check]));
    await withVerificationSessionLock(
      () =>
        runPlan(pending, {
          repositoryRoot,
          onResult(result) {
            assert.equal(result.status, 0);
            observed.set(result.command.key, {
              ...receipt([result.command.key, current.get(result.command.key)]),
              elapsedMs: result.elapsedMs,
            });
          },
        }),
      { repositoryRoot },
    );
    checks = [...observed.values()];
  };
  await execute(["scoped", "global"]);
  writeFileSync(path.join(repositoryRoot, "unrelated.test.mjs"), "// independent changed test\n");
  await execute(["global"]);
  const stale = snapshot();
  writeFileSync(path.join(repositoryRoot, "checks/helper.mjs"), "export const value = 2;\n");
  assert.throws(() => fingerprints(stale), /input changed during planning/u);
  await execute(["scoped", "global"]);
  writeFileSync(path.join(repositoryRoot, "policy.json"), '{"valid":true,"revision":2}\n');
  await execute(["scoped", "global"]);
  sources["linked.txt"] = "new linked input";
  writeFileSync(path.join(repositoryRoot, "linked.txt"), sources["linked.txt"]);
  await execute(["scoped", "global"]);
  const dispatched = readFileSync(path.join(repositoryRoot, "dispatch.log"), "utf8")
    .trim()
    .split("\n");
  assert.equal(dispatched.filter((key) => key === "scoped").length, 4);
  assert.equal(dispatched.filter((key) => key === "global").length, 5);
  rmSync(path.join(repositoryRoot, "checks/helper.mjs"));
  assert.throws(() => fingerprints(), /unbound executable input/u);
});

test("package inputs invalidate their focused owner and complete coverage, not another package", (t) => {
  const { repositoryRoot, snapshot, sourceFiles, productLayout } = policyFixture(t);
  const configuration = readVerificationConfiguration(repositoryRoot);
  const manifests = ["packages/alpha/package.json", "packages/beta/package.json"];
  for (const file of manifests) {
    mkdirSync(path.dirname(path.join(repositoryRoot, file)), { recursive: true });
    const content = Buffer.from('{"name":"fixture","private":true}\n');
    writeFileSync(path.join(repositoryRoot, file), content);
    sourceFiles.push(snapshot(file, content));
  }
  const commands = [
    configuration.commands.find((command) => command.key === "package-manifests"),
    ...manifests.map(focusedManifestCommand),
  ];
  const capture = (files) =>
    verificationCheckFingerprints({
      commands,
      configuration,
      repositoryRoot,
      workspaceManifests: [],
      productLayout,
      inputs: { sourceFiles: files, runtimeDigest: "unchanged-runtime" },
    });
  const before = capture(sourceFiles);
  const content = Buffer.from('{"name":"changed","private":true}\n');
  writeFileSync(path.join(repositoryRoot, manifests[0]), content);
  const after = capture(
    sourceFiles.map((file) => (file.path === manifests[0] ? snapshot(file.path, content) : file)),
  );
  assert.notEqual(before.get(commands[0].key), after.get(commands[0].key));
  assert.notEqual(before.get(commands[1].key), after.get(commands[1].key));
  assert.equal(before.get(commands[2].key), after.get(commands[2].key));
});

test("a missing input fingerprint cannot satisfy an unexecuted verification unit", () => {
  const commands = [{ key: "missing", executable: process.execPath, args: ["fixture.mjs"] }];
  const plan = { readOnlyCommands: commands, workspaceCommands: [] };
  assert.throws(() => pendingVerificationPlan(plan, new Map(), []), /Missing input fingerprint/u);
  assert.deepEqual(successfulVerificationCommands(commands, new Map(), []), []);
});

test("actual dispatch reuses durable successes and composes publication after isolated repairs", async (t) => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "verification-reuse-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  mkdirSync(path.join(repositoryRoot, "scripts"));
  mkdirSync(path.join(repositoryRoot, "inputs"));
  const names = ["alpha", "consumer", "independent"];
  const commands = names.map((key) => ({
    key,
    phase: "preflight",
    executable: process.execPath,
    args: ["--test", `scripts/${key}.test.mjs`],
  }));
  for (const name of names)
    writeFileSync(
      path.join(repositoryRoot, `scripts/${name}.test.mjs`),
      `import { appendFileSync, readFileSync } from 'node:fs';\n` +
        `import assert from 'node:assert/strict';\n` +
        `appendFileSync('dispatch.log', '${name}\\n');\n` +
        `assert.ok(readFileSync('inputs/shared.json'));\n` +
        (name === "independent" ? "" : `assert.ok(readFileSync('inputs/module.json'));\n`),
    );
  for (const name of ["shared", "module"])
    writeFileSync(path.join(repositoryRoot, `inputs/${name}.json`), "1\n");
  writeFileSync(path.join(repositoryRoot, ".prettierrc.json"), "{}\n");
  const configuration = {
    commands,
    risks: [],
    exactConsumers: {},
    ownedCategories: {},
    testConsumers: {
      "inputs/shared.json": names.map((name) => `scripts/${name}.test.mjs`),
      "inputs/module.json": names.slice(0, 2).map((name) => `scripts/${name}.test.mjs`),
    },
  };
  const files = [
    ...commands.map((command) => command.args[1]),
    "inputs/shared.json",
    "inputs/module.json",
    ".prettierrc.json",
  ];
  const snapshot = () =>
    files.sort().map((file) => {
      const content = readFileSync(path.join(repositoryRoot, file));
      return { path: file, fingerprint: digest(content), semanticFingerprint: digest(content) };
    });
  const fingerprints = (sourceCommit = "") =>
    verificationCheckFingerprints({
      commands,
      configuration,
      repositoryRoot,
      workspaceManifests: [],
      inputs: { sourceFiles: snapshot(), runtimeDigest: "fixture-runtime", sourceCommit },
      productLayout: discoverProductLayout({ repositoryRoot, relativePaths: files }),
    });
  let checks = [];
  let totalDispatches = 0;
  const execute = async (selected, expectedDispatches, { fails = false, full = false } = {}) => {
    const current = fingerprints();
    const pending = pendingVerificationPlan(
      {
        options: { mode: full ? "full" : "repo", printPlan: false, simulatedPaths: [] },
        admission: { mode: full ? "full" : "targeted", reason: "fixture" },
        classifiedPaths: [],
        readOnlyCommands: selected,
        workspaceCommands: [],
        verificationScope: "fixture",
      },
      current,
      checks,
      { completeCommands: commands },
    );
    assert.equal(pending.readOnlyCommands.length, expectedDispatches);
    const observed = new Map(checks.map((check) => [check.key, check]));
    const execution = withVerificationSessionLock(
      () =>
        runPlan(pending, {
          repositoryRoot,
          onResult(result) {
            totalDispatches += 1;
            if (result.status !== 0 || result.error || result.diagnosticRequired)
              observed.delete(result.command.key);
            else
              observed.set(result.command.key, {
                key: result.command.key,
                fingerprint: current.get(result.command.key),
                completedAt: new Date().toISOString(),
                elapsedMs: result.elapsedMs,
              });
          },
        }),
      { repositoryRoot },
    );
    if (fails) await assert.rejects(execution, /checks failed/u);
    else await execution;
    const stored = checkpointVerificationEvidenceRecord(null, [...observed.values()], snapshot());
    writeFileSync(path.join(repositoryRoot, "evidence.json"), JSON.stringify(stored));
    checks = validateVerificationEvidenceRecord(
      JSON.parse(readFileSync(path.join(repositoryRoot, "evidence.json"))),
    ).checks;
    assert.equal(
      readFileSync(path.join(repositoryRoot, "dispatch.log"), "utf8").trim().split("\n").length,
      totalDispatches,
    );
    return pending;
  };
  const cold = await execute(commands.slice(0, 2), 2);
  assert.equal(
    cold.evidence.missingCoverage.length,
    3,
    "a cold basis does not expand development dispatch",
  );
  const resumed = await execute(commands.slice(0, 2), 0);
  assert.equal(resumed.evidence.reused.length, 2, "serialized handoff preserves successes");
  await execute(commands, 1, { full: true });
  assert.deepEqual(
    successfulVerificationCommands(commands, fingerprints("another-commit"), checks),
    names,
  );
  writeFileSync(path.join(repositoryRoot, ".prettierrc.json"), '{"singleQuote":true}\n');
  await execute(commands, 0);
  writeFileSync(path.join(repositoryRoot, "inputs/module.json"), "2\n");
  await execute(commands, 2);
  const original = readFileSync(path.join(repositoryRoot, "scripts/alpha.test.mjs"), "utf8");
  writeFileSync(
    path.join(repositoryRoot, "scripts/alpha.test.mjs"),
    `${original}\nthrow new Error('fixture failure');\n`,
  );
  await execute(commands, 1, { fails: true });
  assert.equal(successfulVerificationCommands(commands, fingerprints(), checks).length, 2);
  writeFileSync(path.join(repositoryRoot, "scripts/alpha.test.mjs"), original);
  await execute(commands, 1, { full: true });
  writeFileSync(path.join(repositoryRoot, "inputs/shared.json"), "2\n");
  await execute(commands, 3);
  t.diagnostic(
    `Observed ${totalDispatches} real unit dispatches across 8 runs; reuse-only resume dispatched 0; isolated change 2/3; repair 1/3. Final observed unit times: ${checks.map((check) => check.elapsedMs).join(", ")}ms.`,
  );
});

test("freshness and evidence integrity reject expired, future, aborted and provisional results", () => {
  const command = {
    key: "external",
    executable: process.execPath,
    args: ["observation.mjs"],
    reuseMaxAgeMs: 1000,
  };
  const fingerprint = digest("current input");
  const now = Date.now();
  const check = {
    key: command.key,
    fingerprint,
    completedAt: new Date(now - 100).toISOString(),
    elapsedMs: 7,
  };
  const plan = { readOnlyCommands: [command], workspaceCommands: [] };
  const pending = (value, at = now) =>
    pendingVerificationPlan(plan, new Map([[command.key, fingerprint]]), [value], { now: at });
  assert.equal(pending(check).readOnlyCommands.length, 0);
  assert.equal(pending(check, now + 1000).readOnlyCommands.length, 1);
  for (const invalid of [
    { ...check, completedAt: new Date(now + 1).toISOString() },
    { ...check, completedAt: null },
    { ...check, elapsedMs: null },
    { ...check, fingerprint: digest("different input") },
  ])
    assert.equal(pending(invalid).readOnlyCommands.length, 1);
  for (const invalid of [
    { ...check, status: "running" },
    { ...check, elapsedMs: -1 },
  ]) {
    assert.throws(
      () =>
        validateVerificationEvidenceRecord(
          checkpointVerificationEvidenceRecord(null, [invalid], []),
        ),
      /invalid schema/u,
    );
  }
  const corrupted = checkpointVerificationEvidenceRecord(null, [check], []);
  corrupted.checks[0].elapsedMs += 1;
  assert.throws(() => validateVerificationEvidenceRecord(corrupted), /digest does not match/u);
});

test("unknown publication inputs stop before any verifier is dispatched", async (t) => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "verification-unmapped-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  const planned = route(["unmapped-input.bin"], { entryMode: "full" });
  assert.match(
    planned.admission.coverageBlockedReason,
    /unmapped-input.bin.*exactConsumers or testConsumers.*verification.json/u,
  );
  planned.options.printPlan = false;
  planned.readOnlyCommands = [
    {
      key: "must-not-start",
      executable: process.execPath,
      phase: "preflight",
      args: ["--eval", "require('node:fs').writeFileSync('unexpected-dispatch', 'failed')"],
    },
  ];
  await assert.rejects(runPlan(planned, { repositoryRoot }), /Unmapped verification inputs/u);
  assert.equal(existsSync(path.join(repositoryRoot, "unexpected-dispatch")), false);
});

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
  assert.ok(nativePaths.includes("session_index.jsonl.lock"));
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

test("identity consumers preserve existing complete owners and reusable unrelated evidence", async (t) => {
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
