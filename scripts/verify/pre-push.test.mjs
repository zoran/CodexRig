import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { changedPathsFromGit, validateCurrentCheckoutForPush } from "./adaptive-state.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourceScript = path.join(root, "scripts/verify/pre-push.sh");
const sourceSteps = path.join(root, "scripts/verify/pre-push-steps.sh");
const temporaryRoots = [];

function fixture() {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "pre-push-evidence-"));
  temporaryRoots.push(fixtureRoot);
  const verifyDirectory = path.join(fixtureRoot, "scripts", "verify");
  const binDirectory = path.join(fixtureRoot, "bin");
  mkdirSync(verifyDirectory, { recursive: true });
  mkdirSync(binDirectory);
  writeFileSync(
    path.join(verifyDirectory, "pre-push.sh"),
    readFileSync(sourceSteps, "utf8"),
    "utf8",
  );
  for (const [name, content] of [
    [
      "node",
      `#!/usr/bin/env bash
printf 'node %s\n' "$*" >>"$PRE_PUSH_TEST_LOG"
if [[ "$*" == *"adaptive.mjs --mode pre-push"* && "\${PRE_PUSH_FAIL_EVIDENCE:-0}" == "1" ]]; then
  exit 9
fi
`,
    ],
    [
      "git",
      `#!/usr/bin/env bash
printf 'git %s\n' "$*" >>"$PRE_PUSH_TEST_LOG"
exit 0
`,
    ],
  ]) {
    const executable = path.join(binDirectory, name);
    writeFileSync(executable, content, "utf8");
    chmodSync(executable, 0o755);
  }
  return {
    binDirectory,
    fixtureRoot,
    logPath: path.join(fixtureRoot, "calls.log"),
    script: path.join(verifyDirectory, "pre-push.sh"),
  };
}

