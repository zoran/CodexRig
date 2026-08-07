import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { runPlan, verificationChildEnvironment } from "./verification-executor.mjs";
import { verificationChildEnvironment as runtimeChildEnvironment } from "./verification-runtime-identity.mjs";

function plan(commands) {
  return {
    admission: {
      canAdvanceSuccessfulBasis: false,
      focusedCommandOwners: [],
      fullRelevantPaths: [],
      mode: "targeted",
      reason: "artifact shard fixture",
      uncoveredFullRelevantPaths: [],
      unknownPaths: [],
    },
    classifiedPaths: [],
    options: { mode: "repo", printPlan: false, simulatedPaths: [] },
    readOnlyCommands: commands,
    verificationScope: "targeted",
    workspaceCommands: [],
  };
}

function delayedCommand({ artifactOwner, key, lockPath, orderPath }) {
  const source = `
    import { appendFileSync, closeSync, openSync, rmSync } from "node:fs";
    let descriptor;
    try {
      ${lockPath ? `descriptor = openSync(${JSON.stringify(lockPath)}, "wx");` : ""}
      appendFileSync(${JSON.stringify(orderPath)}, ${JSON.stringify(`start:${key}\n`)});
      setTimeout(() => {
        if (descriptor !== undefined) {
          closeSync(descriptor);
          rmSync(${JSON.stringify(lockPath)});
        }
        appendFileSync(${JSON.stringify(orderPath)}, ${JSON.stringify(`end:${key}\n`)});
      }, 80);
    } catch {
      appendFileSync(${JSON.stringify(orderPath)}, ${JSON.stringify(`collision:${key}\n`)});
      process.exitCode = 2;
    }
  `;
  return {
    args: ["--input-type=module", "--eval", source],
    artifactOwners: [artifactOwner],
    executable: process.execPath,
    key,
    label: key,
    phase: "preflight",
    reason: "artifact shard fixture",
  };
}

test("same artifact owners serialize while disjoint owners run in parallel", async (t) => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "verification-artifact-shards-"));
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }));

  const sharedOrder = path.join(fixtureRoot, "shared-order.txt");
  const sharedLock = path.join(fixtureRoot, "shared.lock");
  await runPlan(
    plan([
      delayedCommand({
        artifactOwner: "workspace:alpha",
        key: "shared-a",
        lockPath: sharedLock,
        orderPath: sharedOrder,
      }),
      delayedCommand({
        artifactOwner: "workspace:alpha",
        key: "shared-b",
        lockPath: sharedLock,
        orderPath: sharedOrder,
      }),
    ]),
  );
  assert.deepEqual(readFileSync(sharedOrder, "utf8").trim().split("\n"), [
    "start:shared-a",
    "end:shared-a",
    "start:shared-b",
    "end:shared-b",
  ]);

  const disjointOrder = path.join(fixtureRoot, "disjoint-order.txt");
  await runPlan(
    plan([
      delayedCommand({
        artifactOwner: "workspace:alpha",
        key: "disjoint-a",
        orderPath: disjointOrder,
      }),
      delayedCommand({
        artifactOwner: "workspace:beta",
        key: "disjoint-b",
        orderPath: disjointOrder,
      }),
    ]),
  );
  assert.deepEqual(
    new Set(readFileSync(disjointOrder, "utf8").trim().split("\n").slice(0, 2)),
    new Set(["start:disjoint-a", "start:disjoint-b"]),
  );
});

test("verification children use the runtime-bound environment owner", () => {
  assert.equal(verificationChildEnvironment, runtimeChildEnvironment);
  const child = verificationChildEnvironment({
    BASH_ENV: "/tmp/attack",
    CONTEXT_INDEX_OFFLINE: "1",
    ENV: "/tmp/attack",
    IMAGE_ASSET_MAX_BYTES: "9999999",
    NODE_OPTIONS: "--require=/tmp/preload.cjs",
    NODE_PATH: "/tmp/modules",
    NPM_CONFIG_NODE_OPTIONS: "--require=/tmp/npm-preload.cjs",
    PNPM_CONFIG_NODE_OPTIONS: "--require=/tmp/pnpm-preload.cjs",
    PNPM_CONFIG_SCRIPT_SHELL: "/tmp/unsafe-shell",
    PATH: "/safe/bin",
    TEST_FORCE_FAILURE: "1",
  });
  assert.equal(child.BASH_ENV, undefined);
  assert.equal(child.ENV, undefined);
  assert.equal(child.NODE_OPTIONS, undefined);
  assert.equal(child.NODE_PATH, undefined);
  assert.equal(child.NPM_CONFIG_NODE_OPTIONS, undefined);
  assert.equal(child.PNPM_CONFIG_NODE_OPTIONS, undefined);
  assert.equal(child.PNPM_CONFIG_SCRIPT_SHELL, undefined);
  assert.equal(child.TEST_FORCE_FAILURE, undefined);
  assert.equal(child.CONTEXT_INDEX_OFFLINE, "1");
  assert.equal(child.IMAGE_ASSET_MAX_BYTES, "9999999");
  assert.equal(child.PATH, "/safe/bin");
  assert.equal(child.PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN, "error");
});

