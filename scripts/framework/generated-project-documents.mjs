/** Owns initial product documents; writes only a new generation, never maintained project content. */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  initialProductConfiguration,
  productConfigurationPath,
} from "../contracts/product-configuration.mjs";
import {
  initialDeliveryConfiguration,
  parseDeliveryConfiguration,
  deliveryConfigurationPath,
} from "../contracts/delivery-configuration.mjs";
import {
  initialTenancyConfiguration,
  tenancyConfigurationPath,
} from "../contracts/tenancy-configuration.mjs";
import {
  initialLocalizationConfiguration,
  localizationConfigurationPath,
} from "../contracts/localization-configuration.mjs";
import { initialProjectManifest } from "../docs/initial-project-manifest.mjs";
import { initialFutureModulesDocument } from "../docs/project-manifest-contract.mjs";
import { initialRequirementsPath } from "../docs/project-document-policy.mjs";
import { renderDeliveryManifestProjection } from "../docs/delivery-manifest.mjs";
import {
  escapeMarkdownText,
  initialRequirementsDocument,
  writeRelative,
} from "./generated-document-helpers.mjs";

export function writeIdentityDocs(sourceRoot, targetRoot, projectName, description) {
  const delivery = initialDeliveryConfiguration();
  for (const [file, content] of [
    [productConfigurationPath, initialProductConfiguration(projectName)],
    [deliveryConfigurationPath, delivery],
    [tenancyConfigurationPath, initialTenancyConfiguration()],
    [localizationConfigurationPath, initialLocalizationConfiguration()],
  ])
    writeRelative(targetRoot, file, content);
  if (description)
    writeRelative(targetRoot, initialRequirementsPath, initialRequirementsDocument(description));
  writeRelative(
    targetRoot,
    "instructions.md",
    readFileSync(
      path.join(sourceRoot, "scripts/framework/templates/project-instructions.md"),
      "utf8",
    ),
  );
  writeRelative(
    targetRoot,
    "AGENTS.md",
    `# AGENTS.md

This is the safe-entry guide for ${escapeMarkdownText(projectName)}. [Project Instructions](instructions.md)
own this repository's workflow. Work only on its product outcome and accepted approvals.
Native work-state metadata grants no new task or implementation authority.

## Start And Reconstruct

Start here with \`bash scripts/setup/start-codex.sh\`. Before intake or writes, read README,
instructions, the current manifest and its requirements/design links. In the persistent main thread,
read optional bounded project context and run \`pnpm worktree:status -- --json\`; inspect Git,
upstream, untracked changes, every same-clone worktree/session and exact recovery metadata. Preserve
ambiguous writers and broken worktree directories. A side conversation remains independent.

## Product Authority

A pending definition requires the focused requirements intake. A brief does not authorize code.
Honor any static-UI acceptance gate before application implementation. README owns setup/use and
links, the manifest owns current technical inventory, the specification owns requirements/acceptance,
a UI reference is separate, and project context owns only this project's current bounded task.
Keep the task scope bounded to this repository and the authorized outcome.

## Delivery And Safety

Plan and repair at the actual owner, keep one current contract and one writer per surface, preserve
user changes, and use relevant skills. After a slice, run focused evidence, system-coherence review,
a fresh audit and Worktree Settlement. Apply the Long-Session Course Checks in instructions.md.
Stable tools and product checks are declared in \`.codex/verification.json\`; unknown paths must not
omit real product tests. Tool failures are bounded findings, not a new maintenance campaign.

Portable startup requests on-request approval and network-disabled workspace-write. Explicit Dev
\`--yolo\` changes runtime permissions only within existing authority. No unapproved staging/prod,
commit or push. Admit at most four disjoint subagents with exact GPT Astra/ultra parity, effective
permission checks, provenance and a completion reserve. At critical capacity drain owned work and
seal with \`pnpm handover:create -- --critical\` as the final action, then stop completely.

Keep private state inside this root's ignored CODEX_HOME. Never delete active runtime or a worktree
directory manually. Project licensing decisions belong to the project owner.
`,
  );
  writeRelative(
    targetRoot,
    "README.md",
    `# ${escapeMarkdownText(projectName)}

This repository owns its product and a bounded set of inspectable development tools.

## Setup And Start

\`\`\`bash
mise install --locked
mise exec --locked -- node scripts/deps/install-compatible.mjs
mise exec --locked -- pnpm setup
bash scripts/setup/start-codex.sh
\`\`\`

Use \`--yolo\` only for an explicitly authorized Dev session; use \`--no-alt-screen\` when needed.
Enter prompts after native session selection. Restart through the launcher after runtime-tool changes.

## First Prompt: Define The Project

Read the current definition and any linked specification with Codex. Refine and confirm users,
workflows, boundaries and acceptance before implementation. Preserve separate UI approval gates.

## Documentation

- [Workflow and safety](instructions.md)
- [Current technical inventory](docs/project.md)
- [Deferred module candidates](docs/future-modules.md)
- [Native session configuration](.codex/README.md)
${description ? "- [Requirements intake draft](docs/requirements.md)\n" : ""}
## Project Commands

Use \`pnpm tooling:doctor\` for local tool diagnosis, \`pnpm worktree:status -- --json\` for session
inventory, \`pnpm verify:changed -- --print-plan\` for selected evidence and \`pnpm verify\` for final
verification. \`pnpm repo:housekeeping -- --apply\` reconciles local repository facts. These commands
require their own explicit publication and deployment authority.

## Project Licensing

No public project license is selected. The project owner chooses the terms before distribution;
third-party dependencies retain their applicable licenses.
`,
  );
  writeRelative(
    targetRoot,
    ".codex/README.md",
    `# Project Session Configuration

This directory owns inspectable native Codex policy and local tooling configuration.
\`config.toml\` and \`agents/\` select the exact GPT Astra/ultra policy and requested permissions.
\`tooling.json\` owns startup and provider settings; \`toolchain.json\` owns reviewed stable pins and
archive integrity; \`verification.json\` declares this project's checks.

## Start And Isolation

Run \`bash scripts/setup/start-codex.sh\` from this root. Private native memories, transcripts and
credentials belong only in this root's ignored CODEX_HOME; leases and recovery stay in
\`.codex/runtime/\`. Generation transfers none of them. The controller proves exactly two trusted
session-only hooks before binding a writer. A native side conversation neither reads work context
nor renews the persistent session's startup proof. See [Project Instructions](../instructions.md).

## Recovery And Authority

Accept a reported handover before reading it. A valid active work marker can request continuation
only of the authorized project task. Invalid state reports a diagnostic without inventing work.
Explicit pauses and implementation approval gates remain authoritative. Preserve active runtime;
exit and restart after changing runtime tools.
`,
  );
  writeRelative(
    targetRoot,
    "docs/project.md",
    initialProjectManifest({
      displayName: escapeMarkdownText(projectName),
      hasCreationBrief: Boolean(description),
      deliveryProjection: renderDeliveryManifestProjection({
        configuration: parseDeliveryConfiguration(delivery),
      }),
    }).replace("- Framework workflow authority", "- Project workflow authority"),
  );
  writeRelative(targetRoot, "docs/future-modules.md", initialFutureModulesDocument());
}
