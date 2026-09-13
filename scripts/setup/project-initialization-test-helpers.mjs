/** Owns project initialization test helpers behavior for the setup, launch, and portable project boundary. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertGeneratedProjectParity } from "../../scripts/framework/generated-project-finalization.mjs";
import { capturePortableProjectTransferManifest } from "../../scripts/framework/project-copy.mjs";
import { copyPortableSetupFixture } from "./setup-regression-test-helpers.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const temporaryRoots = [];

export function temporaryRoot(prefix) {
  const value = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(value);
  return value;
}

export function cleanupTemporaryRoots() {
  for (const temporaryRootPath of temporaryRoots.splice(0)) {
    rmSync(temporaryRootPath, { force: true, recursive: true });
  }
}

export function isolatedTrackedFrameworkSource(prefix) {
  const sourceParent = temporaryRoot(prefix);
  const source = path.join(sourceParent, "source");
  copyPortableSetupFixture(source);
  initializeTrackedSource(source);
  return source;
}

export function readdirNames(directory) {
  return readdirSync(directory).sort();
}

export function textFiles(directory) {
  const files = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolutePath);
      else if (entry.isFile()) files.push(absolutePath);
    }
  }
  return files;
}

export function initializeTrackedSource(sourceRoot) {
  const initialized = spawnSync("git", ["init", "-q"], {
    cwd: sourceRoot,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  const added = spawnSync("git", ["add", "-A"], {
    cwd: sourceRoot,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
  });
  assert.equal(added.status, 0, added.stderr);
  const modulesRoot = path.join(sourceRoot, "node_modules");
  mkdirSync(modulesRoot, { recursive: true });
  symlinkSync(
    path.join(root, "node_modules", "prettier"),
    path.join(modulesRoot, "prettier"),
    "dir",
  );
}

export function runProjectGenerator(args) {
  const script = path.join(root, "scripts/framework/create-project-from-framework.mjs");
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
    timeout: 30_000,
  });
}

export function gitState(sourceRoot, { includeIgnored = true } = {}) {
  const argumentsList = ["status", "--porcelain=v1", "-z", "--untracked-files=all"];
  if (includeIgnored) argumentsList.push("--ignored=matching");
  const result = spawnSync("git", argumentsList, {
    cwd: sourceRoot,
    encoding: null,
    input: Buffer.alloc(0),
    stdio: "pipe",
  });
  assert.equal(result.status, 0, result.stderr?.toString("utf8"));
  return result.stdout;
}

export function provideGeneratedDependenciesForTest(targetRoot) {
  const sourceModules = path.join(root, "node_modules");
  const targetModules = path.join(targetRoot, "node_modules");
  assert.equal(existsSync(targetModules), false, "generated project inherited node_modules");
  const sourceStats = lstatSync(sourceModules);
  assert.equal(sourceStats.isDirectory() && !sourceStats.isSymbolicLink(), true);
  mkdirSync(targetModules);
  for (const entry of readdirSync(sourceModules, { withFileTypes: true })) {
    const sourceEntry = path.join(sourceModules, entry.name);
    const targetEntry = path.join(targetModules, entry.name);
    if (entry.isFile()) {
      copyFileSync(sourceEntry, targetEntry);
      continue;
    }
    const targetType = process.platform === "win32" ? "junction" : "dir";
    symlinkSync(sourceEntry, targetEntry, targetType);
  }
  const packageJson = JSON.parse(readFileSync(path.join(targetRoot, "package.json"), "utf8"));
  const workspaceStatePath = path.join(targetModules, ".pnpm-workspace-state-v1.json");
  const workspaceState = JSON.parse(readFileSync(workspaceStatePath, "utf8"));
  workspaceState.lastValidatedTimestamp = Date.now();
  workspaceState.projects = {
    [targetRoot]: {
      name: packageJson.name,
      version: packageJson.version,
    },
  };
  writeFileSync(workspaceStatePath, `${JSON.stringify(workspaceState, null, 2)}\n`, "utf8");
}

export function assertGeneratedTransferParityContract(source, generated) {
  const transferManifest = capturePortableProjectTransferManifest(source, {
    includeUntracked: true,
  });
  assertGeneratedProjectParity({
    sourceRoot: source,
    targetRoot: generated,
    transferManifest,
  });

  const reusablePath = "scripts/docs/project-document-policy.mjs";
  const generatedReusablePath = path.join(generated, reusablePath);
  const original = readFileSync(generatedReusablePath, "utf8");
  try {
    writeFileSync(generatedReusablePath, `${original}\n// undeclared generated mutation\n`, "utf8");
    assert.throws(
      () =>
        assertGeneratedProjectParity({
          sourceRoot: source,
          targetRoot: generated,
          transferManifest,
        }),
      /reusable files changed outside declared project-specific transformations/,
    );
    rmSync(generatedReusablePath);
    assert.throws(
      () =>
        assertGeneratedProjectParity({
          sourceRoot: source,
          targetRoot: generated,
          transferManifest,
        }),
      /transfer parity failed \(missing: scripts\/docs\/project-document-policy\.mjs\)/,
    );
  } finally {
    writeFileSync(generatedReusablePath, original, "utf8");
  }

  const packagePath = path.join(generated, "package.json");
  const originalPackage = readFileSync(packagePath, "utf8");
  try {
    const changedPackage = JSON.parse(originalPackage);
    delete changedPackage.scripts["handover:receive"];
    writeFileSync(packagePath, `${JSON.stringify(changedPackage, null, 2)}\n`, "utf8");
    assert.throws(
      () =>
        assertGeneratedProjectParity({
          sourceRoot: source,
          targetRoot: generated,
          transferManifest,
        }),
      /Generated package exceeds the declared identity and source-publication transformation/,
    );
  } finally {
    writeFileSync(packagePath, originalPackage, "utf8");
  }
  assertGeneratedProjectParity({
    sourceRoot: source,
    targetRoot: generated,
    transferManifest,
  });
}

export function assertGeneratedProjectQuality(targetRoot) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const args of [
    ["scripts/verify/docs.mjs"],
    ["scripts/verify/verification-entrypoints.mjs"],
    ["--test", "scripts/setup/runtime-safety.test.mjs"],
  ]) {
    const result = spawnSync(process.execPath, args, {
      cwd: targetRoot,
      env,
      encoding: "utf8",
      input: "",
      stdio: "pipe",
      timeout: 30_000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
}
