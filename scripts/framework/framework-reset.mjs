/** Owns framework source and session reset, retention and quiescence. */
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { toolingRoot as defaultRoot } from "../filesystem/repository-files.mjs";
import { isRepositoryProcessArtifactPath } from "../docs/document-scope.mjs";
import {
  criticalHandoverDirectory,
  hasPendingAccountPause,
} from "../context/critical-budget-handover.mjs";
import {
  projectContextRelativePath,
  readProjectWorkContext,
} from "../context/project-work-state.mjs";
import { claimAndRemove } from "../filesystem/owned-path-safety.mjs";
import {
  atomicWriteOwnedFile,
  readOptionalOwnedFile,
  removeOwnedRegularFile,
} from "../filesystem/owned-file-operations.mjs";
import { isChildMaintenanceDocument } from "./framework-upgrade-documents.mjs";
import { frameworkUpgradeStatePaths } from "./framework-upgrade-journal.mjs";
import { dependencyTransactionPaths } from "../deps/dependency-transaction-state.mjs";
import { housekeepingStatePaths } from "../repository/repository-housekeeping-files.mjs";
import { resolveOwnedGitMetadata } from "../repository/git-runtime-isolation.mjs";
import { sensitivePathReason } from "../repository/sensitive-paths.mjs";
import {
  isPrivateCodexRuntimePath,
  isPrivateRepositoryStatePath,
  isRepositoryCodexHomePath,
  isExcludedActivePath,
  listRepositoryPathInventory,
  repositoryCodexRuntimeCacheDirectory,
  repositoryCodexRuntimeDirectory,
  repositoryCodexHomeCredentialFileNames,
} from "../repository/source-inventory.mjs";
import { isPortableCodexPath } from "../repository/source-inventory-policy.mjs";
import { inspectLinuxOpenRepositoryPaths } from "../repository/runtime-process-identity.mjs";
import { inspectPublicationSession } from "../repository/publication-session.mjs";
import {
  acquireRuntimeLifecycleLock,
  inspectRuntimeSessionLease,
  invalidRuntimeSessionLeaseErrorCode,
  repositoryRuntimeRootIdentity,
  releaseRuntimeLifecycleLock,
  runtimeLifecycleGuardName,
  runtimeLifecycleLockName,
} from "../repository/runtime-session-lease.mjs";
import { inspectRepositoryWorktrees } from "../repository/worktree-recovery.mjs";
import { readVerificationEvidence } from "../verify/verification-evidence-store.mjs";
import { inspectVerificationSessionLock } from "../verify/verification-session-lock.mjs";

const verificationEvidencePath = `${repositoryCodexRuntimeCacheDirectory}/project-verification/evidence.json`;
const verificationLockPath = `${repositoryCodexRuntimeCacheDirectory}/project-verification/session.lock`;
const childMaintenancePath = ".project-state/child-maintenance";
const nativePnpmGraphDirectory =
  /^(\.codex\/\.mise\/locks\/pnpm\/)(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2}(?=\/|$)/u;
const removableTrees = [
  childMaintenancePath,
  "dist/exports",
  "docs/goals",
  "docs/handoffs",
  "docs/planning",
  "docs/plans",
  "docs/reviews",
  "docs/slices",
  "docs/status",
  "docs/tasks",
  "docs/project-context.md",
  "scripts/planning",
];
const optionalEmptyDirectories = [
  "apps",
  "docs/adr",
  "docs/architecture",
  "docs/operations",
  "infra",
  "packages",
  "services",
];
const scanExcludedDirectories = new Set([".codex", ".git", ".project-state", "node_modules"]);
const protectedSourceEntries = new Set([".git", ".auth", ".project-state"]);
const preservedCodexHomeFiles = new Set([
  ...repositoryCodexHomeCredentialFileNames,
  "config.toml",
  "installation_id",
]);
const preservedRuntimeFiles = new Set([runtimeLifecycleGuardName, runtimeLifecycleLockName]);
const updateResetRequest = `${repositoryCodexRuntimeDirectory}/post-update-reset.json`;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {
    apply: false,
    root: defaultRoot,
    verificationSourceBaseline: false,
    publication: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") options.apply = true;
    else if (argument === "--publication") options.publication = true;
    else if (argument === "--verification-source-baseline") {
      options.verificationSourceBaseline = true;
    } else if (argument === "--root") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail("--root requires a path.");
      options.root = path.resolve(value);
      index += 1;
    } else if (argument.startsWith("--root=")) options.root = path.resolve(argument.slice(7));
    else fail(`Unknown argument: ${argument}`);
  }
  if (options.apply && options.verificationSourceBaseline) {
    fail("Verification source baseline is read-only and cannot use --apply.");
  }
  if (options.publication && options.verificationSourceBaseline)
    fail("Publication and verification source baselines are distinct operations.");
  return options;
}

