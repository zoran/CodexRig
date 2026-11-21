#!/usr/bin/env node
/** Owns repository-bound terminal and account-pause handovers, full receipt and exact-file acknowledgement. */
import { randomBytes } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readToolingConfiguration } from "../contracts/tooling-configuration.mjs";
import { toolingRoot, sha256 } from "../filesystem/repository-files.mjs";
import {
  closeOwnedDirectoryBinding,
  createExclusiveOwnedFile,
  ensureOwnedPrivateDirectory,
  listOwnedDirectory,
  openPrivateOwnedDirectory,
  readStableOwnedFile,
  removeStableOwnedFile,
  sameStableIdentity,
  validateOwnedDirectoryBinding,
} from "../filesystem/owned-path-safety.mjs";
import { inspectRuntimeSessionLease } from "../repository/runtime-session-lease.mjs";
import { withRuntimeLifecycleUpdateMutex } from "../repository/runtime-lifecycle-mutex.mjs";
import {
  accountPauseFilename,
  assertPauseWorkState,
  armAccountPause,
  disarmAcknowledgedPause,
  hasArmedAccountPause,
  renderAccountPausePrompt,
  recordedAccountPauseSequence,
  acknowledgedPauseSequence,
  markPauseAcknowledgement,
  pauseFilenamePattern,
} from "./account-pause-state.mjs";
import { findSecretMatches } from "../security/secret-patterns.mjs";
import { readProjectWorkContext, workContextResumeBoundary } from "./project-work-state.mjs";

export const criticalHandoverDirectory = "tmp/codexrig-handovers";
export const criticalHandoverMaxAgeMilliseconds = 72 * 60 * 60 * 1_000;

const handoverMaxBytes = 128 * 1_024;
const clockSkewMilliseconds = 5 * 60 * 1_000;
const candidateLimit = 128;
const markerPattern = /^<!-- codexrig-(critical-budget|account-pause)-handover\n([^\r\n]+)\n-->\n/u;
const filenamePattern = /^critical-budget-\d{8}T\d{9}Z-[a-f0-9]{12}\.prompt\.md$/u;
const snapshotBegin = "----- BEGIN VERBATIM docs/project-context.md SNAPSHOT -----";
const snapshotEnd = "----- END VERBATIM docs/project-context.md SNAPSHOT -----";
const requiredDrainLines = Object.freeze([
  "## Critical Budget Drain",
  "- Owned subagents: none live; all handoffs are accepted or recorded.",
  "- Owned background tasks: none live; queued work is cancelled and atomic sections are complete.",
  "- Foreign agents and tasks: not contacted, interrupted, or changed.",
]);

function canonicalRoot(root) {
  const canonical = realpathSync.native(root);
  const stats = statSync(canonical, { bigint: true });
  if (!stats.isDirectory()) throw new Error("Handover root must be a real repository directory.");
  return { canonical, stats };
}

function repositoryBinding(root) {
  const { canonical, stats } = canonicalRoot(root);
  return sha256(
    JSON.stringify({ device: String(stats.dev), inode: String(stats.ino), path: canonical }),
  );
}

