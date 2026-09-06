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
  readdirSync,
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
  acquireRuntimeLifecycleLock,
  invalidRuntimeSessionLeaseErrorCode,
  issueRuntimeSessionLease,
  releaseRuntimeLifecycleLock,
  releaseRuntimeSessionLease,
} from "../../../../scripts/repository/runtime-session-lease.mjs";
import { acquireVerificationSessionLock } from "../../../../scripts/verify/verification-session-lock.mjs";
import { fullVerificationEvidenceRecord } from "../../../../scripts/verify/verification-evidence-record.mjs";
import {
  readVerificationEvidence,
  writeVerificationEvidence,
} from "../../../../scripts/verify/verification-evidence-store.mjs";
import { inspectLinuxOpenRepositoryPaths } from "../../../../scripts/repository/runtime-process-identity.mjs";
import {
  acquireDependencyTransactionLock,
  releaseDependencyTransactionLock,
} from "../../../../scripts/deps/dependency-transaction-state.mjs";
import { openFrameworkRuntimeStatus, removeResetCandidate } from "./reset-framework.mjs";
import { startupControllerFailureMessage } from "../../../../scripts/setup/startup-session-controller.mjs";
import { postProjectCreationGuidance } from "../../create-project-from-framework/scripts/source-readiness.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "reset-framework.mjs");
const frameworkRoot = path.resolve(path.dirname(script), "..", "..", "..", "..");

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

