/** Owns immutable delivery artifact binding for staging and production verification. */
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import path from "node:path";
import {
  deliveryConfigurationPath,
  effectiveDeliveryTargets,
  parseDeliveryConfiguration,
} from "../contracts/delivery-configuration.mjs";
import {
  isReusableFrameworkSource,
  readRegularFrameworkFile,
} from "../contracts/framework-contract.mjs";
import { sensitivePathReason } from "../repository/sensitive-paths.mjs";
import {
  captureStableRepositoryFileIdentity,
  readStableRepositoryFile,
} from "../repository/stable-file-snapshot.mjs";
import { captureVerificationGitBasis } from "./verification-git-basis.mjs";
import { canonicalJson, digest } from "./verification-record-helpers.mjs";

const objectIdPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const maximumManifestBytes = 1024 * 1024;
const maximumBoundFiles = 10_000;
const maximumBoundFileBytes = 64 * 1024 * 1024;
const maximumBoundBytes = 512 * 1024 * 1024;

function exactKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\n") === [...expected].sort().join("\n")
  );
}

function safeRelativePath(value, label) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 4_096 ||
    /[\0\r\n\\]/u.test(value) ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must be one canonical repository-relative path.`);
  }
  return value;
}

function stableFile(root, relativePath, label) {
  const captured = captureStableRepositoryFileIdentity({
    repositoryRoot: root,
    relativePath,
  });
  if (captured.bytes > maximumBoundFileBytes) {
    throw new Error(`${label} exceeds the delivery verification file-size limit.`);
  }
  const read = readStableRepositoryFile({
    repositoryRoot: root,
    relativePath,
    expectedIdentity: captured.identity,
  });
  const absolutePath = path.join(root, ...relativePath.split("/"));
  const stats = lstatSync(absolutePath);
  const after = captureStableRepositoryFileIdentity({ repositoryRoot: root, relativePath });
  if (!stats.isFile() || after.identity !== read.identity) {
    throw new Error(`${label} changed while its delivery mode was captured.`);
  }
  return { ...read, mode: stats.mode & 0o7777 };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function parseBoundEntries(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximumBoundFiles) {
    throw new Error(`${label} must be a bounded non-empty array.`);
  }
  const entries = value.map((entry, index) => {
    if (
      !exactKeys(entry, ["path", "sha256"]) ||
      typeof entry.sha256 !== "string" ||
      !sha256Pattern.test(entry.sha256)
    ) {
      throw new Error(`${label}[${index}] must bind one path to a lowercase SHA-256 digest.`);
    }
    return Object.freeze({
      path: safeRelativePath(entry.path, `${label}[${index}].path`),
      sha256: entry.sha256,
    });
  });
  const paths = entries.map((entry) => entry.path);
  if (
    new Set(paths).size !== paths.length ||
    JSON.stringify(paths) !== JSON.stringify([...paths].sort())
  ) {
    throw new Error(`${label} paths must be unique and canonically sorted.`);
  }
  return Object.freeze(entries);
}

function readArtifactManifest(root, artifactManifest) {
  const relativePath = safeRelativePath(artifactManifest, "--artifact-manifest");
  if (sensitivePathReason(relativePath)) {
    throw new Error("--artifact-manifest must not point at a credential-bearing path.");
  }
  const read = stableFile(root, relativePath, "Delivery artifact manifest");
  if (read.bytes > maximumManifestBytes) {
    throw new Error("Delivery artifact manifest exceeds its size limit.");
  }
  let value;
  try {
    value = JSON.parse(read.buffer.toString("utf8"));
  } catch {
    throw new Error("Delivery artifact manifest must contain valid JSON.");
  }
  if (
    !exactKeys(value, [
      "artifactFiles",
      "configurationFiles",
      "schemaVersion",
      "sourceCommit",
      "targetEnvironment",
    ]) ||
    value.schemaVersion !== 1 ||
    !["staging", "prod"].includes(value.targetEnvironment) ||
    typeof value.sourceCommit !== "string" ||
    !objectIdPattern.test(value.sourceCommit)
  ) {
    throw new Error("Delivery artifact manifest has an invalid schema or target identity.");
  }
  const artifactFiles = parseBoundEntries(value.artifactFiles, "artifactFiles");
  const configurationFiles = parseBoundEntries(value.configurationFiles, "configurationFiles");
  if (!configurationFiles.some((entry) => entry.path === deliveryConfigurationPath)) {
    throw new Error(`configurationFiles must bind ${deliveryConfigurationPath}.`);
  }
  if (configurationFiles.length < 2) {
    throw new Error(
      "configurationFiles must bind delivery inventory plus at least one target-specific configuration or adapter.",
    );
  }
  const allPaths = [...artifactFiles, ...configurationFiles].map((entry) => entry.path);
  if (new Set(allPaths).size !== allPaths.length || allPaths.includes(relativePath)) {
    throw new Error("Delivery artifact, configuration, and manifest paths must be disjoint.");
  }
  return Object.freeze({
    artifactFiles,
    configurationFiles,
    path: relativePath,
    sourceCommit: value.sourceCommit,
    targetEnvironment: value.targetEnvironment,
  });
}

function verifyBoundFiles(root, entries, label) {
  let totalBytes = 0;
  const verified = entries.map((entry) => {
    if (sensitivePathReason(entry.path)) {
      throw new Error(`${label} refuses credential-bearing path ${entry.path}.`);
    }
    const read = stableFile(root, entry.path, label);
    totalBytes += read.bytes;
    if (totalBytes > maximumBoundBytes) {
      throw new Error(`${label} exceeds the aggregate delivery verification size limit.`);
    }
    const actual = sha256(read.buffer);
    if (actual !== entry.sha256) {
      throw new Error(`${label} digest does not match current bytes for ${entry.path}.`);
    }
    return Object.freeze({
      bytes: read.bytes,
      mode: read.mode,
      path: entry.path,
      sha256: actual,
    });
  });
  return Object.freeze(verified);
}

function projectScript(root, targetEnvironment) {
  let packageJson;
  try {
    packageJson = JSON.parse(readRegularFrameworkFile(root, "package.json"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("package.json must contain valid JSON.");
    throw error;
  }
  const script = `verify:${targetEnvironment}`;
  if (
    !packageJson.scripts ||
    typeof packageJson.scripts !== "object" ||
    Array.isArray(packageJson.scripts) ||
    typeof packageJson.scripts[script] !== "string" ||
    !packageJson.scripts[script].trim()
  ) {
    throw new Error(`Target ${targetEnvironment} requires a project-owned ${script} script.`);
  }
  return script;
}

export function resolveDeliveryArtifactBinding({
  root,
  targetEnvironment = "dev",
  artifactManifest = "",
}) {
  const canonicalRoot = path.resolve(root);
  if (targetEnvironment === "dev") {
    if (artifactManifest) throw new Error("Dev verification does not accept --artifact-manifest.");
    return Object.freeze({
      artifactDigest: "",
      artifactManifest: "",
      configurationDigest: "",
      deliveryPlanDigest: "",
      sourceCommit: "",
      targetEnvironment: "dev",
      verificationCommand: null,
    });
  }
  if (!["staging", "prod"].includes(targetEnvironment)) {
    throw new Error(`Unsupported delivery target ${targetEnvironment}.`);
  }
  if (!artifactManifest) {
    throw new Error("Staging and production verification require --artifact-manifest.");
  }
  if (isReusableFrameworkSource(canonicalRoot)) {
    throw new Error("The neutral framework source has no staging or production delivery target.");
  }

  const configuration = parseDeliveryConfiguration(
    readRegularFrameworkFile(canonicalRoot, deliveryConfigurationPath),
  );
  if (!effectiveDeliveryTargets(configuration).includes(targetEnvironment)) {
    throw new Error(
      `Target ${targetEnvironment} is not integrated in ${deliveryConfigurationPath}.`,
    );
  }
  const manifest = readArtifactManifest(canonicalRoot, artifactManifest);
  if (manifest.targetEnvironment !== targetEnvironment) {
    throw new Error("Delivery artifact manifest target does not match --target-environment.");
  }
  const gitBasis = captureVerificationGitBasis({ repositoryRoot: canonicalRoot });
  if (!gitBasis.complete || gitBasis.dirtyPaths.length > 0) {
    throw new Error("Staging and production verification require a clean project-owned Git basis.");
  }
  if (manifest.sourceCommit !== gitBasis.head) {
    throw new Error("Delivery artifact manifest sourceCommit does not match current HEAD.");
  }

  const artifacts = verifyBoundFiles(canonicalRoot, manifest.artifactFiles, "Artifact file");
  const configurationFiles = verifyBoundFiles(
    canonicalRoot,
    manifest.configurationFiles,
    "Target configuration file",
  );
  const verificationScript = projectScript(canonicalRoot, targetEnvironment);
  const artifactDigest = `sha256:${digest(
    canonicalJson({ artifacts, sourceCommit: manifest.sourceCommit, targetEnvironment }),
  )}`;
  const configurationDigest = digest(
    canonicalJson({ configurationFiles, targetEnvironment, verificationScript }),
  );
  const commandArgs = Object.freeze([
    "run",
    verificationScript,
    "--",
    "--codexrig-target",
    targetEnvironment,
    "--codexrig-artifact-manifest",
    manifest.path,
    "--codexrig-artifact-digest",
    artifactDigest,
    "--codexrig-configuration-digest",
    configurationDigest,
  ]);
  const deliveryPlanDigest = digest(
    canonicalJson({
      artifactDigest,
      commandArgs,
      configurationDigest,
      sourceCommit: gitBasis.head,
    }),
  );
  return Object.freeze({
    artifactDigest,
    artifactManifest: manifest.path,
    configurationDigest,
    deliveryPlanDigest,
    sourceCommit: gitBasis.head,
    targetEnvironment,
    verificationCommand: Object.freeze({
      args: commandArgs,
      artifactOwners: Object.freeze([`delivery:${targetEnvironment}`]),
      executable: "pnpm",
      key: `delivery:${targetEnvironment}`,
      label: `${targetEnvironment} artifact and environment verification`,
      phase: "delivery",
      reason: `explicit ${targetEnvironment} evidence requires its project-owned verifier against the bound artifact and configuration`,
    }),
  });
}
