/** Verifies verification executor behavior for the repository verification boundary. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { spawnRuntimeLifecycleCommandSync } from "../repository/runtime-lifecycle-process.mjs";
import { runPlan, verificationChildEnvironment } from "./verification-executor.mjs";
import { verificationChildEnvironment as runtimeChildEnvironment } from "./verification-runtime-identity.mjs";
import { withVerificationSessionLock } from "./verification-session-lock.mjs";

async function runLockedPlan(planValue, repositoryRoot) {
  return await withVerificationSessionLock(() => runPlan(planValue, { repositoryRoot }), {
    repositoryRoot,
  });
}

function privateKeyBoundary(kind, phase) {
  return ["-----", phase, " ", kind, " KEY-----"].join("");
}

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

function artifactCommand({
  artifactOwner,
  key,
  lockPath,
  orderPath,
  peerKey,
  startupDelayMilliseconds = 0,
}) {
  const source = `
    import { appendFileSync, closeSync, openSync, readFileSync, rmSync } from "node:fs";
    import { performance } from "node:perf_hooks";
    import { setTimeout as delay } from "node:timers/promises";
    let descriptor;
    try {
      ${startupDelayMilliseconds ? `await delay(${startupDelayMilliseconds});` : ""}
      ${lockPath ? `descriptor = openSync(${JSON.stringify(lockPath)}, "wx");` : ""}
      appendFileSync(${JSON.stringify(orderPath)}, ${JSON.stringify(`start:${key}\n`)});
      ${
        peerKey
          ? `const deadline = performance.now() + 5000;
      while (!readFileSync(${JSON.stringify(orderPath)}, "utf8").split("\\n").includes(${JSON.stringify(`start:${peerKey}`)})) {
        if (performance.now() >= deadline) throw new Error(${JSON.stringify(`Timed out waiting for artifact peer ${peerKey} in ${key}.`)});
        await delay(5);
      }`
          : "await delay(80);"
      }
      appendFileSync(${JSON.stringify(orderPath)}, ${JSON.stringify(`end:${key}\n`)});
    } catch (error) {
      console.error(error.stack ?? error);
      process.exitCode = 2;
    } finally {
      if (descriptor !== undefined) {
        closeSync(descriptor);
        rmSync(${JSON.stringify(lockPath)});
      }
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
  await runLockedPlan(
    plan([
      artifactCommand({
        artifactOwner: "workspace:alpha",
        key: "shared-a",
        lockPath: sharedLock,
        orderPath: sharedOrder,
      }),
      artifactCommand({
        artifactOwner: "workspace:alpha",
        key: "shared-b",
        lockPath: sharedLock,
        orderPath: sharedOrder,
      }),
    ]),
    fixtureRoot,
  );
  assert.deepEqual(readFileSync(sharedOrder, "utf8").trim().split("\n"), [
    "start:shared-a",
    "end:shared-a",
    "start:shared-b",
    "end:shared-b",
  ]);
  assert.equal(existsSync(sharedLock), false);

  // Readiness, rather than matching process startup times, proves disjoint commands overlap.
  // Deliberate startup skew exceeds the shared fixture's hold without changing executor limits.
  const disjointOrder = path.join(fixtureRoot, "disjoint-order.txt");
  await runLockedPlan(
    plan([
      artifactCommand({
        artifactOwner: "workspace:alpha",
        key: "disjoint-a",
        orderPath: disjointOrder,
        peerKey: "disjoint-b",
      }),
      artifactCommand({
        artifactOwner: "workspace:beta",
        key: "disjoint-b",
        orderPath: disjointOrder,
        peerKey: "disjoint-a",
        startupDelayMilliseconds: 200,
      }),
    ]),
    fixtureRoot,
  );
  const events = readFileSync(disjointOrder, "utf8").trim().split("\n");
  assert.equal(events.length, 4);
  assert.deepEqual(new Set(events.slice(0, 2)), new Set(["start:disjoint-a", "start:disjoint-b"]));
  assert.deepEqual(new Set(events.slice(2)), new Set(["end:disjoint-a", "end:disjoint-b"]));
});

test("verification children use the runtime-bound environment owner", () => {
  assert.equal(verificationChildEnvironment, runtimeChildEnvironment);
  const child = verificationChildEnvironment({
    BASH_ENV: "/tmp/attack",
    IMAGE_ASSET_OFFLINE: "1",
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
  assert.equal(child.IMAGE_ASSET_OFFLINE, "1");
  assert.equal(child.IMAGE_ASSET_MAX_BYTES, "9999999");
  assert.equal(child.PATH, "/safe/bin");
  assert.equal(child.PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN, "error");
});

test("lifecycle supervision strips ambient delegation capabilities from commands", async (t) => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "verification-delegation-env-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  const delegatedVariables = [
    "CODEXRIG_LIFECYCLE_DELEGATION_OPERATION",
    "CODEXRIG_LIFECYCLE_DELEGATION_ROLE",
    "CODEXRIG_LIFECYCLE_DELEGATION_ROOT",
    "CODEXRIG_LIFECYCLE_DELEGATION_TOKEN",
  ];
  const result = await withVerificationSessionLock(
    (lock) =>
      spawnRuntimeLifecycleCommandSync({
        args: [
          "--input-type=module",
          "--eval",
          `const names = ${JSON.stringify(delegatedVariables)}; process.stdout.write(names.every((name) => process.env[name] === undefined) ? "clean\\n" : "leaked\\n");`,
        ],
        command: process.execPath,
        lifecycleCapability: lock.lifecycleCapability,
        options: {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: Object.fromEntries(
            delegatedVariables.map((name) => [name, `ambient-${name.toLowerCase()}`]),
          ),
          stdio: "pipe",
        },
        repositoryRoot,
        role: "verification-supervisor",
      }),
    { repositoryRoot },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "clean\n");
});

test("verification plan metadata and commands cross the single-line terminal boundary", () => {
  const executorUrl = new URL("./verification-executor.mjs", import.meta.url).href;
  const source = `
    const { printPlan } = await import(${JSON.stringify(executorUrl)});
    printPlan({
      admission: {
        canAdvanceSuccessfulBasis: false,
        coveredBroadRisks: [{ riskId: "risk\\nforged", path: "src/\\u001b[31mowned.ts" }],
        focusedCommandOwners: [{ ownerKeys: ["owner\\nforged"], path: "src/\\u001b[31mowned.ts" }],
        fullRelevantPaths: ["src/\\u001b[31mowned.ts"],
        mode: "targeted",
        reason: "reason\\nforged-line",
        uncoveredBroadRisks: [],
        uncoveredFullRelevantPaths: [],
        unknownPaths: [],
      },
      classifiedPaths: [{ categories: ["security\\nforged"], path: "src/\\u001b[31mowned.ts" }],
      gitAvailable: true,
      options: { mode: "repo", printPlan: true, simulatedPaths: [] },
      readOnlyCommands: [{
        args: ["--to\\u001b[31mken", "opaque-command-secret", "line\\nforged"],
        executable: "tool",
        key: "fixture",
        label: "fixture",
        phase: "preflight",
        reason: "command\\nforged",
      }],
      verificationScope: "targeted",
      workspaceCommands: [],
    });
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: path.resolve(new URL("../..", import.meta.url).pathname),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /\u001b|opaque-command-secret/u);
  assert.match(result.stdout, /--token <redacted-secret>/u);
  assert.equal(
    result.stdout.split("\n").some((line) => line === "forged-line"),
    false,
  );
  assert.equal(
    result.stdout.split("\n").some((line) => line === "forged"),
    false,
  );
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
  // Exercise the same prepared, explicitly hook-free workspace contract as canonical consumers.
  writeFileSync(path.join(fixtureRoot, "pnpm-workspace.yaml"), "packages: []\npnpmfile: []\n");
  const install = spawnSync(
    "pnpm",
    ["install", "--offline", "--ignore-scripts", "--ignore-pnpmfile"],
    {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: environment,
      input: "",
      stdio: "pipe",
    },
  );
  assert.equal(install.status, 0, install.stderr || install.stdout);
  const result = spawnSync("pnpm", ["run", "probe"], {
    cwd: fixtureRoot,
    encoding: "utf8",
    env: environment,
    input: "",
    stdio: "pipe",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
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
    runLockedPlan(
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
      fixtureRoot,
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
    runLockedPlan(
      executionPlan(
        [
          markerCommand(markerFile, "first-failure", "preflight", 1),
          markerCommand(markerFile, "missing-suffix", "preflight"),
        ],
        [],
      ),
      fixtureRoot,
    ),
    /Preflight verification checks failed: first-failure/u,
  );
  assert.deepEqual(readFileSync(markerFile, "utf8").trim().split("\n"), ["first-failure"]);
});

test("successful phases complete in preflight, broad, build, test, delivery order", async (t) => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "verification-phase-order-"));
  const markerFile = path.join(fixtureRoot, "order.txt");
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }));

  await runLockedPlan(
    executionPlan(
      [
        markerCommand(markerFile, "static-preflight", "preflight"),
        markerCommand(markerFile, "broad", "broad"),
      ],
      [
        markerCommand(markerFile, "workspace-typecheck", "preflight"),
        markerCommand(markerFile, "build", "workspace-build"),
        markerCommand(markerFile, "test", "workspace-test"),
        markerCommand(markerFile, "delivery", "delivery"),
      ],
    ),
    fixtureRoot,
  );

  const order = readFileSync(markerFile, "utf8").trim().split("\n");
  assert.ok(order.indexOf("static-preflight") < order.indexOf("broad"));
  assert.ok(order.indexOf("workspace-typecheck") < order.indexOf("broad"));
  assert.ok(order.indexOf("broad") < order.indexOf("build"));
  assert.ok(order.indexOf("build") < order.indexOf("test"));
  assert.ok(order.indexOf("test") < order.indexOf("delivery"));
});

test("a failed target delivery verifier rejects the plan after repository checks", async (t) => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "verification-delivery-failure-"));
  const markerFile = path.join(fixtureRoot, "order.txt");
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }));

  await assert.rejects(
    runLockedPlan(
      executionPlan(
        [markerCommand(markerFile, "preflight", "preflight")],
        [
          markerCommand(markerFile, "test", "workspace-test"),
          markerCommand(markerFile, "delivery-fail", "delivery", 1),
        ],
      ),
      fixtureRoot,
    ),
    /Target delivery verification failed: delivery-fail/u,
  );
  assert.deepEqual(readFileSync(markerFile, "utf8").trim().split("\n"), [
    "preflight",
    "test",
    "delivery-fail",
  ]);
});

test("captured verifier output crosses the shared terminal-sanitization boundary", async (t) => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "verification-captured-output-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  const secret = `sk-${"s".repeat(32)}`;
  const multilineSecrets = [
    privateKeyBoundary("PRIVATE", "BEGIN"),
    "opaque-verifier-pem-body",
    privateKeyBoundary("PRIVATE", "END"),
    "private_key: |",
    "  opaque-verifier-yaml-body",
    'token = """',
    "opaque-verifier-toml-body",
    '"""',
  ].join("\n");
  const executorUrl = new URL("./verification-executor.mjs", import.meta.url).href;
  const lockUrl = new URL("./verification-session-lock.mjs", import.meta.url).href;
  const childSource = `
    import { runPlan } from ${JSON.stringify(executorUrl)};
    import { withVerificationSessionLock } from ${JSON.stringify(lockUrl)};
    const command = {
      args: ["--input-type=module", "--eval", ${JSON.stringify(
        `console.log(${JSON.stringify(`stdout ${secret} /tmp/private-verifier [31mred[0m`)}); console.error(${JSON.stringify(`stderr ${secret} /tmp/private-error`)}); console.error(${JSON.stringify(multilineSecrets)}); process.exit(1);`,
      )}],
      executable: process.execPath,
      key: "sanitized-delivery",
      label: "sanitized-delivery",
      phase: "delivery",
      reason: "terminal-boundary fixture",
    };
    const plan = {
      admission: { canAdvanceSuccessfulBasis: false, focusedCommandOwners: [], fullRelevantPaths: [], mode: "full", reason: "fixture", uncoveredFullRelevantPaths: [], unknownPaths: [] },
      classifiedPaths: [], gitAvailable: true,
      options: { mode: "full", printPlan: false, simulatedPaths: [] },
      readOnlyCommands: [], verificationScope: "complete", workspaceCommands: [command],
    };
    try {
      await withVerificationSessionLock(
        () => runPlan(plan, { repositoryRoot: ${JSON.stringify(repositoryRoot)} }),
        { repositoryRoot: ${JSON.stringify(repositoryRoot)} },
      );
    } catch { process.exitCode = 0; }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", childSource], {
    cwd: path.resolve(new URL("../..", import.meta.url).pathname),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const output = `${result.stdout}${result.stderr}`;
  assert.doesNotMatch(
    output,
    new RegExp(
      [
        "sk-",
        "private-verifier",
        "private-error",
        "opaque-verifier",
        ["END", "PRIVATE", "KEY"].join(" "),
        "\\u001b",
      ].join("|"),
      "u",
    ),
  );
  assert.match(output, /<redacted-secret>/u);
  assert.match(output, /<local-path>/u);
});

test("truncated verifier output drops an incomplete credential line on both streams", (t) => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "verification-truncated-output-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  const executorUrl = new URL("./verification-executor.mjs", import.meta.url).href;
  const lockUrl = new URL("./verification-session-lock.mjs", import.meta.url).href;
  const token = `ghp_${"a".repeat(36)}`;
  const line = `${"p".repeat(985)}${token}\n`;
  const childSource = `
    import { runPlan } from ${JSON.stringify(executorUrl)};
    import { withVerificationSessionLock } from ${JSON.stringify(lockUrl)};
    const command = {
      args: ["--input-type=module", "--eval", ${JSON.stringify(
        `process.stdout.write(${JSON.stringify(line)}); process.stderr.write(${JSON.stringify(line)}); process.exit(1);`,
      )}],
      executable: process.execPath, key: "truncated-delivery", label: "truncated-delivery",
      phase: "delivery", reason: "truncation fixture",
    };
    const plan = {
      admission: { canAdvanceSuccessfulBasis: false, focusedCommandOwners: [], fullRelevantPaths: [], mode: "full", reason: "fixture", uncoveredFullRelevantPaths: [], unknownPaths: [] },
      classifiedPaths: [], gitAvailable: true,
      options: { mode: "full", printPlan: false, simulatedPaths: [] },
      readOnlyCommands: [], verificationScope: "complete", workspaceCommands: [command],
    };
    try {
      await withVerificationSessionLock(
        () => runPlan(plan, { repositoryRoot: ${JSON.stringify(repositoryRoot)} }),
        { repositoryRoot: ${JSON.stringify(repositoryRoot)} },
      );
    } catch { process.exitCode = 0; }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", childSource], {
    cwd: path.resolve(new URL("../..", import.meta.url).pathname),
    encoding: "utf8",
    env: { ...process.env, VERIFY_MAX_CAPTURE_BYTES: "1024" },
  });
  assert.equal(result.status, 0, result.stderr);
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(output.includes(token), false);
  assert.doesNotMatch(output, /ghp_|a{30}/u);
  assert.equal(output.match(/incomplete final line was redacted/gu)?.length, 2);
});
