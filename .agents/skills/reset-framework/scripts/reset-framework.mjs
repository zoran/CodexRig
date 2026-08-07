#!/usr/bin/env node
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { removeOwnedContextIndex } from "../../../../scripts/context/clean-context-index.mjs";
import { isRepositoryProcessArtifactPath } from "../../../../scripts/docs/document-scope.mjs";
import {
  isPrivateCodexRuntimePath,
  isRepositoryCodexHomePath,
  repositoryCodexRuntimeCacheDirectory,
  repositoryCodexRuntimeDirectory,
} from "../../../../scripts/repository/source-inventory.mjs";
import { inspectRuntimeSessionLease } from "../../../../scripts/setup/startup-attestation.mjs";

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
const preservedRuntimeFiles = new Set(["auth.json", "config.toml", "installation_id"]);
// Source order is migration policy: the immediately previous root CODEX_HOME wins over older
// abandoned `.codex/*` copies when no canonical `.codex/runtime/*` identity exists yet.
const migrationContracts = Object.freeze([
  {
    sources: ["auth.json", ".codex/auth.json"],
    target: `${repositoryCodexRuntimeDirectory}/auth.json`,
  },
  {
    sources: ["config.toml"],
    target: `${repositoryCodexRuntimeDirectory}/config.toml`,
  },
  {
    sources: ["installation_id", ".codex/installation_id"],
    target: `${repositoryCodexRuntimeDirectory}/installation_id`,
  },
]);

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {
    apply: false,
    portableSourceBaseline: false,
    root: defaultRoot,
    verificationSourceBaseline: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") options.apply = true;
    else if (argument === "--portable-source-baseline") options.portableSourceBaseline = true;
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
  if (
    (options.apply && (options.portableSourceBaseline || options.verificationSourceBaseline)) ||
    (options.portableSourceBaseline && options.verificationSourceBaseline)
  ) {
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

function processStatus(pid) {
  try {
    process.kill(pid, 0);
    return "active";
  } catch (error) {
    return error?.code === "ESRCH" ? "stale" : "unknown";
  }
}

function linuxProcessHasOpenRuntime(root, processId) {
  const processPath = `/proc/${processId}`;
  try {
    if (typeof process.getuid === "function" && statSync(processPath).uid !== process.getuid()) {
      return false;
    }
    const descriptors = readdirSync(path.join(processPath, "fd"));
    for (const descriptor of descriptors) {
      let target;
      try {
        target = readlinkSync(path.join(processPath, "fd", descriptor)).replace(
          / \(deleted\)$/u,
          "",
        );
      } catch (error) {
        if (["EACCES", "ENOENT"].includes(error?.code)) continue;
        throw error;
      }
      if (!path.isAbsolute(target)) continue;
      const relative = relativePath(root, target);
      if (!relative.startsWith("../") && isPrivateCodexRuntimePath(relative)) return true;
    }
  } catch (error) {
    if (["EACCES", "ENOENT", "EPERM"].includes(error?.code)) return false;
    throw error;
  }
  return false;
}

function hasOpenLegacyRuntime(root) {
  if (process.platform !== "linux" || !entryStats("/proc")) return false;
  for (const name of readdirSync("/proc")) {
    if (!/^[1-9]\d*$/u.test(name) || Number(name) === process.pid) continue;
    if (linuxProcessHasOpenRuntime(root, name)) return true;
  }
  return false;
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
  if (hasOpenLegacyRuntime(root)) {
    fail("Reset refused while another process still has framework runtime files open.");
  }
  const runtimeStats = entryStats(runtimePath);
  if (runtimeStats && (runtimeStats.isSymbolicLink() || !runtimeStats.isDirectory())) {
    fail("Reset refused: .codex/runtime must be a real directory.");
  }
  const lease = inspectRuntimeSessionLease({ root });
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

function sameFiles(left, right) {
  const leftStats = requirePreservedFile(left, relativePath(path.dirname(left), left));
  const rightStats = requirePreservedFile(right, relativePath(path.dirname(right), right));
  return leftStats.size === rightStats.size && readFileSync(left).equals(readFileSync(right));
}

function ensureRuntimeDirectory(root) {
  const runtimePath = absolutePath(root, repositoryCodexRuntimeDirectory);
  const stats = entryStats(runtimePath);
  if (stats) {
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      fail("Reset refused: .codex/runtime must be a real directory.");
    }
  } else {
    mkdirSync(runtimePath, { mode: 0o700 });
  }
  chmodSync(runtimePath, 0o700);
  return runtimePath;
}

function planMigrations(root) {
  const migrations = [];
  for (const contract of migrationContracts) {
    const target = absolutePath(root, contract.target);
    const existingSources = contract.sources
      .map((relative) => ({ absolute: absolutePath(root, relative), relative }))
      .filter(({ absolute }) => entryStats(absolute));
    if (entryStats(target)) {
      requirePreservedFile(target, contract.target);
      for (const source of existingSources) {
        requirePreservedFile(source.absolute, source.relative);
        if (!sameFiles(source.absolute, target)) {
          fail(
            `Reset refused conflicting runtime identity: ${source.relative} and ${contract.target}.`,
          );
        }
      }
      continue;
    }
    const source = existingSources[0];
    if (source) {
      requirePreservedFile(source.absolute, source.relative);
      migrations.push({ from: source.relative, to: contract.target });
    }
  }
  return migrations;
}

function applyMigrations(root, migrations) {
  if (migrations.length === 0) return;
  ensureRuntimeDirectory(root);
  for (const migration of migrations) {
    const source = absolutePath(root, migration.from);
    const target = absolutePath(root, migration.to);
    requirePreservedFile(source, migration.from);
    if (entryStats(target)) fail(`Migration target appeared during reset: ${migration.to}.`);
    renameSync(source, target);
    chmodSync(target, 0o600);
  }
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

function isPreservedEvidence(target) {
  const stats = entryStats(target, { bigint: true });
  return (
    stats &&
    !stats.isSymbolicLink() &&
    stats.isFile() &&
    stats.nlink === 1n &&
    stats.size <= 1024n * 1024n &&
    (stats.mode & 0o022n) === 0n &&
    (typeof process.getuid !== "function" || stats.uid === BigInt(process.getuid()))
  );
}

function isActiveVerificationLock(target) {
  const stats = entryStats(target, { bigint: true });
  if (!stats) return false;
  if (stats.isSymbolicLink() || !stats.isDirectory() || (stats.mode & 0o022n) !== 0n) return false;
  const entries = readdirSync(target);
  if (entries.length !== 1 || entries[0] !== "owner.json") return false;
  const ownerPath = path.join(target, "owner.json");
  const ownerStats = lstatSync(ownerPath, { bigint: true });
  if (
    ownerStats.isSymbolicLink() ||
    !ownerStats.isFile() ||
    ownerStats.nlink !== 1n ||
    ownerStats.size > 4_096n ||
    (ownerStats.mode & 0o077n) !== 0n
  ) {
    return false;
  }
  try {
    const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
    return (
      Number.isSafeInteger(owner?.pid) && owner.pid > 0 && processStatus(owner.pid) !== "stale"
    );
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
      const childPath = absolutePath(root, child);
      if (child === verificationEvidencePath && isPreservedEvidence(childPath)) continue;
      if (child === verificationLockPath && isActiveVerificationLock(childPath)) continue;
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

async function applyReset(root, migrations, candidates) {
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
    } else if (indexStats) {
      rmSync(indexDirectory, { force: true, recursive: true });
    }
  }
  applyMigrations(root, migrations);
  for (const relative of candidates) {
    if (relative === ".context-index") continue;
    const target = absolutePath(root, relative);
    if (!entryStats(target)) continue;
    const removalParent = realpathSync.native(path.dirname(target));
    if (removalParent !== root && !removalParent.startsWith(`${root}${path.sep}`)) {
      fail(`Reset refused a removal path whose parent escapes the framework: ${relative}.`);
    }
    rmSync(target, { force: true, recursive: true });
    pruneEmptyParents(root, path.dirname(target));
  }
}

function printPreview(migrations, candidates) {
  if (migrations.length > 0) {
    console.log("Framework reset would preserve runtime identity by migrating:");
    for (const migration of migrations) console.log(`- ${migration.from} -> ${migration.to}`);
  }
  if (candidates.length > 0) {
    console.log("Framework reset would remove:");
    for (const candidate of candidates) console.log(`- ${candidate}`);
  }
  console.log("Re-run with --apply after reviewing this list.");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = requireFrameworkRoot(options.root);
  if (
    options.verificationSourceBaseline &&
    !isActiveVerificationLock(absolutePath(root, verificationLockPath))
  ) {
    fail("Verification source baseline requires the active repository verification lock.");
  }
  const reducedSourceBaseline =
    options.portableSourceBaseline || options.verificationSourceBaseline;
  if (!reducedSourceBaseline) assertRuntimeInactive(root);
  const migrations = reducedSourceBaseline ? [] : planMigrations(root);
  const candidates = collectCandidates(root, {
    includeLocalRuntime: !reducedSourceBaseline,
  });

  if (!options.apply) {
    if (migrations.length === 0 && candidates.length === 0) {
      console.log(
        reducedSourceBaseline
          ? "Framework portable source baseline is clean."
          : "Framework baseline is clean.",
      );
      return;
    }
    printPreview(migrations, candidates);
    process.exitCode = 1;
    return;
  }

  await applyReset(root, migrations, candidates);
  const residualMigrations = planMigrations(root);
  const residual = collectCandidates(root);
  if (residualMigrations.length > 0 || residual.length > 0) {
    fail(
      `Reset left removable state: ${[
        ...residualMigrations.map(({ from }) => from),
        ...residual,
      ].join(", ")}`,
    );
  }
  console.log(
    `Framework reset complete; migrated ${migrations.length} and removed ${candidates.length} path(s).`,
  );
  console.log(
    "Source, portable .codex policy, required runtime identity, and exact verification evidence were preserved.",
  );
}

try {
  await main();
} catch (error) {
  console.error(`Framework reset failed: ${error.message}`);
  process.exit(1);
}
