/** Validates maintained project documents; creation belongs to the source generator. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { futureModulesPath, projectManifestPath } from "./document-scope.mjs";
import {
  activeFutureModuleOverlapFindings,
  futureModulesDocumentFindings,
  projectManifestFindings,
} from "./project-manifest-contract.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifestPath = path.join(root, ...projectManifestPath.split("/"));
const futureModulesFile = path.join(root, ...futureModulesPath.split("/"));
for (const [file, label] of [
  [manifestPath, "Project Manifest"],
  [futureModulesFile, "Future Modules inventory"],
]) {
  if (!existsSync(file)) {
    console.error(label + " is missing: " + path.relative(root, file));
    process.exit(1);
  }
}

const current = readFileSync(manifestPath, "utf8");
const failures = [];
if (!current.startsWith("# Project Manifest\n")) {
  failures.push("docs/project.md must start with # Project Manifest");
}
failures.push(...projectManifestFindings({ content: current, root }));
const futureModulesContent = readFileSync(futureModulesFile, "utf8");
failures.push(...futureModulesDocumentFindings(futureModulesContent));
failures.push(...activeFutureModuleOverlapFindings(current, futureModulesContent));
if (failures.length > 0) {
  console.error("Project Manifest verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  "Project Manifest structure and repository projections passed; prose currency is not assessed.",
);
