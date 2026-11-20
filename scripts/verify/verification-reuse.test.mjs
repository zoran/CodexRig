/** Verifies actual dispatch, persistent reuse, failure retention and freshness. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { route } from "./adaptive-runner-test-helpers.mjs";
import { discoverProductLayout } from "../repository/product-roots.mjs";
import {
  pendingVerificationPlan,
  successfulVerificationCommands,
  verificationCheckFingerprints,
  verificationExecutionUnits,
} from "./verification-check-inputs.mjs";
import { digest } from "./verification-record-helpers.mjs";
import { runPlan } from "./verification-executor.mjs";
import { withVerificationSessionLock } from "./verification-session-lock.mjs";
import {
  checkpointVerificationEvidenceRecord,
  validateVerificationEvidenceRecord,
} from "./verification-evidence-record.mjs";

test("bounded Node files retain independent results and timeout-sensitive identities", async (t) => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "verification-bounded-files-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  writeFileSync(
    path.join(repositoryRoot, "fast.test.mjs"),
    "import test from 'node:test'; test('fast', () => {});\n",
  );
  writeFileSync(
    path.join(repositoryRoot, "slow.test.mjs"),
    "import test from 'node:test'; import {setTimeout} from 'node:timers/promises'; test('slow', t => setTimeout(5000, null, {signal:t.signal}));\n",
  );
  const command = {
    key: "bounded",
    label: "bounded",
    phase: "preflight",
    executable: process.execPath,
    args: [
      "--test",
      "--test-concurrency=1",
      "--test-timeout=100",
      "fast.test.mjs",
      "slow.test.mjs",
    ],
  };
  const units = verificationExecutionUnits(command);
  assert.deepEqual(
    units.map((unit) => unit.testFile),
    ["fast.test.mjs", "slow.test.mjs"],
  );
  assert(units.every((unit) => unit.args.includes("--test-timeout=100")));
  const changed = verificationExecutionUnits({
    ...command,
    args: command.args.map((arg) => (arg === "--test-timeout=100" ? "--test-timeout=200" : arg)),
  });
  assert(units.every((unit, index) => unit.key !== changed[index].key));
  const results = [];
  await withVerificationSessionLock(
    () =>
      assert.rejects(
        runPlan(
          {
            options: { mode: "repo", printPlan: false },
            admission: { mode: "targeted" },
            classifiedPaths: [],
            verificationScope: "targeted",
            readOnlyCommands: units,
            workspaceCommands: [],
          },
          {
            repositoryRoot,
            onResult(result) {
              results.push(result);
            },
          },
        ),
        /Preflight verification checks failed/u,
      ),
    { repositoryRoot },
  );
  assert.equal(results.length, 2);
  assert.equal(results[0].status, 0);
  assert.notEqual(results[1].status, 0);
  const fingerprints = new Map(units.map((unit) => [unit.key, digest(unit.key)]));
  const first = {
    key: units[0].key,
    fingerprint: fingerprints.get(units[0].key),
    status: "passed",
    completedAt: new Date().toISOString(),
    elapsedMs: results[0].elapsedMs,
  };
  const pending = pendingVerificationPlan(
    { readOnlyCommands: [command], workspaceCommands: [] },
    fingerprints,
    [first],
  );
  assert.deepEqual(
    pending.readOnlyCommands.map((unit) => unit.testFile),
    ["slow.test.mjs"],
  );
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
  planned.readOnlyCommands = [
    {
      key: "must-not-start",
      executable: process.execPath,
      phase: "preflight",
      args: ["--eval", "require('node:fs').writeFileSync('unexpected-dispatch', 'failed')"],
    },
  ];
  for (const printPlan of [false, true]) {
    planned.options.printPlan = printPlan;
    await assert.rejects(runPlan(planned, { repositoryRoot }), /Unmapped verification inputs/u);
  }
  assert.equal(existsSync(path.join(repositoryRoot, "unexpected-dispatch")), false);
});
