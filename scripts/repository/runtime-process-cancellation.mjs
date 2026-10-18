/** Owns cancellation completion for a spawned child and its identity-bound private process group. */
import { readFileSync, readdirSync } from "node:fs";
import { constants } from "node:os";
import process from "node:process";
import { captureProcessIdentity, inspectProcessIdentity } from "./runtime-process-identity.mjs";

/**
 * Normal completion needs no scan or polling. Once cancellation starts, retain exact observed
 * identities until every owned running process stops. A zombie is terminated, but only its parent
 * can reap it. Missing group visibility is an explicit failure, never proof of quiescence.
 */
export function createOwnedProcessCancellation(child, { graceMilliseconds = 5000 } = {}) {
  const identities = new Map();
  let completion;
  let initialFailure;
  try {
    if (child?.pid) {
      const identity = captureProcessIdentity(child.pid);
      if (identity) identities.set(identity.pid, identity);
    }
  } catch (error) {
    initialFailure = error;
  }
  const failure = (message) =>
    Object.assign(new Error(message), { code: "CODEXRIG_PROCESS_CANCELLATION" });
  const readStat = (pid) => {
    try {
      const text = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = text
        .slice(text.lastIndexOf(")") + 1)
        .trim()
        .split(/\s+/u);
      const group = Number(fields[2]);
      const session = Number(fields[3]);
      if (!Number.isSafeInteger(group) || !Number.isSafeInteger(session))
        throw failure("Owned process group has invalid kernel metadata.");
      return { group, session, running: !["Z", "X"].includes(fields[0]) };
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ESRCH") return null;
      throw error;
    }
  };
  const inspect = (identity) => {
    const before = inspectProcessIdentity(identity);
    if (before === "stale") return null;
    if (before !== "active" || !identity.startIdentity)
      throw failure("Owned process identity cannot be observed in this namespace.");
    const stat = readStat(identity.pid);
    const after = inspectProcessIdentity(identity);
    if (after === "stale") return null;
    if (after !== "active" || !stat)
      throw failure("Owned process identity changed during cancellation observation.");
    return stat;
  };
  const inGroup = (stat) => stat?.group === child.pid && stat.session === child.pid;
  const refreshGroup = () => {
    const anchors = [...identities.values()].filter((identity) => inGroup(inspect(identity)));
    const observed = [];
    for (const entry of readdirSync("/proc")) {
      if (!/^[1-9]\d*$/u.test(entry)) continue;
      const pid = Number(entry);
      if (!inGroup(readStat(pid))) continue;
      const identity = captureProcessIdentity(pid);
      if (identity && inGroup(inspect(identity))) observed.push(identity);
    }
    // A live exact member pins the group being observed. After the last known member disappears,
    // a recycled numeric group id cannot authorize a new process, even if its PID looks familiar.
    const anchored = anchors.some((identity) => inGroup(inspect(identity)));
    for (const identity of observed) {
      if (identities.get(identity.pid)?.startIdentity === identity.startIdentity) continue;
      if (!anchored) throw failure("Owned process group lost its identity anchor.");
      identities.set(identity.pid, identity);
    }
  };
  const cancel = async (signal) => {
    if (!child?.pid) return;
    const immediate = signal === "SIGKILL" || signal === constants.signals.SIGKILL;
    const escalationAt = performance.now() + (immediate ? 0 : graceMilliseconds);
    const deadline = escalationAt + 1000;
    const signalled = new Map();
    let directSignal;
    let uncertainty = initialFailure;
    if (process.platform !== "linux")
      uncertainty = failure("Private process-group completion is not observable on this platform.");
    while (true) {
      if (process.platform === "linux") {
        try {
          refreshGroup();
        } catch (error) {
          uncertainty ??= error;
        }
      }
      const signalNow = performance.now() >= escalationAt ? "SIGKILL" : signal;
      let running = false;
      for (const identity of identities.values()) {
        try {
          if (!inspect(identity)?.running) continue;
          running = true;
          if (signalled.get(identity) === signalNow) continue;
          // Revalidate at the signal boundary; never target a numeric process group after its
          // leader exits, or a PID whose established start/namespace identity no longer matches.
          if (!inspect(identity)?.running) continue;
          process.kill(identity.pid, signalNow);
          signalled.set(identity, signalNow);
        } catch (error) {
          if (error.code !== "ESRCH") uncertainty ??= error;
        }
      }
      const directRunning = child.exitCode === null && child.signalCode === null;
      if (
        directRunning &&
        signalled.get(identities.get(child.pid)) !== signalNow &&
        directSignal !== signalNow
      ) {
        // The original ChildProcess handle is still ours even when group/namespace observation
        // is unavailable. Settle that direct child, but retain the incomplete-group failure.
        try {
          child.kill(signalNow);
          directSignal = signalNow;
        } catch (error) {
          if (error.code !== "ESRCH") uncertainty ??= error;
        }
      }
      if (!running && !directRunning) {
        if (uncertainty)
          throw failure(`Cancellation could not prove group completion: ${uncertainty.message}`);
        return;
      }
      if (performance.now() >= deadline)
        throw failure("Owned process cancellation did not settle after escalation.");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  return Object.freeze({
    cancel(signal = "SIGTERM") {
      completion ??= cancel(signal);
      return completion;
    },
  });
}

// Capture the canonical identity implementation at module load, before session admission. The
// synchronous I/O pump imports this embedded module, never repository files after admission.
const identityModule = `data:text/javascript;base64,${Buffer.from(
  readFileSync(new URL("./runtime-process-identity.mjs", import.meta.url), "utf8"),
).toString("base64")}`;
export const ownedProcessCancellationModule = `data:text/javascript;base64,${Buffer.from(
  `
import { readFileSync, readdirSync } from "node:fs";
import { constants } from "node:os";
import process from "node:process";
import { captureProcessIdentity, inspectProcessIdentity } from ${JSON.stringify(identityModule)};
export const createOwnedProcessCancellation = ${createOwnedProcessCancellation.toString()};
`,
).toString("base64")}`;
