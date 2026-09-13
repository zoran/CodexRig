#!/usr/bin/env node
/** Owns automatic source-framework release version reconciliation against the published Git baseline. */
import { spawnSyncWithBoundedIo as spawnSync } from "../repository/runtime-process-io.mjs";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  compareSemver,
  frameworkContractPath,
  isReusableFrameworkSource,
  parseSemver,
  readFrameworkContract,
  validateFrameworkContract,
} from "../contracts/framework-contract.mjs";
import { toolingRoot, readRepositoryFile } from "../filesystem/repository-files.mjs";
import {
  cleanGitEnvironment,
  isolatedGitArguments,
  isolatedGitResultCompleted,
  resolveOwnedGitMetadata,
} from "../repository/git-runtime-isolation.mjs";
import { isExcludedActivePath, listActiveFiles } from "../repository/source-inventory.mjs";
import { formatContextError } from "../terminal/terminal-output.mjs";
import { readToolingConfiguration } from "../contracts/tooling-configuration.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const packagePath = "package.json";
const projectManifestPath = "docs/project.md";

export const frameworkVersionStartMarker = "<!-- codexrig:framework-version:start -->";
export const frameworkVersionEndMarker = "<!-- codexrig:framework-version:end -->";

const bumpPriority = Object.freeze({ none: 0, patch: 1, minor: 2, major: 3 });
const capabilityDeletionPattern =
  /^(?:\.agents\/skills\/|\.codex\/|\.codexrig\/|scripts\/|dependency-policy\.json$|mise\.(?:lock|toml)$|pnpm-workspace\.yaml$)/u;
const documentationOrTestPattern =
  /^(?:docs\/|README\.md$)|(?:^|\/)(?:[^/]+\.)?(?:test|spec)\.[^/]+$/u;

function parseJson(content, label) {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
}

function validateIncompatibleBaseline(contract, current) {
  if (
    !contract ||
    typeof contract !== "object" ||
    Array.isArray(contract) ||
    !Number.isSafeInteger(contract.schemaVersion) ||
    contract.schemaVersion < 1 ||
    contract.schemaVersion === current.schemaVersion ||
    contract.frameworkId !== current.frameworkId
  )
    throw new Error("Published incompatible framework baseline identity is invalid.");
  stableVersion(contract.frameworkVersion, "published frameworkVersion");
}

function stableVersion(value, label) {
  const parsed = parseSemver(value, label);
  if (parsed.prerelease || parsed.build) {
    throw new Error(
      `${label} must be a stable semantic version without prerelease/build metadata.`,
    );
  }
  return parsed;
}

function maxVersion(values) {
  return values.reduce((highest, candidate) =>
    compareSemver(candidate, highest) > 0 ? candidate : highest,
  );
}

