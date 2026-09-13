#!/usr/bin/env node
/** Owns same-host Git worktree inventory for repository recovery and writer-lease reconstruction. */
import { spawnSyncWithBoundedIo as spawnSync } from "./runtime-process-io.mjs";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import {
  cleanGitEnvironment,
  isolatedGitArguments,
  isolatedGitResultCompleted,
  resolveOwnedGitMetadata,
} from "./git-runtime-isolation.mjs";
import {
  clearStaleRuntimeSessionLease,
  inspectRuntimeSessionLease,
  inspectRuntimeSessionRecovery,
} from "./runtime-session-lease.mjs";
import {
  createWorktreePreservationLockReason,
  worktreePreservationLockReason,
} from "./worktree-preservation-lock.mjs";
import {
  inspectWorktreePruneTransaction,
  pruneMissingWorktreeRegistrations,
  reconcileWorktreePruneArtifacts,
} from "./worktree-prune-transaction.mjs";
import { formatWorktreeRecoveryJson } from "./worktree-recovery-output.mjs";
export { createWorktreePreservationLockReason, worktreePreservationLockReason };
export { formatWorktreeRecoveryJson };
export { formatWorktreeRecoveryLine } from "./worktree-recovery-output.mjs";

const maximumGitOutputBytes = 16 * 1024 * 1024;
const objectIdPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const zeroObjectIdPattern = /^(?:0{40}|0{64})$/u;
const unsupportedMetadataProblem = "listed Git worktree metadata contains unsupported fields";
const gitFieldDecoder = new TextDecoder("utf-8", { fatal: true });

function runGit(metadata, args, { buffer = false, acceptedStatuses = [0] } = {}) {
  const invocationArguments = isolatedGitArguments({
    args,
    gitDirectory: metadata.gitDirectory,
    workTree: metadata.workTree,
  });
  const result = spawnSync("git", invocationArguments, {
    cwd: metadata.workTree,
    encoding: buffer ? null : "utf8",
    env: cleanGitEnvironment(),
    input: "",
    maxBuffer: maximumGitOutputBytes,
    stdio: "pipe",
    timeout: 20_000,
  });
  if (
    !isolatedGitResultCompleted(result, {
      acceptedStatuses,
      args: invocationArguments,
      encoding: buffer ? null : "utf8",
      maximumOutputBytes: maximumGitOutputBytes,
    })
  ) {
    throw new Error("Repository worktree inventory could not access isolated Git state.");
  }
  return result;
}

/** Removes only Git's one record terminator and rejects ambiguous multi-record output. */
function parseExactGitOutputLine(content, label) {
  if (typeof content !== "string") {
    throw new Error(`Repository worktree inventory received invalid ${label}.`);
  }
  const match = /^([^\0\r\n]*)\r?\n?$/u.exec(content);
  if (!match) {
    throw new Error(`Repository worktree inventory received ambiguous ${label}.`);
  }
  return match[1];
}

function gitCommonDirectory(metadata) {
  const result = runGit(metadata, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const candidate = parseExactGitOutputLine(result.stdout, "Git common directory");
  if (!path.isAbsolute(candidate)) {
    throw new Error("Repository worktree inventory received an invalid Git common directory.");
  }
  const stats = lstatSync(candidate);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("Repository worktree inventory rejected unsafe shared Git metadata.");
  }
  return realpathSync.native(candidate);
}

function listedWorktreeRecord(recordPath) {
  return {
    path: recordPath,
    head: null,
    branchReference: null,
    bare: false,
    detached: false,
    locked: null,
    prunable: null,
    unsupported: false,
  };
}

