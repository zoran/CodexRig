/** Exercises current startup attestation and exact session ownership without an installation contract. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { serializeCanonicalJson, sha256 } from "../filesystem/repository-files.mjs";
import {
  beginStartupSessionWriterHandoff as beginStartupSessionWriterHandoffWithRuntime,
  bindStartupSessionCodexProcess as bindStartupSessionCodexProcessWithRuntime,
  bindStartupSessionWriter as bindStartupSessionWriterWithRuntime,
  completeStartupSessionWriterHandoff as completeStartupSessionWriterHandoffWithRuntime,
  issueStartupAttestation as issueStartupAttestationWithRuntime,
  reserveStartupAttestation as reserveStartupAttestationWithRuntime,
  runtimeSessionLaunchState,
  startupAttestedInputs,
  startupControlPolicies,
  startupSessionPlan,
  startupSessionPlanToken,
  verifyStartupAttestation as verifyStartupAttestationWithRuntime,
} from "../setup/startup-attestation.mjs";
import { sessionStartSuccess } from "../setup/startup-session-context.mjs";
import { spawnRuntimeLifecycleCommandSync } from "../repository/runtime-lifecycle-process.mjs";
import {
  acquireRuntimeLifecycleLock,
  activateRuntimeSessionLease,
  clearStaleRuntimeSessionLease,
  inspectRuntimeLifecycleLock,
  inspectRuntimeSessionLease,
  inspectRuntimeSessionRecovery,
  issueRuntimeSessionLease,
  releaseRuntimeLifecycleLock,
  releaseRuntimeSessionLease,
  transitionRuntimeSessionWriterProcess,
} from "../repository/runtime-session-lease.mjs";
import {
  ensureRuntimeDirectory,
  repositoryRuntimeRootIdentity,
} from "../repository/runtime-owned-state.mjs";
import {
  captureProcessIdentity,
  inspectProcessIdentity,
} from "../repository/runtime-process-identity.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");
const temporaryRoots = [];
const definitelyStalePid = 2_147_483_647;

after(() => {
  for (const root of temporaryRoots) rmSync(root, { force: true, recursive: true });
});

function temporaryRoot(prefix) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

async function waitForLifecycle(predicate, label, timeoutMilliseconds = 5_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;
  while (Date.now() <= deadline) {
    try {
      const result = predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}.`, { cause: lastError });
}

function terminateIfAlive(pid, signal = "SIGKILL") {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function write(root, relativePath, content, mode = 0o644) {
  const target = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, { encoding: "utf8", mode });
  chmodSync(target, mode);
}

let testRuntimeExecutables;

function lifecycleRuntimeExecutables() {
  if (testRuntimeExecutables) return testRuntimeExecutables;
  const runtimeRoot = temporaryRoot("codexrig-lifecycle-runtime-");
  const codex = path.join(runtimeRoot, "codex");
  const node = path.join(runtimeRoot, "node");
  const pnpm = path.join(runtimeRoot, "pnpm");
  const shell = path.join(runtimeRoot, "shell");
  write(runtimeRoot, "codex", "#!/bin/sh\nprintf '%s\\n' 'codex-cli 0.147.0'\n", 0o755);
  write(runtimeRoot, "node", "#!/bin/sh\nprintf '%s\\n' 'v24.19.0'\n", 0o755);
  write(runtimeRoot, "pnpm", "#!/bin/sh\nprintf '%s\\n' '11.22.0'\n", 0o755);
  write(runtimeRoot, "shell", "#!/bin/sh\nexit 0\n", 0o755);
  testRuntimeExecutables = Object.freeze({ codex, node, pnpm, shell });
  return testRuntimeExecutables;
}

function withRuntimeExecutables(options = {}) {
  return {
    ...options,
    runtimeExecutables: options.runtimeExecutables ?? lifecycleRuntimeExecutables(),
  };
}

function issueStartupAttestation(options = {}) {
  return issueStartupAttestationWithRuntime(withRuntimeExecutables(options));
}

function reserveStartupAttestation(root, pid, options = {}) {
  return reserveStartupAttestationWithRuntime(root, pid, withRuntimeExecutables(options));
}

function bindStartupSessionWriter(root, pid, writerPid, options = {}) {
  const runtimeOptions = withRuntimeExecutables(options);
  bindStartupSessionWriterWithRuntime(root, pid, writerPid, runtimeOptions);
  beginStartupSessionWriterHandoffWithRuntime(root, pid, runtimeOptions);
  return bindStartupSessionCodexProcessWithRuntime(root, pid, writerPid, runtimeOptions);
}

function verifyStartupAttestation(options = {}) {
  return verifyStartupAttestationWithRuntime(withRuntimeExecutables(options));
}

function writeCurrentRuntimeSessionLease(
  root,
  pid,
  codexSessionId,
  phase = "active",
  {
    sessionId = "10000000-0000-4000-8000-000000000001",
    startIdentity = captureProcessIdentity(process.pid)?.startIdentity ?? null,
    startedAt = "2026-08-01T00:00:00.000Z",
  } = {},
) {
  ensureRuntimeDirectory(root);
  const processIdentity = {
    pid,
    startIdentity,
  };
  write(
    root,
    ".codex/runtime/codexrig-session.json",
    serializeCanonicalJson({
      schemaVersion: 6,
      codexProcess: phase === "active" ? processIdentity : null,
      codexSessionId: phase === "active" ? codexSessionId : null,
      phase,
      process: processIdentity,
      sessionId,
      startedAt,
      writerPhase: phase === "active" ? "bound" : "unbound",
      writerProcess: phase === "active" ? processIdentity : null,
      root: repositoryRuntimeRootIdentity(root),
    }),
    0o600,
  );
}

function attestationFixture() {
  const root = temporaryRoot("codexrig-attestation-");
  for (const relativePath of startupAttestedInputs) {
    const source = path.join(repositoryRoot, relativePath);
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  return root;
}

function sessionStartHookInput(root, overrides = {}) {
  return {
    cwd: root,
    hook_event_name: "SessionStart",
    transcript_path: path.join(root, "session.jsonl"),
    model: "gpt-6-astra",
    permission_mode: "default",
    session_id: "01a01234-5678-7abc-8def-0123456789ab",
    source: "startup",
    ...overrides,
  };
}

function bindCurrentRuntimeSessionWriter(root, lease) {
  const input = {
    root,
    pid: process.pid,
    runtimeSessionId: lease.sessionId,
    writerPid: process.pid,
  };
  transitionRuntimeSessionWriterProcess({ ...input, transition: "supervisor" });
  transitionRuntimeSessionWriterProcess({ ...input, transition: "handoff" });
  return transitionRuntimeSessionWriterProcess({ ...input, transition: "codex" });
}

function releaseCurrentRuntimeSession(root, pid = process.pid) {
  const current = inspectRuntimeSessionLease({ root });
  if (
    current.status === "active" &&
    current.lease.process.pid === process.pid &&
    ["handoff", "bound"].includes(current.lease.writerPhase)
  ) {
    transitionRuntimeSessionWriterProcess({
      root,
      pid: process.pid,
      runtimeSessionId: current.lease.sessionId,
      transition: "complete",
    });
  }
  return releaseRuntimeSessionLease({ root, pid });
}

test("runtime session leases enforce one current schema without choosing the native session", () => {
  const emptyRoot = temporaryRoot("codexrig-no-session-");
  assert.deepEqual(startupSessionPlan({ root: emptyRoot }), {
    mode: "resume-picker",
  });

  const unsupportedRoot = temporaryRoot("codexrig-unsupported-session-");
  ensureRuntimeDirectory(unsupportedRoot);
  write(
    unsupportedRoot,
    ".codex/runtime/codexrig-session.json",
    serializeCanonicalJson({ schemaVersion: 999 }),
    0o600,
  );
  assert.throws(
    () => inspectRuntimeSessionLease({ root: unsupportedRoot }),
    /invalid or uses an unsupported schema/u,
  );
  for (const [name, overrides] of [
    ["noncanonical-time", { startedAt: "August 1, 2026" }],
    ["noncanonical-id", { sessionId: "10000000-0000-0000-0000-000000000001" }],
  ]) {
    const invalidRoot = temporaryRoot(`codexrig-${name}-session-`);
    writeCurrentRuntimeSessionLease(
      invalidRoot,
      definitelyStalePid,
      "01a01234-5678-7abc-8def-0123456789ab",
      "active",
      overrides,
    );
    assert.throws(
      () => inspectRuntimeSessionLease({ root: invalidRoot }),
      /invalid or uses an unsupported schema/u,
    );
  }

  const issuanceRoot = emptyRoot;
  const issued = issueRuntimeSessionLease({ root: issuanceRoot, pid: process.pid });
  assert.equal(issued.schemaVersion, 6);
  assert.equal(issued.phase, "launching");
  assert.equal(issued.codexSessionId, null);
  assert.equal(issued.process.pid, process.pid);
  assert.equal(
    issued.process.startIdentity === null ||
      /^linux:[a-f0-9-]{36}:\d+:\d+:\d+$/u.test(issued.process.startIdentity),
    true,
  );
  assert.match(
    issued.sessionId,
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,
  );
  assert.deepEqual(inspectRuntimeSessionLease({ root: issuanceRoot }).lease, issued);
  assert.equal(releaseCurrentRuntimeSession(issuanceRoot), true);

  const activeRoot = temporaryRoot("codexrig-current-active-");
  const activeLease = issueRuntimeSessionLease({ root: activeRoot, pid: process.pid });
  assert.throws(
    () => issueRuntimeSessionLease({ root: activeRoot, pid: process.pid }),
    /Another Codex session already owns this repository runtime/u,
  );
  assert.deepEqual(inspectRuntimeSessionLease({ root: activeRoot }).lease, activeLease);
  assert.equal(releaseCurrentRuntimeSession(activeRoot), true);

  const currentProcess = captureProcessIdentity(process.pid);
  if (currentProcess.startIdentity !== null) {
    const fields = currentProcess.startIdentity.split(":");
    const foreignNamespace = {
      ...currentProcess,
      startIdentity: [...fields.slice(0, 3), String(BigInt(fields[3]) + 1n), fields[4]].join(":"),
    };
    assert.equal(inspectProcessIdentity(foreignNamespace), "unknown");
    assert.equal(inspectProcessIdentity({ ...currentProcess, pid: definitelyStalePid }), "stale");

    const reusedPidRoot = temporaryRoot("codexrig-reused-owner-pid-");
    const reusedPidLease = issueRuntimeSessionLease({ root: reusedPidRoot, pid: process.pid });
    const reusedProcess = {
      ...currentProcess,
      startIdentity: [...fields.slice(0, 4), String(BigInt(fields[4]) + 1n)].join(":"),
    };
    write(
      reusedPidRoot,
      ".codex/runtime/codexrig-session.json",
      serializeCanonicalJson({ ...reusedPidLease, process: reusedProcess }),
      0o600,
    );
    assert.equal(inspectRuntimeSessionLease({ root: reusedPidRoot }).status, "stale");
    assert.throws(
      () => releaseRuntimeSessionLease({ root: reusedPidRoot, pid: process.pid }),
      /different process identity/u,
    );
    assert.equal(clearStaleRuntimeSessionLease({ root: reusedPidRoot }), true);
  }
  assert.equal(
    inspectProcessIdentity({ pid: definitelyStalePid, startIdentity: null }),
    process.platform === "linux" ? "unknown" : "stale",
  );
  assert.equal(
    inspectProcessIdentity({ pid: process.pid, startIdentity: null }),
    process.platform === "linux" ? "unknown" : "active",
  );
  const codexSessionId = "01a01234-5678-7abc-8def-0123456789ab";

  if (currentProcess.startIdentity !== null) {
    const indeterminateHandoffRoot = temporaryRoot("codexrig-indeterminate-writer-handoff-");
    ensureRuntimeDirectory(indeterminateHandoffRoot);
    const deadCoordinator = { ...currentProcess, pid: definitelyStalePid };
    write(
      indeterminateHandoffRoot,
      ".codex/runtime/codexrig-session.json",
      serializeCanonicalJson({
        schemaVersion: 6,
        codexProcess: null,
        codexSessionId: null,
        phase: "launching",
        process: deadCoordinator,
        root: repositoryRuntimeRootIdentity(indeterminateHandoffRoot),
        sessionId: "10000000-0000-4000-8000-000000000004",
        startedAt: "2026-08-01T00:00:00.000Z",
        writerPhase: "handoff",
        writerProcess: deadCoordinator,
      }),
      0o600,
    );
    assert.equal(inspectRuntimeSessionLease({ root: indeterminateHandoffRoot }).status, "unknown");
    assert.throws(
      () => clearStaleRuntimeSessionLease({ root: indeterminateHandoffRoot }),
      /still active or cannot be verified as stopped/u,
    );

    const boundRoot = temporaryRoot("codexrig-bound-resume-writer-");
    ensureRuntimeDirectory(boundRoot);
    write(
      boundRoot,
      ".codex/runtime/codexrig-session.json",
      serializeCanonicalJson({
        schemaVersion: 6,
        codexProcess: currentProcess,
        codexSessionId,
        phase: "active",
        process: deadCoordinator,
        root: repositoryRuntimeRootIdentity(boundRoot),
        sessionId: "10000000-0000-4000-8000-000000000002",
        startedAt: "2026-08-01T00:00:00.000Z",
        writerPhase: "bound",
        writerProcess: currentProcess,
      }),
      0o600,
    );
    assert.equal(inspectRuntimeSessionLease({ root: boundRoot }).status, "active");

    const freshBoundRoot = temporaryRoot("codexrig-bound-fresh-writer-");
    ensureRuntimeDirectory(freshBoundRoot);
    write(
      freshBoundRoot,
      ".codex/runtime/codexrig-session.json",
      serializeCanonicalJson({
        schemaVersion: 6,
        codexProcess: currentProcess,
        codexSessionId,
        phase: "active",
        process: deadCoordinator,
        root: repositoryRuntimeRootIdentity(freshBoundRoot),
        sessionId: "10000000-0000-4000-8000-000000000003",
        startedAt: "2026-08-01T00:00:00.000Z",
        writerPhase: "bound",
        writerProcess: currentProcess,
      }),
      0o600,
    );
    assert.equal(inspectRuntimeSessionLease({ root: freshBoundRoot }).status, "active");
    write(
      freshBoundRoot,
      ".codex/runtime/codexrig-session.json",
      serializeCanonicalJson({
        ...inspectRuntimeSessionLease({ root: freshBoundRoot }).lease,
        writerProcess: null,
      }),
      0o600,
    );
    assert.throws(
      () => inspectRuntimeSessionLease({ root: freshBoundRoot }),
      /invalid or uses an unsupported schema/u,
    );
  }

  const obscuredIdentityRoot = temporaryRoot("codexrig-obscured-process-identity-");
  writeCurrentRuntimeSessionLease(
    obscuredIdentityRoot,
    definitelyStalePid,
    "01a01234-5678-7abc-8def-0123456789ab",
    "active",
    { startIdentity: null },
  );
  assert.equal(
    inspectRuntimeSessionLease({ root: obscuredIdentityRoot }).status,
    process.platform === "linux" ? "unknown" : "stale",
  );

  const portableIdentityRoot = temporaryRoot("codexrig-portable-process-identity-");
  writeCurrentRuntimeSessionLease(
    portableIdentityRoot,
    process.pid,
    "01a01234-5678-7abc-8def-0123456789ab",
  );
  assert.equal(inspectRuntimeSessionLease({ root: portableIdentityRoot }).status, "active");
  assert.equal(releaseCurrentRuntimeSession(portableIdentityRoot), true);

  const exactRoot = temporaryRoot("codexrig-exact-session-stale-");
  writeCurrentRuntimeSessionLease(exactRoot, definitelyStalePid, codexSessionId);
  assert.deepEqual(startupSessionPlan({ root: exactRoot }), {
    mode: "resume-picker",
  });
  assert.equal(startupSessionPlanToken(startupSessionPlan({ root: exactRoot })), "resume-picker");

  const interruptedLaunchRoot = temporaryRoot("codexrig-interrupted-launch-");
  writeCurrentRuntimeSessionLease(
    interruptedLaunchRoot,
    definitelyStalePid,
    codexSessionId,
    "launching",
  );
  assert.deepEqual(startupSessionPlan({ root: interruptedLaunchRoot }), {
    mode: "resume-picker",
  });

  const interruptedResumeRoot = temporaryRoot("codexrig-interrupted-resume-");
  const markerLease = issueRuntimeSessionLease({ root: interruptedResumeRoot, pid: process.pid });
  bindCurrentRuntimeSessionWriter(interruptedResumeRoot, markerLease);
  activateRuntimeSessionLease({
    root: interruptedResumeRoot,
    pid: process.pid,
    runtimeSessionId: markerLease.sessionId,
    codexSessionId,
  });
  assert.equal(releaseCurrentRuntimeSession(interruptedResumeRoot), true);
  writeCurrentRuntimeSessionLease(
    interruptedResumeRoot,
    definitelyStalePid,
    codexSessionId,
    "launching",
  );
  assert.deepEqual(startupSessionPlan({ root: interruptedResumeRoot }), {
    mode: "resume-picker",
  });
});

test("session mutation authenticates its caller and release requires terminal completion", () => {
  const root = temporaryRoot("codexrig-terminal-session-release-");
  const lease = issueRuntimeSessionLease({ root, pid: process.pid });
  bindCurrentRuntimeSessionWriter(root, lease);
  activateRuntimeSessionLease({
    root,
    pid: process.pid,
    runtimeSessionId: lease.sessionId,
    codexSessionId: "01a01234-5678-7abc-8def-0123456789ab",
  });
  assert.throws(
    () => releaseRuntimeSessionLease({ root, pid: process.pid }),
    /requires proven terminal child completion/u,
  );
  assert.equal(inspectRuntimeSessionLease({ root }).lease.writerPhase, "bound");
  assert.equal(releaseCurrentRuntimeSession(root), true);

  const callerRoot = temporaryRoot("codexrig-session-caller-");
  issueRuntimeSessionLease({ root: callerRoot, pid: process.pid });
  const leaseModule = pathToFileURL(
    path.join(repositoryRoot, "scripts/repository/runtime-session-lease.mjs"),
  ).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { releaseRuntimeSessionLease } from ${JSON.stringify(leaseModule)}; releaseRuntimeSessionLease({ root: ${JSON.stringify(callerRoot)}, pid: ${process.pid} });`,
    ],
    { cwd: callerRoot, encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /mutation must be performed by its owning process/u);
  assert.equal(inspectRuntimeSessionLease({ root: callerRoot }).status, "active");
  assert.equal(releaseCurrentRuntimeSession(callerRoot), true);
});

test("exact Codex PID binding survives SessionStart activation winning the race", () => {
  const root = attestationFixture();
  const controlPolicy = startupControlPolicies.default;
  const reservation = reserveStartupAttestation(root, process.pid, { controlPolicy });
  const transitionOptions = withRuntimeExecutables({
    controlPolicy,
    expectedAttestation: reservation.attestation,
    nonce: reservation.nonce,
  });
  bindStartupSessionWriterWithRuntime(root, process.pid, process.pid, transitionOptions);
  beginStartupSessionWriterHandoffWithRuntime(root, process.pid, transitionOptions);

  verifyStartupAttestation({
    root,
    controlPolicy,
    expectedAttestation: reservation.attestation,
    hookInput: sessionStartHookInput(root),
    nonce: reservation.nonce,
  });
  assert.equal(inspectRuntimeSessionLease({ root }).lease.phase, "active");
  assert.equal(inspectRuntimeSessionLease({ root }).lease.writerPhase, "handoff");
  bindStartupSessionCodexProcessWithRuntime(root, process.pid, process.pid, transitionOptions);
  assert.equal(inspectRuntimeSessionLease({ root }).lease.writerPhase, "bound");

  write(root, "package.json", '{"changedDuringSession":true}\n');
  completeStartupSessionWriterHandoffWithRuntime(root, process.pid, transitionOptions);
  assert.equal(inspectRuntimeSessionLease({ root }).lease.writerPhase, "completed");
  assert.equal(releaseRuntimeSessionLease({ root, pid: process.pid }), true);
});

test("terminal lease release repairs missing or invalid recovery without replacing a valid marker", () => {
  const activeSessionId = "01a01234-5678-7abc-8def-0123456789ab";
  const differentSessionId = "01a09999-5678-7abc-8def-0123456789ab";
  for (const recoveryState of ["missing", "invalid", "different-valid"]) {
    const root = temporaryRoot(`codexrig-release-recovery-${recoveryState}-`);
    const lease = issueRuntimeSessionLease({ root, pid: process.pid });
    bindCurrentRuntimeSessionWriter(root, lease);
    activateRuntimeSessionLease({
      root,
      pid: process.pid,
      runtimeSessionId: lease.sessionId,
      codexSessionId: activeSessionId,
    });
    const recoveryPath = path.join(root, ".codex/runtime/codexrig-session-recovery.json");
    if (recoveryState === "missing") rmSync(recoveryPath);
    else if (recoveryState === "invalid")
      write(root, ".codex/runtime/codexrig-session-recovery.json", "{}\n", 0o600);
    else {
      write(
        root,
        ".codex/runtime/codexrig-session-recovery.json",
        serializeCanonicalJson({
          schemaVersion: 1,
          codexSessionId: differentSessionId,
          root: repositoryRuntimeRootIdentity(root),
          updatedAt: "2026-08-18T00:00:00.000Z",
        }),
        0o600,
      );
    }

    assert.equal(releaseCurrentRuntimeSession(root), true);
    const recovery = inspectRuntimeSessionRecovery({ root });
    assert.equal(recovery.status, "present");
    assert.equal(
      recovery.recovery.codexSessionId,
      recoveryState === "different-valid" ? differentSessionId : activeSessionId,
    );
  }
});

test("native picker reservation preserves recovery evidence until authenticated selection", () => {
  const root = attestationFixture();
  const controlPolicy = startupControlPolicies.default;
  const previousId = "01a01234-5678-7abc-8def-0123456789ab";
  const selectedId = "01a09999-5678-7abc-8def-0123456789ab";
  const initial = issueRuntimeSessionLease({ root, pid: process.pid });
  bindCurrentRuntimeSessionWriter(root, initial);
  activateRuntimeSessionLease({
    root,
    pid: process.pid,
    runtimeSessionId: initial.sessionId,
    codexSessionId: previousId,
  });
  assert.equal(releaseCurrentRuntimeSession(root), true);
  const reservation = reserveStartupAttestation(root, process.pid, { controlPolicy });
  assert.deepEqual(reservation.plan, { mode: "resume-picker" });
  assert.equal(reservation.lease.codexSessionId, null);
  assert.equal(runtimeSessionLaunchState(root, process.pid), "launching");
  assert.equal(inspectRuntimeSessionRecovery({ root }).recovery.codexSessionId, previousId);
  assert.throws(
    () => reserveStartupAttestation(root, process.pid, { controlPolicy }),
    /already owns/u,
  );
  bindStartupSessionWriter(root, process.pid, process.pid, {
    controlPolicy,
    expectedAttestation: reservation.attestation,
    nonce: reservation.nonce,
  });
  const verified = verifyStartupAttestation({
    root,
    controlPolicy,
    expectedAttestation: reservation.attestation,
    nonce: reservation.nonce,
    hookInput: sessionStartHookInput(root, { session_id: selectedId, source: "resume" }),
  });
  assert.equal(verified.sessionSource, "resume");
  assert.equal(inspectRuntimeSessionLease({ root }).lease.codexSessionId, selectedId);
  assert.equal(inspectRuntimeSessionRecovery({ root }).recovery.codexSessionId, selectedId);
  assert.equal(releaseCurrentRuntimeSession(root), true);
});

test("exact recovery survives an interrupted lease activation", () => {
  const root = attestationFixture();
  const codexSessionId = "01a01234-5678-7abc-8def-0123456789ab";
  const lease = issueRuntimeSessionLease({ root, pid: process.pid });
  bindCurrentRuntimeSessionWriter(root, lease);
  assert.throws(
    () =>
      activateRuntimeSessionLease({
        root,
        pid: process.pid,
        runtimeSessionId: lease.sessionId,
        codexSessionId,
        testHooks: {
          beforeSessionLeaseActivate() {
            throw new Error("synthetic interrupted activation");
          },
        },
      }),
    /synthetic interrupted activation/u,
  );
  assert.equal(inspectRuntimeSessionLease({ root }).lease.phase, "launching");
  assert.equal(inspectRuntimeSessionRecovery({ root }).recovery.codexSessionId, codexSessionId);
  assert.equal(releaseCurrentRuntimeSession(root), true);
  assert.deepEqual(startupSessionPlan({ root }), {
    mode: "resume-picker",
  });
});

test("lease activation never overwrites a concurrently changed reservation", () => {
  const root = attestationFixture();
  const codexSessionId = "01a01234-5678-7abc-8def-0123456789ab";
  const lease = issueRuntimeSessionLease({ root, pid: process.pid });
  bindCurrentRuntimeSessionWriter(root, lease);
  const replacementSessionId = "20000000-0000-4000-8000-000000000001";
  assert.throws(
    () =>
      activateRuntimeSessionLease({
        root,
        pid: process.pid,
        runtimeSessionId: lease.sessionId,
        codexSessionId,
        testHooks: {
          beforeSessionLeaseActivate({ current }) {
            write(
              root,
              ".codex/runtime/codexrig-session.json",
              serializeCanonicalJson({ ...current.lease, sessionId: replacementSessionId }),
              0o600,
            );
          },
        },
      }),
    /lease changed before replacement/u,
  );
  const replacement = inspectRuntimeSessionLease({ root }).lease;
  assert.equal(replacement.sessionId, replacementSessionId);
  assert.equal(replacement.phase, "launching");
  assert.equal(inspectRuntimeSessionRecovery({ root }).recovery.codexSessionId, codexSessionId);
  assert.equal(releaseCurrentRuntimeSession(root), true);
});

test("invalid recovery metadata does not override native selection and is replaced after verification", () => {
  const root = temporaryRoot("codexrig-invalid-recovery-");
  ensureRuntimeDirectory(root);
  write(root, ".codex/runtime/codexrig-session-recovery.json", "{invalid\n", 0o600);
  assert.equal(inspectRuntimeSessionRecovery({ root }).status, "invalid");
  assert.deepEqual(startupSessionPlan({ root }), {
    mode: "resume-picker",
  });

  const codexSessionId = "01a01234-5678-7abc-8def-0123456789ab";
  const lease = issueRuntimeSessionLease({ root, pid: process.pid });
  bindCurrentRuntimeSessionWriter(root, lease);
  activateRuntimeSessionLease({
    root,
    pid: process.pid,
    runtimeSessionId: lease.sessionId,
    codexSessionId,
  });
  const repaired = inspectRuntimeSessionRecovery({ root });
  assert.equal(repaired.status, "present");
  assert.equal(repaired.recovery.codexSessionId, codexSessionId);
  assert.equal(releaseCurrentRuntimeSession(root), true);
});

test("a valid latest-session marker outranks a mismatched stale active lease", () => {
  const root = temporaryRoot("codexrig-newer-recovery-");
  const latestSessionId = "01a09999-5678-7abc-8def-0123456789ab";
  const staleLeaseSessionId = "01a01111-5678-7abc-8def-0123456789ab";
  const initial = issueRuntimeSessionLease({ root, pid: process.pid });
  bindCurrentRuntimeSessionWriter(root, initial);
  activateRuntimeSessionLease({
    root,
    pid: process.pid,
    runtimeSessionId: initial.sessionId,
    codexSessionId: latestSessionId,
  });
  assert.equal(releaseCurrentRuntimeSession(root), true);
  writeCurrentRuntimeSessionLease(root, definitelyStalePid, staleLeaseSessionId);

  assert.deepEqual(startupSessionPlan({ root }), {
    mode: "resume-picker",
  });
  const replacement = issueRuntimeSessionLease({
    root,
    pid: process.pid,
  });
  assert.equal(inspectRuntimeSessionRecovery({ root }).recovery.codexSessionId, latestSessionId);
  assert.equal(releaseCurrentRuntimeSession(root, replacement.process.pid), true);
});

test("startup attestation binds nonce, root, lifetime, inputs, and tool versions", () => {
  const root = attestationFixture();
  const now = 1_000_000;
  const controlPolicy = startupControlPolicies.default;
  issueRuntimeSessionLease({ root, pid: process.pid });
  const issued = issueStartupAttestation({ root, now: () => now, controlPolicy });
  bindStartupSessionWriter(root, process.pid, process.pid, {
    controlPolicy,
    expectedAttestation: issued.attestation,
    nonce: issued.nonce,
    now: () => now + 1,
  });
  const codexSessionId = "01a01234-5678-7abc-8def-0123456789ab";
  const hookInput = sessionStartHookInput(root, { session_id: codexSessionId });
  const { cwd: _cwd, ...missingRoot } = hookInput;
  for (const [candidate, expected] of [
    [missingRoot, /session root is missing or invalid/u],
    [{ ...hookInput, model: "gpt-5.6-terra" }, /effective model differs/u],
    [{ ...hookInput, permission_mode: "bypassPermissions" }, /permission mode differs/u],
  ]) {
    assert.throws(
      () =>
        verifyStartupAttestation({
          root,
          hookInput: candidate,
          nonce: issued.nonce,
          now: () => now + 1,
          controlPolicy,
        }),
      expected,
    );
  }
  const verified = verifyStartupAttestation({
    root,
    hookInput,
    nonce: issued.nonce,
    now: () => now + 1,
    controlPolicy,
  });
  assert.equal(verified.schemaVersion, 7);
  assert.equal(verified.sessionSource, "startup");
  const startupContext = sessionStartSuccess(verified, { root, now: () => now + 1 })
    .hookSpecificOutput.additionalContext;
  assert.ok(Buffer.byteLength(startupContext, "utf8") <= 768);
  assert.match(startupContext, /Startup Repository Reconstruction/u);
  assert.match(startupContext, /worktree:status/u);
  assert.equal(
    verified.frameworkVersion,
    JSON.parse(readFileSync(path.join(repositoryRoot, ".codex/tooling.json"), "utf8")).protocol
      .version,
  );
  assert.equal(inspectRuntimeSessionLease({ root }).lease.codexSessionId, codexSessionId);
  assert.equal(inspectRuntimeSessionLease({ root }).lease.phase, "active");
  assert.equal(inspectRuntimeSessionRecovery({ root }).recovery.codexSessionId, codexSessionId);
  const statePath = path.join(root, ".codex/runtime/cache/codexrig/startup-attestation.json");
  assert.equal(statSync(statePath).mode & 0o777, 0o600);
  assert.equal(readFileSync(statePath, "utf8").includes(issued.nonce), false);
  const attestationContent = readFileSync(statePath, "utf8");
  writeFileSync(
    statePath,
    serializeCanonicalJson({ ...JSON.parse(attestationContent), unsupportedField: true }),
    "utf8",
  );
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        hookInput,
        nonce: issued.nonce,
        now: () => now + 1,
        controlPolicy,
      }),
    /attestation schema is unsupported/u,
  );
  writeFileSync(statePath, attestationContent, "utf8");
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        hookInput,
        nonce: "x".repeat(43),
        now: () => now + 1,
        controlPolicy,
      }),
    /does not match/,
  );
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        hookInput,
        nonce: issued.nonce,
        now: () => now + 1,
        controlPolicy: startupControlPolicies.noAltScreen,
      }),
    /control arguments differ/,
  );
  write(root, "package.json", "{}\n");
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        hookInput,
        nonce: issued.nonce,
        now: () => now + 1,
        controlPolicy,
      }),
    /startup-critical input changed/,
  );
});

test("startup attestation accepts only the YOLO permission mode for a YOLO launch", () => {
  const root = attestationFixture();
  const controlPolicy = startupControlPolicies.yolo;
  issueRuntimeSessionLease({ root, pid: process.pid });
  const issued = issueStartupAttestation({ root, controlPolicy });
  bindStartupSessionWriter(root, process.pid, process.pid, {
    controlPolicy,
    expectedAttestation: issued.attestation,
    nonce: issued.nonce,
  });
  const verified = verifyStartupAttestation({
    root,
    hookInput: sessionStartHookInput(root, { permission_mode: "bypassPermissions" }),
    nonce: issued.nonce,
    controlPolicy,
  });
  assert.equal(verified.permissionMode, "bypassPermissions");
  assert.equal(verified.model, "gpt-6-astra");
  assert.equal(releaseCurrentRuntimeSession(root), true);
});

test("picker attestation binds one authenticated session and rejects later identity changes", () => {
  const root = attestationFixture();
  const controlPolicy = startupControlPolicies.default;
  issueRuntimeSessionLease({ root, pid: process.pid });
  const issued = issueStartupAttestation({ root, controlPolicy });
  bindStartupSessionWriter(root, process.pid, process.pid, { controlPolicy, nonce: issued.nonce });
  const selectedId = "01a01234-5678-7abc-8def-0123456789ab";
  verifyStartupAttestation({
    root,
    controlPolicy,
    nonce: issued.nonce,
    hookInput: sessionStartHookInput(root, { session_id: selectedId, source: "resume" }),
  });
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        controlPolicy,
        nonce: issued.nonce,
        hookInput: sessionStartHookInput(root, {
          session_id: "01b01234-5678-7abc-8def-0123456789ab",
          source: "resume",
        }),
      }),
    /already bound to a different/u,
  );
  assert.equal(inspectRuntimeSessionLease({ root }).lease.codexSessionId, selectedId);
  assert.equal(releaseCurrentRuntimeSession(root), true);
});

test("startup attestation rejects expired launcher state", () => {
  const root = attestationFixture();
  const controlPolicy = startupControlPolicies.default;
  issueRuntimeSessionLease({ root, pid: process.pid });
  const issued = issueStartupAttestation({
    root,
    now: () => 1_000_000,
    controlPolicy,
  });
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        hookInput: sessionStartHookInput(root, {
          source: "resume",
        }),
        nonce: issued.nonce,
        now: () => 2_801_000,
        controlPolicy,
      }),
    /stale/,
  );
});

test("startup attestation rejects a missing runtime session lease", () => {
  const root = attestationFixture();
  const now = 1_000_000;
  const controlPolicy = startupControlPolicies.default;
  issueRuntimeSessionLease({ root, pid: process.pid });
  const issued = issueStartupAttestation({ root, now: () => now, controlPolicy });
  releaseCurrentRuntimeSession(root);
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        hookInput: sessionStartHookInput(root),
        nonce: issued.nonce,
        now: () => now + 1,
        controlPolicy,
      }),
    /runtime session lease is missing or inactive/,
  );
});
