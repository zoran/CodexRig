/** Owns framework contract behavior for the versioned framework contract boundary. */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readOptionalOwnedFile } from "../filesystem/owned-file-operations.mjs";
import { validateCompatibilityMatrix } from "./compatibility-contract.mjs";
import { parseSemver } from "./semver-contract.mjs";

export { compareSemver, parseSemver, versionSatisfiesSimpleRange } from "./semver-contract.mjs";
export { validateCompatibilityMatrix };

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const frameworkRoot = path.resolve(scriptDirectory, "..", "..");
export const frameworkContractPath = ".codexrig/framework.json";
export const compatibilityMatrixPath = ".codexrig/compatibility.json";
export const installationReceiptPath = ".codexrig/installation.json";

export const supportedContractSchema = 2;
export const supportedReceiptSchema = 2;
const safeRelativePathPattern = /^(?!\.\.?$)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\0/][^\\\0]*$/u;

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredObject(value, label) {
  if (!plainObject(value)) throw new Error(`${label} must be a JSON object.`);
  return value;
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requiredInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

export function normalizeFrameworkPath(value, label = "framework path") {
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
    throw new Error("Framework root must be a real directory.");
  }
  return realpathSync.native(resolved);
}

export function resolveFrameworkPath(root, relativePath) {
  const ownedRoot = realRoot(root);
  const normalized = normalizeFrameworkPath(relativePath);
  const absolutePath = path.join(ownedRoot, ...normalized.split("/"));
  const relative = path.relative(ownedRoot, absolutePath);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("Framework path escapes the repository root.");
  }
  return absolutePath;
}

export function readRegularFrameworkFile(root, relativePath, { optional = false } = {}) {
  const absolutePath = resolveFrameworkPath(root, relativePath);
  const ownedRoot = realRoot(root);
  const snapshot = readOptionalOwnedFile(ownedRoot, absolutePath, `framework file ${relativePath}`);
  if (!snapshot.exists) {
    if (optional) return null;
    throw new Error(`Missing required framework file: ${relativePath}.`);
  }
  return snapshot.buffer.toString("utf8");
}

function parseJsonFile(root, relativePath, label, options) {
  const content = readRegularFrameworkFile(root, relativePath, options);
  if (content === null) return null;
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
}

function stringArray(value, label, { paths = false } = {}) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }
  const normalized = value.map((entry, index) =>
    paths
      ? normalizeFrameworkPath(entry, `${label}[${index}]`)
      : requiredString(entry, `${label}[${index}]`),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return normalized;
}

function excludedPathReasons(value) {
  const reasons = requiredObject(value, "upgrade.excludedPathReasons");
  const entries = Object.entries(reasons);
  if (entries.length === 0) {
    throw new Error("upgrade.excludedPathReasons must contain at least one source-only path.");
  }
  const normalized = {};
  for (const [relativePath, reason] of entries) {
    const safePath = normalizeFrameworkPath(relativePath, "upgrade.excludedPathReasons key");
    if (Object.hasOwn(normalized, safePath)) {
      throw new Error("upgrade.excludedPathReasons contains duplicate normalized paths.");
    }
    normalized[safePath] = requiredString(reason, `upgrade.excludedPathReasons.${safePath}`);
  }
  return sortedObject(normalized);
}

function normalizedProviderApiBase(value, label, provider, remoteHost) {
  const source = requiredString(value, label);
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw new Error(`${label} must be an absolute HTTPS URL.`);
  }
  const apiHost = parsed.hostname.toLowerCase();
  const officialGithubApi =
    provider === "github" && remoteHost === "github.com" && apiHost === "api.github.com";
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (apiHost !== remoteHost && !officialGithubApi)
  ) {
    throw new Error(`${label} must be a credential-free HTTPS URL owned by ${remoteHost}.`);
  }
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    throw new Error(`${label} contains invalid path encoding.`);
  }
  if (
    decodedPath.includes("//") ||
    decodedPath.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`${label} contains an unsafe API path.`);
  }
  const pathName = parsed.pathname.replace(/\/+$/u, "");
  return `${parsed.origin}${pathName === "/" ? "" : pathName}`;
}