function parseWorktreeList(content) {
  const fields = [];
  let fieldStart = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== 0) continue;
    fields.push(content.subarray(fieldStart, index));
    fieldStart = index + 1;
  }
  if (fieldStart < content.length) fields.push(content.subarray(fieldStart));
  const records = [];
  let record = null;
  for (const fieldBuffer of fields) {
    let field;
    try {
      field = gitFieldDecoder.decode(fieldBuffer);
    } catch {
      record ??= listedWorktreeRecord("<non-UTF-8 Git worktree metadata>");
      record.unsupported = true;
      continue;
    }
    if (field === "") {
      if (record) {
        records.push(Object.freeze(record));
        record = null;
      }
      continue;
    }
    if (field.startsWith("worktree ")) {
      if (record) throw new Error("Repository worktree inventory received a malformed list.");
      record = listedWorktreeRecord(field.slice("worktree ".length));
      continue;
    }
    if (!record) throw new Error("Repository worktree inventory received an unbound field.");
    if (field.startsWith("HEAD ")) record.head = field.slice("HEAD ".length);
    else if (field.startsWith("branch ")) {
      record.branchReference = field.slice("branch ".length);
    } else if (field === "bare") record.bare = true;
    else if (field === "detached") record.detached = true;
    else if (field === "locked" || field.startsWith("locked ")) {
      record.locked = field === "locked" ? "" : field.slice("locked ".length);
    } else if (field === "prunable" || field.startsWith("prunable ")) {
      record.prunable = field === "prunable" ? "" : field.slice("prunable ".length);
    } else {
      record.unsupported = true;
    }
  }
  if (record) throw new Error("Repository worktree inventory received an unterminated list.");
  return records;
}

function validateListedRecord(record) {
  if (
    !path.isAbsolute(record.path) ||
    record.path.includes("\0") ||
    !objectIdPattern.test(record.head ?? "") ||
    (record.branchReference !== null && !record.branchReference.startsWith("refs/heads/")) ||
    (record.detached && record.branchReference !== null) ||
    record.bare
  ) {
    throw new Error("Repository worktree inventory received invalid worktree metadata.");
  }
}

function canonicalWorktreePath(candidate) {
  const stats = lstatSync(candidate);
  const canonical = realpathSync.native(candidate);
  if (stats.isSymbolicLink() || !stats.isDirectory() || canonical !== candidate) {
    throw new Error("Repository worktree inventory rejected an unsafe worktree path.");
  }
  return canonical;
}

