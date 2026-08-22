/** Verifies context lifecycle behavior for the repository-local semantic context boundary. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
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
  embeddingRuntimeIdentity,
  inspectModelArtifacts,
  modelRevisionDirectory,
  requiredModelArtifactPaths,
} from "./context-embedding.mjs";
import { createManifest } from "./context-manifest.mjs";
import { ensureOwnedIndexDirectory } from "./context-paths.mjs";
import {
  createCriticalBudgetHandover,
  criticalHandoverMaxAgeMilliseconds,
  discoverRecentCriticalBudgetHandover,
} from "./critical-budget-handover.mjs";
import { evaluateAutonomousContinuation, runStopLifecycle } from "./session-stop-lifecycle.mjs";
import { runSearch } from "./search-context.mjs";
import { discoverSourceFiles } from "./source-policy.mjs";
import { publishIndex } from "./context-storage.mjs";
import {
  sessionStartAdditionalContextMaximumBytes,
  sessionStartSuccess,
} from "../setup/startup-session-context.mjs";
import {
  repositoryRoot,
  storageRecord,
  temporaryDirectory,
  write,
} from "./context-regression-helpers.mjs";

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
      schemaVersion: 5,
      codexProcess: processIdentity,
      codexSessionId,
      phase: "active",
      process: processIdentity,
      resumeSessionId: codexSessionId,
      root: repositoryRuntimeRootIdentity(projectRoot),
      sessionId: runtimeSessionId,
      sessionSource: "resume",
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

test("preloaded Stop lifecycle preserves continuation and terminal handover without an index", async () => {
  const project = temporaryDirectory("context-stop-lifecycle-");
  copyFrameworkContract(project);
  mkdirSync(path.join(project, ".codex"));
  writeWorkingContext(project, workState());

  assert.equal(existsSync(path.join(project, ".context-index")), false);
  const activeOutput = await runStopLifecycle({ root: project, hookInput: stopHookInput() });
  assert.equal(activeOutput.decision, "block");
  assert.match(activeOutput.reason, /Continue the already-authorized outcome autonomously/u);
  assert.equal(existsSync(path.join(project, ".context-index")), false);

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
  assert.equal(existsSync(path.join(project, ".context-index")), false);
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

function environmentSnapshot(names) {
  return new Map(names.map((name) => [name, process.env[name]]));
}

function restoreEnvironment(snapshot) {
  for (const [name, value] of snapshot) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function treeSnapshot(root) {
  const snapshot = [];
  const pending = [{ absolutePath: root, relativePath: "" }];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current.absolutePath, { withFileTypes: true })) {
      const relativePath = current.relativePath
        ? `${current.relativePath}/${entry.name}`
        : entry.name;
      const absolutePath = path.join(current.absolutePath, entry.name);
      const stats = lstatSync(absolutePath, { bigint: true });
      const record = {
        path: relativePath,
        type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
        bytes: stats.size.toString(),
        modified: stats.mtimeNs.toString(),
        changed: stats.ctimeNs.toString(),
      };
      if (entry.isDirectory()) pending.push({ absolutePath, relativePath });
      else if (entry.isFile()) {
        record.hash = createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
      }
      snapshot.push(record);
    }
  }
  return snapshot.sort((left, right) => left.path.localeCompare(right.path));
}

async function currentIndexFixture() {
  const root = temporaryDirectory("context-read-only-status-");
  execFileSync("git", ["init", "-q"], { cwd: root });
  write(root, "README.md", "# Read-only status fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  const indexDirectory = path.join(root, ".context-index");
  const databasePath = path.join(indexDirectory, "lancedb");
  const manifestPath = path.join(indexDirectory, "manifest.json");
  const modelCachePath = path.join(indexDirectory, "model-cache");
  ensureOwnedIndexDirectory({ repositoryRoot: root, indexDirectory });
  const selectedModelDirectory = modelRevisionDirectory(modelCachePath);
  for (const artifactPath of requiredModelArtifactPaths) {
    write(selectedModelDirectory, artifactPath, `fixture ${artifactPath}\n`);
  }
  const discovered = discoverSourceFiles({ repositoryRoot: root });
  const [{ content: _content, ...sourceFile }] = discovered.files;
  const chunk = { id: "status-fixture-chunk", embeddingHash: "a".repeat(64) };
  const files = [{ ...sourceFile, headings: [], symbols: [], imports: [], chunks: [chunk] }];
  const manifest = createManifest({
    files,
    skippedFiles: discovered.skipped,
    excludedFiles: discovered.excluded,
    chunks: [chunk],
    modelArtifacts: inspectModelArtifacts(modelCachePath, { includeHash: true }),
    runtimeIdentity: embeddingRuntimeIdentity(),
    sourceMode: discovered.sourceMode,
    buildStats: {
      reusedChunks: 0,
      embeddedChunks: 1,
      embeddedVectors: 1,
      addedFiles: 1,
      changedFiles: 0,
      removedFiles: 0,
      processedFiles: 1,
      databaseModificationOperations: 0,
    },
    databasePath: ".context-index/lancedb",
    tableName: "context_chunks",
  });
  await publishIndex({
    indexDirectory,
    databasePath,
    manifestPath,
    tableName: "context_chunks",
    records: [
      {
        ...storageRecord(0, "Read-only status fixture", sourceFile.path),
        id: chunk.id,
        contentHash: sourceFile.hash,
        embeddingHash: chunk.embeddingHash,
      },
    ],
    manifest,
  });
  return { databasePath, indexDirectory, manifestPath, root };
}

test("high-level semantic search performs maintenance before its bounded query", async () => {
  const root = temporaryDirectory("context-search-maintenance-");
  const indexDirectory = path.join(root, ".context-index");
  ensureOwnedIndexDirectory({ repositoryRoot: root, indexDirectory });
  mkdirSync(path.join(indexDirectory, "lancedb", "context_chunks.lance"), { recursive: true });
  const staleCandidate = path.join(indexDirectory, "manifest.next-49.json");
  writeFileSync(staleCandidate, "stale candidate\n");
  const environment = environmentSnapshot([
    "CONTEXT_INDEX_DIRECTORY",
    "CONTEXT_INDEX_ROOT",
    "CONTEXT_INDEX_TEST_MODE",
  ]);
  process.env.CONTEXT_INDEX_TEST_MODE = "1";
  process.env.CONTEXT_INDEX_ROOT = root;
  process.env.CONTEXT_INDEX_DIRECTORY = indexDirectory;
  try {
    const libraryUrl = new URL("./context-index-lib.mjs", import.meta.url);
    libraryUrl.searchParams.set("fixture", `${Date.now()}-${Math.random()}`);
    const library = await import(libraryUrl.href);
    const row = {
      id: "maintenance-result",
      path: "docs/maintenance.md",
      startLine: 1,
      endLine: 2,
      text: "Maintenance runs before semantic retrieval.",
      headingsText: "Maintenance",
      symbolsText: "",
      importsText: "",
      _distance: 0.1,
    };
    const results = await library.searchIndex("maintenance retrieval", {
      limit: 1,
      embedQuery: async () => [[1, 0, 0]],
      querySelectedDatabase: async () => {
        assert.equal(existsSync(staleCandidate), false);
        return { denseResults: [row], allRows: [row] };
      },
    });
    assert.equal(results[0].path, row.path);
    assert.equal(existsSync(staleCandidate), false);
    assert.equal(existsSync(path.join(indexDirectory, "model-cache")), false);
  } finally {
    restoreEnvironment(environment);
  }
});

test("search command reports one sanitized maintenance summary and preserves results", async () => {
  const output = [];
  const originalLog = console.log;
  console.log = (...values) => output.push(values.join(" "));
  try {
    const row = { id: "result", path: "docs/result.md", text: "result" };
    const result = await runSearch(
      { query: "bounded result", limit: 1, retry: true },
      {
        describeBuildStats: () => "unused",
        describeFreshness: () => "current",
        describeMaintenance: () => "removed 1 validated stale artifact(s)",
        ensureFreshIndex: async () => ({
          manifest: {},
          freshness: { fresh: true },
          initialFreshness: { reason: "current" },
          rebuilt: false,
          maintenance: { removedManifestGenerations: 1 },
        }),
        forceRepairIndex: () => assert.fail("fresh search must not repair"),
        maintenanceChanged: () => true,
        searchIndex: async (_query, options) => {
          assert.equal(options.maintenance, false);
          return [row];
        },
      },
    );
    assert.deepEqual(result.results, [row]);
    assert.deepEqual(output, ["Context index maintenance: removed 1 validated stale artifact(s)"]);
  } finally {
    console.log = originalLog;
  }
});

test("search never downgrades a database path safety failure to corruption repair", async () => {
  /** Models the database safety error contract without importing the production implementation. */
  class FixtureDatabaseSafetyError extends Error {}
  const failure = new FixtureDatabaseSafetyError("unsafe selected database path");
  await assert.rejects(
    runSearch(
      { query: "safe boundary", limit: 1, retry: true },
      {
        ContextDatabaseSafetyError: FixtureDatabaseSafetyError,
        ensureFreshIndex: async () => ({
          manifest: { stats: { chunks: 1 } },
          freshness: { fresh: true },
          rebuilt: false,
          maintenance: {},
        }),
        searchIndex: async () => {
          throw failure;
        },
        forceRepairIndex: () => assert.fail("safety errors must not trigger database repair"),
        maintenanceChanged: () => false,
      },
    ),
    (error) => error === failure,
  );
});