export function validateFrameworkContract(value) {
  const contract = requiredObject(value, "Framework contract");
  if (contract.schemaVersion !== supportedContractSchema) {
    throw new Error(
      `Unsupported framework contract schema ${String(contract.schemaVersion)}; expected ${supportedContractSchema}.`,
    );
  }
  if (contract.frameworkId !== "codexrig") {
    throw new Error("Framework contract must identify codexrig.");
  }
  parseSemver(contract.frameworkVersion, "frameworkVersion");
  contract.compatibilityFile = normalizeFrameworkPath(
    contract.compatibilityFile,
    "compatibilityFile",
  );

  const startup = requiredObject(contract.startup, "startup");
  const maxAge = requiredInteger(
    startup.attestationMaxAgeSeconds,
    "startup.attestationMaxAgeSeconds",
  );
  if (maxAge < 60 || maxAge > 86_400) {
    throw new Error("startup.attestationMaxAgeSeconds must be between 60 and 86400.");
  }

  const platform = requiredObject(contract.platform, "platform");
  if (!["auto", "github", "gitlab"].includes(platform.provider)) {
    throw new Error("platform.provider must be auto, github, or gitlab.");
  }
  const integrationBranch = requiredString(
    platform.integrationBranch,
    "platform.integrationBranch",
  );
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/u.test(integrationBranch) ||
    integrationBranch.includes("..") ||
    integrationBranch.includes("//") ||
    integrationBranch.includes("@{") ||
    integrationBranch.endsWith(".lock")
  ) {
    throw new Error("platform.integrationBranch must be a safe Git branch name.");
  }
  const hosts = requiredObject(platform.hosts, "platform.hosts");
  for (const provider of ["github", "gitlab"]) {
    const providerHosts = stringArray(hosts[provider], `platform.hosts.${provider}`);
    for (const host of providerHosts) {
      if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(host) || host.includes("..")) {
        throw new Error(`platform.hosts.${provider} contains an invalid host.`);
      }
    }
  }
  const overlappingHosts = hosts.github.filter((host) => hosts.gitlab.includes(host));
  if (overlappingHosts.length > 0) {
    throw new Error("GitHub and GitLab host ownership must not overlap.");
  }
  const apiBaseUrls = requiredObject(platform.apiBaseUrls, "platform.apiBaseUrls");
  for (const provider of ["github", "gitlab"]) {
    const providerUrls = requiredObject(apiBaseUrls[provider], `platform.apiBaseUrls.${provider}`);
    const expectedHosts = new Set(hosts[provider]);
    if (
      Object.keys(providerUrls).length !== expectedHosts.size ||
      Object.keys(providerUrls).some((host) => !expectedHosts.has(host))
    ) {
      throw new Error(`platform.apiBaseUrls.${provider} must map every owned host exactly once.`);
    }
    for (const host of hosts[provider]) {
      providerUrls[host] = normalizedProviderApiBase(
        providerUrls[host],
        `platform.apiBaseUrls.${provider}.${host}`,
        provider,
        host,
      );
    }
  }
  const ci = requiredObject(platform.ci, "platform.ci");
  requiredString(ci.requiredCheck, "platform.ci.requiredCheck");
  const protection = requiredObject(platform.protection, "platform.protection");
  const approvals = requiredInteger(
    protection.requiredApprovals,
    "platform.protection.requiredApprovals",
  );
  if (approvals > 10) throw new Error("platform.protection.requiredApprovals must not exceed 10.");
  if (typeof protection.requireCodeOwnerReview !== "boolean") {
    throw new Error("platform.protection.requireCodeOwnerReview must be boolean.");
  }
  for (const field of [
    "preventAuthorApproval",
    "preventCommitterApproval",
    "preventApprovalRuleOverrides",
    "resetApprovalsOnPush",
  ]) {
    if (typeof protection[field] !== "boolean") {
      throw new Error(`platform.protection.${field} must be boolean.`);
    }
  }
  if (!["disabled", "prefer", "required"].includes(protection.mergeSerialization)) {
    throw new Error(
      "platform.protection.mergeSerialization must be disabled, prefer, or required.",
    );
  }

  const upgrade = requiredObject(contract.upgrade, "upgrade");
  upgrade.receiptFile = normalizeFrameworkPath(upgrade.receiptFile, "upgrade.receiptFile");
  upgrade.projectOwnedDocuments = stringArray(
    upgrade.projectOwnedDocuments,
    "upgrade.projectOwnedDocuments",
    { paths: true },
  );
  const frameworkControlledUpgradeInputs = new Set([
    frameworkContractPath,
    upgrade.receiptFile,
    "package.json",
    "pnpm-lock.yaml",
  ]);
  const conflictingUpgradeInputs = upgrade.projectOwnedDocuments.filter((relativePath) =>
    frameworkControlledUpgradeInputs.has(relativePath),
  );
  if (conflictingUpgradeInputs.length > 0) {
    throw new Error(
      `upgrade.projectOwnedDocuments cannot classify framework-controlled upgrade inputs as project-owned documents: ${conflictingUpgradeInputs.join(
        ", ",
      )}.`,
    );
  }
  upgrade.managedRoots = stringArray(upgrade.managedRoots, "upgrade.managedRoots", {
    paths: true,
  });
  upgrade.excludedPathReasons = excludedPathReasons(upgrade.excludedPathReasons);
  stringArray(upgrade.managedPackageScripts, "upgrade.managedPackageScripts");
  stringArray(upgrade.managedDevDependencies, "upgrade.managedDevDependencies");
  return contract;
}

