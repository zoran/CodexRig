/** Owns ensure project manifest behavior for the durable documentation contract boundary. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  deliveryConfigurationPath,
  initialDeliveryConfiguration,
  parseDeliveryConfiguration,
} from "../contracts/delivery-configuration.mjs";
import { isReusableFrameworkSource } from "../contracts/framework-contract.mjs";
import { futureModulesPath, projectManifestPath } from "./document-scope.mjs";
import { renderDeliveryManifestProjection } from "./delivery-manifest.mjs";
import {
  activeFutureModuleOverlapFindings,
  futureModulesDocumentFindings,
  initialFutureModulesDocument,
  projectManifestFindings,
} from "./project-manifest-contract.mjs";

import { initialProjectManifest } from "./initial-project-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifestPath = path.join(root, ...projectManifestPath.split("/"));
const futureModulesFile = path.join(root, ...futureModulesPath.split("/"));
const checkOnly = process.argv.includes("--check");
const leanSections = [
  "Definition",
  "Users And Outcome",
  "Scope",
  "System Shape",
  "Constraints And Decisions",
  "Maintenance",
];
const sourceFramework = isReusableFrameworkSource(root);
const deliveryPath = path.join(root, ...deliveryConfigurationPath.split("/"));
const defaultDeliveryProjection = renderDeliveryManifestProjection({
  configuration: sourceFramework
    ? null
    : parseDeliveryConfiguration(
        existsSync(deliveryPath)
          ? readFileSync(deliveryPath, "utf8")
          : initialDeliveryConfiguration(),
      ),
  sourceFramework,
});

const defaultManifest = initialProjectManifest({ deliveryProjection: defaultDeliveryProjection });

function hasSections(content, sections) {
  return sections.every((section) => content.includes(`## ${section}`));
}

if (!existsSync(manifestPath)) {
  if (checkOnly) {
    console.error("Project Manifest is missing: docs/project.md");
    process.exit(1);
  }
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, defaultManifest, "utf8");
  if (!existsSync(futureModulesFile)) {
    writeFileSync(futureModulesFile, initialFutureModulesDocument(), "utf8");
  }
  console.log("Created docs/project.md Project Manifest.");
  process.exit(0);
}

if (!existsSync(futureModulesFile)) {
  if (checkOnly) {
    console.error("Future Modules inventory is missing: docs/future-modules.md");
    process.exit(1);
  }
  mkdirSync(path.dirname(futureModulesFile), { recursive: true });
  writeFileSync(futureModulesFile, initialFutureModulesDocument(), "utf8");
  console.log("Created docs/future-modules.md future candidate inventory.");
}

const current = readFileSync(manifestPath, "utf8");
const failures = [];
if (!current.startsWith("# Project Manifest\n")) {
  failures.push("docs/project.md must start with # Project Manifest");
}
if (!hasSections(current, leanSections)) {
  failures.push("docs/project.md must use the current concise manifest sections");
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
console.log("Project Manifest is current.");
