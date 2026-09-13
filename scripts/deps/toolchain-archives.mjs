#!/usr/bin/env node
/** Owns toolchain archive verification and reviewed stable CI installer rendering. */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseSemver } from "../contracts/semver-contract.mjs";
import {
  readToolchainConfiguration,
  validateToolchainConfiguration,
} from "../contracts/toolchain-configuration.mjs";
function yamlSingleQuoted(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function canonicalSha512Integrity(value, label) {
  if (typeof value !== "string" || !value.startsWith("sha512-")) {
    throw new Error(`${label} must be a SHA-512 Subresource Integrity value.`);
  }
  const encoded = value.slice("sha512-".length);
  if (!/^[A-Za-z0-9+/]{86}==$/u.test(encoded)) {
    throw new Error(`${label} must be a canonical SHA-512 Subresource Integrity value.`);
  }
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== encoded) {
    throw new Error(`${label} must encode exactly one canonical SHA-512 digest.`);
  }
  return value;
}

/** Returns the exact official per-architecture mise package and reviewed archive integrity. */
export function miseNpmPackageRecords(matrix = readToolchainConfiguration()) {
  const validatedMatrix = validateToolchainConfiguration({
    schemaVersion: 1,
    reviewedOn: matrix.reviewedOn,
    ci: matrix.ci,
    stable: matrix.stable,
  });
  const packages = validatedMatrix.ci.miseNpmPackages;
  const integrities = validatedMatrix.ci.miseNpmPackageIntegrities;
  if (!integrities || typeof integrities !== "object" || Array.isArray(integrities)) {
    throw new Error("compatibility.ci.miseNpmPackageIntegrities must be an object.");
  }
  if (Object.keys(integrities).sort().join("\n") !== "arm64\nx64") {
    throw new Error("compatibility.ci.miseNpmPackageIntegrities must own exactly arm64 and x64.");
  }
  const records = {};
  for (const architecture of ["arm64", "x64"]) {
    records[architecture] = {
      integrity: canonicalSha512Integrity(
        integrities[architecture],
        `compatibility.ci.miseNpmPackageIntegrities.${architecture}`,
      ),
      npmPackage: packages[architecture],
    };
  }
  return records;
}

/** Returns the exact reviewed Codex wrapper and per-architecture platform archives for blocking CI. */
export function codexNpmPackageRecords(matrix = readToolchainConfiguration()) {
  const validatedMatrix = validateToolchainConfiguration({
    schemaVersion: 1,
    reviewedOn: matrix.reviewedOn,
    ci: matrix.ci,
    stable: matrix.stable,
  });
  const ci = validatedMatrix.ci;
  const version = parseSemver(ci.codexVersion, "compatibility.ci.codexVersion").raw;
  const wrapper = {
    integrity: canonicalSha512Integrity(
      ci.codexNpmPackageIntegrity,
      "compatibility.ci.codexNpmPackageIntegrity",
    ),
    npmPackage: ci.codexNpmPackage,
    specification: `${ci.codexNpmPackage}@${version}`,
    version,
  };
  const platforms = {};
  for (const architecture of ["arm64", "x64"]) {
    platforms[architecture] = {
      aliasPackage: ci.codexNpmPlatformPackages[architecture],
      integrity: canonicalSha512Integrity(
        ci.codexNpmPlatformIntegrities[architecture],
        `compatibility.ci.codexNpmPlatformIntegrities.${architecture}`,
      ),
      targetSpecification: `${ci.codexNpmPackage}@${version}-linux-${architecture}`,
    };
  }
  return { platforms, wrapper };
}

