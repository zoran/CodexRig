#!/usr/bin/env node
/** Owns the local tooling doctor for runtime pins and CI integrity. */
import { spawnSyncWithBoundedIo as spawnSync } from "../repository/runtime-process-io.mjs";
import { existsSync, lstatSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  toolingRoot,
  readRepositoryFile,
  resolveRepositoryPath,
} from "../filesystem/repository-files.mjs";
import {
  compareSemver,
  parseSemver,
  versionSatisfiesSimpleRange,
} from "../contracts/semver-contract.mjs";
import { readToolingConfiguration } from "../contracts/tooling-configuration.mjs";
import { readToolchainConfiguration } from "../contracts/toolchain-configuration.mjs";
import { detectGitProvider, platformCiPath } from "../platform/git-provider.mjs";
import { ciAdapterContractViolations } from "../deps/toolchain-archives.mjs";

function pushFinding(collection, code, message) {
  collection.push({ code, message });
}

function toolVersion(root, executable, args, label, errors) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    input: "",
    maxBuffer: 1024 * 1024,
    stdio: "pipe",
    timeout: 20_000,
  });
  if (result.error || result.status !== 0) {
    pushFinding(errors, `tool.${label}.missing`, `${label} version probe failed.`);
    return "";
  }
  const output = `${result.stdout}${result.stderr}`;
  const match = output.match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/u);
  if (!match) {
    pushFinding(errors, `tool.${label}.invalid`, `${label} did not report a semantic version.`);
    return "";
  }
  return match[1];
}

function regularFileExists(root, relativePath) {
  const absolutePath = resolveRepositoryPath(root, relativePath);
  if (!existsSync(absolutePath)) return false;
  const stats = lstatSync(absolutePath);
  return !stats.isSymbolicLink() && stats.isFile() && stats.nlink === 1;
}

function validateToolchainOwners({ contract, matrix, root, errors }) {
  let packageJson;
  try {
    packageJson = JSON.parse(readRepositoryFile(root, "package.json"));
  } catch {
    pushFinding(errors, "owner.package.invalid", "package.json is unavailable or invalid.");
    return;
  }
  if (packageJson.packageManager !== `pnpm@${matrix.stable.pnpm.version}`) {
    pushFinding(
      errors,
      "owner.pnpm.drift",
      "packageManager does not match the stable compatibility matrix.",
    );
  }
  let mise;
  try {
    mise = readRepositoryFile(root, "mise.toml");
  } catch {
    pushFinding(errors, "owner.mise.missing", "mise.toml is unavailable.");
    return;
  }
  for (const [tool, version] of [
    ["node", matrix.stable.node.version],
    ["pnpm", matrix.stable.pnpm.version],
  ]) {
    const escaped = version.replaceAll(".", "\\.");
    if (!new RegExp(`^${tool}\\s*=\\s*\"${escaped}\"$`, "mu").test(mise)) {
      pushFinding(
        errors,
        `owner.mise.${tool}.drift`,
        `mise.toml ${tool} does not match the stable compatibility matrix.`,
      );
    }
  }
}

function validateRuntimeVersions({ matrix, root, errors, versions }) {
  versions.node = process.version.replace(/^v/u, "");
  versions.pnpm = toolVersion(root, "pnpm", ["--version"], "pnpm", errors);
  versions.codex = toolVersion(root, "codex", ["--version"], "Codex", errors);
  try {
    if (!versionSatisfiesSimpleRange(versions.node, matrix.stable.node.range)) {
      pushFinding(
        errors,
        "runtime.node.incompatible",
        "Node.js is outside the stable supported range.",
      );
    }
  } catch {
    pushFinding(errors, "runtime.node.invalid", "Node.js runtime version is invalid.");
  }
  if (versions.pnpm) {
    try {
      if (!versionSatisfiesSimpleRange(versions.pnpm, matrix.stable.pnpm.range)) {
        pushFinding(
          errors,
          "runtime.pnpm.incompatible",
          "pnpm is outside the stable supported range.",
        );
      }
    } catch {
      pushFinding(errors, "runtime.pnpm.invalid", "pnpm runtime version is invalid.");
    }
  }
  if (versions.codex) {
    try {
      if (compareSemver(versions.codex, matrix.stable.codex.minimumVersion) < 0) {
        pushFinding(
          errors,
          "runtime.codex.outdated",
          "Codex CLI is older than the supported minimum.",
        );
      }
    } catch {
      pushFinding(errors, "runtime.codex.invalid", "Codex CLI runtime version is invalid.");
    }
  }
}

function validateCiAdapters({ root, matrix, errors }) {
  for (const provider of ["github", "gitlab"]) {
    const relativePath = platformCiPath(provider);
    if (!regularFileExists(root, relativePath)) {
      pushFinding(errors, `platform.${provider}.ci-missing`, `${provider} CI adapter is missing.`);
      continue;
    }
    const content = readRepositoryFile(root, relativePath);
    let violations;
    try {
      violations = ciAdapterContractViolations(provider, content, matrix);
    } catch (error) {
      pushFinding(
        errors,
        `platform.${provider}.ci-contract`,
        `${provider} CI compatibility truth is invalid: ${error.message}`,
      );
      continue;
    }
    for (const violation of violations) {
      pushFinding(
        errors,
        `platform.${provider}.ci-contract`,
        `${provider} CI adapter violates the ${violation} requirement.`,
      );
    }
  }
}

