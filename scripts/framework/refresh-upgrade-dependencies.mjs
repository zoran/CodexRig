#!/usr/bin/env node
/** Owns refresh upgrade dependencies behavior for the framework lifecycle and child upgrade boundary. */
import { lstatSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { installLatestCompatibleDependencies } from "../deps/install-compatible.mjs";
import {
  frameworkRoot,
  readRegularFrameworkFile,
  resolveFrameworkPath,
  serializeCanonicalJson,
  sha256,
} from "../contracts/framework-contract.mjs";
import { claimDependencyRefresh } from "./framework-upgrade-ownership.mjs";
import { atomicWriteUpgradeFile } from "./framework-upgrade-io.mjs";

const journalRelativePath = ".project-state/framework-upgrade/journal.json";

function validHash(value) {
  return value === null || (typeof value === "string" && /^[0-9a-f]{64}$/u.test(value));
}

function validMode(value) {
  return value === null || (Number.isInteger(value) && value >= 0 && value <= 0o777);
}

function readUpgradeJournal(root) {
  const content = readRegularFrameworkFile(root, journalRelativePath);
  let journal;
  try {
    journal = JSON.parse(content);
  } catch {
    throw new Error("Framework upgrade dependency journal is invalid.");
  }
  if (
    journal?.schemaVersion !== 1 ||
    typeof journal.digest !== "string" ||
    !Array.isArray(journal.originals) ||
    journal.originals.some(
      (entry) =>
        !entry ||
        typeof entry !== "object" ||
        typeof entry.path !== "string" ||
        !validHash(entry.sha256) ||
        !validHash(entry.allowedSha256) ||
        !validMode(entry.mode) ||
        !validMode(entry.allowedMode),
    )
  ) {
    throw new Error("Framework upgrade dependency journal has an invalid schema.");
  }
  return { content, journal };
}

function atomicReplaceJournal(root, expected, journal) {
  const target = resolveFrameworkPath(root, journalRelativePath);
  const stats = lstatSync(target);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) {
    throw new Error("Framework upgrade dependency journal is unsafe.");
  }
  if (readRegularFrameworkFile(root, journalRelativePath) !== expected) {
    throw new Error("Framework upgrade dependency journal changed concurrently.");
  }
  atomicWriteUpgradeFile(root, journalRelativePath, serializeCanonicalJson(journal), 0o600);
}

export function authorizePlannedLockfile({ root = frameworkRoot, content }) {
  if (typeof content !== "string") {
    throw new Error("Framework upgrade dependency authorization requires lockfile content.");
  }
  const { content: original, journal } = readUpgradeJournal(root);
  const lockRecords = journal.originals.filter((entry) => entry.path === "pnpm-lock.yaml");
  if (lockRecords.length !== 1 || lockRecords[0].mutable !== true) {
    throw new Error("Framework upgrade journal has no mutable lockfile record.");
  }
  lockRecords[0].allowedSha256 = sha256(content);
  atomicReplaceJournal(root, original, journal);
}

function main() {
  readUpgradeJournal(frameworkRoot);
  const claim = claimDependencyRefresh(frameworkRoot);
  try {
    const result = installLatestCompatibleDependencies({
      projectRoot: frameworkRoot,
      lifecycleCapability: claim.lifecycleCapability,
      beforeLockfileWrite: ({ content }) => authorizePlannedLockfile({ content }),
    });
    console.log(
      result.lockfileUpdated
        ? "Upgrade dependencies and their authorized lockfile were refreshed."
        : "Upgrade dependencies were already current and installed reproducibly.",
    );
  } finally {
    claim.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Framework upgrade dependency refresh failed: ${error.message}`);
    process.exit(1);
  }
}
