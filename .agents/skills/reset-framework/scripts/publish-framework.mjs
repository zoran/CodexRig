#!/usr/bin/env node
/** Owns explicit post-exit source-framework reset, verification, and central-main publication. */
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  frameworkRoot,
  isReusableFrameworkSource,
} from "../../../../scripts/contracts/framework-contract.mjs";
import { spawnSyncWithBoundedIo as spawnSync } from "../../../../scripts/repository/runtime-process-io.mjs";
import {
  cleanGitEnvironment,
  isolatedGitArguments,
  isolatedGitResultCompleted,
  localGitExcludeIsInactive,
  resolveOwnedGitMetadata,
} from "../../../../scripts/repository/git-runtime-isolation.mjs";
import {
  acquireRuntimeLifecycleLock,
  releaseRuntimeLifecycleLock,
} from "../../../../scripts/repository/runtime-session-lease.mjs";
import { spawnRuntimeLifecycleCommandSync } from "../../../../scripts/repository/runtime-lifecycle-process.mjs";
import { reconcileRepositoryWorktreeState } from "../../../../scripts/repository/worktree-recovery.mjs";
import { renderManagedPrePushHook } from "../../../../scripts/setup/install-git-hooks.mjs";
import { resolveGitHooksPath } from "../../../../scripts/setup/resolve-git-hooks-path.mjs";
import { inspectFrameworkReset } from "./reset-framework.mjs";

const modulePath = fileURLToPath(import.meta.url);
const maximumOutputBytes = 64 * 1024 * 1024;

/** Parses the one explicit publication request; messages remain literal argv values. */
export function parseFrameworkPublicationArguments(args) {
  if (args.length !== 2 || args[0] !== "--message" || !args[1].trim() || args[1].includes("\0")) {
    throw new Error('Usage: pnpm framework:publish --message "<commit message>"');
  }
  return { message: args[1] };
}

function publicationEnvironment() {
  // Keep the operator's normal identity, signing, and credential configuration. Bind repository,
  // index, hooks, and remote destinations explicitly instead of inheriting Git routing overrides.
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("GIT_") || ["BASH_ENV", "ENV", "NODE_OPTIONS", "NODE_PATH"].includes(key)) {
      delete environment[key];
    }
  }
  return environment;
}

function runPublicationGate({ root, script, args = [] }) {
  const remoteCheck = script === "git-remote-identity";
  const result = spawnSync(
    remoteCheck ? process.execPath : "pnpm",
    remoteCheck
      ? [path.join(root, "scripts/verify/git-remote-identity.mjs"), ...args]
      : [script, ...args],
    {
      cwd: root,
      env: publicationEnvironment(),
      stdio: "inherit",
      timeout: 60 * 60_000,
    },
  );
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`${script} failed; publication stopped.`);
  }
}

function publicationGit(root) {
  const metadata = resolveOwnedGitMetadata(root);
  if (!metadata) throw new Error("Framework publication requires a Git worktree.");
  return (args, { acceptedStatuses = [0], environment = {}, owner, native = false } = {}) => {
    const actual = resolveOwnedGitMetadata(root);
    if (actual?.gitDirectory !== metadata.gitDirectory || actual?.workTree !== metadata.workTree) {
      throw new Error("Framework publication lost its Git root binding.");
    }
    const invocation = isolatedGitArguments({ ...metadata, args });
    const options = {
      cwd: root,
      encoding: "utf8",
      env: { ...(native ? publicationEnvironment() : cleanGitEnvironment()), ...environment },
      input: "",
      maxBuffer: maximumOutputBytes,
      stdio: "pipe",
      timeout: 60 * 60_000,
    };
    const result = owner
      ? spawnRuntimeLifecycleCommandSync({
          command: "git",
          args: invocation,
          lifecycleCapability: owner,
          repositoryRoot: root,
          role: "publication-git",
          options,
        })
      : spawnSync("git", invocation, options);
    if (
      !isolatedGitResultCompleted(result, {
        args: invocation,
        acceptedStatuses,
        maximumOutputBytes,
      })
    ) {
      throw new Error(
        `Git ${args[0]} failed; source and any local commit are preserved.\n${result.stderr ?? ""}`,
      );
    }
    return result.stdout.trim();
  };
}

