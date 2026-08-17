/** Owns repository smoke behavior for the repository verification boundary. */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  hasContradictoryStopHookIndexContract,
  portableContextContractFindings,
  supportedCodexStartCommand,
} from "../context/portable-context-contract.mjs";
import { validateMinimalMiseTools } from "../contracts/mise-toolchain-configuration.mjs";
import { readCompatibilityMatrix } from "../contracts/framework-contract.mjs";
import { discoverProductLayout } from "../repository/product-roots.mjs";
import {
  listActiveFiles,
  portableCodexGitignorePatterns,
  repositoryCodexHomeGitignorePatterns,
} from "../repository/source-inventory.mjs";
import { classifyPath, isFullRelevantPath } from "./adaptive-state.mjs";
import { repositorySmokeContentExpectations } from "./repository-smoke-content.mjs";
import { repositorySmokeRequiredFiles } from "./repository-smoke-inventory.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const failures = [];
const compatibilityMatrix = readCompatibilityMatrix(root);

function readRelative(relativePath) {
  const fullPath = path.join(root, relativePath);
  return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : "";
}

function requireContent(relativePath, expected) {
  const content = readRelative(relativePath);
  const normalizedContent = content.replace(/\s+/g, " ");
  const normalizedExpected = expected.replace(/\s+/g, " ");
  const prose = relativePath.endsWith(".md");
  const contains = prose
    ? normalizedContent.toLowerCase().includes(normalizedExpected.toLowerCase())
    : normalizedContent.includes(normalizedExpected);
  if (!contains) failures.push(`${relativePath} must include ${expected}`);
}

function requireExactContent(relativePath, expected) {
  if (!readRelative(relativePath).includes(expected)) {
    failures.push(`${relativePath} must include the exact content ${expected}`);
  }
}

function requireOccurrenceCount(relativePath, expected, count) {
  const occurrences = readRelative(relativePath).split(expected).length - 1;
  if (occurrences !== count) {
    failures.push(`${relativePath} must include ${expected} exactly ${count} time(s)`);
  }
}

for (const relativePath of repositorySmokeRequiredFiles) {
  const fullPath = path.join(root, relativePath);
  if (!existsSync(fullPath)) {
    failures.push(`missing required file: ${relativePath}`);
    continue;
  }
  const stats = lstatSync(fullPath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    failures.push(`required file must be regular and non-symlink: ${relativePath}`);
  }
}

const activeFiles = listActiveFiles({ root });
const productLayout = discoverProductLayout({ repositoryRoot: root, relativePaths: activeFiles });
failures.push(...productLayout.findings);
failures.push(...portableContextContractFindings({ repositoryRoot: root }));

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
    "context:check",
    "context:clean",
    "context:index",
    "context:search",
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
  if (
    packageJson.scripts?.["repo:housekeeping"] !== "node scripts/goals/repository-housekeeping.mjs"
  ) {
    failures.push("repo:housekeeping must use the canonical repository housekeeping entry point");
  }
  if (!packageJson.scripts?.setup?.includes("node scripts/context/index-codebase.mjs --setup")) {
    failures.push("setup must materialize and validate the root context vector space");
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
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const hasLance = Boolean(dependencies["@lancedb/lancedb"]);
  const hasTransformers = Boolean(dependencies["@huggingface/transformers"]);
  if (hasLance !== hasTransformers) {
    failures.push("local retrieval dependencies must be installed or removed together");
  }
  if (
    packageJson.dependencies?.["@lancedb/lancedb"] ||
    packageJson.dependencies?.["@huggingface/transformers"]
  ) {
    failures.push("local retrieval packages belong in devDependencies");
  }
}