function requireFrameworkRoot(rootValue) {
  if (!existsSync(rootValue)) fail(`Repository root does not exist: ${rootValue}`);
  const rootStats = lstatSync(rootValue);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    fail(`Repository root must be a real directory: ${rootValue}`);
  }
  const root = realpathSync(rootValue);
  const packagePath = path.join(root, "package.json");
  const readmePath = path.join(root, "README.md");
  const skillPath = path.join(root, ".agents", "skills", "reset-framework", "SKILL.md");
  const codexPath = path.join(root, ".codex");
  if (!existsSync(packagePath) || lstatSync(packagePath).isSymbolicLink()) {
    fail("Reset refused: package.json is missing or is a symlink.");
  }
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const hasFrameworkReadme =
    existsSync(readmePath) &&
    !lstatSync(readmePath).isSymbolicLink() &&
    readFileSync(readmePath, "utf8").startsWith("# CodexRig Framework\n");
  if (packageJson.name !== "codexrig" || !hasFrameworkReadme || !existsSync(skillPath)) {
    fail("Reset refused: target is not the CodexRig Framework.");
  }
  if (
    !existsSync(codexPath) ||
    lstatSync(codexPath).isSymbolicLink() ||
    !lstatSync(codexPath).isDirectory()
  ) {
    fail("Reset refused: portable .codex policy must be a real directory.");
  }
  return root;
}