function handoverStore(root, { create = false, testHooks } = {}) {
  const { canonical } = canonicalRoot(root);
  const directory = path.join(canonical, ...criticalHandoverDirectory.split("/"));
  const handoverRoot = path.dirname(directory);
  if (!existsSync(handoverRoot) && !create) return null;
  if (create) {
    try {
      ensureOwnedPrivateDirectory(canonical, handoverRoot, "critical-budget handover root", {
        repairMode: false,
        testHooks,
      });
    } catch {
      throw new Error("Critical-budget handover storage is unsafe.");
    }
  }
  if (!existsSync(directory) && !create) return null;
  if (create) {
    try {
      ensureOwnedPrivateDirectory(canonical, directory, "critical-budget handover directory", {
        repairMode: false,
        testHooks,
      });
    } catch {
      throw new Error("Critical-budget handover storage is unsafe.");
    }
  }
  try {
    return openPrivateOwnedDirectory(canonical, directory, "critical-budget handover directory");
  } catch {
    throw new Error("Critical-budget handover storage is unsafe.");
  }
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function readOwnedPrompt(store, filename) {
  const snapshot = readStableOwnedFile(store, filename, "critical-budget handover prompt", {
    maximumBytes: handoverMaxBytes,
  });
  const { stats: initial } = snapshot;
  if (
    !initial.isFile() ||
    initial.nlink !== 1 ||
    (initial.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && initial.uid !== process.getuid())
  ) {
    throw new Error("Critical-budget handover prompt is unsafe.");
  }
  return { content: snapshot.buffer.toString("utf8"), stats: initial };
}

function canonicalMetadata(metadata) {
  return {
    schemaVersion: metadata.schemaVersion,
    budgetCategory: metadata.budgetCategory,
    createdAt: metadata.createdAt,
    frameworkVersion: metadata.frameworkVersion,
    repositoryBinding: metadata.repositoryBinding,
    sealingSessionId: metadata.sealingSessionId,
    workStateRevision: metadata.workStateRevision,
    workStateSha256: metadata.workStateSha256,
    ...(metadata.budgetCategory === "account-pause"
      ? { pauseSequence: metadata.pauseSequence }
      : {}),
  };
}

function parsedHandover(content) {
  const match = markerPattern.exec(content);
  if (!match) throw new Error("Critical-budget handover marker is missing.");
  let metadata;
  try {
    metadata = JSON.parse(match[2]);
  } catch {
    throw new Error("Critical-budget handover marker is invalid.");
  }
  const pause = match[1] === "account-pause";
  if (
    !exactKeys(metadata, [
      "budgetCategory",
      "createdAt",
      "frameworkVersion",
      "repositoryBinding",
      "schemaVersion",
      "sealingSessionId",
      "workStateRevision",
      "workStateSha256",
      ...(pause ? ["pauseSequence"] : []),
    ]) ||
    metadata.schemaVersion !== (pause ? 1 : 2) ||
    metadata.budgetCategory !== (pause ? "account-pause" : "critical") ||
    (pause && (!Number.isSafeInteger(metadata.pauseSequence) || metadata.pauseSequence < 1)) ||
    typeof metadata.frameworkVersion !== "string" ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(metadata.frameworkVersion) ||
    typeof metadata.repositoryBinding !== "string" ||
    !/^[a-f0-9]{64}$/u.test(metadata.repositoryBinding) ||
    typeof metadata.sealingSessionId !== "string" ||
    !/^[a-f0-9-]{36}$/u.test(metadata.sealingSessionId) ||
    !Number.isSafeInteger(metadata.workStateRevision) ||
    metadata.workStateRevision < 1 ||
    typeof metadata.workStateSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(metadata.workStateSha256)
  ) {
    throw new Error("Critical-budget handover metadata is invalid.");
  }
  const createdAt = Date.parse(metadata.createdAt);
  if (!Number.isFinite(createdAt) || new Date(createdAt).toISOString() !== metadata.createdAt) {
    throw new Error("Critical-budget handover timestamp is invalid.");
  }
  const header = pause
    ? "# Account-Window Pause Handover Prompt"
    : "# Critical-Budget Cross-Account Handover Prompt";
  if (!content.startsWith(`${match[0]}${header}\n`)) {
    throw new Error("Critical-budget handover prompt header is invalid.");
  }
  const beginToken = `${snapshotBegin}\n`;
  const endToken = `\n${snapshotEnd}\n`;
  if (
    content.split(snapshotBegin).length !== 2 ||
    content.split(snapshotEnd).length !== 2 ||
    !content.includes(beginToken) ||
    !content.includes(endToken)
  ) {
    throw new Error("Critical-budget handover snapshot boundary is invalid.");
  }
  const snapshotStart = content.indexOf(beginToken) + beginToken.length;
  const snapshotEndIndex = content.indexOf(endToken, snapshotStart);
  if (snapshotEndIndex < snapshotStart) {
    throw new Error("Critical-budget handover snapshot boundary is invalid.");
  }
  const context = content.slice(snapshotStart, snapshotEndIndex);
  if (sha256(context) !== metadata.workStateSha256) {
    throw new Error("Critical-budget handover snapshot integrity is invalid.");
  }
  if (pause) assertPauseWorkState(context, metadata.workStateRevision);
  const normalizedMetadata = canonicalMetadata(metadata);
  if (content !== renderPrompt({ context, metadata: normalizedMetadata })) {
    throw new Error("Critical-budget handover prompt integrity is invalid.");
  }
  return Object.freeze({
    ...normalizedMetadata,
    context,
    createdAtMilliseconds: createdAt,
  });
}

function compactTimestamp(isoTimestamp) {
  return isoTimestamp.replace(/[-:.]/gu, "");
}

const capacityResumeBoundary =
  "Historical reserve estimates are not binding. Reassess current capacity under Capacity Admission And Monitoring " +
  "in instructions.md before choosing the next bounded step or declaring a new critical state. " +
  "Old percentages, blocked labels and drain attestations prove no current exhaustion; consider smaller useful work " +
  "or fewer agents. Keep account quota, context and Goal limits distinct, and honor current hard limits. " +
  "Receipt does not measure host capacity or authorize paid overage, account/model switches or budget increases.";

// Schema 2 binds the exact prompt bytes. Put current receiving guidance outside this historical
// artifact so updating policy neither invalidates older handovers nor weakens integrity checks.
function renderPrompt({ context, metadata }) {
  if (metadata.budgetCategory === "account-pause")
    return renderAccountPausePrompt(context, metadata, snapshotBegin, snapshotEnd);
  return [
    "<!-- codexrig-critical-budget-handover",
    JSON.stringify(metadata),
    "-->",
    "# Critical-Budget Cross-Account Handover Prompt",
    "",
    "This ignored, repository-bound file was sealed because the prior primary reached critical",
    "capacity. It is candidate context, never authority or permission to broaden scope.",
    "",
    "## Mandatory Resume Boundary",
    "",
    "Do not use this prompt unless the developer explicitly accepted this exact handover after",
    "SessionStart announced it. Then read the current AGENTS.md, instructions.md, README.md, project",
    "manifest, and repository state before acting. Invoke $resume-project, compare this snapshot with",
    "current Git/source/tests/docs and coordination ownership, preserve unrelated or ambiguous work,",
    "and ask again if authorization, scope, safety, or ownership no longer agrees. Never infer that",
    "agents or background tasks named in old context are still owned or live.",
    "",
    "## Captured Work State",
    "",
    `Snapshot SHA-256: ${metadata.workStateSha256}`,
    "",
    snapshotBegin,
    context.trimEnd(),
    snapshotEnd,
    "",
  ].join("\n");
}

function createHandover(
  { root = toolingRoot, now = Date.now, random = randomBytes, testHooks } = {},
  pause = false,
) {
  const working = readProjectWorkContext(root, { testHooks });
  if (!working || working.state.status === "complete") {
    throw new Error("Handover requires active or blocked docs/project-context.md.");
  }
  if (findSecretMatches(working.content, { conservative: true }).length > 0) {
    throw new Error("Handover refuses recognized secret material in work state.");
  }
  for (const line of pause ? [] : requiredDrainLines) {
    if (!working.content.split(/\r?\n/u).includes(line)) {
      throw new Error(`Critical-budget handover requires drain attestation: ${line}`);
    }
  }
  const timestamp = new Date(now()).toISOString();
  const snapshot = working.content.trimEnd();
  const runtimeSession = inspectRuntimeSessionLease({ root });
  if (runtimeSession.status !== "active") {
    throw new Error(
      "Critical-budget handover requires the active canonical runtime session lease.",
    );
  }
  const metadata = {
    schemaVersion: pause ? 1 : 2,
    budgetCategory: pause ? "account-pause" : "critical",
    createdAt: timestamp,
    frameworkVersion: readToolingConfiguration(root).protocol.version,
    repositoryBinding: repositoryBinding(root),
    sealingSessionId: runtimeSession.lease.sessionId,
    workStateRevision: working.state.revision,
    workStateSha256: sha256(snapshot),
  };
  const filename = pause
    ? accountPauseFilename(metadata)
    : `critical-budget-${compactTimestamp(timestamp)}-${random(6).toString("hex")}.prompt.md`;
  const store = handoverStore(root, { create: true, testHooks });
  let created;
  try {
    if (pause) {
      if (
        runtimeSession.lease.phase !== "active" ||
        hasCriticalBudgetHandoverForSession({ root, sealingSessionId: metadata.sealingSessionId })
      )
        throw new Error("Account pause requires an active, unsealed canonical runtime session.");
      const names = listOwnedDirectory(store, "account pause inventory").filter((name) =>
        pauseFilenamePattern.test(name),
      );
      if (names.includes(filename)) {
        const prior = parsedHandover(readOwnedPrompt(store, filename).content);
        if (
          prior.budgetCategory !== "account-pause" ||
          accountPauseFilename(prior) !== filename ||
          prior.repositoryBinding !== metadata.repositoryBinding ||
          prior.workStateSha256 !== metadata.workStateSha256
        )
          throw new Error(
            "The account pause for this work-state revision differs. Reconcile the current revision.",
          );
        if (
          prior.pauseSequence <= acknowledgedPauseSequence(root, store, metadata.repositoryBinding)
        )
          throw new Error(
            "This account pause was superseded. Reconcile the current work-state revision.",
          );
        armAccountPause(root, prior, filename);
        return handoverResult(filename, prior);
      }
      if (names.length >= candidateLimit)
        throw new Error("Account pause storage is full. Review and acknowledge prior handovers.");
      const prior = [
        ...repositoryHandovers({ root, pause: true, maximumCandidates: candidateLimit }),
      ];
      metadata.pauseSequence =
        1 +
        Math.max(
          acknowledgedPauseSequence(root, store, metadata.repositoryBinding),
          recordedAccountPauseSequence(root, metadata.repositoryBinding),
          ...prior.map((entry) => entry.metadata.pauseSequence),
        );
    }
    const content = renderPrompt({ context: snapshot, metadata });
    testHooks?.beforeHandoverPublish?.({ filename, store });
    validateOwnedDirectoryBinding(store, "critical-budget handover directory");
    created = createExclusiveOwnedFile(
      store,
      filename,
      content,
      "critical-budget handover prompt",
      0o600,
    );
    let verified;
    try {
      const published = readOwnedPrompt(store, filename);
      verified = parsedHandover(published.content);
      if (
        verified.repositoryBinding !== metadata.repositoryBinding ||
        verified.sealingSessionId !== metadata.sealingSessionId ||
        verified.workStateRevision !== metadata.workStateRevision ||
        verified.workStateSha256 !== metadata.workStateSha256
      ) {
        throw new Error("Critical-budget handover verification failed.");
      }
    } catch (error) {
      removeStableOwnedFile(store, filename, created, "invalid critical-budget handover prompt");
      throw error;
    }
  } finally {
    closeOwnedDirectoryBinding(store);
  }
  if (pause) armAccountPause(root, metadata, filename);
  return handoverResult(filename, metadata);
}

function handoverResult(filename, metadata) {
  return Object.freeze({
    createdAt: metadata.createdAt,
    relativePath: `${criticalHandoverDirectory}/${filename}`,
    sealingSessionId: metadata.sealingSessionId,
    workStateRevision: metadata.workStateRevision,
  });
}

export function createCriticalBudgetHandover(options = {}) {
  return createHandover(options);
}

export function createAccountPauseHandover(options = {}) {
  return withRuntimeLifecycleUpdateMutex(options.root ?? toolingRoot, () =>
    createHandover(options, true),
  );
}

function* repositoryHandovers({ root, testHooks, maximumCandidates = Infinity, pause = false }) {
  let store;
  try {
    store = handoverStore(root, { testHooks });
  } catch {
    return;
  }
  if (!store) return;
  try {
    const binding = repositoryBinding(root);
    testHooks?.beforeHandoverDiscovery?.({ store });
    for (const filename of listOwnedDirectory(store, "critical-budget handover directory")
      .filter((name) => (pause ? pauseFilenamePattern : filenamePattern).test(name))
      .sort()
      .slice(-maximumCandidates)) {
      let metadata;
      try {
        metadata = parsedHandover(readOwnedPrompt(store, filename).content);
      } catch {
        // Invalid, unsafe, or partially written files prove neither context nor a terminal seal.
        continue;
      }
      if (
        metadata.repositoryBinding === binding &&
        (pause
          ? metadata.budgetCategory === "account-pause" &&
            accountPauseFilename(metadata) === filename
          : metadata.budgetCategory === "critical")
      )
        yield { filename, metadata };
    }
  } finally {
    closeOwnedDirectoryBinding(store);
  }
}

/** Terminal evidence belongs to the exact runtime session, independent of startup recency. */
export function hasCriticalBudgetHandoverForSession({
  root = toolingRoot,
  sealingSessionId,
  testHooks,
} = {}) {
  for (const { metadata } of repositoryHandovers({ root, testHooks })) {
    if (metadata.sealingSessionId === sealingSessionId) return true;
  }
  return false;
}

export function discoverRecentCriticalBudgetHandover({
  root = toolingRoot,
  now = Date.now,
  testHooks,
} = {}) {
  const currentTime = now();
  const candidates = [];
  for (const candidate of repositoryHandovers({
    root,
    testHooks,
    maximumCandidates: candidateLimit,
  })) {
    const age = currentTime - candidate.metadata.createdAtMilliseconds;
    if (age >= -clockSkewMilliseconds && age <= criticalHandoverMaxAgeMilliseconds) {
      candidates.push(candidate);
    }
  }
  candidates.sort(
    (left, right) =>
      right.metadata.createdAtMilliseconds - left.metadata.createdAtMilliseconds ||
      right.filename.localeCompare(left.filename, "en"),
  );
  const selected = candidates[0];
  return selected ? handoverResult(selected.filename, selected.metadata) : null;
}

function pendingPauses(root, testHooks) {
  const store = handoverStore(root, { testHooks });
  if (!store) return [];
  try {
    const through = acknowledgedPauseSequence(root, store, repositoryBinding(root));
    return [
      ...repositoryHandovers({ root, testHooks, maximumCandidates: candidateLimit, pause: true }),
    ]
      .filter(({ metadata }) => metadata.pauseSequence > through)
      .sort((a, b) => b.metadata.pauseSequence - a.metadata.pauseSequence);
  } finally {
    closeOwnedDirectoryBinding(store);
  }
}

export function hasPendingAccountPause({ root = toolingRoot, testHooks } = {}) {
  const store = handoverStore(root, { testHooks });
  try {
    return (
      hasArmedAccountPause(root, repositoryBinding(root), store) ||
      pendingPauses(root, testHooks).length > 0
    );
  } finally {
    if (store) closeOwnedDirectoryBinding(store);
  }
}

export function discoverRecentHandover({ root = toolingRoot, now = Date.now, testHooks } = {}) {
  const currentTime = now();
  const critical = discoverRecentCriticalBudgetHandover({
    root,
    now: () => currentTime,
    testHooks,
  });
  let pause;
  try {
    pause = pendingPauses(root, testHooks).find(({ metadata }) => {
      const age = currentTime - metadata.createdAtMilliseconds;
      return age >= -clockSkewMilliseconds && age <= criticalHandoverMaxAgeMilliseconds;
    });
  } catch {
    /* Unsafe storage offers no candidate context at startup. Stop checks its durable pause independently. */
  }
  if (pause && (!critical || pause.metadata.createdAtMilliseconds > Date.parse(critical.createdAt)))
    return { ...handoverResult(pause.filename, pause.metadata), mode: "pause" };
  return critical ? { ...critical, mode: "critical" } : null;
}

function receivingSession(root, metadata) {
  const session = inspectRuntimeSessionLease({ root });
  if (
    session.status !== "active" ||
    session.lease.phase !== "active" ||
    (metadata.budgetCategory === "critical" &&
      session.lease.sessionId === metadata.sealingSessionId)
  ) {
    throw new Error("Handover receipt requires a later active canonical session.");
  }
  if (
    metadata.budgetCategory === "account-pause" &&
    hasCriticalBudgetHandoverForSession({ root, sealingSessionId: session.lease.sessionId })
  )
    throw new Error(
      "The sealed runtime must stop completely. Select this handover in a later active session.",
    );
  return session.lease.sessionId;
}

function withReceivingPrompt({ root, relativePath, testHooks }, consume) {
  if (
    typeof relativePath !== "string" ||
    !relativePath.startsWith(`${criticalHandoverDirectory}/`) ||
    relativePath !== `${criticalHandoverDirectory}/${path.basename(relativePath)}` ||
    ![filenamePattern, pauseFilenamePattern].some((pattern) =>
      pattern.test(path.basename(relativePath)),
    )
  ) {
    throw new Error("Handover receipt requires an exact repository-relative prompt path.");
  }
  const store = handoverStore(root, { testHooks });
  if (!store) throw new Error("The selected handover is unavailable.");
  try {
    const filename = path.basename(relativePath);
    const snapshot = readOwnedPrompt(store, filename);
    const metadata = parsedHandover(snapshot.content);
    if (
      metadata.budgetCategory === "account-pause"
        ? filename !== accountPauseFilename(metadata)
        : !filenamePattern.test(filename)
    )
      throw new Error("Selected handover filename does not match the prompt.");
    if (metadata.repositoryBinding !== repositoryBinding(root)) {
      throw new Error("The selected handover belongs to another repository.");
    }
    const sessionId = receivingSession(root, metadata);
    return consume({ filename, metadata, sessionId, snapshot, store });
  } finally {
    closeOwnedDirectoryBinding(store);
  }
}

/** Reads one explicitly accepted artifact in full; neither reading nor file equality proves cognition. */
export function receiveCriticalBudgetHandover({
  root = toolingRoot,
  relativePath,
  testHooks,
} = {}) {
  return withReceivingPrompt({ root, relativePath, testHooks }, ({ snapshot }) =>
    Object.freeze({
      relativePath,
      content: snapshot.content,
      sha256: sha256(snapshot.content),
      resumeBoundary: `${workContextResumeBoundary} ${capacityResumeBoundary}`,
    }),
  );
}

/** Acknowledges receipt by removing only the exact current artifact, never a directory or sibling.
 * The primary calls this only after complete native tool delivery and its compact acknowledgement.
 * The command verifies session/root/file identity, not model comprehension or transcript delivery.
 */
export function acknowledgeCriticalBudgetHandover({
  root = toolingRoot,
  relativePath,
  expectedSha256,
  testHooks,
} = {}) {
  if (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    throw new Error("Handover acknowledgement requires the received SHA-256 digest.");
  }
  const acknowledge = () =>
    withReceivingPrompt(
      { root, relativePath, testHooks },
      ({ filename, metadata, sessionId, snapshot, store }) => {
        if (sha256(snapshot.content) !== expectedSha256) {
          throw new Error("Handover acknowledgement digest does not match the selected artifact.");
        }
        testHooks?.beforeHandoverAcknowledge?.();
        if (receivingSession(root, metadata) !== sessionId) {
          throw new Error("The receiving canonical session changed before acknowledgement.");
        }
        if (metadata.budgetCategory === "account-pause") {
          const current = readOwnedPrompt(store, filename);
          if (
            !sameStableIdentity(snapshot.stats, current.stats) ||
            current.content !== snapshot.content
          )
            throw new Error("The selected account pause changed before acknowledgement.");
          markPauseAcknowledgement(root, store, metadata, filename, expectedSha256);
        }
        removeStableOwnedFile(
          store,
          filename,
          snapshot.stats,
          "acknowledged critical-budget handover",
        );
        if (metadata.budgetCategory === "account-pause") disarmAcknowledgedPause(root, metadata);
        return Object.freeze({ relativePath, sha256: expectedSha256 });
      },
    );
  return typeof relativePath === "string" && pauseFilenamePattern.test(path.basename(relativePath))
    ? withRuntimeLifecycleUpdateMutex(root, acknowledge)
    : acknowledge();
}

function usage() {
  return [
    "Usage: pnpm handover:create -- --critical | --pause",
    "       pnpm handover:receive -- <exact-repository-relative-prompt>",
    "       pnpm handover:acknowledge -- <exact-repository-relative-prompt> --sha256 <received-digest>",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  if (args.length === 2 && args[0] === "create" && args[1] === "--critical") {
    const handover = createCriticalBudgetHandover();
    console.log(`Critical-budget handover sealed: ${handover.relativePath}`);
    console.log("Stop now. Do not run another task, tool, follow-up, or automatic continuation.");
    console.log(
      "Developer: exit Codex completely with /quit, then run bash -p scripts/setup/start-codex.sh " +
        "from the project root in your terminal. /new and /resume do not restart the launcher. " +
        "Accept this handover when the new session announces it.",
    );
    return;
  }
  if (args.length === 2 && args[0] === "create" && args[1] === "--pause") {
    const handover = createAccountPauseHandover();
    console.log(`Account-window pause handover: ${handover.relativePath}`);
    console.log(
      "Automatic continuation is paused. Explicitly select this handover and check current capacity before resuming in this or a later active session.",
    );
    return;
  }
  if (args.length === 2 && args[0] === "receive") {
    const received = receiveCriticalBudgetHandover({ relativePath: args[1] });
    console.log(`Handover SHA-256: ${received.sha256}`);
    console.log(received.content);
    console.log(`Current receiving-session boundary: ${received.resumeBoundary}`);
    console.log(
      "Read the complete output, acknowledge the project/outcome/next action, then acknowledge this exact digest.",
    );
    return;
  }
  if (args.length === 4 && args[0] === "acknowledge" && args[2] === "--sha256") {
    const consumed = acknowledgeCriticalBudgetHandover({
      relativePath: args[1],
      expectedSha256: args[3],
    });
    console.log(`Acknowledged handover removed: ${consumed.relativePath}`);
    console.log(
      "The file is removed; copies in native conversation/provider history are not erased.",
    );
    return;
  }
  throw new Error(usage());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
