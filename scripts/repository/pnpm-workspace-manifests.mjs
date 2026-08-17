/** Owns non-executing pnpm workspace discovery and repository-controlled pnpm hook policy. */
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { matchesPnpmWorkspacePattern, pnpmWorkspacePatterns } from "./product-roots.mjs";
import { listActiveFiles } from "./source-inventory.mjs";

export const repositoryPnpmHookPaths = Object.freeze([
  ".pnpmfile.cjs",
  ".pnpmfile.mjs",
  "pnpmfile.cjs",
  "pnpmfile.mjs",
]);

const executableWorkspaceConfigurationKeys = new Set([
  "configDependencies",
  "globalPnpmfile",
  "pnpmfile",
]);
const portableDependencyEnvironmentKeys = new Set([
  "CI",
  "COMSPEC",
  "FORCE_COLOR",
  "HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "NODE_AUTH_TOKEN",
  "NODE_EXTRA_CA_CERTS",
  "NO_COLOR",
  "NO_PROXY",
  "NPM_AUTH_TOKEN",
  "NPM_TOKEN",
  "PATH",
  "PATHEXT",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "TZ",
  "USERPROFILE",
]);

export function pnpmHooksDisabledEnvironment(environment = {}) {
  const sanitized = {};
  for (const [key, value] of Object.entries(environment)) {
    const normalizedKey = key.toUpperCase();
    if (!portableDependencyEnvironmentKeys.has(normalizedKey) || typeof value !== "string")
      continue;
    if (value.includes("\0")) continue;
    const childKey = process.platform === "win32" ? normalizedKey : key;
    sanitized[childKey] = value;
  }
  return {
    ...sanitized,
    NPM_CONFIG_IGNORE_PNPMFILE: "true",
    PNPM_CONFIG_IGNORE_PNPMFILE: "true",
    npm_config_ignore_pnpmfile: "true",
    pnpm_config_ignore_pnpmfile: "true",
  };
}

function normalizeRelativePath(value) {
  return String(value).split(path.sep).join("/").replace(/^\.\//u, "");
}

function realRepositoryFile(repositoryRoot, relativePath, label) {
  const root = realpathSync.native(repositoryRoot);
  const target = path.join(root, ...relativePath.split("/"));
  let cursor = root;
  for (const segment of relativePath.split("/")) {
    cursor = path.join(cursor, segment);
    const stats = lstatSync(cursor);
    if (stats.isSymbolicLink()) throw new Error(`${label} must not cross a symbolic link.`);
  }
  const stats = lstatSync(target);
  if (!stats.isFile() || realpathSync.native(target) !== target) {
    throw new Error(`${label} must be a real repository file.`);
  }
  return target;
}

function yamlLineWithoutComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (quote && character === quote) {
      if (quote === "'" && line[index + 1] === "'") {
        index += 1;
        continue;
      }
      quote = null;
      continue;
    }
    if (!quote && (character === '"' || character === "'")) {
      quote = character;
      continue;
    }
    if (!quote && character === "#" && (index === 0 || /\s/u.test(line[index - 1]))) {
      return line.slice(0, index);
    }
  }
  return line;
}

function topLevelYamlKey(line) {
  const source = yamlLineWithoutComment(line);
  if (!source || /^\s/u.test(source)) return null;
  const match = /^(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([A-Za-z][A-Za-z0-9_-]*))\s*:/u.exec(source);
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

export function pnpmWorkspaceExecutionFindings(content) {
  const findings = [];
  for (const line of String(content ?? "").split(/\r?\n/u)) {
    const key = topLevelYamlKey(line);
    if (key && executableWorkspaceConfigurationKeys.has(key)) {
      const source = yamlLineWithoutComment(line);
      if (key === "pnpmfile" && /^pnpmfile\s*:\s*\[\s*\]\s*$/u.test(source)) {
        continue;
      }
      findings.push(
        `pnpm-workspace.yaml ${key} can load repository-controlled executable configuration`,
      );
    }
    const source = yamlLineWithoutComment(line);
    if (!/^\s/u.test(source) && /^<<\s*:/u.test(source)) {
      findings.push(
        "pnpm-workspace.yaml top-level YAML aliases are unsupported at the trusted pnpm boundary",
      );
    }
  }
  return [...new Set(findings)].sort();
}

export function trustedPnpmConfigurationFindings({ repositoryRoot, workspaceContent } = {}) {
  const root = realpathSync.native(repositoryRoot);
  const findings = [];
  for (const relativePath of repositoryPnpmHookPaths) {
    const target = path.join(root, relativePath);
    if (existsSync(target)) {
      findings.push(
        `${relativePath} is executable pnpm configuration and is forbidden on trusted framework paths`,
      );
    }
  }
  const workspacePath = path.join(root, "pnpm-workspace.yaml");
  if (!existsSync(workspacePath)) {
    findings.push("pnpm-workspace.yaml is missing");
  } else {
    try {
      const realPath = realRepositoryFile(root, "pnpm-workspace.yaml", "pnpm-workspace.yaml");
      findings.push(
        ...pnpmWorkspaceExecutionFindings(
          workspaceContent === undefined ? readFileSync(realPath, "utf8") : workspaceContent,
        ),
      );
    } catch (error) {
      findings.push(error.message);
    }
  }
  return [...new Set(findings)].sort();
}

export function assertTrustedPnpmConfiguration(options) {
  const findings = trustedPnpmConfigurationFindings(options);
  if (findings.length > 0) {
    throw new Error(
      ["Trusted pnpm configuration failed:", ...findings.map((item) => `- ${item}`)].join("\n"),
    );
  }
}

export function discoverPnpmWorkspaceManifestPaths({ repositoryRoot, relativePaths } = {}) {
  const root = realpathSync.native(repositoryRoot);
  assertTrustedPnpmConfiguration({ repositoryRoot: root });
  const workspacePath = realRepositoryFile(root, "pnpm-workspace.yaml", "pnpm-workspace.yaml");
  const patterns = pnpmWorkspacePatterns(readFileSync(workspacePath, "utf8"));
  const inventory = (relativePaths ?? listActiveFiles({ root }))
    .map(normalizeRelativePath)
    .filter(Boolean);
  const manifests = new Set(["package.json"]);
  for (const relativePath of inventory) {
    if (relativePath === "package.json" || !relativePath.endsWith("/package.json")) continue;
    const packageRoot = path.posix.dirname(relativePath);
    if (matchesPnpmWorkspacePattern(packageRoot, patterns)) manifests.add(relativePath);
  }
  return [...manifests].sort().map((relativePath) => {
    realRepositoryFile(root, relativePath, relativePath);
    return relativePath;
  });
}