function relativePath(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function absolutePath(root, relative) {
  return path.join(root, ...relative.split("/"));
}

function entryStats(target, { bigint = false } = {}) {
  try {
    return lstatSync(target, { bigint });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function isEmptyRealDirectory(target) {
  const stats = entryStats(target);
  return Boolean(
    stats && !stats.isSymbolicLink() && stats.isDirectory() && readdirSync(target).length === 0,
  );
}

export function openFrameworkRuntimeStatus(root, { procRoot = "/proc", testHooks } = {}) {
  if (process.platform !== "linux") return "inactive";
  try {
    if (!entryStats(procRoot)) return "unknown";
  } catch (error) {
    if (["EACCES", "EPERM"].includes(error?.code)) return "unknown";
    throw error;
  }
  return inspectLinuxOpenRepositoryPaths({
    root,
    matchesPath(relative) {
      if (
        relative === `${repositoryCodexRuntimeDirectory}/${runtimeLifecycleGuardName}` ||
        relative === `${repositoryCodexRuntimeDirectory}/${runtimeLifecycleLockName}`
      ) {
        return false;
      }
      return isPrivateCodexRuntimePath(relative);
    },
    procRoot,
    testHooks,
  }).status;
}

function assertRuntimeInactive(root) {
  const runtimePath = absolutePath(root, repositoryCodexRuntimeDirectory);
  // Every isolated project command sets CODEX_HOME, including post-exit publication. Only
  // observable runtime ownership and the current session lease establish an active session.
  const openRuntimeStatus = openFrameworkRuntimeStatus(root);
  if (openRuntimeStatus === "active") {
    fail("Reset refused while another process still has framework runtime files open.");
  }
  if (openRuntimeStatus === "unknown") {
    fail("Reset refused because framework runtime process ownership is indeterminate.");
  }
  const runtimeStats = entryStats(runtimePath);
  if (runtimeStats && (runtimeStats.isSymbolicLink() || !runtimeStats.isDirectory())) {
    fail("Reset refused: .codex/runtime must be a real directory.");
  }
  let lease;
  try {
    lease = inspectRuntimeSessionLease({ root });
  } catch (error) {
    if (error?.code !== invalidRuntimeSessionLeaseErrorCode) throw error;
    // Full reset owns disposable private runtime as one unit. Once the lifecycle lock is held and
    // repository-wide runtime quiescence is proven, an unreadable non-current lease is data to
    // discard, never an alternate schema to interpret.
    return Object.freeze({ status: "invalid" });
  }
  if (lease.status === "active" || lease.status === "unknown") {
    fail("Reset refused while a Codex session still owns the framework runtime; exit it first.");
  }
  return lease;
}

/** Inspects full-reset candidates only after proving source identity and runtime quiescence. */
export function inspectFrameworkReset(root = defaultRoot, expectedFiles) {
  const canonical = requireFrameworkRoot(root);
  assertRuntimeInactive(canonical);
  return Object.freeze(collectCandidates(canonical, { expectedFiles }));
}

function frameworkTransactionRoots(root) {
  if (!entryStats(path.join(root, ".project-state"))) return [];
  return [
    frameworkUpgradeStatePaths(root).root,
    dependencyTransactionPaths(root).state,
    housekeepingStatePaths(root).root,
  ];
}

function unsettledTransaction(canonical) {
  for (const state of frameworkTransactionRoots(canonical))
    if (entryStats(state) && !isEmptyRealDirectory(state)) return relativePath(canonical, state);
  return null;
}

/** Publication clears portable process residue while the caller keeps its private runtime alive. */
export function inspectFrameworkPublicationReset(root = defaultRoot, expectedFiles) {
  const canonical = requireFrameworkRoot(root);
  const unsettled = unsettledTransaction(canonical);
  if (unsettled)
    fail(
      `Publication preserves unsettled transaction state at ${unsettled}; finish recovery with its owner first.`,
    );
  return inspectPublicationSession(canonical)
    ? Object.freeze(collectCandidates(canonical, { includeLocalRuntime: false, expectedFiles }))
    : inspectFrameworkReset(canonical, expectedFiles);
}

function requirePreservedFile(target, label) {
  const stats = lstatSync(target, { bigint: true });
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    stats.nlink !== 1n ||
    stats.size > 16n * 1024n * 1024n ||
    (stats.mode & 0o022n) !== 0n ||
    (typeof process.getuid === "function" && stats.uid !== BigInt(process.getuid()))
  ) {
    fail(`Reset refused unsafe preserved runtime file: ${label}.`);
  }
  return stats;
}

function containsProjectState(entries, scratchDirectory) {
  if (entries.some(({ name }) => protectedSourceEntries.has(name))) return true;
  const segments = scratchDirectory?.split(path.sep) ?? [];
  const codexIndex = segments.indexOf(".codex");
  if (codexIndex !== -1) {
    const policyPath = segments.slice(codexIndex).join("/");
    return entries.some(({ name }) => {
      const portablePath = `${policyPath}/${name}`.replace(nativePnpmGraphDirectory, "$1current");
      return !isPortableCodexPath(portablePath);
    });
  }
  const codex = entries.find(({ name }) => name === ".codex");
  if (!codex) return false;
  if (scratchDirectory === undefined) return entries.some(({ name }) => name === "package.json");
  return !codex.isDirectory() || entries.some(({ name }) => isRepositoryCodexHomePath(name));
}

function scanSourceResidue(root, nestedProjects) {
  const matches = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = readdirSync(directory, { withFileTypes: true });
    if (directory !== root && containsProjectState(entries)) {
      nestedProjects.push(relativePath(root, directory) + "/");
      continue;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const relative = relativePath(root, target);
      if (isPrivateRepositoryStatePath(relative) || protectedSourceEntries.has(entry.name))
        continue;
      if (entry.isDirectory()) {
        if (scanExcludedDirectories.has(entry.name) || isExcludedActivePath(relative)) continue;
        pending.push(target);
      } else if (
        (entry.isFile() || entry.isSymbolicLink()) &&
        (isRepositoryProcessArtifactPath(relative) ||
          [".DS_Store", "Thumbs.db"].includes(entry.name))
      ) {
        matches.push(relative);
      }
    }
  }
  return matches;
}

function isCurrentVerificationEvidence(root) {
  try {
    readVerificationEvidence(root);
    return true;
  } catch {
    return false;
  }
}

function isActiveVerificationLock(root) {
  try {
    const lock = inspectVerificationSessionLock({ repositoryRoot: root });
    return lock.status === "active" || lock.status === "unknown";
  } catch {
    return false;
  }
}

function collectRuntimeCacheCandidates(root, candidates) {
  const cacheRelative = repositoryCodexRuntimeCacheDirectory;
  const cachePath = absolutePath(root, cacheRelative);
  const cacheStats = entryStats(cachePath);
  if (!cacheStats) return;
  if (cacheStats.isSymbolicLink() || !cacheStats.isDirectory()) {
    candidates.add(cacheRelative);
    return;
  }
  const cacheEntries = readdirSync(cachePath);
  if (cacheEntries.length === 0) {
    candidates.add(cacheRelative);
    return;
  }
  for (const name of cacheEntries) {
    const relative = `${cacheRelative}/${name}`;
    const target = absolutePath(root, relative);
    if (name !== "project-verification") {
      candidates.add(relative);
      continue;
    }
    const stats = lstatSync(target);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      candidates.add(relative);
      continue;
    }
    const verificationEntries = readdirSync(target);
    if (verificationEntries.length === 0) {
      candidates.add(relative);
      continue;
    }
    for (const entry of verificationEntries) {
      const child = `${relative}/${entry}`;
      if (child === verificationEvidencePath && isCurrentVerificationEvidence(root)) continue;
      if (child === verificationLockPath && isActiveVerificationLock(root)) continue;
      candidates.add(child);
    }
  }
}

