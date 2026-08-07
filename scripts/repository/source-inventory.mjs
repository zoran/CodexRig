import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  cleanGitEnvironment,
  isolatedGitArguments,
  resolveOwnedGitMetadata,
} from "./git-runtime-isolation.mjs";
import {
  isExcludedActivePath,
  isPrivateCodexRuntimePath,
  isRepositoryCodexHomePath,
  nonPortableTransferPathReason,
  normalizeSourceRelativePath,
  portableCodexGitignoreProbePaths,
  repositoryCodexHomeProtectedGitignoreProbePaths,
  sourceInventoryPreDescentExcludePatterns,
} from "./source-inventory-policy.mjs";
export {
  activeSourcePathClassification,
  activeSourcePathExclusionReason,
  gitlessPreDescentExcludePatterns,
  isExcludedActivePath,
  isPrivateCodexRuntimePath,
  isRepositoryCodexHomePath,
  nonPortableTransferPathReason,
  portableCodexGitignorePatterns,
  portableCodexGitignoreProbePaths,
  repositoryCodexHomeGitignoreFindings,
  repositoryCodexHomeGitignorePatterns,
  repositoryCodexHomeProtectedGitignoreProbePaths,
  repositoryCodexHomeRuntimeDatabasePrefixes,
  repositoryCodexHomeRuntimeDirectoryNames,
  repositoryCodexHomeRuntimeFileNames,
  repositoryCodexHomeRuntimeProbePaths,
  repositoryCodexRuntimeCacheDirectory,
  repositoryCodexRuntimeDirectory,
  sourceInventoryPreDescentExcludePatterns,
} from "./source-inventory-policy.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(scriptDirectory, "..", "..");

function normalizeRelativePath(value) {
  return normalizeSourceRelativePath(value);
}

function splitNullBuffer(buffer) {
  const paths = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) continue;
    if (index > start) paths.push(buffer.subarray(start, index).toString("utf8"));
    start = index + 1;
  }
  if (start < buffer.length) paths.push(buffer.subarray(start).toString("utf8"));
  return paths;
}