/** Renders the canonical shell body for the reviewed stable Codex install in blocking CI. */
export function stableCodexInstallShell(matrix = readToolchainConfiguration()) {
  const records = codexNpmPackageRecords(matrix);
  return [
    'case "$(uname -m)" in',
    `  x86_64|amd64) codex_architecture='x64'; codex_platform_package=${yamlSingleQuoted(records.platforms.x64.aliasPackage)}; codex_platform_integrity=${yamlSingleQuoted(records.platforms.x64.integrity)} ;;`,
    `  aarch64|arm64) codex_architecture='arm64'; codex_platform_package=${yamlSingleQuoted(records.platforms.arm64.aliasPackage)}; codex_platform_integrity=${yamlSingleQuoted(records.platforms.arm64.integrity)} ;;`,
    '  *) echo "Unsupported stable Codex CI architecture: $(uname -m)" >&2; exit 1 ;;',
    "esac",
    `codex_package=${yamlSingleQuoted(records.wrapper.npmPackage)}`,
    `codex_version=${yamlSingleQuoted(records.wrapper.version)}`,
    `codex_wrapper_integrity=${yamlSingleQuoted(records.wrapper.integrity)}`,
    'codex_install_root="$(umask 077 && mktemp -d)"',
    'codex_stage="$codex_install_root/stage"',
    'codex_cache="$codex_install_root/cache"',
    'mkdir -m 700 "$codex_stage" "$codex_cache"',
    "trap 'rm -rf -- \"$codex_install_root\"' EXIT",
    'npm_config_cache="$codex_cache" npm_config_ignore_scripts=true npm cache add "${codex_package}@${codex_version}"',
    'npm_config_cache="$codex_cache" npm_config_ignore_scripts=true npm cache add "${codex_platform_package}@npm:${codex_package}@${codex_version}-linux-${codex_architecture}"',
    'npm_config_cache="$codex_cache" npm_config_ignore_scripts=true npm pack --ignore-scripts --pack-destination "$codex_stage" "${codex_package}@${codex_version}" "${codex_package}@${codex_version}-linux-${codex_architecture}" >/dev/null',
    'node scripts/deps/toolchain-archives.mjs --verify-codex-archives "$codex_stage" "$codex_wrapper_integrity" "$codex_platform_integrity" >/dev/null',
    'npm_config_cache="$codex_cache" npm_config_ignore_scripts=true npm install --global "${codex_package}@${codex_version}" --ignore-scripts --offline',
    'rm -rf -- "$codex_install_root"',
    "trap - EXIT",
  ];
}

/** Renders the exact GitHub Actions step for the reviewed stable Codex install. */
export function githubStableCodexInstallStep(matrix = readToolchainConfiguration()) {
  return [
    "      - name: Install the reviewed stable Codex CLI",
    "        shell: bash",
    "        run: |",
    ...stableCodexInstallShell(matrix).map((line) => `          ${line}`),
  ];
}

/** Renders the exact GitLab before_script item for the reviewed stable Codex install. */
export function gitlabStableCodexInstallBeforeScript(matrix = readToolchainConfiguration()) {
  return ["    - |", ...stableCodexInstallShell(matrix).map((line) => `      ${line}`)];
}

/** Renders the one canonical GitLab before_script item that verifies mise before installation. */
export function gitlabMiseInstallBeforeScript(matrix = readToolchainConfiguration()) {
  const records = miseNpmPackageRecords(matrix);
  const version = parseSemver(matrix.ci.miseVersion, "compatibility.ci.miseVersion").raw;
  return [
    "    - |",
    '      case "$(uname -m)" in',
    `        x86_64|amd64) mise_package=${yamlSingleQuoted(records.x64.npmPackage)}; mise_integrity=${yamlSingleQuoted(records.x64.integrity)} ;;`,
    `        aarch64|arm64) mise_package=${yamlSingleQuoted(records.arm64.npmPackage)}; mise_integrity=${yamlSingleQuoted(records.arm64.integrity)} ;;`,
    '        *) echo "Unsupported GitLab runner architecture: $(uname -m)" >&2; exit 1 ;;',
    "      esac",
    '      mise_stage="$(umask 077 && mktemp -d)"',
    `      npm pack --ignore-scripts --pack-destination "$mise_stage" "\${mise_package}@${version}" >/dev/null`,
    '      mise_archive="$(node scripts/deps/toolchain-archives.mjs --verify-mise-archive "$mise_stage" "$mise_integrity")"',
    '      npm install --global "$mise_archive" --ignore-scripts --offline',
  ];
}

