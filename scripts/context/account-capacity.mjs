#!/usr/bin/env node
/** Reads included Codex account capacity and checkpoints a drained session at the ordinary pause threshold. */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import { projectToolEnvironment } from "../repository/project-tool-environment.mjs";
import {
  projectManagedToolLayout,
  verifyProjectToolBundle,
} from "../repository/project-tool-executables.mjs";
import { formatContextError } from "../terminal/terminal-output.mjs";

function startNativeServer(root) {
  const executable = verifyProjectToolBundle(root, projectManagedToolLayout(root).codex);
  return spawn(
    executable,
    [
      "--cd",
      root,
      "-c",
      'cli_auth_credentials_store="file"',
      "-c",
      'mcp_oauth_credentials_store="file"',
      "app-server",
      "--stdio",
    ],
    {
      cwd: root,
      env: projectToolEnvironment({ root }),
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
    },
  );
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** A single, bounded stdio exchange. No thread, model request, reset redemption or login is started. */
export function readAccountRateLimits({
  root = toolingRoot,
  startServer = startNativeServer,
  timeoutMs = 12_000,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = startServer(root);
    let initialized = false;
    let outcome;
    let killTimer;
    let bytes = 0;
    let pending = "";
    const deadline = setTimeout(
      () => stop(new Error("Native capacity read timed out.")),
      timeoutMs,
    );
    function stop(error, result) {
      if (outcome) return;
      outcome = { error, result };
      child.stdin.end();
      child.stdout.destroy();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 500);
      }
    }
    const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
    child.once("error", () =>
      stop(new Error("Could not start the project's native account reader.")),
    );
    child.stdin.on("error", () => stop(new Error("Native capacity request stream closed.")));
    child.stdout.on("error", () => stop(new Error("Native capacity response stream closed.")));
    child.once("close", () => {
      clearTimeout(deadline);
      clearTimeout(killTimer);
      if (outcome && !outcome.error) resolve(outcome.result);
      else
        reject(outcome?.error ?? new Error("Native capacity reader exited before its response."));
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (outcome) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > 512 * 1024) return stop(new Error("Native capacity output exceeded its limit."));
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let reply;
        try {
          reply = JSON.parse(line);
        } catch {
          return stop(new Error("Native capacity reader returned malformed JSON."));
        }
        if (!isRecord(reply))
          return stop(new Error("Native capacity reader returned an invalid reply."));
        if (reply.id === 1 && !initialized && !reply.error && isRecord(reply.result)) {
          initialized = true;
          send({ method: "initialized", params: {} });
          send({ id: 2, method: "account/rateLimits/read", params: {} });
        } else if (reply.id === 2 && initialized && !reply.error && isRecord(reply.result)) {
          return stop(null, reply.result);
        } else if (reply.id === 1 || reply.id === 2) {
          return stop(new Error("Native account capacity is unavailable."));
        }
      }
    });
    send({
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "project_capacity", version: "1" } },
    });
  });
}

function bindingWindows(rateLimits, rateLimitsByLimitId, now) {
  if (!isRecord(rateLimits) || (rateLimitsByLimitId != null && !isRecord(rateLimitsByLimitId)))
    return [];
  const ids = new Set(
    ["codex", rateLimits.limitId].filter((id) => typeof id === "string" && id.length),
  );
  const snapshots = [rateLimits];
  for (const id of ids) {
    if (rateLimitsByLimitId && Object.hasOwn(rateLimitsByLimitId, id)) {
      const entry = rateLimitsByLimitId[id];
      if (!isRecord(entry) || (entry.limitId != null && entry.limitId !== id)) return [];
      snapshots.push(entry);
    }
  }
  const windows = [];
  for (const snapshot of snapshots) {
    for (const name of ["primary", "secondary"]) {
      const window = snapshot[name];
      if (window == null) continue;
      if (
        !isRecord(window) ||
        !Number.isSafeInteger(window.usedPercent) ||
        window.usedPercent < 0 ||
        (window.resetsAt != null && !Number.isSafeInteger(window.resetsAt))
      )
        return [];
      if (window.resetsAt != null && window.resetsAt <= Math.floor(now / 1000)) continue;
      windows.push({
        name,
        remainingPercent: Math.max(0, 100 - window.usedPercent),
        windowDurationMins:
          Number.isSafeInteger(window.windowDurationMins) && window.windowDurationMins > 0
            ? window.windowDurationMins
            : null,
        resetsAt: window.resetsAt ?? null,
      });
    }
  }
  return windows;
}