export function repositoryCodexHomeGitignoreBehaviorFindings({ root = repositoryRoot } = {}) {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "codex-ignore-contract-"));
  const gitDirectory = path.join(temporaryDirectory, "git");
  const gitEnvironment = cleanGitEnvironment();
  try {
    const initialized = spawnSync("git", ["init", "--bare", "--quiet", gitDirectory], {
      cwd: realpathSync(root),
      encoding: null,
      env: gitEnvironment,
      input: Buffer.alloc(0),
      stdio: ["pipe", "pipe", "ignore"],
    });
    if (initialized.error || initialized.status !== 0) {
      return ["effective root Codex ignore policy could not initialize its isolated Git probe"];
    }

    const probes = [
      ...repositoryCodexHomeProtectedGitignoreProbePaths,
      ...portableCodexGitignoreProbePaths,
    ];
    const checked = spawnSync(
      "git",
      isolatedGitArguments({
        args: ["check-ignore", "--no-index", "-z", "--stdin"],
        gitDirectory,
        workTree: realpathSync(root),
      }),
      {
        cwd: realpathSync(root),
        encoding: null,
        env: gitEnvironment,
        input: Buffer.from(`${probes.join("\0")}\0`),
        maxBuffer: 1024 * 1024,
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    if (checked.error || ![0, 1].includes(checked.status) || !Buffer.isBuffer(checked.stdout)) {
      return ["effective root Codex ignore policy could not evaluate its isolated Git probe"];
    }
    const ignored = new Set(splitNullBuffer(checked.stdout));
    return [
      ...repositoryCodexHomeProtectedGitignoreProbePaths
        .filter((relativePath) => !ignored.has(relativePath))
        .map((relativePath) => `root Codex runtime is not effectively ignored: ${relativePath}`),
      ...portableCodexGitignoreProbePaths
        .filter((relativePath) => ignored.has(relativePath))
        .map((relativePath) => `portable Codex config is effectively ignored: ${relativePath}`),
    ];
  } catch {
    return ["effective root Codex ignore policy could not run its isolated Git probe"];
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function gitPathOutput(root, gitDirectory, args, label) {
  const result = spawnSync("git", isolatedGitArguments({ args, gitDirectory, workTree: root }), {
    cwd: root,
    encoding: null,
    env: cleanGitEnvironment(),
    input: Buffer.alloc(0),
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "ignore"],
  });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    const detail = result.error?.message ?? `status ${result.status}`;
    throw new Error(`${label} failed (${detail}); repository source inventory is unavailable.`);
  }
  return splitNullBuffer(result.stdout);
}

export function withSourceInventoryPreDescentMask(action) {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "codex-source-mask-"));
  const excludePath = path.join(temporaryDirectory, "pre-descent.exclude");
  try {
    writeFileSync(excludePath, `${sourceInventoryPreDescentExcludePatterns.join("\n")}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return action(excludePath);
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function sourcePathsFromEphemeralGit(root) {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "codex-source-inventory-"));
  const gitDirectory = path.join(temporaryDirectory, "git");
  try {
    const initialized = spawnSync("git", ["init", "--bare", "--quiet", gitDirectory], {
      cwd: root,
      encoding: "utf8",
      env: cleanGitEnvironment(),
      input: "",
      stdio: "pipe",
    });
    if (initialized.error || initialized.status !== 0) {
      const detail = initialized.error?.message ?? `status ${initialized.status}`;
      throw new Error(`Temporary Git inventory initialization failed (${detail}).`);
    }
    return withSourceInventoryPreDescentMask((excludePath) =>
      gitPathOutput(
        root,
        gitDirectory,
        [
          "ls-files",
          "--others",
          "--exclude-per-directory=.gitignore",
          `--exclude-from=${excludePath}`,
          "-z",
        ],
        "Non-Git source inventory",
      ),
    );
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function sourcePathInventory(root, { includeUntracked = true } = {}) {
  let gitMetadata;
  try {
    gitMetadata = resolveOwnedGitMetadata(root);
  } catch {
    throw new Error("Local Git metadata is unreadable; refusing a filesystem inventory fallback.");
  }
  if (!gitMetadata) {
    if (!includeUntracked) {
      throw new Error(
        "Tracked portable transfer requires the source root to be a Git worktree; pass includeUntracked only for an explicit working-tree snapshot.",
      );
    }
    return {
      candidates: sourcePathsFromEphemeralGit(root).filter(
        (relativePath) => !isRepositoryCodexHomePath(relativePath),
      ),
      mode: "active-area-fallback",
    };
  }
  const probe = spawnSync(
    "git",
    isolatedGitArguments({
      args: ["rev-parse", "--show-toplevel"],
      gitDirectory: gitMetadata.gitDirectory,
      workTree: gitMetadata.workTree,
    }),
    {
      cwd: root,
      encoding: "utf8",
      env: cleanGitEnvironment(),
      input: "",
      stdio: "pipe",
    },
  );
  if (probe.error) {
    throw new Error(`Git repository probe failed: ${probe.error.message}`);
  }
  if (probe.status === 0) {
    const topLevel = probe.stdout.trim();
    if (topLevel && realpathSync(topLevel) === realpathSync(root)) {
      const tracked = gitPathOutput(
        root,
        gitMetadata.gitDirectory,
        ["ls-files", "--cached", "-z"],
        "Git source inventory",
      );
      if (!includeUntracked) return { candidates: tracked, mode: "git-tracked" };
      const untracked = withSourceInventoryPreDescentMask((excludePath) =>
        gitPathOutput(
          root,
          gitMetadata.gitDirectory,
          [
            "ls-files",
            "--others",
            "--exclude-per-directory=.gitignore",
            `--exclude-from=${excludePath}`,
            "-z",
          ],
          "Git source inventory",
        ),
      ).filter((relativePath) => !isRepositoryCodexHomePath(relativePath));
      return { candidates: [...tracked, ...untracked], mode: "git-tracked-plus-untracked" };
    }
    throw new Error("Local Git metadata does not identify this directory as its worktree root.");
  }
  throw new Error("Local Git metadata is unreadable; refusing a filesystem inventory fallback.");
}

function stagedTransferPaths(root) {
  const rootStats = lstatSync(root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error("Staged transfer root must be a non-symlink directory.");
  }
  const candidates = [];
  const pending = [{ absolutePath: root, relativePath: "" }];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current.absolutePath, { withFileTypes: true })) {
      const relativePath = current.relativePath
        ? `${current.relativePath}/${entry.name}`
        : entry.name;
      const absolutePath = path.join(current.absolutePath, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Portable transfer source is not a regular file: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        const reason =
          relativePath === ".codex" ? null : nonPortableTransferPathReason(relativePath);
        if (reason) {
          throw new Error(
            `Portable transfer inventory contains nonportable path: ${relativePath} (${reason})`,
          );
        }
        pending.push({ absolutePath, relativePath });
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Portable transfer source is not a regular file: ${relativePath}`);
      }
      candidates.push(relativePath);
    }
  }
  return candidates;
}