function collectCodexCandidates(root, candidates) {
  const codexPath = path.join(root, ".codex");
  for (const name of readdirSync(codexPath)) {
    if (name !== "runtime" && !isPortableCodexPath(`.codex/${name}`)) {
      candidates.add(`.codex/${name}`);
      continue;
    }
    if (name === "agents") {
      const agentsPath = path.join(codexPath, name);
      const stats = lstatSync(agentsPath);
      if (stats.isSymbolicLink() || !stats.isDirectory()) continue;
      for (const agentName of readdirSync(agentsPath)) {
        if (!/^[a-z][a-z0-9_-]*\.toml$/u.test(agentName)) {
          candidates.add(`.codex/agents/${agentName}`);
        }
      }
    }
  }
  const runtimePath = absolutePath(root, repositoryCodexRuntimeDirectory);
  const runtimeStats = entryStats(runtimePath);
  if (!runtimeStats) return;
  if (runtimeStats.isSymbolicLink() || !runtimeStats.isDirectory()) {
    fail("Reset refused: .codex/runtime must be a real directory.");
  }
  for (const name of readdirSync(runtimePath)) {
    const relative = `${repositoryCodexRuntimeDirectory}/${name}`;
    if (preservedRuntimeFiles.has(name)) {
      requirePreservedFile(absolutePath(root, relative), relative);
    } else if (name === "cache") {
      collectRuntimeCacheCandidates(root, candidates);
    } else {
      candidates.add(relative);
    }
  }
}

function addLocalRuntimeCandidates(root, candidates) {
  for (const name of readdirSync(root)) {
    if (preservedCodexHomeFiles.has(name)) {
      requirePreservedFile(absolutePath(root, name), name);
    } else if (isRepositoryCodexHomePath(name)) candidates.add(name);
  }
  collectCodexCandidates(root, candidates);
}

function collectCandidates(root, { includeLocalRuntime = true, expectedFiles } = {}) {
  const nestedProjects = [];
  const candidates = new Set(scanSourceResidue(root, nestedProjects));
  if (resolveOwnedGitMetadata(root)) {
    const tracked = new Set(listRepositoryPathInventory({ root, includeUntracked: false }).paths);
    for (const file of listRepositoryPathInventory({ root }).paths) {
      if (
        (path.posix.extname(file) && !/\.(?:json|log|out|txt)$/iu.test(file)) ||
        tracked.has(file) ||
        nestedProjects.some((prefix) => file.startsWith(prefix)) ||
        isExcludedActivePath(file) ||
        sensitivePathReason(file) ||
        /(?:^|\/)(?:fixtures|testdata)\//u.test(file) ||
        file.split("/").some((name) => protectedSourceEntries.has(name))
      )
        continue;
      const target = absolutePath(root, file);
      const stats = entryStats(target);
      if (!stats?.isFile() || stats.nlink !== 1) continue;
      const snapshot = readOptionalOwnedFile(root, target, "untracked upgrade document");
      if (snapshot.exists && isChildMaintenanceDocument(snapshot.buffer)) {
        candidates.add(file);
        expectedFiles?.set(file, snapshot.stats);
      }
    }
  }
  if (includeLocalRuntime) addLocalRuntimeCandidates(root, candidates);
  const transactionTrees = frameworkTransactionRoots(root).map((state) =>
    relativePath(root, state),
  );
  for (const relative of [...removableTrees, ...transactionTrees]) {
    if (nestedProjects.some((prefix) => (relative + "/").startsWith(prefix))) continue;
    if (entryStats(absolutePath(root, relative))) candidates.add(relative);
  }
  for (const relative of optionalEmptyDirectories) {
    if (nestedProjects.some((prefix) => (relative + "/").startsWith(prefix))) continue;
    if (isEmptyRealDirectory(absolutePath(root, relative))) candidates.add(relative);
  }
  const ordered = [...candidates].sort();
  return ordered.filter(
    (candidate) =>
      !ordered.some(
        (parent) => parent !== candidate && candidate.startsWith(`${parent.replace(/\/$/u, "")}/`),
      ),
  );
}

