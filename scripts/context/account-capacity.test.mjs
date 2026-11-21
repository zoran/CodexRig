/** Tests native account capacity classification and the recoverable pause at a safe checkpoint. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import {
  activateRuntimeSessionLease,
  issueRuntimeSessionLease,
  transitionRuntimeSessionWriterProcess,
} from "../repository/runtime-session-lease.mjs";
import {
  hasCriticalBudgetHandoverForSession,
  hasPendingAccountPause,
} from "./critical-budget-handover.mjs";
import {
  checkAccountCapacity,
  classifyAccountCapacity,
  readAccountRateLimits,
} from "./account-capacity.mjs";

const now = 1_900_000_000_000;
const currentWindow = (usedPercent, windowDurationMins = 300) => ({
  usedPercent,
  windowDurationMins,
  resetsAt: now / 1000 + 60,
});
function response(usedPercent = 94, resetCount = 0) {
  const rateLimits = { limitId: "codex", primary: currentWindow(usedPercent), secondary: null };
  return {
    accountId: "test-account",
    rateLimits,
    rateLimitsByLimitId: { codex: structuredClone(rateLimits) },
    rateLimitResetCredits: { availableCount: resetCount, credits: [] },
    ordinaryUsageAllowed: true,
  };
}
const classify = (snapshot) => classifyAccountCapacity(snapshot, { now });

test("both windows, the native default and its matching bucket bind ordinary usage at exactly five percent", () => {
  for (const [used, action, remaining] of [
    [0, "continue", 100],
    [94, "continue", 6],
    [95, "pause", 5],
    [100, "pause", 0],
  ]) {
    const decision = classify(response(used));
    assert.equal(decision.action, action);
    assert.equal(decision.remainingPercent, remaining);
  }
  const observed = response(28);
  observed.rateLimitsByLimitId.codex.secondary = currentWindow(97, 10_080);
  observed.rateLimitsByLimitId.images = { limitId: "images", primary: currentWindow(100) };
  let decision = classify(observed);
  assert.equal(decision.action, "pause");
  assert.equal(decision.binding.name, "secondary");
  assert.equal(decision.binding.windowDurationMins, 10_080);
  assert.equal(decision.remainingPercent, 3);
  assert.deepEqual(
    Object.keys(decision.evidence).sort(),
    ["rateLimits", "rateLimitsByLimitId", "rateLimitResetCredits", "ordinaryUsageAllowed"].sort(),
  );
  assert.equal(decision.evidence.rateLimitsByLimitId, observed.rateLimitsByLimitId);
  observed.rateLimitsByLimitId.codex.secondary.resetsAt = now / 1000;
  decision = classify(observed);
  assert.equal(decision.action, "continue");
  assert.equal(decision.remainingPercent, 72);
  observed.rateLimitsByLimitId = null;
  observed.rateLimits.limitId = null;
  observed.rateLimits.primary.resetsAt = null;
  assert.equal(classify(observed).remainingPercent, 72);
});

test("unknown evidence and backend denial remain distinct from a pausable account", () => {
  for (const observation of [
    null,
    { ...response(99), ordinaryUsageAllowed: null },
    { ...response(99), rateLimitResetCredits: null },
    { ...response(99), rateLimitResetCredits: { availableCount: -1 } },
    { ...response(99), rateLimits: {}, rateLimitsByLimitId: {} },
    {
      ...response(99),
      rateLimitsByLimitId: { codex: { limitId: "images", primary: currentWindow(99) } },
    },
  ])
    assert.equal(classify(observation).action, "unknown");
  const expired = response(100);
  expired.rateLimits.primary.resetsAt = now / 1000;
  expired.rateLimitsByLimitId = null;
  assert.equal(classify(expired).action, "unknown");
  const invalid = response(99);
  invalid.rateLimits.primary.usedPercent = "99";
  assert.equal(classify(invalid).action, "unknown");
  const denied = { ...response(42), ordinaryUsageAllowed: false };
  assert.equal(classify(denied).action, "critical-drain");
  denied.rateLimits.credits = { hasCredits: true, balance: "999.00" };
  assert.equal(classify(denied).action, "critical-drain");
});

test("the supported free reset uses native availableCount and reconciles pending redemption", () => {
  for (const [used, resetCredits, expected] of [
    [95, { availableCount: 2, credits: [] }, "recovery-required"],
    [90, { availableCount: 1, credits: null }, "recovery-required"],
    [89, { availableCount: 2, credits: [] }, "continue"],
    [95, { availableCount: 0, credits: [{ status: "available" }] }, "pause"],
    [95, { availableCount: 0, credits: [{ status: "redeeming" }] }, "recovery-required"],
  ]) {
    const decision = classify({ ...response(used), rateLimitResetCredits: resetCredits });
    assert.equal(decision.action, expected);
    assert.equal(decision.resetCreditsAvailable, resetCredits.availableCount);
  }
  assert.equal(
    classify({ ...response(100, 1), ordinaryUsageAllowed: false }).action,
    "recovery-required",
  );
});

test("the safe checkpoint refreshes permission and capacity before it alone creates an unsealed handover", async () => {
  const root = "/fixture/working-project";
  const handover = { relativePath: "tmp/handovers/example.prompt.md" };
  async function check(observations, inspect = false) {
    let reads = 0,
      creates = 0;
    const result = await checkAccountCapacity({
      root,
      inspect,
      now: () => now,
      read: async (args) => {
        assert.deepEqual(args, { root });
        if (reads >= observations.length) throw new Error("unplanned read");
        return observations[reads++];
      },
      createHandover: async (args) => {
        assert.deepEqual(args, { root });
        creates++;
        return handover;
      },
    });
    assert.equal(reads, observations.length);
    return { result, creates };
  }
  const inspected = await check([response(95)], true);
  assert.equal(inspected.creates, 0);
  assert.equal(inspected.result.action, "pause");
  for (const [observations, expected] of [
    [[response(94)], "continue"],
    [[response(95), response(94)], "continue"],
    [[response(95), response(95, 1)], "recovery-required"],
    [[response(95), null], "unknown"],
    [[response(95), { ...response(99), ordinaryUsageAllowed: false }], "critical-drain"],
    [[response(95), { ...response(99), accountId: "changed-account" }], "unknown"],
  ]) {
    const { result, creates } = await check(observations);
    assert.equal(result.action, expected);
    assert.equal(creates, 0);
  }
  const paused = await check([response(95), response(96)]);
  assert.equal(paused.creates, 1);
  assert.equal(paused.result.handover.relativePath, handover.relativePath);
  assert.ok(paused.result.resumePrompt.includes(handover.relativePath));
  assert.match(paused.result.resumePrompt, /Goal/u);
});

test("a refreshed five-percent fixture records exactly one real unsealed handover for the active session", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "account-pause-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, ".codex"), { mode: 0o700 });
  copyFileSync(
    path.join(toolingRoot, ".codex/tooling.json"),
    path.join(root, ".codex/tooling.json"),
  );
  const state = {
    version: 1,
    revision: 1,
    status: "active",
    outcome: "Verify the capacity checkpoint",
    currentGoal: "Finish the authorized test",
    currentSlice: "Enter the fixture",
    nextAction: "Confirm the checked result",
    blocker: null,
  };
  mkdirSync(path.join(root, "docs"));
  writeFileSync(
    path.join(root, "docs/project-context.md"),
    `<!-- codexrig-work-state\n${JSON.stringify(state)}\n-->\n\n# Current work\n\nSynthetic checkpoint.\n`,
  );
  const lease = issueRuntimeSessionLease({ root, pid: process.pid });
  const binding = { root, pid: process.pid, runtimeSessionId: lease.sessionId };
  for (const transition of ["supervisor", "handoff", "codex"])
    transitionRuntimeSessionWriterProcess({ ...binding, transition, writerPid: process.pid });
  activateRuntimeSessionLease({ ...binding, codexSessionId: "account-pause-test" });
  const options = { root, read: async () => response(95), now: () => now };
  await checkAccountCapacity({ ...options, inspect: true });
  assert.equal(hasPendingAccountPause({ root }), false);
  const result = await checkAccountCapacity(options);
  assert.equal(result.action, "pause");
  const prompt = readFileSync(path.join(root, result.handover.relativePath), "utf8");
  assert.match(prompt, /Synthetic checkpoint/);
  assert.equal(hasPendingAccountPause({ root }), true);
  assert.equal(
    hasCriticalBudgetHandoverForSession({ root, sealingSessionId: lease.sessionId }),
    false,
  );
  assert.equal(
    (await checkAccountCapacity(options)).handover.relativePath,
    result.handover.relativePath,
  );
});

function fixtureServer(source) {
  return spawn(process.execPath, ["--input-type=commonjs", "-e", source], {
    stdio: ["pipe", "pipe", "ignore"],
  });
}
test("native reader waits for initialization, then issues only one account capacity read", async () => {
  const sample = response();
  const read = await readAccountRateLimits({
    startServer: () =>
      fixtureServer(`
    const input = require("node:readline").createInterface({ input: process.stdin });
    const expected = ["initialize", "initialized", "account/rateLimits/read"];
    input.on("line", (line) => {
      const request = JSON.parse(line);
      if (request.method !== expected.shift()) process.exit(2);
      if (request.method === "initialize") console.log(JSON.stringify({ id: request.id, result: {} }));
      if (request.method === "account/rateLimits/read") {
        console.log(JSON.stringify({ method: "server/notice", params: {} }));
        console.log(JSON.stringify({ id: request.id, result: ${JSON.stringify(sample)} }));
      }
    });
  `),
  });
  assert.deepEqual(read, sample);
});

test("timeouts and malformed, oversized or missing responses never create a handover", async () => {
  const scripts = [
    'process.stdin.on("data", () => console.log("invalid"));',
    'process.stdin.on("data", () => process.stdout.write("x".repeat(600000)));',
    'process.stdin.on("data", () => process.exit(0));',
    "process.stdin.resume();",
  ];
  for (const source of scripts) {
    let child;
    await assert.rejects(
      readAccountRateLimits({
        startServer: () => {
          child = fixtureServer(source);
          return child;
        },
        timeoutMs: 500,
      }),
      /Native capacity|Native account/u,
    );
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  }
  const missing = await checkAccountCapacity({
    read: async () => {
      throw new Error("private native diagnostic");
    },
    createHandover: async () => assert.fail("an unavailable account cannot pause"),
  });
  assert.equal(missing.action, "unknown");
  assert.doesNotMatch(JSON.stringify(missing), /private native diagnostic/u);
});