function listRegularFiles({
  candidates,
  root,
  maxBytes = Number.POSITIVE_INFINITY,
  excludeHardlinks = false,
  rejectNonRegular = false,
}) {
  const files = new Set();
  const realRoot = realpathSync(root);

  for (const candidate of candidates) {
    const relativePath = normalizeRelativePath(candidate);
    if (!relativePath) continue;
    const segments = relativePath.split("/");
    let parentPath = root;
    for (const segment of segments.slice(0, -1)) {
      parentPath = path.join(parentPath, segment);
      if (existsSync(parentPath) && lstatSync(parentPath).isSymbolicLink()) {
        throw new Error(`Repository source path has a symlinked parent: ${relativePath}`);
      }
    }
    const absolutePath = path.join(root, ...segments);
    if (!existsSync(absolutePath)) continue;
    const linkStats = lstatSync(absolutePath);
    if (linkStats.isSymbolicLink() || !linkStats.isFile() || linkStats.nlink !== 1) {
      if (rejectNonRegular) {
        throw new Error(
          `Portable transfer source is not a single-link regular file: ${relativePath}`,
        );
      }
      if (excludeHardlinks && linkStats.nlink !== 1) continue;
      if (linkStats.isSymbolicLink() || !linkStats.isFile()) continue;
    }
    const resolvedPath = realpathSync(absolutePath);
    const resolvedRelative = path.relative(realRoot, resolvedPath);
    if (
      resolvedRelative === ".." ||
      resolvedRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(resolvedRelative)
    ) {
      throw new Error(`Repository source path resolves outside the repository: ${relativePath}`);
    }
    if (linkStats.size > maxBytes) continue;
    files.add(relativePath);
  }

  return [...files].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function regularRepositoryFileInventory({
  root = repositoryRoot,
  maxBytes = Number.POSITIVE_INFINITY,
  excludeHardlinks = false,
  rejectNonRegular = false,
  includeUntracked = true,
  activeOnly = false,
  portableOnly = false,
} = {}) {
  const inventory = sourcePathInventory(root, { includeUntracked });
  let candidates = inventory.candidates;
  if (activeOnly) candidates = candidates.filter((candidate) => !isExcludedActivePath(candidate));
  if (portableOnly) assertPortableFiles(candidates);
  const protectedRuntimePaths =
    activeOnly || portableOnly
      ? []
      : candidates.filter((candidate) => isPrivateCodexRuntimePath(candidate));
  if (protectedRuntimePaths.length > 0) {
    candidates = candidates.filter((candidate) => !isPrivateCodexRuntimePath(candidate));
  }
  return {
    files: [
      ...listRegularFiles({
        candidates,
        excludeHardlinks,
        maxBytes,
        rejectNonRegular,
        root,
      }),
      ...protectedRuntimePaths,
    ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    mode: inventory.mode,
  };
}

function listRegularRepositoryFiles(options = {}) {
  return regularRepositoryFileInventory(options).files;
}

export function listRepositoryFiles(options = {}) {
  return listRegularRepositoryFiles(options);
}

export function listRepositoryFileInventory(options = {}) {
  return regularRepositoryFileInventory(options);
}

export function listRepositoryPathInventory({
  root = repositoryRoot,
  includeUntracked = true,
} = {}) {
  const inventory = sourcePathInventory(root, { includeUntracked });
  return {
    mode: inventory.mode,
    paths: [...new Set(inventory.candidates.map(normalizeRelativePath).filter(Boolean))].sort(
      (left, right) => (left < right ? -1 : left > right ? 1 : 0),
    ),
  };
}

export function listActiveFiles({
  root = repositoryRoot,
  maxBytes = Number.POSITIVE_INFINITY,
} = {}) {
  return listRegularRepositoryFiles({
    root,
    maxBytes,
    activeOnly: true,
    excludeHardlinks: true,
  });
}

function assertPortableFiles(files) {
  const findings = files
    .map((relativePath) => ({
      path: relativePath,
      reason: nonPortableTransferPathReason(relativePath),
    }))
    .filter((finding) => finding.reason);
  if (findings.length > 0) {
    throw new Error(
      [
        "Portable transfer inventory contains nonportable paths:",
        ...findings.map((finding) => `- ${finding.path} (${finding.reason})`),
      ].join("\n"),
    );
  }
  return files;
}

export function listPortableTransferFiles({ root = repositoryRoot, includeUntracked = true } = {}) {
  return assertPortableFiles(
    listRegularRepositoryFiles({
      root,
      rejectNonRegular: true,
      includeUntracked,
      portableOnly: true,
    }),
  );
}

export function listStagedTransferFiles({ root = repositoryRoot } = {}) {
  return assertPortableFiles(
    listRegularFiles({
      candidates: stagedTransferPaths(root),
      rejectNonRegular: true,
      root,
    }),
  );
}

function main() {
  const args = new Set(process.argv.slice(2));
  const profileArgument = [...args].find((argument) => argument.startsWith("--profile="));
  const profile = profileArgument?.slice("--profile=".length) ?? "active";
  let files;
  if (profile === "base") files = listRepositoryFiles();
  else if (profile === "portable-transfer") files = listPortableTransferFiles();
  else if (profile === "active") files = listActiveFiles();
  else {
    throw new Error(`Unknown source inventory profile: ${profile}`);
  }
  if (args.has("--json")) {
    process.stdout.write(`${JSON.stringify(files, null, 2)}\n`);
    return;
  }
  if (args.has("--null")) {
    for (const file of files) {
      process.stdout.write(file);
      process.stdout.write("\0");
    }
    return;
  }
  for (const file of files) process.stdout.write(`${file}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
