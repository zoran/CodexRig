/** Owns the single initial technical inventory template used by initialization and clean generation. */
import path from "node:path";
import { deliveryConfigurationPath } from "../contracts/delivery-configuration.mjs";
import { localizationConfigurationPath } from "../contracts/localization-configuration.mjs";
import { productConfigurationPath } from "../contracts/product-configuration.mjs";
import { tenancyConfigurationPath } from "../contracts/tenancy-configuration.mjs";
import {
  activeModuleInventoryHeading,
  manifestAuthorityPreamble,
  noActiveModulesStatement,
} from "./project-manifest-contract.mjs";
import { initialRequirementsPath } from "./project-document-policy.mjs";

/** displayName is an escaped Markdown label; a brief links its one generated requirements owner. */
export function initialProjectManifest({
  displayName = "",
  hasCreationBrief = false,
  deliveryProjection,
}) {
  return `# Project Manifest

This is the always-read technical current-state index. Keep a short definition and discovery links
here; detailed requirements and intended architecture stay at their established project-owned source.

${manifestAuthorityPreamble}

## Definition

${displayName ? `Project name: ${displayName}\n\n` : ""}Product definition: pending${hasCreationBrief ? " intake validation of the supplied creation brief" : ""}.
${hasCreationBrief ? `\n- Requirements owner: [Product requirements](${path.posix.basename(initialRequirementsPath)}).\n` : ""}

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

${deliveryProjection}

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

Keep current inventory facts and honest evidence limits only. Update the established requirements
or design owner during intake; do not copy detailed future behavior into this inventory. A change that implements a module adds its active inventory entry and removes
the matching candidate from \`docs/future-modules.md\` in the same change. Keep plans, progress,
workflow rules, reviews, and history outside this manifest.
`;
}
