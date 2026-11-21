#!/usr/bin/env node
/** Runs a private local build from committed source using the project's shared, pinned host tools. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  atomicWriteOwnedFile,
  createExclusiveOwnedDirectory,
  ensureOwnedDirectoryChain,
  readOptionalOwnedFile,
  renameOwnedArtifact,
} from "../filesystem/owned-file-operations.mjs";
import {
  closeOwnedDirectoryBinding,
  createExclusiveOwnedFile,
  ensureOwnedPrivateDirectory,
  openPrivateOwnedDirectory,
  validateDirectoryChain,
  validateRemovalTree,
} from "../filesystem/owned-path-safety.mjs";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import {
  cleanGitEnvironment,
  isolatedGitArguments,
  resolveOwnedGitMetadata,
} from "../repository/git-runtime-isolation.mjs";
import {
  createProjectTemporaryScope,
  reconcileProjectTemporaryStorage,
} from "../repository/project-temporary-storage.mjs";
import { withRuntimeLifecycleUpdateMutex } from "../repository/runtime-lifecycle-mutex.mjs";
import { ensureRuntimeDirectory } from "../repository/runtime-owned-state.mjs";
import { sensitivePathReason } from "../repository/sensitive-paths.mjs";
import {
  isPrivateRepositoryStatePath,
  nonPortableTransferPathReason,
} from "../repository/source-inventory-policy.mjs";
import { inspectRepositoryWorktrees } from "../repository/worktree-recovery.mjs";
import { runProjectCommand } from "../setup/project-command.mjs";
import { formatContextError } from "../terminal/terminal-output.mjs";

const state = ".project-state/build";
const retention = 3;
const releasePattern = /^r-(\d{14})-([0-9a-f]{12})$/u;
const usage = "Usage: pnpm build:local init | run [--jobs N] | list | clean";
const example = {
  steps: [
    ["pnpm", "install", "--offline", "--frozen-lockfile"],
    ["pnpm", "run", "build"],
  ],
  artifacts: ["dist"],
};

function safeRelative(value) {
  if (
    typeof value !== "string" ||
    !value ||
    /[\u0000-\u001f\u007f\\:]/u.test(value) ||
    value.split("/").some((part) => !part || [".", "..", ".git"].includes(part.toLowerCase()))
  )
    throw new Error("A build path must be a canonical repository-relative path.");
  return value;
}

function parsePipeline(bytes) {
  const value = JSON.parse(bytes);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !["steps", "artifacts", "jobs", "memoryMiBPerJob"].includes(key),
    ) ||
    !Array.isArray(value.steps) ||
    !value.steps.length ||
    !Array.isArray(value.artifacts) ||
    !value.artifacts.length
  )
    throw new Error("A local pipeline needs steps (argument arrays) and artifact paths.");
  for (const step of value.steps) {
    if (
      !Array.isArray(step) ||
      !step.length ||
      typeof step[0] !== "string" ||
      !step[0] ||
      step.some((arg) => typeof arg !== "string" || arg.includes("\0"))
    )
      throw new Error("Each build step requires one executable and its literal arguments.");
  }
  const paths = value.artifacts.map(safeRelative);
  for (const [index, file] of paths.entries()) {
    if (
      isPrivateRepositoryStatePath(file) ||
      sensitivePathReason(file) ||
      file.startsWith(".project-state/") ||
      file === ".project-state" ||
      paths.some((other, i) => i !== index && (other === file || other.startsWith(`${file}/`)))
    )
      throw new Error("Artifact paths must be distinct public outputs without overlapping trees.");
  }
  for (const key of ["jobs", "memoryMiBPerJob"]) {
    if (key in value && (!Number.isSafeInteger(value[key]) || value[key] <= 0))
      throw new Error(`Pipeline ${key} must be a positive integer.`);
  }
  return value;
}

function hostValue(file) {
  try {
    return readFileSync(file, "utf8").trim();
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error.code)) return "";
    throw error;
  }
}

/** Affinity, accessible Linux cgroup quotas and optional measured memory per compiler worker bound jobs. */
function buildJobs(pipeline, requested) {
  let count = os.availableParallelism();
  if (process.platform === "linux") {
    const memberships = hostValue("/proc/self/cgroup");
    const unified = memberships.match(/^0::(\/[^\n]*)$/mu)?.[1];
    const legacy = memberships
      .split("\n")
      .map((line) => line.split(":"))
      .find(([, controllers]) => controllers?.split(",").includes("cpu"))?.[2];
    const controllers = [
      ["/sys/fs/cgroup", unified, true],
      ...["cpu", "cpu,cpuacct", "cpuacct,cpu"].map((name) => [
        `/sys/fs/cgroup/${name}`,
        legacy,
        false,
      ]),
    ];
    for (const [mount, group, combined] of controllers) {
      if (!group) continue;
      for (
        let dir = path.join(mount, path.posix.resolve("/", group));
        inside(mount, dir);
        dir = path.dirname(dir)
      ) {
        const [quota, period] = combined
          ? hostValue(path.join(dir, "cpu.max")).split(/\s+/u).map(Number)
          : ["cpu.cfs_quota_us", "cpu.cfs_period_us"].map((name) =>
              Number(hostValue(path.join(dir, name))),
            );
        if (quota > 0 && period > 0) count = Math.min(count, Math.ceil(quota / period));
      }
    }
  }
  if (pipeline.memoryMiBPerJob)
    count = Math.min(
      count,
      Math.floor(process.availableMemory() / (pipeline.memoryMiBPerJob * 1024 ** 2)),
    );
  return Math.max(1, Math.min(count, pipeline.jobs ?? Infinity, requested ?? Infinity));
}

