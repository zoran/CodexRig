/** Owns policy projection behavior for the framework lifecycle and child upgrade boundary. */
import { frameworkRoot, readRegularFrameworkFile } from "../contracts/framework-contract.mjs";

export const policyProjectionPath = ".codexrig/policy-projection.json";

const allowedSurfaces = Object.freeze(["agents", "readme"]);
const allowedReconciliationDocuments = new Set([
  ".codex/README.md",
  "AGENTS.md",
  "README.md",
  "config/delivery.json",
  "config/localization.json",
  "config/product.json",
  "config/tenancy.json",
  "docs/context-index.md",
  "docs/future-modules.md",
  "docs/project.md",
  "instructions.md",
]);
const requiredPolicyIds = Object.freeze([
  "agent-orchestration",
  "architecture-evolution",
  "authorized-continuation",
  "best-available-engineering",
  "central-integration",
  "codex-runtime-permissions",
  "critical-budget-handover",
  "current-contract-only",
  "definition-intake",
  "delivery-environments",
  "documentation-context-economy",
  "feature-domain-placement",
  "framework-lifecycle",
  "framework-versioning",
  "framework-transparency",
  "identity-access-boundary",
  "localization-strategy",
  "licensing-attribution",
  "manifest-reality",
  "memory-isolation",
  "modular-boundaries",
  "multi-device-experience",
  "product-surface-selection",
  "provider-parity",
  "repository-housekeeping",
  "requirement-driven-technology",
  "semantic-child-upgrades",
  "source-header-contract",
  "startup-reconstruction",
  "system-coherence",
  "tenant-isolation",
  "verification-lifecycle",
  "white-label-products",
]);

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueStringArray(value, label, allowed) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }
  const entries = value.map((entry) => {
    if (typeof entry !== "string" || !entry || /[\0\r\n]/u.test(entry)) {
      throw new Error(`${label} contains an invalid value.`);
    }
    if (allowed && !allowed.has(entry)) {
      throw new Error(`${label} contains unsupported value ${entry}.`);
    }
    return entry;
  });
  if (new Set(entries).size !== entries.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return Object.freeze(entries);
}

export function validatePolicyProjection(value) {
  if (!plainObject(value) || value.schemaVersion !== 3 || !Array.isArray(value.policies)) {
    throw new Error("CodexRig policy projection is invalid.");
  }
  const ids = new Set();
  const policies = value.policies.map((entry, index) => {
    const label = `policy projection policies[${index}]`;
    if (
      !plainObject(entry) ||
      typeof entry.id !== "string" ||
      !/^[a-z][a-z0-9-]*$/u.test(entry.id) ||
      ids.has(entry.id) ||
      !Number.isSafeInteger(entry.version) ||
      entry.version < 1 ||
      typeof entry.statement !== "string" ||
      !entry.statement.trim() ||
      /[\0\r\n]/u.test(entry.statement) ||
      typeof entry.projectionStatement !== "string" ||
      !entry.projectionStatement.trim() ||
      /[\0\r\n]/u.test(entry.projectionStatement)
    ) {
      throw new Error(`${label} is invalid.`);
    }
    const projectionSurfaces = uniqueStringArray(
      entry.projectionSurfaces,
      `${label}.projectionSurfaces`,
      new Set(allowedSurfaces),
    );
    const reconcileDocuments = uniqueStringArray(
      entry.reconcileDocuments,
      `${label}.reconcileDocuments`,
      allowedReconciliationDocuments,
    );
    ids.add(entry.id);
    return Object.freeze({
      id: entry.id,
      projectionSurfaces,
      reconcileDocuments,
      projectionStatement: entry.projectionStatement.trim(),
      statement: entry.statement.trim(),
      version: entry.version,
    });
  });
  if ([...ids].sort().join("\n") !== [...requiredPolicyIds].sort().join("\n")) {
    throw new Error("CodexRig policy projection does not own the complete policy set.");
  }
  return Object.freeze({ schemaVersion: value.schemaVersion, policies: Object.freeze(policies) });
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
    .policies.filter((policy) => policy.projectionSurfaces.includes(surface))
    .map((policy) => `- ${policy.projectionStatement}`);
}

export function policyProjectionChanges(installedProjection, sourceProjection) {
  if (installedProjection?.schemaVersion !== 3 || sourceProjection?.schemaVersion !== 3) {
    throw new Error("Policy projection comparison requires the current schema.");
  }
  const installed = new Map(installedProjection.policies.map((policy) => [policy.id, policy]));
  const source = new Map(sourceProjection.policies.map((policy) => [policy.id, policy]));
  const changes = [];
  for (const id of [...new Set([...installed.keys(), ...source.keys()])].sort()) {
    const before = installed.get(id);
    const after = source.get(id);
    if (before && after && after.version < before.version) {
      throw new Error(
        `Policy ${id} cannot decrease from version ${before.version} to ${after.version}.`,
      );
    }
    const samePolicy =
      before &&
      after &&
      before.statement === after.statement &&
      before.projectionStatement === after.projectionStatement &&
      JSON.stringify(before.projectionSurfaces) === JSON.stringify(after.projectionSurfaces) &&
      JSON.stringify(before.reconcileDocuments) === JSON.stringify(after.reconcileDocuments);
    if (before && after && before.version === after.version && !samePolicy) {
      throw new Error(`Policy ${id} changed without increasing its policy version.`);
    }
    const change = !before
      ? "added"
      : !after
        ? "retired"
        : before.version !== after.version || !samePolicy
          ? "changed"
          : null;
    if (!change) continue;
    changes.push(
      Object.freeze({
        change,
        documents: Object.freeze([...(after ?? before).reconcileDocuments]),
        fromVersion: before?.version ?? null,
        id,
        statement: after?.statement ?? before.statement,
        toVersion: after?.version ?? null,
      }),
    );
  }
  return Object.freeze(changes);
}