function worktreeDirectoryStatus(candidate) {
  let stats;
  try {
    stats = lstatSync(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    return "unsafe";
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) return "unsafe";
  try {
    return realpathSync.native(candidate) === candidate ? "present" : "unsafe";
  } catch {
    return "unsafe";
  }
}

function dirtyWorktree(metadata) {
  return (
    runGit(metadata, ["status", "--porcelain=v2", "-z", "--untracked-files=all"], {
      buffer: true,
    }).stdout.length > 0
  );
}

function headIsIntegrated(metadata, head) {
  if (head === null) return null;
  if (zeroObjectIdPattern.test(head)) return false;
  const main = runGit(metadata, ["rev-parse", "--verify", "refs/heads/main^{commit}"], {
    acceptedStatuses: [0, 128],
  });
  if (main.status !== 0) return null;
  const integrated = runGit(metadata, ["merge-base", "--is-ancestor", head, "refs/heads/main"], {
    acceptedStatuses: [0, 1],
  });
  return integrated.status === 0;
}

function upstreamState(metadata, head) {
  const upstream = runGit(
    metadata,
    ["rev-parse", "--symbolic-full-name", "--verify", "@{upstream}"],
    { acceptedStatuses: [0, 128] },
  );
  if (upstream.status !== 0) return Object.freeze({ ahead: null, reference: null });
  const reference = parseExactGitOutputLine(upstream.stdout, "upstream reference");
  if (!reference.startsWith("refs/remotes/")) {
    throw new Error("Repository worktree inventory received an invalid upstream reference.");
  }
  const ahead = parseExactGitOutputLine(
    runGit(metadata, ["rev-list", "--count", `${reference}..${head}`]).stdout,
    "upstream ahead count",
  );
  if (!/^\d+$/u.test(ahead)) {
    throw new Error("Repository worktree inventory received an invalid ahead count.");
  }
  return Object.freeze({ ahead: Number(ahead), reference });
}

function sessionState(worktreeRoot) {
  let session;
  let recovery;
  try {
    session = inspectRuntimeSessionLease({ root: worktreeRoot });
  } catch {
    session = Object.freeze({ status: "invalid" });
  }
  try {
    recovery = inspectRuntimeSessionRecovery({ root: worktreeRoot });
  } catch {
    recovery = Object.freeze({ status: "invalid" });
  }
  const recoverySessionId = recovery.status === "present" ? recovery.recovery.codexSessionId : null;
  const recoveryUpdatedAt = recovery.status === "present" ? recovery.recovery.updatedAt : null;
  if (session.status === "absent" || session.status === "invalid") {
    return Object.freeze({
      recoverySessionId,
      recoveryStatus: recovery.status,
      recoveryUpdatedAt,
      status: session.status,
    });
  }
  return Object.freeze({
    status: session.status,
    codexSessionId: session.lease.codexSessionId ?? null,
    phase: session.lease.phase,
    recoverySessionId,
    recoveryStatus: recovery.status,
    recoveryUpdatedAt,
    sessionId: session.lease.sessionId ?? null,
    startedAt: session.lease.startedAt,
  });
}

function pruneTransactionState(commonGitDirectory) {
  const inspected = inspectWorktreePruneTransaction(commonGitDirectory);
  return Object.freeze({
    pathCount: inspected.transaction?.paths.length ?? null,
    status: inspected.status,
  });
}

function recoveryFindings(inventory) {
  const advisoryFindings = [];
  const blockingFindings = [];
  const driftFindings = [];
  if (["active", "unknown", "unrecognized"].includes(inventory.pruneTransaction.status)) {
    blockingFindings.push(
      `shared worktree prune transaction is ${inventory.pruneTransaction.status} and blocks native prune`,
    );
  } else if (inventory.pruneTransaction.status === "stale") {
    driftFindings.push("a stale shared worktree prune transaction remains");
  }
  for (const worktree of inventory.worktrees) {
    const worktreePath = formatWorktreeRecoveryJson(worktree.path);
    if (worktree.problem) blockingFindings.push(`${worktree.problem} at ${worktreePath}`);
    if (worktree.session.status === "invalid") {
      blockingFindings.push(`session metadata is invalid in worktree ${worktreePath}`);
    }
    if (worktree.session.recoveryStatus === "invalid") {
      advisoryFindings.push(`latest-session recovery metadata is invalid in ${worktreePath}`);
    }
    if (worktree.session.status === "stale") {
      driftFindings.push(`a stale writer lease remains in worktree ${worktreePath}`);
    }
    if (worktree.session.status === "unknown") {
      blockingFindings.push(`writer ownership cannot be verified in worktree ${worktreePath}`);
    }
    if (!worktree.current && worktree.session.status === "active") {
      blockingFindings.push(`another worktree has an active writer session at ${worktreePath}`);
    }
    if (worktree.session.phase === "active" && worktree.session.recoveryStatus !== "present") {
      advisoryFindings.push(`an active session lacks exact recovery metadata in ${worktreePath}`);
    } else if (
      worktree.session.phase === "active" &&
      worktree.session.recoverySessionId !== worktree.session.codexSessionId
    ) {
      advisoryFindings.push(`session and recovery identifiers differ in ${worktreePath}`);
    }
    if (worktree.prunable && worktree.directoryStatus === "missing") {
      driftFindings.push(`stale Git worktree metadata remains for missing ${worktreePath}`);
    } else if (worktree.prunable && worktree.directoryStatus === "present") {
      blockingFindings.push(
        `an existing directory has a broken Git worktree link and requires ownership confirmation before repair at ${worktreePath}`,
      );
    } else if (worktree.prunable) {
      blockingFindings.push(`a prunable Git worktree path is unsafe at ${worktreePath}`);
    }
    if (!worktree.current && worktree.available && worktree.unfinished) {
      blockingFindings.push(`another worktree has unfinished main-stream state at ${worktreePath}`);
    }
  }
  return Object.freeze({
    advisoryFindings: Object.freeze(advisoryFindings),
    blockingFindings: Object.freeze(blockingFindings),
    driftFindings: Object.freeze(driftFindings),
  });
}

function inspectAvailableWorktree(record, currentRoot, expectedCommonDirectory) {
  const worktreeRoot = canonicalWorktreePath(record.path);
  const metadata = resolveOwnedGitMetadata(worktreeRoot);
  if (!metadata || gitCommonDirectory(metadata) !== expectedCommonDirectory) {
    throw new Error("Repository worktree inventory rejected a worktree outside the current clone.");
  }
  const dirty = dirtyWorktree(metadata);
  const integrated = headIsIntegrated(metadata, record.head);
  const upstream = upstreamState(metadata, record.head);
  const integrationBranchUnpublished =
    record.branchReference === "refs/heads/main" && upstream.ahead !== 0;
  return Object.freeze({
    available: true,
    branch:
      record.branchReference === null ? null : record.branchReference.slice("refs/heads/".length),
    current: worktreeRoot === currentRoot,
    detached: record.detached,
    dirty,
    directoryStatus: "present",
    gitManaged: true,
    head: record.head,
    integratedIntoMain: integrated,
    locked: record.locked !== null,
    lockReason: record.locked,
    path: worktreeRoot,
    problem: null,
    prunable: false,
    repairCandidate: false,
    session: sessionState(worktreeRoot),
    // Temporary branch upstreams are transport evidence, not a second integration line. Once that
    // exact task HEAD is contained in main, only dirty state can make the worktree unfinished;
    // unpublished central-main commits remain unfinished through main's own upstream relation.
    unfinished: dirty || integrated !== true || integrationBranchUnpublished,
    upstreamAhead: upstream.ahead,
    upstreamReference: upstream.reference,
  });
}

function unavailableWorktree(record, currentRoot, directoryStatus, problem = null) {
  const canonicalPath =
    directoryStatus === "present" ? realpathSync.native(record.path) : record.path;
  return Object.freeze({
    available: false,
    branch:
      record.branchReference === null ? null : record.branchReference.slice("refs/heads/".length),
    current: canonicalPath === currentRoot,
    detached: record.detached,
    dirty: null,
    directoryStatus,
    gitManaged: true,
    head: record.head,
    integratedIntoMain: null,
    locked: record.locked !== null,
    lockReason: record.locked,
    path: canonicalPath,
    problem,
    prunable: record.prunable !== null,
    repairCandidate: record.prunable !== null && directoryStatus === "present",
    session:
      directoryStatus === "present"
        ? sessionState(canonicalPath)
        : Object.freeze({ recoveryStatus: "unavailable", status: "unavailable" }),
    unfinished: directoryStatus === "present",
    upstreamAhead: null,
    upstreamReference: null,
  });
}

function invalidListedWorktree(record, currentRoot) {
  const pathCanBeInspected =
    typeof record.path === "string" && path.isAbsolute(record.path) && !record.path.includes("\0");
  const directoryStatus = pathCanBeInspected ? worktreeDirectoryStatus(record.path) : "unsafe";
  const worktreePath = record.path ?? "<missing Git worktree path>";
  return Object.freeze({
    available: false,
    branch: null,
    current: worktreePath === currentRoot,
    detached: false,
    dirty: null,
    directoryStatus,
    gitManaged: true,
    head: null,
    integratedIntoMain: null,
    locked: false,
    lockReason: null,
    path: worktreePath,
    problem: "listed Git worktree metadata is invalid or unsupported",
    prunable: false,
    repairCandidate: false,
    session:
      directoryStatus === "present"
        ? sessionState(realpathSync.native(worktreePath))
        : Object.freeze({ recoveryStatus: "unavailable", status: "unavailable" }),
    unfinished: directoryStatus === "present",
    upstreamAhead: null,
    upstreamReference: null,
  });
}

function standaloneRootInventory(currentRoot, repositoryKind, problem = null) {
  return Object.freeze({
    schemaVersion: 1,
    complete: problem === null,
    currentWorktree: currentRoot,
    integrationBranch: null,
    pruneTransaction: Object.freeze({ pathCount: null, status: "unavailable" }),
    repositoryKind,
    worktrees: Object.freeze([
      Object.freeze({
        available: true,
        branch: null,
        current: true,
        detached: false,
        dirty: null,
        directoryStatus: "present",
        gitManaged: repositoryKind === "gitless" ? false : null,
        head: null,
        integratedIntoMain: null,
        locked: false,
        lockReason: null,
        path: currentRoot,
        problem,
        prunable: false,
        repairCandidate: false,
        session: sessionState(currentRoot),
        unfinished: false,
        upstreamAhead: null,
        upstreamReference: null,
      }),
    ]),
  });
}

function preserveAmbiguousCurrentInventory(currentRoot, worktrees, pruneTransaction) {
  const problem = "Git worktree inventory could not uniquely identify the current worktree";
  let selected = false;
  const preserved = worktrees.map((worktree) => {
    if (!worktree.current) return worktree;
    const current = !selected;
    selected = true;
    return Object.freeze({
      ...worktree,
      current,
      problem: [worktree.problem, problem].filter(Boolean).join("; "),
    });
  });
  if (!selected) {
    const current = standaloneRootInventory(currentRoot, "inconsistent", problem).worktrees[0];
    preserved.push(
      Object.freeze({ ...current, available: false, gitManaged: true, unfinished: true }),
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    complete: false,
    currentWorktree: currentRoot,
    integrationBranch: "main",
    pruneTransaction,
    repositoryKind: "inconsistent",
    worktrees: Object.freeze(preserved),
  });
}

/** Inventories the current root and all safe same-clone worktrees without transcript or Git mutation. */
export function inspectRepositoryWorktrees({ root = toolingRoot } = {}) {
  const currentRoot = canonicalWorktreePath(root);
  let metadata;
  try {
    metadata = resolveOwnedGitMetadata(currentRoot);
  } catch {
    return standaloneRootInventory(
      currentRoot,
      "inconsistent",
      "current Git metadata could not be safely inspected",
    );
  }
  if (!metadata) return standaloneRootInventory(currentRoot, "gitless");
  let commonGitDirectory;
  let listed;
  try {
    commonGitDirectory = gitCommonDirectory(metadata);
    listed = parseWorktreeList(
      runGit(metadata, ["worktree", "list", "--porcelain", "-z"], { buffer: true }).stdout,
    );
  } catch {
    return standaloneRootInventory(
      currentRoot,
      "inconsistent",
      "Git worktree metadata could not be safely inventoried",
    );
  }
  const pruneTransaction = pruneTransactionState(commonGitDirectory);
  const worktrees = listed.map((record) => {
    try {
      validateListedRecord(record);
    } catch {
      return invalidListedWorktree(record, currentRoot);
    }
    const directoryStatus = worktreeDirectoryStatus(record.path);
    if (record.unsupported) {
      return unavailableWorktree(record, currentRoot, directoryStatus, unsupportedMetadataProblem);
    }
    if (record.prunable !== null) {
      return unavailableWorktree(record, currentRoot, directoryStatus);
    }
    if (directoryStatus !== "present") {
      return unavailableWorktree(
        record,
        currentRoot,
        directoryStatus,
        "registered Git worktree directory could not be safely inspected",
      );
    }
    try {
      return inspectAvailableWorktree(record, currentRoot, commonGitDirectory);
    } catch {
      return unavailableWorktree(
        record,
        currentRoot,
        directoryStatus,
        "registered Git worktree state could not be safely inspected",
      );
    }
  });
  if (worktrees.filter(({ current }) => current).length !== 1) {
    return preserveAmbiguousCurrentInventory(currentRoot, worktrees, pruneTransaction);
  }
  return Object.freeze({
    schemaVersion: 1,
    complete: worktrees.every((worktree) => worktree.problem === null),
    currentWorktree: currentRoot,
    integrationBranch: "main",
    pruneTransaction,
    repositoryKind: "git",
    worktrees: Object.freeze(worktrees),
  });
}

function hasUnsafeWriterForGitMutation(inventory) {
  return inventory.worktrees.some(
    (worktree) =>
      ["invalid", "unknown"].includes(worktree.session.status) ||
      (!worktree.current && worktree.session.status === "active"),
  );
}

/** Clears stale coordination state while preserving recovery metadata and every worktree file. */
export function reconcileRepositoryWorktreeState({
  root = toolingRoot,
  apply = false,
  lifecycleCapability,
  testHooks,
} = {}) {
  let inventory = inspectRepositoryWorktrees({ root });
  const cleanupBlockingFindings = [];
  if (apply) {
    if (inventory.repositoryKind === "git" && !hasUnsafeWriterForGitMutation(inventory)) {
      const metadata = resolveOwnedGitMetadata(inventory.currentWorktree);
      if (!metadata) throw new Error("Repository worktree cleanup lost its Git worktree binding.");
      const reconciled = reconcileWorktreePruneArtifacts({
        commonGitDirectory: gitCommonDirectory(metadata),
        inspectInventory: () => inspectRepositoryWorktrees({ root }),
        inventory,
        metadata,
        runGit,
        testHooks,
      });
      inventory = reconciled.inventory;
      cleanupBlockingFindings.push(...reconciled.blockingFindings);
    }
    for (const worktree of inventory.worktrees) {
      if (
        worktree.directoryStatus === "present" &&
        worktree.session.status === "stale" &&
        (worktree.current || worktree.available)
      ) {
        clearStaleRuntimeSessionLease({
          root: worktree.path,
          lifecycleCapability: worktree.current ? lifecycleCapability : undefined,
        });
      }
    }
    inventory = inspectRepositoryWorktrees({ root });
    if (
      inventory.repositoryKind === "git" &&
      !hasUnsafeWriterForGitMutation(inventory) &&
      cleanupBlockingFindings.length === 0
    ) {
      const metadata = resolveOwnedGitMetadata(inventory.currentWorktree);
      if (!metadata) throw new Error("Repository worktree cleanup lost its Git worktree binding.");
      const pruned = pruneMissingWorktreeRegistrations({
        commonGitDirectory: gitCommonDirectory(metadata),
        inspectInventory: () => inspectRepositoryWorktrees({ root }),
        inventory,
        metadata,
        runGit,
        testHooks,
      });
      inventory = pruned.inventory;
      cleanupBlockingFindings.push(...pruned.blockingFindings);
    }
  }
  const findings = recoveryFindings(inventory);
  return Object.freeze({
    ...findings,
    blockingFindings: Object.freeze([
      ...new Set([...findings.blockingFindings, ...cleanupBlockingFindings]),
    ]),
    inventory,
  });
}

export function parseWorktreeRecoveryArguments(args) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
    throw new Error("Worktree recovery arguments must be strings.");
  }
  const delimiters = args.filter((argument) => argument === "--").length;
  const options = args.filter((argument) => argument !== "--");
  if (
    delimiters > 1 ||
    options.length > 1 ||
    (options[0] !== undefined && options[0] !== "--json")
  ) {
    throw new Error("Usage: pnpm worktree:status [-- --json]");
  }
  return Object.freeze({ json: options[0] === "--json" });
}
