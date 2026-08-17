/** Owns OS-bound process identity and inherited guard discovery for repository lifecycle safety. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import process from "node:process";

const linuxBootIdPath = "/proc/sys/kernel/random/boot_id";

function signalStatus(pid) {
  try {
    process.kill(pid, 0);
    return "active";
  } catch (error) {
    return error?.code === "ESRCH" ? "stale" : "unknown";
  }
}

function linuxStartTicks(pid) {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const commandEnd = stat.lastIndexOf(")");
  if (commandEnd < 2) throw new Error("Linux process stat has an invalid command field.");
  const fields = stat
    .slice(commandEnd + 1)
    .trim()
    .split(/\s+/u);
  const startTicks = fields[19];
  if (!/^\d+$/u.test(startTicks ?? "")) {
    throw new Error("Linux process stat has no valid start identity.");
  }
  return startTicks;
}

function linuxBootId() {
  const value = readFileSync(linuxBootIdPath, "utf8").trim().toLowerCase();
  if (!/^[a-f0-9-]{36}$/u.test(value)) throw new Error("Linux boot identity is invalid.");
  return value;
}

/** Captures a PID together with an OS start identity that detects PID reuse when available. */
export function captureProcessIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("Process identity requires a positive process id.");
  }
  let startIdentity = null;
  if (process.platform === "linux") {
    try {
      startIdentity = `linux:${linuxBootId()}:${linuxStartTicks(pid)}`;
    } catch (error) {
      if (signalStatus(pid) === "stale") return null;
      if (!["EACCES", "ENOENT", "EPERM"].includes(error?.code)) throw error;
    }
  }
  if (signalStatus(pid) === "stale") return null;
  return Object.freeze({ pid, startIdentity });
}

/** Returns active, stale, or unknown without accepting a reused PID as the recorded process. */
export function inspectProcessIdentity(identity) {
  if (
    !identity ||
    typeof identity !== "object" ||
    Array.isArray(identity) ||
    Object.keys(identity).sort().join("\n") !== "pid\nstartIdentity" ||
    !Number.isSafeInteger(identity.pid) ||
    identity.pid <= 0 ||
    (identity.startIdentity !== null &&
      (typeof identity.startIdentity !== "string" ||
        !/^linux:[a-f0-9-]{36}:\d+$/u.test(identity.startIdentity)))
  ) {
    throw new Error("Recorded process identity is invalid.");
  }
  const signalled = signalStatus(identity.pid);
  if (signalled === "unknown") return "unknown";
  if (signalled === "stale") return "stale";
  if (identity.startIdentity === null) return "unknown";
  const current = captureProcessIdentity(identity.pid);
  if (!current || current.startIdentity === null) return "unknown";
  return current.startIdentity === identity.startIdentity ? "active" : "stale";
}

function sameFileIdentity(stats, identity) {
  return String(stats.dev) === identity.device && String(stats.ino) === identity.inode;
}

/**
 * Finds same-user Linux processes that still hold an inherited capability guard. Other platforms
 * and permission-obscured procfs views are intentionally unknown so stale reclaim fails closed.
 */
export function inspectGuardHolders(identity, { excludePids = [] } = {}) {
  if (
    !identity ||
    typeof identity !== "object" ||
    Array.isArray(identity) ||
    Object.keys(identity).sort().join("\n") !== "device\ninode" ||
    !/^\d+$/u.test(identity.device ?? "") ||
    !/^\d+$/u.test(identity.inode ?? "")
  ) {
    throw new Error("Lifecycle guard identity is invalid.");
  }
  if (process.platform !== "linux" || !existsSync("/proc")) {
    return Object.freeze({ holders: Object.freeze([]), status: "unknown" });
  }
  const excluded = new Set(excludePids);
  const holders = [];
  let obscured = false;
  for (const name of readdirSync("/proc")) {
    if (!/^[1-9]\d*$/u.test(name)) continue;
    const pid = Number(name);
    if (excluded.has(pid)) continue;
    const processPath = `/proc/${name}`;
    try {
      if (typeof process.getuid === "function" && statSync(processPath).uid !== process.getuid()) {
        continue;
      }
      let ownsGuard = false;
      for (const descriptor of readdirSync(`${processPath}/fd`)) {
        try {
          if (sameFileIdentity(statSync(`${processPath}/fd/${descriptor}`), identity)) {
            ownsGuard = true;
            break;
          }
        } catch (error) {
          if (!["EACCES", "ENOENT", "EPERM"].includes(error?.code)) throw error;
        }
      }
      if (!ownsGuard) continue;
      const processIdentity = captureProcessIdentity(pid);
      if (!processIdentity || processIdentity.startIdentity === null) {
        obscured = true;
      } else {
        holders.push(processIdentity);
      }
    } catch (error) {
      if (["EACCES", "ENOENT", "EPERM"].includes(error?.code)) {
        // Same-user processes whose descriptor tables are policy-obscured are outside the
        // repository capability's observed holder set. A matching visible descriptor still turns
        // unknown if its own start identity cannot be captured.
        continue;
      }
      throw error;
    }
  }
  return Object.freeze({
    holders: Object.freeze(holders),
    status: obscured ? "unknown" : holders.length > 0 ? "active" : "stale",
  });
}