async function registryLatest(fetchImpl, packageName) {
  const encoded = encodeURIComponent(packageName);
  const response = await fetchImpl(`https://registry.npmjs.org/${encoded}/latest`, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`registry returned HTTP ${response.status}`);
  const content = await response.text();
  if (Buffer.byteLength(content, "utf8") > 64 * 1024) {
    throw new Error("registry response exceeded the bounded metadata size");
  }
  const value = JSON.parse(content);
  return parseSemver(value?.version, `${packageName} registry version`).raw;
}

export function compatibilityFreshnessWarnings(matrix, latest) {
  const warnings = [];
  if (compareSemver(matrix.stable.pnpm.version, latest.pnpm) < 0) {
    pushFinding(
      warnings,
      "online.pnpm.newer",
      `A newer stable pnpm is available (${latest.pnpm}); review the stable compatibility line.`,
    );
  }
  if (compareSemver(matrix.ci.codexVersion, latest.codex) < 0) {
    pushFinding(
      warnings,
      "online.codex.newer",
      `Codex stable ${latest.codex} is newer than the reviewed blocking-CI version ${matrix.ci.codexVersion}; run canonical startup maintenance to review the official archives and update host and CI pins together.`,
    );
  }
  return warnings;
}

async function onlineFindings({ fetchImpl, matrix, errors, warnings }) {
  if (typeof fetchImpl !== "function") {
    pushFinding(errors, "online.unavailable", "Online doctor requires fetch support.");
    return {};
  }
  const latest = {};
  try {
    [latest.pnpm, latest.codex] = await Promise.all([
      registryLatest(fetchImpl, "pnpm"),
      registryLatest(fetchImpl, "@openai/codex"),
    ]);
  } catch {
    pushFinding(errors, "online.indeterminate", "Registry freshness is indeterminate.");
    return latest;
  }
  warnings.push(...compatibilityFreshnessWarnings(matrix, latest));
  return latest;
}

export async function diagnoseTooling({
  root = toolingRoot,
  environment = process.env,
  online = false,
  fetchImpl = globalThis.fetch,
} = {}) {
  const errors = [];
  const warnings = [];
  const versions = {};
  let contract;
  let matrix;
  try {
    contract = readToolingConfiguration(root);
    matrix = readToolchainConfiguration(root);
  } catch (error) {
    pushFinding(errors, "contract.invalid", error.message);
    return { errors, mode: "unknown", online: {}, platform: null, versions, warnings };
  }
  validateToolchainOwners({ contract, matrix, root, errors });
  validateRuntimeVersions({ matrix, root, errors, versions });
  validateCiAdapters({ root, matrix, errors });
  const mode = "project";
  let platform = null;
  try {
    platform = detectGitProvider({ root, environment, contract });
  } catch (error) {
    pushFinding(errors, "platform.detection", error.message);
  }
  const reviewDate = new Date(`${matrix.reviewedOn}T00:00:00Z`);
  const reviewAgeDays = Math.floor((Date.now() - reviewDate.getTime()) / 86_400_000);
  if (!Number.isFinite(reviewAgeDays) || reviewAgeDays < 0) {
    pushFinding(
      errors,
      "compatibility.review-date",
      "Compatibility review date is invalid or future-dated.",
    );
  } else if (reviewAgeDays > 120) {
    pushFinding(
      warnings,
      "compatibility.review-stale",
      "Compatibility matrix has not been reviewed in the last 120 days.",
    );
  }
  const onlineState = online ? await onlineFindings({ fetchImpl, matrix, errors, warnings }) : {};
  return { contract, errors, matrix, mode, online: onlineState, platform, versions, warnings };
}

function parseArgs(argv) {
  const args = new Set(argv.filter((argument) => argument !== "--"));
  const allowed = new Set(["--json", "--online", "--help", "-h"]);
  const unknown = [...args].find((argument) => !allowed.has(argument));
  if (unknown) throw new Error(`Unknown tooling doctor option: ${unknown}.`);
  return {
    help: args.has("--help") || args.has("-h"),
    json: args.has("--json"),
    online: args.has("--online"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: pnpm tooling:doctor [-- --json] [--online]");
    return;
  }
  const result = await diagnoseTooling({ online: args.online });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Tooling mode: ${result.mode}.`);
    if (result.contract) console.log(`Tooling contract: ${result.contract.protocol.version}.`);
    if (result.platform?.provider) {
      console.log(`Git platform: ${result.platform.provider} (${result.platform.source}).`);
    } else {
      console.log("Git platform: not configured.");
    }
    if (result.versions.node) {
      console.log(
        `Runtime: Node.js ${result.versions.node}, pnpm ${result.versions.pnpm || "unavailable"}, Codex ${result.versions.codex || "unavailable"}.`,
      );
    }
    for (const warning of result.warnings)
      console.warn(`Warning [${warning.code}]: ${warning.message}`);
    for (const error of result.errors) console.error(`Error [${error.code}]: ${error.message}`);
    if (result.errors.length === 0) console.log("Project tooling doctor passed.");
  }
  if (result.errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`Tooling doctor failed: ${error.message}`);
    process.exit(1);
  }
}
