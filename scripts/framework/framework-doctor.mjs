#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  compareSemver,
  frameworkRoot,
  isReusableFrameworkSource,
  listManagedFrameworkFiles,
  managedPackageSnapshot,
  parseSemver,
  readCompatibilityMatrix,
  readFrameworkContract,
  readInstallationReceipt,
  readRegularFrameworkFile,
  resolveFrameworkPath,
  sha256,
  versionSatisfiesSimpleRange,
} from "./framework-contract.mjs";
import { detectGitProvider, platformCiPath } from "../platform/git-provider.mjs";
import { readPolicyProjection } from "./policy-projection.mjs";

function pushFinding(collection, code, message) {
  collection.push({ code, message });
}

function toolVersion(root, executable, args, label, errors) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    input: "",
    stdio: "pipe",
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
  const absolutePath = resolveFrameworkPath(root, relativePath);
  if (!existsSync(absolutePath)) return false;
  const stats = lstatSync(absolutePath);
  return !stats.isSymbolicLink() && stats.isFile() && stats.nlink === 1;
}

function validateToolchainOwners({ contract, matrix, root, errors }) {
  let packageJson;
  try {
    packageJson = JSON.parse(readRegularFrameworkFile(root, "package.json"));
  } catch {
    pushFinding(errors, "owner.package.invalid", "package.json is unavailable or invalid.");
    return;
  }
  if (isReusableFrameworkSource(root) && packageJson.version !== contract.frameworkVersion) {
    pushFinding(
      errors,
      "owner.framework-version.drift",
      "Source package version does not match the framework contract version.",
    );
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
    mise = readRegularFrameworkFile(root, "mise.toml");
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

function validateCiAdapters({ root, errors }) {
  for (const provider of ["github", "gitlab"]) {
    const relativePath = platformCiPath(provider);
    if (!regularFileExists(root, relativePath)) {
      pushFinding(errors, `platform.${provider}.ci-missing`, `${provider} CI adapter is missing.`);
      continue;
    }
    const content = readRegularFrameworkFile(root, relativePath);
    const markers =
      provider === "github"
        ? ["merge_group:", "scripts/framework/compatibility-matrix.mjs --github-matrix"]
        : ["merge_request_event", "scripts/framework/compatibility-matrix.mjs --gitlab-child"];
    for (const marker of markers) {
      if (!content.includes(marker)) {
        pushFinding(
          errors,
          `platform.${provider}.ci-contract`,
          `${provider} CI adapter is missing ${marker}.`,
        );
      }
    }
  }
}

function validateInstallation({ contract, root, errors, warnings }) {
  let expectedManagedPaths = [];
  try {
    expectedManagedPaths = listManagedFrameworkFiles(root, contract);
  } catch (error) {
    pushFinding(errors, "installation.managed-contract", error.message);
  }
  if (isReusableFrameworkSource(root)) {
    try {
      managedPackageSnapshot(root, contract);
    } catch (error) {
      pushFinding(errors, "source.package-contract", error.message);
    }
    return "source";
  }
  let receipt;
  try {
    receipt = readInstallationReceipt(root, contract);
  } catch (error) {
    pushFinding(errors, "installation.receipt", error.message);
    return "project";
  }
  if (receipt.frameworkVersion !== contract.frameworkVersion) {
    pushFinding(
      errors,
      "installation.version-drift",
      "Installation receipt and framework contract versions differ.",
    );
  }
  const receivedManagedPaths = Object.keys(receipt.managedFiles).sort();
  const installedManagedPaths = Object.keys(receipt.installedFiles).sort();
  if (
    JSON.stringify(receivedManagedPaths) !== JSON.stringify(expectedManagedPaths) ||
    JSON.stringify(installedManagedPaths) !== JSON.stringify(expectedManagedPaths)
  ) {
    pushFinding(
      errors,
      "installation.managed-inventory",
      "Installation receipt does not cover the exact current managed framework inventory.",
    );
  }
  for (const [relativePath, entry] of Object.entries(receipt.installedFiles)) {
    try {
      const content = readRegularFrameworkFile(root, relativePath);
      if (sha256(content) !== entry.sha256) {
        pushFinding(
          errors,
          "installation.managed-drift",
          `Managed framework file has local changes: ${relativePath}.`,
        );
      }
    } catch {
      pushFinding(
        errors,
        "installation.managed-missing",
        `Managed framework file is missing: ${relativePath}.`,
      );
    }
  }
  try {
    const currentPackage = managedPackageSnapshot(root, contract);
    if (JSON.stringify(currentPackage) !== JSON.stringify(receipt.installedPackage)) {
      pushFinding(
        errors,
        "installation.package-drift",
        "Framework-owned package fields differ from their installation receipt.",
      );
    }
  } catch (error) {
    pushFinding(errors, "installation.package-invalid", error.message);
  }
  const customizedFiles = expectedManagedPaths.filter(
    (relativePath) =>
      JSON.stringify(receipt.managedFiles[relativePath]) !==
      JSON.stringify(receipt.installedFiles[relativePath]),
  );
  if (
    customizedFiles.length > 0 ||
    JSON.stringify(receipt.managedPackage) !== JSON.stringify(receipt.installedPackage)
  ) {
    pushFinding(
      warnings,
      "installation.customized",
      "The installed project preserves local framework customizations; future upstream overlap will require conflict resolution.",
    );
  }
  return "project";
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
  if (compareSemver(matrix.stable.pnpm.version, latest.pnpm) < 0) {
    pushFinding(
      warnings,
      "online.pnpm.newer",
      `A newer stable pnpm is available (${latest.pnpm}); review the stable compatibility line.`,
    );
  }
  if (compareSemver(matrix.stable.codex.minimumVersion, latest.codex) < 0) {
    pushFinding(
      warnings,
      "online.codex.newer",
      `Codex stable is newer than the recorded minimum (${latest.codex}); the launcher update path remains authoritative.`,
    );
  }
  return latest;
}

export async function diagnoseFramework({
  root = frameworkRoot,
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
    contract = readFrameworkContract(root);
    matrix = readCompatibilityMatrix(root, contract);
    readPolicyProjection(root);
  } catch (error) {
    pushFinding(errors, "contract.invalid", error.message);
    return { errors, mode: "unknown", online: {}, platform: null, versions, warnings };
  }
  validateToolchainOwners({ contract, matrix, root, errors });
  validateRuntimeVersions({ matrix, root, errors, versions });
  validateCiAdapters({ root, errors });
  const mode = validateInstallation({ contract, root, errors, warnings });
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
  if (unknown) throw new Error(`Unknown framework doctor option: ${unknown}.`);
  return {
    help: args.has("--help") || args.has("-h"),
    json: args.has("--json"),
    online: args.has("--online"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: pnpm framework:doctor [-- --json] [--online]");
    return;
  }
  const result = await diagnoseFramework({ online: args.online });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Framework mode: ${result.mode}.`);
    if (result.contract) console.log(`Framework contract: ${result.contract.frameworkVersion}.`);
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
    if (result.errors.length === 0) console.log("CodexRig framework doctor passed.");
  }
  if (result.errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`Framework doctor failed: ${error.message}`);
    process.exit(1);
  }
}