function runFixture(value, environment = {}) {
  return spawnSync("bash", [value.script], {
    cwd: value.fixtureRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${value.binDirectory}${path.delimiter}${process.env.PATH}`,
      PRE_PUSH_TEST_LOG: value.logPath,
      ...environment,
    },
    input: "",
    stdio: "pipe",
  });
}

function assertGit(repository, ...args) {
  const result = spawnSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
  });
  assert.equal(result.status, 0, result.stderr);
}

after(() => {
  for (const rootPath of temporaryRoots) rmSync(rootPath, { force: true, recursive: true });
});

test("pre-push keeps security checks and consumes evidence without running the full plan", () => {
  const value = fixture();
  const result = runFixture(value);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /successful verification evidence/i);
  assert.doesNotMatch(result.stdout, /complete deterministic verification plan/i);
  assert.deepEqual(readFileSync(value.logPath, "utf8").trim().split("\n"), [
    "node scripts/verify/git-remote-identity.mjs",
    "node scripts/verify/adaptive.mjs --validate-pre-push-refs",
    "node scripts/verify/pushed-object-scan.mjs",
    "node scripts/verify/adaptive.mjs --mode pre-push",
    "node scripts/verify/adaptive.mjs --validate-pre-push-refs",
  ]);
});

test("public pre-push entrypoint holds the canonical verification session lock", () => {
  const source = readFileSync(sourceScript, "utf8");
  assert.match(source, /adaptive\.mjs" --mode repo --basis-only/u);
  assert.match(source, /verification-session-lock\.mjs/u);
  assert.match(source, /--hold sh/u);
  assert.match(source, /pre-push-steps\.sh/u);
  assert.ok(source.indexOf("--basis-only") < source.indexOf("verification-session-lock.mjs"));
});

test("source-framework pre-push fails closed on resettable local state", () => {
  const source = readFileSync(sourceSteps, "utf8");
  assert.match(source, /\.agents\/skills\/reset-framework\/scripts\/reset-framework\.mjs/u);
  assert.match(source, /source_framework_contract/u);
  assert.match(source, /if \[ ! -f "\$reset_script" \]/u);
  assert.ok(source.indexOf('node "$reset_script"') < source.indexOf("--validate-pre-push-refs"));
});

test("source-framework pre-push refuses a missing reset boundary", () => {
  const value = fixture();
  mkdirSync(path.join(value.fixtureRoot, ".codexrig"));
  writeFileSync(path.join(value.fixtureRoot, ".codexrig", "framework.json"), "{}\n", "utf8");

  const result = runFixture(value);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires the reset boundary/);
});

test("source-framework pre-push runs the reset preview before checkout validation", () => {
  const value = fixture();
  mkdirSync(path.join(value.fixtureRoot, ".codexrig"));
  writeFileSync(path.join(value.fixtureRoot, ".codexrig", "framework.json"), "{}\n", "utf8");
  const resetScript = path.join(
    value.fixtureRoot,
    ".agents",
    "skills",
    "reset-framework",
    "scripts",
    "reset-framework.mjs",
  );
  mkdirSync(path.dirname(resetScript), { recursive: true });
  writeFileSync(resetScript, "// fixture\n", "utf8");

  const result = runFixture(value);
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(value.logPath, "utf8").trim().split("\n");
  assert.equal(calls[1], `node ${path.relative(value.fixtureRoot, resetScript)}`);
  assert.equal(calls[2], "node scripts/verify/adaptive.mjs --validate-pre-push-refs");
});

test("the installed hook cannot be skipped through BASH_ENV", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "pre-push-bash-env-"));
  temporaryRoots.push(parent);
  const repository = path.join(parent, "project");
  const remote = path.join(parent, "remote.git");
  const sentinel = path.join(parent, "hook-ran");
  const decoySentinel = path.join(parent, "decoy-hook-ran");
  const decoy = path.join(parent, "decoy");
  const binDirectory = path.join(parent, "bin");
  const startup = path.join(parent, "bash-startup");
  const nodePreload = path.join(parent, "node-preload.cjs");
  const nodePreloadSentinel = path.join(parent, "node-preload-ran");
  mkdirSync(binDirectory);
  mkdirSync(path.join(repository, "scripts", "git-hooks"), { recursive: true });
  mkdirSync(path.join(repository, "scripts", "repository"), { recursive: true });
  mkdirSync(path.join(repository, "scripts", "setup"), { recursive: true });
  mkdirSync(path.join(repository, "scripts", "verify"), { recursive: true });
  for (const relativePath of [
    "scripts/git-hooks/pre-push",
    "scripts/repository/git-runtime-isolation.mjs",
    "scripts/setup/install-git-hooks.mjs",
    "scripts/setup/install-git-hooks.sh",
    "scripts/setup/resolve-git-hooks-path.mjs",
  ]) {
    copyFileSync(path.join(root, relativePath), path.join(repository, relativePath));
  }
  writeFileSync(
    path.join(repository, "scripts", "verify", "pre-push.sh"),
    `#!/bin/sh\nprintf 'ran\\n' >${JSON.stringify(sentinel)}\nexit 17\n`,
    "utf8",
  );
  const fakeMise = path.join(binDirectory, "mise");
  writeFileSync(
    fakeMise,
    `#!/bin/sh
set -eu
if [ "$1" != "exec" ] || [ "$2" != "--locked" ] || [ "$3" != "--" ] ||
   [ "$4" != "pnpm" ] || [ "$5" != "verify:pre-push" ]; then
  exit 91
fi
shift 5
if [ "\${1:-}" = "--" ]; then shift; fi
exec sh "$PWD/scripts/verify/pre-push.sh" "$@"
`,
    "utf8",
  );
  chmodSync(fakeMise, 0o755);
  writeFileSync(path.join(repository, "tracked.txt"), "initial\n", "utf8");
  assertGit(repository, "init", "-q");
  assertGit(repository, "config", "user.name", "Pre-Push Hook Test");
  assertGit(repository, "config", "user.email", "pre-push-hook@example.invalid");
  assertGit(repository, "add", ".");
  assertGit(repository, "commit", "-q", "-m", "initial");
  const installed = spawnSync("bash", ["scripts/setup/install-git-hooks.sh"], {
    cwd: repository,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
  });
  assert.equal(installed.status, 0, installed.stderr);
  assertGit(parent, "init", "--bare", "-q", remote);
  assertGit(repository, "remote", "add", "origin", remote);
  mkdirSync(path.join(decoy, "scripts", "verify"), { recursive: true });
  writeFileSync(
    path.join(decoy, "scripts", "verify", "pre-push.sh"),
    `#!/bin/sh\nprintf 'decoy\\n' >${JSON.stringify(decoySentinel)}\nexit 0\n`,
    "utf8",
  );
  assertGit(repository, "config", "core.worktree", decoy);
  writeFileSync(startup, "exit 0\n", "utf8");
  writeFileSync(
    nodePreload,
    `require("node:fs").writeFileSync(${JSON.stringify(nodePreloadSentinel)}, "preloaded\\n"); process.exit(0);\n`,
    "utf8",
  );

  const pushed = spawnSync("git", ["push", "-q", "origin", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...process.env,
      BASH_ENV: startup,
      NODE_OPTIONS: `--require=${nodePreload}`,
      NODE_PATH: path.join(parent, "node-path"),
      PATH: `${binDirectory}${path.delimiter}${process.env.PATH}`,
    },
    input: "",
    stdio: "pipe",
  });
  assert.equal(pushed.status, 1);
  assert.equal(readFileSync(sentinel, "utf8"), "ran\n");
  assert.throws(() => readFileSync(decoySentinel, "utf8"), /ENOENT/u);
  assert.throws(() => readFileSync(nodePreloadSentinel, "utf8"), /ENOENT/u);
});