function runGit(metadata, env, args) {
  const result = spawnSync("git", isolatedGitArguments({ ...metadata, args }), {
    cwd: metadata.workTree,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 ** 2,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      "Cannot read the project's committed Git source. A local commit is required before building.",
    );
  return new TextDecoder("utf-8", { fatal: true }).decode(result.stdout);
}

function inside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function assertContainedLink(root, candidate) {
  if (path.isAbsolute(readlinkSync(candidate)) || !inside(root, realpathSync.native(candidate)))
    throw new Error("A build symlink points outside its owned tree.");
}

function snapshotSource(root, source) {
  const metadata = resolveOwnedGitMetadata(root);
  if (!metadata) throw new Error("Local builds need a repository with a committed HEAD.");
  const env = {
    ...cleanGitEnvironment(process.env, root),
    GIT_ATTR_NOSYSTEM: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_ALLOW_PROTOCOL: "",
  };
  const commit = runGit(metadata, env, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(commit))
    throw new Error("Invalid local Git commit.");
  const links = [];
  for (const entry of runGit(metadata, env, ["ls-tree", "-rz", "--full-tree", commit])
    .split("\0")
    .filter(Boolean)) {
    const separate = entry.indexOf("\t");
    const mode = entry.slice(0, separate).split(" ")[0];
    const file = safeRelative(entry.slice(separate + 1));
    if (!["100644", "100755", "120000"].includes(mode))
      throw new Error(`Materialize the source dependency explicitly before building ${file}.`);
    if (nonPortableTransferPathReason(file) || sensitivePathReason(file))
      throw new Error(`Refusing a committed private build input: ${file}`);
    if (mode === "120000") links.push(file);
  }
  // Use Git's native streaming archiver, with an empty attribute view and the original immutable object store.
  // Packaging attributes such as export-ignore/export-subst would otherwise silently change build inputs.
  const archiveGit = createExclusiveOwnedDirectory(
    root,
    path.join(path.dirname(source), "archive-metadata"),
    "private archive metadata",
  );
  const init = spawnSync(
    "git",
    [
      "init",
      "--quiet",
      "--bare",
      "--template=",
      `--object-format=${commit.length === 64 ? "sha256" : "sha1"}`,
      archiveGit,
    ],
    { cwd: archiveGit, env, stdio: "ignore" },
  );
  if (init.error || init.status !== 0)
    throw new Error("Could not create the private Git attribute view.");
  const objects = runGit(metadata, env, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "objects",
  ]).trim();
  const args = isolatedGitArguments({
    gitDirectory: archiveGit,
    workTree: archiveGit,
    args: [
      "-c",
      `core.attributesFile=${os.devNull}`,
      "archive",
      "--worktree-attributes",
      "--format=tar",
      commit,
    ],
  });
  const result = spawnSync(
    "bash",
    [
      "-p",
      "-c",
      'set -o pipefail; git "$@" | tar -xf -',
      "local-source",
      "-C",
      archiveGit,
      ...args,
    ],
    {
      cwd: source,
      env: { ...env, GIT_OBJECT_DIRECTORY: objects },
      stdio: ["ignore", "ignore", "pipe"],
      encoding: "utf8",
    },
  );
  if (result.error || result.status !== 0)
    throw new Error("Could not extract the local committed Git source.");
  for (const file of links) {
    const target = path.join(source, file);
    assertContainedLink(source, target);
  }
  for (const file of [
    ".codex/mise.toml",
    ".codex/mise.lock",
    ".codex/toolchain.json",
    ".codex/.mise/locks/pnpm/current/package.json",
    ".codex/.mise/locks/pnpm/current/aube-lock.yaml",
  ]) {
    const current = readOptionalOwnedFile(root, path.join(root, file), "active toolchain pin");
    const pinned = readOptionalOwnedFile(
      source,
      path.join(source, file),
      "committed toolchain pin",
    );
    if (
      current.exists !== pinned.exists ||
      (current.exists && !current.buffer.equals(pinned.buffer))
    )
      throw new Error(`Commit the current toolchain pin before building: ${file}`);
  }
  return commit;
}

