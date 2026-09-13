/** Owns adaptive state behavior for the repository verification boundary. */
import { spawnSyncWithBoundedIo as spawnSync } from "../repository/runtime-process-io.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  discoverProductLayout,
  isProductImplementationPath,
  isProductSurfacePath,
} from "../repository/product-roots.mjs";
import {
  activeSourcePathClassification,
  isRepositoryCodexHomePath,
  listActiveFiles,
} from "../repository/source-inventory.mjs";
import {
  cleanGitEnvironment,
  isolatedGitArguments,
  isolatedGitResultCompleted,
  localGitExcludeIsInactive,
  resolveOwnedGitMetadata,
} from "../repository/git-runtime-isolation.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(scriptDir, "..", "..");

const imageExtensions = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const executableSkillExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".ts",
  ".tsx",
]);
const applicationSourceExtensions = new Set([
  ...executableSkillExtensions,
  ".astro",
  ".css",
  ".htm",
  ".html",
  ".mdx",
  ".scss",
  ".svelte",
  ".vue",
]);
const identityAccessBoundaryNames = new Set([
  "access-control",
  "auth",
  "authentication",
  "authorization",
  "iam",
  "identity",
  "identity-access",
]);
const tenancyBoundaryNames = new Set([
  "multi-tenant",
  "multitenancy",
  "tenant",
  "tenant-context",
  "tenancy",
  "tenants",
]);
const moduleWrapperNames = new Set(["capabilities", "domains", "features", "modules"]);
const localSourceClassificationCodes = new Set([
  "backup-file",
  "generated-runtime-directory",
  "machine-local-file",
  "project-codex-runtime",
  "repository-codex-runtime",
]);

export function unique(values) {
  return [...new Set(values)];
}

export function normalizePath(filePath) {
  return String(filePath ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/")
    .trim();
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    input: options.input ?? "",
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    stdio: options.stdio ?? "pipe",
    timeout: options.timeout ?? 120_000,
    env: { ...process.env, ...options.env },
  });
  if (result.error) {
    if (options.allowFailure) return null;
    throw result.error;
  }
  if (result.status !== 0) {
    if (options.allowFailure) return null;
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(output || `${command} ${args.join(" ")} exited with ${result.status}`);
  }
  return result.stdout ?? "";
}

const gitMetadataByRoot = new Map();

function projectGitMetadata(repositoryRoot) {
  if (!gitMetadataByRoot.has(repositoryRoot)) {
    gitMetadataByRoot.set(repositoryRoot, resolveOwnedGitMetadata(repositoryRoot));
  }
  return gitMetadataByRoot.get(repositoryRoot);
}

function git(args, options = {}) {
  const repositoryRoot = options.repositoryRoot ?? root;
  let metadata;
  try {
    metadata = projectGitMetadata(repositoryRoot);
  } catch (error) {
    if (options.allowFailure) return null;
    throw error;
  }
  if (!metadata) {
    if (options.allowFailure) return null;
    throw new Error("Project-owned Git metadata is unavailable.");
  }
  const invocationArguments = isolatedGitArguments({
    args,
    gitDirectory: metadata.gitDirectory,
    workTree: metadata.workTree,
  });
  const result = spawnSync("git", invocationArguments, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: options.input ?? "",
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    stdio: options.stdio ?? "pipe",
    timeout: options.timeout ?? 120_000,
    env: { ...cleanGitEnvironment(), ...options.env },
  });
  if (!isolatedGitResultCompleted(result, { args: invocationArguments, encoding: "utf8" })) {
    if (options.allowFailure) return null;
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw result.error ?? new Error(output || `git ${args.join(" ")} exited with ${result.status}`);
  }
  return result.stdout ?? "";
}

export function insideGitWorktree() {
  return git(["rev-parse", "--is-inside-work-tree"], { allowFailure: true })?.trim() === "true";
}

export function parsePorcelainStatus(output) {
  const paths = new Set();
  const fields = String(output ?? "").split("\0");

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field) continue;
    if (field.length < 4 || field[2] !== " ") {
      throw new Error("Git status emitted an unsupported porcelain record.");
    }

    const status = field.slice(0, 2);
    const currentPath = normalizePath(field.slice(3));
    if (currentPath) paths.add(currentPath);

    if (/[RC]/.test(status)) {
      const originalPath = normalizePath(fields[++index] ?? "");
      if (!originalPath) throw new Error("Git status emitted an incomplete rename/copy record.");
      paths.add(originalPath);
    }
  }

  return [...paths].sort();
}

