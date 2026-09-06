#!/usr/bin/env node
/** Owns repository-bound critical handover sealing, full receipt, and exact-file acknowledgement. */
import { randomBytes } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { frameworkRoot, readFrameworkContract, sha256 } from "../contracts/framework-contract.mjs";
import {
  closeOwnedDirectoryBinding,
  createExclusiveOwnedFile,
  ensureOwnedPrivateDirectory,
  listOwnedDirectory,
  openPrivateOwnedDirectory,
  readStableOwnedFile,
  removeStableOwnedFile,
  validateOwnedDirectoryBinding,
} from "../filesystem/owned-path-safety.mjs";
import { inspectRuntimeSessionLease } from "../repository/runtime-session-lease.mjs";
import { findSecretMatches } from "../security/secret-patterns.mjs";
import { readProjectWorkContext } from "./project-work-state.mjs";

export const criticalHandoverDirectory = "tmp/codexrig-handovers";
export const criticalHandoverMaxAgeMilliseconds = 72 * 60 * 60 * 1_000;

const handoverMaxBytes = 128 * 1_024;
const clockSkewMilliseconds = 5 * 60 * 1_000;
const candidateLimit = 128;
const markerPattern = /^<!-- codexrig-critical-budget-handover\n([^\r\n]+)\n-->\n/u;
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
  };
}

