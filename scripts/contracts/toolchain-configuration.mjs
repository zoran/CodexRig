/** Owns stable toolchain configuration, tool versions and reviewed archive integrity. */
import { parseJsonFile, toolingRoot } from "../filesystem/repository-files.mjs";
import { Buffer } from "node:buffer";
import { compareSemver, parseSemver, versionSatisfiesSimpleRange } from "./semver-contract.mjs";

export const supportedToolchainSchema = 2;
export const codexDistributionPlatforms = Object.freeze([
  "linux-x64",
  "linux-arm64",
  "darwin-arm64",
  "win32-x64",
]);
export const miseBinaryPlatforms = Object.freeze([
  "linux-x64",
  "linux-arm64",
  "linux-x64-musl",
  "linux-arm64-musl",
  "macos-arm64",
  "windows-x64",
]);

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

function canonicalIntegrity(value, label) {
  const integrity = requiredString(value, label);
  const match = /^sha512-([A-Za-z0-9+/]{86}==)$/u.exec(integrity);
  if (
    !match ||
    Buffer.from(match[1], "base64").length !== 64 ||
    Buffer.from(match[1], "base64").toString("base64") !== match[1]
  ) {
    throw new Error(`${label} must be one canonical SHA-512 Subresource Integrity value.`);
  }
  return integrity;
}

function validateCodexCiContract(ci) {
  const codexVersion = parseSemver(ci.codexVersion, "compatibility.ci.codexVersion").raw;
  if (requiredString(ci.codexNpmPackage, "compatibility.ci.codexNpmPackage") !== "@openai/codex") {
    throw new Error(
      "compatibility.ci.codexNpmPackage must use the official @openai/codex package.",
    );
  }
  const integrities = requiredObject(
    ci.codexNpmPlatformIntegrities,
    "compatibility.ci.codexNpmPlatformIntegrities",
  );
  exactPlatforms(
    integrities,
    codexDistributionPlatforms,
    "compatibility.ci.codexNpmPlatformIntegrities",
  );
  for (const platform of codexDistributionPlatforms) {
    canonicalIntegrity(
      integrities[platform],
      `compatibility.ci.codexNpmPlatformIntegrities.${platform}`,
    );
  }
  return codexVersion;
}

function exactPlatforms(value, platforms, label) {
  if (Object.keys(value).sort().join("\n") !== [...platforms].sort().join("\n"))
    throw new Error(`${label} must own exactly the supported distribution platforms.`);
}

function validateMiseCiContract(ci) {
  const binaries = requiredObject(ci.miseBinarySha256, "compatibility.ci.miseBinarySha256");
  exactPlatforms(binaries, miseBinaryPlatforms, "compatibility.ci.miseBinarySha256");
  for (const digest of Object.values(binaries))
    if (!/^[a-f0-9]{64}$/u.test(digest))
      throw new Error("Mise binary integrity must be a lowercase SHA-256 digest.");
  parseSemver(ci.miseVersion, "compatibility.ci.miseVersion");
}

/** Validates exact stable and canary toolchain truth used by CI and project launchers. */
export function validateToolchainConfiguration(value) {
  const matrix = requiredObject(value, "Compatibility matrix");
  if (matrix.schemaVersion !== supportedToolchainSchema) {
    throw new Error(
      `Unsupported compatibility schema ${String(matrix.schemaVersion)}; expected ${supportedToolchainSchema}.`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(matrix.reviewedOn)) {
    throw new Error("Compatibility matrix reviewedOn must be an ISO date.");
  }
  const ci = requiredObject(matrix.ci, "compatibility.ci");
  if (
    Object.keys(ci).sort().join("\n") !==
    [
      "codexNpmPackage",
      "codexNpmPlatformIntegrities",
      "codexVersion",
      "miseBinarySha256",
      "miseVersion",
    ]
      .sort()
      .join("\n")
  )
    throw new Error("Toolchain distributions must use only the current contract.");
  const codexVersion = validateCodexCiContract(ci);
  validateMiseCiContract(ci);

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
  if (compareSemver(codexVersion, codex.minimumVersion) < 0) {
    throw new Error("compatibility.ci.codexVersion must satisfy the stable Codex minimum.");
  }

  return matrix;
}

export const toolchainConfigurationPath = ".codex/toolchain.json";
export function readToolchainConfiguration(root = toolingRoot) {
  return validateToolchainConfiguration(
    parseJsonFile(root, toolchainConfigurationPath, "Toolchain configuration"),
  );
}
