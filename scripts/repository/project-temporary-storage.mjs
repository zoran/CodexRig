/** Owns project temporary storage per execution and conservative recovery of abandoned scratch. */
import { randomBytes } from "node:crypto";
import {
  closeSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  atomicWriteOwnedFile,
  createExclusiveOwnedDirectory,
  readOptionalOwnedFile,
} from "../filesystem/owned-file-operations.mjs";
import {
  claimAndRemove,
  sameObjectIdentity,
  validateDirectoryChain,
  validateRemovalTree,
} from "../filesystem/owned-path-safety.mjs";
import {
  captureProcessIdentity,
  inspectProcessIdentity,
  isCurrentProcessDescendantOf,
  inspectLinuxOpenRepositoryPaths,
} from "./runtime-process-identity.mjs";

// Bound path overhead for native Unix sockets. Exclusive creation, inode and process identities
// establish ownership, not guessing resistance of the short random directory name.
const directoryPattern = /^run-[a-f0-9]{16}$/u;
const markerName = "owner.json";
const temporaryKeys = ["TMPDIR", "TMP", "TEMP", "MISE_TMP_DIR"];

function identity(stats) {
  return { device: String(stats.dev), inode: String(stats.ino) };
}

function inside(parent, value) {
  if (!path.isAbsolute(value)) return false;
  const relative = path.relative(parent, value);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function privateDirectory(root, directory) {
  validateDirectoryChain(root, directory, "project temporary storage");
  const stats = lstatSync(directory);
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    (stats.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && stats.uid !== process.getuid())
  )
    throw new Error("Project temporary storage must be private and repository-owned.");
  return stats;
}

function readScope(root, parent, directory) {
  privateDirectory(root, parent);
  if (path.dirname(directory) !== parent || !directoryPattern.test(path.basename(directory)))
    throw new Error("Temporary scope path is invalid.");
  const stats = privateDirectory(root, directory);
  const snapshot = readOptionalOwnedFile(
    root,
    path.join(directory, markerName),
    "temporary owner",
    { maximumBytes: 4096 },
  );
  if (!snapshot.exists || (snapshot.stats.mode & 0o077) !== 0)
    throw new Error("Temporary scope ownership is unavailable.");
  const record = JSON.parse(snapshot.buffer.toString("utf8"));
  if (
    Object.keys(record).sort().join(",") !== "directory,owner,purpose,root,schemaVersion" ||
    record.schemaVersion !== 1 ||
    !["command", "session"].includes(record.purpose) ||
    record.root?.path !== root ||
    realpathSync.native(root) !== root ||
    JSON.stringify(record.root) !== JSON.stringify({ path: root, ...identity(lstatSync(root)) }) ||
    JSON.stringify(record.directory) !== JSON.stringify(identity(stats))
  )
    throw new Error("Temporary scope identity changed.");
  const ownerStatus = inspectProcessIdentity(record.owner);
  return { directory, stats, snapshot, record, ownerStatus };
}

/** Carries only an authenticated ancestor's scratch across nested clean environment boundaries. */
export function inheritedProjectTemporaryDirectory(root, parent, inherited) {
  const candidate = inherited?.TMPDIR;
  if (typeof candidate !== "string" || path.basename(candidate) !== "files") return parent;
  const directory = path.dirname(candidate);
  if (path.dirname(directory) !== parent || !directoryPattern.test(path.basename(directory)))
    return parent;
  const scope = readScope(root, parent, directory);
  if (scope.ownerStatus !== "active" || !isCurrentProcessDescendantOf(scope.record.owner))
    return parent;
  privateDirectory(root, candidate);
  return candidate;
}

/** Changes only scratch variables; credentials, caches and durable tool installations stay separate. */
export function temporaryEnvironment(environment, directory) {
  return { ...environment, ...Object.fromEntries(temporaryKeys.map((key) => [key, directory])) };
}

/** Normalizes an admitted ephemeral location, never caller-selected tools or execution controls. */
export function temporaryEnvironmentIdentity(root, parent, environment) {
  const directory = inheritedProjectTemporaryDirectory(root, parent, environment);
  if (directory === parent) return environment;
  return temporaryEnvironment(environment, parent);
}

function processTemporaryUsers(root, directory) {
  if (process.platform !== "linux") return "unknown";
  let unknown = false;
  const environmentBuffer = Buffer.alloc(1024 * 1024 + 1);
  for (const name of readdirSync("/proc")) {
    if (!/^[1-9]\d*$/u.test(name) || Number(name) === process.pid) continue;
    let descriptor;
    let repositoryBound = false;
    try {
      if (
        typeof process.getuid === "function" &&
        statSync(`/proc/${name}`).uid !== process.getuid()
      )
        continue;
      const cwd = readlinkSync(`/proc/${name}/cwd`);
      repositoryBound = inside(root, cwd);
      if (inside(directory, cwd)) return "active";
      // Inspect only temporary-path fields, never log or retain another process's environment.
      descriptor = openSync(`/proc/${name}/environ`, "r");
      const bytes = readSync(descriptor, environmentBuffer, 0, environmentBuffer.length, 0);
      if (bytes === environmentBuffer.length) {
        if (repositoryBound) unknown = true;
        continue;
      }
      for (const field of environmentBuffer.subarray(0, bytes).toString("utf8").split("\0")) {
        const equals = field.indexOf("=");
        if (
          temporaryKeys.includes(field.slice(0, equals)) &&
          inside(directory, field.slice(equals + 1))
        )
          return "active";
      }
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ESRCH") continue;
      if (error.code === "EACCES" || error.code === "EPERM") {
        if (repositoryBound) unknown = true;
      } else throw error;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      environmentBuffer.fill(0);
    }
  }
  const openPaths = inspectLinuxOpenRepositoryPaths({
    root,
    matchesPath: (relative) => inside(directory, path.join(root, relative)),
  });
  if (openPaths.status === "active") return "active";
  return unknown || openPaths.status === "unknown" ? "unknown" : "inactive";
}

