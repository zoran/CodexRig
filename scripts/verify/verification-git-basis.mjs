import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cleanGitEnvironment,
  isolatedGitArguments,
  localGitExcludeIsInactive,
  resolveOwnedGitMetadata,
} from "../repository/git-runtime-isolation.mjs";
import {
  captureStableRepositoryFileIdentity,
  readStableRepositoryFile,
} from "../repository/stable-file-snapshot.mjs";
import { normalizePath, parseNameStatus, parsePorcelainStatus, root } from "./adaptive-state.mjs";

const objectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const maximumBasisPaths = 20_000;
const maximumManifestBytes = 1024 * 1024;

function git(repositoryRoot, args, { allowFailure = false, environment = {} } = {}) {
  let metadata;
  try {
    metadata = resolveOwnedGitMetadata(repositoryRoot);
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
  if (!metadata) {
    if (allowFailure) return null;
    throw new Error("Verification basis requires project-owned Git metadata.");
  }
  const result = spawnSync(
    "git",
    isolatedGitArguments({
      args,
      gitDirectory: metadata.gitDirectory,
      workTree: metadata.workTree,
    }),
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...cleanGitEnvironment(), ...environment },
      input: "",
      maxBuffer: 4 * 1024 * 1024,
      stdio: "pipe",
    },
  );
  if (result.error || result.status !== 0) {
    if (allowFailure) return null;
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw result.error ?? new Error(output || `git ${args.join(" ")} failed.`);
  }
  return result.stdout ?? "";
}

function safeBasisPath(value) {
  const normalized = normalizePath(value);
  return (
    normalized &&
    normalized === value &&
    normalized.length <= 4_096 &&
    !path.posix.isAbsolute(normalized) &&
    !normalized.split("/").some((segment) => !segment || segment === "." || segment === "..") &&
    !/[\0\r\n]/u.test(normalized)
  );
}

export function normalizedVerificationGitBasis(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !== "complete\ndirtyPaths\nhead" ||
    typeof value.complete !== "boolean" ||
    !Array.isArray(value.dirtyPaths) ||
    value.dirtyPaths.length > maximumBasisPaths ||
    value.dirtyPaths.some(
      (item, index) => !safeBasisPath(item) || item === value.dirtyPaths[index - 1],
    )
  ) {
    throw new Error("Verification evidence contains an invalid Git basis.");
  }
  if (
    (value.complete && !objectIdPattern.test(value.head)) ||
    (!value.complete && value.head !== "") ||
    typeof value.head !== "string"
  ) {
    throw new Error("Verification evidence contains an invalid Git basis commit.");
  }
  return Object.freeze({
    complete: value.complete,
    dirtyPaths: Object.freeze([...value.dirtyPaths]),
    head: value.head.toLowerCase(),
  });
}

function incompleteBasis() {
  return Object.freeze({ complete: false, dirtyPaths: Object.freeze([]), head: "" });
}

