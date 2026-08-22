#!/usr/bin/env node
/** Owns reset framework behavior for the reusable framework reset boundary. */
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { removeOwnedContextIndex } from "../../../../scripts/context/clean-context-index.mjs";
import { isRepositoryProcessArtifactPath } from "../../../../scripts/docs/document-scope.mjs";
import { claimAndRemove } from "../../../../scripts/filesystem/owned-path-safety.mjs";
import {
  isPrivateCodexRuntimePath,
  isRepositoryCodexHomePath,
  repositoryCodexRuntimeCacheDirectory,
  repositoryCodexRuntimeDirectory,
} from "../../../../scripts/repository/source-inventory.mjs";
import { inspectLinuxOpenRepositoryPaths } from "../../../../scripts/repository/runtime-process-identity.mjs";
import {
  acquireRuntimeLifecycleLock,
  inspectRuntimeSessionLease,
  invalidRuntimeSessionLeaseErrorCode,
  releaseRuntimeLifecycleLock,
  runtimeLifecycleGuardName,
  runtimeLifecycleLockName,
} from "../../../../scripts/repository/runtime-session-lease.mjs";
import { readVerificationEvidence } from "../../../../scripts/verify/verification-evidence-store.mjs";
import { inspectVerificationSessionLock } from "../../../../scripts/verify/verification-session-lock.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDirectory, "..", "..", "..", "..");
const verificationEvidencePath = `${repositoryCodexRuntimeCacheDirectory}/project-verification/evidence.json`;
const verificationLockPath = `${repositoryCodexRuntimeCacheDirectory}/project-verification/session.lock`;
const removableTrees = [
  ".context-index",
  ".project-state",
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
const scanExcludedDirectories = new Set([
  ".codex",
  ".context-index",
  ".git",
  ".project-state",
  "node_modules",
]);
const portableCodexEntries = new Set([
  "README.md",
  "agents",
  "config.toml",
  "hooks.json",
  "runtime",
]);
const preservedRuntimeFiles = new Set([
  "auth.json",
  "config.toml",
  "installation_id",
  runtimeLifecycleGuardName,
  runtimeLifecycleLockName,
]);

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {
    apply: false,
    portableSourceBaseline: false,
    postProjectCreation: false,
    root: defaultRoot,
    verificationSourceBaseline: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") options.apply = true;
    else if (argument === "--portable-source-baseline") options.portableSourceBaseline = true;
    else if (argument === "--post-project-creation") options.postProjectCreation = true;
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
  const selectedModes = [
    options.portableSourceBaseline,
    options.postProjectCreation,
    options.verificationSourceBaseline,
  ].filter(Boolean).length;
  if (selectedModes > 1) {
    fail("Reset modes are mutually exclusive.");
  }
  if (options.apply && (options.portableSourceBaseline || options.verificationSourceBaseline)) {
    fail("Source-baseline modes are read-only, mutually exclusive, and cannot use --apply.");
  }
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
  const configuredHome = process.env.CODEX_HOME?.trim();
  if (configuredHome) {
    const resolvedHome = path.resolve(configuredHome);
    if (resolvedHome === root || resolvedHome === runtimePath) {
      fail("Reset refused while this Codex session owns the framework runtime; exit Codex first.");
    }
  }
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

function scanProcessDocuments(root) {
  const matches = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      const relative = relativePath(root, target);
      if (entry.isSymbolicLink()) continue;
      if (isRepositoryCodexHomePath(relative)) continue;
      if (entry.isDirectory()) {
        if (!scanExcludedDirectories.has(entry.name) && relative !== "dist/exports") {
          pending.push(target);
        }
      } else if (entry.isFile() && isRepositoryProcessArtifactPath(relative)) {
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
    if (!portableCodexEntries.has(name)) {
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

function collectCandidates(root, { includeLocalRuntime = true } = {}) {
  const candidates = new Set(scanProcessDocuments(root));
  if (includeLocalRuntime) {
    for (const name of readdirSync(root)) {
      if (isRepositoryCodexHomePath(name)) candidates.add(name);
    }
    collectCodexCandidates(root, candidates);
  }
  for (const relative of removableTrees) {
    if (!includeLocalRuntime && relative === ".context-index") continue;
    if (entryStats(absolutePath(root, relative))) candidates.add(relative);
  }
  for (const relative of optionalEmptyDirectories) {
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

export function removeResetCandidate(root, target, { testHooks } = {}) {
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
  claimAndRemove({
    // Codex launcher/plugin temp trees intentionally contain executable wrapper links. Other reset
    // candidates retain the generic fail-closed policy for nested symlinks.
    allowSymlinkEntries: isPrivateCodexRuntimePath(relative),
    artifactPath: target,
    expectedType,
    label: `reset candidate ${relative}`,
    ownedRootPath: root,
    ownerDevice: lstatSync(root).dev,
    testHooks,
  });
}

async function applyReset(root, candidates) {
  if (candidates.includes(".context-index")) {
    const indexDirectory = path.join(root, ".context-index");
    const indexStats = entryStats(indexDirectory);
    if (indexStats?.isDirectory() && !indexStats.isSymbolicLink()) {
      await removeOwnedContextIndex({
        repositoryRoot: root,
        indexDirectory,
        rebuildLockPath: absolutePath(
          root,
          `${repositoryCodexRuntimeCacheDirectory}/context-index-rebuild.lock`,
        ),
      });
    } else if (indexStats) removeResetCandidate(root, indexDirectory);
  }
  for (const relative of candidates) {
    if (relative === ".context-index") continue;
    const target = absolutePath(root, relative);
    if (!entryStats(target)) continue;
    const removalParent = realpathSync.native(path.dirname(target));
    if (removalParent !== root && !removalParent.startsWith(`${root}${path.sep}`)) {
      fail(`Reset refused a removal path whose parent escapes the framework: ${relative}.`);
    }
    removeResetCandidate(root, target);
    pruneEmptyParents(root, path.dirname(target));
  }
}

function printPreview(candidates, applyArguments = "--apply") {
  if (candidates.length > 0) {
    console.log("Framework reset would remove:");
    for (const candidate of candidates) console.log(`- ${candidate}`);
  }
  console.log(`Re-run with ${applyArguments} after reviewing this list.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = requireFrameworkRoot(options.root);
  if (options.verificationSourceBaseline && !isActiveVerificationLock(root)) {
    fail("Verification source baseline requires the active repository verification lock.");
  }
  const reducedSourceBaseline =
    options.portableSourceBaseline || options.verificationSourceBaseline;
  const activeSessionCleanup = options.postProjectCreation;
  const fullReset = !reducedSourceBaseline && !activeSessionCleanup;
  // Preview is strictly read-only; every mutating reset mode holds the shared capability through
  // planning, apply, and the residual recheck.
  const lifecycleOwner =
    options.apply && !reducedSourceBaseline
      ? acquireRuntimeLifecycleLock({ root, operation: "framework-reset" })
      : null;
  try {
    if (fullReset) {
      assertRuntimeInactive(root);
      if (options.apply && isActiveVerificationLock(root)) {
        fail("Reset refused while a repository verification session is active.");
      }
    }
    const includeLocalRuntime = fullReset;
    const candidates = collectCandidates(root, {
      includeLocalRuntime,
    });

    if (!options.apply) {
      if (candidates.length === 0) {
        console.log(
          reducedSourceBaseline
            ? "Framework portable source baseline is clean."
            : activeSessionCleanup
              ? "Framework active-session cleanup is clean; local runtime and .context-index are deferred until Codex exits."
              : "Framework baseline is clean.",
        );
        return;
      }
      printPreview(
        candidates,
        activeSessionCleanup ? "--post-project-creation --apply" : "--apply",
      );
      process.exitCode = 1;
      return;
    }

    await applyReset(root, candidates);
    const residual = collectCandidates(root, { includeLocalRuntime });
    if (residual.length > 0) fail(`Reset left removable state: ${residual.join(", ")}`);
    if (activeSessionCleanup) {
      console.log(
        `Framework active-session cleanup complete; removed ${candidates.length} safe path(s).`,
      );
      console.log(
        "Local runtime and .context-index were preserved for the mandatory post-exit reset.",
      );
    } else {
      console.log(`Framework reset complete; removed ${candidates.length} path(s).`);
      console.log(
        "Source, portable .codex policy, required runtime identity, and exact verification evidence were preserved.",
      );
    }
  } finally {
    if (lifecycleOwner) releaseRuntimeLifecycleLock({ root, owner: lifecycleOwner });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`Framework reset failed: ${error.message}`);
    process.exit(1);
  }
}