export function parseNameStatus(output) {
  const paths = new Set();
  const fields = String(output ?? "").split("\0");
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status) continue;
    if (!/^[ACDMRTUXB][0-9]*$/u.test(status)) {
      throw new Error("Git diff emitted an unsupported name-status record.");
    }
    const count = /^[RC]/u.test(status) ? 2 : 1;
    for (let pathIndex = 0; pathIndex < count; pathIndex += 1) {
      const filePath = normalizePath(fields[index++] ?? "");
      if (!filePath) throw new Error("Git diff emitted an incomplete name-status record.");
      paths.add(filePath);
    }
  }
  return [...paths].sort();
}

function freshHeadStatus(repositoryRoot = root) {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "adaptive-verification-index-"));
  const environment = { GIT_INDEX_FILE: path.join(temporaryDirectory, "index") };
  try {
    const loadedHead = git(["read-tree", "HEAD"], {
      allowFailure: true,
      env: environment,
      repositoryRoot,
    });
    if (loadedHead === null) {
      git(["read-tree", "--empty"], { env: environment, repositoryRoot });
    }
    return git(
      ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"],
      { env: environment, repositoryRoot },
    );
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function committedPathsFromUpstream(repositoryRoot = root) {
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], {
    allowFailure: true,
    repositoryRoot,
  })?.trim();
  if (!upstream) return { paths: [], incomplete: false, reason: "" };
  if (upstream.length > 1_024 || upstream.startsWith("-") || /[\0\r\n]/u.test(upstream)) {
    return { paths: [], incomplete: true, reason: "unsafe upstream ref identity" };
  }
  const output = git(
    ["diff", "--name-status", "-z", "--find-renames", "--find-copies", `${upstream}...HEAD`, "--"],
    { allowFailure: true, repositoryRoot },
  );
  if (output === null) {
    return { paths: [], incomplete: true, reason: "git diff against upstream" };
  }
  try {
    return { paths: parseNameStatus(output), incomplete: false, reason: "" };
  } catch (error) {
    return { paths: [], incomplete: true, reason: error.message };
  }
}

export function changedPathsFromGit({ repositoryRoot = root } = {}) {
  let metadata;
  try {
    metadata = projectGitMetadata(repositoryRoot);
  } catch {
    metadata = null;
  }
  if (!metadata || !localGitExcludeIsInactive(metadata)) {
    return {
      paths: [],
      incomplete: true,
      reason: "active or unsafe repository-local Git exclude rules",
    };
  }
  let output;
  try {
    output = freshHeadStatus(repositoryRoot);
  } catch {
    output = null;
  }
  if (output === null) {
    return { paths: [], incomplete: true, reason: "git status --porcelain=v1 -z" };
  }
  try {
    const worktreePaths = parsePorcelainStatus(output);
    const committed = committedPathsFromUpstream(repositoryRoot);
    return {
      paths: unique([...worktreePaths, ...committed.paths]).sort(),
      incomplete: committed.incomplete,
      reason: committed.reason,
    };
  } catch (error) {
    return { paths: [], incomplete: true, reason: error.message };
  }
}

function isGeneratedOrLocal(filePath) {
  return localSourceClassificationCodes.has(activeSourcePathClassification(filePath)?.code);
}

function isActiveDocumentation(filePath) {
  return (
    filePath === "AGENTS.md" ||
    filePath === "README.md" ||
    filePath === "instructions.md" ||
    filePath.startsWith("docs/") ||
    filePath.endsWith(".md") ||
    filePath.endsWith(".mdx") ||
    filePath.endsWith(".txt")
  );
}

function isContextPolicy(filePath) {
  return (
    filePath === "AGENTS.md" ||
    filePath === "README.md" ||
    filePath === "instructions.md" ||
    filePath === ".agents/skills/project-implementation/SKILL.md" ||
    filePath === ".agents/skills/resume-project/SKILL.md" ||
    /^\.codex\/agents\/[a-z][a-z0-9_-]*\.toml$/.test(filePath) ||
    filePath.startsWith("scripts/context/")
  );
}