test("missing or stale evidence blocks before final checkout acceptance", () => {
  const value = fixture();
  const result = runFixture(value, { PRE_PUSH_FAIL_EVIDENCE: "1" });
  assert.equal(result.status, 9);
  assert.deepEqual(readFileSync(value.logPath, "utf8").trim().split("\n"), [
    "node scripts/verify/git-remote-identity.mjs",
    "node scripts/verify/adaptive.mjs --validate-pre-push-refs",
    "node scripts/verify/pushed-object-scan.mjs",
    "node scripts/verify/adaptive.mjs --mode pre-push",
  ]);
});

test("checkout validation ignores ambient Git overrides and rejects hidden index flags", () => {
  const repository = mkdtempSync(path.join(os.tmpdir(), "pre-push-checkout-"));
  temporaryRoots.push(repository);
  writeFileSync(path.join(repository, "tracked.txt"), "committed\n", "utf8");
  assertGit(repository, "init", "-q");
  assertGit(repository, "config", "user.name", "Pre-Push Test");
  assertGit(repository, "config", "user.email", "pre-push@example.invalid");
  assertGit(repository, "add", "tracked.txt");
  assertGit(repository, "commit", "-q", "-m", "initial");

  const previousIndex = process.env.GIT_INDEX_FILE;
  try {
    process.env.GIT_INDEX_FILE = path.join(repository, "ambient-poison-index");
    assert.equal(
      validateCurrentCheckoutForPush("", { repositoryRoot: repository }).directInvocation,
      true,
    );
  } finally {
    if (previousIndex === undefined) delete process.env.GIT_INDEX_FILE;
    else process.env.GIT_INDEX_FILE = previousIndex;
  }

  assertGit(repository, "update-index", "--skip-worktree", "tracked.txt");
  writeFileSync(path.join(repository, "tracked.txt"), "hidden change\n", "utf8");
  assert.throws(
    () => validateCurrentCheckoutForPush("", { repositoryRoot: repository }),
    /skip-worktree or assume-unchanged/i,
  );

  assertGit(repository, "update-index", "--no-skip-worktree", "tracked.txt");
  assert.throws(
    () => validateCurrentCheckoutForPush("", { repositoryRoot: repository }),
    /clean working tree/i,
  );

  writeFileSync(path.join(repository, "tracked.txt"), "committed\n", "utf8");
  assertGit(repository, "update-index", "--assume-unchanged", "tracked.txt");
  writeFileSync(path.join(repository, "tracked.txt"), "assume-unchanged change\n", "utf8");
  assert.throws(
    () => validateCurrentCheckoutForPush("", { repositoryRoot: repository }),
    /skip-worktree or assume-unchanged/i,
  );

  assertGit(repository, "update-index", "--no-assume-unchanged", "tracked.txt");
  writeFileSync(path.join(repository, "tracked.txt"), "committed\n", "utf8");
  writeFileSync(
    path.join(repository, ".git", "info", "exclude"),
    "src/hidden-helper.mjs\n",
    "utf8",
  );
  mkdirSync(path.join(repository, "src"), { recursive: true });
  writeFileSync(path.join(repository, "src", "hidden-helper.mjs"), "export const hidden = true;\n");
  assert.throws(
    () => validateCurrentCheckoutForPush("", { repositoryRoot: repository }),
    /repository-local Git excludes/i,
  );
});

test("changed-path discovery includes clean commits ahead of the configured upstream", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "changed-path-upstream-"));
  temporaryRoots.push(parent);
  const repository = path.join(parent, "project");
  const remote = path.join(parent, "remote.git");
  mkdirSync(repository);
  writeFileSync(path.join(repository, "README.md"), "initial\n", "utf8");
  assertGit(repository, "init", "-q");
  assertGit(repository, "config", "user.name", "Changed Path Test");
  assertGit(repository, "config", "user.email", "changed-path@example.invalid");
  assertGit(repository, "add", "README.md");
  assertGit(repository, "commit", "-q", "-m", "initial");
  assertGit(parent, "init", "--bare", "-q", remote);
  assertGit(repository, "remote", "add", "origin", remote);
  assertGit(repository, "push", "-q", "-u", "origin", "HEAD");

  writeFileSync(path.join(repository, "README.md"), "committed documentation change\n", "utf8");
  assertGit(repository, "add", "README.md");
  assertGit(repository, "commit", "-q", "-m", "docs change");
  const changed = changedPathsFromGit({ repositoryRoot: repository });
  assert.equal(changed.incomplete, false);
  assert.deepEqual(changed.paths, ["README.md"]);
});
