/** Owns source-only release identity; generated installations have no framework contract or receipt. */
import { existsSync } from "node:fs";
import {
  toolingRoot,
  parseJsonFile,
  resolveRepositoryPath,
} from "../filesystem/repository-files.mjs";
import { readToolchainConfiguration } from "./toolchain-configuration.mjs";
import { validateCompatibilityMatrix } from "./compatibility-contract.mjs";
import { parseSemver } from "./semver-contract.mjs";
export { compareSemver, parseSemver, versionSatisfiesSimpleRange } from "./semver-contract.mjs";
export { validateCompatibilityMatrix };
export const frameworkContractPath = ".codexrig/framework.json";
export const compatibilityMatrixPath = ".codexrig/compatibility.json";
export const supportedContractSchema = 3;

export function validateFrameworkContract(value) {
  if (
    !value ||
    value.schemaVersion !== supportedContractSchema ||
    Object.keys(value).sort().join(",") !==
      "compatibilityFile,frameworkId,frameworkVersion,projectToolsFile,schemaVersion" ||
    value.frameworkId !== "codexrig" ||
    value.compatibilityFile !== compatibilityMatrixPath ||
    value.projectToolsFile !== ".codexrig/project-tools.json"
  )
    throw new Error(
      "Unsupported source framework contract; only the current release schema is accepted.",
    );
  parseSemver(value.frameworkVersion, "frameworkVersion");
  return value;
}
export function readFrameworkContract(root = toolingRoot) {
  return validateFrameworkContract(
    parseJsonFile(root, frameworkContractPath, "Source framework contract"),
  );
}
export function readCompatibilityMatrix(
  root = toolingRoot,
  contract = readFrameworkContract(root),
) {
  const experiments = parseJsonFile(
    root,
    contract.compatibilityFile,
    "Source compatibility experiments",
  );
  return validateCompatibilityMatrix({ ...readToolchainConfiguration(root), ...experiments });
}
export function isReusableFrameworkSource(root = toolingRoot) {
  return (
    existsSync(
      resolveRepositoryPath(root, ".agents/skills/create-project-from-framework/SKILL.md"),
    ) && existsSync(resolveRepositoryPath(root, ".codexrig/project-tools.json"))
  );
}
