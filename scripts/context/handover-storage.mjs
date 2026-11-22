/** Binds the private handover store to a repository and validates its directory chain. */
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { sha256 } from "../filesystem/repository-files.mjs";
import {
  ensureOwnedPrivateDirectory,
  openPrivateOwnedDirectory,
} from "../filesystem/owned-path-safety.mjs";

export const criticalHandoverDirectory = "tmp/codexrig-handovers";

function canonicalRoot(root) {
  const canonical = realpathSync.native(root);
  const stats = statSync(canonical, { bigint: true });
  if (!stats.isDirectory()) throw new Error("Handover root must be a real repository directory.");
  return { canonical, stats };
}

export function repositoryBinding(root) {
  const { canonical, stats } = canonicalRoot(root);
  return sha256(
    JSON.stringify({ device: String(stats.dev), inode: String(stats.ino), path: canonical }),
  );
}

export function handoverStore(root, { create = false, testHooks } = {}) {
  const { canonical } = canonicalRoot(root);
  const directory = path.join(canonical, ...criticalHandoverDirectory.split("/"));
  const handoverRoot = path.dirname(directory);
  if (!existsSync(handoverRoot) && !create) return null;
  if (create) {
    try {
      ensureOwnedPrivateDirectory(canonical, handoverRoot, "critical-budget handover root", {
        repairMode: "owner-write-only",
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
