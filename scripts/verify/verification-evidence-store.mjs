import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  repositoryCodexRuntimeCacheDirectory,
  repositoryCodexRuntimeDirectory,
} from "../repository/source-inventory.mjs";
import { failVerificationEvidence as fail } from "./verification-evidence-error.mjs";
import { validateVerificationEvidenceRecord } from "./verification-evidence-record.mjs";

const evidenceRelativePath = `${repositoryCodexRuntimeCacheDirectory}/project-verification/evidence.json`;
const maximumEvidenceBytes = 1024 * 1024;

export function verificationEvidenceCachePath(root) {
  return path.join(path.resolve(root), ...evidenceRelativePath.split("/"));
}

function validateDirectory(directoryPath, label, { strict = false } = {}) {
  const stats = lstatSync(directoryPath, { bigint: true });
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    (typeof process.getuid === "function" && stats.uid !== BigInt(process.getuid())) ||
    (stats.mode & BigInt(strict ? 0o022 : 0o002)) !== 0n
  ) {
    fail(`Verification evidence rejected the unsafe ${label} directory.`);
  }
  return `${stats.dev}:${stats.ino}`;
}

function evidenceDirectories(root, { create = false } = {}) {
  const canonicalRoot = realpathSync.native(path.resolve(root));
  const codexDirectory = path.join(canonicalRoot, ".codex");
  const runtimeDirectory = path.join(canonicalRoot, ...repositoryCodexRuntimeDirectory.split("/"));
  const cacheDirectory = path.join(
    canonicalRoot,
    ...repositoryCodexRuntimeCacheDirectory.split("/"),
  );
  const evidenceDirectory = path.dirname(verificationEvidenceCachePath(canonicalRoot));
  if (create) {
    if (!existsSync(codexDirectory)) mkdirSync(codexDirectory, { mode: 0o700 });
    validateDirectory(codexDirectory, "portable Codex policy");
    if (!existsSync(runtimeDirectory)) mkdirSync(runtimeDirectory, { mode: 0o700 });
    validateDirectory(runtimeDirectory, "runtime", { strict: true });
    if (!existsSync(cacheDirectory)) mkdirSync(cacheDirectory, { mode: 0o700 });
    if (!existsSync(evidenceDirectory)) mkdirSync(evidenceDirectory, { mode: 0o700 });
  } else if (
    !existsSync(runtimeDirectory) ||
    !existsSync(cacheDirectory) ||
    !existsSync(evidenceDirectory)
  ) {
    fail(
      "Verification evidence is missing; publication admission must establish a successful basis.",
    );
  }
  return {
    cacheDirectory,
    cacheIdentity: validateDirectory(cacheDirectory, "cache"),
    canonicalRoot,
    evidenceDirectory,
    evidenceIdentity: validateDirectory(evidenceDirectory, "verification cache", { strict: true }),
  };
}

function verifyDirectoryIdentity(directoryPath, expectedIdentity, label, strict = false) {
  if (validateDirectory(directoryPath, label, { strict }) !== expectedIdentity) {
    fail(`Verification evidence detected a ${label} directory identity change.`);
  }
}

function validateRecord(record) {
  try {
    return validateVerificationEvidenceRecord(record);
  } catch (error) {
    fail(error.message);
  }
}

export function readVerificationEvidence(root) {
  const directories = evidenceDirectories(root);
  const evidencePath = verificationEvidenceCachePath(directories.canonicalRoot);
  let initial;
  try {
    initial = lstatSync(evidencePath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail(
        "Verification evidence is missing; publication admission must establish a successful basis.",
      );
    }
    throw error;
  }
  if (
    initial.isSymbolicLink() ||
    !initial.isFile() ||
    initial.nlink !== 1n ||
    initial.size > BigInt(maximumEvidenceBytes) ||
    (initial.mode & 0o022n) !== 0n
  ) {
    fail("Verification evidence cache entry is unsafe.");
  }
  const descriptor = openSync(evidencePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (
      opened.dev !== initial.dev ||
      opened.ino !== initial.ino ||
      opened.size !== initial.size ||
      opened.nlink !== 1n
    ) {
      fail("Verification evidence cache entry changed while opening.");
    }
    const approvedBytes = Number(initial.size);
    const raw = Buffer.alloc(approvedBytes + 1);
    let offset = 0;
    while (offset < raw.length) {
      const bytesRead = readSync(descriptor, raw, offset, raw.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = fstatSync(descriptor, { bigint: true });
    const rebound = lstatSync(evidencePath, { bigint: true });
    if (
      offset !== approvedBytes ||
      after.dev !== initial.dev ||
      after.ino !== initial.ino ||
      after.size !== initial.size ||
      rebound.dev !== initial.dev ||
      rebound.ino !== initial.ino ||
      rebound.nlink !== 1n
    ) {
      fail("Verification evidence cache entry changed while reading.");
    }
    verifyDirectoryIdentity(directories.cacheDirectory, directories.cacheIdentity, "cache");
    verifyDirectoryIdentity(
      directories.evidenceDirectory,
      directories.evidenceIdentity,
      "verification cache",
      true,
    );
    try {
      return validateRecord(JSON.parse(raw.subarray(0, offset).toString("utf8")));
    } catch (error) {
      if (error instanceof SyntaxError) {
        fail("Verification evidence cache entry is not valid JSON.");
      }
      throw error;
    }
  } finally {
    closeSync(descriptor);
  }
}

export function writeVerificationEvidence(root, record) {
  const directories = evidenceDirectories(root, { create: true });
  const evidencePath = verificationEvidenceCachePath(directories.canonicalRoot);
  if (existsSync(evidencePath)) {
    const stats = lstatSync(evidencePath, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1n) {
      fail("Verification evidence refused to replace an unsafe cache entry.");
    }
  }
  const body = `${JSON.stringify(record, null, 2)}\n`;
  if (Buffer.byteLength(body) > maximumEvidenceBytes) {
    fail("Verification evidence record exceeds its byte bound.");
  }
  const temporaryPath = path.join(directories.evidenceDirectory, ".evidence.tmp");
  if (existsSync(temporaryPath)) {
    const stats = lstatSync(temporaryPath, { bigint: true });
    if (
      stats.isSymbolicLink() ||
      !stats.isFile() ||
      stats.nlink !== 1n ||
      stats.size > BigInt(maximumEvidenceBytes) ||
      (stats.mode & 0o077n) !== 0n
    ) {
      fail("Verification evidence refused to replace an unsafe temporary entry.");
    }
    rmSync(temporaryPath);
  }
  let descriptor;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, body, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    verifyDirectoryIdentity(directories.cacheDirectory, directories.cacheIdentity, "cache");
    verifyDirectoryIdentity(
      directories.evidenceDirectory,
      directories.evidenceIdentity,
      "verification cache",
      true,
    );
    renameSync(temporaryPath, evidencePath);
    const directoryDescriptor = openSync(
      directories.evidenceDirectory,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0),
    );
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }
}
