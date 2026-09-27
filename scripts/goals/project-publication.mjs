/** Owns verified publication to a named branch upstream; source-only lifecycle stays with its caller. */
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import { spawnSyncWithBoundedIo as spawnSync } from "../repository/runtime-process-io.mjs";
import {
  cleanGitEnvironment,
  isolatedGitArguments,
  isolatedGitResultCompleted,
  localGitExcludeIsInactive,
  resolveOwnedGitMetadata,
} from "../repository/git-runtime-isolation.mjs";
import {
  acquireRuntimeLifecycleLock,
  releaseRuntimeLifecycleLock,
} from "../repository/runtime-session-lease.mjs";
import { spawnRuntimeLifecycleCommandSync } from "../repository/runtime-lifecycle-process.mjs";
import { reconcileRepositoryWorktreeState } from "../repository/worktree-recovery.mjs";
import { renderManagedPrePushHook } from "../setup/install-git-hooks.mjs";
import { resolveGitHooksPath } from "../setup/resolve-git-hooks-path.mjs";
import { createPublicationOutput } from "../terminal/publication-output.mjs";
import { runPublicationCommand } from "./publication-command.mjs";

import { projectToolEnvironment } from "../repository/project-tool-environment.mjs";
import { createGitCredentialRecovery } from "../repository/global-git-credential.mjs";
import { resolvePublicationIdentity } from "../repository/git-publication-identity.mjs";

const maximumOutputBytes = 64 * 1024 * 1024;

/** Parses the one explicit publication request; messages remain literal argv values. */
export function parsePublicationArguments(args, command = "project:publish") {
  const verbose = args.length === 3 && args[2] === "--verbose";
  if (
    (args.length !== 2 && !verbose) ||
    args[0] !== "--message" ||
    !args[1].trim() ||
    args[1].includes("\0")
  ) {
    throw new Error(`Usage: pnpm ${command} --message "<commit message>" [--verbose]`);
  }
  return { message: args[1], ...(verbose ? { verbose: true } : {}) };
}

function publicationEnvironment(root) {
  // Publication uses the project's own Git identity and credentials, including its signing state.
  // The common boundary excludes ambient accounts, agents and executable preload controls.
  return projectToolEnvironment({ root });
}

async function runPublicationGate({ root, script, args = [], output }) {
  const remoteCheck = script === "git-remote-identity";
  await runPublicationCommand({
    command: remoteCheck ? process.execPath : "pnpm",
    args: remoteCheck
      ? [path.join(root, "scripts/verify/git-remote-identity.mjs"), ...args]
      : [script, ...args],
    root,
    env: publicationEnvironment(root),
    output,
  });
}