function identity(directory) {
  const stats = lstatSync(directory, { bigint: true });
  return `${stats.dev}:${stats.ino}`;
}

function ownedReleases(root, releases) {
  return readdirSync(releases)
    .filter((name) => releasePattern.test(name))
    .sort()
    .reverse()
    .map((id) => {
      const directory = path.join(releases, id);
      validateDirectoryChain(root, directory, "local release");
      const marker = readOptionalOwnedFile(
        root,
        path.join(directory, "release.json"),
        "local release receipt",
        { maximumBytes: 4096 },
      );
      const record = marker.exists && JSON.parse(marker.buffer);
      if (
        record?.id !== id ||
        record.schemaVersion !== 1 ||
        record.root !== identity(root) ||
        record.directory !== identity(directory) ||
        !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(record.commit) ||
        !id.endsWith(record.commit.slice(0, 12))
      )
        throw new Error("Local release ownership could not be verified. Its files were preserved.");
      return record;
    });
}

function retire(root, releases, scope, records) {
  for (const record of records.slice(retention)) {
    const directory = path.join(releases, record.id);
    const expectedIdentity = lstatSync(directory);
    if (record.directory !== identity(directory))
      throw new Error("Local release changed before retirement.");
    renameOwnedArtifact(
      root,
      directory,
      path.join(scope, record.id),
      "directory",
      "retired local build",
      { expectedIdentity },
    );
  }
}

function collectArtifacts(root, source, artifacts, names) {
  for (const name of names) {
    const target = path.join(source, name);
    if (path.dirname(target) !== source)
      validateDirectoryChain(source, path.dirname(target), "artifact input");
    const stats = lstatSync(target);
    const type = stats.isDirectory() ? "directory" : "file";
    validateRemovalTree(target, type, "local build artifact", lstatSync(root).dev, {
      allowSymlinkEntries: true,
    });
    if (type === "directory") {
      const folders = [target];
      let files = 0;
      while (folders.length) {
        const folder = folders.pop();
        for (const entry of readdirSync(folder, { withFileTypes: true })) {
          const item = path.join(folder, entry.name);
          if (entry.isSymbolicLink()) assertContainedLink(target, item);
          else if (entry.isDirectory()) folders.push(item);
          else files++;
        }
      }
      if (!files) throw new Error(`Missing built files in ${name}.`);
    }
    ensureOwnedDirectoryChain(artifacts, path.dirname(name), "release artifact parent");
    renameOwnedArtifact(root, target, path.join(artifacts, name), type, "built artifact");
  }
}

