/** Owns the exact lifecycle-capability schema and process-liveness classification. */
import { inspectGuardHolders, inspectProcessIdentity } from "./runtime-process-identity.mjs";

export const runtimeLifecycleOperationPattern = /^[a-z][a-z0-9-]{1,63}$/u;
const delegationGraceMilliseconds = 10_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function validIsoInstant(value) {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function validProcessIdentity(value) {
  try {
    inspectProcessIdentity(value);
    return true;
  } catch {
    return false;
  }
}

/** Rejects unknown lifecycle fields so stale tools cannot silently weaken current ownership. */
export function validRuntimeLifecycleOwner(owner, identity) {
  if (
    !owner ||
    typeof owner !== "object" ||
    Array.isArray(owner) ||
    Object.keys(owner).sort().join("\n") !==
      "coordinator\ndelegations\ndescendants\nguard\nnonce\noperation\nroot\nschemaVersion\nstartedAt" ||
    owner.schemaVersion !== 2 ||
    !validProcessIdentity(owner.coordinator) ||
    !runtimeLifecycleOperationPattern.test(owner.operation ?? "") ||
    typeof owner.nonce !== "string" ||
    !uuidPattern.test(owner.nonce) ||
    !validIsoInstant(owner.startedAt) ||
    JSON.stringify(owner.root) !== JSON.stringify(identity) ||
    !Array.isArray(owner.descendants) ||
    !Array.isArray(owner.delegations) ||
    owner.descendants.length > 64 ||
    owner.delegations.length > 64
  ) {
    return false;
  }
  if (
    owner.guard !== null &&
    (!owner.guard ||
      typeof owner.guard !== "object" ||
      Array.isArray(owner.guard) ||
      Object.keys(owner.guard).sort().join("\n") !== "device\ninode" ||
      !/^\d+$/u.test(owner.guard.device ?? "") ||
      !/^\d+$/u.test(owner.guard.inode ?? ""))
  ) {
    return false;
  }
  const descendantKeys = new Set();
  for (const descendant of owner.descendants) {
    if (
      !descendant ||
      typeof descendant !== "object" ||
      Array.isArray(descendant) ||
      Object.keys(descendant).sort().join("\n") !== "identity\nregisteredAt\nrole" ||
      !validProcessIdentity(descendant.identity) ||
      !runtimeLifecycleOperationPattern.test(descendant.role ?? "") ||
      !validIsoInstant(descendant.registeredAt)
    ) {
      return false;
    }
    const key = `${descendant.identity.pid}:${descendant.identity.startIdentity}`;
    if (descendantKeys.has(key)) return false;
    descendantKeys.add(key);
  }
  const delegationTokens = new Set();
  for (const delegation of owner.delegations) {
    if (
      !delegation ||
      typeof delegation !== "object" ||
      Array.isArray(delegation) ||
      Object.keys(delegation).sort().join("\n") !== "issuedAt\noperation\nrole\ntoken" ||
      typeof delegation.token !== "string" ||
      !uuidPattern.test(delegation.token) ||
      !runtimeLifecycleOperationPattern.test(delegation.operation ?? "") ||
      !runtimeLifecycleOperationPattern.test(delegation.role ?? "") ||
      !validIsoInstant(delegation.issuedAt) ||
      delegationTokens.has(delegation.token)
    ) {
      return false;
    }
    delegationTokens.add(delegation.token);
  }
  return true;
}

/** Classifies the complete coordinator/descendant/guard capability, never PID alone. */
export function runtimeLifecycleStatus(owner) {
  const coordinator = inspectProcessIdentity(owner.coordinator);
  if (coordinator === "active" || coordinator === "unknown") return coordinator;
  const descendantStates = owner.descendants.map(({ identity }) =>
    inspectProcessIdentity(identity),
  );
  if (descendantStates.includes("active")) return "active";
  if (descendantStates.includes("unknown")) return "unknown";
  if (owner.guard) {
    const holders = inspectGuardHolders(owner.guard);
    if (holders.status === "active" || holders.status === "unknown") return holders.status;
  }
  if (
    owner.delegations.some(
      ({ issuedAt }) => Date.now() - Date.parse(issuedAt) <= delegationGraceMilliseconds,
    )
  ) {
    return "unknown";
  }
  return "stale";
}

export function lifecycleGuardIdentity(stats) {
  return { device: String(stats.dev), inode: String(stats.ino) };
}

export function sameLifecycleGuardIdentity(stats, expected) {
  return String(stats.dev) === expected?.device && String(stats.ino) === expected?.inode;
}
