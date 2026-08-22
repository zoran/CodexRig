/** Owns process-bound Git lock reasons used to preserve non-missing prunable worktrees. */
import { randomUUID } from "node:crypto";
import process from "node:process";
import { captureProcessIdentity, inspectProcessIdentity } from "./runtime-process-identity.mjs";

export const worktreePreservationLockReason =
  "codexrig:repository-housekeeping:preserve-native-prune:v1";
const ownerTokenPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const preservationReasonPayloadPattern = /^[A-Za-z0-9_-]{1,1024}$/u;

function validOwner(owner) {
  try {
    inspectProcessIdentity(owner);
    return true;
  } catch {
    return false;
  }
}

/** Creates the one process-bound Git lock reason used by the current cleanup transaction. */
export function createWorktreePreservationLockReason({
  owner = captureProcessIdentity(process.pid),
} = {}) {
  if (!owner) throw new Error("Worktree preservation lock could not bind its owner process.");
  if (!validOwner(owner)) throw new Error("Worktree preservation lock owner is invalid.");
  const payload = Buffer.from(
    JSON.stringify({ schemaVersion: 1, owner, token: randomUUID() }),
    "utf8",
  ).toString("base64url");
  return `${worktreePreservationLockReason}:${payload}`;
}

/** Parses only the one current process-bound preservation-lock contract. */
export function inspectWorktreePreservationLock(reason) {
  if (typeof reason !== "string" || !reason.startsWith(`${worktreePreservationLockReason}:`)) {
    return null;
  }
  const payload = reason.slice(worktreePreservationLockReason.length + 1);
  if (!preservationReasonPayloadPattern.test(payload)) return null;
  let buffer;
  let value;
  try {
    buffer = Buffer.from(payload, "base64url");
    if (buffer.toString("base64url") !== payload) return null;
    value = JSON.parse(buffer.toString("utf8"));
  } catch {
    return null;
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !== "owner\nschemaVersion\ntoken" ||
    value.schemaVersion !== 1 ||
    typeof value.token !== "string" ||
    !ownerTokenPattern.test(value.token)
  ) {
    return null;
  }
  try {
    return Object.freeze({
      owner: Object.freeze(value.owner),
      status: inspectProcessIdentity(value.owner),
      token: value.token,
    });
  } catch {
    return null;
  }
}

/** Returns the exact owner status only for the current preservation-lock contract. */
export function inspectWorktreePreservationLockOwner(reason) {
  return inspectWorktreePreservationLock(reason)?.status ?? null;
}
