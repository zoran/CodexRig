import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  cleanGitEnvironment,
  isolatedGitArguments,
  localGitExcludeIsInactive,
  resolveOwnedGitMetadata,
} from "../repository/git-runtime-isolation.mjs";
import { acquireVerificationSessionLock } from "../verify/verification-session-lock.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const integrationBranch = "main";
let repositoryGitMetadata;

function git(args, environment = {}) {
  return spawnSync(
    "git",
    isolatedGitArguments({
      args,
      gitDirectory: repositoryGitMetadata.gitDirectory,
      workTree: repositoryGitMetadata.workTree,
    }),
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...cleanGitEnvironment(), ...environment },
      input: "",
      stdio: "pipe",
    },
  );
}

function successful(result) {
  return !result.error && result.status === 0;
}

function publicationIndexFlagsAreSafe() {
  const result = git(["ls-files", "-v", "-z"]);
  if (!successful(result)) return false;
  return result.stdout
    .split("\0")
    .filter(Boolean)
    .every((record) => record[0] !== "S" && !/[a-z]/.test(record[0]));
}

function publicationWorktreeState() {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "goal-publication-index-"));
  const indexPath = path.join(temporaryDirectory, "index");
  const environment = { GIT_INDEX_FILE: indexPath };
  try {
    if (!successful(git(["read-tree", "HEAD"], environment))) {
      return { clean: false, verified: false };
    }
    const status = git(
      ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"],
      environment,
    );
    if (!successful(status)) return { clean: false, verified: false };
    return { clean: status.stdout.length === 0, verified: true };
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function verificationEvidenceIsCurrent() {
  const environment = cleanGitEnvironment();
  if (Object.hasOwn(process.env, "LC_ALL")) environment.LC_ALL = process.env.LC_ALL;
  else delete environment.LC_ALL;
  const result = spawnSync(
    process.execPath,
    [path.join(repositoryRoot, "scripts/verify/adaptive.mjs"), "--mode", "pre-push"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: environment,
      input: "",
      stdio: "pipe",
    },
  );
  return successful(result);
}

function fail(message) {
  console.error(`Cannot start a new goal: ${message}`);
  process.exitCode = 1;
}

function main() {
  if (process.argv.length !== 2) {
    fail("goal:new takes no arguments and only verifies the publication precondition.");
    return;
  }

  try {
    repositoryGitMetadata = resolveOwnedGitMetadata(repositoryRoot);
  } catch {
    fail("the canonical project root has unsafe Git metadata.");
    return;
  }
  if (!repositoryGitMetadata) {
    fail("the canonical project root is not a Git worktree.");
    return;
  }

  const insideWorktree = git(["rev-parse", "--is-inside-work-tree"]);
  const topLevel = git(["rev-parse", "--show-toplevel"]);
  if (
    !successful(insideWorktree) ||
    insideWorktree.stdout.trim() !== "true" ||
    !successful(topLevel) ||
    path.resolve(topLevel.stdout.trim()) !== repositoryRoot
  ) {
    fail("the canonical project root is not a Git worktree.");
    return;
  }
  if (!localGitExcludeIsInactive(repositoryGitMetadata)) {
    fail("remove all active or unsafe repository-local Git exclude rules first.");
    return;
  }
  if (!publicationIndexFlagsAreSafe()) {
    fail("clear all skip-worktree and assume-unchanged index flags first.");
    return;
  }

  const currentBranch = git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (!successful(currentBranch) || !currentBranch.stdout.trim()) {
    fail("the repository must be on a named branch.");
    return;
  }
  const branchName = currentBranch.stdout.trim();
  if (branchName !== integrationBranch) {
    fail(
      `integrate the completed goal on the central ${integrationBranch} branch before continuing.`,
    );
    return;
  }
  if (!successful(git(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]))) {
    fail("the current branch has no published commit to verify.");
    return;
  }

  const staged = git(["diff-index", "--cached", "--quiet", "HEAD", "--"]);
  const worktree = publicationWorktreeState();
  if (![0, 1].includes(staged.status) || !worktree.verified) {
    fail("the previous goal's worktree state could not be verified.");
    return;
  }
  if (staged.status === 1 || !worktree.clean) {
    fail("commit or otherwise resolve all non-ignored work from the previous goal first.");
    return;
  }

  const configuredRemote = git(["config", "--local", "--get", `branch.${branchName}.remote`]);
  if (
    !successful(configuredRemote) ||
    !configuredRemote.stdout.trim() ||
    configuredRemote.stdout.trim() === "."
  ) {
    fail("the current branch has no verifiable configured remote upstream.");
    return;
  }
  const remoteName = configuredRemote.stdout.trim();
  const configuredMerge = git(["config", "--local", "--get", `branch.${branchName}.merge`]);
  if (
    !successful(configuredMerge) ||
    configuredMerge.stdout.trim() !== `refs/heads/${integrationBranch}`
  ) {
    fail("the central main branch must track the remote main branch.");
    return;
  }
  const remoteUrl = git(["config", "--local", "--get-all", `remote.${remoteName}.url`]);
  if (!successful(remoteUrl) || !remoteUrl.stdout.trim()) {
    fail("the current branch has no verifiable configured remote upstream.");
    return;
  }
  const upstreamReference = git(["rev-parse", "--symbolic-full-name", "@{upstream}"]);
  if (
    !successful(upstreamReference) ||
    upstreamReference.stdout.trim() !== `refs/remotes/${remoteName}/${integrationBranch}` ||
    !successful(git(["rev-parse", "--verify", "--quiet", "@{upstream}^{commit}"]))
  ) {
    fail("the central main branch must track a verifiable remote main branch.");
    return;
  }

  const comparison = git(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
  if (!successful(comparison)) {
    fail("the current branch could not be compared with its configured upstream.");
    return;
  }
  const counts = comparison.stdout.trim().split(/\s+/).map(Number);
  if (counts.length !== 2 || counts.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    fail("Git returned an invalid publication comparison.");
    return;
  }
  const [ahead, behind] = counts;
  if (ahead !== 0 || behind !== 0) {
    fail(
      `the current branch must exactly match its configured upstream (ahead ${ahead}, behind ${behind}).`,
    );
    return;
  }
  if (!verificationEvidenceIsCurrent()) {
    fail(
      "the published repository has no exact-current successful verification evidence; recompute missing coverage and publish through pre-push.",
    );
    return;
  }

  console.log(
    "Goal publication precondition passed: central main is clean, HEAD matches its configured upstream, and exact-current successful verification evidence is valid.",
  );
}

let verificationSessionLock;
try {
  verificationSessionLock = acquireVerificationSessionLock({ repositoryRoot });
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  verificationSessionLock?.release();
}