function isImageQualityPolicy(filePath) {
  return (
    filePath === "instructions.md" ||
    filePath.startsWith(".agents/skills/generated-image-quality-review/") ||
    [
      "scripts/verify/adaptive-surfaces.mjs",
      "scripts/verify/image-assets.mjs",
      "scripts/verify/surface-quality.mjs",
    ].includes(filePath.replace(/\.test(?=\.mjs$)/u, ""))
  );
}

function isCodexRuntimeConfig(filePath) {
  return (
    filePath === ".codex/config.toml" ||
    filePath === ".codex/hooks.json" ||
    filePath === ".codex/README.md" ||
    /^\.codex\/agents\/[a-z][a-z0-9_-]*\.toml$/.test(filePath)
  );
}

function isCodexRuntimeBoundary(filePath) {
  return (
    isRepositoryCodexHomePath(filePath) || filePath === ".codex" || filePath.startsWith(".codex/")
  );
}

function isCodexSystemSkillCache(filePath) {
  return filePath === ".codex/skills/.system" || filePath.startsWith(".codex/skills/.system/");
}

export function isCodexSkillsBoundary(filePath) {
  return filePath === ".codex/skills" || filePath.startsWith(".codex/skills/");
}

function isRepoLocalSkill(filePath) {
  return filePath.startsWith(".agents/skills/");
}

function isRepoLocalSkillMetadata(filePath) {
  return isRepoLocalSkill(filePath) && filePath.endsWith("/agents/openai.yaml");
}

function isRepoLocalSkillExecutable(filePath) {
  return isRepoLocalSkill(filePath) && executableSkillExtensions.has(path.extname(filePath));
}

function isFrameworkScript(filePath) {
  return filePath.startsWith("scripts/") && !filePath.endsWith("/README.md");
}

function isDependencyFile(filePath) {
  return (
    filePath === "mise.lock" ||
    filePath === "mise.toml" ||
    filePath === "package.json" ||
    filePath.endsWith("/package.json") ||
    filePath === "package.exports.json" ||
    filePath.endsWith("/package.exports.json") ||
    filePath === "pnpm-lock.yaml" ||
    filePath === "pnpm-workspace.yaml" ||
    filePath === "dependency-policy.json" ||
    /(?:^|\/)(?:package-lock\.json|yarn\.lock|bun\.lockb?)$/i.test(filePath)
  );
}

function isImageAsset(filePath, productLayout) {
  return (
    imageExtensions.has(path.extname(filePath).toLowerCase()) &&
    isProductSurfacePath(filePath, productLayout)
  );
}

function isAppRuntimeSource(filePath, productLayout) {
  return (
    (isProductImplementationPath(filePath, productLayout) &&
      applicationSourceExtensions.has(path.extname(filePath).toLowerCase())) ||
    isImageAsset(filePath, productLayout)
  );
}

function isIdentityAccessPath(filePath, productLayout) {
  if (!isProductImplementationPath(filePath, productLayout)) return false;
  const sourceRoot = [...productLayout.sourceRoots]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => filePath === candidate || filePath.startsWith(`${candidate}/`));
  if (!sourceRoot) return false;
  const segments = filePath.slice(sourceRoot.length).replace(/^\//u, "").split("/");
  const boundaryIndex = moduleWrapperNames.has(segments[0]) ? 1 : 0;
  return identityAccessBoundaryNames.has(segments[boundaryIndex]);
}

function isTenancyPath(filePath, productLayout) {
  if (!isProductImplementationPath(filePath, productLayout)) return false;
  const sourceRoot = [...productLayout.sourceRoots]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => filePath === candidate || filePath.startsWith(`${candidate}/`));
  if (!sourceRoot) return false;
  const segments = filePath.slice(sourceRoot.length).replace(/^\//u, "").split("/");
  const boundaryIndex = moduleWrapperNames.has(segments[0]) ? 1 : 0;
  return tenancyBoundaryNames.has(segments[boundaryIndex]);
}

