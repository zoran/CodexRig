/** Owns the source compatibility contract for nonblocking toolchain experiments. */
import { validateToolchainConfiguration } from "./toolchain-configuration.mjs";
export const supportedCompatibilitySchema = 3;
function requiredObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value;
}
function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string.`);
  return value;
}
export function validateCompatibilityMatrix(matrix) {
  if (matrix.schemaVersion !== supportedCompatibilitySchema)
    throw new Error("Unsupported source compatibility schema.");
  validateToolchainConfiguration({
    schemaVersion: 1,
    reviewedOn: matrix.reviewedOn,
    ci: matrix.ci,
    stable: matrix.stable,
  });
  if (!Array.isArray(matrix.canaries) || matrix.canaries.length === 0) {
    throw new Error("Compatibility matrix must declare at least one canary.");
  }
  const ids = new Set();
  for (const [index, entryValue] of matrix.canaries.entries()) {
    const entry = requiredObject(entryValue, `compatibility.canaries[${index}]`);
    const id = requiredString(entry.id, `compatibility.canaries[${index}].id`);
    if (!/^[a-z][a-z0-9-]*$/u.test(id) || ids.has(id)) {
      throw new Error("Compatibility canary ids must be unique lowercase slugs.");
    }
    ids.add(id);
    requiredString(entry.description, `compatibility.canaries[${index}].description`);
    requiredString(entry.node, `compatibility.canaries[${index}].node`);
    requiredString(entry.pnpm, `compatibility.canaries[${index}].pnpm`);
    requiredString(entry.codex, `compatibility.canaries[${index}].codex`);
    if (typeof entry.required !== "boolean") {
      throw new Error(`compatibility.canaries[${index}].required must be boolean.`);
    }
  }
  return matrix;
}
