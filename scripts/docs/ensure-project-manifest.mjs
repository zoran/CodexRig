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
import { localizationConfigurationPath } from "../contracts/localization-configuration.mjs";
import { productConfigurationPath } from "../contracts/product-configuration.mjs";
import { tenancyConfigurationPath } from "../contracts/tenancy-configuration.mjs";
import { futureModulesPath, projectManifestPath } from "./document-scope.mjs";
import { renderDeliveryManifestProjection } from "./delivery-manifest.mjs";
import {
  activeFutureModuleOverlapFindings,
  activeModuleInventoryHeading,
  futureModulesDocumentFindings,
  initialFutureModulesDocument,
  manifestAuthorityPreamble,
  noActiveModulesStatement,
  projectManifestFindings,
} from "./project-manifest-contract.mjs";

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

const defaultManifest = `# Project Manifest

This is the always-read, concise central source of truth for product intent, scope, system shape,
and durable decisions.

${manifestAuthorityPreamble}

## Definition

No product has been defined yet.

## Users And Outcome

- Target users: pending.
- Problem and desired outcome: pending.
- Success evidence: pending.

## Scope

- In scope: pending.
- Non-goals: do not infer a runtime, provider, deployment target, data model, or trust boundary.

## System Shape

- Key domains and boundaries: pending.
- External systems and data flows: pending.
- Runtime and delivery shape: no product runtime or deployment is integrated.
- Product surface decision: pending; derive and confirm the intended user experience before choosing
  product technology or creating surface roots.
- Product languages and localization: pending; decide early whether user-facing content is single-
  or multi-locale.
- Source code, identifiers, filenames, and technical source documentation use English.

${defaultDeliveryProjection}

- Product interface roots: no web/PWA, mobile, desktop, CLI/TUI, API/service, worker, library/SDK,
  embedded, or real-time product surface is integrated.
- Tenant isolation runtime: no product tenant resolver or data plane is integrated; the initial
  invariant contract is owned by \`${tenancyConfigurationPath}\` with pending resolution.
- Product infrastructure roots: none are integrated.
- Public product identity and brand: not configured.

${activeModuleInventoryHeading}

${noActiveModulesStatement}

## Constraints And Decisions

- Keep the project neutral until requirements justify durable decisions.
- Root \`src/\` is the default Product Root. Additional Product Roots require real package or Android
  module evidence.
- No staging or production product deployment is integrated while the product definition is pending.
- White-label product configuration owner: \`${productConfigurationPath}\`; repository/package names
  are developer/build identifiers, never public product identity.
- Delivery inventory owner: \`${deliveryConfigurationPath}\`; it separates the Dev default from
  declared or detected integrated environments.
- Tenant-isolation owner: \`${tenancyConfigurationPath}\`; trusted resolution and stack-native
  enforcement must replace pending state before product implementation.
- Localization owner: \`${localizationConfigurationPath}\`; configure default, supported, and
  fallback user-facing locales before product implementation.
- Framework workflow authority lives in \`instructions.md\`, not in this factual inventory.

## Maintenance

Keep active truth only. A change that implements a module adds its active inventory entry and removes
the matching candidate from \`docs/future-modules.md\` in the same change. Keep plans, progress,
workflow rules, reviews, and history outside this manifest.
`;

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