/** Runs literal project commands with pinned binaries from the canonical locked host tool environment. */
async function executeSteps({ root, source, jobs, steps, runCommand }) {
  const jobCount = String(jobs);
  // Numeric worker controls are supplied after the project's environment allowlist. No operator input is shell source.
  const args = [
    "-p",
    "-c",
    [
      'cd -- "$1" || exit 1',
      'export GIT_CEILING_DIRECTORIES="${1%/*}" BUILD_JOBS="$2" CMAKE_BUILD_PARALLEL_LEVEL="$2" CTEST_PARALLEL_LEVEL="$2" CARGO_BUILD_JOBS="$2" MAKEFLAGS="-j$2"',
      "shift 2",
      'exec -- "$@" >&2',
    ].join("\n"),
    "local-build",
    source,
    jobCount,
  ];
  const inherited = {
    ...process.env,
    PATH: (process.env.PATH ?? "")
      .split(path.delimiter)
      .filter((directory) => path.isAbsolute(directory) && !inside(root, directory))
      .join(path.delimiter),
  };
  for (const [i, step] of steps.entries()) {
    const status = await runCommand({ root, command: "bash", args: [...args, ...step], inherited });
    if (status !== 0) {
      const error = new Error(`Local build step ${i + 1} failed (exit ${status}).`);
      error.exitCode = status;
      throw error;
    }
  }
}

