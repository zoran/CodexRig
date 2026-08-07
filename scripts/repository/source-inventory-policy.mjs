import path from "node:path";

export const repositoryCodexRuntimeDirectory = ".codex/runtime";
export const repositoryCodexRuntimeCacheDirectory = `${repositoryCodexRuntimeDirectory}/cache`;

const excludedActiveDirectoryNames = new Set([
  ".codex",
  ".context-index",
  ".git",
  ".next",
  ".pnpm-store",
  ".project-state",
  "backup",
  "backups",
  "blob-report",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "target",
  "test-results",
  "vendor",
]);

const nonPortableDirectoryNames = new Set([
  ".context-index",
  ".git",
  ".next",
  ".pnpm-store",
  ".project-state",
  "backup",
  "backups",
  "blob-report",
  "coverage",
  "node_modules",
  "playwright-report",
  "target",
  "test-results",
]);

export const repositoryCodexHomeRuntimeDirectoryNames = Object.freeze([
  ".tmp",
  "cache",
  "log",
  "logs",
  "memories",
  "plugins",
  "sessions",
  "shell_snapshots",
  "skills",
  "thread-writer-locks",
  "tmp",
]);
export const repositoryCodexHomeRuntimeFileNames = Object.freeze([
  ".sandbox_migration",
  "auth.json",
  "config.toml",
  "history.jsonl",
  "installation_id",
  "models_cache.json",
  "version.json",
]);
export const repositoryCodexHomeRuntimeDatabasePrefixes = Object.freeze([
  "goals",
  "logs",
  "memories",
  "queue",
  "state",
  "thread_history",
]);
export const repositoryCodexHomeGitignorePatterns = Object.freeze([
  ...repositoryCodexHomeRuntimeDirectoryNames.map((name) => `/${name}`),
  ...repositoryCodexHomeRuntimeFileNames.map((name) => `/${name}`),
  ...repositoryCodexHomeRuntimeDatabasePrefixes.map((name) => `/${name}_*.sqlite*`),
]);
export const portableCodexGitignorePatterns = Object.freeze([
  ".codex/*",
  "!.codex/",
  "!.codex/config.toml",
  "!.codex/hooks.json",
  "!.codex/README.md",
  "!.codex/agents/",
  ".codex/agents/*",
  "!.codex/agents/*.toml",
]);
export const sourceInventoryPreDescentExcludePatterns = Object.freeze([
  ...repositoryCodexHomeGitignorePatterns,
  ...portableCodexGitignorePatterns,
  "/.context-index",
  "/.project-state",
]);
export const gitlessPreDescentExcludePatterns = sourceInventoryPreDescentExcludePatterns;
export const repositoryCodexHomeRuntimeProbePaths = Object.freeze([
  ...repositoryCodexHomeRuntimeDirectoryNames.map((name) => `${name}/runtime-state`),
  ...repositoryCodexHomeRuntimeFileNames,
  ...repositoryCodexHomeRuntimeDatabasePrefixes.flatMap((name) => [
    `${name}_1.sqlite`,
    `${name}_1.sqlite-shm`,
    `${name}_1.sqlite-wal`,
  ]),
]);
export const repositoryCodexHomeProtectedGitignoreProbePaths = Object.freeze([
  ...repositoryCodexHomeRuntimeDirectoryNames.flatMap((name) => [name, `${name}/runtime-state`]),
  ...repositoryCodexHomeRuntimeProbePaths.slice(repositoryCodexHomeRuntimeDirectoryNames.length),
  ".codex/auth.json",
  ".codex/cache/runtime-state",
  ".codex/sessions/runtime-state",
  ".codex/skills/runtime-state",
  ".codex/agents/extra.json",
  ".codex/agents/nested/extra.toml",
]);
export const portableCodexGitignoreProbePaths = Object.freeze([
  ".codex/README.md",
  ".codex/config.toml",
  ".codex/hooks.json",
  ".codex/agents/default.toml",
]);

const rootCodexRuntimeDirectoryNames = new Set(repositoryCodexHomeRuntimeDirectoryNames);
const rootCodexRuntimeFiles = new Set(repositoryCodexHomeRuntimeFileNames);
const privateCodexRuntimeCodes = new Set(["project-codex-runtime", "repository-codex-runtime"]);
const rootCodexRuntimeDatabasePattern = new RegExp(
  `^(?:${repositoryCodexHomeRuntimeDatabasePrefixes.join("|")})_[^/]+\\.sqlite[^/]*$`,
);