export function nextFrameworkVersion(version, bump) {
  const parsed = stableVersion(version, "published frameworkVersion");
  if (!Object.hasOwn(bumpPriority, bump) || bump === "none") return parsed.raw;
  if (bump === "major") return `${parsed.major + 1}.0.0`;
  if (bump === "minor") return `${parsed.major}.${parsed.minor + 1}.0`;
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

function highestBump(left, right) {
  return bumpPriority[right] > bumpPriority[left] ? right : left;
}

function nulPaths(buffer) {
  return buffer
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((relativePath) => relativePath.replaceAll("\\", "/"));
}

function runGit({ args, gitMetadata, label, root, optional = false, timeoutMilliseconds }) {
  const invocationArguments = isolatedGitArguments({
    args,
    gitDirectory: gitMetadata.gitDirectory,
    workTree: gitMetadata.workTree,
  });
  const result = spawnSync("git", invocationArguments, {
    cwd: root,
    encoding: null,
    env: cleanGitEnvironment(),
    input: Buffer.alloc(0),
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: timeoutMilliseconds,
  });
  if (
    isolatedGitResultCompleted(result, {
      args: invocationArguments,
      encoding: null,
      maximumOutputBytes: 64 * 1024 * 1024,
    })
  ) {
    return result.stdout;
  }
  if (optional) return null;
  const detail = result.error?.message ?? result.stderr?.toString("utf8").trim() ?? "failed";
  throw new Error(`${label} failed${detail ? `: ${detail}` : ""}.`);
}

function baselineContent(
  root,
  gitMetadata,
  baselineCommit,
  relativePath,
  { optional = false } = {},
) {
  const output = runGit({
    args: ["show", `${baselineCommit}:${relativePath}`],
    gitMetadata,
    label: `Reading published ${relativePath}`,
    optional,
    root,
  });
  return output === null ? null : output.toString("utf8");
}

function changedSourcePaths(root, gitMetadata, baselineCommit) {
  const changedTracked = nulPaths(
    runGit({
      args: ["diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", baselineCommit, "--"],
      gitMetadata,
      label: "Framework change inventory",
      root,
    }),
  );
  const tracked = new Set(
    nulPaths(
      runGit({
        args: ["ls-files", "--cached", "-z"],
        gitMetadata,
        label: "Framework tracked-file inventory",
        root,
      }),
    ),
  );
  const untracked = listActiveFiles({ root }).filter((relativePath) => !tracked.has(relativePath));
  return [...new Set([...changedTracked, ...untracked])]
    .filter((relativePath) => !isExcludedActivePath(relativePath))
    .sort();
}

function gitText(options) {
  return runGit(options).toString("utf8").trim();
}

function localConfigValues(root, gitMetadata, key) {
  const output = runGit({
    args: ["config", "--null", "--local", "--get-all", key],
    gitMetadata,
    label: `Framework Git configuration ${key}`,
    optional: true,
    root,
  });
  if (output === null) return [];
  const encoded = output.toString("utf8");
  if (!encoded.endsWith("\0")) {
    throw new Error(`Framework Git configuration ${key} returned invalid output.`);
  }
  const values = encoded.split("\0");
  values.pop();
  return values;
}

function exactLocalConfigValue(root, gitMetadata, key, label) {
  const values = localConfigValues(root, gitMetadata, key);
  if (
    values.length !== 1 ||
    !values[0] ||
    values[0] !== values[0].trim() ||
    /[\0\r\n]/u.test(values[0])
  ) {
    throw new Error(`${label} must have exactly one local Git configuration value.`);
  }
  return values[0];
}

function remoteBranchCommit(root, gitMetadata, remoteName, integrationBranch) {
  const remoteReference = `refs/heads/${integrationBranch}`;
  const output = gitText({
    args: ["ls-remote", "--exit-code", "--refs", "--", remoteName, remoteReference],
    gitMetadata,
    label: "Published framework remote query",
    root,
    timeoutMilliseconds: 30_000,
  });
  const lines = output.split(/\r?\n/u).filter(Boolean);
  if (lines.length !== 1) {
    throw new Error("Published framework remote query returned an ambiguous branch identity.");
  }
  const match = /^([0-9a-f]{40}|[0-9a-f]{64})\t([^\0\r\n]+)$/u.exec(lines[0]);
  if (!match || match[2] !== remoteReference) {
    throw new Error("Published framework remote query returned an invalid branch identity.");
  }
  return match[1];
}

function publishedBaseline(root, gitMetadata, integrationBranch) {
  const localBranch = gitText({
    args: ["symbolic-ref", "--quiet", "HEAD"],
    gitMetadata,
    label: "Framework integration branch",
    root,
  });
  const expectedLocalBranch = `refs/heads/${integrationBranch}`;
  if (localBranch !== expectedLocalBranch) {
    throw new Error(
      `Automatic framework versioning must run on the configured integration branch ${integrationBranch}.`,
    );
  }
  const remoteName = exactLocalConfigValue(
    root,
    gitMetadata,
    `branch.${integrationBranch}.remote`,
    `Configured integration branch ${integrationBranch} remote`,
  );
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(remoteName) ||
    remoteName === "." ||
    remoteName.includes("..") ||
    remoteName.includes("//") ||
    remoteName.endsWith("/")
  ) {
    throw new Error(`Configured integration branch ${integrationBranch} remote is invalid.`);
  }
  const mergeReference = exactLocalConfigValue(
    root,
    gitMetadata,
    `branch.${integrationBranch}.merge`,
    `Configured integration branch ${integrationBranch} merge reference`,
  );
  if (mergeReference !== `refs/heads/${integrationBranch}`) {
    throw new Error(
      `Configured integration branch ${integrationBranch} must merge its central remote branch.`,
    );
  }
  exactLocalConfigValue(
    root,
    gitMetadata,
    `remote.${remoteName}.url`,
    `Configured central remote ${remoteName} URL`,
  );
  const upstreamReference = gitText({
    args: ["rev-parse", "--symbolic-full-name", "@{upstream}"],
    gitMetadata,
    label: "Published framework upstream",
    root,
  });
  const expectedUpstreamReference = `refs/remotes/${remoteName}/${integrationBranch}`;
  if (upstreamReference !== expectedUpstreamReference) {
    throw new Error(
      `Configured integration branch ${integrationBranch} must track its central remote branch.`,
    );
  }
  const commit = gitText({
    args: ["rev-parse", "--verify", `${upstreamReference}^{commit}`],
    gitMetadata,
    label: "Published framework upstream commit",
    root,
  });
  const observedRemoteCommit = remoteBranchCommit(root, gitMetadata, remoteName, integrationBranch);
  if (observedRemoteCommit !== commit) {
    throw new Error(
      `The local ${upstreamReference} publication baseline is stale; fetch ${remoteName} before version reconciliation.`,
    );
  }
  const isAncestor = runGit({
    args: ["merge-base", "--is-ancestor", commit, "HEAD"],
    gitMetadata,
    label: "Published framework ancestry",
    optional: true,
    root,
  });
  if (isAncestor === null) {
    throw new Error(
      "The locally observed central upstream is not an ancestor of HEAD; refresh and integrate main before version reconciliation.",
    );
  }
  return Object.freeze({ commit, upstreamReference });
}

