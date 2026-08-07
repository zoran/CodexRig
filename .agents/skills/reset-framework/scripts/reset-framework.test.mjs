import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  issueRuntimeSessionLease,
  releaseRuntimeSessionLease,
} from "../../../../scripts/setup/startup-attestation.mjs";
import { acquireVerificationSessionLock } from "../../../../scripts/verify/verification-session-lock.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "reset-framework.mjs");

function write(root, relativePath, content = "fixture\n", mode) {
  const filePath = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, mode === undefined ? "utf8" : { encoding: "utf8", mode });
}

function fixture(prefix = "reset-framework-") {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  write(root, "package.json", '{"name":"codexrig"}\n');
  write(root, "README.md", "# CodexRig Framework\n");
  write(root, ".agents/skills/reset-framework/SKILL.md", "# Fixture\n");
  write(root, ".codex/README.md", "# Portable policy\n");
  write(root, ".codex/config.toml", "memories = false\n");
  write(root, ".codex/hooks.json", "{}\n");
  write(root, ".codex/agents/default.toml", 'name = "default"\n');
  return root;
}

function run(root, args = [], env = {}) {
  return spawnSync(process.execPath, [script, "--root", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, CODEX_HOME: "", ...env },
    input: "",
    stdio: "pipe",
  });
}

test("reset migrates required identity and removes all disposable framework runtime", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { force: true, recursive: true }));
  write(root, "docs/project.md", "# Project Manifest\n");
  write(root, "docs/planning/current-goal.md", "# Current Goal\n");
  write(root, "notes/reviews/final-audit.md", "# Final Audit\n");
  write(root, "scripts/planning/create-goal.mjs", "export {};\n");
  write(root, ".project-state/dependency-update/plan.json", "{}\n");
  write(root, ".context-index/manifest.json", "{}\n");
  write(root, "dist/exports/project.tar.gz", "generated\n");
  write(root, ".codex/auth.json", "obsolete auth\n", 0o600);
  write(root, ".codex/history.jsonl", "obsolete history\n");
  write(root, ".codex/runtime/cache/codexrig/startup-attestation.json", "{}\n");
  write(
    root,
    ".codex/runtime/cache/project-verification/evidence.json",
    '{"schemaVersion":1}\n',
    0o600,
  );
  write(root, ".codex/runtime/logs_2.sqlite", "runtime database\n");
  write(root, "auth.json", "current auth\n", 0o600);
  write(root, "config.toml", 'model = "fixture"\n', 0o600);
  write(root, "installation_id", "fixture-installation\n", 0o600);
  write(root, "history.jsonl", "project history fixture\n");
  write(root, "sessions/thread.jsonl", "project session fixture\n");
  write(root, "state_1.sqlite", "project database fixture\n");
  write(root, "src/index.ts", "export const product = true;\n");

  const preview = run(root);
  assert.equal(preview.status, 1);
  assert.match(preview.stdout, /auth\.json -> \.codex\/runtime\/auth\.json/, preview.stderr);
  assert.match(preview.stdout, /config\.toml -> \.codex\/runtime\/config\.toml/);
  assert.match(preview.stdout, /\.context-index/);
  assert.match(preview.stdout, /\.codex\/history\.jsonl/);
  assert.match(preview.stdout, /history\.jsonl/);
  assert.match(preview.stdout, /sessions/);
  assert.match(preview.stdout, /state_1\.sqlite/);
  assert.doesNotMatch(preview.stdout, /project-verification\/evidence\.json/);

  const applied = run(root, ["--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  for (const removed of [
    "docs/planning",
    "notes/reviews/final-audit.md",
    "scripts/planning",
    ".project-state",
    ".context-index",
    "dist/exports",
    ".codex/auth.json",
    ".codex/history.jsonl",
    ".codex/runtime/cache/codexrig",
    ".codex/runtime/logs_2.sqlite",
    "auth.json",
    "config.toml",
    "installation_id",
    "history.jsonl",
    "sessions",
    "state_1.sqlite",
  ]) {
    assert.equal(existsSync(path.join(root, ...removed.split("/"))), false, removed);
  }
  assert.equal(readFileSync(path.join(root, ".codex/runtime/auth.json"), "utf8"), "current auth\n");
  assert.equal(
    readFileSync(path.join(root, ".codex/runtime/config.toml"), "utf8"),
    'model = "fixture"\n',
  );
  assert.equal(statSync(path.join(root, ".codex/runtime/auth.json")).mode & 0o777, 0o600);
  assert.equal(
    readFileSync(
      path.join(root, ".codex/runtime/cache/project-verification/evidence.json"),
      "utf8",
    ),
    '{"schemaVersion":1}\n',
  );
  assert.equal(
    readFileSync(path.join(root, "src/index.ts"), "utf8"),
    "export const product = true;\n",
  );
  assert.equal(run(root).status, 0);
});