/** The ordinary bucket and its native alias bind the task. Feature-specific meters and balances grant no authority. */
export function classifyAccountCapacity(response, { now = Date.now() } = {}) {
  const evidence = {
    rateLimits: response?.rateLimits ?? null,
    rateLimitsByLimitId: response?.rateLimitsByLimitId ?? null,
    rateLimitResetCredits: response?.rateLimitResetCredits ?? null,
    ordinaryUsageAllowed: response?.ordinaryUsageAllowed ?? null,
  };
  const { rateLimits, rateLimitsByLimitId, rateLimitResetCredits, ordinaryUsageAllowed } = evidence;
  const windows = bindingWindows(rateLimits, rateLimitsByLimitId, now);
  const binding = windows.reduce(
    (lowest, current) =>
      !lowest || current.remainingPercent < lowest.remainingPercent ? current : lowest,
    null,
  );
  const count = rateLimitResetCredits?.availableCount;
  const resetCreditsAvailable = Number.isSafeInteger(count) && count >= 0 ? count : null;
  const remainingPercent = binding?.remainingPercent ?? null;
  const result = {
    evidence,
    observedAt: new Date(now).toISOString(),
    binding,
    remainingPercent,
    resetCreditsAvailable,
  };
  const decision = (action, message) => ({ ...result, action, message });
  if (typeof ordinaryUsageAllowed !== "boolean")
    return decision("unknown", "The backend has not confirmed ordinary usage permission.");
  if (resetCreditsAvailable === null)
    return decision(
      "unknown",
      "Refresh the supported free reset-credit availability before classifying exhaustion.",
    );
  const recoveryThreshold =
    !ordinaryUsageAllowed || (remainingPercent !== null && remainingPercent <= 10);
  if (
    recoveryThreshold &&
    Array.isArray(rateLimitResetCredits.credits) &&
    rateLimitResetCredits.credits.some((credit) => credit?.status === "redeeming")
  )
    return decision(
      "recovery-required",
      "Reconcile the pending free reset with its existing idempotency key, then refresh capacity.",
    );
  if (recoveryThreshold && resetCreditsAvailable > 0)
    return decision(
      "recovery-required",
      "Use the supported free reset flow with one persisted idempotency key, then refresh capacity.",
    );
  if (!ordinaryUsageAllowed)
    return decision(
      "critical-drain",
      "Ordinary usage is denied. Follow the hard-limit drain procedure.",
    );
  if (!binding)
    return decision("unknown", "No current, valid ordinary account window was reported.");
  if (remainingPercent <= 5)
    return decision(
      "pause",
      "Drain owned work, update docs/project-context.md and run pnpm handover:check to save the pause handover.",
    );
  return decision("continue", "Ordinary work may continue within the remaining capacity.");
}

async function createPause(options) {
  const { createAccountPauseHandover } = await import("./critical-budget-handover.mjs");
  return createAccountPauseHandover(options);
}

/** Use inspect during work. The default command is the primary's post-drain checkpoint. */
export async function checkAccountCapacity({
  root = toolingRoot,
  inspect = false,
  read = readAccountRateLimits,
  createHandover = createPause,
  now = Date.now,
} = {}) {
  const observe = async () => {
    let response;
    try {
      response = await read({ root });
    } catch {
      response = null;
    }
    return { response, decision: classifyAccountCapacity(response, { now: now() }) };
  };
  const first = await observe();
  if (inspect || first.decision.action !== "pause") return first.decision;
  const refreshed = await observe();
  if (refreshed.decision.action !== "pause") return refreshed.decision;
  if ((first.response?.accountId ?? null) !== (refreshed.response?.accountId ?? null))
    return {
      ...refreshed.decision,
      action: "unknown",
      message: "Account identity changed during the capacity refresh.",
    };
  const handover = await createHandover({ root });
  return {
    ...refreshed.decision,
    message: "The session is paused. Explicitly accept the saved handover to resume.",
    handover,
    resumePrompt: `Setze die Übergabe ${handover.relativePath} in dieser Sitzung als Goal fort.`,
  };
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.some((arg) => !["--inspect", "--json", "--help", "-h"].includes(arg)))
    throw new Error("Usage: pnpm handover:check [-- --inspect] [--json]");
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: pnpm handover:check [-- --inspect] [--json]\nUse --inspect during work. Run without --inspect after draining owned work to a safe checkpoint.",
    );
    return;
  }
  const { evidence, ...result } = await checkAccountCapacity({
    inspect: args.includes("--inspect"),
  });
  if (args.includes("--json")) {
    console.log(
      JSON.stringify({ ...result, ordinaryUsageAllowed: evidence.ordinaryUsageAllowed }, null, 2),
    );
    return;
  }
  const remaining =
    result.remainingPercent === null ? "" : ` (${result.remainingPercent}% remaining)`;
  console.log(`${result.action}${remaining}. ${result.message}`);
  if (result.handover) console.log(`${result.handover.relativePath}\n${result.resumePrompt}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(formatContextError(error, toolingRoot));
    process.exitCode = 1;
  });
}
