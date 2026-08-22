/** Owns OS-bound process identity and inherited guard discovery for repository lifecycle safety. */
import { existsSync, readFileSync, readlinkSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const linuxBootIdPath = "/proc/sys/kernel/random/boot_id";
const bootIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const linuxStartIdentityPattern =
  /^linux:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):(\d+):(\d+):(\d+)$/u;

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
  if (!bootIdPattern.test(value)) throw new Error("Linux boot identity is invalid.");
  return value;
}

function linuxObserverPidNamespaceIdentity() {
  const stats = statSync("/proc/self/ns/pid", { bigint: true });
  return Object.freeze({ device: String(stats.dev), inode: String(stats.ino) });
}

function parseLinuxStartIdentity(value) {
  const match = linuxStartIdentityPattern.exec(value ?? "");
  if (!match) return null;
  return Object.freeze({
    bootId: match[1],
    namespace: Object.freeze({ device: match[2], inode: match[3] }),
    startTicks: match[4],
  });
}

function sameNamespaceIdentity(left, right) {
  return left?.device === right?.device && left?.inode === right?.inode;
}

/** Captures a PID together with an OS start identity that detects PID reuse when available. */
export function captureProcessIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("Process identity requires a positive process id.");
  }
  let startIdentity = null;
  if (process.platform === "linux") {
    try {
      const namespace = linuxObserverPidNamespaceIdentity();
      startIdentity = `linux:${linuxBootId()}:${namespace.device}:${namespace.inode}:${linuxStartTicks(pid)}`;
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
  const parsedStartIdentity = parseLinuxStartIdentity(identity?.startIdentity);
  if (
    !identity ||
    typeof identity !== "object" ||
    Array.isArray(identity) ||
    Object.keys(identity).sort().join("\n") !== "pid\nstartIdentity" ||
    !Number.isSafeInteger(identity.pid) ||
    identity.pid <= 0 ||
    (identity.startIdentity !== null &&
      (typeof identity.startIdentity !== "string" || parsedStartIdentity === null))
  ) {
    throw new Error("Recorded process identity is invalid.");
  }
  // A numeric PID is meaningful only in the observer namespace that captured it. Sandboxed tool
  // processes may run in a child PID namespace where a live launcher is deliberately invisible;
  // treating that namespace-relative ESRCH as death would let housekeeping clear a live writer.
  if (parsedStartIdentity) {
    if (process.platform !== "linux") return "unknown";
    let observerNamespace;
    try {
      observerNamespace = linuxObserverPidNamespaceIdentity();
    } catch (error) {
      if (["EACCES", "ENOENT", "EPERM"].includes(error?.code)) return "unknown";
      throw error;
    }
    if (!sameNamespaceIdentity(parsedStartIdentity.namespace, observerNamespace)) return "unknown";
  }
  const signalled = signalStatus(identity.pid);
  if (signalled === "unknown") return "unknown";
  if (signalled === "stale") {
    // A null identity does not bind the numeric PID to the observer's Linux namespace. ESRCH may
    // therefore mean that a live process is invisible from a child namespace, not that it exited.
    // Preserve that current but indeterminate state for ownership confirmation. A namespace-bound
    // identity can prove same-namespace death; other platforms retain their numeric-PID fallback.
    if (identity.startIdentity === null) return process.platform === "linux" ? "unknown" : "stale";
    return "stale";
  }
  if (identity.startIdentity === null) return process.platform === "linux" ? "unknown" : "active";
  const current = captureProcessIdentity(identity.pid);
  if (!current || current.startIdentity === null) return "unknown";
  return current.startIdentity === identity.startIdentity ? "active" : "stale";
}

function sameFileIdentity(stats, identity) {
  return String(stats.dev) === identity.device && String(stats.ino) === identity.inode;
}

function pathIsInside(root, target) {
  if (!path.isAbsolute(target)) return false;
  const relative = path.relative(root, target).split(path.sep).join("/");
  return relative !== ".." && !relative.startsWith("../");
}

/**
 * Reports whether a same-user Linux process holds a matching repository path open. Permission-
 * obscured descriptor tables of processes observably bound to this root are unknown, never
 * inactive; account-wide processes without repository provenance are discovery only.
 */
export function inspectLinuxOpenRepositoryPaths({
  root,
  matchesPath,
  excludePids = [process.pid],
  procRoot = "/proc",
  testHooks = {},
}) {
  if (!path.isAbsolute(root) || typeof matchesPath !== "function") {
    throw new Error("Open-path inspection requires an absolute root and path matcher.");
  }
  if (process.platform !== "linux" || !existsSync(procRoot)) {
    return Object.freeze({ observationComplete: false, status: "unknown" });
  }
  const readDirectory = testHooks.readDirectory ?? readdirSync;
  const readLink = testHooks.readLink ?? readlinkSync;
  const readStats = testHooks.readStats ?? statSync;
  const processIsBoundToRoot = (processPath) => {
    try {
      return pathIsInside(
        root,
        readLink(path.join(processPath, "cwd")).replace(/ \(deleted\)$/u, ""),
      );
    } catch (error) {
      if (["EACCES", "ENOENT", "EPERM"].includes(error?.code)) return false;
      throw error;
    }
  };
  const excluded = new Set(excludePids);
  let observationComplete = true;
  let processNames;
  try {
    processNames = readDirectory(procRoot);
  } catch (error) {
    if (!["EACCES", "ENOENT", "EPERM"].includes(error?.code)) throw error;
    return Object.freeze({ observationComplete: false, status: "unknown" });
  }
  for (const name of processNames) {
    if (!/^[1-9]\d*$/u.test(name) || excluded.has(Number(name))) continue;
    const processPath = path.join(procRoot, name);
    try {
      if (typeof process.getuid === "function" && readStats(processPath).uid !== process.getuid()) {
        continue;
      }
      for (const descriptor of readDirectory(path.join(processPath, "fd"))) {
        let target;
        try {
          target = readLink(path.join(processPath, "fd", descriptor)).replace(/ \(deleted\)$/u, "");
        } catch (error) {
          if (!["EACCES", "ENOENT", "EPERM"].includes(error?.code)) throw error;
          if (error?.code !== "ENOENT" && processIsBoundToRoot(processPath)) {
            observationComplete = false;
          }
          continue;
        }
        if (!path.isAbsolute(target)) continue;
        const relative = path.relative(root, target).split(path.sep).join("/");
        if (pathIsInside(root, target) && matchesPath(relative)) {
          return Object.freeze({ observationComplete, status: "active" });
        }
      }
    } catch (error) {
      if (!["EACCES", "ENOENT", "EPERM"].includes(error?.code)) throw error;
      // Account-wide PID visibility is discovery, not ownership provenance. Permission-obscured
      // processes become blockers only when their observable cwd binds them to this exact root.
      if (error?.code !== "ENOENT" && processIsBoundToRoot(processPath)) {
        observationComplete = false;
      }
    }
  }
  return Object.freeze({
    observationComplete,
    status: observationComplete ? "inactive" : "unknown",
  });
}

/**
 * Finds same-user Linux processes that still hold an inherited capability guard. Other platforms
 * are unknown. Linux reports whether every same-user descriptor table was observable separately so
 * unresolved spawn delegations can fail closed without blocking ordinary delegation-free release.
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
    return Object.freeze({
      holders: Object.freeze([]),
      observationComplete: false,
      status: "unknown",
    });
  }
  const excluded = new Set(excludePids);
  const holders = [];
  let observationComplete = true;
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
          if (["EACCES", "EPERM"].includes(error?.code)) observationComplete = false;
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
        // A vanished process is harmless. Policy-obscured same-user descriptor tables are recorded
        // separately because an unresolved spawn witness may still refer to an inherited holder.
        if (["EACCES", "EPERM"].includes(error?.code)) observationComplete = false;
        continue;
      }
      throw error;
    }
  }
  return Object.freeze({
    holders: Object.freeze(holders),
    observationComplete,
    status: obscured ? "unknown" : holders.length > 0 ? "active" : "stale",
  });
}
