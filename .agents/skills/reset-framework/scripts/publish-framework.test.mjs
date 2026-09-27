/** Verifies framework publication ordering and failure preservation with real Git and owned remotes. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  issueRuntimeSessionLease,
  releaseRuntimeSessionLease,
  activateRuntimeSessionLease,
  inspectRuntimeSessionLease,
  transitionRuntimeSessionWriterProcess,
} from "../../../../scripts/repository/runtime-session-lease.mjs";
import { renderManagedPrePushHook } from "../../../../scripts/setup/install-git-hooks.mjs";
import { parseFrameworkPublicationArguments, publishFramework } from "./publish-framework.mjs";
import {
  prepareProjectToolDirectories,
  projectToolEnvironment,
} from "../../../../scripts/repository/project-tool-environment.mjs";
import { createPublicationOutput } from "../../../../scripts/terminal/publication-output.mjs";
import { runPublicationCommand } from "../../../../scripts/goals/publication-command.mjs";

const resetScript = fileURLToPath(new URL("reset-framework.mjs", import.meta.url));

function write(root, relative, text, mode = 0o600) {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, text, { mode });
}

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "framework publication "));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "source");
  const remote = path.join(directory, "central.git");
  mkdirSync(root);
  prepareProjectToolDirectories(root);
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", input: "" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "--initial-branch=main");
  git("config", "user.name", "Publication Fixture");
  git("config", "user.email", "publication@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("init", "--bare", "--initial-branch=main", remote);
  write(root, "package.json", '{"name":"codexrig"}\n');
  write(root, "README.md", "# CodexRig Framework\n");
  write(root, ".agents/skills/reset-framework/SKILL.md", "# Reset Fixture\n");
  write(root, ".agents/skills/create-project-from-framework/SKILL.md", "# Generation Fixture\n");
  write(root, ".codexrig/project-tools.json", "{}\n");
  write(root, ".codex/README.md", "# Portable Policy\n");
  write(root, ".gitignore", ".codex/runtime/\nhistory.jsonl\n.auth/\n");
  write(root, "source.txt", "baseline\n");
  write(
    root,
    "scripts/git-hooks/pre-push",
    '#!/bin/sh\nset -eu\nprintf "ran\\n" >> .git/publication-hook-runs\ntest ! -f .git/reject-publication\n',
    0o700,
  );
  git("add", "--all");
  git("commit", "--message", "Published baseline");
  git("remote", "add", "origin", remote);
  git("push", "--set-upstream", "origin", "main");
  const baseline = git("rev-parse", "HEAD");
  const calls = [];
  const runGate = ({ script, args }) => {
    calls.push([script, ...args]);
    if (script === "framework:reset") {
      const result = spawnSync(process.execPath, [resetScript, "--root", root, ...args], {
        cwd: root,
        encoding: "utf8",
        input: "",
        env: projectToolEnvironment({ root }),
      });
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    } else if (script === "hooks:install") {
      const installedHook = path.join(root, ".git/hooks/pre-push");
      write(
        root,
        ".git/hooks/pre-push",
        renderManagedPrePushHook({
          installedHook,
          root,
          sourceHook: path.join(root, "scripts/git-hooks/pre-push"),
        }),
        0o700,
      );
    }
    // The local transport and expensive verification owners are fixture seams. Production has
    // no skip flags and invokes their real commands; this suite exercises real reset and Git.
  };
  return {
    baseline,
    calls,
    git,
    remote,
    root,
    runGate,
    publish(extra = {}) {
      return publishFramework({ root, message: "GPT 6 Upgrade", runGate, log() {}, ...extra });
    },
  };
}

test("publication parses only an explicit literal commit message", () => {
  assert.deepEqual(parseFrameworkPublicationArguments(["--message", "GPT 6 Upgrade"]), {
    message: "GPT 6 Upgrade",
  });
  assert.deepEqual(parseFrameworkPublicationArguments(["--message", "Upgrade", "--verbose"]), {
    message: "Upgrade",
    verbose: true,
  });
  for (const args of [
    [],
    ["--", "--message", "upgrade"],
    ["--message", " "],
    ["--message", "upgrade", "--skip-hooks"],
  ]) {
    assert.throws(() => parseFrameworkPublicationArguments(args), /Usage/);
  }
});

test("publication resets, verifies, commits all source and pushes through its installed hook", async (t) => {
  const f = fixture(t);
  write(f.root, "history.jsonl", "disposable session\n");
  write(f.root, "source.txt", "verified source\n");
  write(f.root, "new source.txt", "new verified file\n");
  const message = "GPT 6 Upgrade $(touch injected) `touch injected`";
  const messages = [];
  const result = await f.publish({ message, log: (line) => messages.push(line) });
  assert.equal(messages.filter((line) => line.includes("[OK]")).length, 8);
  assert.ok(messages.at(-1).includes("All 8 phases completed"));
  assert.notEqual(result.commit, f.baseline);
  assert.equal(f.git("log", "-1", "--format=%B"), message);
  assert.equal(
    f.git("ls-remote", "origin", "refs/heads/main"),
    `${result.commit}\trefs/heads/main`,
  );
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(existsSync(path.join(f.root, "history.jsonl")), false);
  assert.equal(existsSync(path.join(f.root, "injected")), false);
  assert.equal(readFileSync(path.join(f.root, ".git/publication-hook-runs"), "utf8"), "ran\n");
  assert.deepEqual(
    f.calls.map(([name]) => name),
    [
      "worktree:status",
      "git-remote-identity",
      "framework:reset",
      "framework:reset",
      "repo:housekeeping",
      "hooks:install",
      "verify",
      "framework:reset",
      "framework:reset",
      "goal:new",
      "worktree:status",
    ],
  );
});

test("publication diagnostics stay quiet on success and identify a failed gate without leaking secrets", async (t) => {
  const f = fixture(t);
  const messages = [];
  const output = createPublicationOutput({ root: f.root, log: (line) => messages.push(line) });
  await runPublicationCommand({
    command: process.execPath,
    args: ["-e", 'console.log("routine check output")'],
    root: f.root,
    env: projectToolEnvironment({ root: f.root }),
    output,
  });
  assert.deepEqual(messages, []);
  await assert.rejects(
    f.publish({
      output,
      async runGate(request) {
        f.runGate(request);
        if (request.script === "verify")
          await runPublicationCommand({
            command: process.execPath,
            args: [
              "-e",
              'process.stderr.write("to"); process.stderr.write("ken=private-fixture-value\\ncheck failed\\n"); process.exitCode=1;',
            ],
            root: f.root,
            env: projectToolEnvironment({ root: f.root }),
            output,
          });
      },
    }),
    (error) => {
      assert.match(error.message, /check failed/);
      assert.doesNotMatch(error.message, /private-fixture-value/);
      return true;
    },
  );
  assert.ok(
    messages.some(
      (line) => line.includes("[FAIL] 4/8") && line.includes("Run repository verification"),
    ),
  );
  assert.ok(!messages.some((line) => line.includes("[OK] 5/8") || line.includes("Published")));
  assert.equal(f.git("rev-parse", "HEAD"), f.baseline);
  const verbose = createPublicationOutput({
    root: f.root,
    verbose: true,
    log: (line) => messages.push(line),
  });
  await runPublicationCommand({
    command: process.execPath,
    args: ["-e", 'console.log("verbose details")'],
    root: f.root,
    env: projectToolEnvironment({ root: f.root }),
    output: verbose,
  });
  assert.ok(messages.includes("verbose details"));
  messages.length = 0;
  output.fail(
    new Error(
      `Git push failed\n${"earlier hook output\n".repeat(300)}token=private-fixture-value\nfinal hook diagnostic`,
    ),
  );
  assert.match(messages.join("\n"), /Git push failed/);
  assert.match(messages.join("\n"), /final hook diagnostic/);
  assert.doesNotMatch(messages.join("\n"), /private-fixture-value/);
  assert.ok(messages.join("\n").split("\n").length < 70);
  await assert.rejects(
    runPublicationCommand({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      root: f.root,
      env: projectToolEnvironment({ root: f.root }),
      output,
      timeout: 50,
    }),
    /timed out/,
  );
});

test("failed verification preserves source and the original index without commit or push", async (t) => {
  const f = fixture(t);
  write(f.root, "source.txt", "pending verified change\n");
  await assert.rejects(
    () =>
      f.publish({
        runGate(request) {
          f.runGate(request);
          if (request.script === "verify") throw new Error("Fixture verification failed");
        },
      }),
    /verification failed/,
  );
  assert.equal(f.git("rev-parse", "HEAD"), f.baseline);
  assert.equal(f.git("diff", "--cached", "--name-only"), "");
  assert.equal(f.git("ls-remote", "origin", "refs/heads/main"), `${f.baseline}\trefs/heads/main`);
  assert.equal(readFileSync(path.join(f.root, "source.txt"), "utf8"), "pending verified change\n");
  assert.equal(existsSync(path.join(f.root, ".git/publication-hook-runs")), false);
});

test("source changed during verification never reaches a commit", async (t) => {
  const f = fixture(t);
  write(f.root, "source.txt", "candidate\n");
  await assert.rejects(
    () =>
      f.publish({
        runGate(request) {
          f.runGate(request);
          if (request.script === "verify") write(f.root, "source.txt", "unverified\n");
        },
      }),
    /Source changed after verification/,
  );
  assert.equal(f.git("rev-parse", "HEAD"), f.baseline);
  assert.equal(f.git("diff", "--cached", "--name-only"), "");
});

test("rejected push retains the verified local commit and retry creates no empty commit", async (t) => {
  const f = fixture(t);
  write(f.root, "source.txt", "candidate\n");
  write(f.root, ".git/reject-publication", "fixture rejection\n");
  await assert.rejects(() => f.publish(), /Git push failed/);
  const committed = f.git("rev-parse", "HEAD");
  assert.notEqual(committed, f.baseline);
  assert.equal(f.git("ls-remote", "origin", "refs/heads/main"), `${f.baseline}\trefs/heads/main`);
  rmSync(path.join(f.root, ".git/reject-publication"));
  assert.equal((await f.publish()).commit, committed);
  assert.equal(f.git("rev-list", "--count", "HEAD"), "2");
  assert.equal(readFileSync(path.join(f.root, ".git/publication-hook-runs"), "utf8"), "ran\nran\n");
});

test("active Codex ownership blocks reset and every publication command", async (t) => {
  const f = fixture(t);
  write(f.root, "history.jsonl", "live session\n");
  issueRuntimeSessionLease({ root: f.root, pid: process.pid });
  try {
    await assert.rejects(() => f.publish(), /active Codex sessions|Reset refused/);
    assert.equal(readFileSync(path.join(f.root, "history.jsonl"), "utf8"), "live session\n");
    assert.deepEqual(f.calls, []);
    assert.equal(f.git("rev-parse", "HEAD"), f.baseline);
  } finally {
    releaseRuntimeSessionLease({ root: f.root, pid: process.pid });
  }
});

test("ambiguous push destinations stop before reset", async (t) => {
  const f = fixture(t);
  write(f.root, "history.jsonl", "preserve\n");
  f.git("config", "remote.origin.pushurl", path.join(f.root, "elsewhere.git"));
  await assert.rejects(() => f.publish(), /same unique fetch and push destination/);
  assert.deepEqual(f.calls, []);
  assert.equal(existsSync(path.join(f.root, "history.jsonl")), true);
});

test("a commit hook cannot publish content that verification did not cover", async (t) => {
  const f = fixture(t);
  write(f.root, "source.txt", "candidate\n");
  write(
    f.root,
    ".git/hooks/pre-commit",
    '#!/bin/sh\nprintf "unverified\\n" > source.txt\ngit add source.txt\n',
    0o700,
  );
  await assert.rejects(() => f.publish(), /Source changed after verification|Commit hooks changed/);
  assert.equal(f.git("ls-remote", "origin", "refs/heads/main"), `${f.baseline}\trefs/heads/main`);
  assert.equal(existsSync(path.join(f.root, ".git/publication-hook-runs")), false);
});

test("framework publication clears source residue and preserves its calling session", async (t) => {
  const f = fixture(t);
  const lease = issueRuntimeSessionLease({ root: f.root, pid: process.pid });
  const binding = { root: f.root, pid: process.pid, runtimeSessionId: lease.sessionId };
  for (const transition of ["supervisor", "handoff", "codex"])
    transitionRuntimeSessionWriterProcess({ ...binding, transition, writerPid: process.pid });
  activateRuntimeSessionLease({ ...binding, codexSessionId: "framework-publication-fixture" });
  const active = inspectRuntimeSessionLease({ root: f.root }).lease;
  const history = "active native history\n";
  write(f.root, "history.jsonl", history);
  write(f.root, "docs/reviews/obsolete.md", "# Completed review\n");
  write(f.root, "source.txt", "source from active session\n");
  try {
    const result = await f.publish();
    assert.notEqual(result.commit, f.baseline);
    assert.deepEqual(inspectRuntimeSessionLease({ root: f.root }).lease, active);
    assert.equal(readFileSync(path.join(f.root, "history.jsonl"), "utf8"), history);
    assert.equal(existsSync(path.join(f.root, "docs/reviews")), false);
    assert.equal(f.git("status", "--porcelain"), "");
    const fullReset = spawnSync(process.execPath, [resetScript, "--root", f.root, "--apply"], {
      env: projectToolEnvironment({ root: f.root }),
      encoding: "utf8",
    });
    assert.notEqual(
      fullReset.status,
      0,
      "full runtime deletion remains blocked during the session",
    );
    assert.equal(readFileSync(path.join(f.root, "history.jsonl"), "utf8"), history);
  } finally {
    transitionRuntimeSessionWriterProcess({ ...binding, transition: "complete" });
    releaseRuntimeSessionLease({ root: f.root, pid: process.pid });
  }
});
