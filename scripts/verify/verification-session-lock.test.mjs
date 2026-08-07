import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  acquireVerificationSessionLock,
  assertVerificationSessionLockOwned,
  withVerificationSessionLock,
} from "./verification-session-lock.mjs";

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
  mkdirSync(lockPath, { mode: 0o700, recursive: true });
  writeFileSync(path.join(lockPath, "owner.json"), `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  if (extraEntry) {
    writeFileSync(path.join(lockPath, "unexpected"), "blocked\n", {
      encoding: "utf8",
      mode: 0o600,
    });
  }
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
  const roots = ["dead", "live", "malformed", "unknown"].map((label) =>
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
});
