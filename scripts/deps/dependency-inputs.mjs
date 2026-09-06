/** Owns dependency inputs behavior for the dependency and toolchain maintenance boundary. */
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { readOptionalOwnedFile } from "../filesystem/owned-file-operations.mjs";
import {
  closeOwnedDirectoryBinding,
  listOwnedDirectory,
  openOwnedDirectoryBinding,
  ownedDirectoryChildPath,
  readStableOwnedFile,
  safeArtifactStats,
  validateOwnedDirectoryBinding,
} from "../filesystem/owned-path-safety.mjs";

const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const ignoredLocalDirectoryEntries = new Set([".git", "node_modules"]);

/** Reports an atomic dependency transaction failure with its intended process exit code. */
export class DependencyTransactionError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "DependencyTransactionError";
    this.exitCode = exitCode;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function contentHash(content) {
  return createHash("sha256").update(content).digest("hex");
}

function strictDescendant(parent, child) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function projectIdentity(projectRoot) {
  const root = path.resolve(projectRoot);
  if (!existsSync(root)) throw new DependencyTransactionError("Project root does not exist.");
  const stats = lstatSync(root);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new DependencyTransactionError("Project root must be a real directory.");
  }
  return { root, real: realpathSync(root) };
}

export function safeRepositoryPath(projectRoot, relativePath, options = {}) {
  const identity = projectIdentity(projectRoot);
  const value = String(relativePath ?? "");
  if (
    !value ||
    value.includes("\0") ||
    value.includes("\\") ||
    path.isAbsolute(value) ||
    /^[a-z]+:/i.test(value)
  ) {
    throw new DependencyTransactionError(`Unsafe transaction path: ${value || "<empty>"}`);
  }
  const target = path.resolve(identity.root, value);
  if (!strictDescendant(identity.root, target)) {
    throw new DependencyTransactionError(`Transaction path escapes the project: ${value}`);
  }
  let cursor = identity.root;
  for (const segment of path.relative(identity.root, target).split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (!existsSync(cursor)) {
      if (!options.allowMissing) {
        throw new DependencyTransactionError(`Transaction input is missing: ${value}`);
      }
      continue;
    }
    const stats = lstatSync(cursor);
    if (stats.isSymbolicLink()) {
      throw new DependencyTransactionError(`Transaction path must not contain symlinks: ${value}`);
    }
    const real = realpathSync(cursor);
    if (real !== identity.real && !strictDescendant(identity.real, real)) {
      throw new DependencyTransactionError(
        `Transaction path resolves outside the project: ${value}`,
      );
    }
  }
  return target;
}

