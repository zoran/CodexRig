/** Owns package-field three-way merging for the framework child-upgrade boundary. */
import { lstatSync } from "node:fs";
import {
  readRegularFrameworkFile,
  resolveFrameworkPath,
  serializeCanonicalJson,
  sha256,
} from "../contracts/framework-contract.mjs";

export function frameworkUpgradeValuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function packageUpdatePlan({
  sourceManaged,
  targetRoot,
  receipt,
  preservePackageManager = false,
}) {
  const targetContent = readRegularFrameworkFile(targetRoot, "package.json");
  let targetPackage;
  try {
    targetPackage = JSON.parse(targetContent);
  } catch {
    throw new Error("Target package.json contains invalid JSON.");
  }
  const oldManaged = receipt.managedPackage;
  const conflicts = [];
  const desired = structuredClone(targetPackage);
  desired.scripts ??= {};
  desired.devDependencies ??= {};

  function mergeScalar(key, current, oldValue, newValue, assign) {
    if (frameworkUpgradeValuesEqual(current, newValue)) return;
    if (frameworkUpgradeValuesEqual(current, oldValue)) {
      if (!frameworkUpgradeValuesEqual(current, newValue)) assign(newValue);
      return;
    }
    if (!frameworkUpgradeValuesEqual(oldValue, newValue)) {
      conflicts.push(`package.json ${key}`);
    }
  }

  mergeScalar(
    "license",
    targetPackage.license,
    oldManaged.license,
    sourceManaged.license,
    (value) => {
      desired.license = value;
    },
  );

  if (!preservePackageManager)
    mergeScalar(
      "packageManager",
      targetPackage.packageManager,
      oldManaged.packageManager,
      sourceManaged.packageManager,
      (value) => {
        desired.packageManager = value;
      },
    );

  for (const section of ["scripts", "devDependencies"]) {
    const names = new Set([
      ...Object.keys(oldManaged[section] ?? {}),
      ...Object.keys(sourceManaged[section] ?? {}),
    ]);
    for (const name of [...names].sort()) {
      const current = targetPackage[section]?.[name];
      const oldValue = oldManaged[section]?.[name];
      const newValue = sourceManaged[section]?.[name];
      mergeScalar(`${section}.${name}`, current, oldValue, newValue, (value) => {
        if (value === undefined) delete desired[section][name];
        else desired[section][name] = value;
      });
    }
  }
  if (conflicts.length > 0) return { conflicts, operation: null };
  const desiredContent = serializeCanonicalJson(desired);
  const packageMode = lstatSync(resolveFrameworkPath(targetRoot, "package.json")).mode & 0o777;
  return {
    conflicts,
    operation:
      desiredContent === targetContent
        ? null
        : {
            action: "write",
            content: desiredContent,
            expected: sha256(targetContent),
            expectedMode: packageMode,
            mode: packageMode,
            path: "package.json",
          },
  };
}
