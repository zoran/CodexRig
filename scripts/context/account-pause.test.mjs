/** Exercises an explicit account pause and its selection against canonical disposable runtime leases. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { importSpecifiersForFile } from "../repository/source-import-specifiers.mjs";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { captureProcessIdentity } from "../repository/runtime-process-identity.mjs";
import { repositoryRuntimeRootIdentity } from "../repository/runtime-session-lease.mjs";
import {
  acknowledgeCriticalBudgetHandover,
  createAccountPauseHandover,
  createCriticalBudgetHandover,
  criticalHandoverMaxAgeMilliseconds,
  discoverRecentHandover,
  hasPendingAccountPause,
  hasSelectedAccountWindow,
  receiveCriticalBudgetHandover,
} from "./critical-budget-handover.mjs";
import { repositoryRoot, temporaryDirectory, write } from "./context-regression-helpers.mjs";
import { runStopLifecycle } from "./session-stop-lifecycle.mjs";

const drain = [
  "## Critical Budget Drain",
  "- Owned subagents: none live; all handoffs are accepted or recorded.",
  "- Owned background tasks: none live; queued work is cancelled and atomic sections are complete.",
  "- Foreign agents and tasks: not contacted, interrupted, or changed.",
].join("\n");

function project() {
  const root = temporaryDirectory("account-window-pause-");
  const runtime = path.join(root, ".codex", "runtime");
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  copyFileSync(
    path.join(repositoryRoot, ".codex/tooling.json"),
    path.join(root, ".codex/tooling.json"),
  );
  const session = () => {
    const processIdentity = captureProcessIdentity(process.pid);
    const sessionId = randomUUID();
    writeFileSync(
      path.join(runtime, "codexrig-session.json"),
      JSON.stringify({
        schemaVersion: 6,
        codexProcess: processIdentity,
        codexSessionId: randomUUID(),
        phase: "active",
        process: processIdentity,
        root: repositoryRuntimeRootIdentity(root),
        sessionId,
        startedAt: new Date().toISOString(),
        writerPhase: "bound",
        writerProcess: processIdentity,
      }) + "\n",
      { mode: 0o600 },
    );
    return sessionId;
  };
  const context = (revision = 1, status = "active", body = "Private continuity detail") => {
    write(
      root,
      "docs/project-context.md",
      `<!-- codexrig-work-state\n${JSON.stringify({ version: 1, revision, status, outcome: "Complete authorized work", currentGoal: "Test account pause", currentSlice: "Check selection", nextAction: status === "active" ? "Verify the remaining slice" : null, blocker: status === "blocked" ? { kind: "external", reason: "Waiting for capacity" } : null })}\n-->\n\n${body}\n`,
    );
  };
  const stop = (inspectCapacity) =>
    runStopLifecycle({
      root,
      inspectCapacity,
      hookInput: JSON.stringify({
        session_id: "test-thread",
        cwd: root,
        hook_event_name: "Stop",
        turn_id: "turn",
        transcript_path: "/fixture/session.jsonl",
        stop_hook_active: false,
        last_assistant_message: "Checkpoint",
      }),
    });
  const receive = ({ relativePath }) => receiveCriticalBudgetHandover({ root, relativePath });
  const acknowledge = ({ relativePath, sha256, windowKey }) =>
    acknowledgeCriticalBudgetHandover({ root, relativePath, expectedSha256: sha256, windowKey });
  const origin = session();
  context();
  return {
    root,
    origin,
    session,
    context,
    stop,
    receive,
    acknowledge,
    pause: (options = {}) => createAccountPauseHandover({ root, ...options }),
  };
}

test("automatic durable continuation at the ordinary threshold asks the primary to checkpoint before more work", async () => {
  const f = project();
  let reads = 0;
  const sample = () => {
    reads += 1;
    return { action: "pause" };
  };
  const first = await f.stop(sample);
  assert.equal(first.decision, "block");
  assert.match(first.reason, /only the recoverable pause/u);
  assert.match(first.reason, /pnpm handover:check/u);
  assert.equal(hasPendingAccountPause({ root: f.root }), false);
  const saved = f.pause();
  const stopped = await f.stop(sample);
  assert.equal(stopped.decision, undefined);
  assert.match(stopped.systemMessage, /paused/iu);
  assert.equal(reads, 1);
  f.acknowledge(f.receive(saved));
});

test("a 3% account pause is private, retryable and resumable by an explicit selection in the same runtime", async () => {
  const f = project();
  const original = readFileSync(path.join(f.root, "docs/project-context.md"));
  const selected = f.pause();
  assert.match(
    selected.relativePath,
    new RegExp(`^tmp/codexrig-handovers/account-pause-${f.origin}-1\\.prompt\\.md$`, "u"),
  );
  assert.equal(lstatSync(path.join(f.root, selected.relativePath)).mode & 0o777, 0o600);
  assert.deepEqual(f.pause(), selected);
  assert.deepEqual(discoverRecentHandover({ root: f.root }), { ...selected, mode: "pause" });
  assert.equal(hasPendingAccountPause({ root: f.root }), true);
  assert.match((await f.stop()).systemMessage, /account-window handover is paused/iu);
  const received = f.receive(selected);
  assert.match(received.content, /Private continuity detail/u);
  assert.match(received.resumeBoundary, /current capacity/u);
  assert.equal((await f.stop()).decision, undefined);
  assert.throws(() => f.acknowledge({ ...received, sha256: "0".repeat(64) }), /digest/u);
  const windowKey = "1".repeat(64);
  f.acknowledge({ ...received, windowKey });
  assert.equal(hasSelectedAccountWindow(f.root, windowKey), true);
  f.session();
  assert.equal(hasSelectedAccountWindow(f.root, windowKey), false);
  assert.deepEqual(readFileSync(path.join(f.root, "docs/project-context.md")), original);
  assert.equal(hasPendingAccountPause({ root: f.root }), false);
  assert.deepEqual(readdirSync(path.dirname(path.join(f.root, selected.relativePath))), []);
  assert.equal((await f.stop()).decision, "block");
});

test("a new session and old age never imply consent; the latest selected pause leaves older snapshot bytes intact", async () => {
  const f = project();
  const now = Date.now();
  const first = f.pause({ now: () => now });
  f.context(2, "blocked");
  const second = f.pause({ now: () => now + 1 });
  f.session();
  assert.equal(
    discoverRecentHandover({
      root: f.root,
      now: () => now + criticalHandoverMaxAgeMilliseconds + 2,
    }),
    null,
  );
  assert.match((await f.stop()).systemMessage, /paused/iu);
  assert.equal(
    discoverRecentHandover({ root: f.root, now: () => now + 2 }).relativePath,
    second.relativePath,
  );
  const older = readFileSync(path.join(f.root, first.relativePath));
  f.acknowledge(f.receive(second));
  assert.equal(hasPendingAccountPause({ root: f.root }), false);
  assert.equal(discoverRecentHandover({ root: f.root, now: () => now + 2 }), null);
  assert.deepEqual(readFileSync(path.join(f.root, first.relativePath)), older);
  f.context(3);
  const third = f.pause({ now: () => now + 3 });
  f.acknowledge(f.receive(first));
  assert.equal(hasPendingAccountPause({ root: f.root }), true);
  f.acknowledge(f.receive(third));
  assert.equal(hasPendingAccountPause({ root: f.root }), false);
});

test("a critical seal remains terminal when a pause coexists, and a later canonical session can choose either", async () => {
  const f = project();
  const now = Date.now();
  const paused = f.pause({ now: () => now });
  f.context(2, "active", drain);
  const critical = createCriticalBudgetHandover({ root: f.root, now: () => now + 1 });
  assert.match((await f.stop()).systemMessage, /Stop completely/u);
  assert.equal(discoverRecentHandover({ root: f.root, now: () => now + 2 }).mode, "critical");
  assert.throws(() => f.receive(paused), /sealed runtime/u);
  assert.throws(() => f.receive(critical), /later active/u);
  assert.throws(() => f.pause(), /unsealed/u);
  f.session();
  assert.match((await f.stop()).systemMessage, /paused/iu);
  f.acknowledge(f.receive(paused));
  assert.ok(existsSync(path.join(f.root, critical.relativePath)));
  f.acknowledge(f.receive(critical));
  assert.equal((await f.stop()).decision, "block");
});

test("private source, copied prompts, unsafe paths and damaged artifacts cannot unlock a paused operation", async () => {
  const f = project();
  f.context(1, "complete");
  assert.throws(() => f.pause(), /active or blocked/u);
  f.context(1, "active", `Accidental token sk-proj-${"x".repeat(30)}`);
  assert.throws(() => f.pause(), /secret/u);
  f.context(1);
  const p = f.pause();
  const received = f.receive(p);
  f.context(1, "active", "New content with a stale revision");
  assert.throws(() => f.pause(), /revision differs/u);
  assert.throws(
    () => f.receive({ relativePath: "../" + p.relativePath }),
    /exact repository-relative/u,
  );
  const originalName = path.join(f.root, p.relativePath);
  const bytes = readFileSync(originalName);
  const other = project();
  const dest = path.join(other.root, p.relativePath);
  mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  copyFileSync(originalName, dest);
  chmodSync(dest, 0o600);
  assert.throws(() => other.receive(p), /another repository/u);
  writeFileSync(
    originalName,
    bytes.toString().replace("Private continuity detail", "tampered detail"),
  );
  assert.throws(() => f.acknowledge(received), /integrity/u);
  assert.match((await f.stop()).systemMessage, /paused/iu);
  unlinkSync(originalName);
  symlinkSync(dest, originalName);
  assert.throws(() => f.receive(p));
  assert.match((await f.stop()).systemMessage, /paused/iu);
  unlinkSync(originalName);
  writeFileSync(originalName, bytes, { mode: 0o600 });
  f.acknowledge(received);
  assert.ok(existsSync(dest));
});

test("the handover CLI creates, receives and acknowledges an ordinary pause in the originating live project runtime", () => {
  const f = project();
  const entry = "scripts/context/critical-budget-handover.mjs";
  const files = new Set([entry]);
  for (const relativePath of files) {
    const content = readFileSync(path.join(repositoryRoot, relativePath), "utf8");
    write(f.root, relativePath, content);
    for (const specifier of importSpecifiersForFile({ relativePath, content }))
      if (specifier.startsWith("."))
        files.add(path.posix.join(path.posix.dirname(relativePath), specifier));
  }
  const command = (...args) => {
    const result = spawnSync(process.execPath, [path.join(f.root, entry), ...args], {
      cwd: f.root,
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const output = command("create", "--", "--pause");
  const relativePath = output.match(/^Account-window pause handover: (.+)$/mu)[1];
  assert.match(output, /this or a later active session/u);
  assert.match(
    command("create", "--pause"),
    new RegExp(path.basename(relativePath).replaceAll(".", "\\."), "u"),
  );
  const received = command("receive", relativePath);
  assert.match(received, /Private continuity detail/u);
  const digest = received.match(/^Handover SHA-256: ([a-f0-9]{64})$/mu)[1];
  command("acknowledge", relativePath, "--sha256", digest);
  assert.equal(hasPendingAccountPause({ root: f.root }), false);
});

test("a replacement in a new runtime recovers missing prompts and an interrupted final acknowledgement", () => {
  const f = project();
  const first = f.pause();
  f.context(2);
  const second = f.pause();
  unlinkSync(path.join(f.root, first.relativePath));
  unlinkSync(path.join(f.root, second.relativePath));
  assert.equal(hasPendingAccountPause({ root: f.root }), true);
  f.session();
  const replacement = f.pause();
  const coordinator = path.join(f.root, ".codex/runtime/account-pause-pending.json");
  const pending = readFileSync(coordinator);
  f.acknowledge(f.receive(replacement));
  assert.equal(hasPendingAccountPause({ root: f.root }), false);
  // Simulate process loss after durable acknowledgement/unlink and before deleting its coordination record.
  writeFileSync(coordinator, pending, { mode: 0o600 });
  assert.equal(hasPendingAccountPause({ root: f.root }), false);
});