function inspectPublicationBinding(root, git) {
  const state = reconcileRepositoryWorktreeState({ root });
  if (!state.inventory.complete || state.blockingFindings.length > 0) {
    throw new Error(`Worktree settlement blocks publication: ${state.blockingFindings.join("; ")}`);
  }
  if (git(["symbolic-ref", "--quiet", "HEAD"]) !== "refs/heads/main") {
    throw new Error("Integrate the approved changes on main before framework publication.");
  }
  const metadata = resolveOwnedGitMetadata(root);
  if (
    !localGitExcludeIsInactive(metadata) ||
    git(["ls-files", "-v", "-z"])
      .split("\0")
      .some((line) => line && (line[0] === "S" || /[a-z]/u.test(line[0])))
  ) {
    throw new Error("Publication refuses hidden index flags or active local Git excludes.");
  }
  for (const marker of [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-apply",
    "rebase-merge",
    "sequencer",
  ]) {
    if (existsSync(git(["rev-parse", "--path-format=absolute", "--git-path", marker]))) {
      throw new Error("Finish the current Git operation before framework publication.");
    }
  }
  if (git(["ls-files", "--unmerged"])) throw new Error("Resolve the Git index conflicts first.");
  const config = (key) => git(["config", "--local", "--get-all", key]);
  const remote = config("branch.main.remote");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(remote) ||
    config("branch.main.merge") !== "refs/heads/main"
  ) {
    throw new Error("main requires one configured central remote and refs/heads/main upstream.");
  }
  const tracking = `refs/remotes/${remote}/main`;
  if (git(["rev-parse", "--symbolic-full-name", "@{upstream}"]) !== tracking) {
    throw new Error("main must track its configured central main branch.");
  }
  const url = config(`remote.${remote}.url`);
  if (!url || /[\r\n\0]/u.test(url))
    throw new Error("Publication requires one unambiguous remote URL.");
  for (const args of [
    ["remote", "get-url", "--all", remote],
    ["remote", "get-url", "--push", "--all", remote],
  ]) {
    if (git(args, { native: true }) !== url) {
      throw new Error(
        "Publication requires the same unique fetch and push destination without URL rewrites.",
      );
    }
  }
  if (
    git(["config", "--type=bool", "--get", `remote.${remote}.mirror`], {
      acceptedStatuses: [0, 1],
      native: true,
    }) === "true"
  ) {
    throw new Error("Mirror remotes cannot publish the central main branch.");
  }
  const hooksDirectory = resolveGitHooksPath({
    repositoryRoot: root,
    commonDirectory: git(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    hooksDirectory: git(["rev-parse", "--path-format=absolute", "--git-path", "hooks"]),
  });
  return Object.freeze({ remote, tracking, url, hooksDirectory });
}

function requireManagedHook(root, binding) {
  const installedHook = path.join(binding.hooksDirectory, "pre-push");
  const stats = lstatSync(installedHook);
  const expected = renderManagedPrePushHook({
    installedHook,
    root,
    sourceHook: path.join(root, "scripts/git-hooks/pre-push"),
  });
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.nlink !== 1 ||
    (process.platform !== "win32" && (stats.mode & 0o111) === 0) ||
    readFileSync(installedHook, "utf8") !== expected
  ) {
    throw new Error("Publication requires the exact executable repository-managed pre-push hook.");
  }
}

