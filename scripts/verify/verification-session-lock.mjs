import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  repositoryCodexRuntimeCacheDirectory,
  repositoryCodexRuntimeDirectory,
} from "../repository/source-inventory.mjs";
import { root as defaultRoot } from "./adaptive-state.mjs";
import { runHeldVerificationCommand } from "./verification-executor.mjs";

const capabilities = new Map();
const ownerFileName = "owner.json";
const lockedMessage =
  "Verification session is already locked; do not overlap full, changed, closure, pre-push, or publication workflows.";

function directoryIdentity(directoryPath, label, { strict = false } = {}) {
  const stats = lstatSync(directoryPath, { bigint: true });
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    (typeof process.getuid === "function" && stats.uid !== BigInt(process.getuid())) ||
    (stats.mode & BigInt(strict ? 0o022 : 0o002)) !== 0n
  ) {
    throw new Error(`Verification session rejected the unsafe ${label} directory.`);
  }
  return `${stats.dev}:${stats.ino}`;
}

function ensureDirectory(directoryPath, label, strict = false) {
  if (!existsSync(directoryPath)) mkdirSync(directoryPath, { mode: 0o700 });
  return directoryIdentity(directoryPath, label, { strict });
}

function processStatus(pid) {
  try {
    process.kill(pid, 0);
    return "live";
  } catch (error) {
    return error?.code === "ESRCH" ? "absent" : "unknown";
  }
}

function readOwner(lockPath, expectedLockIdentity) {
  const ownerPath = path.join(lockPath, ownerFileName);
  const initial = lstatSync(ownerPath, { bigint: true });
  if (
    initial.isSymbolicLink() ||
    !initial.isFile() ||
    initial.nlink !== 1n ||
    initial.size > 4_096n ||
    (initial.mode & 0o077n) !== 0n
  ) {
    throw new Error("Verification session lock owner is unsafe.");
  }
  const descriptor = openSync(ownerPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (
      opened.dev !== initial.dev ||
      opened.ino !== initial.ino ||
      opened.size !== initial.size ||
      opened.nlink !== 1n
    ) {
      throw new Error("Verification session lock owner changed while opening.");
    }
    const raw = readFileSync(descriptor, "utf8");
    const after = fstatSync(descriptor, { bigint: true });
    if (
      after.dev !== initial.dev ||
      after.ino !== initial.ino ||
      after.size !== initial.size ||
      directoryIdentity(lockPath, "lock", { strict: true }) !== expectedLockIdentity
    ) {
      throw new Error("Verification session lock owner changed while reading.");
    }
    const owner = JSON.parse(raw);
    if (
      !owner ||
      typeof owner !== "object" ||
      Array.isArray(owner) ||
      Object.keys(owner).sort().join("\n") !== "pid\nstartedAt\ntoken" ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0 ||
      typeof owner.startedAt !== "string" ||
      !Number.isFinite(Date.parse(owner.startedAt)) ||
      typeof owner.token !== "string" ||
      !/^[a-f0-9-]{36}$/u.test(owner.token)
    ) {
      throw new Error("Verification session lock owner is invalid.");
    }
    return Object.freeze({
      fileIdentity: `${initial.dev}:${initial.ino}`,
      owner: Object.freeze(owner),
    });
  } finally {
    closeSync(descriptor);
  }
}

function sameOwner(left, right) {
  return (
    left.fileIdentity === right.fileIdentity &&
    left.owner.pid === right.owner.pid &&
    left.owner.startedAt === right.owner.startedAt &&
    left.owner.token === right.owner.token
  );
}

function reclaimStaleLock({ lockPath, stateDirectory, stateIdentity }) {
  try {
    if (
      directoryIdentity(stateDirectory, "verification state", { strict: true }) !== stateIdentity
    ) {
      return false;
    }
    const lockIdentity = directoryIdentity(lockPath, "lock", { strict: true });
    if (readdirSync(lockPath).join("\n") !== ownerFileName) return false;
    const before = readOwner(lockPath, lockIdentity);
    if (processStatus(before.owner.pid) !== "absent") return false;
    const stalePath = path.join(stateDirectory, `.session.lock.stale-${randomUUID()}`);
    renameSync(lockPath, stalePath);
    try {
      if (
        directoryIdentity(stalePath, "stale lock", { strict: true }) !== lockIdentity ||
        !sameOwner(before, readOwner(stalePath, lockIdentity))
      ) {
        throw new Error("Verification session stale lock changed during reclamation.");
      }
      unlinkSync(path.join(stalePath, ownerFileName));
      rmdirSync(stalePath);
      return true;
    } catch (error) {
      if (!existsSync(lockPath)) renameSync(stalePath, lockPath);
      throw error;
    }
  } catch {
    return false;
  }
}