function assertDisposableTree(root, scope, protectedPaths) {
  if (protectedPaths.some((value) => inside(scope.directory, value)))
    throw new Error("Temporary storage contains a registered worktree.");
  validateRemovalTree(scope.directory, "directory", "temporary scope", lstatSync(root).dev, {
    allowSymlinkEntries: true,
    allowHardlinkEntries: true,
  });
  const pending = [scope.directory];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      // A .git file points to a linked worktree or submodule managed outside this disposable tree.
      if (entry.name === ".git" && !entry.isDirectory())
        throw new Error(
          "Temporary storage contains a linked Git directory; retain it for its owner.",
        );
      if (entry.isDirectory()) pending.push(path.join(directory, entry.name));
    }
  }
}

function removeScope(root, parent, scope, protectedPaths, testHooks) {
  assertDisposableTree(root, scope, protectedPaths);
  const current = readScope(root, parent, scope.directory);
  if (
    !sameObjectIdentity(scope.stats, current.stats) ||
    !scope.snapshot.buffer.equals(current.snapshot.buffer)
  )
    throw new Error("Temporary scope changed before cleanup.");
  if (processTemporaryUsers(root, scope.directory) !== "inactive") return false;
  // Keep the scope and its ownership marker discoverable until all payload (including a previous
  // interrupted removal claim) is gone. Claiming the whole scope first would orphan gigabytes if
  // the process died during recursive removal, outside the recognized execution namespace.
  for (const entry of readdirSync(scope.directory, { withFileTypes: true })) {
    if (entry.name === markerName) continue;
    const payload = path.join(scope.directory, entry.name);
    claimAndRemove({
      artifactPath: payload,
      expectedType: entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file",
      expectedIdentity: lstatSync(payload),
      ownedRootPath: root,
      ownerDevice: lstatSync(root).dev,
      allowSymlinkEntries: true,
      allowHardlinkEntries: true,
      label: "completed temporary payload",
      testHooks,
    });
  }
  const terminal = readScope(root, parent, scope.directory);
  if (!scope.snapshot.buffer.equals(terminal.snapshot.buffer))
    throw new Error("Temporary scope ownership changed during cleanup.");
  claimAndRemove({
    artifactPath: scope.directory,
    expectedType: "directory",
    expectedIdentity: terminal.stats,
    ownedRootPath: root,
    ownerDevice: lstatSync(root).dev,
    allowSymlinkEntries: true,
    // Unlinking a scratch copy never writes through either kind of link to its retained target.
    allowHardlinkEntries: true,
    label: "completed project temporary scope",
  });
  return true;
}

/** Registers one execution's private scratch before its child starts. No old data is adopted. */
export function createProjectTemporaryScope({
  root,
  parent,
  purpose = "command",
  protectedPaths = [],
}) {
  privateDirectory(root, parent);
  if (!["command", "session"].includes(purpose))
    throw new Error("Temporary scope purpose is invalid.");
  reconcileProjectTemporaryStorage({ root, parent, apply: true, protectedPaths });
  const owner = captureProcessIdentity(process.pid);
  if (!owner) throw new Error("Temporary scope requires a live owner.");
  const directory = createExclusiveOwnedDirectory(
    root,
    path.join(parent, `run-${randomBytes(8).toString("hex")}`),
    "project temporary scope",
  );
  const files = createExclusiveOwnedDirectory(
    root,
    path.join(directory, "files"),
    "project temporary files",
  );
  atomicWriteOwnedFile(
    root,
    path.join(directory, markerName),
    `${JSON.stringify({
      schemaVersion: 1,
      root: { path: root, ...identity(lstatSync(root)) },
      directory: identity(lstatSync(directory)),
      owner,
      purpose,
    })}\n`,
    0o600,
  );
  return Object.freeze({
    directory: files,
    release({ testHooks } = {}) {
      const scope = readScope(root, parent, directory);
      if (
        JSON.stringify(scope.record.owner) !== JSON.stringify(owner) ||
        inspectProcessIdentity(owner) !== "active"
      )
        throw new Error("Temporary scope release lost its owner.");
      return removeScope(root, parent, scope, protectedPaths, testHooks);
    },
  });
}

/** Reclaims only exact dead owners with no remaining users; ambiguous and legacy data is reported. */
export function reconcileProjectTemporaryStorage({
  root,
  parent,
  apply = false,
  protectedPaths = [],
}) {
  if (!lstatSync(parent, { throwIfNoEntry: false })) return [];
  privateDirectory(root, parent);
  const results = [];
  for (const name of readdirSync(parent)) {
    if (!directoryPattern.test(name)) continue;
    const directory = path.join(parent, name);
    const result = {
      path: path.relative(root, directory),
      status: "retained",
      reason: "unverified ownership",
    };
    try {
      const scope = readScope(root, parent, directory);
      result.reason = `${scope.ownerStatus} owner`;
      if (scope.ownerStatus === "stale") {
        assertDisposableTree(root, scope, protectedPaths);
        const users = processTemporaryUsers(root, directory);
        result.reason = `${users} consumers`;
        if (users === "inactive") {
          result.status =
            apply && removeScope(root, parent, scope, protectedPaths) ? "removed" : "eligible";
        }
      }
    } catch {
      // Private marker contents and file names below the scope are never diagnostics.
      result.reason = "unsafe or unverified ownership/tree; owner reconciliation required";
    }
    results.push(result);
  }
  return results;
}