function toPosix(value) {
  return value.split(path.sep).join("/");
}

export function normalizeSourceRelativePath(value) {
  const normalized = path.posix.normalize(toPosix(value).replace(/^\.\//u, ""));
  if (
    normalized === "." ||
    path.posix.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("\0")
  ) {
    return null;
  }
  return normalized;
}

function isRootCodexRuntimePath(relativePath) {
  if (!relativePath) return false;
  const [topLevel] = relativePath.split("/");
  return (
    rootCodexRuntimeDirectoryNames.has(topLevel) ||
    (relativePath === topLevel &&
      (rootCodexRuntimeFiles.has(topLevel) || rootCodexRuntimeDatabasePattern.test(topLevel)))
  );
}

export function isRepositoryCodexHomePath(value) {
  return isRootCodexRuntimePath(normalizeSourceRelativePath(value));
}

export function repositoryCodexHomeGitignoreFindings(content) {
  const lines = new Set(
    String(content)
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
  return [...repositoryCodexHomeGitignorePatterns, ...portableCodexGitignorePatterns]
    .filter((pattern) => !lines.has(pattern))
    .map((pattern) => `missing exact root Codex isolation pattern ${pattern}`);
}

function isPortableCodexPath(relativePath) {
  return (
    [".codex/README.md", ".codex/config.toml", ".codex/hooks.json", ".codex/agents"].includes(
      relativePath,
    ) || /^\.codex\/agents\/[a-z][a-z0-9_-]*\.toml$/u.test(relativePath)
  );
}

export function activeSourcePathClassification(value) {
  const relativePath = normalizeSourceRelativePath(value);
  if (!relativePath) return { code: "unsafe-path", reason: "unsafe repository-relative path" };
  if (isRepositoryCodexHomePath(relativePath)) {
    return {
      code: "repository-codex-runtime",
      reason: "repository-root Codex runtime or cache state",
    };
  }
  const segments = relativePath.split("/");
  const basename = segments.at(-1) ?? "";
  if (segments[0] === ".codex") {
    return isPortableCodexPath(relativePath)
      ? null
      : {
          code: "project-codex-runtime",
          reason: "project-local Codex runtime or cache state",
        };
  }
  if (segments.some((segment) => excludedActiveDirectoryNames.has(segment))) {
    return {
      code: "generated-runtime-directory",
      reason: "generated, dependency, backup, or runtime directory",
    };
  }
  if (basename.endsWith(".bak") || basename.includes(".bak.")) {
    return { code: "backup-file", reason: "backup file" };
  }
  if (basename === ".env" || (basename.startsWith(".env.") && basename !== ".env.example")) {
    return { code: "environment-secret", reason: "environment secret file" };
  }
  if (basename.endsWith(".local")) {
    return { code: "machine-local-file", reason: "machine-local file" };
  }
  return null;
}

export function activeSourcePathExclusionReason(value) {
  return activeSourcePathClassification(value)?.reason ?? null;
}

export function isPrivateCodexRuntimePath(value) {
  return privateCodexRuntimeCodes.has(activeSourcePathClassification(value)?.code);
}

export function isExcludedActivePath(value) {
  return activeSourcePathClassification(value) !== null;
}

export function nonPortableTransferPathReason(value) {
  const relativePath = normalizeSourceRelativePath(value);
  if (!relativePath) return "unsafe repository-relative path";
  if (isRepositoryCodexHomePath(relativePath)) {
    return "repository-root Codex runtime or cache state";
  }
  const segments = relativePath.split("/");
  const basename = segments.at(-1) ?? "";
  if (segments.includes(".codex") && !isPortableCodexPath(relativePath)) {
    return "project-local Codex runtime or cache state";
  }
  if (segments.some((segment) => nonPortableDirectoryNames.has(segment))) {
    return "generated, dependency, backup, or runtime state";
  }
  if (relativePath.startsWith("dist/exports/")) return "generated project export";
  if (relativePath.startsWith("playwright/.auth/")) return "browser authentication state";
  if (
    basename.endsWith(".bak") ||
    basename.includes(".bak.") ||
    basename.endsWith(".local") ||
    basename.endsWith(".tsbuildinfo")
  ) {
    return "machine-local or generated file";
  }
  return null;
}
