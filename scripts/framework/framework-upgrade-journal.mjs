import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  frameworkRoot,
  normalizeFrameworkPath,
  resolveFrameworkPath,
  serializeCanonicalJson,
  sha256,
} from "./framework-contract.mjs";
import {
  atomicWriteUpgradeFile,
  ensureUpgradeDirectoryChain,
  targetUpgradeFileState,
} from "./framework-upgrade-io.mjs";
import { dependencyRefreshIsActive } from "./framework-upgrade-ownership.mjs";

const journalRelativePath = ".project-state/framework-upgrade/journal.json";

function validHash(value) {
  return value === null || (typeof value === "string" && /^[0-9a-f]{64}$/u.test(value));
}

function validMode(value) {
  return value === null || (Number.isInteger(value) && value >= 0 && value <= 0o777);
}

export function frameworkUpgradeStatePaths(root) {
  const stateRoot = resolveFrameworkPath(root, ".project-state/framework-upgrade");
  for (const relativePath of [".project-state", ".project-state/framework-upgrade"]) {
    const candidate = resolveFrameworkPath(root, relativePath);
    if (!existsSync(candidate)) continue;
    const stats = lstatSync(candidate);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("Framework upgrade state path must be a real directory.");
    }
  }
  return {
    journal: path.join(stateRoot, "journal.json"),
    lock: path.join(stateRoot, "lock"),
    owner: path.join(stateRoot, "lock", "owner.json"),
    root: stateRoot,
  };
}

function originalRecord(root, relativePath, { mutable = false } = {}) {
  const state = targetUpgradeFileState(root, relativePath);
  return state.exists
    ? {
        content: Buffer.from(state.content).toString("base64"),
        existed: true,
        mode: state.mode,
        mutable,
        path: relativePath,
        sha256: state.sha256,
      }
    : { content: "", existed: false, mode: null, mutable, path: relativePath, sha256: null };
}

function journalForPlan(plan) {
  const paths = new Set(plan.operations.map((operation) => operation.path));
  paths.add(plan.sourceContract.upgrade.receiptFile);
  paths.add("pnpm-lock.yaml");
  const operationByPath = new Map(plan.operations.map((operation) => [operation.path, operation]));
  return {
    schemaVersion: 1,
    digest: plan.digest,
    toVersion: plan.toVersion,
    originals: [...paths].sort().map((relativePath) => {
      const original = originalRecord(plan.targetRoot, relativePath, {
        mutable: relativePath === "pnpm-lock.yaml",
      });
      const operation = operationByPath.get(relativePath);
      return {
        ...original,
        allowedMode:
          operation?.action === "write"
            ? operation.mode
            : operation?.action === "delete"
              ? null
              : original.mode,
        allowedSha256:
          operation?.action === "write"
            ? sha256(operation.content)
            : operation?.action === "delete"
              ? null
              : original.sha256,
      };
    }),
  };
}

function validateJournal(journal, expectedDigest) {
  if (
    journal?.schemaVersion !== 1 ||
    typeof journal.digest !== "string" ||
    (expectedDigest !== undefined && journal.digest !== expectedDigest) ||
    !Array.isArray(journal.originals)
  ) {
    throw new Error("Framework upgrade journal is invalid; manual recovery is required.");
  }
  const seen = new Set();
  for (const original of journal.originals) {
    const relativePath = normalizeFrameworkPath(original?.path, "framework upgrade journal path");
    if (
      seen.has(relativePath) ||
      typeof original.existed !== "boolean" ||
      typeof original.mutable !== "boolean" ||
      !validHash(original.sha256) ||
      !validHash(original.allowedSha256) ||
      !validMode(original.mode) ||
      !validMode(original.allowedMode) ||
      (original.existed && (typeof original.content !== "string" || original.mode === null)) ||
      (!original.existed &&
        (original.content !== "" || original.mode !== null || original.sha256 !== null))
    ) {
      throw new Error("Framework upgrade journal is invalid; manual recovery is required.");
    }
    seen.add(relativePath);
  }
  return journal;
}

export function readFrameworkUpgradeJournal(root, expectedDigest) {
  const journalPath = frameworkUpgradeStatePaths(root).journal;
  if (!existsSync(journalPath)) {
    throw new Error("Framework upgrade journal is missing; manual recovery is required.");
  }
  const stats = lstatSync(journalPath);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) {
    throw new Error("Framework upgrade journal is unsafe; manual recovery is required.");
  }
  try {
    return validateJournal(JSON.parse(readFileSync(journalPath, "utf8")), expectedDigest);
  } catch (error) {
    if (/manual recovery is required/u.test(error.message)) throw error;
    throw new Error("Framework upgrade journal is invalid; manual recovery is required.");
  }
}

