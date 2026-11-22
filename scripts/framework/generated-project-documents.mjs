/** Owns generated project documents and their shared projection for reviewed upgrades. */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  initialProductConfiguration,
  initialDeliveryConfiguration,
  initialTenancyConfiguration,
  initialLocalizationConfiguration,
} from "./initial-project-configuration.mjs";
import { productConfigurationPath } from "../contracts/product-configuration.mjs";
import {
  parseDeliveryConfiguration,
  deliveryConfigurationPath,
} from "../contracts/delivery-configuration.mjs";
import { tenancyConfigurationPath } from "../contracts/tenancy-configuration.mjs";
import { localizationConfigurationPath } from "../contracts/localization-configuration.mjs";
import {
  initialProjectManifest,
  initialFutureModulesDocument,
} from "../docs/initial-project-manifest.mjs";
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
  for (const [file, content] of Object.entries(
    renderGeneratedProjectDocuments(
      sourceRoot,
      escapeMarkdownText(projectName),
      Boolean(description),
    ),
  ))
    writeRelative(targetRoot, file, content);
}

/** The escaped project label and creation-brief flag belong to the original generated project. */
export function renderGeneratedProjectDocuments(sourceRoot, projectLabel, hasCreationBrief) {
  return {
    "instructions.md": currentProjectInstructions(sourceRoot),
    "AGENTS.md": initialProjectAgents(sourceRoot),
    "README.md": `# ${projectLabel}

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
prepares frozen inputs for local builds. Do not repeat preparation when its required state is already valid.
\`node --test scripts/setup/codex-launcher.test.mjs\` checks the invocation without installation.
Launch with \`bash -p scripts/setup/start-codex.sh --yolo\` to preapprove all steps of the requested
outcome, including publication and deployment for a go-live. The startup hook confirms the current
mode. See [YOLO session approval](instructions.md#yolo-session-approval).
Restart through the launcher after runtime changes. Startup waits for live lifecycle coordinators;
dead coordinators with surviving commands require owned recovery instead of a long wait.
One canonical Codex session owns writes across all linked Git worktrees of this project.
Mise tracks project settings locally and reuses verified shared tool versions and downloads.
Cancellable verification checks drain when their caller exits; other operations retain their
completion boundary. Never remove a lock or interrupt another owner to bypass admission.

At 5% ordinary account capacity the framework pauses and saves the handover in
\`tmp/codexrig-handovers/\`. After switching accounts, name its exact path and ask to continue it as a
Goal. This accepts the file and authorizes the native Goal. A hard-limit seal requires a separate
canonical session. Preserve private runtime, history and recovery. See
[session lifecycle](instructions.md#session-start) and [capacity](instructions.md#capacity-admission-and-monitoring).

## First Prompt: Define The Project

Refine the current definition with Codex: users, workflows, boundaries and acceptance before product
implementation. Requirements remain at their owner; the manifest records implemented reality.
Preserve separate UI approval gates.

## Documentation

- [Workflow and safety](instructions.md)
- [Infrastructure lifecycle](instructions.md#infrastructure-as-code)
- [Infrastructure administration](scripts/infrastructure/README.md)
- [Current technical inventory](docs/project.md)
- [Deferred module candidates](docs/future-modules.md)
- [Native session configuration](.codex/README.md)
${hasCreationBrief ? "- [Requirements intake draft](docs/requirements.md)\n" : ""}
## Essential Commands

Use \`bash -p scripts/setup/run-project.sh <command> [arguments]\` from a host shell for the pinned,
locked and isolated environment. Mise inputs live explicitly in \`.codex/mise.toml\` and
\`.codex/mise.lock\`; host-shell discovery does not activate them after exit. pnpm uses the official
npm distribution and its integrity-bound graph in \`.codex/.mise/locks/pnpm/current/\`.
Normal startup migrates Mise lock formats 0 and 1 in staging, even when the pins stay the same.
Frozen runs require a graph-capable lock and verify its digest.

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

## Local Builds

Run \`pnpm build:local init\` and configure \`.project-state/build/pipeline.json\` with build commands
and artifact paths. \`pnpm build:local run\` builds the committed source locally using the shared host
toolchain. The default pnpm pipeline restores its frozen dependencies from the prepared shared store.
Use \`--jobs N\` to limit parallel work. \`pnpm build:local list\` shows up to three retained
releases. Completed work is collected automatically and \`pnpm build:local clean\` runs collection
on demand. Pipeline definitions, work and artifacts under \`.project-state/build/\` stay private.
Git hosting supplies source versioning and review. Workspace verification checks uncommitted source
in separate scratch. Declared build outputs for dependent checks live in
\`.project-state/build/verification-outputs/\`.

## Verification

The single \`.codex/verification.json\` contract selects commands and actual consumers. Plans show
required/reused units, prerequisites, gaps and observed/unknown costs. Development runs only necessary
checks; missing full evidence, review, resume or a new commit does not start a full suite. Independent
successes survive failure. Unknown input ownership needs a concrete mapping repair.
\`pnpm verify -- --print-plan\` checks complete-coverage admission without executing tests. Unmapped
inputs fail the command; missing results remain pending coverage.

\`pnpm verify:changed -- --check <key>\` runs or reuses one check and retains its results. Add
\`--test-file <path>\` for one independent Node file; its result counts in the complete suite.
\`--test-name-pattern\` is diagnosis only and records no complete-file evidence.
\`--test-timeout=<milliseconds>\` preserves independent Node file results and binds their execution limit.
Publication assembles complete coverage once from valid
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
commit for retry. Branch protection and local verification apply. No force push, automatic merge or deployment
is implied. A proven canonical caller may publish in-session; competing/unknown writers block it.
Verification progress shows reused results and active checks before completion.
[Delegated release](instructions.md#delegated-release) uses independent Git metadata and an accepted
\`--candidate <HEAD>:<tree>\`. For a requested go-live, verified YOLO supplies operator approval. Confirm actual target acceptance.

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
    ".codex/README.md": `# Project Session Configuration

Tracked \`config.toml\`, \`agents/*.toml\` and \`hooks.json\` own native role, permission and
lifecycle-hook configuration. \`tooling.json\` selects startup/providers; \`toolchain.json\`,
\`mise.toml\` and \`mise.lock\` pin tools; \`.mise/locks/pnpm/current/\` carries the portable pnpm
package graph. \`verification.json\` declares checks and consumers.
Exact schemas belong to validators. Configuration validation does not prove model obedience.

Use the canonical [README commands](../README.md#essential-commands). Policy/runtime changes need
full launcher restart, not chat reload. The controller binds trusted session-only hooks;
[session policy](../instructions.md#session-start) owns admission and recovery.
SessionStart reports the current [YOLO session approval](../instructions.md#yolo-session-approval).

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
    "docs/project.md": initialProjectManifest({
      displayName: projectLabel,
      hasCreationBrief,
      deliveryProjection: renderDeliveryManifestProjection({
        configuration: parseDeliveryConfiguration(initialDeliveryConfiguration()),
      }),
    }).replace("- Framework workflow authority", "- Project workflow authority"),
    "docs/future-modules.md": initialFutureModulesDocument(),
  };
}
