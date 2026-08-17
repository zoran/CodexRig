/** Owns the bounded published schema-one bootstrap at the framework child-upgrade boundary. */
import {
  frameworkRoot,
  readRegularFrameworkFile,
  serializeCanonicalJson,
  sha256,
  supportedContractSchema,
  supportedReceiptSchema,
  validateFrameworkContract,
  validateInstallationReceipt,
} from "../contracts/framework-contract.mjs";
import { policyProjectionPath, validatePolicyProjection } from "./policy-projection.mjs";

const legacyPolicyIds = Object.freeze([
  "authorized-continuation",
  "central-integration",
  "definition-intake",
  "framework-lifecycle",
  "memory-isolation",
  "modular-boundaries",
  "provider-parity",
  "verification-lifecycle",
]);
const publishedLegacyVersion = "1.2.1";
const publishedLegacyBaselinePath = "scripts/framework/bootstrap/1.2.1.json";
const publishedLegacyContractPath = "scripts/framework/bootstrap/1.2.1/framework.json";
const publishedLegacyPolicyPath = "scripts/framework/bootstrap/1.2.1/policy-projection.json";
const publishedLegacyFingerprints = Object.freeze({
  baseline: "0379b4f68910097d1c2ab2863ffa2670044952081f2fa98a50274116ad8fb3be",
  contract: "6356e2ccb968c3fdc8cf7c52471c3c185feef0c28d3898dc809599d55c0e4cb7",
  policyProjection: "0a1cb55d4c451391f49890137a6453f3f6b303d9233664d6937fed101a5401f9",
});
const legacySurfaceDocuments = Object.freeze({
  agents: Object.freeze(["AGENTS.md", "instructions.md"]),
  manifest: Object.freeze(["docs/project.md"]),
  readme: Object.freeze(["README.md"]),
});

