/** Proves generated verification selection through the shipped child modules, without nested suites. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { projectOutputText } from "../framework/project-output-projection.mjs";
import {
  readProjectToolSelection,
  selectedProjectVerification,
} from "../framework/project-tool-selection.mjs";
import {
  currentProjectInstructions,
  initialProjectAgents,
} from "../framework/generated-project-documents.mjs";

function generatedFixture(t) {
  const source = path.resolve(import.meta.dirname, "..", "..");
  const child = mkdtempSync(path.join(tmpdir(), "generated-verification-"));
  t.after(() => rmSync(child, { recursive: true, force: true }));
  const selection = readProjectToolSelection(source);
  for (const file of selection.files) {
    const target = path.join(child, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, projectOutputText(readFileSync(path.join(source, file), "utf8")));
  }
  writeFileSync(
    path.join(child, ".codex/verification.json"),
    JSON.stringify(
      selectedProjectVerification(
        JSON.parse(readFileSync(path.join(source, ".codex/verification.json"))),
        selection,
      ),
    ),
  );
  return { source, child };
}

test("generated children retain narrow check selection and the current agent course check", (t) => {
  const { source, child } = generatedFixture(t);
  const policy = currentProjectInstructions(source);
  const agents = initialProjectAgents(source);
  assert.match(policy, /at most two active minutes/u);
  assert.match(agents, /At most two active minutes/u);
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
    import assert from 'node:assert/strict';
    import {parseArgs} from './scripts/verify/adaptive-options.mjs';
    import {buildPlan} from './scripts/verify/adaptive-runner.mjs';
    import {runPlan} from './scripts/verify/verification-executor.mjs';
    import {sanitizeMultilineForTerminal} from './scripts/terminal/terminal-output.mjs';
    import {verificationExecutionUnits} from './scripts/verify/verification-check-inputs.mjs';
    const all = buildPlan(parseArgs(['--check','runtime-safety']));
    const one = buildPlan(parseArgs(['--check','runtime-safety','--test-file','scripts/setup/repository-storage.test.mjs']));
    const unit = verificationExecutionUnits(one.readOnlyCommands[0]);
    assert.equal(one.admission.mode, 'targeted');
    assert.equal(unit.length, 1);
    assert.ok(all.readOnlyCommands.flatMap(verificationExecutionUnits).some(candidate => candidate.key === unit[0].key));
    assert.equal(buildPlan(parseArgs(['--check','runtime-safety','--test-name-pattern','one case'])).admission.mode, 'reproduction');
    const terminal = buildPlan(parseArgs(['--check','terminal-safety']));
    assert.deepEqual(terminal.readOnlyCommands[0].args, ['--test','scripts/terminal/terminal-output.test.mjs']);
    assert.equal(sanitizeMultilineForTerminal('Password validation failed: opaque-diagnostic-value'), 'Password validation failed:<redacted-secret>');
    const unmapped = buildPlan(parseArgs(['--mode','full','--print-plan']), {
      basis: {trusted: false, reason: 'generated publication admission'},
      changedScope: {paths: ['unmapped-input.bin'], incomplete: false, reason: 'fixture'},
    });
    await assert.rejects(runPlan(unmapped), /Unmapped verification inputs/u);
  `,
    ],
    { cwd: child, encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("generated runtime validator preserves the native sidebar preference across launches", async (t) => {
  const { child } = generatedFixture(t);
  const { validateRuntimeCodexConfig } = await import(
    pathToFileURL(path.join(child, "scripts/setup/validate-codex-config.mjs")).href
  );
  const config = path.join(child, "config.toml");
  const content = "[tui]\nscreen_reader_detection_done = true\nsidebar_width_percent = 36\n";
  writeFileSync(config, content, { mode: 0o600 });
  assert.equal(validateRuntimeCodexConfig(child).status, "present");
  assert.equal(validateRuntimeCodexConfig(child).status, "present");
  assert.equal(readFileSync(config, "utf8"), content);
  writeFileSync(config, content.replace("36", "100"));
  assert.throws(() => validateRuntimeCodexConfig(child), /terminal preference is unsupported/u);
  writeFileSync(config, content + 'command = "run-project-code"\n');
  assert.throws(() => validateRuntimeCodexConfig(child), /terminal preference is unsupported/u);
});
