import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const frameworkRoot = path.resolve(scriptDirectory, "..", "..");
export const frameworkContractPath = ".codexrig/framework.json";
export const compatibilityMatrixPath = ".codexrig/compatibility.json";
export const installationReceiptPath = ".codexrig/installation.json";

const supportedContractSchema = 1;
const supportedCompatibilitySchema = 1;
const supportedReceiptSchema = 1;
const safeRelativePathPattern = /^(?!\.\.?$)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\0/][^\\\0]*$/u;
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

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
  if (!existsSync(absolutePath)) {
    if (optional) return null;
    throw new Error(`Missing required framework file: ${relativePath}.`);
  }
  const stats = lstatSync(absolutePath);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) {
    throw new Error(`Framework file must be a single-link regular file: ${relativePath}.`);
  }
  const parent = realpathSync.native(path.dirname(absolutePath));
  const ownedRoot = realRoot(root);
  const relativeParent = path.relative(ownedRoot, parent);
  if (
    relativeParent === ".." ||
    relativeParent.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeParent)
  ) {
    throw new Error(`Framework file resolves outside the repository: ${relativePath}.`);
  }
  return readFileSync(absolutePath, "utf8");
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

export function parseSemver(value, label = "version") {
  const match = requiredString(value, label).match(semverPattern);
  if (!match) throw new Error(`${label} must use semantic versioning.`);
  const components = match.slice(1, 4).map(Number);
  if (components.some((component) => !Number.isSafeInteger(component))) {
    throw new Error(`${label} contains an unsupported numeric component.`);
  }
  return {
    build: match[5] ?? "",
    major: components[0],
    minor: components[1],
    patch: components[2],
    prerelease: match[4] ?? "",
    raw: value,
  };
}

export function compareSemver(left, right) {
  const a = typeof left === "string" ? parseSemver(left) : left;
  const b = typeof right === "string" ? parseSemver(right) : right;
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  const leftIdentifiers = a.prerelease.split(".");
  const rightIdentifiers = b.prerelease.split(".");
  const count = Math.max(leftIdentifiers.length, rightIdentifiers.length);
  for (let index = 0; index < count; index += 1) {
    const leftIdentifier = leftIdentifiers[index];
    const rightIdentifier = rightIdentifiers[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/u.test(leftIdentifier);
    const rightNumeric = /^\d+$/u.test(rightIdentifier);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    if (leftNumeric && leftIdentifier.length !== rightIdentifier.length) {
      return leftIdentifier.length < rightIdentifier.length ? -1 : 1;
    }
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

export function versionSatisfiesSimpleRange(version, range) {
  const parsed = parseSemver(version);
  const clauses = requiredString(range, "compatibility range").split(/\s+/u).filter(Boolean);
  if (clauses.length === 0) return false;
  return clauses.every((clause) => {
    const match = clause.match(/^(>=|>|<=|<|=)(.+)$/u);
    if (!match) throw new Error(`Unsupported compatibility range clause: ${clause}.`);
    const comparison = compareSemver(parsed, parseSemver(match[2], "range version"));
    if (match[1] === ">=") return comparison >= 0;
    if (match[1] === ">") return comparison > 0;
    if (match[1] === "<=") return comparison <= 0;
    if (match[1] === "<") return comparison < 0;
    return comparison === 0;
  });
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
    contract.compatibilityFile,
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
  upgrade.excludedPaths = stringArray(upgrade.excludedPaths, "upgrade.excludedPaths", {
    paths: true,
  });
  stringArray(upgrade.managedPackageScripts, "upgrade.managedPackageScripts");
  stringArray(upgrade.managedDevDependencies, "upgrade.managedDevDependencies");
  return contract;
}

export function readFrameworkContract(root = frameworkRoot) {
  return validateFrameworkContract(
    parseJsonFile(root, frameworkContractPath, "Framework contract"),
  );
}

export function validateCompatibilityMatrix(value) {
  const matrix = requiredObject(value, "Compatibility matrix");
  if (matrix.schemaVersion !== supportedCompatibilitySchema) {
    throw new Error(
      `Unsupported compatibility schema ${String(matrix.schemaVersion)}; expected ${supportedCompatibilitySchema}.`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(matrix.reviewedOn)) {
    throw new Error("Compatibility matrix reviewedOn must be an ISO date.");
  }
  const stable = requiredObject(matrix.stable, "compatibility.stable");
  for (const tool of ["node", "pnpm"]) {
    const entry = requiredObject(stable[tool], `compatibility.stable.${tool}`);
    parseSemver(entry.version, `compatibility.stable.${tool}.version`);
    if (!versionSatisfiesSimpleRange(entry.version, entry.range)) {
      throw new Error(`compatibility.stable.${tool}.version must satisfy its range.`);
    }
    requiredString(entry.channel, `compatibility.stable.${tool}.channel`);
  }
  const codex = requiredObject(stable.codex, "compatibility.stable.codex");
  parseSemver(codex.minimumVersion, "compatibility.stable.codex.minimumVersion");
  requiredString(codex.channel, "compatibility.stable.codex.channel");
  if (!Array.isArray(matrix.canaries) || matrix.canaries.length === 0) {
    throw new Error("Compatibility matrix must declare at least one canary.");
  }
  const ids = new Set();
  for (const [index, entryValue] of matrix.canaries.entries()) {
    const entry = requiredObject(entryValue, `compatibility.canaries[${index}]`);
    const id = requiredString(entry.id, `compatibility.canaries[${index}].id`);
    if (!/^[a-z][a-z0-9-]*$/u.test(id) || ids.has(id)) {
      throw new Error("Compatibility canary ids must be unique lowercase slugs.");
    }
    ids.add(id);
    requiredString(entry.description, `compatibility.canaries[${index}].description`);
    requiredString(entry.node, `compatibility.canaries[${index}].node`);
    requiredString(entry.pnpm, `compatibility.canaries[${index}].pnpm`);
    requiredString(entry.codex, `compatibility.canaries[${index}].codex`);
    if (typeof entry.required !== "boolean") {
      throw new Error(`compatibility.canaries[${index}].required must be boolean.`);
    }
  }
  return matrix;
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
    .filter((relativePath) => !excludedPath(relativePath, contract.upgrade.excludedPaths))
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

export function desiredManagedFileContent({ sourceRoot, relativePath }) {
  let content = readRegularFrameworkFile(sourceRoot, relativePath);
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
  };
}

export function serializeCanonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function writeInstallationReceipt({
  root,
  contract = readFrameworkContract(root),
  managedPaths,
}) {
  const receipt = buildInstallationReceipt({ root, contract, managedPaths });
  const receiptPath = resolveFrameworkPath(root, contract.upgrade.receiptFile);
  writeFileSync(receiptPath, serializeCanonicalJson(receipt), { encoding: "utf8", mode: 0o644 });
  return receipt;
}

export function isReusableFrameworkSource(root = frameworkRoot) {
  return existsSync(
    resolveFrameworkPath(root, ".agents/skills/create-project-from-framework/SKILL.md"),
  );
}
