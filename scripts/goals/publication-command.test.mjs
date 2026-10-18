/** Verifies publication diagnostics and cancellation completion of owned command groups. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, { mkdtempSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
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

// The direct child can close before its SIGTERM-ignoring descendant. A private subreaper
// owns orphan collection; readiness and exact identities keep this regression deterministic.
test(
  "publication cancellation outlives direct-child closure and reaps its stubborn descendant",
  { skip: process.platform !== "linux", timeout: 35000 },
  () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), "audit_portable_publication_cancel_"));
    const ready = path.join(fixture, "ready.json");
    const identityModule = new URL("../repository/runtime-process-identity.mjs", import.meta.url)
      .href;
    const commandModule = new URL("./publication-command.mjs", import.meta.url).href;
    const descendant = `
      import { captureProcessIdentity } from ${JSON.stringify(identityModule)};
      process.on("SIGTERM", () => {});
      process.send({ identity: captureProcessIdentity(process.pid) }, () => process.disconnect());
      setTimeout(() => process.exit(88), 12000);
    `;
    const target = `
      import { spawn } from "node:child_process";
      import { writeFileSync } from "node:fs";
      process.on("SIGTERM", () => process.exit(0));
      const child = spawn(process.execPath, ["--input-type=module", "--eval", ${JSON.stringify(descendant)}],
        { stdio: ["ignore", "ignore", "ignore", "ipc"] });
      child.once("message", (message) => writeFileSync(${JSON.stringify(ready)}, JSON.stringify(message)));
      setTimeout(() => process.exit(89), 12000);
    `;
    const source = `
      import { existsSync, readFileSync } from "node:fs";
      import { setTimeout as delay } from "node:timers/promises";
      import { inspectProcessIdentity } from ${JSON.stringify(identityModule)};
      import { runPublicationCommand } from ${JSON.stringify(commandModule)};
      let owned;
      let report;
      const outcome = runPublicationCommand({ command: process.execPath,
        args: ["--input-type=module", "--eval", ${JSON.stringify(target)}],
        root: ${JSON.stringify(fixture)}, env: {}, timeout: 10000
      }).then(() => ({}), error => ({ message: error.message }));
      try {
        const deadline = performance.now() + 5000;
        while (!existsSync(${JSON.stringify(ready)})) {
          if (performance.now() >= deadline) throw new Error("Owned descendant never became ready");
          await delay(10);
        }
        owned = JSON.parse(readFileSync(${JSON.stringify(ready)}, "utf8")).identity;
        const started = performance.now();
        process.emit("SIGTERM");
        const result = await outcome;
        let state = inspectProcessIdentity(owned);
        if (state === "active") {
          const stat = readFileSync("/proc/" + owned.pid + "/stat", "utf8");
          state = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\\s+/u)[0];
        }
        report = { ...result, elapsed: performance.now() - started, state, descendant: owned.pid };
      } finally {
        if (owned && inspectProcessIdentity(owned) === "active") {
          process.kill(owned.pid, "SIGKILL");
          await delay(50);
        }
      }
      process.stdout.write(JSON.stringify(report));
    `;
    const subreaper = String.raw`
import ctypes, json, os, subprocess, sys, time
if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), "Cannot create the isolated test subreaper")
child = subprocess.Popen(sys.argv[1:], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True)
try:
    stdout, stderr = child.communicate(timeout=15)
except subprocess.TimeoutExpired:
    child.kill()
    stdout, stderr = child.communicate()
reaped = []
quiescent = False
deadline = time.monotonic() + 15
while time.monotonic() < deadline:
    try:
        pid, status = os.waitpid(-1, os.WNOHANG)
    except ChildProcessError:
        quiescent = True
        break
    if pid:
        reaped.append(pid)
    else:
        time.sleep(0.01)
print(json.dumps(dict(status=child.returncode, stdout=stdout, stderr=stderr,
                      reaped=reaped, quiescent=quiescent)))
`;
    try {
      const result = spawnSync(
        "python3",
        ["-c", subreaper, process.execPath, "--input-type=module", "--eval", source],
        {
          encoding: "utf8",
          timeout: 32000,
          maxBuffer: 64 * 1024,
          env: { ...process.env, TMPDIR: fixture },
        },
      );
      assert.equal(result.error, undefined, result.stderr);
      assert.equal(result.status, 0, result.stderr);
      const reaping = JSON.parse(result.stdout);
      assert.equal(reaping.status, 0, reaping.stderr);
      assert.equal(reaping.quiescent, true, "every adopted fixture process must be reaped");
      const observed = JSON.parse(reaping.stdout);
      assert.ok(reaping.reaped.includes(observed.descendant));
      assert.match(observed.message, /Publication interrupted by SIGTERM/u);
      assert.ok(["stale", "Z", "X"].includes(observed.state), JSON.stringify(observed));
      assert.ok(observed.elapsed >= 1900 && observed.elapsed < 5000, JSON.stringify(observed));
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  },
);

test("publication reports unproven group completion and preserves its original failure", async () => {
  const originalDirectory = fs.readdirSync;
  try {
    fs.readdirSync = (target, ...args) => {
      if (target === "/proc")
        throw Object.assign(new Error("fixture group hidden"), { code: "EACCES" });
      return originalDirectory(target, ...args);
    };
    syncBuiltinESMExports();
    const diagnostic = await failedDiagnostic("setInterval(() => {}, 1000);", { timeout: 250 });
    assert.match(diagnostic, /Publication command timed out/u);
    assert.match(diagnostic, /Cancellation could not prove group completion/u);
  } finally {
    fs.readdirSync = originalDirectory;
    syncBuiltinESMExports();
  }
});

test("publication preserves spawn failure semantics", async () => {
  await assert.rejects(
    runPublicationCommand({
      command: "/nonexistent-publication-fixture-command",
      args: [],
      root: process.cwd(),
      env: {},
    }),
    /Publication command could not start: ENOENT/u,
  );
});
