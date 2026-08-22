/** Verifies verification session lock behavior for the repository verification boundary. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