function writeStaleRuntimeSessionLease(root) {
  const leaseModule = new URL(
    "../../../../scripts/repository/runtime-session-lease.mjs",
    import.meta.url,
  ).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { issueRuntimeSessionLease } from ${JSON.stringify(leaseModule)}; issueRuntimeSessionLease({ root: ${JSON.stringify(root)}, pid: process.pid });`,
    ],
    { cwd: root, encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.equal(child.status, 0, child.stderr);
}

function currentVerificationEvidence(root) {
  const digest = (character) => character.repeat(64);
  const record = fullVerificationEvidenceRecord(
    {
      artifactDigest: "",
      artifactManifest: "",
      broadFingerprint: digest("a"),
      configurationDigest: "",
      deliveryEnvironment: "dev",
      deliveryPlanDigest: "",
      exactFingerprint: digest("b"),
      planDigest: digest("c"),
      riskFingerprints: [],
      runtime: {
        arch: "fixture-arch",
        environment: digest("d"),
        executables: digest("e"),
        mise: digest("f"),
        node: "fixture-node",
        platform: "fixture-platform",
        pnpm: digest("0"),
      },
      runtimeDigest: digest("1"),
      sourceCommit: "",
    },
    { complete: false, dirtyPaths: [], head: "" },
    "2026-08-22T00:00:00.000Z",
  );
  writeVerificationEvidence(root, record);
  return record;
}

function run(root, args = [], env = {}) {
  return spawnSync(process.execPath, [script, "--root", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, CODEX_HOME: "", ...env },
    input: "",
    stdio: "pipe",
  });
}

test("operator reset guidance executes preview, apply, and clean preview through mise and pnpm", async (t) => {
  const error = new Error("Fixture private lease is not current.");
  error.code = invalidRuntimeSessionLeaseErrorCode;
  const guidance = [
    ["startup recovery", startupControllerFailureMessage(error, frameworkRoot)],
    ["README recovery", readFileSync(path.join(frameworkRoot, "README.md"), "utf8")],
    ["project creation", postProjectCreationGuidance({ sourceHasChanges: false }).join("\n")],
  ];
  for (const [label, content] of guidance) {
    await t.test(label, () => {
      const root = fixture("reset operator guidance ");
      try {
        write(root, "history.jsonl", "disposable fixture history\n");
        write(root, "src/index.ts", "export const product = true;\n");
        const commands = content
          .split("\n")
          .map((line) => {
            const start = line.indexOf("mise exec --locked -- pnpm framework:reset");
            return start === -1 ? null : line.slice(start).trim().split(/\s+/u);
          })
          .filter(Boolean);
        for (const [index, [executable, ...args]] of commands.entries()) {
          const result = spawnSync(executable, [...args, "--root", root], {
            cwd: frameworkRoot,
            encoding: "utf8",
            env: { ...process.env, CODEX_HOME: "" },
            input: "",
            stdio: "pipe",
            timeout: 30_000,
          });
          assert.equal(result.error, undefined);
          assert.equal(result.status, index === 0 ? 1 : 0, result.stderr);
          assert.match(
            result.stdout,
            [
              /Framework reset would remove:/u,
              /Framework reset complete;/u,
              /Framework baseline is clean\./u,
            ][index],
          );
          assert.equal(existsSync(path.join(root, "history.jsonl")), index === 0);
          assert.equal(
            readFileSync(path.join(root, "src/index.ts"), "utf8"),
            "export const product = true;\n",
          );
        }
        assert.equal(commands.length, 3, `${label} must provide the complete reset sequence`);
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    });
  }
});

test("reset preserves current identity and removes all disposable framework runtime", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { force: true, recursive: true }));
  write(root, "docs/project.md", "# Project Manifest\n");
  write(root, "docs/planning/current-goal.md", "# Current Goal\n");
  write(root, "notes/reviews/final-audit.md", "# Final Audit\n");
  write(root, "scripts/planning/create-goal.mjs", "export {};\n");
  write(root, ".project-state/dependency-update/plan.json", "{}\n");
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
  write(root, "auth.json", "current auth\n", 0o600);
  write(root, "config.toml", 'model = "fixture"\n', 0o600);
  write(root, "installation_id", "fixture-installation\n", 0o600);
  write(root, ".codex/runtime/cache/codexrig/startup-attestation.json", "{}\n");
  const evidence = currentVerificationEvidence(root);
  writeStaleRuntimeSessionLease(root);
  write(
    root,
    ".codex/runtime/codexrig-session-recovery.json",
    '{"codexSessionId":"01a01234-5678-7abc-8def-0123456789ab"}\n',
    0o600,
  );
  write(root, ".codex/runtime/logs_2.sqlite", "runtime database\n");
  write(root, ".codex/runtime/auth.json", "obsolete auth\n", 0o600);
  write(root, ".codex/runtime/config.toml", 'model = "obsolete"\n', 0o600);
  write(root, ".codex/runtime/installation_id", "obsolete-installation\n", 0o600);
  write(root, "history.jsonl", "project history fixture\n");
  write(root, "rules/default.rules", 'prefix_rule(pattern=["fixture"], decision="allow")\n');
  write(root, "sessions/thread.jsonl", "project session fixture\n");
  write(root, "state_1.sqlite", "project database fixture\n");
  write(root, "src/index.ts", "export const product = true;\n");

  const preview = run(root);
  assert.equal(preview.status, 1);
  assert.match(preview.stdout, /^- \.codex\/runtime\/auth\.json$/mu, preview.stderr);
  assert.match(preview.stdout, /^- \.codex\/runtime\/config\.toml$/mu);
  assert.match(preview.stdout, /^- \.codex\/runtime\/installation_id$/mu);
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
    ".tmp",
    "tmp",
    "dist/exports",
    ".codex/auth.json",
    ".codex/history.jsonl",
    ".codex/runtime/cache/codexrig",
    ".codex/runtime/codexrig-session.json",
    ".codex/runtime/codexrig-session-recovery.json",
    ".codex/runtime/logs_2.sqlite",
    ".codex/runtime/auth.json",
    ".codex/runtime/config.toml",
    ".codex/runtime/installation_id",
    "history.jsonl",
    "rules",
    "sessions",
    "state_1.sqlite",
  ]) {
    assert.equal(existsSync(path.join(root, ...removed.split("/"))), false, removed);
  }
  assert.equal(readFileSync(path.join(root, "auth.json"), "utf8"), "current auth\n");
  assert.equal(readFileSync(path.join(root, "config.toml"), "utf8"), 'model = "fixture"\n');
  assert.equal(statSync(path.join(root, "auth.json")).mode & 0o777, 0o600);
  assert.equal(readFileSync(path.join(root, "installation_id"), "utf8"), "fixture-installation\n");
  assert.deepEqual(readVerificationEvidence(root), evidence);
  assert.equal(
    readFileSync(path.join(root, "src/index.ts"), "utf8"),
    "export const product = true;\n",
  );
  assert.equal(run(root).status, 0);
});

test("reset discards non-current verification evidence", (t) => {
  const root = fixture("reset-framework-old-evidence-");
  t.after(() => rmSync(root, { force: true, recursive: true }));
  write(
    root,
    ".codex/runtime/cache/project-verification/evidence.json",
    '{"schemaVersion":1}\n',
    0o600,
  );

  const preview = run(root);
  assert.equal(preview.status, 1, preview.stderr);
  assert.match(preview.stdout, /project-verification\/evidence\.json/u);
  const applied = run(root, ["--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(
    existsSync(path.join(root, ".codex/runtime/cache/project-verification/evidence.json")),
    false,
  );
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

test("full reset discards a non-current private lease only after runtime quiescence", (t) => {
  const root = fixture("reset-framework-non-current-runtime-");
  t.after(() => rmSync(root, { force: true, recursive: true }));
  write(root, "history.jsonl", "discard with the non-current private runtime\n");
  write(
    root,
    ".codex/runtime/codexrig-session.json",
    '{"schemaVersion":999,"unsupported":true}\n',
    0o600,
  );

  const preview = run(root);
  assert.equal(preview.status, 1, preview.stderr);
  assert.match(preview.stdout, /\.codex\/runtime\/codexrig-session\.json/u);

  const applied = run(root, ["--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(existsSync(path.join(root, ".codex/runtime/codexrig-session.json")), false);
  assert.equal(existsSync(path.join(root, "history.jsonl")), false);
  assert.equal(run(root).status, 0);
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

test("post-project-creation cleanup removes safe residue while preserving active runtime", (t) => {
  const root = fixture("reset-framework-post-creation-");
  t.after(() => rmSync(root, { force: true, recursive: true }));
  write(root, "docs/planning/current-goal.md", "# Safe process residue\n");
  write(root, ".project-state/generator/transaction.json", "{}\n");
  write(root, "dist/exports/generated.tar.gz", "generated\n");
  write(root, ".codex/runtime/logs_2.sqlite", "active runtime\n");
  write(root, "history.jsonl", "active loose-root runtime\n");
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
  assert.doesNotMatch(preview.stdout, /logs_2\.sqlite|history\.jsonl/);
  assert.match(preview.stdout, /--post-project-creation --apply/);

  const applied = run(root, ["--post-project-creation", "--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /active-session cleanup complete/);
  for (const removed of ["docs/planning", ".project-state", "dist/exports"]) {
    assert.equal(existsSync(path.join(root, ...removed.split("/"))), false, removed);
  }
  for (const preserved of [
    ".codex/runtime/logs_2.sqlite",
    ".codex/runtime/codexrig-session.json",
    "history.jsonl",
  ]) {
    assert.equal(existsSync(path.join(root, ...preserved.split("/"))), true, preserved);
  }
  const clean = run(root, ["--post-project-creation"]);
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /local runtime are deferred until Codex exits/);
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
  write(root, "history.jsonl", "active pre-lease fixture\n");

  const clean = run(root, ["--portable-source-baseline"]);
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /portable source baseline is clean/);

  write(root, "docs/planning/current-goal.md", "# Process residue\n");
  const blocked = run(root, ["--portable-source-baseline"]);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout, /docs\/planning/);
});

test(
  "reset refuses loose-root runtime files still held open by a pre-lease process",
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

test(
  "permission-obscured Linux descriptor tables remain indeterminate",
  { skip: process.platform !== "linux" },
  (t) => {
    const root = fixture("reset-framework-indeterminate-runtime-");
    const procRoot = mkdtempSync(path.join(os.tmpdir(), "reset-framework-proc-"));
    mkdirSync(path.join(procRoot, "4242", "fd"), { recursive: true });
    t.after(() => {
      rmSync(root, { force: true, recursive: true });
      rmSync(procRoot, { force: true, recursive: true });
    });

    for (const code of ["EACCES", "EPERM"]) {
      const inspected = inspectLinuxOpenRepositoryPaths({
        root,
        excludePids: [],
        matchesPath: (isPath) => isPath === "history.jsonl",
        procRoot,
        testHooks: {
          readDirectory(target) {
            if (target.endsWith(`${path.sep}fd`)) throw Object.assign(new Error(code), { code });
            return readdirSync(target);
          },
          readLink() {
            return root;
          },
        },
      });
      assert.deepEqual(inspected, { observationComplete: false, status: "unknown" });
    }
  },
);

test("a missing Linux proc filesystem is indeterminate rather than inactive", (t) => {
  const root = fixture("reset-framework-missing-proc-");
  const missingProc = path.join(root, "missing-proc");
  t.after(() => rmSync(root, { force: true, recursive: true }));
  assert.equal(
    openFrameworkRuntimeStatus(root, { procRoot: missingProc }),
    process.platform === "linux" ? "unknown" : "inactive",
  );
});

test("reset preserves root Codex identity and discards non-current coordination-home identity", (t) => {
  const root = fixture("reset-framework-conflict-");
  t.after(() => rmSync(root, { force: true, recursive: true }));
  write(root, ".codex/runtime/auth.json", "non-current auth\n", 0o600);
  write(root, "auth.json", "canonical auth\n", 0o600);

  const applied = run(root, ["--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(existsSync(path.join(root, ".codex/runtime/auth.json")), false);
  assert.equal(readFileSync(path.join(root, "auth.json"), "utf8"), "canonical auth\n");
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
  write(root, ".codex/runtime/tmp/arg0/codex-arg0-fixture/owned.txt", "runtime temp\n");
  symlinkSync(
    path.join(outside, "bin/codex"),
    path.join(root, ".codex/runtime/tmp/arg0/codex-arg0-fixture/codex-execve-wrapper"),
  );

  const applied = run(root, ["--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(existsSync(path.join(root, "sessions")), false);
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
