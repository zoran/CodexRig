/** Owns stable toolchain configuration, tool versions and reviewed archive integrity. */
import { parseJsonFile, toolingRoot } from "../filesystem/repository-files.mjs";
import { Buffer } from "node:buffer";
import { compareSemver, parseSemver, versionSatisfiesSimpleRange } from "./semver-contract.mjs";

export const supportedToolchainSchema = 1;

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
  const packages = requiredObject(
    ci.codexNpmPlatformPackages,
    "compatibility.ci.codexNpmPlatformPackages",
  );
  const integrities = requiredObject(
    ci.codexNpmPlatformIntegrities,
    "compatibility.ci.codexNpmPlatformIntegrities",
  );
  if (Object.keys(packages).sort().join("\n") !== "arm64\nx64") {
    throw new Error("compatibility.ci.codexNpmPlatformPackages must own exactly arm64 and x64.");
  }
  if (Object.keys(integrities).sort().join("\n") !== "arm64\nx64") {
    throw new Error("compatibility.ci.codexNpmPlatformIntegrities must own exactly arm64 and x64.");
  }
  canonicalIntegrity(ci.codexNpmPackageIntegrity, "compatibility.ci.codexNpmPackageIntegrity");
  for (const architecture of ["arm64", "x64"]) {
    if (
      requiredString(
        packages[architecture],
        `compatibility.ci.codexNpmPlatformPackages.${architecture}`,
      ) !== `@openai/codex-linux-${architecture}`
    ) {
      throw new Error(
        `compatibility.ci.codexNpmPlatformPackages.${architecture} must use the matching official Codex Linux package alias.`,
      );
    }
    canonicalIntegrity(
      integrities[architecture],
      `compatibility.ci.codexNpmPlatformIntegrities.${architecture}`,
    );
  }
  return codexVersion;
}

function validateMiseCiContract(ci) {
  const miseLinuxX64Sha256 = requiredString(
    ci.miseLinuxX64Sha256,
    "compatibility.ci.miseLinuxX64Sha256",
  );
  if (!/^[a-f0-9]{64}$/u.test(miseLinuxX64Sha256)) {
    throw new Error("compatibility.ci.miseLinuxX64Sha256 must be a lowercase SHA-256 digest.");
  }
  const packages = requiredObject(ci.miseNpmPackages, "compatibility.ci.miseNpmPackages");
  const integrities = requiredObject(
    ci.miseNpmPackageIntegrities,
    "compatibility.ci.miseNpmPackageIntegrities",
  );
  if (Object.keys(packages).sort().join("\n") !== "arm64\nx64") {
    throw new Error("compatibility.ci.miseNpmPackages must own exactly arm64 and x64.");
  }
  if (Object.keys(integrities).sort().join("\n") !== "arm64\nx64") {
    throw new Error("compatibility.ci.miseNpmPackageIntegrities must own exactly arm64 and x64.");
  }
  for (const architecture of ["arm64", "x64"]) {
    const packageName = requiredString(
      packages[architecture],
      `compatibility.ci.miseNpmPackages.${architecture}`,
    );
    if (packageName !== `@jdxcode/mise-linux-${architecture}`) {
      throw new Error(
        `compatibility.ci.miseNpmPackages.${architecture} must use the matching official Linux mise package.`,
      );
    }
    canonicalIntegrity(
      integrities[architecture],
      `compatibility.ci.miseNpmPackageIntegrities.${architecture}`,
    );
  }
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