function parsedHandover(content) {
  const match = markerPattern.exec(content);
  if (!match) throw new Error("Critical-budget handover marker is missing.");
  let metadata;
  try {
    metadata = JSON.parse(match[1]);
  } catch {
    throw new Error("Critical-budget handover marker is invalid.");
  }
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
    ]) ||
    metadata.schemaVersion !== 2 ||
    metadata.budgetCategory !== "critical" ||
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
  if (!content.startsWith(`${match[0]}# Critical-Budget Cross-Account Handover Prompt\n`)) {
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

function renderPrompt({ context, metadata }) {
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

export function createCriticalBudgetHandover({
  root = frameworkRoot,
  now = Date.now,
  random = randomBytes,
  testHooks,
} = {}) {
  const working = readProjectWorkContext(root, { testHooks });
  if (!working || working.state.status === "complete") {
    throw new Error("Critical-budget handover requires active or blocked docs/project-context.md.");
  }
  if (findSecretMatches(working.content).length > 0) {
    throw new Error("Critical-budget handover refuses recognized secret material in work state.");
  }
  for (const line of requiredDrainLines) {
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
    schemaVersion: 2,
    budgetCategory: "critical",
    createdAt: timestamp,
    frameworkVersion: readFrameworkContract(root).frameworkVersion,
    repositoryBinding: repositoryBinding(root),
    sealingSessionId: runtimeSession.lease.sessionId,
    workStateRevision: working.state.revision,
    workStateSha256: sha256(snapshot),
  };
  const filename = `critical-budget-${compactTimestamp(timestamp)}-${random(6).toString("hex")}.prompt.md`;
  const content = renderPrompt({ context: snapshot, metadata });
  const store = handoverStore(root, { create: true, testHooks });
  let created;
  try {
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
  return Object.freeze({
    createdAt: metadata.createdAt,
    relativePath: `${criticalHandoverDirectory}/${filename}`,
    sealingSessionId: metadata.sealingSessionId,
    workStateRevision: metadata.workStateRevision,
  });
}

export function discoverRecentCriticalBudgetHandover({
  root = frameworkRoot,
  now = Date.now,
  testHooks,
} = {}) {
  let store;
  try {
    store = handoverStore(root, { testHooks });
  } catch {
    return null;
  }
  if (!store) return null;
  const binding = repositoryBinding(root);
  const currentTime = now();
  const candidates = [];
  try {
    testHooks?.beforeHandoverDiscovery?.({ store });
    for (const filename of listOwnedDirectory(store, "critical-budget handover directory")
      .filter((name) => filenamePattern.test(name))
      .sort()
      .slice(-candidateLimit)) {
      try {
        const metadata = parsedHandover(readOwnedPrompt(store, filename).content);
        const age = currentTime - metadata.createdAtMilliseconds;
        if (
          metadata.repositoryBinding === binding &&
          age >= -clockSkewMilliseconds &&
          age <= criticalHandoverMaxAgeMilliseconds
        ) {
          candidates.push({ filename, metadata });
        }
      } catch {
        // Invalid, unsafe, foreign, or partially written ignored files never enter startup context.
      }
    }
  } finally {
    closeOwnedDirectoryBinding(store);
  }
  candidates.sort(
    (left, right) =>
      right.metadata.createdAtMilliseconds - left.metadata.createdAtMilliseconds ||
      right.filename.localeCompare(left.filename, "en"),
  );
  const selected = candidates[0];
  return selected
    ? Object.freeze({
        createdAt: selected.metadata.createdAt,
        relativePath: `${criticalHandoverDirectory}/${selected.filename}`,
        sealingSessionId: selected.metadata.sealingSessionId,
        workStateRevision: selected.metadata.workStateRevision,
      })
    : null;
}

function receivingSession(root, metadata) {
  const session = inspectRuntimeSessionLease({ root });
  if (
    session.status !== "active" ||
    session.lease.phase !== "active" ||
    session.lease.sessionId === metadata.sealingSessionId
  ) {
    throw new Error("Handover receipt requires a later active canonical session.");
  }
  return session.lease.sessionId;
}

function withReceivingPrompt({ root, relativePath, testHooks }, consume) {
  if (
    typeof relativePath !== "string" ||
    !relativePath.startsWith(`${criticalHandoverDirectory}/`) ||
    relativePath !== `${criticalHandoverDirectory}/${path.basename(relativePath)}` ||
    !filenamePattern.test(path.basename(relativePath))
  ) {
    throw new Error("Handover receipt requires an exact repository-relative prompt path.");
  }
  const store = handoverStore(root, { testHooks });
  if (!store) throw new Error("The selected handover is unavailable.");
  try {
    const filename = path.basename(relativePath);
    const snapshot = readOwnedPrompt(store, filename);
    const metadata = parsedHandover(snapshot.content);
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
  root = frameworkRoot,
  relativePath,
  testHooks,
} = {}) {
  return withReceivingPrompt({ root, relativePath, testHooks }, ({ snapshot }) =>
    Object.freeze({ relativePath, content: snapshot.content, sha256: sha256(snapshot.content) }),
  );
}

/** Acknowledges receipt by removing only the exact current artifact, never a directory or sibling.
 * The primary calls this only after complete native tool delivery and its compact acknowledgement.
 * The command verifies session/root/file identity, not model comprehension or transcript delivery.
 */
export function acknowledgeCriticalBudgetHandover({
  root = frameworkRoot,
  relativePath,
  expectedSha256,
  testHooks,
} = {}) {
  if (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    throw new Error("Handover acknowledgement requires the received SHA-256 digest.");
  }
  return withReceivingPrompt(
    { root, relativePath, testHooks },
    ({ filename, metadata, sessionId, snapshot, store }) => {
      if (sha256(snapshot.content) !== expectedSha256) {
        throw new Error("Handover acknowledgement digest does not match the selected artifact.");
      }
      testHooks?.beforeHandoverAcknowledge?.();
      if (receivingSession(root, metadata) !== sessionId) {
        throw new Error("The receiving canonical session changed before acknowledgement.");
      }
      removeStableOwnedFile(
        store,
        filename,
        snapshot.stats,
        "acknowledged critical-budget handover",
      );
      return Object.freeze({ relativePath, sha256: expectedSha256 });
    },
  );
}

function usage() {
  return [
    "Usage: pnpm handover:create -- --critical",
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
    return;
  }
  if (args.length === 2 && args[0] === "receive") {
    const received = receiveCriticalBudgetHandover({ relativePath: args[1] });
    console.log(`Handover SHA-256: ${received.sha256}`);
    console.log(received.content);
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