function isInfrastructure(filePath) {
  return (
    filePath.startsWith("infra/") ||
    filePath.startsWith(".github/workflows/") ||
    filePath === ".gitlab-ci.yml" ||
    filePath.startsWith(".codexrig/") ||
    /(^|\/)(?:dockerfile|compose\.ya?ml|docker-compose\.ya?ml|cloudbuild\.ya?ml|firebase\.json|\.firebaserc)$/i.test(
      filePath,
    ) ||
    /(^|\/)(?:tsconfig|vite\.config|next\.config|astro\.config|svelte\.config|nuxt\.config|wrangler)\b/i.test(
      filePath,
    )
  );
}

function isRepositorySourcePolicy(filePath) {
  return filePath === ".gitignore" || filePath === ".gitattributes";
}

function isLicensingContract(filePath) {
  return filePath === "LICENSE" || filePath === "NOTICE";
}

export function classifyPath(inputPath, { productLayout } = {}) {
  const filePath = normalizePath(inputPath);
  const categories = [];
  const layout =
    productLayout ??
    discoverProductLayout({ repositoryRoot: root, relativePaths: listActiveFiles({ root }) });

  if (!filePath) return ["unknown or incomplete change scope"];
  if (isGeneratedOrLocal(filePath) || isCodexSystemSkillCache(filePath)) {
    categories.push("generated/cache/local-only files");
  }
  if (isActiveDocumentation(filePath)) categories.push("active documentation");
  if (isContextPolicy(filePath)) categories.push("context source-policy surface");
  if (isImageQualityPolicy(filePath)) categories.push("image quality surface");
  if (isCodexRuntimeConfig(filePath)) categories.push("project Codex config");
  if (isCodexRuntimeBoundary(filePath) && !isCodexRuntimeConfig(filePath)) {
    categories.push("Codex runtime boundary");
  }
  if (isCodexSkillsBoundary(filePath) && !isCodexSystemSkillCache(filePath)) {
    categories.push("skill path boundary");
  }
  if (isRepoLocalSkill(filePath)) categories.push("repo-local skill source");
  if (isRepoLocalSkillMetadata(filePath)) categories.push("repo-local skill metadata");
  if (isRepoLocalSkillExecutable(filePath)) {
    categories.push("repo-local skill executable source");
    categories.push("setup workflow");
  }
  if (isFrameworkScript(filePath)) categories.push("framework scripts");
  if (
    filePath.startsWith("scripts/framework/") ||
    filePath.startsWith("scripts/platform/") ||
    [
      "scripts/setup/startup-attestation.mjs",
      "scripts/setup/session-control-hook-command.mjs",
      "scripts/setup/startup-runtime-executables.mjs",
      "scripts/setup/startup-session-controller.mjs",
    ].includes(filePath) ||
    filePath.startsWith(".codexrig/") ||
    filePath === ".gitlab-ci.yml" ||
    filePath === ".github/workflows/ci.yml"
  ) {
    categories.push("CodexRig framework workflow");
  }
  if (filePath.startsWith("scripts/verify/") || filePath === "scripts/git-hooks/pre-push") {
    categories.push("verification orchestration");
  }
  if (filePath.startsWith("scripts/context/")) categories.push("context workflow");
  if (filePath.startsWith("scripts/deps/")) categories.push("dependency workflow");
  if (filePath.startsWith("scripts/stack/")) categories.push("stack workflow");
  if (filePath.startsWith("scripts/web/")) categories.push("web workflow");
  if (filePath.startsWith("scripts/setup/")) categories.push("setup workflow");
  if (filePath === "scripts/README.md") categories.push("script catalog");
  if (isDependencyFile(filePath)) categories.push("dependency/package manager files");
  if (isLicensingContract(filePath)) categories.push("licensing and attribution contract");
  if (isRepositorySourcePolicy(filePath)) categories.push("repository source-policy surface");
  if (isAppRuntimeSource(filePath, layout)) categories.push("app/package/service/runtime source");
  if (isIdentityAccessPath(filePath, layout)) {
    categories.push("identity/access trust boundary");
  }
  if (isTenancyPath(filePath, layout)) categories.push("tenant-isolation trust boundary");
  if (isInfrastructure(filePath)) categories.push("infrastructure/runtime config");
  if (isImageAsset(filePath, layout)) categories.push("image asset surface");
  if (categories.length === 0) categories.push("unknown or incomplete change scope");
  return unique(categories);
}

