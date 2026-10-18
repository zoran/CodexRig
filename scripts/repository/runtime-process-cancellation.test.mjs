/** Verifies cancellation completion across captured I/O and lifecycle-owned process groups. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createOwnedProcessCancellation } from "./runtime-process-cancellation.mjs";

const identityModule = new URL("./runtime-process-identity.mjs", import.meta.url).href;
const ioModule = new URL("./runtime-process-io.mjs", import.meta.url).href;
const lifecycleModule = new URL("./runtime-lifecycle-process.mjs", import.meta.url).href;
const leaseModule = new URL("./runtime-session-lease.mjs", import.meta.url).href;

// A private Linux subreaper adopts only this fixture's orphaned descendants. Production owners
// can terminate grandchildren, but only their eventual parent can waitpid/reap their zombies.
const subreaper = String.raw`
import ctypes, json, subprocess, sys, time, os
if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), "Cannot create the isolated test subreaper")
child = subprocess.Popen(sys.argv[1:], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True)
try:
    stdout, stderr = child.communicate(timeout=22)
except subprocess.TimeoutExpired:
    child.kill()
    stdout, stderr = child.communicate()
reaped = []
deadline = time.monotonic() + 17
quiescent = False
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

function runCancellationScenario(lifecycle, { normal = false, hiddenGroup = false } = {}) {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "audit_runtime_cancellation_"));
  const storage = path.join(fixture, "tools");
  mkdirSync(storage, { mode: 0o700 });
  const observedPath = path.join(fixture, "during-cancellation.json");
  const descendant = `
    import { writeFileSync } from "node:fs";
    import { captureProcessIdentity } from ${JSON.stringify(identityModule)};
    import { inspectRuntimeLifecycleLock } from ${JSON.stringify(leaseModule)};
    process.on("SIGTERM", () => {
      if (${lifecycle}) setTimeout(() => {
        const snapshot = inspectRuntimeLifecycleLock({ root: ${JSON.stringify(fixture)} });
        writeFileSync(${JSON.stringify(observedPath)}, JSON.stringify({
          descendants: snapshot.owner?.descendants.length ?? 0,
          delegations: snapshot.owner?.delegations.length ?? 0,
        }));
      }, 150);
    });
    process.send({ identity: captureProcessIdentity(process.pid) }, () => process.disconnect());
    setTimeout(() => process.exit(87), 15000);
  `;
  const target = `
    import { spawn } from "node:child_process";
    process.on("SIGTERM", () => process.exit(0));
    const child = spawn(process.execPath, ["--input-type=module", "--eval", ${JSON.stringify(descendant)}],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    child.once("message", (message) => process.stdout.write(JSON.stringify({ target: process.pid, ...message }),
      () => { if (${normal}) process.exit(0); }));
    setTimeout(() => process.exit(88), 15000);
  `;
  const source = `
    import { readFileSync, existsSync } from "node:fs";
    import { setTimeout as delay } from "node:timers/promises";
    import { inspectProcessIdentity } from ${JSON.stringify(identityModule)};
    import { spawnSyncWithBoundedIo } from ${JSON.stringify(ioModule)};
    import { spawnRuntimeLifecycleCommandSync } from ${JSON.stringify(lifecycleModule)};
    import { acquireRuntimeLifecycleLock, cancelRuntimeLifecycleDelegation, inspectRuntimeLifecycleLock,
      releaseRuntimeLifecycleLock, unregisterRuntimeLifecycleDescendant } from ${JSON.stringify(leaseModule)};
    const root = ${JSON.stringify(fixture)};
    let owner;
    let owned;
    let report;
    try {
      if (${lifecycle}) owner = acquireRuntimeLifecycleLock({ root, operation: "cancellation-test" });
      const options = { encoding: "utf8", timeout: ${lifecycle ? 1000 : 750}, maxBuffer: 4096 };
      if (${hiddenGroup}) options.env = { ...process.env, NODE_OPTIONS: ${JSON.stringify(`--import=data:text/javascript,${encodeURIComponent('import fs from "node:fs"; import { syncBuiltinESMExports } from "node:module"; const original = fs.readdirSync; fs.readdirSync = (target, ...args) => { if (target === "/proc") throw Object.assign(new Error("test-hidden process group"), { code: "EACCES" }); return original(target, ...args); }; syncBuiltinESMExports();')}`)} };
      const args = ["--input-type=module", "--eval", ${JSON.stringify(target)}];
      const started = performance.now();
      const result = ${lifecycle}
        ? spawnRuntimeLifecycleCommandSync({ repositoryRoot: root, lifecycleCapability: owner,
            command: process.execPath, args, role: "cancellation-child", options })
        : spawnSyncWithBoundedIo(process.execPath, args, options);
      const elapsed = performance.now() - started;
      owned = JSON.parse(result.stdout);
      const identityState = inspectProcessIdentity(owned.identity);
      let state = identityState;
      if (state === "active") {
        const stat = readFileSync("/proc/" + owned.identity.pid + "/stat", "utf8");
        state = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\\s+/u)[0];
      }
      const snapshot = owner ? inspectRuntimeLifecycleLock({ root }) : null;
      report = { elapsed, target: owned.target, descendant: owned.identity.pid, pid: result.pid,
        status: result.status, signal: result.signal, error: result.error?.code, state,
        after: snapshot ? { descendants: snapshot.owner.descendants.length,
          delegations: snapshot.owner.delegations.length } : null,
        during: existsSync(${JSON.stringify(observedPath)})
          ? JSON.parse(readFileSync(${JSON.stringify(observedPath)}, "utf8")) : null };
    } finally {
      if (owned && inspectProcessIdentity(owned.identity) === "active") {
        // This identity was reported by the owned IPC child; never signal a reused numeric PID.
        process.kill(owned.identity.pid, "SIGKILL");
        await delay(50);
      }
      if (owner) {
        if (${hiddenGroup}) {
          const snapshot = inspectRuntimeLifecycleLock({ root });
          for (const registration of snapshot.owner.descendants) {
            if (inspectProcessIdentity(registration.identity) !== "stale")
              throw new Error("Fixture cannot retire an active or ambiguous owned registration");
            unregisterRuntimeLifecycleDescendant({ root, owner, registration });
          }
          for (const delegation of snapshot.owner.delegations)
            cancelRuntimeLifecycleDelegation({ root, owner, token: delegation.token });
        }
        releaseRuntimeLifecycleLock({ root, owner });
      }
    }
    process.stdout.write(JSON.stringify(report));
  `;
  try {
    const result = spawnSync(
      "python3",
      ["-c", subreaper, process.execPath, "--input-type=module", "--eval", source],
      {
        encoding: "utf8",
        env: { ...process.env, PROJECT_TOOL_STORAGE_HOME: storage, TMPDIR: fixture },
        timeout: 40000,
        maxBuffer: 64 * 1024,
      },
    );
    assert.equal(result.error, undefined, result.stderr);
    assert.equal(result.status, 0, result.stderr);
    const reaping = JSON.parse(result.stdout);
    assert.equal(reaping.status, 0, reaping.stderr);
    assert.equal(reaping.quiescent, true, "fixture must reap every adopted owned descendant");
    const observed = JSON.parse(reaping.stdout);
    assert.ok(reaping.reaped.includes(observed.descendant), "subreaper must reap the owned orphan");
    return observed;
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

test(
  "ordinary completion keeps background-launch behavior and skips cancellation grace",
  {
    skip: process.platform !== "linux",
    timeout: 45000,
  },
  () => {
    const observed = runCancellationScenario(false, { normal: true });
    assert.equal(observed.error, undefined);
    assert.equal(observed.status, 0);
    assert.equal(observed.pid, observed.target);
    assert.ok(!["stale", "Z", "X"].includes(observed.state), JSON.stringify(observed));
    assert.ok(observed.elapsed < 1500, JSON.stringify(observed));
  },
);

test(
  "unobservable lifecycle cancellation preserves its durable witness and registrations",
  {
    skip: process.platform !== "linux",
    timeout: 45000,
  },
  () => {
    const observed = runCancellationScenario(true, { hiddenGroup: true });
    assert.equal(observed.error, "ETIMEDOUT");
    assert.equal(observed.status, 1);
    assert.ok(observed.after.descendants > 0, JSON.stringify(observed));
    assert.ok(observed.after.delegations > 0, JSON.stringify(observed));
    assert.ok(observed.elapsed < 4000, JSON.stringify(observed));
  },
);

test(
  "cancellation never signals a reused descendant PID or an unanchored replacement group",
  {
    skip: process.platform !== "linux",
  },
  async () => {
    const rootPid = 1000000001;
    const descendantPid = rootPid + 1;
    const records = new Map([
      [rootPid, "101"],
      [descendantPid, "102"],
    ]);
    const originalRead = fs.readFileSync;
    const originalDirectory = fs.readdirSync;
    const originalKill = process.kill;
    const signals = [];
    const child = {
      pid: rootPid,
      exitCode: null,
      signalCode: null,
      kill() {
        assert.fail("An observed exact child must use its validated identity");
      },
    };
    const missing = () => Object.assign(new Error("Synthetic process exited"), { code: "ESRCH" });
    try {
      fs.readFileSync = (target, ...args) => {
        const match = /^\/proc\/(100000000[12])\/stat$/u.exec(String(target));
        if (!match) return originalRead(target, ...args);
        const pid = Number(match[1]);
        if (!records.has(pid)) throw missing();
        const fields = Array(20).fill("0");
        fields[0] = "S";
        fields[2] = fields[3] = String(rootPid);
        fields[19] = records.get(pid);
        return `${pid} (synthetic owned child) ${fields.join(" ")}`;
      };
      fs.readdirSync = (target, ...args) =>
        target === "/proc" ? [...records.keys()].map(String) : originalDirectory(target, ...args);
      process.kill = (pid, signal) => {
        assert.ok(pid === rootPid || pid === descendantPid, "probe only handles synthetic PIDs");
        if (!records.has(pid)) throw missing();
        if (signal === 0) return true;
        signals.push([pid, signal]);
        records.delete(rootPid);
        records.set(descendantPid, "202");
        child.exitCode = 0;
        return true;
      };
      syncBuiltinESMExports();
      const cancellation = createOwnedProcessCancellation(child, { graceMilliseconds: 50 });
      await assert.rejects(cancellation.cancel(), { code: "CODEXRIG_PROCESS_CANCELLATION" });
      assert.deepEqual(signals, [[rootPid, "SIGTERM"]]);
    } finally {
      fs.readFileSync = originalRead;
      fs.readdirSync = originalDirectory;
      process.kill = originalKill;
      syncBuiltinESMExports();
    }
  },
);

for (const lifecycle of [false, true]) {
  test(
    `${lifecycle ? "layered lifecycle" : "captured I/O"} cancellation outlives direct-child closure`,
    {
      skip: process.platform !== "linux",
      timeout: 45000,
    },
    () => {
      const observed = runCancellationScenario(lifecycle);
      assert.equal(observed.error, "ETIMEDOUT");
      assert.ok(["stale", "Z", "X"].includes(observed.state), JSON.stringify(observed));
      assert.ok(observed.elapsed >= 5500 && observed.elapsed < 10000, JSON.stringify(observed));
      if (lifecycle) {
        assert.equal(observed.status, 143);
        assert.equal(observed.signal, null);
        assert.ok(observed.during?.descendants > 0, JSON.stringify(observed));
        assert.ok(observed.during?.delegations > 0, JSON.stringify(observed));
        assert.deepEqual(observed.after, { descendants: 0, delegations: 0 });
      } else {
        assert.equal(observed.pid, observed.target);
        assert.equal(observed.status, 0);
        assert.equal(observed.signal, null);
      }
    },
  );
}
