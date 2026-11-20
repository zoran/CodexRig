/** Proves narrow development selection and identical file units in complete verification. */
import assert from "node:assert/strict";
import test from "node:test";
import { buildPlan } from "./adaptive-runner.mjs";
import { parseArgs } from "./adaptive-options.mjs";
import { readVerificationConfiguration } from "./verification-configuration.mjs";
import { verificationExecutionUnits } from "./verification-check-inputs.mjs";

test("explicit source consumers do not expand into unrelated suite files", () => {
  const configuration = readVerificationConfiguration();
  for (const source of [
    "scripts/context/context-budget.mjs",
    "scripts/deps/dependency-plan.mjs",
    "scripts/framework/framework-upgrade-review.mjs",
  ]) {
    // Source-only owners are intentionally absent from generated projects.
    if (!configuration.testConsumers[source]) continue;
    const plan = buildPlan(parseArgs(["--path", source, "--print-plan"]));
    const files = plan.readOnlyCommands
      .flatMap(verificationExecutionUnits)
      .flatMap((unit) => (unit.testFile ? [unit.testFile] : []));
    assert.deepEqual([...new Set(files)].sort(), [...configuration.testConsumers[source]].sort());
  }
});

test("one registered file retains the complete owner's reusable unit identity", () => {
  const check = "verification-orchestration-regressions";
  const file = "scripts/verify/adaptive-cli.test.mjs";
  const options = parseArgs(["--check", check, "--test-file", file]);
  const plan = buildPlan(options);
  assert.equal(plan.admission.mode, "targeted");
  assert.equal(plan.readOnlyCommands.length, 1);
  const selected = verificationExecutionUnits(plan.readOnlyCommands[0]);
  const parent = readVerificationConfiguration().commands.find((command) => command.key === check);
  const complete = verificationExecutionUnits(parent).find((unit) => unit.testFile === file);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].key, complete.key);
  assert.deepEqual(selected[0].args, complete.args);
  assert.equal(selected[0].acceptanceKey, complete.acceptanceKey);
  assert.equal(buildPlan(parseArgs(["--check", check])).admission.mode, "targeted");
  assert.equal(
    buildPlan(parseArgs(["--check", check, "--test-file", file, "--test-name-pattern", "one case"]))
      .admission.mode,
    "reproduction",
  );
});

test("file selection rejects missing ownership and inseparable checks", () => {
  assert.throws(
    () => parseArgs(["--test-file", "scripts/verify/adaptive-cli.test.mjs"]),
    /requires --check/u,
  );
  assert.throws(
    () => parseArgs(["--check", "docs", "--test-file", "../outside.test.mjs"]),
    /repository-relative/u,
  );
  for (const check of ["docs", "context-regressions"])
    assert.throws(
      () =>
        buildPlan(
          parseArgs(["--check", check, "--test-file", "scripts/verify/adaptive-cli.test.mjs"]),
        ),
      /does not own an independent test file/u,
    );
});