function regularJson(root, relativePath, label) {
  try {
    return JSON.parse(readRegularFrameworkFile(root, relativePath));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} must contain valid JSON.`);
    throw error;
  }
}

function canonicalDigest(value) {
  return sha256(serializeCanonicalJson(value));
}

let cachedPublishedLegacyBaseline;
function publishedLegacyBaseline() {
  if (cachedPublishedLegacyBaseline) return cachedPublishedLegacyBaseline;
  const baseline = regularJson(
    frameworkRoot,
    publishedLegacyBaselinePath,
    "Published 1.2.1 bootstrap baseline",
  );
  const contract = regularJson(
    frameworkRoot,
    publishedLegacyContractPath,
    "Published 1.2.1 framework contract",
  );
  const policyProjection = regularJson(
    frameworkRoot,
    publishedLegacyPolicyPath,
    "Published 1.2.1 policy projection",
  );
  if (
    canonicalDigest(baseline) !== publishedLegacyFingerprints.baseline ||
    canonicalDigest(contract) !== publishedLegacyFingerprints.contract ||
    canonicalDigest(policyProjection) !== publishedLegacyFingerprints.policyProjection ||
    baseline?.schemaVersion !== 1 ||
    baseline.frameworkId !== "codexrig" ||
    baseline.frameworkVersion !== publishedLegacyVersion ||
    publishedLegacyFingerprints.contract !== baseline.contractSha256 ||
    publishedLegacyFingerprints.policyProjection !== baseline.policyProjectionSha256 ||
    !baseline.managedFiles ||
    typeof baseline.managedFiles !== "object" ||
    Array.isArray(baseline.managedFiles) ||
    !baseline.managedPackage ||
    typeof baseline.managedPackage !== "object" ||
    Array.isArray(baseline.managedPackage)
  ) {
    throw new Error("Published 1.2.1 bootstrap baseline is internally inconsistent.");
  }
  cachedPublishedLegacyBaseline = Object.freeze({ baseline, contract, policyProjection });
  return cachedPublishedLegacyBaseline;
}

function recursivelySorted(value) {
  if (Array.isArray(value)) return value.map(recursivelySorted);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, recursivelySorted(value[key])]),
  );
}

function sameCanonicalValue(left, right) {
  return JSON.stringify(recursivelySorted(left)) === JSON.stringify(recursivelySorted(right));
}

function exactObjectKeys(value, expected, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !== [...expected].sort().join("\n")
  ) {
    throw new Error(`${label} does not match the exact published 1.2.1 shape.`);
  }
}

function legacySurfaces(value, label) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (entry) => typeof entry !== "string" || !Object.hasOwn(legacySurfaceDocuments, entry),
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function legacyPolicyProjection(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.invariants)
  ) {
    throw new Error("Legacy framework upgrade policy projection is invalid.");
  }
  const ids = new Set();
  const policies = value.invariants.map((entry, index) => {
    const label = `legacy policy projection invariants[${index}]`;
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.id !== "string" ||
      !/^[a-z][a-z0-9-]*$/u.test(entry.id) ||
      ids.has(entry.id) ||
      typeof entry.statement !== "string" ||
      !entry.statement.trim() ||
      /[\0\r\n]/u.test(entry.statement)
    ) {
      throw new Error(`${label} is invalid.`);
    }
    const surfaces = legacySurfaces(entry.surfaces, `${label}.surfaces`);
    const projectionSurfaces = surfaces.filter((surface) => surface !== "manifest");
    if (projectionSurfaces.length === 0) {
      throw new Error(`${label} has no supported generated surface.`);
    }
    const reconcileDocuments = [
      ...new Set(surfaces.flatMap((surface) => legacySurfaceDocuments[surface])),
    ].sort();
    ids.add(entry.id);
    return Object.freeze({
      id: entry.id,
      projectionStatement: entry.statement.trim(),
      projectionSurfaces: Object.freeze(projectionSurfaces),
      reconcileDocuments: Object.freeze(reconcileDocuments),
      statement: entry.statement.trim(),
      version: 1,
    });
  });
  if ([...ids].sort().join("\n") !== [...legacyPolicyIds].sort().join("\n")) {
    throw new Error("Legacy framework upgrade policy projection is incomplete or unsupported.");
  }
  return Object.freeze({ policies: Object.freeze(policies), schemaVersion: 1 });
}

function targetContract(value) {
  if (value?.schemaVersion === supportedContractSchema) {
    return validateFrameworkContract(value);
  }
  if (value?.schemaVersion !== 1) {
    throw new Error(
      `Unsupported framework upgrade target schema ${String(value?.schemaVersion)}; expected 1 or ${supportedContractSchema}.`,
    );
  }
  const published = publishedLegacyBaseline();
  if (
    value.frameworkVersion !== publishedLegacyVersion ||
    !sameCanonicalValue(value, published.contract)
  ) {
    throw new Error("Legacy framework upgrade contract is not the exact published 1.2.1 input.");
  }
  const upgradedValue = structuredClone(value);
  const legacyExcludedPaths = upgradedValue.upgrade.excludedPaths;
  delete upgradedValue.upgrade.excludedPaths;
  upgradedValue.upgrade.excludedPathReasons = Object.fromEntries(
    legacyExcludedPaths.map((relativePath) => [
      relativePath,
      "Published schema-one source-only path.",
    ]),
  );
  const normalized = validateFrameworkContract({
    ...upgradedValue,
    schemaVersion: supportedContractSchema,
  });
  normalized.schemaVersion = 1;
  return normalized;
}

function targetReceipt(value, contractSchema) {
  if (contractSchema === supportedContractSchema) {
    if (value?.schemaVersion !== supportedReceiptSchema) {
      throw new Error("Active framework upgrade targets require the active receipt schema.");
    }
    return validateInstallationReceipt(value);
  }
  if (value?.schemaVersion !== 1 || Object.hasOwn(value, "pendingReconciliation")) {
    throw new Error(
      `Unsupported framework upgrade target receipt schema ${String(value?.schemaVersion)}.`,
    );
  }
  exactObjectKeys(
    value,
    [
      "schemaVersion",
      "frameworkId",
      "frameworkVersion",
      "managedFiles",
      "installedFiles",
      "managedPackage",
      "installedPackage",
    ],
    "Legacy framework upgrade receipt",
  );
  const normalized = validateInstallationReceipt({
    ...structuredClone(value),
    pendingReconciliation: null,
    schemaVersion: supportedReceiptSchema,
  });
  const published = publishedLegacyBaseline().baseline;
  if (
    normalized.frameworkVersion !== publishedLegacyVersion ||
    !sameCanonicalValue(normalized.managedFiles, published.managedFiles) ||
    !sameCanonicalValue(normalized.installedFiles, published.managedFiles) ||
    !sameCanonicalValue(normalized.managedPackage, published.managedPackage) ||
    !sameCanonicalValue(normalized.installedPackage, published.managedPackage)
  ) {
    throw new Error("Legacy framework upgrade receipt is not the exact published 1.2.1 input.");
  }
  normalized.schemaVersion = 1;
  return normalized;
}

function targetPolicyProjection(value, contractSchema) {
  if (contractSchema === 1) {
    if (value?.schemaVersion !== 1) {
      throw new Error(
        "Published schema-one targets require their exact schema-one policy inventory.",
      );
    }
    if (!sameCanonicalValue(value, publishedLegacyBaseline().policyProjection)) {
      throw new Error(
        "Legacy framework upgrade policy projection is not the exact published 1.2.1 input.",
      );
    }
    return legacyPolicyProjection(value);
  }
  if (value?.schemaVersion !== 3) {
    throw new Error("Active framework upgrade targets require policy projection schema 3.");
  }
  return validatePolicyProjection(value);
}

export function readFrameworkUpgradeTargetState(root) {
  const contract = targetContract(
    regularJson(root, ".codexrig/framework.json", "Framework upgrade target contract"),
  );
  const receipt = targetReceipt(
    regularJson(root, contract.upgrade.receiptFile, "Framework upgrade target receipt"),
    contract.schemaVersion,
  );
  const policyProjection = targetPolicyProjection(
    regularJson(root, policyProjectionPath, "Framework upgrade target policy projection"),
    contract.schemaVersion,
  );
  if (
    receipt.frameworkId !== contract.frameworkId ||
    receipt.frameworkVersion !== contract.frameworkVersion
  ) {
    throw new Error("Framework upgrade target contract and receipt identity do not match.");
  }
  return Object.freeze({ contract, policyProjection, receipt });
}