export function persistFrameworkUpgradeJournal(root, journal) {
  validateJournal(journal, journal.digest);
  atomicWriteUpgradeFile(root, journalRelativePath, serializeCanonicalJson(journal), 0o600);
}

export function authorizeFrameworkUpgradeOutput(journal, relativePath, allowedSha256, allowedMode) {
  if (!validHash(allowedSha256)) {
    throw new Error("Framework upgrade output authorization hash is invalid.");
  }
  if (allowedMode !== undefined && !validMode(allowedMode)) {
    throw new Error("Framework upgrade output authorization mode is invalid.");
  }
  const matches = journal.originals.filter((entry) => entry.path === relativePath);
  if (matches.length !== 1) {
    throw new Error(`Framework upgrade journal has no unique output record for ${relativePath}.`);
  }
  matches[0].allowedSha256 = allowedSha256;
  if (allowedMode !== undefined) matches[0].allowedMode = allowedMode;
}

function currentJournalState(root, original) {
  const target = resolveFrameworkPath(root, original.path);
  if (!existsSync(target)) return { exists: false, mode: null, sha256: null };
  const stats = lstatSync(target);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) {
    throw new Error("Framework upgrade recovery target is unsafe; manual recovery is required.");
  }
  return {
    exists: true,
    mode: stats.mode & 0o777,
    sha256: sha256(readFileSync(target, "utf8")),
  };
}

export function restoreFrameworkUpgradeJournal(root, journal) {
  validateJournal(journal, journal.digest);
  for (const original of journal.originals) {
    const current = currentJournalState(root, original);
    const unchanged = current.sha256 === original.sha256 && current.mode === original.mode;
    const upgradeOwned =
      current.sha256 === original.allowedSha256 && current.mode === original.allowedMode;
    if (!unchanged && !upgradeOwned) {
      throw new Error(
        `Framework upgrade recovery found an unrelated change in ${original.path}; manual recovery is required.`,
      );
    }
  }
  for (const original of [...journal.originals].reverse()) {
    const target = resolveFrameworkPath(root, original.path);
    if (original.existed) {
      const content = Buffer.from(original.content, "base64").toString("utf8");
      if (sha256(content) !== original.sha256) {
        throw new Error(
          "Framework upgrade journal checksum is invalid; manual recovery is required.",
        );
      }
      atomicWriteUpgradeFile(root, original.path, content, original.mode);
    } else if (existsSync(target)) {
      const stats = lstatSync(target);
      if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) {
        throw new Error(
          "Framework upgrade recovery target is unsafe; manual recovery is required.",
        );
      }
      rmSync(target);
    }
  }
}

function activeUpgradeOwner(paths) {
  if (!existsSync(paths.owner)) return false;
  let owner;
  try {
    owner = JSON.parse(readFileSync(paths.owner, "utf8"));
  } catch {
    return false;
  }
  if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0 || owner.pid === process.pid) {
    return false;
  }
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function beginFrameworkUpgrade(plan) {
  const paths = frameworkUpgradeStatePaths(plan.targetRoot);
  ensureUpgradeDirectoryChain(plan.targetRoot, ".project-state/framework-upgrade");
  try {
    mkdirSync(paths.lock, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Another framework upgrade is active.");
    throw error;
  }
  atomicWriteUpgradeFile(
    plan.targetRoot,
    ".project-state/framework-upgrade/lock/owner.json",
    serializeCanonicalJson({ pid: process.pid, startedAt: Date.now() }),
    0o600,
  );
  const journal = journalForPlan(plan);
  persistFrameworkUpgradeJournal(plan.targetRoot, journal);
  return { journal, paths };
}

export function removeFrameworkUpgradeState(paths) {
  rmSync(paths.root, { force: true, recursive: true });
}

export function recoverFrameworkUpgradeState(root = frameworkRoot, { repairDependencies } = {}) {
  if (typeof repairDependencies !== "function") {
    throw new Error("Framework upgrade recovery requires a dependency repair function.");
  }
  const paths = frameworkUpgradeStatePaths(root);
  if (activeUpgradeOwner(paths) || dependencyRefreshIsActive(root)) {
    throw new Error("Another framework upgrade is active.");
  }
  if (!existsSync(paths.journal)) {
    if (!existsSync(paths.root)) return false;
    removeFrameworkUpgradeState(paths);
    return true;
  }
  restoreFrameworkUpgradeJournal(root, readFrameworkUpgradeJournal(root));
  repairDependencies(root);
  removeFrameworkUpgradeState(paths);
  return true;
}