function acquireLockDirectory({ lockPath, stateDirectory, stateIdentity }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (!reclaimStaleLock({ lockPath, stateDirectory, stateIdentity })) {
        throw new Error(lockedMessage);
      }
    }
  }
  throw new Error(lockedMessage);
}

export function acquireVerificationSessionLock({ repositoryRoot = defaultRoot } = {}) {
  const canonicalRoot = realpathSync.native(path.resolve(repositoryRoot));
  const codexDirectory = path.join(canonicalRoot, ".codex");
  ensureDirectory(codexDirectory, "portable Codex policy");
  const runtimeDirectory = path.join(canonicalRoot, ...repositoryCodexRuntimeDirectory.split("/"));
  ensureDirectory(runtimeDirectory, "runtime", true);
  const cacheDirectory = path.join(
    canonicalRoot,
    ...repositoryCodexRuntimeCacheDirectory.split("/"),
  );
  ensureDirectory(cacheDirectory, "cache");
  const stateDirectory = path.join(cacheDirectory, "project-verification");
  const stateIdentity = ensureDirectory(stateDirectory, "verification state", true);
  const lockPath = path.join(stateDirectory, "session.lock");
  acquireLockDirectory({ lockPath, stateDirectory, stateIdentity });
  const lockIdentity = directoryIdentity(lockPath, "lock", { strict: true });
  const ownerPath = path.join(lockPath, ownerFileName);
  const owner = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    token: randomUUID(),
  };
  try {
    const descriptor = openSync(
      ownerPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      writeFileSync(descriptor, `${JSON.stringify(owner)}\n`, "utf8");
    } finally {
      closeSync(descriptor);
    }
    const stable = readOwner(lockPath, lockIdentity);
    if (stable.owner.pid !== owner.pid || stable.owner.token !== owner.token) {
      throw new Error("Verification session lock owner changed during acquisition.");
    }
    if (capabilities.has(canonicalRoot)) {
      throw new Error(
        "Verification process already owns a session capability for this repository.",
      );
    }
    capabilities.set(canonicalRoot, Object.freeze({ lockIdentity, token: owner.token }));
  } catch (error) {
    capabilities.delete(canonicalRoot);
    if (existsSync(ownerPath)) unlinkSync(ownerPath);
    if (existsSync(lockPath)) rmdirSync(lockPath);
    throw error;
  }

  let released = false;
  return Object.freeze({
    release() {
      if (released) throw new Error("Verification session lock was already released.");
      const stable = readOwner(lockPath, lockIdentity);
      if (
        stable.owner.pid !== process.pid ||
        stable.owner.token !== owner.token ||
        readdirSync(lockPath).join("\n") !== ownerFileName
      ) {
        throw new Error("Verification session lock ownership changed before release.");
      }
      unlinkSync(ownerPath);
      rmdirSync(lockPath);
      capabilities.delete(canonicalRoot);
      released = true;
    },
  });
}

export function assertVerificationSessionLockOwned({ repositoryRoot = defaultRoot } = {}) {
  const canonicalRoot = realpathSync.native(path.resolve(repositoryRoot));
  const lockPath = path.join(
    canonicalRoot,
    ...repositoryCodexRuntimeCacheDirectory.split("/"),
    "project-verification",
    "session.lock",
  );
  const lockIdentity = directoryIdentity(lockPath, "lock", { strict: true });
  const stable = readOwner(lockPath, lockIdentity);
  const capability = capabilities.get(canonicalRoot);
  if (
    stable.owner.pid !== process.pid ||
    capability?.lockIdentity !== lockIdentity ||
    capability?.token !== stable.owner.token
  ) {
    throw new Error(
      "Verification evidence publication requires this process to own the session lock.",
    );
  }
  return Object.freeze({ token: stable.owner.token });
}

export async function withVerificationSessionLock(action, options) {
  const lock = acquireVerificationSessionLock(options);
  try {
    return await action(lock);
  } finally {
    lock.release();
  }
}

function parseHeldCommand(args) {
  const usage =
    "Usage: node scripts/verify/verification-session-lock.mjs --hold [--root <repository-root>] <command> [args...]";
  if (args[0] !== "--hold") throw new Error(usage);
  let index = 1;
  let repositoryRoot = defaultRoot;
  if (args[index] === "--root") {
    if (!args[index + 1]) throw new Error(usage);
    repositoryRoot = path.resolve(args[index + 1]);
    index += 2;
  }
  if (!args[index]) throw new Error(usage);
  return Object.freeze({
    command: args[index],
    commandArgs: args.slice(index + 1),
    repositoryRoot,
  });
}

async function main() {
  const heldCommand = parseHeldCommand(process.argv.slice(2));
  const lock = acquireVerificationSessionLock({ repositoryRoot: heldCommand.repositoryRoot });
  try {
    process.exitCode = await runHeldVerificationCommand(heldCommand);
  } finally {
    lock.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