test("reset refuses an active Codex runtime lease without deleting state", (t) => {
  const root = fixture("reset-framework-active-");
  t.after(() => rmSync(root, { force: true, recursive: true }));
  write(root, "history.jsonl", "preserve while active\n");
  issueRuntimeSessionLease({ root, pid: process.pid });
  t.after(() => {
    if (existsSync(path.join(root, ".codex/runtime/codexrig-session.json"))) {
      releaseRuntimeSessionLease({ root, pid: process.pid });
    }
  });

  const applied = run(root, ["--apply"]);
  assert.equal(applied.status, 1);
  assert.match(applied.stderr, /Codex session still owns/);
  assert.equal(readFileSync(path.join(root, "history.jsonl"), "utf8"), "preserve while active\n");
});

test("portable source baseline ignores contained active runtime but not process documents", (t) => {
  const root = fixture("reset-framework-portable-source-");
  issueRuntimeSessionLease({ root, pid: process.pid });
  t.after(() => {
    releaseRuntimeSessionLease({ root, pid: process.pid });
    rmSync(root, { force: true, recursive: true });
  });
  write(root, "history.jsonl", "active legacy fixture\n");
  write(root, ".context-index/manifest.json", "{}\n");

  const clean = run(root, ["--portable-source-baseline"]);
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /portable source baseline is clean/);

  write(root, "docs/planning/current-goal.md", "# Process residue\n");
  const blocked = run(root, ["--portable-source-baseline"]);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout, /docs\/planning/);
});

test(
  "reset refuses legacy runtime files still held open by a pre-lease process",
  { skip: process.platform !== "linux" },
  (t) => {
    const root = fixture("reset-framework-open-runtime-");
    write(root, "history.jsonl", "open runtime\n");
    const descriptor = openSync(path.join(root, "history.jsonl"), "r");
    t.after(() => {
      closeSync(descriptor);
      rmSync(root, { force: true, recursive: true });
    });

    const applied = run(root, ["--apply"]);
    assert.equal(applied.status, 1);
    assert.match(applied.stderr, /still has framework runtime files open/);
    assert.equal(readFileSync(path.join(root, "history.jsonl"), "utf8"), "open runtime\n");
  },
);

test("reset refuses conflicting canonical and legacy runtime identity", (t) => {
  const root = fixture("reset-framework-conflict-");
  t.after(() => rmSync(root, { force: true, recursive: true }));
  write(root, "auth.json", "legacy auth\n", 0o600);
  write(root, ".codex/runtime/auth.json", "canonical auth\n", 0o600);

  const applied = run(root, ["--apply"]);
  assert.equal(applied.status, 1);
  assert.match(applied.stderr, /conflicting runtime identity/);
  assert.equal(readFileSync(path.join(root, "auth.json"), "utf8"), "legacy auth\n");
});

test("clean preview tolerates only the currently active verification lock", (t) => {
  const root = fixture("reset-framework-verification-");
  const unlocked = run(root, ["--verification-source-baseline"]);
  assert.equal(unlocked.status, 1);
  assert.match(unlocked.stderr, /requires the active repository verification lock/);
  const lock = acquireVerificationSessionLock({ repositoryRoot: root });
  t.after(() => {
    lock.release();
    rmSync(root, { force: true, recursive: true });
  });

  const strictPreview = run(root);
  assert.equal(strictPreview.status, 0, strictPreview.stderr);
  assert.match(strictPreview.stdout, /Framework baseline is clean/);
  const preview = run(root, ["--verification-source-baseline"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Framework portable source baseline is clean/);
});

test("reset refuses unsafe content inside the context index", (t) => {
  const root = fixture("reset-framework-unsafe-index-");
  t.after(() => rmSync(root, { force: true, recursive: true }));
  write(root, ".context-index/project-data.txt", "preserve me\n");

  const preview = run(root);
  assert.equal(preview.status, 1);
  assert.match(preview.stdout, /\.context-index/);

  const applied = run(root, ["--apply"]);
  assert.equal(applied.status, 1);
  assert.match(applied.stderr, /contains non-index content and will not be modified/);
  assert.equal(
    readFileSync(path.join(root, ".context-index/project-data.txt"), "utf8"),
    "preserve me\n",
  );
});

test("reset unlinks runtime and index symlinks without touching their targets", (t) => {
  const root = fixture("reset-framework-symlink-");
  const outside = mkdtempSync(path.join(os.tmpdir(), "reset-framework-outside-"));
  t.after(() => {
    rmSync(root, { force: true, recursive: true });
    rmSync(outside, { force: true, recursive: true });
  });
  write(outside, "sentinel.txt", "outside\n");
  symlinkSync(outside, path.join(root, "sessions"));
  symlinkSync("missing-history-target", path.join(root, "history.jsonl"));
  symlinkSync(outside, path.join(root, ".context-index"));

  const applied = run(root, ["--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(existsSync(path.join(root, "sessions")), false);
  assert.equal(existsSync(path.join(root, ".context-index")), false);
  assert.equal(readFileSync(path.join(outside, "sentinel.txt"), "utf8"), "outside\n");
  assert.equal(run(root).status, 0);
});
