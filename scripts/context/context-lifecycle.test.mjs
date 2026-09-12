/** Verifies context lifecycle behavior for the durable project-context and session lifecycle boundary. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { repositoryRuntimeRootIdentity } from "../repository/runtime-session-lease.mjs";
import { captureProcessIdentity } from "../repository/runtime-process-identity.mjs";
import {
  createCriticalBudgetHandover,
  criticalHandoverMaxAgeMilliseconds,
  discoverRecentCriticalBudgetHandover,
} from "./critical-budget-handover.mjs";
import * as handoverLifecycle from "./critical-budget-handover.mjs";
import { evaluateAutonomousContinuation, runStopLifecycle } from "./session-stop-lifecycle.mjs";
import {
  sessionStartAdditionalContextMaximumBytes,
  sessionStartSuccess,
} from "../setup/startup-session-context.mjs";
import { repositoryRoot, temporaryDirectory, write } from "./context-regression-helpers.mjs";

function workState(overrides = {}) {
  return {
    version: 1,
    revision: 1,
    status: "active",
    outcome: "Complete the already-authorized project outcome",
    currentGoal: "Keep Codex working across intermediate goals",
    currentSlice: "Exercise the Stop lifecycle",
    nextAction: "Run the next safe planned slice",
    blocker: null,
    ...overrides,
  };
}

function writeWorkingContext(projectRoot, state, body = "# Current work\n") {
  write(
    projectRoot,
    "docs/project-context.md",
    `<!-- codexrig-work-state\n${JSON.stringify(state)}\n-->\n\n${body}`,
  );
}

function copyFrameworkContract(projectRoot) {
  const contractDirectory = path.join(projectRoot, ".codexrig");
  mkdirSync(contractDirectory, { recursive: true });
  copyFileSync(
    path.join(repositoryRoot, ".codexrig", "framework.json"),
    path.join(contractDirectory, "framework.json"),
  );
}

function writeRuntimeSessionLease(projectRoot, startedAt, codexSessionId = randomUUID()) {
  const runtimeDirectory = path.join(projectRoot, ".codex", "runtime");
  const processIdentity = captureProcessIdentity(process.pid);
  const runtimeSessionId = randomUUID();
  mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  chmodSync(runtimeDirectory, 0o700);
  const leasePath = path.join(runtimeDirectory, "codexrig-session.json");
  writeFileSync(
    leasePath,
    `${JSON.stringify({
      schemaVersion: 6,
      codexProcess: processIdentity,
      codexSessionId,
      phase: "active",
      process: processIdentity,
      root: repositoryRuntimeRootIdentity(projectRoot),
      sessionId: runtimeSessionId,
      startedAt,
      writerPhase: "bound",
      writerProcess: processIdentity,
    })}\n`,
    { mode: 0o600 },
  );
  chmodSync(leasePath, 0o600);
  return runtimeSessionId;
}

const criticalDrainBody = [
  "# Current work",
  "",
  "Unique next-account recovery detail that startup must not expose.",
  "",
  "## Critical Budget Drain",
  "- Owned subagents: none live; all handoffs are accepted or recorded.",
  "- Owned background tasks: none live; queued work is cancelled and atomic sections are complete.",
  "- Foreign agents and tasks: not contacted, interrupted, or changed.",
  "",
].join("\n");

function stopHookInput(overrides = {}) {
  return JSON.stringify({
    session_id: "session-fixture",
    cwd: "/redacted-fixture",
    hook_event_name: "Stop",
    turn_id: "turn-fixture",
    transcript_path: "/redacted-fixture/session.jsonl",
    stop_hook_active: false,
    last_assistant_message: "Intermediate result",
    ...overrides,
  });
}

test("preloaded Stop lifecycle preserves continuation and terminal handover", async () => {
  const project = temporaryDirectory("context-stop-lifecycle-");
  copyFrameworkContract(project);
  mkdirSync(path.join(project, ".codex"));
  writeWorkingContext(project, workState());

  const activeOutput = await runStopLifecycle({ root: project, hookInput: stopHookInput() });
  assert.equal(activeOutput.decision, "block");
  assert.match(activeOutput.reason, /Continue the already-authorized outcome autonomously/u);

  const now = Date.now();
  writeRuntimeSessionLease(project, new Date(now - 1_000).toISOString());
  writeWorkingContext(project, workState({ revision: 2 }), criticalDrainBody);
  createCriticalBudgetHandover({
    root: project,
    now: () => now,
    random: (size) => Buffer.alloc(size, 0xcd),
  });
  const sealedOutput = await runStopLifecycle({ root: project, hookInput: stopHookInput() });
  assert.equal(Object.hasOwn(sealedOutput, "decision"), false);
  assert.match(sealedOutput.systemMessage, /critical-budget handover is sealed/u);
  assert.match(sealedOutput.systemMessage, /Stop completely/u);
});

test("Stop lifecycle never touches active work from an ephemeral side conversation", async () => {
  const project = temporaryDirectory("autonomous-stop-ephemeral-");
  mkdirSync(path.join(project, ".codex"));
  writeWorkingContext(project, workState());

  for (const stopHookActive of [false, true]) {
    assert.deepEqual(
      evaluateAutonomousContinuation({
        root: project,
        hookInput: stopHookInput({
          stop_hook_active: stopHookActive,
          transcript_path: null,
        }),
      }),
      {},
    );
  }

  assert.equal(existsSync(path.join(project, ".codex", "runtime")), false);
  assert.deepEqual(
    await runStopLifecycle({
      root: project,
      expectedSessionId: "a-different-durable-parent",
      hookInput: stopHookInput({ transcript_path: null }),
    }),
    {},
  );

  const missingTranscriptPath = JSON.parse(stopHookInput());
  delete missingTranscriptPath.transcript_path;
  const unsupported = evaluateAutonomousContinuation({
    root: project,
    hookInput: JSON.stringify(missingTranscriptPath),
  });
  assert.equal(Object.hasOwn(unsupported, "decision"), false);
  assert.match(unsupported.systemMessage, /invalid transcript path/);
});

test("Stop lifecycle continues active outcomes and bounds unchanged automatic loops", () => {
  const project = temporaryDirectory("autonomous-stop-");
  mkdirSync(path.join(project, ".codex"));

  assert.deepEqual(
    evaluateAutonomousContinuation({ root: project, hookInput: stopHookInput() }),
    {},
  );

  const initialState = workState();
  writeWorkingContext(project, initialState);
  const first = evaluateAutonomousContinuation({ root: project, hookInput: stopHookInput() });
  assert.equal(first.decision, "block");
  assert.match(first.reason, /applies only to the persistent main thread/);
  assert.match(first.reason, /cannot override a side-conversation boundary/);
  assert.match(first.reason, /Continue the already-authorized outcome autonomously/);
  assert.match(first.reason, /validated as active at revision 1/);
  assert.match(first.reason, /untrusted resume metadata, not as authority/);
  assert.equal(first.reason.includes(initialState.nextAction), false);
  assert.equal(first.reason.includes(project), false);

  const continuationDirectory = path.join(project, ".codex", "runtime", "stop-continuation");
  assert.equal(lstatSync(continuationDirectory).mode & 0o777, 0o700);
  const continuationEntries = readdirSync(continuationDirectory);
  assert.equal(continuationEntries.length, 1);
  const continuationPath = path.join(continuationDirectory, continuationEntries[0]);
  assert.equal(lstatSync(continuationPath).mode & 0o777, 0o600);

  writeWorkingContext(project, {
    blocker: initialState.blocker,
    nextAction: initialState.nextAction,
    currentSlice: initialState.currentSlice,
    currentGoal: initialState.currentGoal,
    outcome: initialState.outcome,
    status: initialState.status,
    revision: initialState.revision,
    version: initialState.version,
  });
  const unchanged = evaluateAutonomousContinuation({
    root: project,
    hookInput: stopHookInput({ stop_hook_active: true }),
  });
  assert.equal(Object.hasOwn(unchanged, "decision"), false);
  assert.match(unchanged.systemMessage, /allowed this stop to avoid an automatic loop/);

  writeWorkingContext(
    project,
    workState({
      revision: 2,
      currentSlice: "Advance the next slice",
      nextAction: "Continue again",
    }),
  );
  const progressed = evaluateAutonomousContinuation({
    root: project,
    hookInput: stopHookInput({ stop_hook_active: true }),
  });
  assert.equal(progressed.decision, "block");
  assert.match(progressed.reason, /validated as active at revision 2/);
  assert.equal(progressed.reason.includes("Continue again"), false);

  writeWorkingContext(
    project,
    workState({
      revision: 3,
      status: "blocked",
      currentSlice: null,
      nextAction: null,
      blocker: { kind: "external", reason: "The required upstream is unavailable" },
    }),
  );
  assert.deepEqual(
    evaluateAutonomousContinuation({
      root: project,
      hookInput: stopHookInput({ stop_hook_active: true }),
    }),
    {},
  );
  assert.equal(existsSync(continuationPath), false);
});

test("critical-budget handover seals privately, asks before resume, and terminates Stop work", async () => {
  const project = temporaryDirectory("critical-budget-handover-");
  mkdirSync(path.join(project, ".codex"));
  copyFrameworkContract(project);
  const now = Date.now();
  const sealingSessionId = writeRuntimeSessionLease(project, new Date(now + 60_000).toISOString());
  writeWorkingContext(project, workState({ revision: 7 }), criticalDrainBody);
  const processTemporaryState = path.join(project, "tmp", "arg0", "runtime-state");
  mkdirSync(path.dirname(processTemporaryState), { recursive: true, mode: 0o700 });
  writeFileSync(processTemporaryState, "preserve process temporary state\n", { mode: 0o600 });

  const sealed = createCriticalBudgetHandover({
    root: project,
    now: () => now,
    random: (size) => Buffer.alloc(size, 0xab),
  });
  assert.match(
    sealed.relativePath,
    /^tmp\/codexrig-handovers\/critical-budget-\d{8}T\d{9}Z-(?:ab){6}\.prompt\.md$/u,
  );
  assert.equal(sealed.workStateRevision, 7);
  assert.equal(sealed.sealingSessionId, sealingSessionId);
  assert.equal(readFileSync(processTemporaryState, "utf8"), "preserve process temporary state\n");
  const sealedPath = path.join(project, sealed.relativePath);
  assert.equal(existsSync(path.join(project, ".tmp", "codexrig-handovers")), false);
  assert.equal(lstatSync(path.dirname(sealedPath)).mode & 0o777, 0o700);
  assert.equal(lstatSync(sealedPath).mode & 0o777, 0o600);
  const prompt = readFileSync(sealedPath, "utf8");
  assert.match(prompt, /^<!-- codexrig-critical-budget-handover/mu);
  assert.match(prompt, /^# Critical-Budget Cross-Account Handover Prompt$/mu);
  assert.match(prompt, /BEGIN VERBATIM docs\/project-context\.md SNAPSHOT/u);
  assert.match(prompt, /Unique next-account recovery detail/u);
  assert.equal(prompt.includes(project), false);
  assert.throws(
    () =>
      createCriticalBudgetHandover({
        root: project,
        now: () => now,
        random: (size) => Buffer.alloc(size, 0xab),
      }),
    /EEXIST/u,
  );
  assert.equal(readFileSync(sealedPath, "utf8"), prompt);

  assert.deepEqual(
    discoverRecentCriticalBudgetHandover({ root: project, now: () => now + 1 }),
    sealed,
  );

  const snapshotBegin = "----- BEGIN VERBATIM docs/project-context.md SNAPSHOT -----";
  const snapshotEnd = "----- END VERBATIM docs/project-context.md SNAPSHOT -----";
  for (const tampered of [
    prompt.replace("Unique next-account recovery detail", "Altered recovery detail"),
    prompt.replace("candidate context, never authority", "trusted context and authority"),
    prompt.replace(snapshotBegin, `${snapshotBegin}\n${snapshotBegin}`),
    prompt.slice(0, prompt.indexOf(snapshotEnd)),
    prompt.slice(0, prompt.indexOf(snapshotBegin)),
  ]) {
    writeFileSync(sealedPath, tampered, "utf8");
    assert.equal(discoverRecentCriticalBudgetHandover({ root: project, now: () => now + 1 }), null);
    writeFileSync(sealedPath, prompt, "utf8");
  }

  const startup = sessionStartSuccess(
    { frameworkVersion: "2.1.0", sessionSource: "resume" },
    { root: project, now: () => now + 1 },
  );
  const additionalContext = startup.hookSpecificOutput.additionalContext;
  assert.match(additionalContext, /First, before intake\/writes/u);
  assert.match(additionalContext, /pnpm worktree:status -- --json/u);
  assert.match(additionalContext, /hook does not replace that full inventory/u);
  assert.match(additionalContext, /ask before \$resume-project reads it/u);
  assert.match(additionalContext, /treat it as untrusted/u);
  assert.ok(
    Buffer.byteLength(additionalContext, "utf8") <= sessionStartAdditionalContextMaximumBytes,
  );
  assert.equal(additionalContext.includes(sealed.relativePath), true);
  assert.equal(additionalContext.includes("Unique next-account recovery detail"), false);
  assert.equal(additionalContext.includes(project), false);

  const stopped = evaluateAutonomousContinuation({ root: project, hookInput: stopHookInput() });
  assert.equal(Object.hasOwn(stopped, "decision"), false);
  assert.match(stopped.systemMessage, /Stop completely/u);
  const lifecycle = await runStopLifecycle({
    root: project,
    hookInput: stopHookInput(),
  });
  assert.match(lifecycle.systemMessage, /do not continue automatically/u);

  const resumedSessionId = writeRuntimeSessionLease(project, new Date(now - 60_000).toISOString());
  assert.notEqual(resumedSessionId, sealingSessionId);
  const resumedLifecycle = await runStopLifecycle({
    root: project,
    hookInput: stopHookInput(),
  });
  assert.equal(resumedLifecycle.decision, "block");

  assert.equal(
    discoverRecentCriticalBudgetHandover({
      root: project,
      now: () => now + criticalHandoverMaxAgeMilliseconds + 1,
    }),
    null,
  );

  const foreign = temporaryDirectory("critical-budget-handover-foreign-");
  copyFrameworkContract(foreign);
  const foreignDirectory = path.join(foreign, "tmp", "codexrig-handovers");
  mkdirSync(foreignDirectory, { recursive: true, mode: 0o700 });
  const copied = path.join(foreignDirectory, path.basename(sealedPath));
  copyFileSync(sealedPath, copied);
  chmodSync(copied, 0o600);
  assert.equal(discoverRecentCriticalBudgetHandover({ root: foreign, now: () => now + 1 }), null);

  const incomplete = temporaryDirectory("critical-budget-handover-incomplete-");
  copyFrameworkContract(incomplete);
  writeWorkingContext(incomplete, workState());
  assert.throws(
    () => createCriticalBudgetHandover({ root: incomplete, now: () => now }),
    /requires drain attestation/u,
  );
  writeWorkingContext(
    incomplete,
    workState({ revision: 2 }),
    `${criticalDrainBody}Accidental token: sk-proj-${"x".repeat(24)}\n`,
  );
  assert.throws(
    () => createCriticalBudgetHandover({ root: incomplete, now: () => now }),
    /refuses recognized secret material/u,
  );
  writeWorkingContext(
    incomplete,
    workState({ revision: 4 }),
    `${criticalDrainBody}GITLAB_TOKEN=corpgl-${"x".repeat(24)}\n`,
  );
  assert.throws(
    () => createCriticalBudgetHandover({ root: incomplete, now: () => now }),
    /refuses recognized secret material/u,
  );
  writeWorkingContext(
    incomplete,
    workState({ revision: 3 }),
    `${criticalDrainBody}Accidental GitLab token: glpat-${"g".repeat(20)}\n`,
  );
  assert.throws(
    () => createCriticalBudgetHandover({ root: incomplete, now: () => now }),
    /refuses recognized secret material/u,
  );

  const unsafeParent = temporaryDirectory("critical-budget-handover-unsafe-parent-");
  copyFrameworkContract(unsafeParent);
  writeRuntimeSessionLease(unsafeParent, new Date(now - 1_000).toISOString());
  writeWorkingContext(unsafeParent, workState(), criticalDrainBody);
  mkdirSync(path.join(unsafeParent, "tmp"));
  chmodSync(path.join(unsafeParent, "tmp"), 0o770);
  assert.throws(
    () => createCriticalBudgetHandover({ root: unsafeParent, now: () => now }),
    /storage is unsafe/u,
  );
  assert.equal(discoverRecentCriticalBudgetHandover({ root: unsafeParent, now: () => now }), null);
});

// Problem: sealed handovers had no exact receiving/acknowledgement lifecycle and could be offered again.
// Contract: a later canonical session reads the complete bound artifact and acknowledges only unchanged bytes.
test("handover receipt and acknowledgement consume only the exact unchanged later-session artifact", () => {
  const project = temporaryDirectory("handover-receipt-");
  copyFrameworkContract(project);
  const now = Date.now();
  writeRuntimeSessionLease(project, new Date(now - 1_000).toISOString());
  writeWorkingContext(project, workState(), criticalDrainBody);
  const sealed = createCriticalBudgetHandover({ root: project, now: () => now });
  const target = path.join(project, sealed.relativePath);
  const before = readFileSync(target, "utf8");
  const options = { root: project, relativePath: sealed.relativePath };
  assert.equal(typeof handoverLifecycle.receiveCriticalBudgetHandover, "function");
  assert.equal(typeof handoverLifecycle.acknowledgeCriticalBudgetHandover, "function");
  assert.throws(() => handoverLifecycle.receiveCriticalBudgetHandover(options), /later.*session/u);
  writeRuntimeSessionLease(project, new Date(now + 1_000).toISOString());
  const received = handoverLifecycle.receiveCriticalBudgetHandover(options);
  assert.equal(received.content, before);
  assert.equal(received.sha256, createHash("sha256").update(before).digest("hex"));
  assert.equal(readFileSync(target, "utf8"), before);
  const acknowledgement = { ...options, expectedSha256: received.sha256 };
  assert.throws(
    () =>
      handoverLifecycle.acknowledgeCriticalBudgetHandover({
        ...acknowledgement,
        expectedSha256: "0".repeat(64),
      }),
    /digest/u,
  );
  assert.throws(
    () =>
      handoverLifecycle.receiveCriticalBudgetHandover({
        ...options,
        relativePath: `../${sealed.relativePath}`,
      }),
    /path/u,
  );
  assert.throws(
    () =>
      handoverLifecycle.receiveCriticalBudgetHandover({
        ...options,
        relativePath: target,
      }),
    /path/u,
  );
  writeFileSync(target, `${before}\nchanged`, "utf8");
  assert.throws(() => handoverLifecycle.acknowledgeCriticalBudgetHandover(acknowledgement));
  assert.equal(existsSync(target), true);
  writeFileSync(target, before, "utf8");
  assert.throws(
    () =>
      handoverLifecycle.acknowledgeCriticalBudgetHandover({
        ...acknowledgement,
        testHooks: {
          beforeHandoverAcknowledge() {
            writeFileSync(target, `${before}\nchanged`, "utf8");
          },
        },
      }),
    /identity|content/u,
  );
  assert.equal(existsSync(target), true);
  writeFileSync(target, before, "utf8");
  assert.throws(
    () =>
      handoverLifecycle.acknowledgeCriticalBudgetHandover({
        ...acknowledgement,
        testHooks: {
          beforeHandoverAcknowledge() {
            writeRuntimeSessionLease(project, new Date(now + 2_000).toISOString());
          },
        },
      }),
    /session changed/u,
  );
  assert.equal(readFileSync(target, "utf8"), before);
  const foreign = temporaryDirectory("handover-receipt-foreign-");
  copyFrameworkContract(foreign);
  writeRuntimeSessionLease(foreign, new Date(now + 2_000).toISOString());
  const foreignTarget = path.join(foreign, sealed.relativePath);
  mkdirSync(path.dirname(foreignTarget), { recursive: true, mode: 0o700 });
  writeFileSync(foreignTarget, before, { mode: 0o600 });
  assert.throws(
    () =>
      handoverLifecycle.acknowledgeCriticalBudgetHandover({
        ...acknowledgement,
        root: foreign,
      }),
    /another repository/u,
  );
  assert.equal(readFileSync(foreignTarget, "utf8"), before);
  const unrelated = path.join(path.dirname(target), "unrelated.txt");
  writeFileSync(unrelated, "preserve\n", { mode: 0o600 });
  const result = handoverLifecycle.acknowledgeCriticalBudgetHandover(acknowledgement);
  assert.equal(result.relativePath, sealed.relativePath);
  assert.equal(existsSync(target), false);
  assert.equal(readFileSync(unrelated, "utf8"), "preserve\n");
  assert.equal(discoverRecentCriticalBudgetHandover({ root: project }), null);
  assert.throws(() => handoverLifecycle.acknowledgeCriticalBudgetHandover(acknowledgement));
});

test("Stop lifecycle rejects unsafe or ambiguous working context without exposing paths", () => {
  const project = temporaryDirectory("autonomous-stop-invalid-");
  const outside = temporaryDirectory("autonomous-stop-outside-");
  mkdirSync(path.join(project, ".codex"));
  mkdirSync(path.join(project, "docs"));
  writeWorkingContext(outside, workState());
  symlinkSync(
    path.join(outside, "docs", "project-context.md"),
    path.join(project, "docs", "project-context.md"),
  );

  const linked = evaluateAutonomousContinuation({ root: project, hookInput: stopHookInput() });
  assert.equal(linked.decision, "block");
  assert.match(linked.systemMessage, /Autonomous continuation check skipped/);
  assert.match(linked.reason, /single automatic repair attempt/);
  assert.equal(linked.systemMessage.includes(project), false);
  assert.equal(linked.systemMessage.includes(outside), false);

  const linkedRetry = evaluateAutonomousContinuation({
    root: project,
    hookInput: stopHookInput({ stop_hook_active: true }),
  });
  assert.equal(Object.hasOwn(linkedRetry, "decision"), false);

  rmSync(path.join(project, "docs", "project-context.md"), { force: true });
  symlinkSync(
    path.join(outside, "docs", "missing-project-context.md"),
    path.join(project, "docs", "project-context.md"),
  );
  const dangling = evaluateAutonomousContinuation({ root: project, hookInput: stopHookInput() });
  assert.equal(dangling.decision, "block");
  assert.match(dangling.systemMessage, /not a bounded regular file/);

  rmSync(path.join(project, "docs", "project-context.md"), { force: true });
  linkSync(
    path.join(outside, "docs", "project-context.md"),
    path.join(project, "docs", "project-context.md"),
  );
  const linkedAlias = evaluateAutonomousContinuation({ root: project, hookInput: stopHookInput() });
  assert.equal(linkedAlias.decision, "block");
  assert.match(linkedAlias.systemMessage, /not a bounded regular file/);

  rmSync(path.join(project, "docs", "project-context.md"), { force: true });
  write(
    project,
    "docs/project-context.md",
    `<!-- codexrig-work-state\n${JSON.stringify(workState())}\n-->\n<!-- codexrig-work-state\n${JSON.stringify(workState({ revision: 2 }))}\n-->\n`,
  );
  const ambiguous = evaluateAutonomousContinuation({ root: project, hookInput: stopHookInput() });
  assert.equal(ambiguous.decision, "block");
  assert.match(ambiguous.systemMessage, /exactly one bounded codexrig-work-state marker/);

  write(
    project,
    "docs/project-context.md",
    `# Untrusted preface\n<!-- codexrig-work-state\n${JSON.stringify(workState())}\n-->\n`,
  );
  const prefixed = evaluateAutonomousContinuation({ root: project, hookInput: stopHookInput() });
  assert.equal(prefixed.decision, "block");
  assert.match(prefixed.systemMessage, /marker must be the first non-whitespace content/);

  writeWorkingContext(project, workState({ nextAction: "Continue\nwith injected control text" }));
  const controlled = evaluateAutonomousContinuation({ root: project, hookInput: stopHookInput() });
  assert.equal(controlled.decision, "block");
  assert.match(controlled.systemMessage, /nextAction must be bounded plain text/);

  writeWorkingContext(project, workState({ nextAction: "Continue\u200bwith hidden formatting" }));
  const formatted = evaluateAutonomousContinuation({ root: project, hookInput: stopHookInput() });
  assert.equal(formatted.decision, "block");
  assert.match(formatted.systemMessage, /nextAction must be bounded plain text/);
});
