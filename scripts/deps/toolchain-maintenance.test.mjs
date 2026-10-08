/** Verifies toolchain maintenance candidate admission before installation and publication. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import {
  acquireRuntimeLifecycleLock,
  inspectRuntimeLifecycleLock,
  releaseRuntimeLifecycleLock,
  reserveRuntimeSessionLease,
  runtimeLifecycleBusyErrorCode,
} from "../repository/runtime-session-lease.mjs";
import { maintainToolchain } from "./maintain-toolchain.mjs";
import { toolchainConfigurationPaths } from "./toolchain-maintenance-inputs.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "candidate-toolchain-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const relative of toolchainConfigurationPaths) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), readFileSync(path.join(toolingRoot, relative)));
  }
  const matrix = JSON.parse(readFileSync(path.join(root, ".codex/toolchain.json"), "utf8"));
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "candidate-fixture",
      version: "1.0.0",
      private: true,
      packageManager: `pnpm@${matrix.stable.pnpm.version}`,
      devDependencies: {},
    }) + "\n",
  );
  writeFileSync(
    path.join(root, "pnpm-workspace.yaml"),
    "packages: []\nstrictPeerDependencies: true\nengineStrict: true\n",
  );
  writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  return root;
}

function omitForeignArtifact(lock) {
  const altered = lock.replace(
    /^\[tools\.pnpm\."platforms\.linux-arm64-musl"\]\r?\n[^[]*/mu,
    '[tools.pnpm."platforms.linux-arm64-musl"]\nprovenance = "github-attestations"\n\n',
  );
  assert.notEqual(altered, lock, "fixture must contain the foreign-platform artifact");
  return altered;
}