export function isFullRelevantPath(filePath, options) {
  const categories = classifyPath(filePath, options);
  return categories.some((category) =>
    [
      "app/package/service/runtime source",
      "dependency/package manager files",
      "framework scripts",
      "infrastructure/runtime config",
      "licensing and attribution contract",
      "repository source-policy surface",
      "unknown or incomplete change scope",
    ].includes(category),
  );
}

const objectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

function isZeroObjectId(value) {
  return objectIdPattern.test(value) && /^0+$/.test(value);
}

export function parsePrePushInput(input) {
  const entries = [];
  for (const [index, rawLine] of String(input ?? "")
    .split(/\r?\n/)
    .entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const fields = line.split(/\s+/);
    if (fields.length !== 4) {
      throw new Error(`Pre-push ref line ${index + 1} must contain four fields.`);
    }
    const [localRef, localObject, remoteRef, remoteObject] = fields;
    if (!objectIdPattern.test(localObject) || !objectIdPattern.test(remoteObject)) {
      throw new Error(`Pre-push ref line ${index + 1} contains an invalid object ID.`);
    }
    entries.push({ localRef, localObject, remoteRef, remoteObject });
  }
  return entries;
}

export function validatePushedRefsAgainstHead(entries, { headObject, resolveCommit }) {
  if (!objectIdPattern.test(headObject) || isZeroObjectId(headObject)) {
    throw new Error("Current HEAD did not resolve to a valid commit object ID.");
  }

  const pushedCommits = new Set();
  for (const entry of entries) {
    if (isZeroObjectId(entry.localObject)) continue;
    const commitObject = resolveCommit(entry.localObject);
    if (!commitObject || !objectIdPattern.test(commitObject) || isZeroObjectId(commitObject)) {
      throw new Error(`Pushed object for ${entry.localRef} does not resolve to a commit.`);
    }
    if (commitObject.toLowerCase() !== headObject.toLowerCase()) {
      throw new Error(
        `Pushed ref ${entry.localRef} does not match the clean checked-out HEAD; check out that commit before pushing.`,
      );
    }
    pushedCommits.add(commitObject.toLowerCase());
  }

  return [...pushedCommits].sort();
}

function publicationIndexFlagsAreSafe(repositoryRoot) {
  const output = git(["ls-files", "-v", "-z"], { repositoryRoot });
  return output
    .split("\0")
    .filter(Boolean)
    .every((record) => record[0] !== "S" && !/[a-z]/u.test(record[0]));
}

export function validateCurrentCheckoutForPush(input, { repositoryRoot = root } = {}) {
  if (
    git(["rev-parse", "--is-inside-work-tree"], {
      allowFailure: true,
      repositoryRoot,
    })?.trim() !== "true"
  ) {
    throw new Error("Pre-push verification requires a Git worktree.");
  }
  if (!localGitExcludeIsInactive(projectGitMetadata(repositoryRoot))) {
    throw new Error(
      "Pre-push verification rejects active or unsafe repository-local Git excludes.",
    );
  }
  if (!publicationIndexFlagsAreSafe(repositoryRoot)) {
    throw new Error("Pre-push verification rejects skip-worktree or assume-unchanged index flags.");
  }

  const status = freshHeadStatus(repositoryRoot);
  if (status.length > 0) {
    throw new Error(
      "Pre-push verification requires a clean working tree and index. Git push sends commits, not staged or unstaged content; git add alone is insufficient. Commit or amend the intended content before pushing.",
    );
  }

  const headObject = git(["rev-parse", "--verify", "HEAD^{commit}"], { repositoryRoot }).trim();
  const entries = parsePrePushInput(input);
  const pushedCommits =
    entries.length === 0
      ? [headObject.toLowerCase()]
      : validatePushedRefsAgainstHead(entries, {
          headObject,
          resolveCommit(objectId) {
            return git(["rev-parse", "--verify", `${objectId}^{commit}`], {
              allowFailure: true,
              repositoryRoot,
            })?.trim();
          },
        });

  return { directInvocation: entries.length === 0, headObject, pushedCommits };
}
