/** Verifies useful publication failures survive successful sibling output and terminal redaction. */
import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { createPublicationOutput } from "../terminal/publication-output.mjs";
import { runPublicationCommand } from "./publication-command.mjs";

async function failedDiagnostic(source, { timeout = 5000, verbose = false } = {}) {
  const lines = [];
  const output = createPublicationOutput({
    root: process.cwd(),
    verbose,
    log: (line) => lines.push(line),
  });
  let failure;
  try {
    await runPublicationCommand({
      command: process.execPath,
      args: ["--input-type=module", "-e", source],
      root: process.cwd(),
      env: {},
      output,
      timeout,
    });
  } catch (error) {
    failure = error;
    output.fail(error);
  }
  assert.ok(failure, "the failed gate must not be accepted");
  return lines.join("\n");
}

test("publication retains an earlier SDK failure after successful Terraform output", async () => {
  const diagnostic = await failedDiagnostic(`
    process.stderr.write('Wear verification requires ANDROID_SDK_ROOT or ANDROID_HOME.\\n');
    await new Promise(resolve => setTimeout(resolve, 30));
    process.stdout.write('Success! The Terraform configuration is valid.\\n'.repeat(160));
    process.exitCode = 1;
  `);
  assert.match(diagnostic, /Wear verification requires ANDROID_SDK_ROOT or ANDROID_HOME/u);
  assert.match(diagnostic, /Command failed \(1\)/u);
  assert.ok(diagnostic.length < 12_000);
});

test("publication retains the final failed-check summary across both noisy output streams", async () => {
  const diagnostic = await failedDiagnostic(`
    process.stderr.write('Mobile failed before cloud completed.\\n');
    process.stderr.write('Unrelated successful sibling warning.\\n'.repeat(100));
    process.stderr.write('Adaptive verification failed: Broad regression checks failed: Kizor mobile\\n');
    await new Promise(resolve => setTimeout(resolve, 30));
    process.stdout.write('Successful sibling output.\\n'.repeat(180));
    process.exitCode = 1;
  `);
  assert.match(diagnostic, /Broad regression checks failed: Kizor mobile/u);
  assert.ok(diagnostic.split("\n").length <= 65);
});

test("publication sanitizes complete split diagnostics before retaining a bounded failure", async () => {
  const diagnostic = await failedDiagnostic(`
    process.stderr.write('Authorization: Bea');
    await new Promise(resolve => setTimeout(resolve, 20));
    process.stderr.write('rer fixture-private-diagnostic-value\\n');
    process.stderr.write('Actual test failure.\\n');
    process.stdout.write('Successful output.\\n'.repeat(100));
    process.exitCode = 1;
  `);
  assert.match(diagnostic, /Actual test failure/u);
  assert.doesNotMatch(diagnostic, /fixture-private-diagnostic-value/u);
});

test("publication retains merged redaction when credentials span both captured streams", async () => {
  const privateValue = "fixture-cross-stream-private-value";
  for (const [prefix, suffix] of [
    ["Authorization: Bea", `rer ${privateValue}\n`],
    ["Authori", `zation: ${privateValue}\n`],
    ["client_secret: |\n", `  ${privateValue}\n`],
    ["-----BEGIN PRIVATE ", `KEY-----\n${privateValue}\n-----END PRIVATE KEY-----\n`],
  ]) {
    for (const [first, second] of [
      ["stdout", "stderr"],
      ["stderr", "stdout"],
    ]) {
      for (const verbose of [false, true]) {
        const diagnostic = await failedDiagnostic(
          `
            process.${first}.write(${JSON.stringify(prefix)});
            await new Promise(resolve => setTimeout(resolve, 20));
            process.${second}.write(${JSON.stringify(suffix)});
            process.${second}.write('Actual check failed: retained failure summary.\\n');
            process.exitCode = 1;
          `,
          { verbose },
        );
        assert.doesNotMatch(diagnostic, new RegExp(privateValue, "u"));
        assert.match(diagnostic, /retained failure summary/u);
      }
    }
  }
});

test("publication timeout retains captured errors and closes its owned command", async () => {
  const diagnostic = await failedDiagnostic(
    `
      process.stderr.write('Check stalled: fixture timeout reason.\\n');
      setInterval(() => {}, 1000);
    `,
    { timeout: 250 },
  );
  assert.match(diagnostic, /Publication command timed out|Command timed out|command timed out/u);
  assert.match(diagnostic, /fixture timeout reason/u);
});

test("successful captured publication gates remain quiet", async () => {
  const lines = [];
  const output = createPublicationOutput({ root: process.cwd(), log: (line) => lines.push(line) });
  await runPublicationCommand({
    command: process.execPath,
    args: ["-e", "process.stdout.write('successful details');process.stderr.write('warning');"],
    root: process.cwd(),
    env: {},
    output,
    timeout: 5000,
  });
  assert.deepEqual(lines, []);
});
