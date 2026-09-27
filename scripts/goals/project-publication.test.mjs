/** Verifies portable publication against real local Git remotes, including branch and retry safety. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  issueRuntimeSessionLease,
  releaseRuntimeSessionLease,
} from "../repository/runtime-session-lease.mjs";
import { renderManagedPrePushHook } from "../setup/install-git-hooks.mjs";
import {
  prepareProjectToolDirectories,
  projectToolEnvironment,
} from "../repository/project-tool-environment.mjs";
import { publishProject } from "./project-publication.mjs";

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "project publication "));
  const beforeCleanup = [];
  t.after(() => {
    try {
      for (const check of beforeCleanup) check();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  const root = path.join(directory, "product");
  const remote = path.join(directory, "upstream.git");
  mkdirSync(root);
  const write = (file, text, mode = 0o600) => {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, text, { mode });
  };
  const git = (...args) => {
    const result = spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      input: "",
      env: { ...process.env, GIT_ALLOW_PROTOCOL: "file" },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "--initial-branch=main");
  git("config", "user.name", "Project Fixture");
  git("config", "user.email", "project@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("init", "--bare", "--initial-branch=main", remote);
  write("package.json", '{"name":"independent-product"}\n');
  write(".gitignore", ".codex/runtime/\nhistory.jsonl\n.auth/\n");
  write("source.txt", "baseline\n");
  write("scripts/git-hooks/pre-push", "#!/bin/sh\nset -eu\ntest ! -f .git/reject-push\n", 0o700);
  git("add", "--all");
  git("commit", "--message", "baseline");
  git("remote", "add", "origin", remote);
  git("push", "--set-upstream", "origin", "main");
  const baseline = git("rev-parse", "HEAD");
  git("switch", "--create", "work/feature");
  git("push", "--set-upstream", "origin", "work/feature");
  const calls = [];
  const runGate = ({ script }) => {
    calls.push(script);
    if (script === "hooks:install") {
      const installedHook = path.join(root, ".git/hooks/pre-push");
      write(
        ".git/hooks/pre-push",
        renderManagedPrePushHook({
          installedHook,
          root,
          sourceHook: path.join(root, "scripts/git-hooks/pre-push"),
        }),
        0o700,
      );
    }
    // Local transport and expensive project checks are explicit in-process seams. Publication's
    // branch, snapshot, managed hook, commit, push and read-back boundaries execute real Git.
  };
  const publish = (options = {}) =>
    publishProject({ root, message: "Publish product change", log() {}, runGate, ...options });
  return { root, baseline, git, write, runGate, calls, publish, beforeCleanup };
}

test("portable publish uses the current upstream and preserves product sessions/accounts", async (t) => {
  const f = fixture(t);
  f.write("history.jsonl", "retained native history\n");
  f.write(".auth/project-account", "retained account\n");
  f.write("source.txt", "verified product\n");
  const result = await f.publish();
  assert.equal(result.branch, "work/feature");
  assert.equal(
    f.git("ls-remote", "origin", "refs/heads/work/feature"),
    `${result.commit}\trefs/heads/work/feature`,
  );
  assert.equal(f.git("ls-remote", "origin", "refs/heads/main"), `${f.baseline}\trefs/heads/main`);
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(
    readFileSync(path.join(f.root, "history.jsonl"), "utf8"),
    "retained native history\n",
  );
  assert.equal(
    readFileSync(path.join(f.root, ".auth/project-account"), "utf8"),
    "retained account\n",
  );
  assert.deepEqual(f.calls, [
    "worktree:status",
    "git-remote-identity",
    "hooks:install",
    "verify",
    "worktree:status",
  ]);
});

test("publication distinguishes synchronized, ahead, behind, diverged and unrelated histories", async (t) => {
  for (const state of ["synchronized", "ahead", "behind", "diverged", "unrelated"])
    await t.test(state, async (t) => {
      const f = fixture(t);
      if (state === "ahead" || state === "diverged")
        f.git("commit", "--allow-empty", "--message", "Local change");
      if (state === "behind" || state === "diverged") {
        const remoteCommit = f.git(
          "commit-tree",
          f.git("rev-parse", `${f.baseline}^{tree}`),
          "-p",
          f.baseline,
          "-m",
          "Upstream change",
        );
        f.git("push", "origin", `${remoteCommit}:refs/heads/work/feature`);
      }
      if (state === "unrelated") {
        const unrelated = f.git(
          "commit-tree",
          f.git("rev-parse", "HEAD^{tree}"),
          "-m",
          "Independent root",
        );
        f.git("push", "origin", `${unrelated}:refs/heads/unrelated`);
        f.git("branch", "--set-upstream-to=origin/unrelated");
      }
      const head = f.git("rev-parse", "HEAD");
      if (state === "synchronized" || state === "ahead") {
        if (state === "synchronized")
          for (const key of ["user.name", "user.email"]) f.git("config", key, "");
        const result = await f.publish();
        assert.equal(result.commit, head, "an already committed publish creates no empty commit");
        assert.equal(f.git("rev-parse", "@{upstream}"), head);
        return;
      }
      f.write("source.txt", "preserved staged edit\n");
      f.git("add", "source.txt");
      f.write("untracked.txt", "preserved untracked edit\n");
      const index = f.git("write-tree");
      const status = f.git("status", "--porcelain");
      const remote = f.git("ls-remote", "origin");
      await assert.rejects(f.publish(), (error) => {
        const message = String(error.message);
        if (state === "behind") {
          assert.match(message, /1 commit\(s\) behind/);
          assert.match(message, /local changes.*preserved.*reconciled/i);
          assert.ok(
            message
              .split("\n")
              .includes("bash scripts/setup/run-project.sh git merge --ff-only '@{upstream}'"),
          );
        } else if (state === "diverged") {
          assert.match(message, /diverged.*1 local.*1 upstream/);
          assert.match(message, /reconcile.*before publishing/i);
          assert.ok(
            message
              .split("\n")
              .includes(
                "bash scripts/setup/run-project.sh git log --oneline --left-right 'HEAD...@{upstream}'",
              ),
          );
        } else assert.match(message, /No common ancestor.*destination.*history/s);
        return true;
      });
      assert.equal(f.git("rev-parse", "HEAD"), head);
      assert.equal(f.git("symbolic-ref", "--short", "HEAD"), "work/feature");
      assert.equal(f.git("write-tree"), index);
      assert.equal(f.git("status", "--porcelain"), status);
      assert.equal(f.git("ls-remote", "origin"), remote);
      assert.deepEqual(f.calls, ["worktree:status", "git-remote-identity"]);
    });
});

test("publication keeps failed or malformed ancestry reads distinct from branch divergence", async (t) => {
  for (const failure of ["operational", "merge-base", "malformed"])
    await t.test(failure, async (t) => {
      const f = fixture(t);
      await assert.rejects(
        f.publish({
          runGit(command, args, options) {
            const result = spawnSync(command, args, {
              ...options,
              env: { ...options.env, GIT_ALLOW_PROTOCOL: "file" },
            });
            if (failure === "merge-base" && args.includes("--left-right"))
              return { ...result, status: 0, stdout: "1\t1\n", stderr: "", signal: null };
            if (
              args.includes("--left-right") ||
              (failure === "merge-base" && args.includes("merge-base"))
            )
              return {
                ...result,
                status: failure === "malformed" ? 0 : 128,
                stdout: failure === "malformed" ? "1\tinvalid\n" : "",
                stderr: failure === "malformed" ? "" : "fixture ancestry read failed\n",
                signal: null,
              };
            return result;
          },
        }),
        failure === "malformed"
          ? /invalid ancestry counts/
          : /Git (?:rev-list|merge-base) failed.*fixture ancestry read failed/s,
      );
      assert.equal(f.git("rev-parse", "HEAD"), f.baseline);
      assert.deepEqual(f.calls, ["worktree:status", "git-remote-identity"]);
    });
});

test("publication explains a missing upstream before changing source or running gates", async (t) => {
  const f = fixture(t);
  f.git("branch", "--unset-upstream");
  f.write("source.txt", "preserve unstaged change\n");
  const status = f.git("status", "--porcelain");
  const index = f.git("write-tree");
  await assert.rejects(f.publish(), /requires one configured remote branch upstream/);
  assert.equal(f.git("rev-parse", "HEAD"), f.baseline);
  assert.equal(f.git("write-tree"), index);
  assert.equal(f.git("status", "--porcelain"), status);
  assert.deepEqual(f.calls, []);
});

test("portable publish preserves redundant native runtime excludes", async (t) => {
  for (const pattern of ["session_index.jsonl", "/session_index.jsonl"])
    await t.test(pattern, async (t) => {
      const f = fixture(t);
      const excludes = `# Native runtime exclusion\r\n${pattern}\r\n`;
      f.write(".gitignore", ".codex/runtime/\nhistory.jsonl\n.auth/\n/session_index.jsonl\n");
      f.write(".git/info/exclude", excludes);
      f.write("session_index.jsonl", "retained private native index\n");
      f.write("source.txt", "verified product\n");
      const result = await f.publish();
      assert.equal(
        f.git("ls-remote", "origin", "refs/heads/work/feature"),
        `${result.commit}\trefs/heads/work/feature`,
      );
      assert.equal(f.git("ls-tree", "--name-only", "HEAD", "session_index.jsonl"), "");
      assert.equal(readFileSync(path.join(f.root, ".git/info/exclude"), "utf8"), excludes);
      assert.equal(
        readFileSync(path.join(f.root, "session_index.jsonl"), "utf8"),
        "retained private native index\n",
      );
    });
});

test("portable publish rejects excludes that hide source or lack a portable boundary", async (t) => {
  for (const scenario of [
    {
      name: "nested native-looking source",
      pattern: "session_index.jsonl",
      hidden: "src/session_index.jsonl",
    },
    {
      name: "missing portable ignore",
      pattern: "/session_index.jsonl",
      hidden: "session_index.jsonl",
      portable: false,
    },
    { name: "arbitrary source exclude", pattern: "src/hidden.ts", hidden: "src/hidden.ts" },
    {
      name: "mixed source and runtime rules",
      pattern: "/session_index.jsonl\nsrc/hidden.ts",
      hidden: "src/hidden.ts",
    },
    {
      name: "negated rule",
      pattern: "/session_index.jsonl\n!src/visible.ts",
      hidden: "src/visible.ts",
    },
  ])
    await t.test(scenario.name, async (t) => {
      const f = fixture(t);
      if (scenario.portable !== false)
        f.write(".gitignore", ".codex/runtime/\nhistory.jsonl\n.auth/\n/session_index.jsonl\n");
      f.write(".git/info/exclude", `${scenario.pattern}\n`);
      f.write(scenario.hidden, "must remain visible\n");
      await assert.rejects(f.publish(), /local Git excludes/);
      assert.equal(f.git("rev-parse", "HEAD"), f.baseline);
      assert.equal(f.git("diff", "--cached", "--name-only"), "");
      assert.deepEqual(f.calls, []);
      assert.equal(
        readFileSync(path.join(f.root, ".git/info/exclude"), "utf8"),
        `${scenario.pattern}\n`,
      );
    });
});

test("portable publish rejects hidden index flags before running gates", async (t) => {
  for (const flag of ["--assume-unchanged", "--skip-worktree"])
    await t.test(flag, async (t) => {
      const f = fixture(t);
      f.git("update-index", flag, "source.txt");
      f.write("source.txt", "hidden edit\n");
      await assert.rejects(f.publish(), /hidden index flags/);
      assert.equal(f.git("rev-parse", "HEAD"), f.baseline);
      assert.deepEqual(f.calls, []);
    });
});

test("portable publish rechecks redundant excludes when verification creates nested source", async (t) => {
  const f = fixture(t);
  f.write(".gitignore", ".codex/runtime/\nhistory.jsonl\n.auth/\n/session_index.jsonl\n");
  f.write(".git/info/exclude", "session_index.jsonl\n");
  f.write("source.txt", "candidate\n");
  await assert.rejects(
    f.publish({
      runGate(request) {
        f.runGate(request);
        if (request.script === "verify") f.write("src/session_index.jsonl", "new hidden source\n");
      },
    }),
    /source-hiding local Git excludes/,
  );
  assert.equal(f.git("rev-parse", "HEAD"), f.baseline);
  assert.equal(f.git("diff", "--cached", "--name-only"), "");
  assert.equal(
    readFileSync(path.join(f.root, "src/session_index.jsonl"), "utf8"),
    "new hidden source\n",
  );
});

test("portable publish rejects aliased native runtime exclude files", async (t) => {
  for (const [name, link] of [
    ["symbolic link", symlinkSync],
    ["hard link", linkSync],
  ])
    await t.test(name, async (t) => {
      const f = fixture(t);
      f.write(".gitignore", ".codex/runtime/\nhistory.jsonl\n.auth/\n/session_index.jsonl\n");
      f.write(".git/native-exclude", "session_index.jsonl\n");
      const exclude = path.join(f.root, ".git/info/exclude");
      rmSync(exclude);
      link(path.join(f.root, ".git/native-exclude"), exclude);
      await assert.rejects(f.publish(), /local Git excludes/);
      assert.deepEqual(f.calls, []);
      assert.equal(
        readFileSync(path.join(f.root, ".git/native-exclude"), "utf8"),
        "session_index.jsonl\n",
      );
    });
});

test("failed or stale verification cannot commit an independent product", async (t) => {
  for (const changed of ["source drift", "identity drift", "failed gate"])
    await t.test(changed, async (t) => {
      const f = fixture(t);
      f.write("source.txt", "candidate\n");
      await assert.rejects(
        f.publish({
          runGate(request) {
            f.runGate(request);
            if (request.script === "verify") {
              if (changed === "source drift") f.write("source.txt", "unverified drift\n");
              else if (changed === "identity drift") f.git("config", "user.name", "Changed author");
              else throw new Error("Product check failed");
            }
          },
        }),
        /Source changed|identity changed|Product check failed/,
      );
      assert.equal(f.git("rev-parse", "HEAD"), f.baseline);
      assert.equal(f.git("diff", "--cached", "--name-only"), "");
    });
});

test("rejected portable push retains its local commit and retry creates no empty commit", async (t) => {
  const f = fixture(t);
  f.write("source.txt", "candidate\n");
  f.write(".git/reject-push", "reject\n");
  await assert.rejects(f.publish(), /Git push failed/);
  const commit = f.git("rev-parse", "HEAD");
  assert.notEqual(commit, f.baseline);
  rmSync(path.join(f.root, ".git/reject-push"));
  assert.equal((await f.publish()).commit, commit);
  assert.equal(f.git("rev-list", "--count", "HEAD"), "2");
});

test("active sessions stop portable publication before any gate or account mutation", async (t) => {
  const f = fixture(t);
  issueRuntimeSessionLease({ root: f.root, pid: process.pid });
  try {
    await assert.rejects(f.publish(), /active Codex sessions/);
    assert.deepEqual(f.calls, []);
    assert.equal(existsSync(path.join(f.root, ".auth")), false);
  } finally {
    releaseRuntimeSessionLease({ root: f.root, pid: process.pid });
  }
});

test("changed upstream during verification stops before committing", async (t) => {
  const f = fixture(t);
  f.write("source.txt", "candidate\n");
  await assert.rejects(
    f.publish({
      runGate(request) {
        f.runGate(request);
        if (request.script === "verify") f.git("branch", "--set-upstream-to=origin/main");
      },
    }),
    /destination or ownership changed/,
  );
  assert.equal(f.git("rev-parse", "HEAD"), f.baseline);
});

function credentialFixture(
  t,
  {
    provider = "github",
    host,
    rejectGlobal = false,
    rejectAll = false,
    failure,
    destinationDrift = false,
    rejectOperation = "fetch",
  } = {},
) {
  const f = fixture(t);
  const hostname = host ?? (provider === "github" ? "github.com" : "gitlab.com");
  const request = `protocol=https\nhost=${hostname}\npath=team/product.git\n\n`;
  const localRemote = f.git("config", "--get", "remote.origin.url");
  f.git("config", "remote.origin.url", `https://${hostname}/team/product.git`);
  const home = path.join(path.dirname(f.root), "fake-host");
  const bin = path.join(home, "bin");
  mkdirSync(bin, { recursive: true });
  const calls = path.join(home, "calls.jsonl");
  const nativeGit = process.env.PATH.split(path.delimiter)
    .map((directory) => path.resolve(directory, process.platform === "win32" ? "git.exe" : "git"))
    .find((candidate) => {
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  assert.ok(nativeGit, "The fixture requires an executable Git binary.");
  // The adapter intentionally rebuilds Git's environment. Its synthetic host therefore supplies
  // a forwarding Git executable that enforces file-only transport on that nested process too.
  writeFileSync(
    path.join(bin, "git"),
    `#!${process.execPath}
import {spawnSync} from 'node:child_process';
const result=spawnSync(${JSON.stringify(nativeGit)},process.argv.slice(2),{stdio:'inherit',env:{...process.env,GIT_ALLOW_PROTOCOL:'file'}});
process.exit(result.status??1);
`,
    { mode: 0o700 },
  );
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const account = path.join(bin, "account.mjs");
  for (const [file, password] of [
    [account, rejectGlobal ? "fixture-rejected-global" : "fixture-valid-global"],
    [path.join(bin, provider === "github" ? "gh" : "glab"), "fixture-valid-cli"],
  ])
    writeFileSync(
      file,
      `#!${process.execPath}
import {appendFileSync} from 'node:fs';
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2))+'\\n');
process.stdin.resume();
process.stdout.write('username=fixture-global-user\\npassword=${password}\\n\\n');
`,
      { mode: 0o700 },
    );
  writeFileSync(
    path.join(home, ".gitconfig"),
    `[credential]\n\thelper = ${JSON.stringify(`!${quote(process.execPath)} ${quote(account)}`)}\n`,
  );
  const tooling = JSON.parse(
    readFileSync(new URL("../../.codex/tooling.json", import.meta.url), "utf8"),
  );
  if (!tooling.platform.hosts[provider].includes(hostname)) {
    tooling.platform.hosts[provider].push(hostname);
    tooling.platform.apiBaseUrls[provider][hostname] =
      `https://${hostname}${provider === "gitlab" ? "/api/v4" : "/api/v3"}`;
  }
  f.write(".codex/tooling.json", JSON.stringify(tooling));
  f.write(
    "scripts/repository/global-git-credential.mjs",
    `import {globalGitCredential} from ${JSON.stringify(new URL("../repository/global-git-credential.mjs", import.meta.url).href)};
let input='';for await(const chunk of process.stdin)input+=chunk;
process.stdout.write(globalGitCredential({root:${JSON.stringify(f.root)},hostHome:${JSON.stringify(home)},operation:process.argv[2],input}));
`,
  );
  const locations = prepareProjectToolDirectories(f.root);
  f.beforeCleanup.push(() => assert.deepEqual(readdirSync(locations.temporary), []));
  const credential = (operation, input, options) =>
    spawnSync("git", ["credential", operation], {
      ...options,
      env: { ...options.env, GIT_ALLOW_PROTOCOL: "file" },
      cwd: f.root,
      input,
      encoding: "utf8",
      stdio: "pipe",
    });
  const environment = projectToolEnvironment({ root: f.root });
  const initial = `${request.trim()}\nusername=fixture-local-user\npassword=fixture-rejected-project\n\n`;
  assert.equal(credential("approve", initial, { env: environment }).status, 0);
  const attempts = [];
  const runGit = (command, args, options) => {
    const operation = ["fetch", "push", "ls-remote"].find((value) => args.includes(value));
    if (!operation)
      return spawnSync(command, args, {
        ...options,
        env: { ...options.env, GIT_ALLOW_PROTOCOL: "file" },
      });
    const actualOptions = {
      ...options,
      env: {
        ...options.env,
        PATH: bin + path.delimiter + options.env.PATH,
        GIT_ALLOW_PROTOCOL: "file",
      },
    };
    attempts.push({ operation, args, env: actualOptions.env });
    if (failure?.operation === operation) {
      if (failure.kind !== "plain") {
        const rejected =
          failure.kind === "foreign"
            ? initial.replace("team/product.git", "team/other.git")
            : initial;
        assert.equal(credential("reject", rejected, actualOptions).status, 0);
      }
      if (failure.kind === "timeout")
        return spawnSync(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
          ...actualOptions,
          timeout: 20,
        });
      if (failure.kind === "signal")
        return spawnSync(
          process.execPath,
          ["-e", "process.kill(process.pid,'SIGTERM')"],
          actualOptions,
        );
      if (failure.kind === "spawn")
        return spawnSync(path.join(bin, "missing-command"), [], actualOptions);
      return spawnSync(
        process.execPath,
        ["-e", "process.stderr.write('Authentication failed in fixture');process.exit(128)"],
        actualOptions,
      );
    }
    const filled = credential("fill", request, actualOptions);
    if (filled.status !== 0) return filled;
    if (
      rejectAll ||
      (operation === rejectOperation && /password=fixture-rejected-/u.test(filled.stdout))
    ) {
      assert.equal(credential("reject", filled.stdout, actualOptions).status, 0);
      if (destinationDrift)
        f.git("config", "remote.origin.url", `https://${hostname}/team/other.git`);
      return spawnSync(process.execPath, ["-e", "process.exit(128)"], actualOptions);
    }
    assert.equal(credential("approve", filled.stdout, actualOptions).status, 0);
    // A remote URL is multivalued in Git config, so -c cannot safely redirect its first URL.
    // Bind the transport operand itself and deny every network protocol in the real child.
    const remoteIndex = args.indexOf("--") + 1;
    assert.equal(args[remoteIndex], "origin");
    assert.equal(localRemote, path.join(path.dirname(f.root), "upstream.git"));
    const transportArgs = [...args];
    transportArgs[remoteIndex] = localRemote;
    assert.equal(
      transportArgs.some((value) => /https?:\/\//u.test(value) || value.includes(hostname)),
      false,
    );
    assert.equal(actualOptions.env.GIT_ALLOW_PROTOCOL, "file");
    return spawnSync(command, transportArgs, actualOptions);
  };
  return {
    ...f,
    runGit,
    attempts,
    home,
    host: hostname,
    localRemote,
    globalCalls: () =>
      existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse) : [],
  };
}

for (const provider of ["github", "gitlab"]) {
  test(`${provider}: publication recovers rejected project and global credentials through existing CLI`, async (t) => {
    const f = credentialFixture(t, { provider, rejectGlobal: true });
    f.write("source.txt", "verified product\n");
    const result = await f.publish({ runGit: f.runGit });
    assert.equal(result.branch, "work/feature");
    assert.equal(
      f.git("ls-remote", f.localRemote, "refs/heads/work/feature"),
      `${result.commit}\trefs/heads/work/feature`,
    );
    const fetches = f.attempts.filter(({ operation }) => operation === "fetch");
    assert.equal(fetches.length, 3);
    assert.deepEqual(
      fetches.map(({ args }) => args),
      Array(3).fill(fetches[0].args),
    );
    for (const attempt of fetches.slice(1)) assert.equal(attempt.env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(
      f.globalCalls().every((args) => args.at(-1) === "get"),
      true,
    );
    assert.equal(
      f.globalCalls().some((args) => args.join(" ") === "auth git-credential get"),
      true,
    );
  });
  for (const operation of ["push", "ls-remote"])
    test(`${provider}: publication recovers rejected credentials during ${operation}`, async (t) => {
      const f = credentialFixture(t, { provider, rejectOperation: operation });
      f.write("source.txt", "verified product\n");
      const result = await f.publish({ runGit: f.runGit });
      assert.equal(f.attempts.filter((attempt) => attempt.operation === operation).length, 2);
      assert.equal(f.calls.filter((script) => script === "verify").length, 1);
      assert.equal(
        f.git("ls-remote", f.localRemote, "refs/heads/work/feature"),
        `${result.commit}\trefs/heads/work/feature`,
      );
    });
}

test("configured self-hosted GitLab recovers rejected project credentials", async (t) => {
  const f = credentialFixture(t, { provider: "gitlab", host: "git.example.test" });
  await f.publish({ runGit: f.runGit });
  assert.equal(f.attempts.filter(({ operation }) => operation === "fetch").length, 2);
});

test("publication never retries unrelated errors or incomplete native processes", async (t) => {
  for (const kind of ["plain", "foreign", "timeout", "signal", "spawn"])
    await t.test(kind, async (t) => {
      const f = credentialFixture(t, { failure: { operation: "fetch", kind } });
      await assert.rejects(f.publish({ runGit: f.runGit }), /Git fetch failed/);
      assert.equal(f.attempts.length, 1);
      assert.equal(f.git("rev-parse", "HEAD"), f.baseline);
    });
});

test("publication stops after two distinct credential recovery retries", async (t) => {
  const f = credentialFixture(t, { rejectGlobal: true, rejectAll: true });
  await assert.rejects(f.publish({ runGit: f.runGit }), /Git fetch failed/);
  assert.equal(f.attempts.filter(({ operation }) => operation === "fetch").length, 3);
  assert.equal(f.git("rev-parse", "HEAD"), f.baseline);
});

test("publication stops when Git repeats the same credential rejection", async (t) => {
  const f = credentialFixture(t, { failure: { operation: "fetch", kind: "repeat" } });
  await assert.rejects(f.publish({ runGit: f.runGit }), /Git fetch failed/);
  assert.equal(f.attempts.length, 2);
  assert.equal(f.git("rev-parse", "HEAD"), f.baseline);
});

test("publication does not retry a push error without a credential rejection", async (t) => {
  const f = credentialFixture(t, { failure: { operation: "push", kind: "plain" } });
  f.write("source.txt", "candidate\n");
  await assert.rejects(f.publish({ runGit: f.runGit }), /Git push failed/);
  assert.equal(f.attempts.filter(({ operation }) => operation === "push").length, 1);
  assert.notEqual(f.git("rev-parse", "HEAD"), f.baseline);
});

test("publication rechecks its destination before recovering a rejected credential", async (t) => {
  const f = credentialFixture(t, { destinationDrift: true });
  await assert.rejects(f.publish({ runGit: f.runGit }), /destination or ownership changed/);
  assert.equal(f.attempts.filter(({ operation }) => operation === "fetch").length, 1);
  assert.equal(f.git("rev-parse", "HEAD"), f.baseline);
});