requireContent("scripts/context/index-codebase.mjs", "await verifyUsableIndex()");
requireContent("scripts/context/index-codebase.mjs", "Context vector space ready:");
requireContent("scripts/context/context-index-lib.mjs", "maintainIndexUnlocked()");
requireContent("scripts/context/context-maintenance.mjs", "maintainContextIndex");
requireContent("scripts/context/check-context-index.mjs", "inspectIndexStatus()");
requireContent("scripts/verify/image-assets.mjs", "listActiveFiles");
requireContent(".codex/hooks.json", "bash scripts/context/refresh-context-index-on-stop.sh");
requireContent("scripts/context/refresh-context-index-on-stop.sh", "mise exec --locked");
requireContent("scripts/context/refresh-context-index-on-stop.mjs", "ensureFreshIndex");
requireContent(
  "scripts/context/context-worker-output.mjs",
  "sanitizeMultilineForTerminal(output, repositoryRoot)",
);
requireContent("scripts/context/context-worker-output.mjs", 'stdio: "pipe"');
requireContent(
  "scripts/context/refresh-context-index-on-stop.mjs",
  "runAsSanitizedContextWorker(import.meta.url, { input: hookInput })",
);
requireContent("scripts/repository/source-inventory.mjs", "isRepositoryCodexHomePath");
requireContent("scripts/verify/format-project.mjs", "projectFormatFiles");
requireContent(
  "scripts/verify/adaptive-runner.mjs",
  "scripts/deps/dependency-owner-normalization.test.mjs",
);
requireContent("scripts/verify/adaptive-runner.mjs", "./workspace-verification.mjs");
requireContent("scripts/verify/adaptive-runner.mjs", "./verification-admission.mjs");
requireContent("scripts/verify/pre-push.sh", "verification-session-lock.mjs");

const validMiseFixture = '[tools]\nnode = "1.2.3"\npnpm = "4.5.6"\n';
if (validateMinimalMiseTools(validMiseFixture).errors.length > 0) {
  failures.push("minimal mise.toml validator must accept the intended structure");
}
const extensibleMiseFixture =
  '[tools]\nnode = "1.2.3"\npnpm = "4.5.6"\npython = "3.14.0"\ngo = "1.26.0"\n';