export function normalizeRelativePath(value) {
  const normalized = String(value).split(path.sep).join("/").replace(/^\.\//, "");
  if (normalized.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new DependencyTransactionError(
      `Transaction path must not contain dot segments: ${value}`,
    );
  }
  return normalized;
}

export function readOptionalFile(projectRoot, relativePath) {
  const target = safeRepositoryPath(projectRoot, relativePath, { allowMissing: true });
  let snapshot;
  try {
    snapshot = readOptionalOwnedFile(projectRoot, target, `transaction input ${relativePath}`);
  } catch (error) {
    throw new DependencyTransactionError(
      `Could not safely read transaction input ${relativePath}: ${error.message}`,
    );
  }
  if (!snapshot.exists) return { exists: false, content: null, hash: null };
  const content = snapshot.buffer.toString("utf8");
  return { exists: true, content, hash: contentHash(content) };
}

function stableFileSnapshot(projectRoot, filePath, label) {
  let snapshot;
  try {
    snapshot = readOptionalOwnedFile(projectRoot, filePath, `transaction input ${label}`);
  } catch (error) {
    throw new DependencyTransactionError(
      `Could not safely read transaction input ${label}: ${error.message}`,
    );
  }
  if (!snapshot.exists) {
    throw new DependencyTransactionError(`Transaction input disappeared while reading: ${label}`);
  }
  return {
    content: snapshot.buffer,
    mode: snapshot.stats.mode & 0o777,
    atime: snapshot.stats.atime,
    mtime: snapshot.stats.mtime,
  };
}

function directoryFingerprint(projectRoot, directory, label) {
  const records = [];

  function visit(current, relativeDirectory) {
    let binding;
    try {
      binding = openOwnedDirectoryBinding(projectRoot, current, `local dependency ${label}`);
      for (const name of listOwnedDirectory(binding, `local dependency ${label}`).sort()) {
        if (ignoredLocalDirectoryEntries.has(name)) continue;
        const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
        const child = ownedDirectoryChildPath(
          binding,
          name,
          `local dependency ${label}/${relativePath}`,
        );
        const stats = lstatSync(child);
        if (stats.isSymbolicLink()) {
          throw new DependencyTransactionError(
            `Local dependency input must not contain symlinks: ${label}/${relativePath}`,
          );
        }
        if (stats.isDirectory()) {
          safeArtifactStats(child, "directory", `local dependency ${label}/${relativePath}`);
          records.push({ path: relativePath, kind: "directory", mode: stats.mode & 0o777 });
          visit(path.join(current, name), relativePath);
        } else if (stats.isFile()) {
          const snapshot = readStableOwnedFile(
            binding,
            name,
            `local dependency ${label}/${relativePath}`,
          );
          records.push({
            path: relativePath,
            kind: "file",
            mode: snapshot.stats.mode & 0o777,
            hash: contentHash(snapshot.buffer),
          });
        } else {
          throw new DependencyTransactionError(
            `Local dependency input contains a non-file entry: ${label}/${relativePath}`,
          );
        }
      }
      validateOwnedDirectoryBinding(binding, `local dependency ${label}`);
    } catch (error) {
      if (error instanceof DependencyTransactionError) throw error;
      throw new DependencyTransactionError(
        `Could not safely inspect local dependency input ${label}: ${error.message}`,
      );
    } finally {
      if (binding) closeOwnedDirectoryBinding(binding);
    }
  }

  visit(directory, "");
  return contentHash(stableJson(records));
}

export function inputRecord(projectRoot, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const target = safeRepositoryPath(projectRoot, normalized, { allowMissing: true });
  if (!existsSync(target)) return { path: normalized, exists: false, kind: "missing", hash: null };
  let parent;
  try {
    parent = openOwnedDirectoryBinding(
      projectRoot,
      path.dirname(target),
      `transaction input ${normalized}`,
    );
    const boundTarget = ownedDirectoryChildPath(
      parent,
      path.basename(target),
      `transaction input ${normalized}`,
    );
    if (!existsSync(boundTarget)) {
      return { path: normalized, exists: false, kind: "missing", hash: null };
    }
    const stats = lstatSync(boundTarget);
    if (stats.isSymbolicLink()) {
      throw new DependencyTransactionError(`Transaction path must not be a symlink: ${normalized}`);
    }
    if (stats.isFile()) {
      const snapshot = readStableOwnedFile(
        parent,
        path.basename(target),
        `transaction input ${normalized}`,
      );
      return {
        path: normalized,
        exists: true,
        kind: "file",
        hash: contentHash(snapshot.buffer),
      };
    }
    if (stats.isDirectory()) {
      validateOwnedDirectoryBinding(parent, `transaction input ${normalized}`);
    } else {
      throw new DependencyTransactionError(`Unsupported transaction input type: ${normalized}`);
    }
  } catch (error) {
    if (error instanceof DependencyTransactionError) throw error;
    throw new DependencyTransactionError(
      `Could not safely inspect transaction input ${normalized}: ${error.message}`,
    );
  } finally {
    if (parent) closeOwnedDirectoryBinding(parent);
  }
  return {
    path: normalized,
    exists: true,
    kind: "directory",
    hash: directoryFingerprint(projectRoot, target, normalized),
  };
}

export function verifyInputRecords(projectRoot, records) {
  for (const record of records) {
    const current = inputRecord(projectRoot, record.path);
    if (
      current.exists !== record.exists ||
      current.kind !== record.kind ||
      current.hash !== record.hash
    ) {
      throw new DependencyTransactionError(
        `Reviewed dependency plan is stale because ${record.path} changed; generate a new preview.`,
        73,
      );
    }
  }
}

function yamlCommentless(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"' && character === "\\") {
      index += 1;
      continue;
    }
    if (quote === "'" && character === "'" && value[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? null : (quote ?? character);
      continue;
    }
    if (character === "#" && !quote && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value.trimEnd();
}

function yamlMappingSeparator(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"' && character === "\\") {
      index += 1;
      continue;
    }
    if (quote === "'" && character === "'" && value[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? null : (quote ?? character);
      continue;
    }
    if (
      character === ":" &&
      !quote &&
      (index + 1 === value.length || /\s/.test(value[index + 1]))
    ) {
      return index;
    }
  }
  return -1;
}

function yamlScalar(rawValue, label) {
  const value = yamlCommentless(String(rawValue)).trim();
  if (!value) return "";
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new DependencyTransactionError(`Unsupported quoted YAML scalar in ${label}.`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) {
      throw new DependencyTransactionError(`Unsupported quoted YAML scalar in ${label}.`);
    }
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

function yamlEntries(content, label) {
  const entries = [];
  for (const [lineIndex, rawLine] of String(content).split(/\r?\n/).entries()) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    const indentation = rawLine.match(/^ */)[0].length;
    let body = yamlCommentless(rawLine.slice(indentation)).trim();
    if (!body || body === "---" || body === "...") continue;
    if (body.startsWith("- ")) {
      body = body.slice(2).trim();
      const separator = yamlMappingSeparator(body);
      if (separator < 0) {
        entries.push({ indent: indentation, key: null, value: yamlScalar(body, label) });
        continue;
      }
    }
    const separator = yamlMappingSeparator(body);
    if (separator < 0) continue;
    const key = yamlScalar(body.slice(0, separator), `${label}:${lineIndex + 1}`);
    const rawValue = body.slice(separator + 1).trim();
    entries.push({
      indent: indentation,
      key,
      value: rawValue ? yamlScalar(rawValue, `${label}:${lineIndex + 1}`) : null,
    });
  }
  return entries;
}

function localSpecPath(value) {
  const match = String(value).match(/^(?:file|link|portal):(.+)$/);
  return match?.[1]?.replace(/\(patch_hash=[a-f0-9]+\)$/i, "") ?? null;
}

function yamlLocalSpecs(content, label) {
  const specs = [];
  for (const entry of yamlEntries(content, label)) {
    if (entry.value === null) continue;
    const localPath = localSpecPath(entry.value);
    if (localPath) specs.push(localPath);
    else if (/\b(?:file|link|portal):/.test(entry.value) && /^[{[]/.test(entry.value)) {
      throw new DependencyTransactionError(
        `${label} uses a flow-style local dependency; use block YAML so transaction inputs are unambiguous.`,
      );
    }
  }
  return specs;
}

function yamlPatchPaths(content, label) {
  const paths = [];
  const stack = [];
  for (const entry of yamlEntries(content, label)) {
    if (entry.key === null) continue;
    while (stack.length > 0 && stack.at(-1).indent >= entry.indent) stack.pop();
    const patchParentIndex = stack.findLastIndex((parent) => parent.key === "patchedDependencies");
    if (entry.key === "patchedDependencies") {
      if (entry.value && entry.value !== "{}") {
        throw new DependencyTransactionError(
          `${label} must use block YAML for patchedDependencies so patch inputs are unambiguous.`,
        );
      }
    } else if (patchParentIndex >= 0 && entry.value) {
      const directChild = patchParentIndex === stack.length - 1;
      if (directChild || entry.key === "path") paths.push(entry.value);
    }
    stack.push({ indent: entry.indent, key: entry.key });
  }
  return paths;
}

function nestedStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(nestedStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(nestedStrings);
  return [];
}

function localInputPath(projectRoot, baseDirectory, value, label) {
  const localPath = String(value).trim();
  if (
    !localPath ||
    localPath.includes("\0") ||
    localPath.includes("\\") ||
    path.isAbsolute(localPath) ||
    /^[a-z]+:/i.test(localPath) ||
    localPath.startsWith("~")
  ) {
    throw new DependencyTransactionError(`${label} must reference a repository-relative path.`);
  }
  const absolute = path.resolve(projectRoot, baseDirectory, localPath);
  if (!strictDescendant(projectRoot, absolute)) {
    throw new DependencyTransactionError(`${label} escapes the project: ${value}`);
  }
  const relativePath = normalizeRelativePath(path.relative(projectRoot, absolute));
  const segments = relativePath.split("/");
  if (
    segments.includes(".git") ||
    segments.includes("node_modules") ||
    relativePath === ".codex/runtime" ||
    relativePath.startsWith(".codex/runtime/") ||
    relativePath === ".project-state" ||
    relativePath.startsWith(".project-state/")
  ) {
    throw new DependencyTransactionError(`${label} references generated or private state.`);
  }
  safeRepositoryPath(projectRoot, relativePath);
  return relativePath;
}

export function discoverLocalInputs(projectRoot, manifests) {
  const references = new Map();
  const addReference = (value, baseDirectory, label, expectedKind = null) => {
    const relativePath = localInputPath(projectRoot, baseDirectory, value, label);
    const prior = references.get(relativePath);
    if (prior?.expectedKind && expectedKind && prior.expectedKind !== expectedKind) {
      throw new DependencyTransactionError(
        `Conflicting local dependency input types: ${relativePath}`,
      );
    }
    references.set(relativePath, { expectedKind: prior?.expectedKind ?? expectedKind, label });
  };

  for (const [relativePath, source] of manifests) {
    const baseDirectory = path.posix.dirname(relativePath);
    for (const section of dependencySections) {
      for (const [name, spec] of Object.entries(source.data[section] ?? {})) {
        const value = localSpecPath(spec);
        if (value) addReference(value, baseDirectory, `${relativePath} dependency ${name}`);
      }
    }
    for (const spec of nestedStrings(source.data.pnpm ?? {})) {
      const value = localSpecPath(spec);
      if (value) addReference(value, baseDirectory, `${relativePath} pnpm setting`);
    }
    for (const [selector, patchPath] of Object.entries(
      source.data.pnpm?.patchedDependencies ?? {},
    )) {
      addReference(patchPath, baseDirectory, `${relativePath} patch ${selector}`, "file");
    }
  }

  const workspaceConfig = readOptionalFile(projectRoot, "pnpm-workspace.yaml");
  if (workspaceConfig.exists) {
    for (const value of yamlLocalSpecs(workspaceConfig.content, "pnpm-workspace.yaml")) {
      addReference(value, ".", "pnpm-workspace.yaml local dependency");
    }
    for (const value of yamlPatchPaths(workspaceConfig.content, "pnpm-workspace.yaml")) {
      addReference(value, ".", "pnpm-workspace.yaml patch", "file");
    }
  }

  return [...references.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, reference]) => {
      const record = inputRecord(projectRoot, relativePath);
      if (!record.exists) {
        throw new DependencyTransactionError(`Local dependency input is missing: ${relativePath}`);
      }
      if (reference.expectedKind && record.kind !== reference.expectedKind) {
        throw new DependencyTransactionError(
          `${reference.label} must reference a regular ${reference.expectedKind}: ${relativePath}`,
        );
      }
      return record;
    });
}

function copyLocalDirectory(projectRoot, source, target, label) {
  let binding;
  try {
    binding = openOwnedDirectoryBinding(projectRoot, source, `local dependency ${label}`);
    mkdirSync(target, { recursive: true, mode: binding.stats.mode & 0o777 });
    chmodSync(target, binding.stats.mode & 0o777);
    for (const name of listOwnedDirectory(binding, `local dependency ${label}`).sort()) {
      if (ignoredLocalDirectoryEntries.has(name)) continue;
      const sourceChild = ownedDirectoryChildPath(
        binding,
        name,
        `local dependency ${label}/${name}`,
      );
      const targetChild = path.join(target, name);
      const stats = lstatSync(sourceChild);
      if (stats.isSymbolicLink()) {
        throw new DependencyTransactionError(
          `Local dependency input must not contain symlinks: ${label}/${name}`,
        );
      }
      if (stats.isDirectory()) {
        copyLocalDirectory(projectRoot, path.join(source, name), targetChild, `${label}/${name}`);
      } else if (stats.isFile()) {
        const snapshot = readStableOwnedFile(binding, name, `local dependency ${label}/${name}`);
        mkdirSync(path.dirname(targetChild), { recursive: true });
        writeFileSync(targetChild, snapshot.buffer, { mode: snapshot.stats.mode & 0o777 });
        chmodSync(targetChild, snapshot.stats.mode & 0o777);
        utimesSync(targetChild, snapshot.stats.atime, snapshot.stats.mtime);
      } else {
        throw new DependencyTransactionError(
          `Local dependency input contains a non-file entry: ${label}/${name}`,
        );
      }
    }
    validateOwnedDirectoryBinding(binding, `local dependency ${label}`);
    utimesSync(target, binding.stats.atime, binding.stats.mtime);
  } catch (error) {
    if (error instanceof DependencyTransactionError) throw error;
    throw new DependencyTransactionError(
      `Could not safely copy local dependency input ${label}: ${error.message}`,
    );
  } finally {
    if (binding) closeOwnedDirectoryBinding(binding);
  }
}

export function copyLocalInput(projectRoot, temporaryRoot, record) {
  const source = safeRepositoryPath(projectRoot, record.path);
  const target = safeRepositoryPath(temporaryRoot, record.path, { allowMissing: true });
  mkdirSync(path.dirname(target), { recursive: true });
  if (record.kind === "directory") copyLocalDirectory(projectRoot, source, target, record.path);
  else {
    const snapshot = stableFileSnapshot(projectRoot, source, record.path);
    writeFileSync(target, snapshot.content, { mode: snapshot.mode });
    chmodSync(target, snapshot.mode);
    utimesSync(target, snapshot.atime, snapshot.mtime);
  }
  const copied = inputRecord(temporaryRoot, record.path);
  if (copied.kind !== record.kind || copied.hash !== record.hash) {
    throw new DependencyTransactionError(
      `Local dependency input changed while copying: ${record.path}`,
    );
  }
}