function normalizedContract(contract) {
  return { ...structuredClone(contract), frameworkVersion: "<framework-version>" };
}

function normalizedPackage(packageJson) {
  return { ...structuredClone(packageJson), version: "<framework-version>" };
}

function normalizedManifest(content) {
  return content.replace(
    new RegExp(`${frameworkVersionStartMarker}[\\s\\S]*?${frameworkVersionEndMarker}`, "u"),
    "<framework-version-block>",
  );
}

function frameworkVersionBlock(version, schemaVersion) {
  return `${frameworkVersionStartMarker}\n\n- Framework version: \`${version}\`.\n- Framework contract schema: \`${schemaVersion}\`.\n\n${frameworkVersionEndMarker}`;
}

export function projectManifestWithFrameworkVersion(content, version, schemaVersion) {
  const block = frameworkVersionBlock(version, schemaVersion);
  const startCount = content.split(frameworkVersionStartMarker).length - 1;
  const endCount = content.split(frameworkVersionEndMarker).length - 1;
  if (startCount !== endCount || startCount > 1) {
    throw new Error(
      `${projectManifestPath} must contain at most one complete source-framework version block.`,
    );
  }
  const markedPattern = new RegExp(
    `${frameworkVersionStartMarker}[\\s\\S]*?${frameworkVersionEndMarker}`,
    "u",
  );
  if (startCount === 1 && markedPattern.test(content)) return content.replace(markedPattern, block);
  throw new Error(
    `${projectManifestPath} is missing its bounded source-framework version block; refusing an ambiguous rewrite.`,
  );
}

function removedEntries(before, after) {
  const current = new Set(Array.isArray(after) ? after : []);
  return (Array.isArray(before) ? before : []).filter((entry) => !current.has(entry));
}

function contractBump(baseline, current) {
  if (JSON.stringify(normalizedContract(baseline)) === JSON.stringify(normalizedContract(current)))
    return "none";
  return baseline.schemaVersion !== current.schemaVersion ||
    baseline.frameworkId !== current.frameworkId ||
    baseline.compatibilityFile !== current.compatibilityFile ||
    baseline.projectToolsFile !== current.projectToolsFile
    ? "major"
    : "minor";
}

function packageBump(baseline, current) {
  if (JSON.stringify(normalizedPackage(baseline)) === JSON.stringify(normalizedPackage(current))) {
    return "none";
  }
  if (
    baseline.name !== current.name ||
    baseline.type !== current.type ||
    removedEntries(Object.keys(baseline.scripts ?? {}), Object.keys(current.scripts ?? {})).length >
      0
  ) {
    return "major";
  }
  return "minor";
}