function pruneEmptyParents(root, startDirectory) {
  const protectedDirectories = new Set([
    root,
    path.join(root, ".codex"),
    absolutePath(root, repositoryCodexRuntimeDirectory),
  ]);
  let current = startDirectory;
  while (current.startsWith(`${root}${path.sep}`) && !protectedDirectories.has(current)) {
    if (!isEmptyRealDirectory(current)) return;
    rmdirSync(current);
    current = path.dirname(current);
  }
}

export function removeResetCandidate(root, target, { expectedIdentity, testHooks } = {}) {
  const stats = entryStats(target);
  if (!stats) return;
  const relative = relativePath(root, target);
  const expectedType = stats.isSymbolicLink()
    ? "symlink"
    : stats.isDirectory()
      ? "directory"
      : stats.isFile()
        ? "file"
        : null;
  if (!expectedType) fail(`Reset refused special filesystem content: ${relative}.`);
  const runtime = isPrivateCodexRuntimePath(relative);
  const childMaintenance = relative === childMaintenancePath;
  const preserveProjectState = (entries, directory) =>
    containsProjectState(entries, childMaintenance ? directory : undefined);
  claimAndRemove({
    allowSymlinkEntries: runtime || childMaintenance,
    preserveDirectory: runtime ? undefined : preserveProjectState,
    artifactPath: target,
    expectedIdentity,
    expectedType,
    label: `reset candidate ${relative}`,
    ownedRootPath: root,
    ownerDevice: lstatSync(root).dev,
    testHooks,
  });
}

function applyReset(root, candidates, expectedFiles) {
  for (const relative of candidates) {
    const target = absolutePath(root, relative);
    if (!entryStats(target)) continue;
    const removalParent = realpathSync.native(path.dirname(target));
    if (removalParent !== root && !removalParent.startsWith(`${root}${path.sep}`)) {
      fail(`Reset refused a removal path whose parent escapes the framework: ${relative}.`);
    }
    removeResetCandidate(root, target, { expectedIdentity: expectedFiles.get(relative) });
    pruneEmptyParents(root, path.dirname(target));
  }
}

function updateResetCandidates(root) {
  const candidates = new Set();
  addLocalRuntimeCandidates(root, candidates);
  candidates.delete(updateResetRequest);
  for (const relative of [childMaintenancePath, projectContextRelativePath]) {
    if (entryStats(absolutePath(root, relative))) candidates.add(relative);
  }
  return [...candidates].sort();
}

/** A successful child apply arms one source-bound request. The launcher retries it after exit and
 * before the next picker. Keep the request until disposal and its residual check both succeed. */
export function settlePostUpdateReset(
  root = defaultRoot,
  { request = false, lifecycleOwner } = {},
) {
  const target = absolutePath(root, updateResetRequest);
  if (!request && !entryStats(target)) return "none";
  const canonical = requireFrameworkRoot(root);
  const owner =
    lifecycleOwner ??
    acquireRuntimeLifecycleLock({ root: canonical, operation: "framework-reset" });
  try {
    const label = "framework post-update reset request";
    const content =
      JSON.stringify({ version: 1, root: repositoryRuntimeRootIdentity(canonical) }) + "\n";
    const readRequest = () =>
      readOptionalOwnedFile(canonical, target, label, { maximumBytes: 8192 });
    let pending = readRequest();
    if (!pending.exists) {
      if (!request) return "none";
      atomicWriteOwnedFile(canonical, target, content, 0o600, { label, exactMode: true });
      pending = readRequest();
    }
    if (!pending.exists || pending.buffer.toString("utf8") !== content)
      fail("Invalid framework post-update reset request.");
    requirePreservedFile(target, label);

    const inventory = inspectRepositoryWorktrees({ root: canonical });
    const handovers = absolutePath(canonical, criticalHandoverDirectory);
    if (
      !inventory.complete ||
      inventory.worktrees.some(
        (worktree) => !worktree.available || !["absent", "stale"].includes(worktree.session.status),
      ) ||
      openFrameworkRuntimeStatus(canonical) !== "inactive" ||
      !["absent", "stale"].includes(
        inspectVerificationSessionLock({ repositoryRoot: canonical }).status,
      ) ||
      unsettledTransaction(canonical) ||
      (entryStats(handovers) && !isEmptyRealDirectory(handovers)) ||
      hasPendingAccountPause({ root: canonical })
    )
      return "pending";
    // The requested session reset includes abandoned local work notes after all owners exit.
    applyReset(canonical, updateResetCandidates(canonical), new Map());
    if (updateResetCandidates(canonical).length) fail("Framework post-update reset is incomplete.");
    removeOwnedRegularFile(canonical, target, label, { expectedIdentity: pending.stats });
    return "complete";
  } finally {
    if (!lifecycleOwner) releaseRuntimeLifecycleLock({ root: canonical, owner });
  }
}