/** Verifies the sole staged npm tarball and returns its path without exposing it first. */
export function verifyMiseArchive(directory, expectedIntegrity) {
  const integrity = canonicalSha512Integrity(expectedIntegrity, "Expected mise archive integrity");
  const stage = path.resolve(directory);
  const stageStats = lstatSync(stage);
  if (stageStats.isSymbolicLink() || !stageStats.isDirectory()) {
    throw new Error("Mise archive stage must be a real directory.");
  }
  const candidates = readdirSync(stage).filter((entry) => entry.endsWith(".tgz"));
  if (candidates.length !== 1) {
    throw new Error("Mise archive stage must contain exactly one .tgz archive.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/u.test(candidates[0])) {
    throw new Error("Staged mise archive must use one safe npm tarball name.");
  }
  const archive = path.join(stage, candidates[0]);
  const archiveStats = lstatSync(archive);
  if (
    archiveStats.isSymbolicLink() ||
    !archiveStats.isFile() ||
    archiveStats.nlink !== 1 ||
    archiveStats.size === 0 ||
    archiveStats.size > 100 * 1024 * 1024
  ) {
    throw new Error("Staged mise archive must be one bounded regular single-link file.");
  }
  const receivedIntegrity = `sha512-${createHash("sha512")
    .update(readFileSync(archive))
    .digest("base64")}`;
  if (receivedIntegrity !== integrity) {
    throw new Error("Staged mise archive does not match the reviewed integrity.");
  }
  return archive;
}

/** Verifies that a private stage contains exactly the reviewed Codex wrapper and platform bytes. */
export function verifyCodexArchives(directory, wrapperIntegrity, platformIntegrity) {
  const expected = [
    canonicalSha512Integrity(wrapperIntegrity, "Expected Codex wrapper integrity"),
    canonicalSha512Integrity(platformIntegrity, "Expected Codex platform integrity"),
  ].sort();
  const stage = path.resolve(directory);
  const stageStats = lstatSync(stage);
  if (stageStats.isSymbolicLink() || !stageStats.isDirectory()) {
    throw new Error("Codex archive stage must be a real directory.");
  }
  const candidates = readdirSync(stage)
    .filter((entry) => entry.endsWith(".tgz"))
    .sort();
  if (candidates.length !== 2) {
    throw new Error("Codex archive stage must contain exactly two .tgz archives.");
  }
  const received = candidates.map((candidate) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/u.test(candidate)) {
      throw new Error("Staged Codex archives must use safe npm tarball names.");
    }
    const archive = path.join(stage, candidate);
    const stats = lstatSync(archive);
    if (
      stats.isSymbolicLink() ||
      !stats.isFile() ||
      stats.nlink !== 1 ||
      stats.size === 0 ||
      stats.size > 150 * 1024 * 1024
    ) {
      throw new Error("Each staged Codex archive must be one bounded regular single-link file.");
    }
    return `sha512-${createHash("sha512").update(readFileSync(archive)).digest("base64")}`;
  });
  if (JSON.stringify(received.sort()) !== JSON.stringify(expected)) {
    throw new Error("Staged Codex archives do not match the reviewed wrapper and platform bytes.");
  }
  return candidates.map((candidate) => path.join(stage, candidate));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [operation, ...args] = process.argv.slice(2);
    if (operation === "--verify-mise-archive" && args.length === 2)
      console.log(verifyMiseArchive(...args));
    else if (operation === "--verify-codex-archives" && args.length === 3)
      console.log(verifyCodexArchives(...args).join("\n"));
    else
      throw new Error("Expected an archive verification operation and exact integrity arguments.");
  } catch (error) {
    console.error(`Toolchain archive validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

/** Returns CI adapter contract violation ids for deterministic doctor evidence. */
export function ciAdapterContractViolations(provider, content, matrix) {
  if (!new Set(["github", "gitlab"]).has(provider)) {
    throw new Error(`Unsupported CI adapter provider: ${provider}.`);
  }
  const requirements =
    provider === "github"
      ? [
          ["merge-group", "merge_group:"],

          ["pinned-mise-action", "jdx/mise-action@"],
          ["mise-version", `version: ${matrix.ci.miseVersion}`],
          ["mise-sha256", `sha256: ${matrix.ci.miseLinuxX64Sha256}`],
          ["deferred-mise-install", "install: false"],
          ["reviewed-stable-codex", githubStableCodexInstallStep(matrix).join("\n")],
        ]
      : [
          ["merge-request", "merge_request_event"],

          ["verified-mise-install", gitlabMiseInstallBeforeScript(matrix).join("\n")],
          ["reviewed-stable-codex", gitlabStableCodexInstallBeforeScript(matrix).join("\n")],
          ["frozen-install", "--ignore-pnpmfile"],
          ["shellcheck", "shellcheck"],
        ];
  const violations = requirements
    .filter(([, marker]) => !content.includes(marker))
    .map(([id]) => id);
  if (
    provider === "gitlab" &&
    /npm\s+install\s+--global[^\n]*(?:mise@latest|\$\{mise_package\}@)/u.test(content)
  ) {
    violations.push("unverified-mise-install");
  }
  if (/npm\s+install\s+--global[^\n]*@openai\/codex@latest\b/u.test(content)) {
    violations.push("moving-codex-in-blocking-ci");
  }
  return violations;
}
