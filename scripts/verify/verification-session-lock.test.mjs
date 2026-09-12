/** Verifies verification session lock behavior for the repository verification boundary. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  acquireVerificationSessionLock,
  assertVerificationSessionLockOwned,
  inspectVerificationSessionLock,
  withVerificationSessionLock,
} from "./verification-session-lock.mjs";
import { spawnRuntimeLifecycleCommand } from "../repository/runtime-lifecycle-process.mjs";
import { withRuntimeLifecycleUpdateMutex } from "../repository/runtime-lifecycle-mutex.mjs";
import { captureProcessIdentity } from "../repository/runtime-process-identity.mjs";
import {
  acquireRuntimeLifecycleLock,
  inspectRuntimeLifecycleLock,
  releaseRuntimeLifecycleLock,
} from "../repository/runtime-session-lease.mjs";

async function waitForLifecycle(predicate, label, timeoutMilliseconds = 5_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;
  while (Date.now() <= deadline) {
    try {
      const result = predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}.`, { cause: lastError });
}

function terminateIfAlive(pid, signal = "SIGKILL") {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function owner(pid = process.pid) {
  return {
    pid,
    startedAt: new Date().toISOString(),
    token: "00000000-0000-4000-8000-000000000000",
  };
}

function writeOwnerLock(repositoryRoot, value, extraEntry = false) {
  const lockPath = path.join(
    repositoryRoot,
    ".codex",
    "runtime",
    "cache",
    "project-verification",
    "session.lock",
  );
  mkdirSync(path.dirname(lockPath), { mode: 0o700, recursive: true });
  if (extraEntry) {
    mkdirSync(lockPath, { mode: 0o700 });
    writeFileSync(path.join(lockPath, "unexpected"), "blocked\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    return;
  }
  writeFileSync(lockPath, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

test("one repository verification session serializes complete workflows", async (t) => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "verification-session-lock-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));

  const first = acquireVerificationSessionLock({ repositoryRoot });
  assert.doesNotThrow(() => assertVerificationSessionLockOwned({ repositoryRoot }));
  assert.throws(() => acquireVerificationSessionLock({ repositoryRoot }), /already locked/u);
  const moduleUrl = new URL("./verification-session-lock.mjs", import.meta.url).href;
  const competing = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const { acquireVerificationSessionLock } = await import(${JSON.stringify(moduleUrl)}); acquireVerificationSessionLock({ repositoryRoot: ${JSON.stringify(repositoryRoot)} });`,
    ],
    { encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.notEqual(competing.status, 0);
  assert.match(competing.stderr, /already locked/u);
  first.release();

  let ran = false;
  await withVerificationSessionLock(
    () => {
      ran = true;
    },
    { repositoryRoot },
  );
  assert.equal(ran, true);
  const next = acquireVerificationSessionLock({ repositoryRoot });
  next.release();
});

test("--hold preserves stdin and resolves commands through the sanitized PATH", (t) => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "verification-held-command-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  const modulePath = fileURLToPath(new URL("./verification-session-lock.mjs", import.meta.url));
  const input = "refs/heads/main old refs/heads/main new\n";
  const stdin = spawnSync(
    process.execPath,
    [
      modulePath,
      "--hold",
      "--root",
      repositoryRoot,
      process.execPath,
      "--input-type=module",
      "--eval",
      "process.stdin.pipe(process.stdout);",
    ],
    { encoding: "utf8", input, stdio: "pipe" },
  );
  assert.equal(stdin.status, 0, stdin.stderr);
  assert.equal(stdin.stdout, input);

  const resolved = spawnSync(
    process.execPath,
    [modulePath, "--hold", "--root", repositoryRoot, "sh", "-c", "printf 'resolved\\n'"],
    { encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(resolved.stdout, "resolved\n");
});

test(
  "a killed verification coordinator cannot hide a surviving held command from reset",
  { skip: process.platform !== "linux" },
  async (t) => {
    const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "verification-orphaned-child-"));
    const readyPath = path.join(repositoryRoot, "verification-child-ready.json");
    const modulePath = fileURLToPath(new URL("./verification-session-lock.mjs", import.meta.url));
    const targetSource = `
      import { writeFileSync } from "node:fs";
      writeFileSync(${JSON.stringify(readyPath)}, JSON.stringify({ pid: process.pid }));
      setInterval(() => {}, 1000);
    `;
    const coordinator = spawn(
      process.execPath,
      [
        modulePath,
        "--hold",
        "--root",
        repositoryRoot,
        process.execPath,
        "--input-type=module",
        "--eval",
        targetSource,
      ],
      { cwd: repositoryRoot, stdio: "ignore" },
    );
    let targetPid;
    t.after(() => {
      terminateIfAlive(targetPid);
      terminateIfAlive(coordinator.pid);
      rmSync(repositoryRoot, { force: true, recursive: true });
    });

    await waitForLifecycle(() => existsSync(readyPath), "held verification command readiness");
    targetPid = JSON.parse(readFileSync(readyPath, "utf8")).pid;
    await waitForLifecycle(
      () =>
        inspectRuntimeLifecycleLock({ root: repositoryRoot }).owner?.descendants?.some(
          (entry) =>
            entry.identity.pid === targetPid &&
            /^linux:[a-f0-9-]{36}:\d+:\d+:\d+$/u.test(entry.identity.startIdentity),
        ),
      "held verification command identity registration",
    );

    terminateIfAlive(coordinator.pid, "SIGKILL");
    await new Promise((resolve) => coordinator.once("exit", resolve));
    const orphaned = inspectRuntimeLifecycleLock({ root: repositoryRoot });
    assert.equal(orphaned.owner.operation, "verification");
    assert.equal(orphaned.status, "active");
    assert.throws(
      () =>
        acquireRuntimeLifecycleLock({
          root: repositoryRoot,
          operation: "framework-reset",
        }),
      /runtime lifecycle operation is active/u,
    );

    terminateIfAlive(targetPid, "SIGTERM");
    let resetCapability;
    await waitForLifecycle(() => {
      try {
        resetCapability = acquireRuntimeLifecycleLock({
          root: repositoryRoot,
          operation: "framework-reset",
        });
        return true;
      } catch (error) {
        if (/runtime lifecycle operation is active/u.test(error?.message ?? "")) return false;
        throw error;
      }
    }, "reset capability reclaim after held verification command exit");
    releaseRuntimeLifecycleLock({ root: repositoryRoot, owner: resetCapability });

    const cleaned = acquireVerificationSessionLock({ repositoryRoot });
    cleaned.release();
    assert.equal(inspectRuntimeLifecycleLock({ root: repositoryRoot }).status, "absent");
  },
);

test(
  "a killed lifecycle-owner transition leaves a reclaimable identity-bound mutex",
  { skip: process.platform !== "linux" },
  (t) => {
    const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "verification-transition-crash-"));
    t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
    const lifecycleUrl = new URL("../repository/runtime-session-lease.mjs", import.meta.url).href;
    const crashed = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `const { acquireRuntimeLifecycleLock } = await import(${JSON.stringify(lifecycleUrl)});
acquireRuntimeLifecycleLock({
  root: ${JSON.stringify(repositoryRoot)},
  operation: "verification",
  testHooks: { beforeLifecycleOwnerReplace() { process.kill(process.pid, "SIGKILL"); } },
});`,
      ],
      { stdio: "ignore" },
    );
    assert.equal(crashed.signal, "SIGKILL");

    const reclaimed = acquireRuntimeLifecycleLock({
      root: repositoryRoot,
      operation: "framework-reset",
    });
    releaseRuntimeLifecycleLock({ root: repositoryRoot, owner: reclaimed });
    assert.equal(inspectRuntimeLifecycleLock({ root: repositoryRoot }).status, "absent");
  },
);

async function pauseMutexPublication(t, repositoryRoot, phase) {
  const mutexUrl = new URL("../repository/runtime-lifecycle-mutex.mjs", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const originalWrite = fs.writeFileSync;
const originalLink = fs.linkSync;
let paused = false;
function pause() {
  paused = true;
  originalWrite(1, "ready\\n");
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      if (fs.readSync(0, Buffer.alloc(1), 0, 1, null) !== 1) throw new Error("Publication handshake ended.");
      break;
    } catch (error) {
      if (error.code !== "EAGAIN" || Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
}
fs.writeFileSync = function (descriptor, content, ...options) {
  if (${JSON.stringify(phase)} === "before-write" && !paused && typeof content === "string" && content.includes('"identity"') && content.includes('"nonce"')) pause();
  return originalWrite(descriptor, content, ...options);
};
fs.linkSync = function (source, target) {
  const result = originalLink(source, target);
  if (${JSON.stringify(phase)} === "after-link" && String(target).endsWith("/codexrig-lifecycle.update")) pause();
  return result;
};
syncBuiltinESMExports();
const { withRuntimeLifecycleUpdateMutex } = await import(${JSON.stringify(mutexUrl)});
withRuntimeLifecycleUpdateMutex(${JSON.stringify(repositoryRoot)}, () => {});`,
    ],
    { cwd: repositoryRoot, stdio: ["pipe", "pipe", "pipe"] },
  );
  const closed = once(child, "close");
  let output = "";
  let errors = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (errors += chunk));
  child.stdin.on("error", (error) => (errors += error.message));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed;
  });
  try {
    await waitForLifecycle(() => output.includes("ready\n"), "mutex publication handshake");
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed;
    rmSync(repositoryRoot, { force: true, recursive: true });
    throw new Error(`Mutex publication handshake failed: ${errors}`, { cause: error });
  }
  return { child, closed, errors: () => errors };
}

test("an unpublished lifecycle mutex cannot interrupt another verification transition", async (t) => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "verification-mutex-publication-"));
  mkdirSync(path.join(repositoryRoot, ".codex", "runtime"), { mode: 0o700, recursive: true });
  const { child, closed, errors } = await pauseMutexPublication(t, repositoryRoot, "before-write");
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  const lock = acquireVerificationSessionLock({ repositoryRoot });
  lock.release();
  assert.equal(inspectRuntimeLifecycleLock({ root: repositoryRoot }).status, "absent");
  child.stdin.end("x");
  const [code, signal] = await closed;
  assert.equal(signal, null, errors());
  assert.equal(code, 0, errors());
});

test(
  "a publisher killed before or after its atomic link cannot strand verification transitions",
  { skip: process.platform !== "linux" },
  async (t) => {
    for (const phase of ["before-write", "after-link"]) {
      const root = mkdtempSync(path.join(os.tmpdir(), "verification-mutex-crash-"));
      const runtime = path.join(root, ".codex", "runtime");
      mkdirSync(runtime, { mode: 0o700, recursive: true });
      const { child, closed } = await pauseMutexPublication(t, root, phase);
      t.after(() => rmSync(root, { force: true, recursive: true }));
      child.kill("SIGKILL");
      assert.deepEqual(await closed, [null, "SIGKILL"]);

      const lock = acquireVerificationSessionLock({ repositoryRoot: root });
      lock.release();
      assert.equal(inspectRuntimeLifecycleLock({ root }).status, "absent");
      assert.equal(existsSync(path.join(runtime, "codexrig-lifecycle.update")), false);
      const staging = readdirSync(runtime).filter((name) =>
        name.startsWith(".codexrig-lifecycle.update."),
      );
      assert.equal(staging.length, phase === "before-write" ? 1 : 0);
    }
  },
);

test("a live atomic publisher keeps competing lifecycle transitions outside its mutex", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "verification-mutex-contenders-"));
  const runtime = path.join(root, ".codex", "runtime");
  mkdirSync(runtime, { mode: 0o700, recursive: true });
  const publisher = await pauseMutexPublication(t, root, "after-link");
  const mutexUrl = new URL("../repository/runtime-lifecycle-mutex.mjs", import.meta.url).href;
  const contender = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
    import { writeFileSync } from "node:fs";
    const { withRuntimeLifecycleUpdateMutex } = await import(${JSON.stringify(mutexUrl)});
    const originalWait = Atomics.wait;
    let observed = false;
    Atomics.wait = (...args) => {
      if (!observed) { observed = true; writeFileSync(1, "waiting\\n"); }
      return originalWait(...args);
    };
    withRuntimeLifecycleUpdateMutex(${JSON.stringify(root)}, () => writeFileSync(1, "entered\\n"));
  `,
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  const contenderClosed = once(contender, "close");
  let output = "";
  let errors = "";
  contender.stdout.on("data", (chunk) => (output += chunk));
  contender.stderr.on("data", (chunk) => (errors += chunk));
  t.after(async () => {
    if (contender.exitCode === null && contender.signalCode === null) contender.kill("SIGKILL");
    await contenderClosed;
    rmSync(root, { force: true, recursive: true });
  });
  await waitForLifecycle(() => output.includes("waiting\n"), "live publisher contention");
  assert.equal(output.includes("entered\n"), false);
  const target = path.join(runtime, "codexrig-lifecycle.update");
  assert.equal(lstatSync(target).nlink, 2);
  const record = JSON.parse(readFileSync(target, "utf8"));
  assert.equal(record.identity.pid, publisher.child.pid);
  assert.equal(
    lstatSync(path.join(runtime, `.codexrig-lifecycle.update.${record.nonce}.tmp`)).nlink,
    2,
  );
  publisher.child.stdin.end("x");
  assert.deepEqual(await publisher.closed, [0, null], publisher.errors());
  assert.deepEqual(await contenderClosed, [0, null], errors);
  assert.equal(output, "waiting\nentered\n");
  assert.equal(existsSync(target), false);
});

test(
  "malformed, unbound and redirected mutex publications remain blocking and unchanged",
  { skip: process.platform !== "linux" },
  (t) => {
    const identity = captureProcessIdentity(process.pid);
    const nonce = "00000000-0000-4000-8000-000000000000";
    for (const scenario of [
      "unknown",
      "extra-link",
      "wrong-alias",
      "alias-symlink",
      "target-symlink",
      "empty",
      "malformed",
    ]) {
      const root = mkdtempSync(path.join(os.tmpdir(), "verification-mutex-refusal-"));
      const runtime = path.join(root, ".codex", "runtime");
      mkdirSync(runtime, { mode: 0o700, recursive: true });
      t.after(() => rmSync(root, { force: true, recursive: true }));
      const target = path.join(runtime, "codexrig-lifecycle.update");
      const temporary = path.join(runtime, `.codexrig-lifecycle.update.${nonce}.tmp`);
      const extra = path.join(runtime, "unrelated");
      const content =
        scenario === "empty"
          ? ""
          : JSON.stringify({
              identity: scenario === "unknown" ? { ...identity, startIdentity: null } : identity,
              nonce,
              ...(scenario === "malformed" ? { extra: true } : {}),
            });
      writeFileSync(temporary, content, { mode: 0o600 });
      if (scenario === "target-symlink") symlinkSync(temporary, target);
      else linkSync(temporary, target);
      if (scenario === "extra-link") linkSync(target, extra);
      if (["wrong-alias", "alias-symlink"].includes(scenario)) {
        renameSync(temporary, extra);
        if (scenario === "alias-symlink") symlinkSync(extra, temporary);
        else writeFileSync(temporary, content, { mode: 0o600 });
      }
      const before = readdirSync(runtime).map((name) => ({
        name,
        stats: lstatSync(path.join(runtime, name)),
      }));
      let entered = false;
      assert.throws(
        () =>
          withRuntimeLifecycleUpdateMutex(root, () => {
            entered = true;
          }),
        /unsafe|invalid|cannot be verified|malformed/u,
        scenario,
      );
      assert.equal(entered, false, scenario);
      assert.deepEqual(
        readdirSync(runtime),
        before.map(({ name }) => name),
        scenario,
      );
      for (const { name, stats } of before) {
        const current = lstatSync(path.join(runtime, name));
        assert.deepEqual(
          [current.dev, current.ino, current.nlink, current.mode],
          [stats.dev, stats.ino, stats.nlink, stats.mode],
          scenario,
        );
        assert.equal(readFileSync(path.join(runtime, name), "utf8"), content, scenario);
      }
    }
  },
);

test("verification cleanup waits for its supervised command to exit", async (t) => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "verification-finalizer-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  const lock = acquireVerificationSessionLock({ repositoryRoot });
  const child = spawnRuntimeLifecycleCommand({
    args: ["--input-type=module", "--eval", "setInterval(() => {}, 1000);"],
    command: process.execPath,
    lifecycleCapability: lock.lifecycleCapability,
    options: { cwd: repositoryRoot, stdio: "ignore" },
    repositoryRoot,
    role: "verification-supervisor",
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });

  await waitForLifecycle(
    () =>
      inspectRuntimeLifecycleLock({ root: repositoryRoot }).owner?.descendants?.some(
        ({ role }) => role === "verification-supervisor-command",
      ),
    "verification command registration",
  );
  assert.equal(
    inspectRuntimeLifecycleLock({ root: repositoryRoot }).owner.delegations.some(
      ({ role }) => role === "verification-supervisor-command",
    ),
    true,
  );
  assert.throws(
    () => lock.release(),
    /lifecycle descendants must finish|guard holders must finish/u,
  );
  assert.equal(inspectVerificationSessionLock({ repositoryRoot }).status, "active");

  child.kill("SIGTERM");
  await once(child, "close");
  lock.release();
  assert.equal(inspectVerificationSessionLock({ repositoryRoot }).status, "absent");
  assert.equal(inspectRuntimeLifecycleLock({ root: repositoryRoot }).status, "absent");
});

test(
  "a killed release between guard and owner removal remains safely reclaimable",
  { skip: process.platform !== "linux" },
  (t) => {
    const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "verification-release-crash-"));
    t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
    const lifecycleUrl = new URL("../repository/runtime-session-lease.mjs", import.meta.url).href;
    const crashed = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `const { acquireRuntimeLifecycleLock, releaseRuntimeLifecycleLock } = await import(${JSON.stringify(lifecycleUrl)});
const owner = acquireRuntimeLifecycleLock({ root: ${JSON.stringify(repositoryRoot)}, operation: "verification" });
releaseRuntimeLifecycleLock({
  root: ${JSON.stringify(repositoryRoot)},
  owner,
  testHooks: { beforeLifecycleLockRemove() { process.kill(process.pid, "SIGKILL"); } },
});`,
      ],
      { stdio: "ignore" },
    );
    assert.equal(crashed.signal, "SIGKILL");
    assert.equal(inspectRuntimeLifecycleLock({ root: repositoryRoot }).status, "stale");

    const reclaimed = acquireRuntimeLifecycleLock({
      root: repositoryRoot,
      operation: "framework-reset",
    });
    releaseRuntimeLifecycleLock({ root: repositoryRoot, owner: reclaimed });
    assert.equal(inspectRuntimeLifecycleLock({ root: repositoryRoot }).status, "absent");
  },
);

test("lifecycle acquisition refuses a swapped runtime parent without touching its target", (t) => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "verification-runtime-parent-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "verification-runtime-outside-"));
  const codexDirectory = path.join(repositoryRoot, ".codex");
  const parkedCodex = path.join(repositoryRoot, ".codex-owned");
  mkdirSync(codexDirectory, { mode: 0o700 });
  writeFileSync(path.join(outside, "sentinel"), "outside\n");
  t.after(() => {
    rmSync(repositoryRoot, { force: true, recursive: true });
    rmSync(outside, { force: true, recursive: true });
  });

  assert.throws(
    () =>
      acquireRuntimeLifecycleLock({
        root: repositoryRoot,
        operation: "verification",
        testHooks: {
          beforeRuntimeDirectoryCreate() {
            renameSync(codexDirectory, parkedCodex);
            symlinkSync(outside, codexDirectory, "dir");
          },
        },
      }),
    /identity change|unsafe parent|changed/u,
  );
  assert.equal(readFileSync(path.join(outside, "sentinel"), "utf8"), "outside\n");
  assert.equal(existsSync(path.join(outside, "runtime")), false);
});

test("a file with this PID is not an acquired process capability", (t) => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "verification-forged-lock-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  writeOwnerLock(repositoryRoot, owner());
  assert.throws(
    () => assertVerificationSessionLockOwned({ repositoryRoot }),
    /requires this process to own/u,
  );
});

test("dead owners are reclaimed while live, malformed, or unknown locks remain blocking", (t) => {
  const roots = ["dead", "live", "malformed", "unknown", "time", "token"].map((label) =>
    mkdtempSync(path.join(os.tmpdir(), `verification-${label}-lock-`)),
  );
  t.after(() => roots.forEach((root) => rmSync(root, { force: true, recursive: true })));

  writeOwnerLock(roots[0], owner(999_999_999));
  const reclaimed = acquireVerificationSessionLock({ repositoryRoot: roots[0] });
  reclaimed.release();

  writeOwnerLock(roots[1], owner());
  assert.throws(() => acquireVerificationSessionLock({ repositoryRoot: roots[1] }), /locked/u);

  writeOwnerLock(roots[2], { pid: 1 });
  assert.throws(() => acquireVerificationSessionLock({ repositoryRoot: roots[2] }), /locked/u);

  writeOwnerLock(roots[3], owner(999_999_999), true);
  assert.throws(() => acquireVerificationSessionLock({ repositoryRoot: roots[3] }), /locked/u);

  writeOwnerLock(roots[4], { ...owner(999_999_999), startedAt: "August 17, 2026" });
  writeOwnerLock(roots[5], { ...owner(999_999_999), token: "-".repeat(36) });
  for (const root of roots.slice(4)) {
    assert.throws(() => acquireVerificationSessionLock({ repositoryRoot: root }), /locked/u);
  }
});