function publicationGit(root, output, runGit = spawnSync) {
  const metadata = resolveOwnedGitMetadata(root);
  if (!metadata) throw new Error("Publication requires a Git worktree.");
  return (
    args,
    {
      acceptedStatuses = [0],
      environment = {},
      owner,
      native = false,
      credentialUrl,
      beforeCredentialRetry,
    } = {},
  ) => {
    const actual = resolveOwnedGitMetadata(root);
    if (actual?.gitDirectory !== metadata.gitDirectory || actual?.workTree !== metadata.workTree) {
      throw new Error("Publication lost its Git root binding.");
    }
    const invocation = isolatedGitArguments({ ...metadata, args });
    let commandIndex = 0;
    while (args[commandIndex] === "-c") commandIndex += 2;
    const recovery = credentialUrl
      ? createGitCredentialRecovery({ root, url: credentialUrl })
      : null;
    try {
      const options = {
        cwd: root,
        encoding: "utf8",
        env: {
          ...(native ? publicationEnvironment(root) : cleanGitEnvironment(process.env, root)),
          ...environment,
          ...recovery?.environment,
        },
        input: "",
        maxBuffer: maximumOutputBytes,
        stdio: "pipe",
        timeout: 60 * 60_000,
      };
      for (;;) {
        const result = owner
          ? spawnRuntimeLifecycleCommandSync({
              command: "git",
              args: invocation,
              lifecycleCapability: owner,
              repositoryRoot: root,
              role: "publication-git",
              options,
            })
          : runGit("git", invocation, options);
        if (
          isolatedGitResultCompleted(result, {
            args: invocation,
            acceptedStatuses,
            maximumOutputBytes,
          })
        ) {
          if (native) output.detail(result.stderr ?? "");
          return result.stdout.trim();
        }
        if (
          !Number.isInteger(result.status) ||
          result.status <= 0 ||
          !isolatedGitResultCompleted(result, {
            args: invocation,
            acceptedStatuses: [result.status],
            maximumOutputBytes,
          }) ||
          !recovery?.canRetry()
        )
          throw new Error(
            `Git ${args[commandIndex]} failed; source and any local commit are preserved.\n${result.stderr ?? ""}`,
          );
        beforeCredentialRetry();
        output.task("Rejected sign-in; trying the next existing GitHub/GitLab login", {
          prompt: true,
        });
        const configurationCount = Number(options.env.GIT_CONFIG_COUNT);
        Object.assign(options.env, {
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "",
          SSH_ASKPASS: "",
          GIT_CONFIG_COUNT: String(configurationCount + 2),
          [`GIT_CONFIG_KEY_${configurationCount}`]: "credential.interactive",
          [`GIT_CONFIG_VALUE_${configurationCount}`]: "false",
          [`GIT_CONFIG_KEY_${configurationCount + 1}`]: "core.askPass",
          [`GIT_CONFIG_VALUE_${configurationCount + 1}`]: "",
        });
      }
    } finally {
      recovery?.close();
    }
  };
}

function inspectPublicationBinding(root, git, requiredBranch) {
  const state = reconcileRepositoryWorktreeState({ root });
  if (!state.inventory.complete || state.blockingFindings.length > 0) {
    throw new Error(`Worktree settlement blocks publication: ${state.blockingFindings.join("; ")}`);
  }
  if (
    state.inventory.worktrees.some((worktree) =>
      ["active", "unknown", "invalid"].includes(worktree.session.status),
    )
  ) {
    throw new Error("Exit all active Codex sessions for this repository before publication.");
  }
  const branchRef = git(["symbolic-ref", "--quiet", "HEAD"]);
  if (!branchRef.startsWith("refs/heads/")) throw new Error("Publication requires a named branch.");
  const branch = branchRef.slice("refs/heads/".length);
  if (requiredBranch && branch !== requiredBranch)
    throw new Error(`Publication requires the ${requiredBranch} branch.`);
  if (
    git(["ls-files", "-v", "-z"])
      .split("\0")
      .some((line) => line && (line[0] === "S" || /[a-z]/u.test(line[0])))
  ) {
    throw new Error(
      "Publication refuses hidden index flags; clear skip-worktree and assume-unchanged flags first.",
    );
  }
  if (!localGitExcludeIsInactive(resolveOwnedGitMetadata(root))) {
    throw new Error(
      "Publication refuses unsafe or source-hiding local Git excludes; review .git/info/exclude. Only redundant native runtime rules are accepted.",
    );
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
      throw new Error("Finish the current Git operation before publication.");
    }
  }
  if (git(["ls-files", "--unmerged"])) throw new Error("Resolve the Git index conflicts first.");
  const config = (key) =>
    git(["config", "--local", "--get-all", key], { acceptedStatuses: [0, 1] });
  const remote = config(`branch.${branch}.remote`);
  const remoteRef = config(`branch.${branch}.merge`);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(remote) ||
    !remoteRef.startsWith("refs/heads/") ||
    (requiredBranch && remoteRef !== `refs/heads/${requiredBranch}`)
  ) {
    throw new Error("Publication requires one configured remote branch upstream.");
  }
  git(["check-ref-format", remoteRef]);
  const targetBranch = remoteRef.slice("refs/heads/".length);
  const tracking = `refs/remotes/${remote}/${targetBranch}`;
  if (git(["rev-parse", "--symbolic-full-name", "@{upstream}"]) !== tracking) {
    throw new Error("The current branch must track its configured remote branch.");
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
    throw new Error("Mirror remotes cannot publish the selected branch.");
  }
  const hooksDirectory = resolveGitHooksPath({
    repositoryRoot: root,
    commonDirectory: git(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    hooksDirectory: git(["rev-parse", "--path-format=absolute", "--git-path", "hooks"]),
  });
  return Object.freeze({ branch, targetBranch, remoteRef, remote, tracking, url, hooksDirectory });
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

function requireUpstreamContained(git, binding) {
  const counts = git(["rev-list", "--left-right", "--count", `HEAD...${binding.tracking}`]);
  const match = /^([0-9]+)\t([0-9]+)$/u.exec(counts);
  if (!match || match.slice(1).some((value) => !Number.isSafeInteger(Number(value))))
    throw new Error("Git returned invalid ancestry counts; publication stopped.");
  const [ahead, behind] = match.slice(1).map(Number);
  if (behind === 0) return;
  const branch = JSON.stringify(binding.branch);
  const upstream = JSON.stringify(`${binding.remote}/${binding.targetBranch}`);
  if (ahead === 0) {
    throw new Error(
      `Branch ${branch} is ${behind} commit(s) behind ${upstream}.\n` +
        "Review upstream changes first. Local changes must be preserved and reconciled before fast-forwarding.\n" +
        "Then run:\n" +
        "bash scripts/setup/run-project.sh git merge --ff-only '@{upstream}'\n" +
        "Run publication again after the branch is synchronized.",
    );
  }
  const ancestor = git(["merge-base", "HEAD", binding.tracking], { acceptedStatuses: [0, 1] });
  if (!ancestor)
    throw new Error(
      `No common ancestor is available between ${branch} and ${upstream}.\n` +
        "Check the configured destination and available history, including any shallow history, before reconciling these branches and publishing again.",
    );
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(ancestor))
    throw new Error("Git returned an invalid common ancestor; publication stopped.");
  throw new Error(
    `Branch ${branch} and ${upstream} have diverged: ${ahead} local and ${behind} upstream commit(s).\n` +
      "Preserve local changes and reconcile the histories before publishing. Review with:\n" +
      "bash scripts/setup/run-project.sh git log --oneline --left-right 'HEAD...@{upstream}'",
  );
}