function sourceSnapshot(git) {
  const head = git(["rev-parse", "HEAD"]);
  const temporary = mkdtempSync(path.join(os.tmpdir(), "framework-publication-index-"));
  const environment = { GIT_INDEX_FILE: path.join(temporary, "index") };
  try {
    git(["read-tree", head], { environment });
    git(["add", "--all", "--", "."], { environment });
    return { head, tree: git(["write-tree"], { environment }) };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function requireSnapshot(git, expected) {
  const actual = sourceSnapshot(git);
  if (actual.head !== expected.head || actual.tree !== expected.tree) {
    throw new Error("Source changed after verification; publication stopped before pushing.");
  }
}

/** Publishes only the verified current source; injected gates are an in-process test seam, never CLI bypasses. */
export function publishFramework({
  root = frameworkRoot,
  message,
  runGate = runPublicationGate,
  log = console.log,
} = {}) {
  parseFrameworkPublicationArguments(["--message", message ?? ""]);
  if (!isReusableFrameworkSource(root) || realpathSync(root) !== root) {
    throw new Error("Publication is available only in the reusable source framework.");
  }
  const git = publicationGit(root);
  // Inventory all roots before inspecting or changing reset-owned state in this root.
  const binding = inspectPublicationBinding(root, git);
  inspectFrameworkReset(root);
  const gate = (script, args = []) => runGate({ root, script, args });
  const requireBinding = () => {
    if (JSON.stringify(inspectPublicationBinding(root, git)) !== JSON.stringify(binding)) {
      throw new Error("Git publication destination or ownership changed; publication stopped.");
    }
  };
  const reset = () => {
    const candidates = inspectFrameworkReset(root);
    log(`Framework reset preview: ${candidates.length} candidate(s).`);
    for (const candidate of candidates) log(`- ${candidate}`);
    if (candidates.length > 0) gate("framework:reset", ["--apply"]);
    gate("framework:reset");
  };
  gate("worktree:status", ["--", "--json"]);
  gate("git-remote-identity", ["--remote-name", binding.remote, "--remote-url", binding.url]);
  git(["fetch", "--no-tags", "--", binding.remote, `refs/heads/main:${binding.tracking}`], {
    native: true,
  });
  git(["merge-base", "--is-ancestor", binding.tracking, "HEAD"]);
  reset();
  gate("repo:housekeeping", ["--", "--apply"]);
  gate("hooks:install");
  requireBinding();
  requireManagedHook(root, binding);
  const verified = sourceSnapshot(git);
  gate("verify");
  requireSnapshot(git, verified);
  reset();
  requireBinding();
  const owner = acquireRuntimeLifecycleLock({ root, operation: "framework-publication" });
  let commit;
  try {
    if (inspectFrameworkReset(root).length > 0)
      throw new Error("Reset state reappeared before commit.");
    requireBinding();
    requireManagedHook(root, binding);
    requireSnapshot(git, verified);
    git(["add", "--all", "--", "."], { owner });
    if (git(["write-tree"]) !== verified.tree)
      throw new Error("The staged tree differs from verified source.");
    if (git(["rev-parse", "HEAD^{tree}"]) !== verified.tree) {
      log(
        git(
          [
            "-c",
            `core.hooksPath=${binding.hooksDirectory}`,
            "commit",
            "--cleanup=verbatim",
            "--message",
            message,
          ],
          { native: true, owner },
        ),
      );
    }
    commit = git(["rev-parse", "HEAD"]);
    requireSnapshot(git, { head: commit, tree: verified.tree });
    if (
      git(["rev-parse", "HEAD^{tree}"]) !== verified.tree ||
      git(["write-tree"]) !== verified.tree
    ) {
      throw new Error(
        "Commit hooks changed verified content; the local commit is preserved for review.",
      );
    }
  } finally {
    releaseRuntimeLifecycleLock({ root, owner });
  }
  requireBinding();
  requireManagedHook(root, binding);
  requireSnapshot(git, { head: commit, tree: verified.tree });
  gate("framework:reset");
  log(
    git(
      [
        "-c",
        `core.hooksPath=${binding.hooksDirectory}`,
        "push",
        "--no-force",
        "--no-follow-tags",
        "--recurse-submodules=no",
        "--",
        binding.remote,
        `${commit}:refs/heads/main`,
      ],
      { native: true },
    ),
  );
  if (
    git(["ls-remote", "--exit-code", "--refs", "--", binding.remote, "refs/heads/main"], {
      native: true,
    }) !== `${commit}\trefs/heads/main`
  ) {
    throw new Error(
      "Remote main changed during publication; reconcile before starting another goal.",
    );
  }
  gate("goal:new");
  gate("worktree:status", ["--", "--json"]);
  log(`Framework publication complete: ${commit} on ${binding.remote}/main.`);
  return { commit, remote: binding.remote };
}

if (process.argv[1] === modulePath) {
  try {
    publishFramework(parseFrameworkPublicationArguments(process.argv.slice(2)));
  } catch (error) {
    console.error(`Framework publication failed: ${error.message}`);
    process.exitCode = 1;
  }
}
