import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { portableContextContractFiles } from "../context/portable-context-contract.mjs";
import { repositoryRoot } from "../repository/source-inventory.mjs";
import { stageProjectExport } from "./stage-project-export.mjs";

const temporaryRoots = [];

function temporaryRoot(prefix) {
  const value = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(value);
  return value;
}

function createStage(prefix) {
  const stage = path.join(temporaryRoot(prefix), "stage");
  stageProjectExport({ includeUntracked: true, sourceRoot: repositoryRoot, targetRoot: stage });
  for (const relativePath of portableContextContractFiles) {
    const target = path.join(stage, relativePath);
    if (existsSync(target)) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(repositoryRoot, relativePath), target);
  }
  return stage;
}

function runValidator(stage, args = []) {
  return spawnSync(
    process.execPath,
    [path.join(stage, "scripts/setup/validate-staged-project.mjs"), ...args],
    {
      cwd: stage,
      encoding: "utf8",
      env: process.env,
      input: "",
      stdio: "pipe",
    },
  );
}

after(() => {
  for (const root of temporaryRoots) rmSync(root, { force: true, recursive: true });
});

test("the copied stage is the authoritative secret-scan boundary", () => {
  const stage = createStage("staged-validator-secret-");
  appendFileSync(path.join(stage, "README.md"), `${["sk-", "a".repeat(24)].join("")}\n`);

  const result = runValidator(stage);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /potential secret material/i);
});

test("the staged validator rejects caller-selected roots and unsafe validator identity", () => {
  const stage = createStage("staged-validator-owned-");
  const decoy = temporaryRoot("caller-selected-stage-");
  const redirected = runValidator(stage, [decoy]);
  assert.equal(redirected.status, 1);
  assert.match(redirected.stderr, /Usage: node scripts\/setup\/validate-staged-project\.mjs/);
  assert.equal(`${redirected.stdout}${redirected.stderr}`.includes(stage), false);
  assert.equal(`${redirected.stdout}${redirected.stderr}`.includes(decoy), false);

  const validator = path.join(stage, "scripts/setup/validate-staged-project.mjs");
  const hardlink = path.join(stage, "validator-hardlink.mjs");
  linkSync(validator, hardlink);
  const unsafeIdentity = runValidator(stage);
  assert.equal(unsafeIdentity.status, 1);
  assert.match(unsafeIdentity.stderr, /validator is not safely bound/i);
  assert.equal(`${unsafeIdentity.stdout}${unsafeIdentity.stderr}`.includes(stage), false);
  rmSync(hardlink);

  const valid = runValidator(stage);
  assert.equal(valid.status, 0, valid.stderr);
});

test("portable snapshots reject process state and a missing lockfile", () => {
  const source = createStage("staged-validator-process-source-");
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: source }).status, 0);
  const contextPath = path.join(source, "docs", "project-context.md");
  writeFileSync(contextPath, "# Temporary task context\n", "utf8");
  assert.equal(spawnSync("git", ["add", "-A"], { cwd: source }).status, 0);
  const rejectedTarget = path.join(temporaryRoot("staged-validator-process-target-"), "stage");
  assert.throws(
    () => stageProjectExport({ sourceRoot: source, targetRoot: rejectedTarget }),
    /docs\/project-context\.md.*temporary project context/u,
  );
  assert.equal(existsSync(rejectedTarget), false);

  rmSync(path.join(source, ".git"), { force: true, recursive: true });
  rmSync(contextPath);
  rmSync(path.join(source, "pnpm-lock.yaml"));
  const missingLock = runValidator(source);
  assert.equal(missingLock.status, 1);
  assert.match(missingLock.stderr, /missing required portable contract: pnpm-lock\.yaml/u);
});
