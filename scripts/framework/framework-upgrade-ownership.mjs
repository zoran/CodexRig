import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { resolveFrameworkPath } from "./framework-contract.mjs";

const dependencyOwnerPattern = /^dependency-(\d+)$/u;

function ownerIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return pid === process.pid;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function lockRoot(root) {
  return resolveFrameworkPath(root, ".project-state/framework-upgrade/lock");
}

function safeLockRoot(root, { required = false } = {}) {
  const directory = lockRoot(root);
  if (!existsSync(directory)) {
    if (required) throw new Error("Framework upgrade lock directory is missing.");
    return null;
  }
  const stats = lstatSync(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("Framework upgrade lock path must be a real directory.");
  }
  return directory;
}

export function dependencyRefreshIsActive(root) {
  const directory = safeLockRoot(root);
  if (!directory) return false;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const match = entry.name.match(dependencyOwnerPattern);
    if (!match) continue;
    if (!entry.isDirectory()) {
      throw new Error("Framework upgrade dependency owner is unsafe.");
    }
    if (ownerIsAlive(Number(match[1]))) return true;
  }
  return false;
}

export function claimDependencyRefresh(root) {
  const directory = safeLockRoot(root, { required: true });
  const owner = path.join(directory, `dependency-${process.pid}`);
  mkdirSync(owner, { mode: 0o700 });
  let released = false;
  return Object.freeze({
    release() {
      if (released) return;
      rmSync(owner, { recursive: false });
      released = true;
    },
  });
}
