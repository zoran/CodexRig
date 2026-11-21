/** Owns the public upgrade preview and the shape of ephemeral child reconciliation decisions. */
const hash = /^[a-f0-9]{64}$/u;

function hasFields(value, fields) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}

export function isUpgradeDecision(entry) {
  const fields = [
    "path",
    "action",
    "reason",
    "currentHash",
    "currentMode",
    "desiredHash",
    "desiredMode",
  ];
  if (entry?.action === "replace") fields.push("content", "mode");
  const hasBase = entry && Object.hasOwn(entry, "baseHash");
  if (hasBase) fields.push("baseHash", "baseMode");
  return (
    hasFields(entry, fields) &&
    typeof entry.path === "string" &&
    ["source", "keep", "replace", "remove"].includes(entry.action) &&
    typeof entry.reason === "string" &&
    Boolean(entry.reason.trim()) &&
    [entry.currentHash, entry.desiredHash, ...(hasBase ? [entry.baseHash] : [])].every(
      (v) => v === null || (typeof v === "string" && hash.test(v)),
    ) &&
    [entry.currentMode, entry.desiredMode, ...(hasBase ? [entry.baseMode] : [])].every(
      (v) => v === null || validMode(v),
    ) &&
    (entry.action !== "replace" || (typeof entry.content === "string" && validMode(entry.mode)))
  );
}

function validMode(mode) {
  return Number.isInteger(mode) && mode >= 0 && mode <= 0o777;
}

const reviewFields = ["differences", "documentBindings", "deviations"];

export function frameworkUpgradePreview(plan) {
  return {
    digest: plan.digest,
    conflicts: plan.conflicts,
    ...Object.fromEntries(
      reviewFields.filter((key) => plan[key] !== undefined).map((key) => [key, plan[key]]),
    ),
    ...(plan.conflictDetails ? { conflictDetails: plan.conflictDetails } : {}),
    operations: plan.operations.map(({ path, action }) => ({ path, action })),
  };
}

/** Only whole documents produced or consumed by the updater qualify as disposable review output. */
export function isChildMaintenanceDocument(content) {
  if (
    !/^\s*[\[{]/u.test(
      typeof content === "string" ? content : content.subarray(0, 256).toString("utf8"),
    )
  )
    return false;
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    return false;
  }
  if (Array.isArray(value)) return value.length > 0 && value.every(isUpgradeDecision);
  const fields = ["digest", "conflicts", "operations"];
  if (value && Object.hasOwn(value, "differences")) fields.push(...reviewFields);
  if (value && Object.hasOwn(value, "conflictDetails")) {
    if (
      !Array.isArray(value.conflicts) ||
      !value.conflictDetails ||
      typeof value.conflictDetails !== "object" ||
      Array.isArray(value.conflictDetails) ||
      !Object.entries(value.conflictDetails).every(
        ([file, keys]) =>
          value.conflicts.includes(file) &&
          Array.isArray(keys) &&
          keys.every((key) => typeof key === "string"),
      )
    )
      return false;
    fields.push("conflictDetails");
  }
  return (
    hasFields(value, fields) &&
    typeof value.digest === "string" &&
    hash.test(value.digest) &&
    fields
      .filter((key) => !["digest", "conflictDetails"].includes(key))
      .every((key) => Array.isArray(value[key])) &&
    value.conflicts.every((file) => typeof file === "string") &&
    value.operations.every(
      (op) =>
        hasFields(op, ["path", "action"]) &&
        typeof op.path === "string" &&
        ["write", "delete"].includes(op.action),
    )
  );
}