/** Admit the source reset before mutating a target. A busy source leaves the target retryable. */
export async function applyWithPostUpdateReset(root, apply) {
  const canonical = requireFrameworkRoot(root);
  const owner = acquireRuntimeLifecycleLock({ root: canonical, operation: "framework-reset" });
  try {
    const result = await apply();
    if (!result.changed) return "none";
    try {
      return settlePostUpdateReset(canonical, { request: true, lifecycleOwner: owner });
    } catch (error) {
      throw new Error(
        `Project update applied. Framework session reset needs attention: ${error.message}`,
        { cause: error },
      );
    }
  } finally {
    releaseRuntimeLifecycleLock({ root: canonical, owner });
  }
}

function printPreview(candidates, applyArguments = "--apply") {
  if (candidates.length > 0) {
    console.log("Framework reset would remove:");
    for (const candidate of candidates) console.log(`- ${candidate}`);
  }
  console.log(`Re-run with ${applyArguments} after reviewing this list.`);
}

function verificationSourceCandidates(root) {
  const candidates = collectCandidates(root, { includeLocalRuntime: false });
  if (
    candidates.includes(projectContextRelativePath) &&
    inspectRuntimeSessionLease({ root }).status === "active"
  ) {
    const context = readProjectWorkContext(root);
    if (context && context.state.status !== "complete") {
      return candidates.filter((candidate) => candidate !== projectContextRelativePath);
    }
  }
  return candidates;
}

export function runFrameworkReset(args) {
  const options = parseArgs(args);
  const root = requireFrameworkRoot(options.root);
  if (options.verificationSourceBaseline && !isActiveVerificationLock(root)) {
    fail("Verification source baseline requires the active repository verification lock.");
  }
  const publicationSession = options.publication ? inspectPublicationSession(root) : null;
  const fullReset = !options.verificationSourceBaseline && !publicationSession;
  // Preview is strictly read-only; every mutating reset mode holds the shared capability through
  // planning, apply, and the residual recheck.
  const lifecycleOwner = options.apply
    ? acquireRuntimeLifecycleLock({ root, operation: "framework-reset" })
    : null;
  try {
    if (fullReset && options.apply && isActiveVerificationLock(root)) {
      fail("Reset refused while a repository verification session is active.");
    }
    const includeLocalRuntime = fullReset;
    const expectedFiles = new Map();
    const candidates = options.publication
      ? inspectFrameworkPublicationReset(root, expectedFiles)
      : fullReset
        ? inspectFrameworkReset(root, expectedFiles)
        : verificationSourceCandidates(root);

    if (!options.apply) {
      if (candidates.length === 0) {
        console.log(
          fullReset
            ? "Framework baseline is clean."
            : options.publication
              ? "Framework publication source baseline is clean."
              : "Framework verification source baseline is clean.",
        );
        return;
      }
      printPreview(candidates);
      process.exitCode = 1;
      return;
    }

    if (
      options.publication &&
      JSON.stringify(inspectPublicationSession(root)) !== JSON.stringify(publicationSession)
    )
      fail("Publication session changed before source cleanup.");
    applyReset(root, candidates, expectedFiles);
    const residual = collectCandidates(root, { includeLocalRuntime });
    if (residual.length > 0) fail(`Reset left removable state: ${residual.join(", ")}`);
    console.log(`Framework reset complete; removed ${candidates.length} path(s).`);
    console.log(
      "Source, portable .codex policy, required runtime identity, and exact verification evidence were preserved.",
    );
  } finally {
    if (lifecycleOwner) releaseRuntimeLifecycleLock({ root, owner: lifecycleOwner });
  }
}