/** Shared CLI entry, with a project-command seam for local integration fixtures. */
export async function localBuild(
  args,
  { root = toolingRoot, runCommand = runProjectCommand, environment = process.env } = {},
) {
  const [action, ...flags] = args;
  if (
    !["init", "run", "list", "clean"].includes(action) ||
    (flags.length &&
      !(
        action === "run" &&
        flags.length === 2 &&
        flags[0] === "--jobs" &&
        /^[1-9][0-9]*$/u.test(flags[1]) &&
        Number.isSafeInteger(Number(flags[1]))
      ))
  )
    throw new Error(usage);
  if (
    ["GITHUB_ACTIONS", "GITLAB_CI", "GITEA_ACTIONS", "FORGEJO_ACTIONS", "TF_BUILD"].some((key) =>
      /^(?:true|1)$/iu.test(environment[key] ?? ""),
    ) ||
    Boolean(environment.BITBUCKET_PIPELINE_UUID)
  )
    throw new Error("Local builds require an operator-controlled host outside provider CI.");
  const base = path.join(root, state);
  const releases = path.join(base, "releases");
  if (action === "list") {
    try {
      closeOwnedDirectoryBinding(
        openPrivateOwnedDirectory(root, releases, "private local releases"),
      );
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    ensureRuntimeDirectory(root);
    return withRuntimeLifecycleUpdateMutex(root, () =>
      ownedReleases(root, releases).map(({ id, commit, jobs }) => ({ id, commit, jobs })),
    );
  }
  ensureOwnedDirectoryChain(root, ".project-state", "private project state");
  ensureOwnedPrivateDirectory(root, base, "local build state");
  const pipelineFile = path.join(base, "pipeline.json");
  if (action === "init") {
    const directory = openPrivateOwnedDirectory(root, base, "local build state");
    try {
      createExclusiveOwnedFile(
        directory,
        "pipeline.json",
        `${JSON.stringify(example, null, 2)}\n`,
        "local pipeline",
      );
    } finally {
      closeOwnedDirectoryBinding(directory);
    }
    return { pipeline: path.relative(root, pipelineFile) };
  }
  const work = path.join(base, "work");
  ensureOwnedPrivateDirectory(root, work, "private build work");
  ensureOwnedPrivateDirectory(root, releases, "private local releases");
  ensureRuntimeDirectory(root);
  const inventory = inspectRepositoryWorktrees({ root });
  if (
    !inventory.complete ||
    inventory.worktrees.some(
      (tree) =>
        (tree.problem && tree.directoryStatus !== "missing") ||
        ["invalid", "unknown"].includes(tree.session.status),
    )
  )
    throw new Error("Local build refused unsafe project/worktree ownership.");
  const protectedPaths = inventory.worktrees.map((tree) => tree.path);
  const scope = createProjectTemporaryScope({ root, parent: work, protectedPaths });
  try {
    // A crash after promotion and before trimming is repaired on the next run/clean.
    const retained = withRuntimeLifecycleUpdateMutex(root, () => {
      const records = ownedReleases(root, releases);
      retire(root, releases, scope.directory, records);
      return Math.min(retention, records.length);
    });
    if (action === "clean")
      return {
        retained,
        work: reconcileProjectTemporaryStorage({ root, parent: work, protectedPaths }).filter(
          (entry) => entry.path !== path.relative(root, path.dirname(scope.directory)),
        ),
      };
    const configured = readOptionalOwnedFile(root, pipelineFile, "local pipeline", {
      maximumBytes: 128 * 1024,
    });
    if (!configured.exists)
      throw new Error("Run build:local init and configure your project's private pipeline first.");
    const pipeline = parsePipeline(configured.buffer);
    const jobs = buildJobs(pipeline, flags.length ? Number(flags[1]) : undefined);
    const source = createExclusiveOwnedDirectory(
      root,
      path.join(scope.directory, "source"),
      "private build source",
    );
    const candidate = createExclusiveOwnedDirectory(
      root,
      path.join(scope.directory, "candidate"),
      "local build candidate",
    );
    const artifacts = createExclusiveOwnedDirectory(
      root,
      path.join(candidate, "artifacts"),
      "local build outputs",
    );
    const commit = snapshotSource(root, source);
    await executeSteps({ root, source, jobs, steps: pipeline.steps, runCommand });
    collectArtifacts(root, source, artifacts, pipeline.artifacts);
    return withRuntimeLifecycleUpdateMutex(root, () => {
      const previous = ownedReleases(root, releases);
      const timestamp = Math.max(Date.now(), Number(previous[0]?.id.split("-")[1] ?? 0) + 1);
      const id = `r-${String(timestamp).padStart(14, "0")}-${commit.slice(0, 12)}`;
      const record = {
        schemaVersion: 1,
        id,
        commit,
        jobs,
        pipelineSha256: createHash("sha256").update(configured.buffer).digest("hex"),
        root: identity(root),
        directory: identity(candidate),
      };
      atomicWriteOwnedFile(
        root,
        path.join(candidate, "release.json"),
        `${JSON.stringify(record)}\n`,
        0o600,
      );
      renameOwnedArtifact(
        root,
        candidate,
        path.join(releases, id),
        "directory",
        "completed local build",
      );
      retire(root, releases, scope.directory, [record, ...previous]);
      return { id, commit, jobs, artifacts: path.join(state, "releases", id, "artifacts") };
    });
  } finally {
    if (!scope.release())
      console.warn(
        "Local build scratch retained for active or unobservable consumers. The next build will retry cleanup.",
      );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2).filter((arg, index) => index !== 0 || arg !== "--");
    if (args.includes("--help")) console.log(usage);
    else console.log(JSON.stringify(await localBuild(args), null, 2));
  } catch (error) {
    console.error(formatContextError(error, toolingRoot));
    process.exitCode =
      Number.isInteger(error.exitCode) && error.exitCode > 0 && error.exitCode <= 255
        ? error.exitCode
        : 1;
  }
}