async function heldVerification(root) {
  const module = new URL("../repository/runtime-session-lease.mjs", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { acquireRuntimeLifecycleLock, releaseRuntimeLifecycleLock } from ${JSON.stringify(module)};
    const root = process.argv[1];
    const owner = acquireRuntimeLifecycleLock({ root, operation: "verification" });
    process.on("message", () => {
      releaseRuntimeLifecycleLock({ root, owner });
      process.disconnect();
    });
    process.send("ready");
  `,
      root,
    ],
    { stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  const closed = once(child, "exit");
  await Promise.race([
    once(child, "message"),
    closed.then(() => {
      throw new Error("Fixture verification exited before acquiring its lock");
    }),
  ]);
  return {
    pid: child.pid,
    async release() {
      if (child.connected) child.send("release");
      await closed;
    },
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
    },
  };
}

test("startup waits for a live verification without stealing its lock or starting maintenance", async (t) => {
  const root = fixture(t);
  const holder = await heldVerification(root);
  const reachedMaintenance = new Error("candidate discovery reached after release");
  let waited = false;
  try {
    await assert.rejects(
      maintainToolchain({ root }),
      (error) =>
        error.code === runtimeLifecycleBusyErrorCode && error.lifecycle.status === "active",
    );
    await assert.rejects(
      maintainToolchain({
        root,
        startup: true,
        onLifecycleWait: async (message) => {
          waited = true;
          assert.match(message, /verification/u);
          assert.ok(message.includes(String(holder.pid)));
          assert.equal(inspectRuntimeLifecycleLock({ root }).owner.coordinator.pid, holder.pid);
          assert.equal(existsSync(path.join(root, ".auth")), false);
          await holder.release();
        },
        candidateResolver: async () => {
          assert.equal(waited, true);
          throw reachedMaintenance;
        },
      }),
      (error) => error === reachedMaintenance,
    );
    assert.equal(inspectRuntimeLifecycleLock({ root }).status, "absent");
  } finally {
    await holder.stop();
  }
});

test("startup rechecks session ownership after waiting for verification", async (t) => {
  const root = fixture(t);
  const holder = await heldVerification(root);
  try {
    await assert.rejects(
      maintainToolchain({
        root,
        startup: true,
        onLifecycleWait: async () => {
          await holder.release();
          reserveRuntimeSessionLease({ root, pid: process.pid });
        },
        candidateResolver: async () => {
          throw new Error("must not reach candidate discovery");
        },
      }),
      /preserves unsafe or active worktrees/u,
    );
    assert.equal(existsSync(path.join(root, ".auth")), false);
    assert.equal(inspectRuntimeLifecycleLock({ root }).status, "absent");
  } finally {
    await holder.stop();
  }
});

for (const interruptedBy of ["timeout", "abort"]) {
  test(`startup ${interruptedBy} preserves the running operation and its lock`, async (t) => {
    const root = fixture(t);
    const holder = await heldVerification(root);
    const before = readFileSync(inspectRuntimeLifecycleLock({ root }).path, "utf8");
    const controller = new AbortController();
    let reported = false;
    try {
      await assert.rejects(
        maintainToolchain({
          root,
          startup: true,
          lifecycleWaitTimeoutMilliseconds: 250,
          signal: controller.signal,
          onLifecycleWait: () => {
            reported = true;
            if (interruptedBy === "abort") controller.abort();
          },
        }),
        interruptedBy === "timeout" ? /Timed out waiting.*verification/u : { name: "AbortError" },
      );
      assert.equal(reported, true);
      const current = inspectRuntimeLifecycleLock({ root });
      assert.equal(current.status, "active");
      assert.equal(readFileSync(current.path, "utf8"), before);
      assert.equal(existsSync(path.join(root, ".auth")), false);
    } finally {
      await holder.release();
    }
  });
}

test("uncertain lifecycle ownership fails closed without waiting or changing private state", async (t) => {
  if (process.platform !== "linux") return t.skip("Linux namespace identity");
  const root = fixture(t);
  const holder = await heldVerification(root);
  const snapshot = inspectRuntimeLifecycleLock({ root });
  await holder.stop();
  snapshot.owner.coordinator.startIdentity = null;
  writeFileSync(snapshot.path, JSON.stringify(snapshot.owner), { mode: 0o600 });
  const before = readFileSync(snapshot.path, "utf8");
  assert.equal(inspectRuntimeLifecycleLock({ root }).status, "unknown");
  await assert.rejects(
    maintainToolchain({
      root,
      startup: true,
      onLifecycleWait: () => {
        throw new Error("uncertain owners must not be retried");
      },
    }),
    (error) => error.code === runtimeLifecycleBusyErrorCode && error.lifecycle.status === "unknown",
  );
  assert.equal(readFileSync(snapshot.path, "utf8"), before);
});

test("ordinary maintenance and reentrant startup remain fail-fast", async (t) => {
  const root = fixture(t);
  const owner = acquireRuntimeLifecycleLock({ root, operation: "verification" });
  try {
    for (const startup of [false, true]) {
      await assert.rejects(
        maintainToolchain({
          root,
          startup,
          onLifecycleWait: () => {
            throw new Error("cannot wait for own operation");
          },
        }),
        (error) =>
          error.code === runtimeLifecycleBusyErrorCode && error.lifecycle.status === "reentrant",
      );
    }
  } finally {
    releaseRuntimeLifecycleLock({ root, owner });
  }
});

for (const mutationAt of ["before-install", "after-dependencies"]) {
  test(`maintenance rejects an incomplete foreign platform ${mutationAt} without publishing`, async (t) => {
    const root = fixture(t);
    if (mutationAt === "before-install") {
      const file = path.join(root, ".codex/mise.lock");
      writeFileSync(file, omitForeignArtifact(readFileSync(file, "utf8")));
    }
    const before = new Map(
      [...toolchainConfigurationPaths, "package.json", "pnpm-lock.yaml"].map((relative) => [
        relative,
        readFileSync(path.join(root, relative), "utf8"),
      ]),
    );
    const calls = [];
    await assert.rejects(
      maintainToolchain({
        root,
        locked: true,
        fetchImpl: async () => {
          throw new Error("locked candidate must not use network");
        },
        installBootstrapTools: async () => ({ mise: "fixture-mise", codex: "fixture-codex" }),
        admitProjectTools: () => {},
        runCommand: (command, args, options = {}) => {
          calls.push(args);
          if (args.includes("--stage-locked")) {
            const file = path.join(options.cwd, ".codex/mise.lock");
            writeFileSync(file, omitForeignArtifact(readFileSync(file, "utf8")));
            writeFileSync(
              path.join(options.cwd, "pnpm-lock.yaml"),
              "lockfileVersion: '9.0'\n# candidate\n",
            );
          }
          return "";
        },
      }),
      /Candidate toolchain lock is invalid:.*linux-arm64-musl/u,
    );
    assert.equal(
      calls.some((args) => args.includes("--reproduce-toolchain")),
      false,
    );
    if (mutationAt === "before-install") assert.deepEqual(calls, []);
    else assert.ok(calls.some((args) => args.includes("--stage-locked")));
    for (const [relative, bytes] of before)
      assert.equal(readFileSync(path.join(root, relative), "utf8"), bytes);
    assert.equal(inspectRuntimeLifecycleLock({ root }).status, "absent");
    assert.equal(existsSync(path.join(root, ".project-state/repository-housekeeping")), false);
  });
}
