import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export function cleanGitEnvironment(baseEnvironment = process.env) {
  const environment = { ...baseEnvironment };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("GIT_")) delete environment[name];
  }
  return {
    ...environment,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
}

function absolutePath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) {
    throw new Error(`Isolated Git ${label} must be an absolute path.`);
  }
  return value;
}

function stableFileIdentity(stats) {
  return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs, stats.nlink].join(":");
}

export function resolveOwnedGitMetadata(workTree) {
  const requestedRoot = absolutePath(workTree, "worktree");
  let root;
  let markerStats;
  const markerPath = path.join(requestedRoot, ".git");
  try {
    const rootStats = lstatSync(requestedRoot, { bigint: true });
    root = realpathSync(requestedRoot);
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory() || root !== requestedRoot) {
      throw new Error("unsafe root");
    }
    markerStats = lstatSync(markerPath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT" && root) return null;
    throw new Error("Project-owned Git metadata could not be safely resolved.");
  }

  if (markerStats.isSymbolicLink()) {
    throw new Error("Project-owned Git metadata could not be safely resolved.");
  }
  if (markerStats.isDirectory()) {
    try {
      return Object.freeze({ gitDirectory: realpathSync(markerPath), workTree: root });
    } catch {
      throw new Error("Project-owned Git metadata could not be safely resolved.");
    }
  }
  if (!markerStats.isFile() || markerStats.nlink !== 1n || markerStats.size > 8192n) {
    throw new Error("Project-owned Git metadata could not be safely resolved.");
  }

  let descriptor;
  try {
    descriptor = openSync(markerPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    if (
      stableFileIdentity(fstatSync(descriptor, { bigint: true })) !==
      stableFileIdentity(markerStats)
    ) {
      throw new Error("changed metadata");
    }
    const match = /^gitdir: ([^\0\r\n]+)\r?\n?$/.exec(readFileSync(descriptor, "utf8"));
    if (!match) throw new Error("invalid gitfile");
    const after = fstatSync(descriptor, { bigint: true });
    if (
      stableFileIdentity(after) !== stableFileIdentity(markerStats) ||
      stableFileIdentity(lstatSync(markerPath, { bigint: true })) !==
        stableFileIdentity(markerStats)
    ) {
      throw new Error("changed metadata");
    }
    const candidate = path.resolve(root, match[1]);
    const gitDirectoryStats = lstatSync(candidate, { bigint: true });
    if (gitDirectoryStats.isSymbolicLink() || !gitDirectoryStats.isDirectory()) {
      throw new Error("unsafe git directory");
    }
    return Object.freeze({ gitDirectory: realpathSync(candidate), workTree: root });
  } catch {
    throw new Error("Project-owned Git metadata could not be safely resolved.");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function isolatedGitArguments({ args = [], gitDirectory, workTree } = {}) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
    throw new Error("Isolated Git arguments must be strings.");
  }
  if (Boolean(gitDirectory) !== Boolean(workTree)) {
    throw new Error("Isolated Git requires a bound Git directory and worktree together.");
  }
  return [
    "--no-replace-objects",
    "-c",
    "core.bare=false",
    "-c",
    "core.excludesFile=",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.ignoreStat=false",
    "-c",
    "core.trustctime=true",
    "-c",
    "core.checkStat=default",
    "-c",
    "core.preloadIndex=false",
    "-c",
    "core.splitIndex=false",
    "-c",
    "core.sparseCheckout=false",
    "-c",
    "core.sparseCheckoutCone=false",
    "-c",
    "index.sparse=false",
    "-c",
    "core.untrackedCache=false",
    ...(gitDirectory ? [`--git-dir=${absolutePath(gitDirectory, "directory")}`] : []),
    ...(workTree ? [`--work-tree=${absolutePath(workTree, "worktree")}`] : []),
    ...args,
  ];
}

export function localGitExcludeIsInactive({ gitDirectory, workTree } = {}) {
  if (!gitDirectory || !workTree) return false;
  const resolved = spawnSync(
    "git",
    isolatedGitArguments({
      args: ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"],
      gitDirectory,
      workTree,
    }),
    {
      cwd: workTree,
      encoding: "utf8",
      env: cleanGitEnvironment(),
      input: "",
      stdio: "pipe",
    },
  );
  if (resolved.error || resolved.status !== 0) return false;
  const candidate = resolved.stdout.trim();
  if (!candidate || !path.isAbsolute(candidate) || candidate.includes("\0")) return false;
  if (!existsSync(candidate)) return true;

  let initial;
  try {
    initial = lstatSync(candidate, { bigint: true });
  } catch {
    return false;
  }
  if (
    initial.isSymbolicLink() ||
    !initial.isFile() ||
    initial.nlink !== 1n ||
    initial.size > 1024n * 1024n
  ) {
    return false;
  }

  let descriptor;
  try {
    descriptor = openSync(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    if (
      stableFileIdentity(fstatSync(descriptor, { bigint: true })) !== stableFileIdentity(initial)
    ) {
      return false;
    }
    const content = readFileSync(descriptor, "utf8");
    const after = fstatSync(descriptor, { bigint: true });
    if (
      stableFileIdentity(after) !== stableFileIdentity(initial) ||
      stableFileIdentity(lstatSync(candidate, { bigint: true })) !== stableFileIdentity(initial)
    ) {
      return false;
    }
    return content.split("\n").every((line) => {
      const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
      return normalized === "" || normalized.startsWith("#");
    });
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