test("context check preserves a valid database and transaction journal", async () => {
  const fixture = await currentIndexFixture();
  const lancedb = await import("@lancedb/lancedb");
  let database = await lancedb.connect(fixture.databasePath);
  let table = await database.openTable("context_chunks");
  const selectedVersion = await table.version();
  await database.close();
  const journalPath = path.join(fixture.indexDirectory, "database-transaction.json");
  write(
    fixture.indexDirectory,
    "database-transaction.json",
    `${JSON.stringify({
      version: 1,
      beforeVersion: selectedVersion,
      targetManifestHash: "f".repeat(64),
      createdAt: new Date().toISOString(),
    })}\n`,
  );
  const beforeTree = treeSnapshot(fixture.indexDirectory);
  const beforeManifest = readFileSync(fixture.manifestPath);
  const beforeJournal = readFileSync(journalPath);
  const checkScript = path.join(repositoryRoot, "scripts/context/check-context-index.mjs");
  const result = spawnSync(process.execPath, [checkScript], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      CONTEXT_INDEX_TEST_MODE: "1",
      CONTEXT_INDEX_ROOT: fixture.root,
      CONTEXT_INDEX_DIRECTORY: fixture.indexDirectory,
    },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /interrupted context index state requires maintenance/);
  assert.deepEqual(readFileSync(fixture.manifestPath), beforeManifest);
  assert.deepEqual(readFileSync(journalPath), beforeJournal);
  assert.deepEqual(treeSnapshot(fixture.indexDirectory), beforeTree);
  assert.equal(existsSync(path.join(fixture.root, ".codex", "runtime")), false);
  database = await lancedb.connect(fixture.databasePath);
  table = await database.openTable("context_chunks");
  assert.equal(await table.version(), selectedVersion);
  await database.close();
});