test("sanitized pnpm children cannot inherit ambient preload or script-shell configuration", (t) => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "verification-pnpm-environment-"));
  const preloadSentinel = path.join(fixtureRoot, "preload-ran");
  const shellSentinel = path.join(fixtureRoot, "shell-ran");
  const preload = path.join(fixtureRoot, "preload.cjs");
  const unsafeShell = path.join(fixtureRoot, "unsafe-shell");
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }));
  writeFileSync(
    path.join(fixtureRoot, "package.json"),
    `${JSON.stringify({
      name: "verification-pnpm-environment",
      private: true,
      scripts: { probe: "node --input-type=module --eval \"process.stdout.write('probe\\\\n')\"" },
    })}\n`,
    "utf8",
  );
  writeFileSync(
    preload,
    `require("node:fs").writeFileSync(${JSON.stringify(preloadSentinel)}, "ran\\n");\n`,
    "utf8",
  );
  writeFileSync(
    unsafeShell,
    `#!/bin/sh\nprintf 'ran\\n' >${JSON.stringify(shellSentinel)}\nexit 0\n`,
    { encoding: "utf8", mode: 0o755 },
  );
  const environment = verificationChildEnvironment({
    ...process.env,
    PNPM_CONFIG_NODE_OPTIONS: `--require=${preload}`,
    PNPM_CONFIG_SCRIPT_SHELL: unsafeShell,
  });
  const result = spawnSync("pnpm", ["run", "probe"], {
    cwd: fixtureRoot,
    encoding: "utf8",
    env: environment,
    input: "",
    stdio: "pipe",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /probe/u);
  assert.equal(existsSync(preloadSentinel), false);
  assert.equal(existsSync(shellSentinel), false);
});

function markerCommand(markerFile, marker, phase, exitCode = 0) {
  return {
    args: [
      "--input-type=module",
      "--eval",
      `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(markerFile)}, ${JSON.stringify(`${marker}\n`)}); process.exit(${exitCode});`,
    ],
    executable: process.execPath,
    key: marker,
    label: marker,
    phase,
    reason: "phase-order fixture",
  };
}

function executionPlan(readOnlyCommands, workspaceCommands) {
  return {
    admission: {
      canAdvanceSuccessfulBasis: false,
      focusedCommandOwners: [],
      fullRelevantPaths: [],
      mode: "full",
      reason: "phase-order fixture",
      uncoveredFullRelevantPaths: [],
      unknownPaths: [],
    },
    classifiedPaths: [],
    gitAvailable: true,
    options: { mode: "full", printPlan: false, simulatedPaths: [] },
    readOnlyCommands,
    reason: "phase-order fixture",
    verificationScope: "complete",
    workspaceCommands,
  };
}

test("failed preflight stops broad regressions, builds, and tests", async (t) => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "verification-phase-failure-"));
  const markerFile = path.join(fixtureRoot, "order.txt");
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }));

  await assert.rejects(
    runPlan(
      executionPlan(
        [
          markerCommand(markerFile, "preflight-pass", "preflight"),
          markerCommand(markerFile, "preflight-fail", "preflight", 1),
          markerCommand(markerFile, "broad", "broad"),
        ],
        [
          markerCommand(markerFile, "build", "workspace-build"),
          markerCommand(markerFile, "test", "workspace-test"),
        ],
      ),
    ),
    /Preflight verification checks failed: preflight-fail/u,
  );
  assert.deepEqual(
    new Set(readFileSync(markerFile, "utf8").trim().split("\n")),
    new Set(["preflight-pass", "preflight-fail"]),
  );
});

test("a failed command does not schedule the remaining same-phase suffix", async (t) => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "verification-phase-suffix-"));
  const markerFile = path.join(fixtureRoot, "order.txt");
  const previousParallel = process.env.VERIFY_MAX_PARALLEL;
  process.env.VERIFY_MAX_PARALLEL = "1";
  t.after(() => {
    if (previousParallel === undefined) delete process.env.VERIFY_MAX_PARALLEL;
    else process.env.VERIFY_MAX_PARALLEL = previousParallel;
    rmSync(fixtureRoot, { force: true, recursive: true });
  });

  await assert.rejects(
    runPlan(
      executionPlan(
        [
          markerCommand(markerFile, "first-failure", "preflight", 1),
          markerCommand(markerFile, "missing-suffix", "preflight"),
        ],
        [],
      ),
    ),
    /Preflight verification checks failed: first-failure/u,
  );
  assert.deepEqual(readFileSync(markerFile, "utf8").trim().split("\n"), ["first-failure"]);
});

test("successful phases complete in preflight, broad, build, test order", async (t) => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "verification-phase-order-"));
  const markerFile = path.join(fixtureRoot, "order.txt");
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }));

  await runPlan(
    executionPlan(
      [
        markerCommand(markerFile, "static-preflight", "preflight"),
        markerCommand(markerFile, "broad", "broad"),
      ],
      [
        markerCommand(markerFile, "workspace-typecheck", "preflight"),
        markerCommand(markerFile, "build", "workspace-build"),
        markerCommand(markerFile, "test", "workspace-test"),
      ],
    ),
  );

  const order = readFileSync(markerFile, "utf8").trim().split("\n");
  assert.ok(order.indexOf("static-preflight") < order.indexOf("broad"));
  assert.ok(order.indexOf("workspace-typecheck") < order.indexOf("broad"));
  assert.ok(order.indexOf("broad") < order.indexOf("build"));
  assert.ok(order.indexOf("build") < order.indexOf("test"));
});