function requiredChangeBump({
  baselineContract,
  baselineManifest,
  baselinePackage,
  changedPaths,
  currentContract,
  currentManifest,
  currentPackage,
  root,
}) {
  let bump = "none";
  const handled = new Set([frameworkContractPath, packagePath, projectManifestPath]);
  if (changedPaths.includes(frameworkContractPath)) {
    bump = highestBump(bump, contractBump(baselineContract, currentContract));
  }
  if (changedPaths.includes(packagePath)) {
    bump = highestBump(bump, packageBump(baselinePackage, currentPackage));
  }
  if (
    changedPaths.includes(projectManifestPath) &&
    normalizedManifest(baselineManifest) !== normalizedManifest(currentManifest)
  ) {
    bump = highestBump(bump, "patch");
  }

  for (const relativePath of changedPaths) {
    if (handled.has(relativePath)) continue;
    const deleted = !existsSync(path.join(root, ...relativePath.split("/")));
    if (documentationOrTestPattern.test(relativePath)) {
      bump = highestBump(bump, "patch");
    } else if (deleted && capabilityDeletionPattern.test(relativePath)) {
      bump = highestBump(bump, "major");
    } else {
      bump = highestBump(bump, "minor");
    }
  }
  return bump;
}

function plannedWrite(root, relativePath, after) {
  const before = readRepositoryFile(root, relativePath);
  return before === after ? null : Object.freeze({ after, before, relativePath });
}

function jsonStringFieldWithValue(content, field, value, label) {
  const pattern = new RegExp(`^(\\s*"${field}"\\s*:\\s*)"[^"]*"(,?\\s*)$`, "gmu");
  const matches = [...content.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`${label} must contain exactly one top-level ${field} field.`);
  }
  return content.replace(pattern, `$1${JSON.stringify(value)}$2`);
}

