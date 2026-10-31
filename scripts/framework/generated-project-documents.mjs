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

/** Projects canonical shared policies into new and updated independent projects. */
export function currentProjectInstructions(sourceRoot) {
  const source = readFileSync(path.join(sourceRoot, "instructions.md"), "utf8");
  const startMarker = "<!-- codexrig:portable-policy:start -->";
  const endMarker = "<!-- codexrig:portable-policy:end -->";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  const body = source.slice(start + startMarker.length, end).trim();
  if (
    source.split(startMarker).length !== 2 ||
    source.split(endMarker).length !== 2 ||
    start >= end ||
    !body
  )
    throw new Error("Portable policy needs one nonempty block with unique ordered markers.");
  return `# Project Instructions\n\n${body}\n`;
}

/** Identity-independent safe-entry projection, shared by generation and reviewed updates. */
export function initialProjectAgents(sourceRoot) {
  const source = readFileSync(path.join(sourceRoot, "AGENTS.md"), "utf8");
  const startMarker = "<!-- codexrig:portable-agent-entry:start -->";
  const endMarker = "<!-- codexrig:portable-agent-entry:end -->";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  const body = source.slice(start + startMarker.length, end).trim();
  if (
    source.split(startMarker).length !== 2 ||
    source.split(endMarker).length !== 2 ||
    start >= end ||
    !body
  )
    throw new Error("Portable agent entry needs one nonempty block with unique ordered markers.");
  return `# AGENTS.md

This is the safe-entry guide for this project.

${body}

Project licensing decisions belong to the project owner.
`;
}

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
  writeRelative(targetRoot, "instructions.md", currentProjectInstructions(sourceRoot));
  writeRelative(targetRoot, "AGENTS.md", initialProjectAgents(sourceRoot));
  writeRelative(
    targetRoot,
    "README.md",
    `# ${escapeMarkdownText(projectName)}

This repository owns its product and a selected set of inspectable development tools.

## Setup And Start

Provide Node.js, Git, Bash, ripgrep, ShellCheck and the system archive tool. Linux process-cancellation
tests also use Python 3 with \`ctypes\`. For initial preparation:

\`\`\`bash
env -u NODE_OPTIONS -u NODE_PATH node scripts/deps/maintain-toolchain.mjs
bash -p scripts/setup/run-project.sh pnpm setup
bash -p scripts/setup/start-codex.sh
\`\`\`

The launcher uses \`--startup\` maintenance to discover compatible releases; \`--locked\` separately
prepares frozen inputs for CI. Do not repeat preparation when its required state is already valid.
\`node --test scripts/setup/codex-launcher.test.mjs\` checks the invocation without installation.
Only an explicitly authorized Dev session may add \`--yolo\`; prompts follow native session selection.
Restart through the launcher after runtime changes. Waiting startup reports live lifecycle owners;
never remove a lock or interrupt another owner to bypass admission.

After critical handover exit with \`/quit\`, relaunch from this root's terminal and accept the announced
prompt before reading it. \`/new\` and \`/resume\` do not replace the controller. Preserve private
runtime/history/recovery; unsupported state needs the current owner's quiescent recovery. See
[session lifecycle](instructions.md#session-start) and [capacity](instructions.md#capacity-admission-and-monitoring).

## First Prompt: Define The Project

Refine the current definition with Codex: users, workflows, boundaries and acceptance before product
implementation. Requirements remain at their owner; the manifest records implemented reality.
Preserve separate UI approval gates.

## Documentation

- [Workflow and safety](instructions.md)
- [Infrastructure lifecycle](instructions.md#infrastructure-as-code)
- [Current technical inventory](docs/project.md)
- [Deferred module candidates](docs/future-modules.md)
- [Native session configuration](.codex/README.md)
${description ? "- [Requirements intake draft](docs/requirements.md)\n" : ""}
## Essential Commands

Use \`bash -p scripts/setup/run-project.sh <command> [arguments]\` from a host shell for the pinned,
locked and isolated environment. Mise inputs live explicitly in \`.codex/mise.toml\` and
\`.codex/mise.lock\`; host-shell discovery does not activate them after exit.

| Purpose | Command |
| --- | --- |
| Ownership and recovery | \`pnpm worktree:status -- --json\` |
| Navigate owners/policy | \`pnpm context:map\` |
| Read a bounded section | \`pnpm context:read <document> --section "<heading>"\` |
| Check instruction structure | \`pnpm context:check\` |
| Diagnose local tools | \`pnpm tooling:doctor\` |
| Preview necessary verification | \`pnpm verify:changed -- --print-plan\` |
| Run affected checks | \`pnpm verify:changed\` |
| Inspect storage | \`pnpm repo:housekeeping -- --storage-only\` |

## Verification

The single \`.codex/verification.json\` contract selects commands and actual consumers. Plans show
required/reused units, prerequisites, gaps and observed/unknown costs. Development runs only necessary
checks; missing full evidence, review, resume or a new commit does not start a full suite. Independent
successes survive failure. Unknown input ownership needs a concrete mapping repair.

\`pnpm verify:changed -- --check <key>\` reproduces one unresolved check without recording acceptance;
Node cases may use \`--test-name-pattern\`. Publication assembles complete coverage once from valid
and fresh units. External observations need declared freshness; build evidence does not prove that
required output files still exist. Consumers must validate actual artifact/state prerequisites.
See [verification policy](instructions.md#verification-selection-and-runtime).

## Publish Source Changes

After reviewing all non-ignored changes and authorizing commit/push:

\`\`\`bash
bash -p scripts/setup/run-project.sh pnpm project:publish --message "<commit message>"
\`\`\`

The publisher prepares and verifies the exact state, commits all non-ignored changes on the current
branch and pushes to its configured upstream. Failed gates stop; rejected push preserves the local
commit for retry. Protections and independent CI remain. No force push, automatic merge or deployment
is implied. A proven canonical caller may publish in-session; competing/unknown writers block it.
[Delegated release](instructions.md#delegated-release) uses independent Git metadata and an accepted
\`--candidate <HEAD>:<tree>\`. Deployment needs its own authority and observed target acceptance.

## Tool Storage And Accounts

Pins/locks stay in source; tools/package graphs use \`~/.local/share/project-tools/\`, downloads use
\`~/.cache/project-tools/\`. \`PROJECT_TOOL_STORAGE_HOME\` relocates only tool storage. Accounts remain
under private \`.auth/project-tools/\`. Housekeeping collectors preserve referenced/live tools and
uncertain recovery; add \`--apply\` only for the inspected owned cleanup. Never delete runtime or
unmarked product state manually.

Prepare required SDKs/browsers through their owner once; verification does not install them. Public
Mise defaults belong in \`.auth/project-tools/config/mise/config.toml\`; profiles/cookies stay private.
Git HTTPS credentials are stored owner-only by repository path. For configured GitHub/GitLab hosts,
the shared adapter may use an existing host Git helper or CLI login when project credentials are
missing; it never logs in automatically or mutates host accounts. Other providers, SSH and sibling
accounts remain isolated. Missing public author metadata may use validated global name/email only.
See [account isolation](instructions.md#repository-local-tool-and-account-isolation).

Provider-policy preview is read-only. Explicit apply reads \`.auth/git-platform.json\` with
\`schemaVersion\` 1, \`provider\`, \`hostname\`, \`repository\` and \`token\`; no ambient token fallback.
Keep the file/parent private and reconcile uncertain remote mutations before retrying.

## Project Licensing

The project owner chooses licensing before distribution; third-party dependencies retain their terms.
`,
  );
  writeRelative(
    targetRoot,
    ".codex/README.md",
    `# Project Session Configuration

Tracked \`config.toml\`, \`agents/*.toml\` and \`hooks.json\` own native role, permission and
lifecycle-hook configuration. \`tooling.json\` selects startup/providers; \`toolchain.json\`,
\`mise.toml\` and \`mise.lock\` pin tools; \`verification.json\` declares checks and consumers.
Exact schemas belong to validators. Configuration validation does not prove model obedience.

Use the canonical [README commands](../README.md#essential-commands). Policy/runtime changes need
full launcher restart, not chat reload. The controller binds trusted session-only hooks;
[session policy](../instructions.md#session-start) owns admission and recovery.

This project owns its ignored repository-root CODEX_HOME: authentication, transcripts, memory and
plugins. Framework coordination/evidence live in \`.codex/runtime/\`; external accounts use private
\`.auth/project-tools/\`. Generation transfers no native runtime or accounts. Reusable public tool,
package and browser payloads may use the admitted shared store; credentials and device state stay
private. Active runtime and pending recovery are not disposable scratch.

Follow the canonical policies for [account isolation](../instructions.md#repository-local-tool-and-account-isolation),
[agent admission and permissions](../instructions.md#subagent-orchestration-and-integration-authority),
[capacity and terminal drain](../instructions.md#capacity-admission-and-monitoring),
[continuation](../instructions.md#compact-project-memory),
[verification reuse](../instructions.md#verification-selection-and-runtime), and
[isolated release](../instructions.md#delegated-release).
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