export function readFrameworkContract(root = frameworkRoot) {
  return validateFrameworkContract(
    parseJsonFile(root, frameworkContractPath, "Framework contract"),
  );
}

export function readCompatibilityMatrix(
  root = frameworkRoot,
  contract = readFrameworkContract(root),
) {
  return validateCompatibilityMatrix(
    parseJsonFile(root, contract.compatibilityFile, "Compatibility matrix"),
  );
}

function excludedPath(relativePath, exclusions) {
  return exclusions.some(
    (candidate) => relativePath === candidate || relativePath.startsWith(`${candidate}/`),
  );
}

function listFilesBelow(root, relativePath, files) {
  const absolutePath = resolveFrameworkPath(root, relativePath);
  if (!existsSync(absolutePath)) return;
  const stats = lstatSync(absolutePath);
  if (stats.isSymbolicLink())
    throw new Error(`Managed framework path is a symlink: ${relativePath}.`);
  if (stats.isFile()) {
    if (stats.nlink !== 1)
      throw new Error(`Managed framework file is hard-linked: ${relativePath}.`);
    files.add(relativePath);
    return;
  }
  if (!stats.isDirectory())
    throw new Error(`Managed framework path is unsupported: ${relativePath}.`);
  for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw new Error(`Managed framework path contains a symlink: ${relativePath}/${entry.name}.`);
    }
    listFilesBelow(root, `${relativePath}/${entry.name}`, files);
  }
}

export function listManagedFrameworkFiles(root, contract = readFrameworkContract(root)) {
  const files = new Set();
  for (const managedRoot of contract.upgrade.managedRoots) {
    listFilesBelow(root, managedRoot, files);
  }
  return [...files]
    .filter(
      (relativePath) =>
        !excludedPath(relativePath, Object.keys(contract.upgrade.excludedPathReasons)),
    )
    .sort();
}

