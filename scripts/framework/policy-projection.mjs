import { frameworkRoot, readRegularFrameworkFile } from "./framework-contract.mjs";

export const policyProjectionPath = ".codexrig/policy-projection.json";
const allowedSurfaces = Object.freeze(["agents", "manifest", "readme"]);
const requiredInvariantIds = Object.freeze([
  "authorized-continuation",
  "central-integration",
  "definition-intake",
  "framework-lifecycle",
  "memory-isolation",
  "modular-boundaries",
  "provider-parity",
  "verification-lifecycle",
]);

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validatePolicyProjection(value) {
  if (!plainObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.invariants)) {
    throw new Error("CodexRig policy projection is invalid.");
  }
  const ids = new Set();
  const invariants = value.invariants.map((entry) => {
    if (
      !plainObject(entry) ||
      typeof entry.id !== "string" ||
      !/^[a-z][a-z0-9-]*$/u.test(entry.id) ||
      ids.has(entry.id) ||
      typeof entry.statement !== "string" ||
      !entry.statement.trim() ||
      /[\0\r\n]/u.test(entry.statement) ||
      !Array.isArray(entry.surfaces) ||
      entry.surfaces.length !== allowedSurfaces.length ||
      entry.surfaces.some(
        (surface, index) =>
          !allowedSurfaces.includes(surface) || entry.surfaces.indexOf(surface) !== index,
      )
    ) {
      throw new Error("CodexRig policy projection contains an invalid invariant.");
    }
    ids.add(entry.id);
    return Object.freeze({
      id: entry.id,
      statement: entry.statement.trim(),
      surfaces: Object.freeze([...entry.surfaces]),
    });
  });
  if ([...ids].sort().join("\n") !== [...requiredInvariantIds].sort().join("\n")) {
    throw new Error("CodexRig policy projection does not own the complete invariant set.");
  }
  return Object.freeze({ schemaVersion: 1, invariants: Object.freeze(invariants) });
}

export function readPolicyProjection(root = frameworkRoot) {
  let value;
  try {
    value = JSON.parse(readRegularFrameworkFile(root, policyProjectionPath));
  } catch (error) {
    if (/policy projection/u.test(error.message)) throw error;
    throw new Error("CodexRig policy projection must contain valid JSON.");
  }
  return validatePolicyProjection(value);
}

export function generatedPolicyProjectionLines(surface, root = frameworkRoot) {
  if (!allowedSurfaces.includes(surface)) {
    throw new Error(`Unsupported generated policy surface: ${surface}.`);
  }
  return readPolicyProjection(root)
    .invariants.filter((invariant) => invariant.surfaces.includes(surface))
    .map((invariant) => `- ${invariant.statement}`);
}