export function frameworkVersionReconciliationPlan({ root = repositoryRoot } = {}) {
  if (!isReusableFrameworkSource(root)) {
    return Object.freeze({
      applicable: false,
      baselineCommit: null,
      baselineReference: null,
      baselineVersion: null,
      blockingFindings: Object.freeze([]),
      changedPaths: Object.freeze([]),
      driftFindings: Object.freeze([]),
      minimumVersion: null,
      requiredBump: "none",
      targetVersion: null,
      writes: Object.freeze([]),
    });
  }

  const gitMetadata = resolveOwnedGitMetadata(root);
  if (!gitMetadata) {
    throw new Error(
      "Automatic framework versioning requires an owned Git worktree and central upstream.",
    );
  }
  const currentContract = readFrameworkContract(root);
  const integrationBranch = readToolingConfiguration(root).platform.integrationBranch;
  if (typeof integrationBranch !== "string" || !/^[A-Za-z0-9._/-]+$/u.test(integrationBranch)) {
    throw new Error("Framework contract must define a valid platform integrationBranch.");
  }
  runGit({
    args: ["rev-parse", "--verify", "HEAD^{commit}"],
    gitMetadata,
    label: "Published framework baseline",
    root,
  });
  const baseline = publishedBaseline(root, gitMetadata, integrationBranch);

  const baselineContractContent = baselineContent(
    root,
    gitMetadata,
    baseline.commit,
    frameworkContractPath,
  );
  const baselinePackageContent = baselineContent(root, gitMetadata, baseline.commit, packagePath);
  const baselineManifest = baselineContent(root, gitMetadata, baseline.commit, projectManifestPath);
  const baselineContract = parseJson(baselineContractContent, "Published framework contract");
  if (baselineContract.schemaVersion === currentContract.schemaVersion)
    validateFrameworkContract(baselineContract);
  else validateIncompatibleBaseline(baselineContract, currentContract);
  const baselinePackage = parseJson(baselinePackageContent, "Published package manifest");
  const baselineVersion = stableVersion(
    baselineContract.frameworkVersion,
    "published frameworkVersion",
  ).raw;
  const baselinePackageVersion = stableVersion(
    baselinePackage.version,
    "published package version",
  ).raw;
  if (baselinePackageVersion !== baselineVersion) {
    throw new Error(
      `Published package version ${baselinePackageVersion} does not match frameworkVersion ${baselineVersion}.`,
    );
  }

  const currentPackageContent = readRepositoryFile(root, packagePath);
  const currentManifest = readRepositoryFile(root, projectManifestPath);
  const currentPackage = parseJson(currentPackageContent, "Current package manifest");
  const currentContractVersion = stableVersion(
    currentContract.frameworkVersion,
    "current frameworkVersion",
  ).raw;
  const currentPackageVersion = stableVersion(
    currentPackage.version,
    "current package version",
  ).raw;
  const changedPaths = changedSourcePaths(root, gitMetadata, baseline.commit);
  const requiredBump = requiredChangeBump({
    baselineContract,
    baselineManifest,
    baselinePackage,
    changedPaths,
    currentContract,
    currentManifest,
    currentPackage,
    root,
  });
  const minimumVersion = nextFrameworkVersion(baselineVersion, requiredBump);
  const targetVersion = maxVersion([
    baselineVersion,
    minimumVersion,
    currentContractVersion,
    currentPackageVersion,
  ]);
  const currentContractContent = readRepositoryFile(root, frameworkContractPath);
  const nextContractContent = jsonStringFieldWithValue(
    currentContractContent,
    "frameworkVersion",
    targetVersion,
    "Current framework contract",
  );
  const nextPackageContent = jsonStringFieldWithValue(
    currentPackageContent,
    "version",
    targetVersion,
    "Current package manifest",
  );
  const nextManifest = projectManifestWithFrameworkVersion(
    currentManifest,
    targetVersion,
    currentContract.schemaVersion,
  );
  const writes = [
    plannedWrite(root, frameworkContractPath, nextContractContent),
    plannedWrite(root, packagePath, nextPackageContent),
    plannedWrite(root, projectManifestPath, nextManifest),
  ].filter(Boolean);
  const driftFindings = [];
  if (requiredBump !== "none" && compareSemver(currentContractVersion, minimumVersion) < 0) {
    driftFindings.push(
      `Framework changes since ${baselineVersion} require at least a ${requiredBump} release (${minimumVersion}).`,
    );
  }
  if (currentContractVersion !== currentPackageVersion) {
    driftFindings.push(
      `Framework contract ${currentContractVersion} and package ${currentPackageVersion} are not synchronized.`,
    );
  }
  if (writes.length > 0 && driftFindings.length === 0) {
    driftFindings.push(
      `Framework release metadata must be reconciled atomically to ${targetVersion}.`,
    );
  }

  return Object.freeze({
    applicable: true,
    baselineCommit: baseline.commit,
    baselineReference: baseline.upstreamReference,
    baselineVersion,
    blockingFindings: Object.freeze([]),
    changedPaths: Object.freeze(changedPaths),
    driftFindings: Object.freeze(driftFindings),
    minimumVersion,
    requiredBump,
    targetVersion,
    writes: Object.freeze(writes),
  });
}

function usage() {
  return `Usage: pnpm framework:version [-- --check]\n\nReports the deterministic source-framework SemVer plan. Goal housekeeping --apply owns writes.\nGenerated products retain their independent package/product version.`;
}

async function main() {
  const argumentsWithoutDelimiter = process.argv.slice(2).filter((argument) => argument !== "--");
  if (argumentsWithoutDelimiter.some((argument) => argument === "--help" || argument === "-h")) {
    console.log(usage());
    return;
  }
  const unknown = argumentsWithoutDelimiter.find((argument) => argument !== "--check");
  if (unknown) throw new Error(`Unknown framework version option: ${unknown}`);
  const plan = frameworkVersionReconciliationPlan({ root: toolingRoot });
  if (!plan.applicable) {
    console.log("Source release versioning is not applicable in this repository.");
    return;
  }
  console.log(
    `Framework version plan: ${plan.baselineVersion} -> ${plan.targetVersion} (${plan.requiredBump}; ${plan.changedPaths.length} changed active paths).`,
  );
  if (plan.writes.length > 0) {
    console.log(
      `Pending atomic metadata writes: ${plan.writes.map((write) => write.relativePath).join(", ")}.`,
    );
  }
  if (argumentsWithoutDelimiter.includes("--check") && plan.driftFindings.length > 0) {
    throw new Error(plan.driftFindings.join("\n"));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Framework version check failed: ${formatContextError(error, repositoryRoot)}`);
    process.exitCode = 1;
  });
}