function freshHeadStatus(repositoryRoot) {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "verification-basis-index-"));
  const environment = { GIT_INDEX_FILE: path.join(temporaryDirectory, "index") };
  try {
    if (git(repositoryRoot, ["read-tree", "HEAD"], { allowFailure: true, environment }) === null) {
      return null;
    }
    return git(
      repositoryRoot,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"],
      { allowFailure: true, environment },
    );
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

export function captureVerificationGitBasis({ repositoryRoot = root } = {}) {
  let canonicalRoot;
  let metadata;
  try {
    canonicalRoot = realpathSync.native(path.resolve(repositoryRoot));
    metadata = resolveOwnedGitMetadata(canonicalRoot);
  } catch {
    return incompleteBasis();
  }
  if (!metadata || !localGitExcludeIsInactive(metadata)) return incompleteBasis();
  const head = git(canonicalRoot, ["rev-parse", "--verify", "HEAD^{commit}"], {
    allowFailure: true,
  })?.trim();
  const status = freshHeadStatus(canonicalRoot);
  if (!head || !objectIdPattern.test(head) || status === null) return incompleteBasis();
  try {
    const dirtyPaths = parsePorcelainStatus(status);
    return normalizedVerificationGitBasis({ complete: true, dirtyPaths, head });
  } catch {
    return incompleteBasis();
  }
}

function committedPathsSinceBasis(repositoryRoot, basis, currentHead) {
  if (basis.head === currentHead) return { incomplete: false, paths: [], reason: "" };
  if (
    git(repositoryRoot, ["merge-base", "--is-ancestor", basis.head, currentHead], {
      allowFailure: true,
    }) === null
  ) {
    return {
      incomplete: true,
      paths: [],
      reason: "successful basis HEAD is not an ancestor of current HEAD",
    };
  }
  const output = git(
    repositoryRoot,
    [
      "log",
      "--format=",
      "--name-status",
      "-z",
      "--find-renames",
      "--find-copies",
      `${basis.head}..${currentHead}`,
      "--",
    ],
    { allowFailure: true },
  );
  if (output === null) {
    return { incomplete: true, paths: [], reason: "commit delta since successful basis" };
  }
  try {
    return { incomplete: false, paths: parseNameStatus(output), reason: "" };
  } catch (error) {
    return { incomplete: true, paths: [], reason: error.message };
  }
}

export function changedPathsSinceVerificationBasis(inputBasis, { repositoryRoot = root } = {}) {
  let basis;
  try {
    basis = normalizedVerificationGitBasis(inputBasis);
  } catch (error) {
    return {
      basis: incompleteBasis(),
      incomplete: true,
      paths: [],
      reason: error.message,
    };
  }
  if (!basis.complete) {
    return {
      basis,
      incomplete: true,
      paths: [],
      reason: "successful verification basis has no complete Git identity",
    };
  }
  const current = captureVerificationGitBasis({ repositoryRoot });
  if (!current.complete) {
    return {
      basis: current,
      incomplete: true,
      paths: [],
      reason: "current Git basis could not be captured safely",
    };
  }
  const committed = committedPathsSinceBasis(repositoryRoot, basis, current.head);
  return {
    basis: current,
    basisChanged:
      basis.head !== current.head || basis.dirtyPaths.join("\0") !== current.dirtyPaths.join("\0"),
    incomplete: committed.incomplete,
    paths: [...new Set([...basis.dirtyPaths, ...committed.paths, ...current.dirtyPaths])].sort(),
    reason: committed.reason,
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function withoutVerifyScripts(manifest) {
  const scripts = Object.fromEntries(
    Object.entries(manifest.scripts ?? {}).filter(([name]) => !/^verify(?::|$)/u.test(name)),
  );
  return { ...manifest, scripts };
}

function verifyScripts(manifest) {
  return Object.fromEntries(
    Object.entries(manifest.scripts ?? {}).filter(([name]) => /^verify(?::|$)/u.test(name)),
  );
}

function parseManifest(content) {
  if (Buffer.byteLength(content) > maximumManifestBytes) return null;
  let manifest;
  try {
    manifest = JSON.parse(content);
  } catch {
    return null;
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return null;
  if (
    manifest.scripts !== undefined &&
    (!manifest.scripts ||
      typeof manifest.scripts !== "object" ||
      Array.isArray(manifest.scripts) ||
      Object.values(manifest.scripts).some((value) => typeof value !== "string"))
  ) {
    return null;
  }
  return manifest;
}

export function rootManifestChangeIsVerifyOnly(
  inputBasis,
  { currentContent: suppliedCurrentContent, repositoryRoot = root } = {},
) {
  let basis;
  try {
    basis = normalizedVerificationGitBasis(inputBasis);
  } catch {
    return false;
  }
  if (!basis.complete || basis.dirtyPaths.includes("package.json")) return false;
  const currentHead = git(repositoryRoot, ["rev-parse", "--verify", "HEAD^{commit}"], {
    allowFailure: true,
  })?.trim();
  if (!currentHead || currentHead.toLowerCase() !== basis.head) return false;
  const baselineContent = git(repositoryRoot, ["show", `${basis.head}:package.json`], {
    allowFailure: true,
  });
  if (baselineContent === null) return false;
  let currentContent;
  if (suppliedCurrentContent !== undefined) {
    if (
      typeof suppliedCurrentContent !== "string" ||
      Buffer.byteLength(suppliedCurrentContent) > maximumManifestBytes
    ) {
      return false;
    }
    currentContent = suppliedCurrentContent;
  } else {
    try {
      const captured = captureStableRepositoryFileIdentity({
        repositoryRoot,
        relativePath: "package.json",
      });
      if (captured.bytes > maximumManifestBytes) return false;
      currentContent = readStableRepositoryFile({
        repositoryRoot,
        relativePath: "package.json",
        expectedIdentity: captured.identity,
      }).buffer.toString("utf8");
    } catch {
      return false;
    }
  }
  const baseline = parseManifest(baselineContent);
  const current = parseManifest(currentContent);
  if (!baseline || !current) return false;
  return (
    canonicalJson(withoutVerifyScripts(baseline)) ===
      canonicalJson(withoutVerifyScripts(current)) &&
    canonicalJson(verifyScripts(baseline)) !== canonicalJson(verifyScripts(current))
  );
}
