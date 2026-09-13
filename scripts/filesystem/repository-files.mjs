/** Owns contained repository file reads, path validation and canonical byte identities. */
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readOptionalOwnedFile } from "./owned-file-operations.mjs";

export const toolingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const safeRelativePathPattern = /^(?!\.\.?$)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\0/][^\\\0]*$/u;

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

export function normalizeRepositoryPath(value, label = "repository path") {
  const candidate = requiredString(value, label);
  const normalized = path.posix.normalize(candidate.replace(/^\.\//u, ""));
  if (
    !safeRelativePathPattern.test(normalized) ||
    /[\u0000-\u001f\u007f\\]/u.test(normalized) ||
    path.posix.isAbsolute(normalized) ||
    normalized.endsWith("/")
  ) {
    throw new Error(`${label} must be one safe repository-relative path.`);
  }
  return normalized;
}

function realRoot(root) {
  const resolved = path.resolve(root);
  const stats = lstatSync(resolved);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("Repository root must be a real directory.");
  }
  return realpathSync.native(resolved);
}

export function resolveRepositoryPath(root, relativePath) {
  const ownedRoot = realRoot(root);
  const normalized = normalizeRepositoryPath(relativePath);
  const absolutePath = path.join(ownedRoot, ...normalized.split("/"));
  const relative = path.relative(ownedRoot, absolutePath);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("Repository path escapes the repository root.");
  }
  return absolutePath;
}

export function readRepositoryFile(root, relativePath, { optional = false } = {}) {
  const absolutePath = resolveRepositoryPath(root, relativePath);
  const ownedRoot = realRoot(root);
  const snapshot = readOptionalOwnedFile(
    ownedRoot,
    absolutePath,
    `repository file ${relativePath}`,
  );
  if (!snapshot.exists) {
    if (optional) return null;
    throw new Error(`Missing required repository file: ${relativePath}.`);
  }
  return snapshot.buffer.toString("utf8");
}

export function parseJsonFile(root, relativePath, label, options) {
  const content = readRepositoryFile(root, relativePath, options);
  if (content === null) return null;
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
}

export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function serializeCanonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
