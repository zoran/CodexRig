/** Verifies goal publication precondition behavior for the goal closure and repository housekeeping boundary. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareProjectToolDirectories } from "../repository/project-tool-environment.mjs";
import { importSpecifiersForFile } from "../repository/source-import-specifiers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixturePackageManager = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
).packageManager;
const temporaryRoots = [];

function temporaryRoot(prefix) {
  const value = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(value);
  return value;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
  });
  assert.equal(result.error, undefined);
  return result;
}

function git(cwd, ...args) {
  return run("git", args, cwd);
}

function assertGit(cwd, ...args) {
  const result = git(cwd, ...args);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function copyGoalGateRuntime(repository) {
  // Copy the tested public entries and their actual module closure. A second handwritten
  // dependency list drifts whenever the production runtime gains an import.
  const pending = [
    ".codex/tooling.json",
    "scripts/goals/goal-publication-precondition.mjs",
    "scripts/verify/adaptive.mjs",
  ];
  const copied = new Set();
  while (pending.length) {
    const relativePath = pending.pop();
    if (copied.has(relativePath)) continue;
    assert.ok(!path.isAbsolute(relativePath) && !relativePath.split("/").includes(".."));
    copied.add(relativePath);
    const source = path.join(root, relativePath);
    const target = path.join(repository, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    if (!relativePath.endsWith(".mjs")) continue;
    for (const specifier of importSpecifiersForFile({
      relativePath,
      content: readFileSync(source, "utf8"),
    })) {
      if (specifier.startsWith("."))
        pending.push(
          path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), specifier)),
        );
    }
  }
  // Exercise the shipped evidence contract with a real fixture check, not a fabricated
  // success for every source-framework command (including external observations).
  writeFileSync(
    path.join(repository, ".codex/verification.json"),
    JSON.stringify({
      schemaVersion: 1,
      commands: [
        {
          key: "fixture-source",
          label: "goal fixture source",
          reason: "verify the tracked goal fixture input",
          executable: "$node",
          args: [
            "--eval",
            "require('node:assert/strict').notEqual(require('node:fs').readFileSync('tracked.txt', 'utf8').trim(), '');",
          ],
          phase: "preflight",
          reuseMaxAgeMs: 300_000,
        },
      ],
      prePushChecks: [],
      risks: [],
      exactConsumers: { "tracked.txt": ["fixture-source"] },
      testConsumers: {},
      ownedCategories: {},
    }),
  );
}

function recordFixtureEvidence(repository) {
  const runnerUrl = pathToFileURL(path.join(repository, "scripts/verify/adaptive-runner.mjs")).href;
  const adaptiveUrl = pathToFileURL(path.join(repository, "scripts/verify/adaptive.mjs")).href;
  const evidenceUrl = pathToFileURL(
    path.join(repository, "scripts/verify/verification-evidence.mjs"),
  ).href;
  const basisUrl = pathToFileURL(
    path.join(repository, "scripts/verify/verification-git-basis.mjs"),
  ).href;
  const lockUrl = pathToFileURL(
    path.join(repository, "scripts/verify/verification-session-lock.mjs"),
  ).href;
  const checkInputsUrl = pathToFileURL(
    path.join(repository, "scripts/verify/verification-check-inputs.mjs"),
  ).href;
  const configurationUrl = pathToFileURL(
    path.join(repository, "scripts/verify/verification-configuration.mjs"),
  ).href;
  const source = `
    const { buildPlan, runPlan } = await import(${JSON.stringify(runnerUrl)});
    const { broadEvidencePlan } = await import(${JSON.stringify(adaptiveUrl)});
    const {
      currentVerificationEvidenceInputs,
      recordSuccessfulFullEvidence,
    } = await import(${JSON.stringify(evidenceUrl)});
    const { captureVerificationGitBasis } = await import(${JSON.stringify(basisUrl)});
    const { acquireVerificationSessionLock } = await import(${JSON.stringify(lockUrl)});
    const { verificationCheckFingerprints } = await import(${JSON.stringify(checkInputsUrl)});
    const { readVerificationConfiguration } = await import(${JSON.stringify(configurationUrl)});
    const plan = buildPlan({ mode: "full", printPlan: false, simulatedPaths: [] });
    const broadPlan = broadEvidencePlan(plan);
    const expectedInputs = currentVerificationEvidenceInputs({ broadPlan });
    const expectedGitBasis = captureVerificationGitBasis({ repositoryRoot: ${JSON.stringify(repository)} });
    const lock = acquireVerificationSessionLock({ repositoryRoot: ${JSON.stringify(repository)} });
    try {
      const commands = [...plan.readOnlyCommands, ...plan.workspaceCommands];
      const fingerprints = verificationCheckFingerprints({
        commands,
        inputs: expectedInputs,
        configuration: readVerificationConfiguration(),
        repositoryRoot: ${JSON.stringify(repository)},
        workspaceManifests: [],
      });
      const checks = [];
      await runPlan(plan, {
        repositoryRoot: ${JSON.stringify(repository)},
        onResult(result) {
          if (result.status === 0 && !result.error && !result.diagnosticRequired)
            checks.push({
              key: result.command.key,
              fingerprint: fingerprints.get(result.command.key),
              completedAt: new Date().toISOString(),
              elapsedMs: result.elapsedMs,
            });
        },
      });
      recordSuccessfulFullEvidence({
        broadPlan, expectedGitBasis, expectedInputs, checks,
        successfulCommandKeys: commands.map((command) => command.key)
      });
    } finally {
      lock.release();
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: repository,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
  });
  assert.equal(result.status, 0, result.stderr);
}

function createFixture() {
  const parent = temporaryRoot("goal gate private workspace ");
  const repository = path.join(parent, "project-secret-name");
  const remote = path.join(parent, "remote-secret-name.git");
  copyGoalGateRuntime(repository);
  prepareProjectToolDirectories(repository);
  writeFileSync(
    path.join(repository, ".gitignore"),
    "/auth.json\n/.auth/\n/.codex/runtime/\n/cache/\n",
    "utf8",
  );
  writeFileSync(
    path.join(repository, "package.json"),
    `${JSON.stringify({
      name: "goal-gate-fixture",
      packageManager: fixturePackageManager,
      private: true,
    })}\n`,
    "utf8",
  );
  writeFileSync(path.join(repository, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
  writeFileSync(path.join(repository, "tracked.txt"), "initial\n", "utf8");
  assertGit(repository, "init", "-q", "-b", "main");
  assertGit(repository, "config", "user.name", "Goal Gate Test");
  assertGit(repository, "config", "user.email", "goal-gate@example.invalid");
  assertGit(repository, "add", "-A");
  assertGit(repository, "commit", "-q", "-m", "initial");
  recordFixtureEvidence(repository);
  assertGit(parent, "init", "--bare", "-q", "-b", "main", remote);
  assertGit(repository, "remote", "add", "origin", remote);
  assertGit(repository, "push", "-q", "-u", "origin", "HEAD");
  return { parent, remote, repository };
}

function runGate(repository, options = {}) {
  return spawnSync(
    process.execPath,
    [path.join(repository, "scripts/goals/goal-publication-precondition.mjs")],
    {
      cwd: options.cwd ?? repository,
      encoding: "utf8",
      env: { ...process.env, ...(options.env ?? {}) },
      input: "",
      stdio: "pipe",
    },
  );
}

function outputOf(result) {
  return `${result.stdout}${result.stderr}`;
}

function verificationEvidencePath(repository) {
  return path.join(
    repository,
    ".codex",
    "runtime",
    "cache",
    "project-verification",
    "evidence.json",
  );
}

after(() => {
  for (const temporaryRootPath of temporaryRoots) {
    rmSync(temporaryRootPath, { force: true, recursive: true });
  }
});

test("goal:new passes only for clean central main that exactly matches its upstream", () => {
  const { parent, repository } = createFixture();
  writeFileSync(path.join(repository, "auth.json"), "ignored local runtime\n", "utf8");
  mkdirSync(path.join(repository, "cache"));
  writeFileSync(path.join(repository, "cache", "manifest.json"), "{}\n", "utf8");

  const result = runGate(repository, { cwd: parent });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /publication precondition passed/i);
  assert.equal(outputOf(result).includes(parent), false);
  assert.equal(outputOf(result).includes("secret-name"), false);
});

test("goal:new rejects missing exact-current successful verification evidence", () => {
  const { parent, repository } = createFixture();
  rmSync(verificationEvidencePath(repository));
  const result = runGate(repository);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no exact-current successful verification evidence/i);
  assert.equal(outputOf(result).includes(parent), false);
});

test("goal:new fails closed for dirty, unpublished, missing-upstream, behind, and detached states", () => {
  const { parent, remote, repository } = createFixture();

  writeFileSync(path.join(repository, "unfinished-secret.txt"), "dirty\n", "utf8");
  const dirty = runGate(repository);
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /resolve all non-ignored work/i);
  rmSync(path.join(repository, "unfinished-secret.txt"));

  writeFileSync(path.join(repository, "tracked.txt"), "unpublished\n", "utf8");
  assertGit(repository, "add", "tracked.txt");
  assertGit(repository, "commit", "-q", "-m", "unpublished completion");
  recordFixtureEvidence(repository);
  const ahead = runGate(repository);
  assert.equal(ahead.status, 1);
  assert.match(ahead.stderr, /ahead 1, behind 0/);
  assertGit(repository, "push", "-q");
  assert.equal(runGate(repository).status, 0);

  const branch = git(repository, "branch", "--show-current").stdout.trim();
  assertGit(repository, "branch", "--unset-upstream");
  const noUpstream = runGate(repository);
  assert.equal(noUpstream.status, 1);
  assert.match(noUpstream.stderr, /no verifiable configured remote upstream/i);
  assertGit(repository, "branch", `--set-upstream-to=origin/${branch}`);

  assertGit(repository, "checkout", "-q", "-b", "temporary-task-branch");
  const taskBranch = runGate(repository);
  assert.equal(taskBranch.status, 1);
  assert.match(taskBranch.stderr, /central main branch/i);
  assertGit(repository, "checkout", "-q", "main");

  const publisher = path.join(parent, "publisher-secret-name");
  assertGit(parent, "clone", "-q", remote, publisher);
  assertGit(publisher, "config", "user.name", "Goal Gate Publisher");
  assertGit(publisher, "config", "user.email", "goal-publisher@example.invalid");
  writeFileSync(path.join(publisher, "remote.txt"), "remote completion\n", "utf8");
  assertGit(publisher, "add", "remote.txt");
  assertGit(publisher, "commit", "-q", "-m", "remote completion");
  assertGit(publisher, "push", "-q");
  assertGit(repository, "fetch", "-q");
  const behind = runGate(repository);
  assert.equal(behind.status, 1);
  assert.match(behind.stderr, /ahead 0, behind 1/i);
  assert.equal(outputOf(behind).includes(parent), false);

  assertGit(repository, "checkout", "--detach", "-q");
  const detached = runGate(repository);
  assert.equal(detached.status, 1);
  assert.match(detached.stderr, /named branch/i);
  assert.equal(outputOf(detached).includes(parent), false);
});

test("goal:new ignores ambient Git redirection and fails outside its own project root", () => {
  const { remote, repository } = createFixture();
  const result = runGate(repository, {
    env: {
      GIT_DIR: remote,
      GIT_WORK_TREE: path.dirname(remote),
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.bare",
      GIT_CONFIG_VALUE_0: "true",
    },
  });
  assert.equal(result.status, 0, result.stderr);

  const nonRepositoryParent = temporaryRoot("goal gate parent repository ");
  assertGit(nonRepositoryParent, "init", "-q");
  const nonRepository = path.join(nonRepositoryParent, "nested-project");
  mkdirSync(nonRepository);
  copyGoalGateRuntime(nonRepository);
  const missing = runGate(nonRepository);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /not a Git worktree/i);
  assert.equal(outputOf(missing).includes(nonRepository), false);
});

test("goal:new binds its worktree and disables repository-local FSMonitor execution", () => {
  const { parent, repository } = createFixture();
  const redirectedWorktree = path.join(parent, "redirected-worktree");
  const sentinel = path.join(parent, "fsmonitor-was-invoked");
  const fsmonitor = path.join(parent, "fsmonitor-hook.mjs");
  mkdirSync(redirectedWorktree);
  writeFileSync(
    fsmonitor,
    '#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nif (process.env.FSMONITOR_SENTINEL) writeFileSync(process.env.FSMONITOR_SENTINEL, "called\\n");\nprocess.exitCode = 1;\n',
    "utf8",
  );
  chmodSync(fsmonitor, 0o755);
  assertGit(repository, "config", "core.fsmonitor", `'${fsmonitor}'`);
  writeFileSync(path.join(repository, "tracked.txt"), "force fsmonitor refresh\n", "utf8");
  const enableFsmonitor = spawnSync("git", ["update-index", "--fsmonitor"], {
    cwd: repository,
    encoding: "utf8",
    env: { ...process.env, FSMONITOR_SENTINEL: sentinel },
  });
  assert.equal(enableFsmonitor.status, 0, enableFsmonitor.stderr);
  const naiveStatus = spawnSync("git", ["status", "--porcelain=v1"], {
    cwd: repository,
    encoding: "utf8",
    env: { ...process.env, FSMONITOR_SENTINEL: sentinel },
  });
  assert.equal(naiveStatus.status, 0, naiveStatus.stderr);
  assert.equal(existsSync(sentinel), true);
  rmSync(sentinel);
  writeFileSync(path.join(repository, "tracked.txt"), "initial\n", "utf8");
  assertGit(repository, "config", "core.worktree", redirectedWorktree);
  const naiveRoot = git(repository, "rev-parse", "--show-toplevel");
  assert.equal(naiveRoot.status, 0, naiveRoot.stderr);
  assert.equal(path.resolve(naiveRoot.stdout.trim()), redirectedWorktree);

  const result = runGate(repository, { env: { FSMONITOR_SENTINEL: sentinel } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(sentinel), false);
  assert.equal(outputOf(result).includes(parent), false);
});

test("goal:new overrides local stat-cache weakening before proving a clean worktree", () => {
  const { parent, repository } = createFixture();
  const tracked = path.join(repository, "tracked.txt");
  const stableTime = new Date(Math.floor(Date.now() / 1000 - 60) * 1000);
  writeFileSync(tracked, "AAAA\n", "utf8");
  utimesSync(tracked, stableTime, stableTime);
  assertGit(repository, "add", "tracked.txt");
  assertGit(repository, "commit", "-q", "-m", "stable stat fixture");
  assertGit(repository, "push", "-q");
  const baseline = statSync(tracked);
  assertGit(repository, "config", "core.trustctime", "false");
  assertGit(repository, "config", "core.checkStat", "minimal");
  writeFileSync(tracked, "BBBB\n", "utf8");
  utimesSync(tracked, baseline.atime, baseline.mtime);
  const hiddenStatus = git(repository, "status", "--porcelain=v1");
  assert.equal(hiddenStatus.status, 0, hiddenStatus.stderr);
  assert.equal(hiddenStatus.stdout, "");

  const result = runGate(repository);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /resolve all non-ignored work/i);
  assert.equal(outputOf(result).includes(parent), false);
});

test("goal:new rejects skip-worktree and assume-unchanged index flags", () => {
  for (const flag of ["--skip-worktree", "--assume-unchanged"]) {
    const { parent, repository } = createFixture();
    assertGit(repository, "update-index", flag, "tracked.txt");
    writeFileSync(path.join(repository, "tracked.txt"), "hidden change\n", "utf8");
    const hiddenStatus = git(repository, "status", "--porcelain=v1");
    assert.equal(hiddenStatus.status, 0, hiddenStatus.stderr);
    assert.equal(hiddenStatus.stdout, "");

    const result = runGate(repository);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /skip-worktree and assume-unchanged/i);
    assert.equal(outputOf(result).includes(parent), false);
  }
});

test("goal:new cannot hide unfinished work through ambient Git exclude configuration", () => {
  const { parent, repository } = createFixture();
  const unfinishedName = "unfinished-private.txt";
  const excludesPath = path.join(parent, "ambient-excludes");
  const globalConfigPath = path.join(parent, "ambient-global-config");
  const xdgConfigHome = path.join(parent, "ambient-xdg-config");
  mkdirSync(path.join(xdgConfigHome, "git"), { recursive: true });
  writeFileSync(path.join(repository, unfinishedName), "unfinished\n", "utf8");
  writeFileSync(excludesPath, `${unfinishedName}\n`, "utf8");
  writeFileSync(path.join(xdgConfigHome, "git", "ignore"), `${unfinishedName}\n`, "utf8");
  assertGit(parent, "config", "--file", globalConfigPath, "core.excludesFile", excludesPath);
  const ambientEnvironment = {
    GIT_CONFIG_GLOBAL: globalConfigPath,
    GIT_CONFIG_NOSYSTEM: "0",
    GIT_CONFIG_PARAMETERS: `'core.excludesFile'='${excludesPath}'`,
    GIT_CONFIG_SYSTEM: globalConfigPath,
    XDG_CONFIG_HOME: xdgConfigHome,
  };
  const hiddenStatus = spawnSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    {
      cwd: repository,
      encoding: "utf8",
      env: { ...process.env, ...ambientEnvironment },
      input: "",
      stdio: "pipe",
    },
  );
  assert.equal(hiddenStatus.status, 0, hiddenStatus.stderr);
  assert.equal(hiddenStatus.stdout, "");

  const result = runGate(repository, { env: ambientEnvironment });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /resolve all non-ignored work/i);
  assert.equal(outputOf(result).includes(parent), false);
});

test("goal:new rejects repository-local Git exclude rules", () => {
  const { parent, repository } = createFixture();
  const unfinishedName = "unfinished-local.txt";
  writeFileSync(path.join(repository, unfinishedName), "unfinished\n", "utf8");
  writeFileSync(path.join(repository, ".git", "info", "exclude"), `${unfinishedName}\n`, "utf8");
  const hiddenStatus = git(repository, "status", "--porcelain=v1", "--untracked-files=all");
  assert.equal(hiddenStatus.status, 0, hiddenStatus.stderr);
  assert.equal(hiddenStatus.stdout, "");

  const result = runGate(repository);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /repository-local Git exclude rules/i);
  assert.equal(outputOf(result).includes(parent), false);
});

test("goal:new rejects an unsafe repository-local exclude identity", () => {
  const { parent, repository } = createFixture();
  linkSync(
    path.join(repository, ".git", "info", "exclude"),
    path.join(repository, ".git", "info", "exclude-alias"),
  );

  const result = runGate(repository);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /active or unsafe repository-local Git exclude rules/i);
  assert.equal(outputOf(result).includes(parent), false);
});

test("goal:new rejects a local branch masquerading as a publication upstream", () => {
  const { repository } = createFixture();
  assertGit(repository, "branch", "local-proof", "HEAD");
  assertGit(repository, "branch", "--set-upstream-to=local-proof");

  const result = runGate(repository);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no verifiable configured remote upstream/i);
});

test("goal:new rejects central main tracking a differently named remote branch", () => {
  const { repository } = createFixture();
  assertGit(repository, "branch", "remote-task-proof", "HEAD");
  assertGit(repository, "push", "-q", "origin", "remote-task-proof");
  assertGit(repository, "branch", "--set-upstream-to=origin/remote-task-proof", "main");

  const result = runGate(repository);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /central main branch must track the remote main branch/i);
});
