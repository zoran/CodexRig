/** Verifies toolchain maintenance candidate admission before installation and publication. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import { prepareUserToolDirectories } from "../repository/user-tool-storage.mjs";
import { cleanGitEnvironment } from "../repository/git-runtime-isolation.mjs";
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
  const previousStorage = process.env.PROJECT_TOOL_STORAGE_HOME;
  const storage = path.join(root, "tool-storage");
  mkdirSync(storage, { mode: 0o700 });
  process.env.PROJECT_TOOL_STORAGE_HOME = storage;
  t.after(() => {
    if (previousStorage === undefined) delete process.env.PROJECT_TOOL_STORAGE_HOME;
    else process.env.PROJECT_TOOL_STORAGE_HOME = previousStorage;
    rmSync(root, { recursive: true, force: true });
  });
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

function nodeSourceFallback(lock) {
  const altered = lock.replace(
    /url = "https:\/\/unofficial-builds\.nodejs\.org\/download\/release\/v([^/]+)\/node-v[^/]+-linux-arm64-musl\.tar\.gz"/u,
    (_, version) => `url = "https://nodejs.org/dist/v${version}/node-v${version}.tar.gz"`,
  );
  assert.notEqual(altered, lock, "fixture must contain the native Node musl binary");
  return altered;
}

async function heldVerification(root, operation = "verification") {
  const module = new URL("../repository/runtime-session-lease.mjs", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { acquireRuntimeLifecycleLock, releaseRuntimeLifecycleLock } from ${JSON.stringify(module)};
    const root = process.argv[1];
    const owner = acquireRuntimeLifecycleLock({ root, operation: process.argv[2] });
    process.on("message", () => {
      releaseRuntimeLifecycleLock({ root, owner });
      process.disconnect();
    });
    process.send("ready");
  `,
      root,
      operation,
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

function reserveSiblingSession(root) {
  const sibling = path.join(root, "sibling-worktree");
  writeFileSync(
    path.join(root, ".gitignore"),
    ".auth/\n.codex/runtime/\ntool-storage/\nsibling-worktree/\n",
  );
  const git = (...args) => {
    const result = spawnSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: root, env: cleanGitEnvironment(process.env, root), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  };
  git("init", "--quiet", "--initial-branch=main");
  git("add", "--all");
  git("commit", "--quiet", "-m", "fixture");
  git("worktree", "add", "--quiet", "--detach", sibling);
  reserveRuntimeSessionLease({ root: sibling, pid: process.pid });
}

test("startup waits for a live verification without stealing its lock or starting maintenance", async (t) => {
  const root = fixture(t);
  const holder = await heldVerification(root);
  const reachedMaintenance = new Error("candidate discovery reached after release");
  let waited = false;
  try {
    await assert.rejects(
      maintainToolchain({ prepareStorage: () => {}, root }),
      (error) =>
        error.code === runtimeLifecycleBusyErrorCode && error.lifecycle.status === "active",
    );
    await assert.rejects(
      maintainToolchain({
        prepareStorage: () => {},
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
        prepareStorage: () => {},
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

// A second project's tool maintenance used to abort startup after release discovery. Waiting
// must preserve that owner and revalidate our staged inputs/session before installing anything.
for (const change of ["none", "source", "session"]) {
  test(`startup waits for shared installation and rechecks ${change} before mutation`, async (t) => {
    const root = fixture(t);
    const shared = prepareUserToolDirectories().lifecycle;
    const holder = await heldVerification(shared, "toolchain-maintenance");
    const reachedInstallation = new Error("installation reached with both capabilities");
    let waited = false;
    try {
      await assert.rejects(
        maintainToolchain({
          root,
          startup: true,
          locked: true,
          prepareStorage: () => {},
          lifecycleWaitTimeoutMilliseconds: 5_000,
          fetchImpl: async () => {
            throw new Error("fixture must not use the network");
          },
          onLifecycleWait: async (message) => {
            waited = true;
            assert.match(message, /shared tool installation/u);
            assert.ok(message.includes(String(holder.pid)));
            assert.equal(
              inspectRuntimeLifecycleLock({ root: shared }).owner.coordinator.pid,
              holder.pid,
            );
            assert.equal(inspectRuntimeLifecycleLock({ root }).owner.coordinator.pid, process.pid);
            await holder.release();
            if (change === "source")
              writeFileSync(path.join(root, "package.json"), '{"name":"concurrent-owner"}\n');
            if (change === "session") reserveSiblingSession(root);
          },
          installBootstrapTools: async () => {
            assert.equal(waited, true);
            assert.equal(change, "none", "changed source/session must block installation");
            assert.equal(
              inspectRuntimeLifecycleLock({ root: shared }).owner.coordinator.pid,
              process.pid,
            );
            throw reachedInstallation;
          },
        }),
        change === "none"
          ? (error) => error === reachedInstallation
          : change === "source"
            ? /changed/u
            : /preserves unsafe or active worktrees/u,
      );
      assert.equal(waited, true);
      assert.equal(inspectRuntimeLifecycleLock({ root }).status, "absent");
      assert.equal(inspectRuntimeLifecycleLock({ root: shared }).status, "absent");
      if (change === "source")
        assert.match(readFileSync(path.join(root, "package.json"), "utf8"), /concurrent-owner/u);
    } finally {
      await holder.stop();
    }
  });
}

for (const scope of ["project", "shared"]) {
  for (const interruptedBy of ["timeout", "abort"]) {
    test(`startup ${interruptedBy} preserves the running ${scope} operation and its lock`, async (t) => {
      const root = fixture(t);
      const heldRoot = scope === "project" ? root : prepareUserToolDirectories().lifecycle;
      const holder = await heldVerification(heldRoot);
      const before = readFileSync(inspectRuntimeLifecycleLock({ root: heldRoot }).path, "utf8");
      const controller = new AbortController();
      let reported = false;
      try {
        await assert.rejects(
          maintainToolchain({
            prepareStorage: () => {},
            root,
            startup: true,
            locked: true,
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
        const current = inspectRuntimeLifecycleLock({ root: heldRoot });
        assert.equal(current.status, "active");
        assert.equal(readFileSync(current.path, "utf8"), before);
        if (scope === "project") assert.equal(existsSync(path.join(root, ".auth")), false);
        else assert.equal(inspectRuntimeLifecycleLock({ root }).status, "absent");
      } finally {
        await holder.release();
      }
    });
  }

  test(`uncertain ${scope} ownership fails closed without waiting or changing its lock`, async (t) => {
    if (process.platform !== "linux") return t.skip("Linux namespace identity");
    const root = fixture(t);
    const heldRoot = scope === "project" ? root : prepareUserToolDirectories().lifecycle;
    const holder = await heldVerification(heldRoot);
    const snapshot = inspectRuntimeLifecycleLock({ root: heldRoot });
    await holder.stop();
    snapshot.owner.coordinator.startIdentity = null;
    writeFileSync(snapshot.path, JSON.stringify(snapshot.owner), { mode: 0o600 });
    const before = readFileSync(snapshot.path, "utf8");
    assert.equal(inspectRuntimeLifecycleLock({ root: heldRoot }).status, "unknown");
    await assert.rejects(
      maintainToolchain({
        prepareStorage: () => {},
        root,
        startup: true,
        locked: true,
        onLifecycleWait: () => {
          throw new Error("uncertain owners must not be retried");
        },
      }),
      (error) =>
        error.code === runtimeLifecycleBusyErrorCode && error.lifecycle.status === "unknown",
    );
    assert.equal(readFileSync(snapshot.path, "utf8"), before);
    if (scope === "shared") assert.equal(inspectRuntimeLifecycleLock({ root }).status, "absent");
  });

  test(`ordinary maintenance and reentrant startup remain fail-fast for ${scope} ownership`, async (t) => {
    const root = fixture(t);
    const heldRoot = scope === "project" ? root : prepareUserToolDirectories().lifecycle;
    const holder = await heldVerification(heldRoot);
    try {
      await assert.rejects(
        maintainToolchain({ root, locked: true, prepareStorage: () => {} }),
        (error) =>
          error.code === runtimeLifecycleBusyErrorCode && error.lifecycle.status === "active",
      );
    } finally {
      await holder.release();
    }
    const owner = acquireRuntimeLifecycleLock({ root: heldRoot, operation: "verification" });
    try {
      for (const startup of [false, true]) {
        await assert.rejects(
          maintainToolchain({
            prepareStorage: () => {},
            root,
            startup,
            locked: true,
            onLifecycleWait: () => {
              throw new Error("cannot wait for own operation");
            },
          }),
          (error) =>
            error.code === runtimeLifecycleBusyErrorCode && error.lifecycle.status === "reentrant",
        );
      }
    } finally {
      releaseRuntimeLifecycleLock({ root: heldRoot, owner });
    }
  });
}

for (const [label, corruptLock] of [
  ["an incomplete foreign pnpm platform", omitForeignArtifact],
  ["a Node musl source fallback", nodeSourceFallback],
]) {
  for (const mutationAt of ["before-install", "after-dependencies"]) {
    test(`maintenance rejects ${label} ${mutationAt} without publishing`, async (t) => {
      const root = fixture(t);
      if (mutationAt === "before-install") {
        const file = path.join(root, ".codex/mise.lock");
        writeFileSync(file, corruptLock(readFileSync(file, "utf8")));
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
          prepareStorage: () => {},
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
              writeFileSync(file, corruptLock(readFileSync(file, "utf8")));
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
}