if (validateMinimalMiseTools(extensibleMiseFixture).errors.length > 0) {
  failures.push("minimal mise.toml validator must permit safe exact project-specific tool pins");
}
for (const [name, fixture] of Object.entries({
  "backend expression":
    '[tools]\nnode = "1.2.3"\npnpm = "4.5.6"\npython = "ubi:example/tool@3.14.0"\n',
  "duplicate key": '[tools]\nnode = "1.2.3"\nnode = "1.2.4"\npnpm = "4.5.6"\n',
  "environment section": '[tools]\nnode = "1.2.3"\npnpm = "4.5.6"\n[env]\nFLAG = "1"\n',
  "floating version": '[tools]\nnode = "1.2.3"\npnpm = "4.5.6"\npython = "latest"\n',
  "hook section": '[tools]\nnode = "1.2.3"\npnpm = "4.5.6"\n[hooks]\npostinstall = "true"\n',
  "key outside tools": 'node = "1.2.3"\n[tools]\npnpm = "4.5.6"\n',
})) {
  if (validateMinimalMiseTools(fixture).errors.length === 0) {
    failures.push(`minimal mise.toml validator must reject fixture: ${name}`);
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

if (miseVersions.node) {
  requireContent("scripts/setup/check-prereqs.sh", `required_node_version="${miseVersions.node}"`);
}
if (miseVersions.pnpm) {
  requireContent("scripts/setup/check-prereqs.sh", `required_pnpm_version="${miseVersions.pnpm}"`);
}
if (/corepack/iu.test(readRelative("scripts/setup/check-prereqs.sh"))) {
  failures.push("the local prerequisite check must not install or activate Corepack shims");
}
const sourceFramework = existsSync(
  path.join(root, ".agents/skills/create-project-from-framework/SKILL.md"),
);
for (const [filePath, expected] of repositorySmokeContentExpectations(supportedCodexStartCommand, {
  sourceFramework,
})) {
  requireContent(filePath, expected);
}
if (packageJson?.scripts?.["framework:reset"]) {
  requireContent("AGENTS.md", "Every `$reset-framework --apply` removes");
  requireContent("instructions.md", "Every framework reset removes");
  requireContent("docs/context-index.md", "Every framework reset removes");
  requireContent(".agents/skills/reset-framework/SKILL.md", "complete ignored `.context-index/`");
  requireContent(
    ".agents/skills/reset-framework/SKILL.md",
    "runtime identity required for the next session",
  );
  requireContent(
    ".agents/skills/reset-framework/scripts/reset-framework.mjs",
    "removeOwnedContextIndex",
  );
  requireContent(
    ".agents/skills/reset-framework/scripts/reset-framework.mjs",
    "repositoryCodexRuntimeDirectory",
  );
  requireContent("scripts/verify/source-baseline.mjs", "--verification-source-baseline");
}
const projectCreatorSkill = ".agents/skills/create-project-from-framework/SKILL.md";
if (existsSync(path.join(root, projectCreatorSkill))) {
  const projectCreatorSkillDirectory = projectCreatorSkill.slice(0, -"/SKILL.md".length);
  requireContent(
    projectCreatorSkill,
    "Stop hook then keeps changed sources current once per durable local Codex turn",
  );
  requireContent(projectCreatorSkill, "ephemeral side conversations");
  requireContent(projectCreatorSkill, "repository-local FSMonitor");
  requireContent(projectCreatorSkill, "root-owned Git metadata");
  requireContent(projectCreatorSkill, "hidden index flags");
  requireContent(projectCreatorSkill, "caller-selected stage path");
  requireContent(projectCreatorSkill, "complete selected-source transfer manifest");
  requireContent(
    `${projectCreatorSkillDirectory}/scripts/source-readiness.mjs`,
    "--portable-source-baseline",
  );
  requireContent(
    `${projectCreatorSkillDirectory}/scripts/create-project-from-framework.mjs`,
    "broad, realistic",
  );
  requireContent(projectCreatorSkill, "no relevant finding");
  requireContent(projectCreatorSkill, "fresh audit");
  requireContent(projectCreatorSkill, "only durable integration branch");
  requireContent(projectCreatorSkill, "every completed slice");
  requireContent(projectCreatorSkill, "without waiting for another prompt");
  requireContent(
    `${projectCreatorSkillDirectory}/scripts/create-project-from-framework.mjs`,
    "reviewable slices",
  );
  requireContent(
    `${projectCreatorSkillDirectory}/scripts/create-project-from-framework.mjs`,
    "fresh audit",
  );
  requireContent(
    `${projectCreatorSkillDirectory}/scripts/create-project-from-framework.mjs`,
    "assertGeneratedProjectParity",
  );
  requireContent(
    `${projectCreatorSkillDirectory}/scripts/generated-project-finalization.mjs`,
    "changed outside declared project-specific transformations",
  );
  requireContent("scripts/setup/project-creator-contract.source.test.mjs", "Project hooks never");
  requireContent(
    `${projectCreatorSkillDirectory}/scripts/source-git-state.mjs`,
    "isolatedGitArguments",
  );
  requireContent("scripts/setup/project-generator-state.test.mjs", "core.worktree");
  requireContent("scripts/setup/project-generator-state.test.mjs", "core.fsmonitor");
  requireContent(
    "scripts/setup/project-generator-state.test.mjs",
    "Git-less root nested below another repository",
  );
  if (hasContradictoryStopHookIndexContract(readRelative(projectCreatorSkill))) {
    failures.push(`${projectCreatorSkill}: contains a contradictory Stop-hook index contract`);
  }
}
for (const filePath of [
  "AGENTS.md",
  "README.md",
  "instructions.md",
  ".codex/README.md",
  "scripts/setup/check-prereqs.sh",
]) {
  requireExactContent(filePath, supportedCodexStartCommand);
}
for (const filePath of [
  "AGENTS.md",
  "README.md",
  "instructions.md",
  ".codex/README.md",
  "docs/project.md",
]) {
  if (
    /normal Codex home|user(?:'s)? Codex home|never redirects `?CODEX_HOME/iu.test(
      readRelative(filePath),
    )
  ) {
    failures.push(`${filePath}: contains the superseded global user-home contract`);
  }
}
if (existsSync(path.join(root, ".github/workflows/ci.yml"))) {
  const githubCi = readRelative(".github/workflows/ci.yml");
  requireContent(".github/workflows/ci.yml", `version: ${miseVersions.pnpm}`);
  requireContent(".github/workflows/ci.yml", `node-version: ${miseVersions.node}`);
  requireOccurrenceCount(
    ".github/workflows/ci.yml",
    "jdx/mise-action@7e36c90d9ab29c415a2384db3006f3ec8a8cc654 # v4.2.4",
    2,
  );
  requireOccurrenceCount(".github/workflows/ci.yml", "install: false", 2);
  requireOccurrenceCount(".github/workflows/ci.yml", "cache: false", 2);
  requireOccurrenceCount(
    ".github/workflows/ci.yml",
    "node scripts/deps/verify-pnpm-execution-policy.mjs",
    2,
  );
  for (const key of ["NPM_CONFIG_IGNORE_PNPMFILE", "PNPM_CONFIG_IGNORE_PNPMFILE"]) {
    requireContent(".github/workflows/ci.yml", `${key}: \"true\"`);
  }
  if (
    githubCi.indexOf("node scripts/deps/verify-pnpm-execution-policy.mjs") >
    githubCi.indexOf("pnpm/action-setup")
  ) {
    failures.push(".github/workflows/ci.yml must reject executable pnpm config before pnpm setup");
  }
}
if (existsSync(path.join(root, ".gitlab-ci.yml"))) {
  requireContent(".gitlab-ci.yml", `pnpm@${miseVersions.pnpm}`);
  requireContent(".gitlab-ci.yml", `node:${miseVersions.node}-bookworm`);
  requireContent(".gitlab-ci.yml", "ripgrep shellcheck");
  for (const misePackage of Object.values(compatibilityMatrix.ci.miseNpmPackages)) {
    requireContent(".gitlab-ci.yml", misePackage);
  }
  for (const integrity of Object.values(compatibilityMatrix.ci.miseNpmPackageIntegrities)) {
    requireContent(".gitlab-ci.yml", integrity);
  }
  requireContent(".gitlab-ci.yml", `\${mise_package}@${compatibilityMatrix.ci.miseVersion}`);
  requireContent(".gitlab-ci.yml", 'case "$(uname -m)" in');
  requireContent(".gitlab-ci.yml", "--verify-mise-archive");
  requireContent(
    ".gitlab-ci.yml",
    'npm install --global "$mise_archive" --ignore-scripts --offline',
  );
  requireContent(".gitlab-ci.yml", "--ignore-scripts");
  requireContent(".gitlab-ci.yml", "--ignore-pnpmfile");
  requireContent(".gitlab-ci.yml", 'NPM_CONFIG_IGNORE_PNPMFILE: "true"');
  requireContent(".gitlab-ci.yml", 'PNPM_CONFIG_IGNORE_PNPMFILE: "true"');
  requireContent(".gitlab-ci.yml", "node scripts/deps/verify-pnpm-execution-policy.mjs");
  if (/mise@latest/u.test(readRelative(".gitlab-ci.yml"))) {
    failures.push(".gitlab-ci.yml must not execute a floating mise installer");
  }
  if (/npm install --global "\$\{mise_package\}@/u.test(readRelative(".gitlab-ci.yml"))) {
    failures.push(".gitlab-ci.yml must install only the verified local mise archive");
  }
}
for (const runtimePath of ["mise.lock", "mise.toml"]) {
  const categories = classifyPath(runtimePath, { productLayout });
  if (
    !categories.includes("dependency/package manager files") ||
    !isFullRelevantPath(runtimePath, { productLayout })
  ) {
    failures.push(`${runtimePath} must remain a full-relevant dependency/package manager file`);
  }
}

const gitignore = existsSync(path.join(root, ".gitignore"))
  ? readFileSync(path.join(root, ".gitignore"), "utf8")
  : "";
for (const entry of [
  ...repositoryCodexHomeGitignorePatterns,
  ...portableCodexGitignorePatterns,
  ".context-index/",
  ".delivery/",
  "node_modules/",
  ".env",
]) {
  if (!gitignore.includes(entry)) failures.push(`.gitignore must include ${entry}`);
}

if (failures.length > 0) {
  console.error("Repository smoke check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Repository smoke check passed.");
