/** Verifies git remote identity behavior for the repository verification boundary. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkRemoteEntry,
  configuredRemoteUrls,
  hasEmbeddedCredential,
  isLocalPathLike,
} from "./git-remote-identity.mjs";

function findings(url) {
  return checkRemoteEntry({ mode: "push", name: "origin", url });
}

test("relative and absolute filesystem remotes are rejected", () => {
  for (const url of [
    "../elsewhere.git",
    "./repo.git",
    "repos/project.git",
    "/srv/repo.git",
    "file:../repo.git",
    "git+file:///srv/repo.git",
    "C:repo.git",
  ]) {
    assert.equal(isLocalPathLike(url), true, url);
    assert.ok(
      findings(url).some((finding) => finding.includes("local filesystem path")),
      url,
    );
  }
});

test("HTTP userinfo is rejected even without a password separator", () => {
  for (const url of [
    "https://token@example.com/owner/repo.git",
    "http://user:pass@example.com/repo.git",
  ]) {
    assert.equal(hasEmbeddedCredential(url), true, url);
    assert.ok(
      findings(url).some((finding) => finding.includes("credentials or tokens")),
      url,
    );
  }
});

test("ordinary HTTPS, SSH, and SCP-style remotes remain valid", () => {
  for (const url of [
    "https://example.com/owner/repo.git",
    "ssh://git@example.com/owner/repo.git",
    "git@example.com:owner/repo.git",
  ]) {
    assert.deepEqual(findings(url), [], url);
  }
});

test("configured remotes use bound Git metadata and fail closed without it", (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "git-remote-identity-"));
  const repository = path.join(fixture, "project");
  const decoy = path.join(fixture, "decoy.git");
  mkdirSync(repository);
  t.after(() => rmSync(fixture, { force: true, recursive: true }));

  assert.throws(() => configuredRemoteUrls(repository), /requires a Git worktree/u);
  for (const [cwd, args] of [
    [repository, ["init", "-q"]],
    [repository, ["remote", "add", "origin", "https://example.com/owner/repo.git"]],
    [fixture, ["init", "--bare", "-q", decoy]],
  ]) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
    assert.equal(result.status, 0, result.stderr);
  }
  const configuredDecoy = spawnSync(
    "git",
    ["--git-dir", decoy, "config", "remote.decoy.url", "https://invalid.example/decoy.git"],
    { cwd: fixture, encoding: "utf8", stdio: "pipe" },
  );
  assert.equal(configuredDecoy.status, 0, configuredDecoy.stderr);

  const previousGitDirectory = process.env.GIT_DIR;
  process.env.GIT_DIR = decoy;
  try {
    assert.deepEqual(configuredRemoteUrls(repository), [
      {
        mode: "fetch",
        name: "origin",
        url: "https://example.com/owner/repo.git",
      },
      {
        mode: "push",
        name: "origin",
        url: "https://example.com/owner/repo.git",
      },
    ]);
  } finally {
    if (previousGitDirectory === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousGitDirectory;
  }
});
