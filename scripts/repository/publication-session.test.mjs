/** Verifies exact calling-session admission without weakening competing-writer protection. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectPublicationSession } from "./publication-session.mjs";
import {
  activateRuntimeSessionLease,
  inspectRuntimeSessionLease,
  issueRuntimeSessionLease,
  releaseRuntimeSessionLease,
  transitionRuntimeSessionWriterProcess,
} from "./runtime-session-lease.mjs";

function session(root, codexPid = process.pid) {
  const lease = issueRuntimeSessionLease({ root, pid: process.pid });
  const binding = { root, pid: process.pid, runtimeSessionId: lease.sessionId };
  for (const transition of ["supervisor", "handoff", "codex"])
    transitionRuntimeSessionWriterProcess({
      ...binding,
      transition,
      writerPid: transition === "codex" ? codexPid : process.pid,
    });
  activateRuntimeSessionLease({ ...binding, codexSessionId: "owned-publication-test" });
  return () => {
    transitionRuntimeSessionWriterProcess({ ...binding, transition: "complete" });
    releaseRuntimeSessionLease({ root, pid: process.pid });
  };
}

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "publication-session-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("publication admits only the exact caller and preserves its lease and recovery", (t) => {
  const root = fixture(t);
  assert.equal(inspectPublicationSession(root), null);
  const close = session(root);
  try {
    const recovery = path.join(root, ".codex/runtime/codexrig-session-recovery.json");
    const before = readFileSync(recovery);
    assert.deepEqual(inspectPublicationSession(root), inspectRuntimeSessionLease({ root }).lease);
    assert.deepEqual(readFileSync(recovery), before);
  } finally {
    close();
  }
});

test("an unrelated live Codex process cannot be impersonated with environment identifiers", async (t) => {
  const root = fixture(t);
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  await once(child, "spawn");
  const close = session(root, child.pid);
  const previous = process.env.CODEX_THREAD_ID;
  try {
    process.env.CODEX_THREAD_ID = "owned-publication-test";
    assert.throws(() => inspectPublicationSession(root), /unverified session ownership/u);
  } finally {
    if (previous === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = previous;
    close();
    child.kill();
    await once(child, "exit");
  }
});

test("an active session in a sibling worktree blocks even the owning caller", (t) => {
  const root = fixture(t);
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git("init", "--initial-branch=main");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-m",
    "baseline",
  );
  const sibling = path.join(root, "sibling");
  git("worktree", "add", "--detach", sibling);
  const close = session(root);
  const closeSibling = session(sibling);
  try {
    assert.throws(() => inspectPublicationSession(root), /active writer session/u);
    assert.throws(() => inspectPublicationSession(root, { isolated: true }), /separate clone/u);
    assert.throws(() => inspectPublicationSession(sibling, { isolated: true }), /separate clone/u);
  } finally {
    closeSibling();
    close();
  }
});

test("frozen release admission rejects borrowed Git objects", (t) => {
  const root = fixture(t);
  assert.equal(spawnSync("git", ["init", "--initial-branch=main"], { cwd: root }).status, 0);
  const directory = path.join(root, ".git/objects/info");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "alternates"), "/unowned/objects\n");
  assert.throws(() => inspectPublicationSession(root, { isolated: true }), /separate clone/u);
});

test("frozen release admission rejects aliased Git configuration", async (t) => {
  for (const [kind, link] of [
    ["symlink", symlinkSync],
    ["hardlink", linkSync],
  ])
    await t.test(kind, (t) => {
      const root = fixture(t);
      assert.equal(spawnSync("git", ["init", "--initial-branch=main"], { cwd: root }).status, 0);
      const config = path.join(root, ".git/config");
      const shared = path.join(root, "shared-config");
      writeFileSync(shared, readFileSync(config));
      rmSync(config);
      link(shared, config);
      assert.throws(() => inspectPublicationSession(root, { isolated: true }), /separate clone/u);
    });
});