export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function sortedObject(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function managedPackageSnapshot(root, contract = readFrameworkContract(root)) {
  const packageJson = parseJsonFile(root, "package.json", "package.json");
  const scripts = requiredObject(packageJson.scripts, "package.json scripts");
  const devDependencies = requiredObject(
    packageJson.devDependencies,
    "package.json devDependencies",
  );
  const snapshot = {
    license: requiredString(packageJson.license, "package.json license"),
    packageManager: requiredString(packageJson.packageManager, "package.json packageManager"),
    scripts: {},
    devDependencies: {},
  };
  for (const name of contract.upgrade.managedPackageScripts) {
    snapshot.scripts[name] = requiredString(scripts[name], `package.json scripts.${name}`);
  }
  for (const name of contract.upgrade.managedDevDependencies) {
    snapshot.devDependencies[name] = requiredString(
      devDependencies[name],
      `package.json devDependencies.${name}`,
    );
  }
  snapshot.scripts = sortedObject(snapshot.scripts);
  snapshot.devDependencies = sortedObject(snapshot.devDependencies);
  return snapshot;
}

export function desiredManagedFileContentFromRaw(relativePath, rawContent) {
  let content = String(rawContent);
  if (relativePath === ".codex/config.toml") {
    const occurrences = content.match(/^memories = false$/gmu)?.length ?? 0;
    if (occurrences !== 1) {
      throw new Error(
        "Source Codex config must contain exactly one disabled framework memory flag.",
      );
    }
    content = content.replace(/^memories = false$/mu, "memories = true");
  }
  return content;
}

export function desiredManagedFileContent({ sourceRoot, relativePath }) {
  return desiredManagedFileContentFromRaw(
    relativePath,
    readRegularFrameworkFile(sourceRoot, relativePath),
  );
}

function validateReceiptFiles(files) {
  const value = requiredObject(files, "installation managedFiles");
  const normalized = {};
  for (const [relativePath, entryValue] of Object.entries(value)) {
    const safePath = normalizeFrameworkPath(relativePath, "installation managed file");
    const entry = requiredObject(entryValue, `installation managedFiles.${safePath}`);
    if (!/^[0-9a-f]{64}$/u.test(entry.sha256)) {
      throw new Error(`installation managedFiles.${safePath}.sha256 is invalid.`);
    }
    if (!Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) {
      throw new Error(`installation managedFiles.${safePath}.mode is invalid.`);
    }
    normalized[safePath] = { mode: entry.mode, sha256: entry.sha256 };
  }
  return sortedObject(normalized);
}

function validateReceiptPackage(value, label) {
  const managedPackage = requiredObject(value, label);
  if (managedPackage.license !== undefined) {
    requiredString(managedPackage.license, `${label}.license`);
  }
  requiredString(managedPackage.packageManager, `${label}.packageManager`);
  for (const section of ["scripts", "devDependencies"]) {
    const entries = requiredObject(managedPackage[section], `${label}.${section}`);
    for (const [name, entry] of Object.entries(entries)) {
      if (!name || /[\u0000-\u001f\u007f]/u.test(name)) {
        throw new Error(`${label}.${section} contains an invalid key.`);
      }
      requiredString(entry, `${label}.${section}.${name}`);
    }
  }
  return managedPackage;
}

function validatePendingReconciliation(value) {
  if (value === null) return null;
  const pending = requiredObject(value, "installation pendingReconciliation");
  if (!/^[0-9a-f]{64}$/u.test(pending.planDigest)) {
    throw new Error("installation pendingReconciliation.planDigest is invalid.");
  }
  parseSemver(pending.fromVersion, "installation pendingReconciliation.fromVersion");
  parseSemver(pending.toVersion, "installation pendingReconciliation.toVersion");
  if (!Array.isArray(pending.policies) || pending.policies.length === 0) {
    throw new Error("installation pendingReconciliation.policies must be non-empty.");
  }
  const ids = new Set();
  const policies = pending.policies.map((entryValue, index) => {
    const entry = requiredObject(
      entryValue,
      `installation pendingReconciliation.policies[${index}]`,
    );
    const id = requiredString(entry.id, `installation pendingReconciliation.policies[${index}].id`);
    if (!/^[a-z][a-z0-9-]*$/u.test(id) || ids.has(id)) {
      throw new Error("installation pendingReconciliation policy ids must be unique slugs.");
    }
    if (!["added", "changed", "retired"].includes(entry.change)) {
      throw new Error(`installation pendingReconciliation policy ${id} has an invalid change.`);
    }
    for (const [field, version] of [
      ["fromVersion", entry.fromVersion],
      ["toVersion", entry.toVersion],
    ]) {
      if (version !== null && (!Number.isSafeInteger(version) || version < 1)) {
        throw new Error(`installation pendingReconciliation policy ${id}.${field} is invalid.`);
      }
    }
    const documents = stringArray(
      entry.documents,
      `installation pendingReconciliation policy ${id}.documents`,
      { paths: true },
    );
    const statement = requiredString(
      entry.statement,
      `installation pendingReconciliation policy ${id}.statement`,
    );
    ids.add(id);
    return {
      change: entry.change,
      documents,
      fromVersion: entry.fromVersion,
      id,
      statement,
      toVersion: entry.toVersion,
    };
  });
  return {
    fromVersion: pending.fromVersion,
    planDigest: pending.planDigest,
    policies,
    toVersion: pending.toVersion,
  };
}

export function validateInstallationReceipt(value) {
  const receipt = requiredObject(value, "Framework installation receipt");
  if (receipt.schemaVersion !== supportedReceiptSchema) {
    throw new Error(`Unsupported installation receipt schema ${String(receipt.schemaVersion)}.`);
  }
  if (receipt.frameworkId !== "codexrig") {
    throw new Error("Installation receipt belongs to another framework.");
  }
  parseSemver(receipt.frameworkVersion, "installation frameworkVersion");
  receipt.managedFiles = validateReceiptFiles(receipt.managedFiles);
  receipt.installedFiles = validateReceiptFiles(receipt.installedFiles);
  receipt.managedPackage = validateReceiptPackage(
    receipt.managedPackage,
    "installation managedPackage",
  );
  receipt.installedPackage = validateReceiptPackage(
    receipt.installedPackage,
    "installation installedPackage",
  );
  receipt.pendingReconciliation = validatePendingReconciliation(receipt.pendingReconciliation);
  return receipt;
}

export function readInstallationReceipt(
  root = frameworkRoot,
  contract = readFrameworkContract(root),
  { optional = false } = {},
) {
  const parsed = parseJsonFile(
    root,
    contract.upgrade.receiptFile,
    "Framework installation receipt",
    { optional },
  );
  return parsed === null ? null : validateInstallationReceipt(parsed);
}

export function buildInstallationReceipt({
  root,
  contract = readFrameworkContract(root),
  managedPaths = listManagedFrameworkFiles(root, contract),
}) {
  const managedFiles = {};
  for (const relativePath of [...managedPaths].sort()) {
    const absolutePath = resolveFrameworkPath(root, relativePath);
    const mode = lstatSync(absolutePath).mode & 0o777;
    managedFiles[relativePath] = {
      mode,
      sha256: sha256(readRegularFrameworkFile(root, relativePath)),
    };
  }
  const managedPackage = managedPackageSnapshot(root, contract);
  return {
    schemaVersion: supportedReceiptSchema,
    frameworkId: contract.frameworkId,
    frameworkVersion: contract.frameworkVersion,
    managedFiles: sortedObject(managedFiles),
    installedFiles: structuredClone(sortedObject(managedFiles)),
    managedPackage,
    installedPackage: structuredClone(managedPackage),
    pendingReconciliation: null,
  };
}

export function serializeCanonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function isReusableFrameworkSource(root = frameworkRoot) {
  return (
    existsSync(
      resolveFrameworkPath(root, ".agents/skills/create-project-from-framework/SKILL.md"),
    ) && !existsSync(resolveFrameworkPath(root, installationReceiptPath))
  );
}