function sourceSnapshot(git) {
  const head = git(["rev-parse", "HEAD"]);
  const indexTree = git(["write-tree"]);
  const temporary = mkdtempSync(path.join(os.tmpdir(), "project-publication-index-"));
  const environment = { GIT_INDEX_FILE: path.join(temporary, "index") };
  try {
    // Start from the actual index so add --all preserves staged removals of ignored local files.
    git(["read-tree", indexTree], { environment });
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

/** Publishes only verified source; injected gates/processes are in-process test seams, never CLI bypasses. */
export async function publishProject({
  root = toolingRoot,
  message,
  verbose = false,
  runGate = runPublicationGate,
  runGit,
  log,
  displayName = "Project",
  requiredBranch,
  lifecycle = {},
  output = createPublicationOutput({ root, verbose, log, displayName }),
} = {}) {
  parsePublicationArguments(["--message", message ?? ""]);
  if (realpathSync(root) !== root)
    throw new Error("Publication requires a canonical project root.");
  const git = publicationGit(root, output, runGit);
  let binding;
  let verified;
  let commit;
  let commitIdentity;
  const gate = async (script, args = [], label = script) => {
    output.task(label);
    await runGate({ root, script, args, output });
  };
  const requireBinding = () => {
    if (
      JSON.stringify(inspectPublicationBinding(root, git, requiredBranch)) !==
      JSON.stringify(binding)
    ) {
      throw new Error("Git publication destination or ownership changed; publication stopped.");
    }
  };
  const beforeCredentialRetry = () => {
    requireBinding();
    if (verified) {
      requireManagedHook(root, binding);
      requireSnapshot(git, commit ? { head: commit, tree: verified.tree } : verified);
    }
  };
  output.start();
  await output.phase(1, "Check repository", async () => {
    output.task("Inspect worktrees and publication destination");
    binding = inspectPublicationBinding(root, git, requiredBranch);
    lifecycle.inspect?.();
    await gate("worktree:status", ["--", "--json"], "Check worktree ownership");
    await gate(
      "git-remote-identity",
      ["--remote-name", binding.remote, "--remote-url", binding.url],
      "Validate central remote",
    );
  });
  await output.phase(2, "Sync upstream", async () => {
    output.task("Fetch configured upstream (Git may request sign-in)", { prompt: true });
    git(["fetch", "--no-tags", "--", binding.remote, `${binding.remoteRef}:${binding.tracking}`], {
      native: true,
      credentialUrl: binding.url,
      beforeCredentialRetry,
    });
    output.task("Compare local and upstream branch history");
    requireUpstreamContained(git, binding);
  });
  await output.phase(3, "Prepare source", async () => {
    await lifecycle.prepare?.({ gate, output });
    await gate("hooks:install", [], "Install publication checks");
    requireBinding();
    requireManagedHook(root, binding);
    verified = sourceSnapshot(git);
    if (verified.tree !== git(["rev-parse", "HEAD^{tree}"])) {
      output.task("Validate Git commit author and committer");
      commitIdentity = resolvePublicationIdentity({ root, runGit });
    }
  });
  await output.phase(4, "Verify source", async () => {
    await gate("verify", [], "Run repository verification");
    requireSnapshot(git, verified);
  });
  await output.phase(5, "Seal verified source", async () => {
    await lifecycle.afterVerify?.({ gate, output });
    requireBinding();
    requireSnapshot(git, verified);
  });
  await output.phase(6, "Create commit", async () => {
    output.task("Commit the verified source (signing may request input)", { prompt: true });
    const owner = acquireRuntimeLifecycleLock({ root, operation: "project-publication" });
    try {
      lifecycle.beforeCommit?.();
      requireBinding();
      requireManagedHook(root, binding);
      requireSnapshot(git, verified);
      if (commitIdentity) {
        const currentIdentity = resolvePublicationIdentity({ root, runGit });
        if (Object.entries(commitIdentity).some(([key, value]) => currentIdentity[key] !== value))
          throw new Error(
            "Git publication identity changed after verification; stopped before staging.",
          );
      }
      git(["add", "--all", "--", "."], { owner });
      if (git(["write-tree"]) !== verified.tree)
        throw new Error("The staged tree differs from verified source.");
      if (git(["rev-parse", "HEAD^{tree}"]) !== verified.tree) {
        output.detail(
          git(
            [
              "-c",
              `core.hooksPath=${binding.hooksDirectory}`,
              "commit",
              "--cleanup=verbatim",
              "--message",
              message,
            ],
            { native: true, owner, environment: commitIdentity },
          ),
        );
      } else output.detail("Verified tree is already committed; reusing the existing commit.");
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
  });
  await output.phase(7, "Publish to upstream", async () => {
    requireBinding();
    requireManagedHook(root, binding);
    requireSnapshot(git, { head: commit, tree: verified.tree });
    await lifecycle.beforePush?.({ gate, output });
    output.task("Push verified commit through pre-push checks (Git may request sign-in)", {
      prompt: true,
    });
    output.detail(
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
          `${commit}:${binding.remoteRef}`,
        ],
        { native: true, credentialUrl: binding.url, beforeCredentialRetry },
      ),
    );
    output.task("Confirm published remote commit", { prompt: true });
    if (
      git(["ls-remote", "--exit-code", "--refs", "--", binding.remote, binding.remoteRef], {
        native: true,
        credentialUrl: binding.url,
        beforeCredentialRetry,
      }) !== `${commit}\t${binding.remoteRef}`
    ) {
      throw new Error("Remote branch changed during publication; reconcile before continuing.");
    }
  });
  await output.phase(8, "Finish publication", async () => {
    await lifecycle.finish?.({ gate, output });
    requireBinding();
    requireSnapshot(git, { head: commit, tree: verified.tree });
    await gate("worktree:status", ["--", "--json"], "Confirm final worktree state");
  });
  const result = { commit, remote: binding.remote, branch: binding.targetBranch };
  output.finish(result);
  return result;
}
