/** Verifies same-host worktree recovery inventory for the repository boundary. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { issueRuntimeSessionLease, releaseRuntimeSessionLease } from "./runtime-session-lease.mjs";
import { acquireVerificationSessionLock } from "../verify/verification-session-lock.mjs";
import {
  formatWorktreeRecoveryJson,
  formatWorktreeRecoveryLine,
  inspectRepositoryWorktrees,
  parseWorktreeRecoveryArguments,
  reconcileRepositoryWorktreeState,
  worktreePreservationLockReason,
} from "./worktree-recovery.mjs";
import {
  clearStaleWorktreePathReservation,
  inspectWorktreePathReservation,
  reserveMissingWorktreePaths,
} from "./worktree-path-reservation.mjs";
import { captureProcessIdentity } from "./runtime-process-identity.mjs";
import { createWorktreePreservationLockReason } from "./worktree-preservation-lock.mjs";
import {
  beginWorktreePruneTransaction,
  inspectWorktreePruneTransaction,
} from "./worktree-prune-transaction.mjs";

const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function temporaryRoot(prefix) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function git(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: os.devNull,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    },
    input: "",
    stdio: "pipe",
  });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}

function createCommittedRepository(parent, { initialBranch = "main" } = {}) {
  const repository = path.join(parent, "project");
  mkdirSync(repository);
  git(repository, ["init", "--quiet", `--initial-branch=${initialBranch}`]);
  git(repository, ["config", "user.name", "CodexRig Test"]);
  git(repository, ["config", "user.email", "codexrig@example.invalid"]);
  writeFileSync(path.join(repository, ".gitignore"), ".codex/runtime/\n", "utf8");
  writeFileSync(path.join(repository, "tracked.txt"), "base\n", "utf8");
  git(repository, ["add", ".gitignore", "tracked.txt"]);
  git(repository, ["commit", "--quiet", "-m", "base"]);
  return repository;
}

function abandonedReservation(candidate) {
  const moduleUrl = new URL("./worktree-path-reservation.mjs", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { reserveMissingWorktreePaths } from ${JSON.stringify(moduleUrl)}; reserveMissingWorktreePaths([${JSON.stringify(candidate)}]);`,
    ],
    { encoding: "utf8", stdio: "pipe" },
  );
  assert.equal(result.status, 0, result.stderr);
}

function abandonedPreservationReason() {
  const moduleUrl = new URL("./worktree-recovery.mjs", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { createWorktreePreservationLockReason } from ${JSON.stringify(moduleUrl)}; process.stdout.write(createWorktreePreservationLockReason());`,
    ],
    { encoding: "utf8", stdio: "pipe" },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function abandonedPostPruneTransaction(repository, commonGitDirectory, candidate) {
  const transactionUrl = new URL("./worktree-prune-transaction.mjs", import.meta.url).href;
  const reservationUrl = new URL("./worktree-path-reservation.mjs", import.meta.url).href;
  const preservationUrl = new URL("./worktree-preservation-lock.mjs", import.meta.url).href;
  const processIdentityUrl = new URL("./runtime-process-identity.mjs", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        `import { spawnSync } from "node:child_process";`,
        `import { beginWorktreePruneTransaction } from ${JSON.stringify(transactionUrl)};`,
        `import { reserveMissingWorktreePaths } from ${JSON.stringify(reservationUrl)};`,
        `import { createWorktreePreservationLockReason } from ${JSON.stringify(preservationUrl)};`,
        `import { captureProcessIdentity } from ${JSON.stringify(processIdentityUrl)};`,
        `const owner = captureProcessIdentity(process.pid);`,
        `const reason = createWorktreePreservationLockReason({ owner });`,
        `beginWorktreePruneTransaction(${JSON.stringify(commonGitDirectory)}, [${JSON.stringify(candidate)}], owner, reason);`,
        `reserveMissingWorktreePaths([${JSON.stringify(candidate)}]);`,
        `const pruned = spawnSync("git", ["worktree", "prune", "--expire=now"], { cwd: ${JSON.stringify(repository)}, encoding: "utf8", stdio: "pipe" });`,
        `if (pruned.status !== 0) { process.stderr.write(pruned.stderr); process.exit(91); }`,
      ].join("\n"),
    ],
    { encoding: "utf8", stdio: "pipe" },
  );
  assert.equal(result.status, 0, result.stderr);
}

test("worktree recovery accepts pnpm's option delimiter", () => {
  assert.deepEqual(parseWorktreeRecoveryArguments([]), { json: false });
  assert.deepEqual(parseWorktreeRecoveryArguments(["--json"]), { json: true });
  assert.deepEqual(parseWorktreeRecoveryArguments(["--", "--json"]), { json: true });
  assert.throws(() => parseWorktreeRecoveryArguments(["--", "--json", "unexpected"]), /Usage/u);
  assert.equal(
    formatWorktreeRecoveryLine({
      branch: "main",
      current: false,
      path: "/tmp/worktree\nspoof",
      session: { status: "absent" },
      unfinished: true,
    }),
    'unfinished\tmain\tabsent\t"/tmp/worktree\\nspoof"',
  );

  const unsafeCharacters = "\u0085\u200b\u2028\u202e";
  const exactPath = `/tmp/${unsafeCharacters}/path`;
  const line = formatWorktreeRecoveryLine({
    branch: `topic/${unsafeCharacters}`,
    current: false,
    path: exactPath,
    session: { status: "absent" },
    unfinished: true,
  });
  for (const character of unsafeCharacters) assert.equal(line.includes(character), false);
  assert.match(line, /\\u0085\\u200b\\u2028\\u202e/u);
  assert.equal(JSON.parse(line.split("\t").at(-1)), exactPath);

  const json = formatWorktreeRecoveryJson({ path: exactPath });
  for (const character of unsafeCharacters) assert.equal(json.includes(character), false);
  assert.deepEqual(JSON.parse(json), { path: exactPath });
});

test("Git-less project roots remain valid and clear stale private writer state", () => {
  const root = temporaryRoot("codexrig-gitless-recovery-");
  const leaseModule = new URL("./runtime-session-lease.mjs", import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { issueRuntimeSessionLease } from ${JSON.stringify(leaseModule)}; issueRuntimeSessionLease({ root: ${JSON.stringify(root)}, pid: process.pid });`,
    ],
    { cwd: root, encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.equal(child.status, 0, child.stderr);

  const inventory = inspectRepositoryWorktrees({ root });
  assert.equal(inventory.repositoryKind, "gitless");
  assert.equal(inventory.integrationBranch, null);
  assert.equal(inventory.worktrees.length, 1);
  assert.equal(inventory.worktrees[0].current, true);
  assert.equal(inventory.worktrees[0].session.status, "stale");
  const verificationLock = acquireVerificationSessionLock({ repositoryRoot: root });
  let reconciled;
  try {
    reconciled = reconcileRepositoryWorktreeState({
      root,
      apply: true,
      lifecycleCapability: verificationLock.lifecycleCapability,
    });
  } finally {
    verificationLock.release();
  }
  assert.deepEqual(reconciled.blockingFindings, []);
  assert.deepEqual(reconciled.driftFindings, []);
  assert.equal(reconciled.inventory.worktrees[0].session.status, "absent");

  writeFileSync(path.join(root, ".codex/runtime/codexrig-session-recovery.json"), "{invalid\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  const advisory = reconcileRepositoryWorktreeState({ root, apply: true });
  assert.deepEqual(advisory.blockingFindings, []);
  assert.deepEqual(advisory.driftFindings, []);
  assert.match(advisory.advisoryFindings.join("\n"), /recovery metadata is invalid/u);
  assert.equal(advisory.inventory.worktrees[0].session.recoveryStatus, "invalid");
});

test("an invalid lease blocks prune without suppressing safe same-clone inventory", () => {
  const parent = temporaryRoot("codexrig-invalid-lease-worktree-");
  const repository = createCommittedRepository(parent);
  const missingWorktree = path.join(parent, "missing-worktree");
  git(repository, [
    "worktree",
    "add",
    "--quiet",
    "-b",
    "codexrig/work/missing-invalid-lease",
    missingWorktree,
  ]);
  rmSync(missingWorktree, { force: true, recursive: true });
  const leasePath = path.join(repository, ".codex/runtime/codexrig-session.json");
  mkdirSync(path.dirname(leasePath), { recursive: true });
  writeFileSync(leasePath, '{"schemaVersion":999}\n', { encoding: "utf8", mode: 0o600 });
  const initialLease = readFileSync(leasePath, "utf8");

  const inventory = inspectRepositoryWorktrees({ root: repository });
  assert.equal(inventory.repositoryKind, "git");
  assert.equal(inventory.complete, true);
  assert.equal(inventory.worktrees.length, 2);
  assert.equal(inventory.worktrees.find(({ current }) => current).session.status, "invalid");
  assert.equal(
    inventory.worktrees.some(({ path: candidate }) => candidate === missingWorktree),
    true,
  );

  let pruneAttempted = false;
  const reconciled = reconcileRepositoryWorktreeState({
    root: repository,
    apply: true,
    testHooks: {
      beforeMissingWorktreePrune() {
        pruneAttempted = true;
      },
    },
  });
  assert.equal(pruneAttempted, false);
  assert.match(reconciled.blockingFindings.join("\n"), /session metadata is invalid/u);
  assert.equal(readFileSync(leasePath, "utf8"), initialLease);
  assert.equal(
    reconciled.inventory.worktrees.some(({ path: candidate }) => candidate === missingWorktree),
    true,
  );
});

test("unsafe current Git metadata is reported without aborting private-state inventory", () => {
  const root = temporaryRoot("codexrig-inconsistent-git-");
  writeFileSync(path.join(root, ".git"), "not a gitdir\n", "utf8");

  const inventory = inspectRepositoryWorktrees({ root });
  assert.equal(inventory.repositoryKind, "inconsistent");
  assert.equal(inventory.complete, false);
  assert.equal(inventory.integrationBranch, null);
  assert.equal(inventory.worktrees.length, 1);
  assert.equal(inventory.worktrees[0].gitManaged, null);
  assert.match(inventory.worktrees[0].problem, /Git metadata/u);
  const plan = reconcileRepositoryWorktreeState({ root, apply: true });
  assert.match(plan.blockingFindings.join("\n"), /Git metadata/u);
});

test("worktree recovery exposes dirty shared state and exactly one writer lease", () => {
  const parent = temporaryRoot("codexrig-worktree-recovery-");
  const repository = path.join(parent, "project");
  const taskWorktree = path.join(parent, "task\u2028worktree");
  mkdirSync(repository);
  git(repository, ["init", "--quiet", "--initial-branch=main"]);
  git(repository, ["config", "user.name", "CodexRig Test"]);
  git(repository, ["config", "user.email", "codexrig@example.invalid"]);
  writeFileSync(path.join(repository, ".gitignore"), ".codex/runtime/\n", "utf8");
  writeFileSync(path.join(repository, "tracked.txt"), "base\n", "utf8");
  git(repository, ["add", ".gitignore", "tracked.txt"]);
  git(repository, ["commit", "--quiet", "-m", "base"]);
  git(repository, ["worktree", "add", "--quiet", "-b", "codexrig/work/task", taskWorktree]);
  const missingWorktree = path.join(parent, "missing while writer active");
  git(repository, [
    "worktree",
    "add",
    "--quiet",
    "-b",
    "codexrig/work/missing-active",
    missingWorktree,
  ]);
  rmSync(missingWorktree, { force: true, recursive: true });
  writeFileSync(path.join(taskWorktree, "tracked.txt"), "task change\n", "utf8");
  issueRuntimeSessionLease({ root: taskWorktree, pid: process.pid });

  const dirtyInventory = inspectRepositoryWorktrees({ root: repository });
  assert.equal(dirtyInventory.schemaVersion, 1);
  assert.equal(dirtyInventory.worktrees.length, 3);
  const current = dirtyInventory.worktrees.find(({ current: selected }) => selected);
  const task = dirtyInventory.worktrees.find(({ path: candidate }) => candidate === taskWorktree);
  assert.equal(current.path, repository);
  assert.equal(current.upstreamReference, null);
  assert.equal(current.unfinished, true);
  assert.equal(task.path, taskWorktree);
  assert.equal(task.branch, "codexrig/work/task");
  assert.equal(task.dirty, true);
  assert.equal(task.unfinished, true);
  assert.equal(task.session.status, "active");
  assert.equal(task.session.phase, "launching");
  const taskPerspective = inspectRepositoryWorktrees({ root: taskWorktree });
  assert.equal(taskPerspective.currentWorktree, taskWorktree);
  assert.equal(taskPerspective.worktrees.length, 3);
  assert.equal(
    taskPerspective.worktrees.find(({ current: selected }) => selected).path,
    taskWorktree,
  );
  assert.equal(
    taskPerspective.worktrees.find(({ current: selected }) => !selected).path,
    repository,
  );
  const protectedPlan = reconcileRepositoryWorktreeState({ root: repository, apply: true });
  assert.match(protectedPlan.blockingFindings.join("\n"), /active writer session/u);
  assert.match(protectedPlan.blockingFindings.join("\n"), /unfinished main-stream state/u);
  assert.match(protectedPlan.driftFindings.join("\n"), /stale Git worktree metadata/u);
  assert.equal(
    protectedPlan.inventory.worktrees.some(({ path: candidate }) => candidate === missingWorktree),
    true,
  );
  assert.equal(protectedPlan.blockingFindings.join("\n").includes("\u2028"), false);
  assert.match(protectedPlan.blockingFindings.join("\n"), /\\u2028/u);
  assert.equal(existsSync(path.join(taskWorktree, "tracked.txt")), true);

  git(taskWorktree, ["add", "tracked.txt"]);
  git(taskWorktree, ["commit", "--quiet", "-m", "task"]);
  const committedInventory = inspectRepositoryWorktrees({ root: repository });
  const committedTask = committedInventory.worktrees.find(({ branch }) => branch?.endsWith("task"));
  assert.equal(committedTask.dirty, false);
  assert.equal(committedTask.integratedIntoMain, false);
  assert.equal(committedTask.unfinished, true);
  assert.equal(releaseRuntimeSessionLease({ root: taskWorktree, pid: process.pid }), true);
});

test("an integrated task worktree is settled even when only its transport branch is ahead", () => {
  const parent = temporaryRoot("codexrig-worktree-integrated-task-");
  const repository = createCommittedRepository(parent);
  const taskWorktree = path.join(parent, "integrated task");
  const remote = path.join(parent, "remote.git");
  git(parent, ["init", "--quiet", "--bare", remote]);
  git(repository, ["remote", "add", "origin", remote]);
  git(repository, ["push", "--quiet", "-u", "origin", "main"]);
  git(repository, ["worktree", "add", "--quiet", "-b", "codexrig/work/integrated", taskWorktree]);
  git(taskWorktree, ["push", "--quiet", "-u", "origin", "codexrig/work/integrated"]);
  writeFileSync(path.join(taskWorktree, "task.txt"), "integrated task\n", "utf8");
  git(taskWorktree, ["add", "task.txt"]);
  git(taskWorktree, ["commit", "--quiet", "-m", "integrated task"]);
  git(repository, ["merge", "--quiet", "--ff-only", "codexrig/work/integrated"]);

  const inventory = inspectRepositoryWorktrees({ root: repository });
  const task = inventory.worktrees.find(({ path: candidate }) => candidate === taskWorktree);
  assert.equal(task.integratedIntoMain, true);
  assert.equal(task.upstreamAhead, 1);
  assert.equal(task.unfinished, false);
  assert.equal(reconcileRepositoryWorktreeState({ root: repository }).blockingFindings.length, 0);
});

test("central main without an upstream remains explicitly unfinished", () => {
  const parent = temporaryRoot("codexrig-worktree-main-without-upstream-");
  const repository = createCommittedRepository(parent);

  const inventory = inspectRepositoryWorktrees({ root: repository });
  assert.equal(inventory.worktrees.length, 1);
  assert.equal(inventory.worktrees[0].branch, "main");
  assert.equal(inventory.worktrees[0].upstreamReference, null);
  assert.equal(inventory.worktrees[0].upstreamAhead, null);
  assert.equal(inventory.worktrees[0].unfinished, true);
});

test("worktree housekeeping clears stale leases in verified clone worktrees", () => {
  const parent = temporaryRoot("codexrig-worktree-housekeeping-");
  const repository = createCommittedRepository(parent);
  const staleWorktree = path.join(parent, "stale worktree");
  git(repository, ["worktree", "add", "--quiet", "-b", "codexrig/work/stale", staleWorktree]);

  const leaseModule = new URL("./runtime-session-lease.mjs", import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { activateRuntimeSessionLease, issueRuntimeSessionLease, transitionRuntimeSessionWriterProcess } from ${JSON.stringify(leaseModule)}; const lease = issueRuntimeSessionLease({ root: ${JSON.stringify(staleWorktree)}, pid: process.pid }); const writer = { root: ${JSON.stringify(staleWorktree)}, pid: process.pid, runtimeSessionId: lease.sessionId, writerPid: process.pid }; transitionRuntimeSessionWriterProcess({ ...writer, transition: "supervisor" }); transitionRuntimeSessionWriterProcess({ ...writer, transition: "handoff" }); transitionRuntimeSessionWriterProcess({ ...writer, transition: "codex" }); activateRuntimeSessionLease({ root: ${JSON.stringify(staleWorktree)}, pid: process.pid, runtimeSessionId: lease.sessionId, codexSessionId: "01a01234-5678-7abc-8def-0123456789ab" });`,
    ],
    { cwd: staleWorktree, encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.equal(child.status, 0, child.stderr);
  rmSync(path.join(staleWorktree, ".codex/runtime/codexrig-session-recovery.json"));

  const stalePlan = reconcileRepositoryWorktreeState({ root: repository });
  assert.equal(stalePlan.blockingFindings.length, 0);
  assert.match(stalePlan.driftFindings.join("\n"), /stale writer lease/u);
  const cleaned = reconcileRepositoryWorktreeState({ root: repository, apply: true });
  assert.deepEqual(cleaned.driftFindings, []);
  const cleanedWorktree = cleaned.inventory.worktrees.find(
    ({ path: candidate }) => candidate === staleWorktree,
  );
  assert.equal(cleanedWorktree.session.status, "absent");
  assert.equal(cleanedWorktree.session.recoverySessionId, "01a01234-5678-7abc-8def-0123456789ab");
  assert.match(
    cleanedWorktree.session.recoveryUpdatedAt,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
  );
});

test("housekeeping preserves an existing directory whose Git worktree link is broken", () => {
  const parent = temporaryRoot("codexrig-worktree-broken-link-");
  const repository = createCommittedRepository(parent);
  const brokenWorktree = path.join(parent, "reused directory");
  git(repository, ["worktree", "add", "--quiet", "-b", "codexrig/work/broken", brokenWorktree]);

  const leaseModule = new URL("./runtime-session-lease.mjs", import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { issueRuntimeSessionLease } from ${JSON.stringify(leaseModule)}; issueRuntimeSessionLease({ root: ${JSON.stringify(brokenWorktree)}, pid: process.pid });`,
    ],
    { cwd: brokenWorktree, encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.equal(child.status, 0, child.stderr);
  const leasePath = path.join(brokenWorktree, ".codex/runtime/codexrig-session.json");
  writeFileSync(path.join(brokenWorktree, "unrelated.txt"), "must remain unrelated\n", "utf8");
  rmSync(path.join(brokenWorktree, ".git"));

  const plan = reconcileRepositoryWorktreeState({ root: repository });
  const broken = plan.inventory.worktrees.find(
    ({ path: candidate }) => candidate === brokenWorktree,
  );
  assert.equal(broken.available, false);
  assert.equal(broken.directoryStatus, "present");
  assert.equal(broken.prunable, true);
  assert.equal(broken.repairCandidate, true);
  assert.equal(broken.locked, false);
  assert.equal(broken.lockReason, null);
  assert.equal(broken.session.status, "stale");
  assert.match(plan.blockingFindings.join("\n"), /requires ownership confirmation before repair/u);

  const preserved = reconcileRepositoryWorktreeState({ root: repository, apply: true });
  assert.match(
    preserved.blockingFindings.join("\n"),
    /requires ownership confirmation before repair/u,
  );
  assert.equal(existsSync(path.join(brokenWorktree, ".git")), false);
  assert.equal(existsSync(path.join(brokenWorktree, "unrelated.txt")), true);
  assert.equal(existsSync(leasePath), true);

  git(repository, ["worktree", "lock", "--reason", worktreePreservationLockReason, brokenWorktree]);
  const interrupted = inspectRepositoryWorktrees({ root: repository }).worktrees.find(
    ({ path: candidate }) => candidate === brokenWorktree,
  );
  assert.equal(interrupted.locked, true);
  assert.equal(interrupted.lockReason, worktreePreservationLockReason);
  const preservedLocked = reconcileRepositoryWorktreeState({ root: repository, apply: true });
  const preservedBroken = preservedLocked.inventory.worktrees.find(
    ({ path: candidate }) => candidate === brokenWorktree,
  );
  assert.equal(preservedBroken.locked, true);
  assert.equal(preservedBroken.lockReason, worktreePreservationLockReason);
  // Git deliberately hides the prunable marker while the registration is locked. The failed
  // worktree binding remains an explicit blocker, and the pre-existing lock remains provenance.
  assert.equal(preservedBroken.prunable, false);
  assert.match(preservedLocked.blockingFindings.join("\n"), /could not be safely inspected/u);
});

test("housekeeping prunes only registrations whose worktree directory is missing", (t) => {
  const parent = temporaryRoot("codexrig-worktree-prune-");
  const repository = createCommittedRepository(parent);
  const missingWorktree = path.join(parent, "missing worktree");
  git(repository, ["worktree", "add", "--quiet", "-b", "codexrig/work/missing", missingWorktree]);
  rmSync(missingWorktree, { force: true, recursive: true });

  const plan = reconcileRepositoryWorktreeState({ root: repository });
  assert.match(plan.driftFindings.join("\n"), /stale Git worktree metadata/u);
  const pruned = reconcileRepositoryWorktreeState({ root: repository, apply: true });
  assert.deepEqual(pruned.blockingFindings, []);
  assert.deepEqual(pruned.driftFindings, []);
  assert.equal(
    pruned.inventory.worktrees.some(({ path: candidate }) => candidate === missingWorktree),
    false,
  );
  t.diagnostic("housekeeping did not remove any worktree directory or its files");
});

test("housekeeping preserves a missing registration replaced at the prune boundary", () => {
  const parent = temporaryRoot("codexrig-worktree-reappeared-");
  const repository = createCommittedRepository(parent);
  const reappearedWorktree = path.join(parent, "reappeared worktree");
  git(repository, [
    "worktree",
    "add",
    "--quiet",
    "-b",
    "codexrig/work/reappeared",
    reappearedWorktree,
  ]);
  rmSync(reappearedWorktree, { force: true, recursive: true });

  const reconciled = reconcileRepositoryWorktreeState({
    root: repository,
    apply: true,
    testHooks: {
      beforeMissingWorktreePrune({ reservations }) {
        assert.equal(reservations.length, 1);
        unlinkSync(reservations[0].path);
        mkdirSync(reappearedWorktree);
        writeFileSync(
          path.join(reappearedWorktree, "unrelated.txt"),
          "must remain present\n",
          "utf8",
        );
      },
    },
  });
  assert.deepEqual(reconciled.driftFindings, []);
  assert.match(reconciled.blockingFindings.join("\n"), /ownership confirmation before repair/u);
  const preserved = reconciled.inventory.worktrees.find(
    ({ path: candidate }) => candidate === reappearedWorktree,
  );
  assert.equal(preserved.directoryStatus, "present");
  assert.equal(preserved.prunable, true);
  assert.equal(preserved.locked, false);
  assert.equal(existsSync(path.join(reappearedWorktree, "unrelated.txt")), true);
});

test("native prune preserves a healthy sibling that disappears at the mutation boundary", () => {
  const parent = temporaryRoot("codexrig-worktree-healthy-sibling-race-");
  const repository = createCommittedRepository(parent);
  const missingWorktree = path.join(parent, "missing prune target");
  const healthyWorktree = path.join(parent, "healthy sibling");
  const parkedWorktree = path.join(parent, "parked healthy sibling");
  git(repository, [
    "worktree",
    "add",
    "--quiet",
    "-b",
    "codexrig/work/missing-prune-target",
    missingWorktree,
  ]);
  git(repository, [
    "worktree",
    "add",
    "--quiet",
    "-b",
    "codexrig/work/healthy-prune-sibling",
    healthyWorktree,
  ]);
  rmSync(missingWorktree, { force: true, recursive: true });

  const reconciled = reconcileRepositoryWorktreeState({
    root: repository,
    apply: true,
    testHooks: {
      beforeMissingWorktreePrune({ inventory }) {
        const protectedSibling = inventory.worktrees.find(
          ({ path: candidate }) => candidate === healthyWorktree,
        );
        assert.equal(protectedSibling.locked, true);
        assert.match(
          protectedSibling.lockReason,
          new RegExp(`^${worktreePreservationLockReason}:`),
        );
        renameSync(healthyWorktree, parkedWorktree);
      },
    },
  });
  assert.equal(
    reconciled.inventory.worktrees.some(({ path: candidate }) => candidate === missingWorktree),
    false,
  );
  const preservedSibling = reconciled.inventory.worktrees.find(
    ({ path: candidate }) => candidate === healthyWorktree,
  );
  assert.equal(preservedSibling.directoryStatus, "missing");
  assert.equal(preservedSibling.prunable, true);
  assert.equal(preservedSibling.locked, false);
  assert.equal(existsSync(path.join(parkedWorktree, "tracked.txt")), true);
});

test("housekeeping preserves a live exact worktree path reservation", () => {
  const parent = temporaryRoot("codexrig-worktree-live-reservation-");
  const repository = createCommittedRepository(parent);
  const missingWorktree = path.join(parent, "live reserved worktree");
  git(repository, [
    "worktree",
    "add",
    "--quiet",
    "-b",
    "codexrig/work/live-reservation",
    missingWorktree,
  ]);
  rmSync(missingWorktree, { force: true, recursive: true });

  const reserved = reserveMissingWorktreePaths([missingWorktree]);
  assert.equal(inspectWorktreePathReservation(missingWorktree).status, "active");
  const blocked = reconcileRepositoryWorktreeState({ root: repository, apply: true });
  assert.match(blocked.blockingFindings.join("\n"), /worktree path is unsafe/u);
  assert.equal(existsSync(missingWorktree), true);

  assert.deepEqual(reserved.release(), []);
  const reconciled = reconcileRepositoryWorktreeState({ root: repository, apply: true });
  assert.equal(
    reconciled.inventory.worktrees.some(({ path: candidate }) => candidate === missingWorktree),
    false,
  );
});

test("a live shared prune transaction blocks only native worktree pruning", () => {
  const parent = temporaryRoot("codexrig-worktree-live-prune-transaction-");
  const repository = createCommittedRepository(parent);
  const missingWorktree = path.join(parent, "live transaction worktree");
  git(repository, [
    "worktree",
    "add",
    "--quiet",
    "-b",
    "codexrig/work/live-prune-transaction",
    missingWorktree,
  ]);
  rmSync(missingWorktree, { force: true, recursive: true });
  const commonGitDirectory = realpathSync.native(path.join(repository, ".git"));
  const owner = captureProcessIdentity(process.pid);
  const transaction = beginWorktreePruneTransaction(
    commonGitDirectory,
    [missingWorktree],
    owner,
    createWorktreePreservationLockReason({ owner }),
  );
  assert.deepEqual(inspectRepositoryWorktrees({ root: repository }).pruneTransaction, {
    pathCount: 1,
    status: "active",
  });

  const blocked = reconcileRepositoryWorktreeState({ root: repository, apply: true });
  assert.match(blocked.blockingFindings.join("\n"), /prune transaction is active/u);
  assert.equal(
    blocked.inventory.worktrees.some(({ path: candidate }) => candidate === missingWorktree),
    true,
  );

  transaction.release();
  const reconciled = reconcileRepositoryWorktreeState({ root: repository, apply: true });
  assert.deepEqual(reconciled.blockingFindings, []);
  assert.equal(
    reconciled.inventory.worktrees.some(({ path: candidate }) => candidate === missingWorktree),
    false,
  );
});

test("housekeeping removes an abandoned exact reservation before pruning its missing registration", () => {
  const parent = temporaryRoot("codexrig-worktree-stale-reservation-");
  const repository = createCommittedRepository(parent);
  const missingWorktree = path.join(parent, "abandoned reserved worktree");
  git(repository, [
    "worktree",
    "add",
    "--quiet",
    "-b",
    "codexrig/work/stale-reservation",
    missingWorktree,
  ]);
  rmSync(missingWorktree, { force: true, recursive: true });
  abandonedReservation(missingWorktree);
  assert.equal(inspectWorktreePathReservation(missingWorktree).status, "stale");

  const reconciled = reconcileRepositoryWorktreeState({ root: repository, apply: true });
  assert.equal(existsSync(missingWorktree), false);
  assert.equal(
    reconciled.inventory.worktrees.some(({ path: candidate }) => candidate === missingWorktree),
    false,
  );
});

test("housekeeping recovers a reservation after its Git registration was already pruned", () => {
  const parent = temporaryRoot("codexrig-worktree-post-prune-crash-");
  const repository = createCommittedRepository(parent);
  const missingWorktree = path.join(parent, "post-prune reserved worktree");
  git(repository, [
    "worktree",
    "add",
    "--quiet",
    "-b",
    "codexrig/work/post-prune-crash",
    missingWorktree,
  ]);
  rmSync(missingWorktree, { force: true, recursive: true });
  const commonGitDirectory = realpathSync.native(path.join(repository, ".git"));

  abandonedPostPruneTransaction(repository, commonGitDirectory, missingWorktree);
  assert.equal(
    inspectRepositoryWorktrees({ root: repository }).worktrees.some(
      ({ path: candidate }) => candidate === missingWorktree,
    ),
    false,
  );
  assert.equal(inspectWorktreePathReservation(missingWorktree).status, "stale");
  assert.equal(inspectWorktreePruneTransaction(commonGitDirectory).status, "stale");
  assert.deepEqual(inspectRepositoryWorktrees({ root: repository }).pruneTransaction, {
    pathCount: 1,
    status: "stale",
  });

  const reconciled = reconcileRepositoryWorktreeState({ root: repository, apply: true });
  assert.deepEqual(reconciled.blockingFindings, []);
  assert.equal(existsSync(missingWorktree), false);
  assert.equal(inspectWorktreePruneTransaction(commonGitDirectory).status, "absent");
});

test("stale reservation cleanup preserves content that replaces the proven file generation", () => {
  const parent = temporaryRoot("codexrig-worktree-stale-reservation-race-");
  const candidate = path.join(parent, "abandoned reservation");
  abandonedReservation(candidate);

  assert.throws(
    () =>
      clearStaleWorktreePathReservation(candidate, {
        testHooks: {
          beforeStaleWorktreeReservationRemove() {
            unlinkSync(candidate);
            writeFileSync(candidate, "unrelated content\n", "utf8");
          },
        },
      }),
    /unexpected identity/u,
  );
  assert.equal(readFileSync(candidate, "utf8"), "unrelated content\n");
});

test("housekeeping retires an abandoned exact preservation lock without pruning a present link", () => {
  const parent = temporaryRoot("codexrig-worktree-stale-preservation-lock-");
  const repository = createCommittedRepository(parent);
  const brokenWorktree = path.join(parent, "broken locked worktree");
  const missingWorktree = path.join(parent, "missing locked sibling");
  git(repository, [
    "worktree",
    "add",
    "--quiet",
    "-b",
    "codexrig/work/stale-lock-broken",
    brokenWorktree,
  ]);
  git(repository, [
    "worktree",
    "add",
    "--quiet",
    "-b",
    "codexrig/work/stale-lock-missing",
    missingWorktree,
  ]);
  writeFileSync(path.join(brokenWorktree, "unrelated.txt"), "must remain present\n", "utf8");
  rmSync(path.join(brokenWorktree, ".git"));
  rmSync(missingWorktree, { force: true, recursive: true });
  git(repository, ["worktree", "lock", "--reason", abandonedPreservationReason(), brokenWorktree]);

  const reconciled = reconcileRepositoryWorktreeState({ root: repository, apply: true });
  const preserved = reconciled.inventory.worktrees.find(
    ({ path: candidate }) => candidate === brokenWorktree,
  );
  assert.equal(preserved.locked, false);
  assert.equal(existsSync(path.join(brokenWorktree, "unrelated.txt")), true);
  assert.equal(
    reconciled.inventory.worktrees.some(({ path: candidate }) => candidate === missingWorktree),
    false,
  );
});

test("one housekeeping transaction recovers a lock and reservation abandoned together", () => {
  const parent = temporaryRoot("codexrig-worktree-abandoned-transaction-");
  const repository = createCommittedRepository(parent);
  const missingWorktree = path.join(parent, "locked and reserved worktree");
  git(repository, [
    "worktree",
    "add",
    "--quiet",
    "-b",
    "codexrig/work/abandoned-transaction",
    missingWorktree,
  ]);
  rmSync(missingWorktree, { force: true, recursive: true });
  abandonedReservation(missingWorktree);
  git(repository, ["worktree", "lock", "--reason", abandonedPreservationReason(), missingWorktree]);
  const hidden = inspectRepositoryWorktrees({ root: repository }).worktrees.find(
    ({ path: candidate }) => candidate === missingWorktree,
  );
  assert.equal(hidden.locked, true);
  assert.equal(hidden.prunable, false);

  const reconciled = reconcileRepositoryWorktreeState({ root: repository, apply: true });
  assert.equal(existsSync(missingWorktree), false);
  assert.equal(
    reconciled.inventory.worktrees.some(({ path: candidate }) => candidate === missingWorktree),
    false,
  );
});

test("missing-path reservations reject a rebound parent before cleanup", () => {
  const parent = temporaryRoot("codexrig-worktree-reservation-parent-");
  const original = path.join(parent, "original");
  const parked = path.join(parent, "parked");
  const candidate = path.join(original, "missing worktree");
  mkdirSync(original);
  const reserved = reserveMissingWorktreePaths([candidate]);
  assert.equal(reserved.complete, true);
  renameSync(original, parked);
  mkdirSync(original);
  assert.throws(() => reserved.intact(), /parent identity change|logical directory rebind/u);
  rmSync(original, { recursive: true });
  renameSync(parked, original);
  assert.deepEqual(reserved.release(), []);
  assert.equal(existsSync(candidate), false);
});

test("housekeeping prunes a missing registration while preserving a present broken link", () => {
  const parent = temporaryRoot("codexrig-worktree-mixed-prune-");
  const repository = createCommittedRepository(parent);
  const brokenWorktree = path.join(parent, "present broken worktree");
  const missingWorktree = path.join(parent, "missing sibling worktree");
  git(repository, [
    "worktree",
    "add",
    "--quiet",
    "-b",
    "codexrig/work/mixed-broken",
    brokenWorktree,
  ]);
  git(repository, [
    "worktree",
    "add",
    "--quiet",
    "-b",
    "codexrig/work/mixed-missing",
    missingWorktree,
  ]);
  writeFileSync(path.join(brokenWorktree, "unrelated.txt"), "must remain present\n", "utf8");
  rmSync(path.join(brokenWorktree, ".git"));
  rmSync(missingWorktree, { force: true, recursive: true });

  const plan = reconcileRepositoryWorktreeState({ root: repository });
  assert.match(plan.blockingFindings.join("\n"), /ownership confirmation before repair/u);
  assert.match(plan.driftFindings.join("\n"), /stale Git worktree metadata/u);

  const reconciled = reconcileRepositoryWorktreeState({ root: repository, apply: true });
  assert.deepEqual(reconciled.driftFindings, []);
  assert.match(reconciled.blockingFindings.join("\n"), /ownership confirmation before repair/u);
  assert.equal(
    reconciled.inventory.worktrees.some(({ path: candidate }) => candidate === missingWorktree),
    false,
  );
  const preserved = reconciled.inventory.worktrees.find(
    ({ path: candidate }) => candidate === brokenWorktree,
  );
  assert.equal(preserved.prunable, true);
  assert.equal(preserved.locked, false);
  assert.equal(preserved.lockReason, null);
  assert.equal(existsSync(path.join(brokenWorktree, "unrelated.txt")), true);
});

test("housekeeping prunes a missing registration while preserving an unsafe worktree binding", () => {
  const parent = temporaryRoot("codexrig-worktree-unsafe-prune-");
  const repository = createCommittedRepository(parent);
  const unsafeWorktree = path.join(parent, "unsafe sibling worktree");
  const missingWorktree = path.join(parent, "missing sibling worktree");
  const externalDirectory = path.join(parent, "external directory");
  git(repository, [
    "worktree",
    "add",
    "--quiet",
    "-b",
    "codexrig/work/mixed-unsafe",
    unsafeWorktree,
  ]);
  git(repository, [
    "worktree",
    "add",
    "--quiet",
    "-b",
    "codexrig/work/mixed-missing-unsafe",
    missingWorktree,
  ]);
  rmSync(unsafeWorktree, { force: true, recursive: true });
  mkdirSync(externalDirectory);
  writeFileSync(path.join(externalDirectory, "unrelated.txt"), "must remain external\n", "utf8");
  symlinkSync(externalDirectory, unsafeWorktree, "dir");
  rmSync(missingWorktree, { force: true, recursive: true });

  const plan = reconcileRepositoryWorktreeState({ root: repository });
  assert.match(plan.blockingFindings.join("\n"), /worktree path is unsafe/u);
  assert.match(plan.driftFindings.join("\n"), /stale Git worktree metadata/u);

  const reconciled = reconcileRepositoryWorktreeState({ root: repository, apply: true });
  assert.deepEqual(reconciled.driftFindings, []);
  assert.match(reconciled.blockingFindings.join("\n"), /worktree path is unsafe/u);
  assert.equal(
    reconciled.inventory.worktrees.some(({ path: candidate }) => candidate === missingWorktree),
    false,
  );
  const preserved = reconciled.inventory.worktrees.find(
    ({ path: candidate }) => candidate === unsafeWorktree,
  );
  assert.equal(preserved.directoryStatus, "unsafe");
  assert.equal(preserved.prunable, true);
  assert.equal(preserved.locked, false);
  assert.equal(preserved.lockReason, null);
  assert.equal(realpathSync.native(unsafeWorktree), externalDirectory);
  assert.equal(existsSync(path.join(externalDirectory, "unrelated.txt")), true);
});

test("unborn orphan worktrees remain available and explicitly unfinished", () => {
  const parent = temporaryRoot("codexrig-worktree-unborn-");
  const repository = createCommittedRepository(parent);
  const orphanWorktree = path.join(parent, "orphan worktree");
  git(repository, ["worktree", "add", "--quiet", "-b", "scratch-base", orphanWorktree]);
  git(orphanWorktree, ["checkout", "--quiet", "--orphan", "scratch"]);
  git(orphanWorktree, ["rm", "--quiet", "-rf", "."]);

  const inventory = inspectRepositoryWorktrees({ root: repository });
  const orphan = inventory.worktrees.find(({ path: candidate }) => candidate === orphanWorktree);
  assert.equal(inventory.complete, true);
  assert.equal(orphan.available, true);
  assert.match(orphan.head, /^(?:0{40}|0{64})$/u);
  assert.equal(orphan.integratedIntoMain, false);
  assert.equal(orphan.unfinished, true);
});

test("a committed repository without main is never classified as settled", () => {
  const parent = temporaryRoot("codexrig-worktree-no-main-");
  const repository = createCommittedRepository(parent, { initialBranch: "master" });

  const inventory = inspectRepositoryWorktrees({ root: repository });
  assert.equal(inventory.complete, true);
  assert.equal(inventory.integrationBranch, "main");
  assert.equal(inventory.worktrees[0].integratedIntoMain, null);
  assert.equal(inventory.worktrees[0].unfinished, true);
});
