/** Owns repository smoke checks for selected local tools and their contracts. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { toolingRoot as root, readRepositoryFile } from "../filesystem/repository-files.mjs";
import { portableContextContractFindings } from "../context/portable-context-contract.mjs";
import {
  validateMinimalMiseTools,
  candidateMiseLockFindings,
} from "../contracts/mise-toolchain-configuration.mjs";
import { readToolchainConfiguration } from "../contracts/toolchain-configuration.mjs";
import { readToolingConfiguration } from "../contracts/tooling-configuration.mjs";
import { startupExecutableClosurePaths } from "../setup/startup-executable-closure.mjs";
import { validateCodexConfig } from "../setup/validate-codex-config.mjs";
import { futureModulesDocumentFindings } from "../docs/project-manifest-contract.mjs";
const failures = [];
const compatibilityMatrix = readToolchainConfiguration(root);
function readRelative(relativePath) {
  return readRepositoryFile(root, relativePath);
}
try {
  readToolingConfiguration(root);
  validateCodexConfig(root);
  startupExecutableClosurePaths(root);
  failures.push(...portableContextContractFindings({ repositoryRoot: root }));
  failures.push(...futureModulesDocumentFindings(readRelative("docs/future-modules.md")));
} catch (error) {
  failures.push(error.message);
}
let packageJson;
try {
  packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
} catch {
  failures.push("package.json must contain valid JSON");
}

if (packageJson) {
  if (packageJson.private !== true) failures.push("package.json must remain private");
  if (packageJson.type !== "module") failures.push('package.json type must be "module"');
  if (!/^pnpm@\d/.test(packageJson.packageManager ?? "")) {
    failures.push("package.json must pin pnpm through packageManager");
  }
  for (const scriptName of [
    "auth:check",
    "codex:start",
    "codex:validate",
    "deps:install",
    "docs:check",
    "goal:new",
    "localization:check",
    "repo:housekeeping",
    "setup",
    "stack:detect",
    "tenancy:check",
    "verify",
    "verify:changed",
    "verify:external",
    "verify:pre-push",
  ]) {
    if (!packageJson.scripts?.[scriptName]) failures.push(`missing package script: ${scriptName}`);
  }
  if (!packageJson.scripts?.["codex:start"]?.includes("scripts/setup/start-codex.sh")) {
    failures.push("codex:start must use the project launcher");
  }
  if (packageJson.scripts?.["auth:check"] !== "node scripts/verify/identity-access.mjs") {
    failures.push("auth:check must use the canonical Identity and Access boundary verifier");
  }
  if (packageJson.scripts?.["tenancy:check"] !== "node scripts/verify/tenant-isolation.mjs") {
    failures.push("tenancy:check must use the canonical tenant-isolation boundary verifier");
  }
  if (packageJson.scripts?.["localization:check"] !== "node scripts/verify/localization.mjs") {
    failures.push("localization:check must use the canonical localization verifier");
  }
  if (packageJson.scripts?.["deps:install"] !== "node scripts/deps/install-compatible.mjs") {
    failures.push("deps:install must use the compatible dependency installer");
  }
  if (
    packageJson.scripts?.["goal:new"] !== "node scripts/goals/goal-publication-precondition.mjs"
  ) {
    failures.push("goal:new must use the fail-closed publication precondition");
  }
  if (!packageJson.scripts?.setup?.includes("node scripts/verify/identity-access.mjs")) {
    failures.push("setup must validate the Identity and Access boundary");
  }
  if (!packageJson.scripts?.setup?.includes("node scripts/verify/tenant-isolation.mjs")) {
    failures.push("setup must validate the tenant-isolation boundary");
  }
  if (!packageJson.scripts?.setup?.includes("node scripts/verify/localization.mjs")) {
    failures.push("setup must validate the localization contract");
  }
}

for (const command of Object.values(packageJson?.scripts ?? {})) {
  for (const [, relativePath] of command.matchAll(/(?:^|[\s"'])(scripts\/[A-Za-z0-9_./-]+)/gu)) {
    try {
      readRepositoryFile(root, relativePath);
    } catch (error) {
      failures.push(error.message);
    }
  }
}
const miseToml = readRelative(".codex/mise.toml");
const miseValidation = validateMinimalMiseTools(miseToml);
for (const error of miseValidation.errors) failures.push(`mise.toml ${error}`);
const miseVersions = miseValidation.versions;
if (
  packageJson &&
  miseVersions.pnpm &&
  packageJson.packageManager !== `pnpm@${miseVersions.pnpm}`
) {
  failures.push("mise.toml pnpm version must match package.json packageManager");
}

const miseLock = readRelative(".codex/mise.lock");
failures.push(...candidateMiseLockFindings(miseLock, miseValidation.versionLists));

if (failures.length) {
  console.error("Project tooling verification failed:");
  for (const finding of failures) console.error(`- ${finding}`);
  process.exitCode = 1;
} else console.log("Project tooling verification passed.");
