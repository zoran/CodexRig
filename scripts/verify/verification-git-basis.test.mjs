import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  captureVerificationGitBasis,
  changedPathsSinceVerificationBasis,
  rootManifestChangeIsVerifyOnly,
} from "./verification-git-basis.mjs";

function git(repositoryRoot, ...args) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function write(repositoryRoot, relativePath, content) {
  const absolutePath = path.join(repositoryRoot, ...relativePath.split("/"));
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

function fixture(t) {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "verification-git-basis-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  git(repositoryRoot, "init", "-q");
  git(repositoryRoot, "config", "user.name", "Verification Fixture");
  git(repositoryRoot, "config", "user.email", "verification@example.invalid");
  write(
    repositoryRoot,
    "package.json",
    `${JSON.stringify({
      name: "fixture",
      private: true,
      scripts: {
        test: "node --test",
        verify: "node scripts/verify/adaptive.mjs --mode full",
        "verify:changed": "node scripts/verify/adaptive.mjs --mode repo",
      },
    })}\n`,
  );
  write(repositoryRoot, "src/product.mjs", "export const product = 1;\n");
  git(repositoryRoot, "add", ".");
  git(repositoryRoot, "commit", "-qm", "basis A");
  return repositoryRoot;
}

test("delta retains a formerly untracked path after it is deleted", (t) => {
  const repositoryRoot = fixture(t);
  write(repositoryRoot, "src/temporary-owner.mjs", "export const temporary = true;\n");
  const basis = captureVerificationGitBasis({ repositoryRoot });
  assert.deepEqual(basis.dirtyPaths, ["src/temporary-owner.mjs"]);

  unlinkSync(path.join(repositoryRoot, "src/temporary-owner.mjs"));
  write(repositoryRoot, "src/product.mjs", "export const product = 2;\n");
  const delta = changedPathsSinceVerificationBasis(basis, { repositoryRoot });

  assert.equal(delta.incomplete, false);
  assert.deepEqual(delta.paths, ["src/product.mjs", "src/temporary-owner.mjs"]);
});

test("commit delta is derived from the successful basis rather than the current upstream", (t) => {
  const repositoryRoot = fixture(t);
  const basis = captureVerificationGitBasis({ repositoryRoot });
  write(repositoryRoot, "package.json", '{"name":"fixture","private":true,"type":"module"}\n');
  git(repositoryRoot, "add", "package.json");
  git(repositoryRoot, "commit", "-qm", "manifest B");
  write(repositoryRoot, "scripts/verify/helper.mjs", "export const helper = true;\n");

  const delta = changedPathsSinceVerificationBasis(basis, { repositoryRoot });
  assert.equal(delta.incomplete, false);
  assert.deepEqual(delta.paths, ["package.json", "scripts/verify/helper.mjs"]);
});

test("verify-only root manifest exception requires a clean complete evidence basis", (t) => {
  const repositoryRoot = fixture(t);
  const basis = captureVerificationGitBasis({ repositoryRoot });
  write(
    repositoryRoot,
    "package.json",
    `${JSON.stringify({
      name: "fixture",
      private: true,
      scripts: {
        test: "node --test",
        verify: "node scripts/verify/adaptive.mjs --mode full",
        "verify:changed": "node scripts/verify/adaptive.mjs --mode repo --print-plan",
      },
    })}\n`,
  );
  assert.equal(rootManifestChangeIsVerifyOnly(basis, { repositoryRoot }), true);

  git(repositoryRoot, "add", "package.json");
  git(repositoryRoot, "commit", "-qm", "verify script B");
  assert.equal(
    rootManifestChangeIsVerifyOnly(basis, { repositoryRoot }),
    false,
    "the verify-only exception is valid only while HEAD exactly matches the successful basis",
  );
  write(
    repositoryRoot,
    "package.json",
    `${JSON.stringify({
      name: "fixture",
      private: true,
      type: "module",
      scripts: {
        test: "node --test",
        verify: "node scripts/verify/adaptive.mjs --mode full",
        "verify:changed": "node scripts/verify/adaptive.mjs --mode repo --print-plan",
      },
    })}\n`,
  );
  assert.equal(rootManifestChangeIsVerifyOnly(basis, { repositoryRoot }), false);

  const dirtyBasis = captureVerificationGitBasis({ repositoryRoot });
  assert.ok(dirtyBasis.dirtyPaths.includes("package.json"));
  assert.equal(rootManifestChangeIsVerifyOnly(dirtyBasis, { repositoryRoot }), false);
});
