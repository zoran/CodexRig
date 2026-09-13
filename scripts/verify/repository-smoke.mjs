/** Owns repository smoke checks for selected local tools and their contracts. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { toolingRoot as root, readRepositoryFile } from "../filesystem/repository-files.mjs";
import { portableContextContractFindings } from "../context/portable-context-contract.mjs";
import { validateMinimalMiseTools } from "../contracts/mise-toolchain-configuration.mjs";
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
const miseToml = readRelative("mise.toml");
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

const miseLock = readRelative("mise.lock");
const lockedTools = [...miseLock.matchAll(/^\[\[tools\.([a-z0-9_-]+)\]\]$/gm)].map(
  ([, tool]) => tool,
);
const configuredTools = Object.keys(miseVersions);
if (
  new Set(lockedTools).size !== lockedTools.length ||
  [...lockedTools].sort().join(",") !== [...configuredTools].sort().join(",")
) {
  failures.push("mise.lock tool entries must match every configured mise.toml tool exactly once");
}

function lockedToolBlock(tool) {
  const marker = `[[tools.${tool}]]`;
  const start = miseLock.indexOf(marker);
  if (start < 0) return "";
  const next = miseLock.indexOf("\n[[tools.", start + marker.length);
  return miseLock.slice(start, next < 0 ? undefined : next);
}

function lockedPlatformBlock(tool, platform) {
  const toolBlock = lockedToolBlock(tool);
  const marker = `[tools.${tool}."platforms.${platform}"]`;
  const start = toolBlock.indexOf(marker);
  if (start < 0) return "";
  const next = toolBlock.indexOf(`\n[tools.${tool}."platforms.`, start + marker.length);
  return toolBlock.slice(start, next < 0 ? undefined : next);
}

function lockedField(block, field) {
  return block.match(new RegExp(`^${field} = "([^"\\r\\n]+)"$`, "m"))?.[1] ?? "";
}

function lockedPlatformsForTool(tool) {
  return [
    ...lockedToolBlock(tool).matchAll(/^\[tools\.[a-z0-9_-]+\."platforms\.([^"]+)"\]$/gm),
  ].map(([, platform]) => platform);
}

for (const tool of configuredTools) {
  const block = lockedToolBlock(tool);
  if (!block.includes(`version = "${miseVersions[tool]}"`)) {
    failures.push(`mise.lock ${tool} entry must match mise.toml version ${miseVersions[tool]}`);
  }
  if (!/^backend = "[^"\r\n]+"$/m.test(block)) {
    failures.push(`mise.lock ${tool} entry must declare its resolved backend`);
  }
  const platforms = lockedPlatformsForTool(tool);
  if (platforms.length === 0) {
    failures.push(`mise.lock ${tool} entry must contain at least one locked platform artifact`);
  }
  for (const platform of platforms) {
    const platformBlock = lockedPlatformBlock(tool, platform);
    if (!/^checksum = "sha256:[a-f0-9]{64}"$/m.test(platformBlock)) {
      failures.push(`mise.lock ${tool} ${platform} entry must include a SHA-256 checksum`);
    }
    if (!/^url = "https:\/\/[^"\r\n]+"$/m.test(platformBlock)) {
      failures.push(`mise.lock ${tool} ${platform} entry must include an HTTPS URL`);
    }
  }
}

const lockedPlatforms = {
  node: [
    "linux-arm64",
    "linux-arm64-musl",
    "linux-x64",
    "linux-x64-musl",
    "macos-arm64",
    "macos-x64",
    "windows-x64",
  ],
  pnpm: [
    "linux-arm64",
    "linux-arm64-musl",
    "linux-x64",
    "linux-x64-musl",
    "macos-arm64",
    "windows-x64",
  ],
};
for (const [tool, platforms] of Object.entries(lockedPlatforms)) {
  const block = lockedToolBlock(tool);
  const expectedBackend = tool === "node" ? "core:node" : "aqua:pnpm/pnpm";
  if (lockedPlatformsForTool(tool).join(",") !== platforms.join(",")) {
    failures.push(`mise.lock ${tool} platforms must match the supported artifact matrix exactly`);
  }
  for (const expected of [`version = "${miseVersions[tool]}"`, `backend = "${expectedBackend}"`]) {
    if (!block.includes(expected))
      failures.push(`mise.lock ${tool} entry must include ${expected}`);
  }
  for (const platform of platforms) {
    const platformBlock = lockedPlatformBlock(tool, platform);
    if (!/^checksum = "sha256:[a-f0-9]{64}"$/m.test(platformBlock)) {
      failures.push(`mise.lock ${tool} ${platform} entry must include a SHA-256 checksum`);
    }
    if (!/^url = "https:\/\/[^"]+"$/m.test(platformBlock)) {
      failures.push(`mise.lock ${tool} ${platform} entry must include an HTTPS URL`);
    }
    if (tool === "pnpm" && !platformBlock.includes('provenance = "github-attestations"')) {
      failures.push(`mise.lock pnpm ${platform} entry must include GitHub attestation provenance`);
    }
  }
}
const officialArtifactUrls = {
  node: {
    "linux-arm64": `https://nodejs.org/dist/v${miseVersions.node}/node-v${miseVersions.node}-linux-arm64.tar.gz`,
    "linux-arm64-musl": `https://unofficial-builds.nodejs.org/download/release/v${miseVersions.node}/node-v${miseVersions.node}-linux-arm64-musl.tar.gz`,
    "linux-x64": `https://nodejs.org/dist/v${miseVersions.node}/node-v${miseVersions.node}-linux-x64.tar.gz`,
    "linux-x64-musl": `https://unofficial-builds.nodejs.org/download/release/v${miseVersions.node}/node-v${miseVersions.node}-linux-x64-musl.tar.gz`,
    "macos-arm64": `https://nodejs.org/dist/v${miseVersions.node}/node-v${miseVersions.node}-darwin-arm64.tar.gz`,
    "macos-x64": `https://nodejs.org/dist/v${miseVersions.node}/node-v${miseVersions.node}-darwin-x64.tar.gz`,
    "windows-x64": `https://nodejs.org/dist/v${miseVersions.node}/node-v${miseVersions.node}-win-x64.zip`,
  },
  pnpm: {
    "linux-arm64": `https://github.com/pnpm/pnpm/releases/download/v${miseVersions.pnpm}/pnpm-linux-arm64.tar.gz`,
    "linux-arm64-musl": `https://github.com/pnpm/pnpm/releases/download/v${miseVersions.pnpm}/pnpm-linux-arm64-musl.tar.gz`,
    "linux-x64": `https://github.com/pnpm/pnpm/releases/download/v${miseVersions.pnpm}/pnpm-linux-x64.tar.gz`,
    "linux-x64-musl": `https://github.com/pnpm/pnpm/releases/download/v${miseVersions.pnpm}/pnpm-linux-x64-musl.tar.gz`,
    "macos-arm64": `https://github.com/pnpm/pnpm/releases/download/v${miseVersions.pnpm}/pnpm-darwin-arm64.tar.gz`,
    "windows-x64": `https://github.com/pnpm/pnpm/releases/download/v${miseVersions.pnpm}/pnpm-win32-x64.zip`,
  },
};
for (const [tool, platformUrls] of Object.entries(officialArtifactUrls)) {
  for (const [platform, expectedUrl] of Object.entries(platformUrls)) {
    const platformBlock = lockedPlatformBlock(tool, platform);
    if (lockedField(platformBlock, "url") !== expectedUrl) {
      failures.push(`mise.lock ${tool} ${platform} URL must match its official versioned artifact`);
    }
    if (tool === "pnpm") {
      if (lockedField(platformBlock, "provenance") !== "github-attestations") {
        failures.push(
          `mise.lock pnpm ${platform} entry must include GitHub attestation provenance`,
        );
      }
      if (
        !/^https:\/\/api\.github\.com\/repos\/pnpm\/pnpm\/releases\/assets\/[1-9]\d*$/.test(
          lockedField(platformBlock, "url_api"),
        )
      ) {
        failures.push(`mise.lock pnpm ${platform} URL API must identify an official GitHub asset`);
      }
    }
  }
}

if (failures.length) {
  console.error("Project tooling verification failed:");
  for (const finding of failures) console.error(`- ${finding}`);
  process.exitCode = 1;
} else console.log("Project tooling verification passed.");
