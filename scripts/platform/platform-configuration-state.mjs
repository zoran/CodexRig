import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { resolveFrameworkPath, serializeCanonicalJson } from "../framework/framework-contract.mjs";

const stateRelativePath = ".project-state/platform-configuration.json";
const lockRelativePath = ".project-state/platform-configuration.lock";
const maximumStateBytes = 64 * 1024;
const maximumLockBytes = 4 * 1024;

function stateDigest(plan) {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

function statePath(root) {
  const stateRoot = resolveFrameworkPath(root, ".project-state");
  if (existsSync(stateRoot)) {
    const stats = lstatSync(stateRoot);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("Platform configuration state parent must be a real directory.");
    }
  } else {
    mkdirSync(stateRoot, { mode: 0o700 });
  }
  return resolveFrameworkPath(root, stateRelativePath);
}

function lockPath(root) {
  statePath(root);
  return resolveFrameworkPath(root, lockRelativePath);
}

function readLock(root) {
  const target = lockPath(root);
  const stats = lstatSync(target);
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    stats.nlink !== 1 ||
    stats.size > maximumLockBytes
  ) {
    throw new Error("Platform configuration lock is unsafe.");
  }
  let owner;
  try {
    owner = JSON.parse(readFileSync(target, "utf8"));
  } catch {
    throw new Error("Platform configuration lock is invalid.");
  }
  if (
    owner?.schemaVersion !== 1 ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0 ||
    typeof owner.token !== "string" ||
    !/^[0-9a-f-]{36}$/u.test(owner.token)
  ) {
    throw new Error("Platform configuration lock is invalid.");
  }
  return owner;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function acquireLock(root) {
  const target = lockPath(root);
  if (existsSync(target)) {
    const current = readLock(root);
    if (processIsAlive(current.pid)) {
      throw new Error("Another platform configuration is active.");
    }
    rmSync(target);
  }
  const owner = { schemaVersion: 1, pid: process.pid, token: randomUUID() };
  const descriptor = openSync(target, "wx", 0o600);
  try {
    writeFileSync(descriptor, serializeCanonicalJson(owner), "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  return owner;
}

function releaseLock(root, owner) {
  if (!owner) return;
  const current = readLock(root);
  if (current.pid !== owner.pid || current.token !== owner.token) {
    throw new Error("Platform configuration lock ownership changed.");
  }
  rmSync(lockPath(root));
}

function validateState(value, digest, plan) {
  if (
    value?.schemaVersion !== 1 ||
    value.digest !== digest ||
    value.provider !== plan.provider ||
    value.repository !== plan.repository ||
    !Number.isSafeInteger(value.startedAt) ||
    value.startedAt < 0 ||
    !Array.isArray(value.completed) ||
    value.completed.length > 20 ||
    value.completed.some(
      (entry, index) =>
        typeof entry !== "string" ||
        !entry ||
        entry.length > 128 ||
        /[\0\r\n]/u.test(entry) ||
        value.completed.indexOf(entry) !== index,
    )
  ) {
    throw new Error("Platform configuration recovery state is invalid.");
  }
  return value;
}

function readState(root, digest, plan) {
  const target = statePath(root);
  const stats = lstatSync(target);
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    stats.nlink !== 1 ||
    stats.size > maximumStateBytes
  ) {
    throw new Error("Platform configuration recovery state is unsafe.");
  }
  try {
    return validateState(JSON.parse(readFileSync(target, "utf8")), digest, plan);
  } catch (error) {
    if (/recovery state/u.test(error.message)) throw error;
    throw new Error("Platform configuration recovery state is invalid.");
  }
}

function atomicWriteState(root, value) {
  const target = statePath(root);
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error("Platform configuration recovery state is unsafe.");
  }
  const temporary = path.join(
    path.dirname(target),
    `.platform-configuration-${process.pid}-${randomUUID()}.tmp`,
  );
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, serializeCanonicalJson(value), "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, target);
    chmodSync(target, 0o600);
    const directoryDescriptor = openSync(path.dirname(target), "r");
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function platformConfigurationState(root, plan) {
  const digest = stateDigest(plan);
  let owner = null;
  return {
    begin() {
      if (owner) throw new Error("Platform configuration state is already active.");
      owner = acquireLock(root);
      try {
        const target = statePath(root);
        if (existsSync(target)) {
          const current = readState(root, digest, plan);
          return { resumed: true, completed: [...current.completed] };
        }
        atomicWriteState(root, {
          schemaVersion: 1,
          digest,
          provider: plan.provider,
          repository: plan.repository,
          startedAt: Date.now(),
          completed: [],
        });
        return { resumed: false, completed: [] };
      } catch (error) {
        releaseLock(root, owner);
        owner = null;
        throw error;
      }
    },
    record(operation) {
      if (!owner) throw new Error("Platform configuration state is not active.");
      const current = readState(root, digest, plan);
      if (!current.completed.includes(operation)) current.completed.push(operation);
      atomicWriteState(root, current);
    },
    complete() {
      if (!owner) throw new Error("Platform configuration state is not active.");
      readState(root, digest, plan);
      rmSync(statePath(root));
      releaseLock(root, owner);
      owner = null;
    },
    release() {
      if (!owner) return;
      releaseLock(root, owner);
      owner = null;
    },
  };
}
