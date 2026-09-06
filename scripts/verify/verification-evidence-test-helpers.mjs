/** Owns verification evidence test helpers behavior for the repository verification boundary. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  currentVerificationEvidenceInputs,
  readSuccessfulVerificationBasis,
  recordSuccessfulFullEvidence,
  refreshExactAttestationAfterPreflight,
  validateExactCurrentEvidence,
  verificationEvidenceCachePath,
} from "./verification-evidence.mjs";
import { captureVerificationGitBasis } from "./verification-git-basis.mjs";
import { acquireVerificationSessionLock } from "./verification-session-lock.mjs";

const temporaryRoots = [];

export const runtimeIdentity = Object.freeze({
  arch: "fixture-arch",
  environment: "a".repeat(64),
  executables: "b".repeat(64),
  mise: "c".repeat(64),
  node: "fixture-node",
  platform: "fixture-platform",
  pnpm: "d".repeat(64),
});

export const broadPlan = Object.freeze([
  {
    args: ["--test", "src/product.test.mjs"],
    executable: "node",
    key: "product-regressions",
    phase: "broad",
  },
  {
    args: ["--recursive", "run", "build"],
    executable: "pnpm",
    key: "workspace:build",
    phase: "workspace-build",
  },
]);

export function cleanupTemporaryEvidenceRoots() {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
}

export function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "verification-evidence-"));
  temporaryRoots.push(root);
  for (const [relativePath, content] of [
    [
      ".gitignore",
      ["/.codex/runtime/", "/cache", "/.delivery/", "/node_modules", "/tmp", "/logs", ""].join(
        "\n",
      ),
    ],
    ["AGENTS.md", "# Agent bootstrap\n"],
    ["README.md", "# Fixture\n"],
    ["docs/project.md", "# Project\n"],
    ["instructions.md", "# Instructions\n"],
    ["mise.lock", "fixture lock\n"],
    ["mise.toml", '[tools]\nnode = "fixture"\npnpm = "fixture"\n'],
    ["package.json", '{"name":"evidence-fixture","private":true}\n'],
    ["pnpm-lock.yaml", "lockfileVersion: '9.0'\n"],
    ["scripts/verify/adaptive.mjs", "export const fixture = true;\n"],
    ["scripts/verify/format-project.mjs", "export const formatter = true;\n"],
    ["src/product.mjs", "export const product = 1;\n"],
  ]) {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  }
  for (const args of [
    ["init", "-q"],
    ["config", "user.name", "Verification Fixture"],
    ["config", "user.email", "verification@example.invalid"],
    ["add", "."],
    ["commit", "-qm", "fixture basis"],
  ]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
    assert.equal(result.status, 0, result.stderr);
  }
  return root;
}

export function inputs(root, options = {}) {
  return currentVerificationEvidenceInputs({
    root,
    broadPlan: options.broadPlan ?? broadPlan,
    runtimeIdentity: options.runtimeIdentity ?? runtimeIdentity,
    deliveryEnvironment: options.deliveryEnvironment ?? "dev",
    artifactManifest: options.artifactManifest ?? "",
  });
}

export function record(root, evidencePlan = broadPlan) {
  const expectedInputs = inputs(root, { broadPlan: evidencePlan });
  const expectedGitBasis = captureVerificationGitBasis({ repositoryRoot: root });
  const lock = acquireVerificationSessionLock({ repositoryRoot: root });
  try {
    return recordSuccessfulFullEvidence({
      root,
      broadPlan: evidencePlan,
      expectedGitBasis,
      expectedInputs,
      runtimeIdentity,
      successfulCommandKeys: evidencePlan.map((command) => command.key),
    });
  } finally {
    lock.release();
  }
}

export function refresh(root, expectedInputs = inputs(root), options = {}) {
  const basis = readSuccessfulVerificationBasis({ broadPlan, root });
  const expectedGitBasis = captureVerificationGitBasis({ repositoryRoot: root });
  const paths = options.paths ?? expectedGitBasis.dirtyPaths;
  const ownerKey = options.ownerKey ?? broadPlan[0].key;
  const lock = acquireVerificationSessionLock({ repositoryRoot: root });
  try {
    return refreshExactAttestationAfterPreflight({
      root,
      broadPlan,
      coverage: {
        basisChanged: options.basisChanged ?? true,
        broadRisks: options.broadRisks ?? [],
        complete: true,
        focusedCommandOwners:
          options.focusedCommandOwners ??
          paths.map((changedPath) => ({ ownerKeys: [ownerKey], path: changedPath })),
        paths,
      },
      expectedBasisToken: basis.token,
      expectedGitBasis,
      expectedInputs,
      runtimeIdentity,
      successfulCommandKeys: options.successfulCommandKeys ?? [ownerKey],
    });
  } finally {
    lock.release();
  }
}

export function validate(root, options = {}) {
  return validateExactCurrentEvidence({
    root,
    broadPlan: options.broadPlan ?? broadPlan,
    runtimeIdentity: options.runtimeIdentity ?? runtimeIdentity,
    deliveryEnvironment: options.deliveryEnvironment ?? "dev",
    artifactManifest: options.artifactManifest ?? "",
  });
}

function fileDigest(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function configureDeliveryFixture(root, targetEnvironment) {
  assert.ok(["staging", "prod"].includes(targetEnvironment));
  const deliveryContent = `${JSON.stringify(
    {
      schemaVersion: 1,
      defaultTarget: "dev",
      declaredTargets: [targetEnvironment],
      detectedTargets: [],
    },
    null,
    2,
  )}\n`;
  const targetConfigurationPath = `deploy/${targetEnvironment}.json`;
  const targetConfigurationContent = `${JSON.stringify({ target: targetEnvironment })}\n`;
  const packagePath = path.join(root, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  packageJson.scripts = {
    ...(packageJson.scripts ?? {}),
    [`verify:${targetEnvironment}`]: 'node --eval "process.exit(0)"',
  };
  for (const [relativePath, content] of [
    ["config/delivery.json", deliveryContent],
    [targetConfigurationPath, targetConfigurationContent],
    ["package.json", `${JSON.stringify(packageJson)}\n`],
  ]) {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  }
  for (const args of [
    ["add", "."],
    ["commit", "-qm", `configure ${targetEnvironment}`],
  ]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
    assert.equal(result.status, 0, result.stderr);
  }
  const revision = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  }).stdout.trim();
  const artifactPath = `.delivery/${targetEnvironment}/application.bin`;
  const artifactContent = Buffer.from(`immutable ${targetEnvironment} artifact\n`);
  const artifactManifest = `.delivery/${targetEnvironment}/manifest.json`;
  const artifactAbsolute = path.join(root, ...artifactPath.split("/"));
  mkdirSync(path.dirname(artifactAbsolute), { recursive: true });
  writeFileSync(artifactAbsolute, artifactContent);
  writeFileSync(
    path.join(root, ...artifactManifest.split("/")),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        targetEnvironment,
        sourceCommit: revision,
        artifactFiles: [{ path: artifactPath, sha256: fileDigest(artifactContent) }],
        configurationFiles: [
          { path: "config/delivery.json", sha256: fileDigest(deliveryContent) },
          { path: targetConfigurationPath, sha256: fileDigest(targetConfigurationContent) },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { artifactManifest, artifactPath, targetConfigurationPath };
}

export function overwriteEvidence(root, content) {
  const evidencePath = verificationEvidenceCachePath(root);
  writeFileSync(evidencePath, content, { encoding: "utf8", mode: 0o600 });
  chmodSync(evidencePath, 0o600);
}
