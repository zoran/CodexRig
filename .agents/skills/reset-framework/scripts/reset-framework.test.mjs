/** Verifies reset framework behavior for the reusable framework reset boundary. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
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
import {
  acquireRuntimeLifecycleLock,
  releaseRuntimeLifecycleLock,
} from "../../../../scripts/repository/runtime-session-lease.mjs";
import { repositoryRuntimeRootIdentity } from "../../../../scripts/repository/runtime-owned-state.mjs";
import { acquireVerificationSessionLock } from "../../../../scripts/verify/verification-session-lock.mjs";
import {
  acquireDependencyTransactionLock,
  releaseDependencyTransactionLock,
} from "../../../../scripts/deps/dependency-transaction-state.mjs";
import { applyMigrations, removeResetCandidate } from "./reset-framework.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "reset-framework.mjs");
const definitelyStalePid = 2_147_483_647;

function write(root, relativePath, content = "fixture\n", mode) {
  const filePath = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(filePath), { mode: 0o700, recursive: true });
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

function writeLegacyRuntimeSessionLease(root, pid) {
  write(
    root,
    ".codex/runtime/codexrig-session.json",
    `${JSON.stringify({
      schemaVersion: 1,
      pid,
      startedAt: "2026-08-01T00:00:00.000Z",
      root: repositoryRuntimeRootIdentity(root),
    })}\n`,
    0o600,
  );
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
  write(
    root,
    "tmp/codexrig-handovers/critical-budget-fixture.prompt.md",
    "private handover\n",
    0o600,
  );
  write(root, ".tmp/runtime-state", "private cache work\n", 0o600);
  write(root, "dist/exports/project.tar.gz", "generated\n");
  write(root, ".codex/auth.json", "obsolete auth\n", 0o600);
  write(root, ".codex/history.jsonl", "obsolete history\n");
  write(root, ".codex/runtime/cache/codexrig/startup-attestation.json", "{}\n");
  writeLegacyRuntimeSessionLease(root, definitelyStalePid);
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
  write(root, "rules/default.rules", 'prefix_rule(pattern=["fixture"], decision="allow")\n');
  write(root, "sessions/thread.jsonl", "project session fixture\n");
  write(root, "state_1.sqlite", "project database fixture\n");
  write(root, "src/index.ts", "export const product = true;\n");

  const preview = run(root);
  assert.equal(preview.status, 1);
  assert.match(preview.stdout, /auth\.json -> \.codex\/runtime\/auth\.json/, preview.stderr);
  assert.match(preview.stdout, /config\.toml -> \.codex\/runtime\/config\.toml/);
  assert.match(preview.stdout, /\.context-index/);
  assert.match(preview.stdout, /^- \.tmp$/mu);
  assert.match(preview.stdout, /^- tmp$/mu);
  assert.match(preview.stdout, /\.codex\/history\.jsonl/);
  assert.match(preview.stdout, /history\.jsonl/);
  assert.match(preview.stdout, /rules/);
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
    ".tmp",
    "tmp",
    "dist/exports",
    ".codex/auth.json",
    ".codex/history.jsonl",
    ".codex/runtime/cache/codexrig",
    ".codex/runtime/codexrig-session.json",
    ".codex/runtime/logs_2.sqlite",
    "auth.json",
    "config.toml",
    "installation_id",
    "history.jsonl",
    "rules",
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

test("the shared runtime lifecycle lock closes reset and session-start races", (t) => {
  const root = fixture("reset-framework-lifecycle-lock-");
  t.after(() => rmSync(root, { force: true, recursive: true }));
  write(root, "history.jsonl", "preserve across the contested lifecycle window\n");
  const resetOwner = acquireRuntimeLifecycleLock({ root });
  try {
    assert.throws(
      () => issueRuntimeSessionLease({ root, pid: process.pid }),
      /runtime lifecycle operation is active/,
    );
    const contestedReset = run(root, ["--apply"]);
    assert.equal(contestedReset.status, 1);
    assert.match(contestedReset.stderr, /runtime lifecycle operation is active/);
    assert.equal(
      readFileSync(path.join(root, "history.jsonl"), "utf8"),
      "preserve across the contested lifecycle window\n",
    );
  } finally {
    releaseRuntimeLifecycleLock({ root, owner: resetOwner });
  }
});

test("post-project-creation cleanup removes safe residue while preserving active runtime and index", (t) => {
  const root = fixture("reset-framework-post-creation-");
  t.after(() => rmSync(root, { force: true, recursive: true }));
  write(root, "docs/planning/current-goal.md", "# Safe process residue\n");
  write(root, ".project-state/generator/transaction.json", "{}\n");
  write(root, "dist/exports/generated.tar.gz", "generated\n");
  write(root, ".context-index/manifest.json", "{}\n");
  write(root, ".codex/runtime/logs_2.sqlite", "active runtime\n");
  write(root, "history.jsonl", "active legacy runtime\n");
  issueRuntimeSessionLease({ root, pid: process.pid });
  t.after(() => {
    if (existsSync(path.join(root, ".codex/runtime/codexrig-session.json"))) {
      releaseRuntimeSessionLease({ root, pid: process.pid });
    }
  });

  const preview = run(root, ["--post-project-creation"]);
  assert.equal(preview.status, 1);
  assert.match(preview.stdout, /docs\/planning/);
  assert.match(preview.stdout, /\.project-state/);
  assert.match(preview.stdout, /dist\/exports/);
  assert.doesNotMatch(preview.stdout, /\.context-index/);
  assert.doesNotMatch(preview.stdout, /logs_2\.sqlite|history\.jsonl/);
  assert.match(preview.stdout, /--post-project-creation --apply/);

  const applied = run(root, ["--post-project-creation", "--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /active-session cleanup complete/);
  for (const removed of ["docs/planning", ".project-state", "dist/exports"]) {
    assert.equal(existsSync(path.join(root, ...removed.split("/"))), false, removed);
  }
  for (const preserved of [
    ".context-index/manifest.json",
    ".codex/runtime/logs_2.sqlite",
    ".codex/runtime/codexrig-session.json",
    "history.jsonl",
  ]) {
    assert.equal(existsSync(path.join(root, ...preserved.split("/"))), true, preserved);
  }
  const clean = run(root, ["--post-project-creation"]);
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /local runtime and \.context-index are deferred until Codex exits/);
});

test("post-project-creation cleanup cannot overlap an active dependency transaction", (t) => {
  const root = fixture("reset-framework-post-creation-dependency-");
  t.after(() => rmSync(root, { force: true, recursive: true }));
  write(root, ".project-state/generator/transaction.json", "{}\n");
  const dependency = acquireDependencyTransactionLock(root);

  const contested = run(root, ["--post-project-creation", "--apply"]);
  assert.equal(contested.status, 1);
  assert.match(contested.stderr, /runtime lifecycle operation is active/u);
  assert.equal(
    readFileSync(path.join(root, ".project-state/generator/transaction.json"), "utf8"),
    "{}\n",
  );

  releaseDependencyTransactionLock(dependency);
  const applied = run(root, ["--post-project-creation", "--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(existsSync(path.join(root, ".project-state")), false);
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

test("reset unlinks top-level and nested runtime symlinks without touching their targets", (t) => {
  const root = fixture("reset-framework-symlink-");
  const outside = mkdtempSync(path.join(os.tmpdir(), "reset-framework-outside-"));
  t.after(() => {
    rmSync(root, { force: true, recursive: true });
    rmSync(outside, { force: true, recursive: true });
  });
  write(outside, "sentinel.txt", "outside\n");
  write(outside, "bin/codex", "outside binary\n");
  symlinkSync(outside, path.join(root, "sessions"));
  symlinkSync("missing-history-target", path.join(root, "history.jsonl"));
  symlinkSync(outside, path.join(root, ".context-index"));
  write(root, ".codex/runtime/tmp/arg0/codex-arg0-fixture/owned.txt", "runtime temp\n");
  symlinkSync(
    path.join(outside, "bin/codex"),
    path.join(root, ".codex/runtime/tmp/arg0/codex-arg0-fixture/codex-execve-wrapper"),
  );

  const applied = run(root, ["--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(existsSync(path.join(root, "sessions")), false);
  assert.equal(existsSync(path.join(root, ".context-index")), false);
  assert.equal(existsSync(path.join(root, ".codex/runtime/tmp")), false);
  assert.equal(readFileSync(path.join(outside, "sentinel.txt"), "utf8"), "outside\n");
  assert.equal(readFileSync(path.join(outside, "bin/codex"), "utf8"), "outside binary\n");
  assert.equal(run(root).status, 0);
});

test("reset keeps nested symlinks strict outside private Codex runtime", (t) => {
  const root = fixture("reset-framework-strict-symlink-");
  const outside = mkdtempSync(path.join(os.tmpdir(), "reset-framework-strict-outside-"));
  t.after(() => {
    rmSync(root, { force: true, recursive: true });
    rmSync(outside, { force: true, recursive: true });
  });
  write(root, "docs/planning/owned.txt", "owned planning state\n");
  write(outside, "sentinel.txt", "outside\n");
  symlinkSync(outside, path.join(root, "docs/planning/outside"), "dir");

  const applied = run(root, ["--apply"]);
  assert.equal(applied.status, 1);
  assert.match(applied.stderr, /symlinked content in reset candidate docs\/planning/u);
  assert.equal(
    readFileSync(path.join(root, "docs/planning/owned.txt"), "utf8"),
    "owned planning state\n",
  );
  assert.equal(readFileSync(path.join(outside, "sentinel.txt"), "utf8"), "outside\n");
});

test("reset removal binds the complete parent chain before claiming nested state", (t) => {
  const root = fixture("reset-framework-parent-removal-");
  const outside = mkdtempSync(path.join(os.tmpdir(), "reset-framework-parent-outside-"));
  const docs = path.join(root, "docs");
  const parkedDocs = path.join(root, "docs-owned");
  write(root, "docs/planning/owned.txt", "owned\n");
  write(outside, "planning/sentinel.txt", "outside\n");
  t.after(() => {
    rmSync(docs, { force: true, recursive: true });
    rmSync(root, { force: true, recursive: true });
    rmSync(outside, { force: true, recursive: true });
  });

  assert.throws(
    () =>
      removeResetCandidate(root, path.join(docs, "planning"), {
        testHooks: {
          afterParentBindingCapture() {
            renameSync(docs, parkedDocs);
            symlinkSync(outside, docs, "dir");
          },
        },
      }),
    /unsafe parent|parent identity change/u,
  );
  assert.equal(readFileSync(path.join(outside, "planning/sentinel.txt"), "utf8"), "outside\n");
  assert.equal(readFileSync(path.join(parkedDocs, "planning/owned.txt"), "utf8"), "owned\n");
});

test("reset migration refuses a swapped runtime parent before moving or chmodding identity", (t) => {
  const root = fixture("reset-framework-parent-migration-");
  const outside = mkdtempSync(path.join(os.tmpdir(), "reset-framework-migration-outside-"));
  const codex = path.join(root, ".codex");
  const parkedCodex = path.join(root, ".codex-owned");
  write(root, "auth.json", "owned auth\n", 0o600);
  write(outside, "runtime/auth.json", "outside auth\n", 0o640);
  t.after(() => {
    rmSync(codex, { force: true, recursive: true });
    rmSync(root, { force: true, recursive: true });
    rmSync(outside, { force: true, recursive: true });
  });

  let swapped = false;
  const error = assert.throws(
    () =>
      applyMigrations(root, [{ from: "auth.json", to: ".codex/runtime/auth.json" }], {
        testHooks: {
          beforeMigrationRename() {
            swapped = true;
            renameSync(codex, parkedCodex);
            symlinkSync(outside, codex, "dir");
          },
        },
      }),
    /unsafe parent|parent identity change/u,
  );
  assert.equal(swapped, true, error?.message);
  assert.equal(readFileSync(path.join(root, "auth.json"), "utf8"), "owned auth\n");
  assert.equal(readFileSync(path.join(outside, "runtime/auth.json"), "utf8"), "outside auth\n");
  assert.equal(statSync(path.join(outside, "runtime/auth.json")).mode & 0o777, 0o640);
});
