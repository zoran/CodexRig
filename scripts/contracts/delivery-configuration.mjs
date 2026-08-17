/** Owns delivery configuration behavior for the versioned framework contract boundary. */
export const deliveryConfigurationPath = "config/delivery.json";
export const deliveryTargets = Object.freeze(["dev", "staging", "prod"]);

const targetSet = new Set(deliveryTargets);
const safeEvidencePathPattern = /^[A-Za-z0-9._/-]+$/u;

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function targetOrder(left, right) {
  return deliveryTargets.indexOf(left) - deliveryTargets.indexOf(right);
}

function canonicalDeclaredTargets(value) {
  return [...new Set(value)].sort(targetOrder);
}

function safeEvidencePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1_024 &&
    safeEvidencePathPattern.test(value) &&
    !value.startsWith("/") &&
    !value.startsWith("../") &&
    !value.includes("/../") &&
    value !== deliveryConfigurationPath
  );
}

export function canonicalDetectedTargets(value) {
  return value
    .map((entry) => ({
      evidence: [...new Set(entry.evidence)].sort(),
      target: entry.target,
    }))
    .sort((left, right) => targetOrder(left.target, right.target));
}

export function deliveryConfigurationFindings(content) {
  let value;
  try {
    value = JSON.parse(String(content));
  } catch {
    return [`${deliveryConfigurationPath} must contain valid JSON`];
  }

  const findings = [];
  if (!exactKeys(value, ["declaredTargets", "defaultTarget", "detectedTargets", "schemaVersion"])) {
    return [`${deliveryConfigurationPath} must contain the complete delivery inventory shape`];
  }
  if (value.schemaVersion !== 1) findings.push("delivery configuration schemaVersion must equal 1");
  if (value.defaultTarget !== "dev") {
    findings.push("delivery configuration defaultTarget must remain dev");
  }
  if (
    !Array.isArray(value.declaredTargets) ||
    value.declaredTargets.some((target) => !targetSet.has(target))
  ) {
    findings.push("delivery configuration declaredTargets must contain only dev, staging, or prod");
  } else if (
    JSON.stringify(value.declaredTargets) !==
    JSON.stringify(canonicalDeclaredTargets(value.declaredTargets))
  ) {
    findings.push("delivery configuration declaredTargets must be unique and canonically ordered");
  }

  if (!Array.isArray(value.detectedTargets)) {
    findings.push("delivery configuration detectedTargets must be an array");
  } else {
    const targets = [];
    for (const [index, entry] of value.detectedTargets.entries()) {
      if (!exactKeys(entry, ["evidence", "target"])) {
        findings.push(`delivery configuration detectedTargets[${index}] has an invalid shape`);
        continue;
      }
      targets.push(entry.target);
      if (!targetSet.has(entry.target)) {
        findings.push(`delivery configuration detectedTargets[${index}].target is invalid`);
      }
      if (
        !Array.isArray(entry.evidence) ||
        entry.evidence.length === 0 ||
        entry.evidence.some((evidence) => !safeEvidencePath(evidence)) ||
        JSON.stringify(entry.evidence) !== JSON.stringify([...new Set(entry.evidence)].sort())
      ) {
        findings.push(
          `delivery configuration detectedTargets[${index}].evidence must be non-empty, safe, unique, and sorted`,
        );
      }
    }
    if (new Set(targets).size !== targets.length) {
      findings.push("delivery configuration detectedTargets must contain each target at most once");
    }
    if (
      findings.length === 0 &&
      JSON.stringify(value.detectedTargets) !==
        JSON.stringify(canonicalDetectedTargets(value.detectedTargets))
    ) {
      findings.push("delivery configuration detectedTargets must be canonically ordered");
    }
  }
  return [...new Set(findings)];
}

export function parseDeliveryConfiguration(content) {
  const findings = deliveryConfigurationFindings(content);
  if (findings.length > 0) {
    throw new Error(
      ["Delivery configuration failed:", ...findings.map((item) => `- ${item}`)].join("\n"),
    );
  }
  return JSON.parse(String(content));
}

export function serializeDeliveryConfiguration(configuration) {
  const value = {
    schemaVersion: 1,
    defaultTarget: "dev",
    declaredTargets: canonicalDeclaredTargets(configuration.declaredTargets ?? []),
    detectedTargets: canonicalDetectedTargets(configuration.detectedTargets ?? []),
  };
  const content = `${JSON.stringify(value, null, 2)}\n`;
  parseDeliveryConfiguration(content);
  return content;
}

export function initialDeliveryConfiguration() {
  return serializeDeliveryConfiguration({ declaredTargets: [], detectedTargets: [] });
}

export function reconcileDetectedDeliveryTargets(configuration, detectedTargets) {
  return serializeDeliveryConfiguration({
    declaredTargets: configuration.declaredTargets,
    detectedTargets,
  });
}

export function effectiveDeliveryTargets(configuration) {
  return [
    ...new Set([
      ...configuration.declaredTargets,
      ...configuration.detectedTargets.map((entry) => entry.target),
    ]),
  ].sort(targetOrder);
}
