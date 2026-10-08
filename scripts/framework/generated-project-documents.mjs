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
import { documentContextSections } from "../docs/document-context.mjs";
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
  const sections = documentContextSections("instructions.md", source);
  let template = readFileSync(
    path.join(sourceRoot, "scripts/framework/templates/project-instructions.md"),
    "utf8",
  );
  for (const [heading, marker] of [
    ["Interpreting Examples And Scope", "<!-- current-examples-and-scope-policy -->"],
    [
      "Repository-Local Tool And Account Isolation",
      "<!-- current-tool-account-isolation-policy -->",
    ],
    ["Repository Efficiency And Effectiveness", "<!-- current-repository-efficiency-policy -->"],
    ["Maintenance Scope And Verification", "<!-- current-maintenance-scope-policy -->"],
    ["Infrastructure As Code", "<!-- current-infrastructure-as-code-policy -->"],
    ["Capacity Admission And Monitoring", "<!-- current-capacity-admission-policy -->"],
  ]) {
    const matches = sections.filter((section) => section.heading === heading);
    if (matches.length !== 1 || template.split(marker).length !== 2)
      throw new Error(`Shared policy ${heading} needs one canonical owner and one projection.`);
    const section = matches[0];
    const body = source.split(/\r?\n/u).slice(section.start, section.end).join("\n").trim();
    template = template.replace(marker, body);
  }
  return template;
}

/** Current safe-entry projection, shared by generation and explicitly reviewed updates. */
export function initialProjectAgents(projectName) {
  return `# AGENTS.md

This is the safe-entry guide for ${escapeMarkdownText(projectName)}. [Project Instructions](instructions.md)
own this repository's workflow. Work only on its product outcome and accepted approvals.
Native work-state metadata grants no new task or implementation authority.

## Start And Reconstruct

Start here with \`bash scripts/setup/start-codex.sh\`. Before intake or writes run
\`pnpm context:map\`; read relevant policy, manifest and requirements/design sections with
\`pnpm context:read\`. Use README for needed commands; never recursively dump linked documents.
When resuming authorized work read bounded project context. Always run
\`pnpm worktree:status -- --json\`; inspect Git,
upstream, untracked changes, every same-clone worktree/session and exact recovery metadata. Preserve
ambiguous writers and broken worktree directories. A side conversation remains independent.

## Product Authority

Treat examples as non-exhaustive; follow
[Interpreting Examples And Scope](instructions.md#interpreting-examples-and-scope) across the
authorized class and its future additions.
All tools follow [repository-local account and tool state](instructions.md#repository-local-tool-and-account-isolation);
new tools must satisfy the same isolation boundary before authenticated use.
Build and maintain infrastructure as code with scenario-appropriate Ansible, Terraform or Pulumi;
follow [Infrastructure As Code](instructions.md#infrastructure-as-code) for tool ownership, real
repository structures, state/secrets and verification before infrastructure work.

A pending definition requires the focused requirements intake. A brief does not authorize code.
Honor any static-UI acceptance gate before application implementation. README owns setup/use and
links, the manifest owns current technical inventory, the specification owns requirements/acceptance,
a UI reference is separate, and project context owns only this project's current bounded task.
Keep the task scope bounded to this repository and the authorized outcome.
Apply [Maintenance Scope And Verification](instructions.md#maintenance-scope-and-verification)
before startup, dependency maintenance, verification and cleanup; these commands cannot expand the
task into product work.

## Delivery And Safety

Automatically follow [Planning](instructions.md#planning-goals-slices-review-loops-and-audits)
before new features or extensive, complex, or materially risky work: review the plan to no relevant
findings, then audit it afresh before implementation. Audit findings reopen the affected loop. Use
goals where useful, native Goals only with explicit request or delegated need-based authority.
Repair at the actual owner, keep one current contract and one writer per surface, preserve user
changes, and use relevant skills. After a slice, run focused evidence, system-coherence review to no
relevant findings, a fresh audit and Worktree Settlement. Every extra iteration needs an acceptance
benefit or material risk. Every audit follows
[Repository Efficiency And Effectiveness](instructions.md#repository-efficiency-and-effectiveness).
Run \`pnpm context:check\` for instruction/context changes and preserve full requirements through
bounded reads. Apply the Long-Session Course Checks in instructions.md.
Stable tools and product checks are declared in \`.codex/verification.json\`; select evidence under
the maintenance scope boundary without weakening publication gates. Tool failures are bounded
findings, not a new maintenance campaign.

Portable startup requests on-request approval and network-disabled workspace-write. Explicit Dev
\`--yolo\` changes runtime permissions only within existing authority. No unapproved staging/prod,
commit or push. Explicitly authorized publication and deployment may run in the owning session;
use the README command and retain environment gates. Default to parallel development with four concurrent subagents in addition to the
primary when substantial disjoint work, permissions, confirmed capacity and integration permit.
Keep at most four live; use fewer or work serially when necessary, briefly state why, and never
invent work to fill slots. Name runnable assignments in the plan, start admitted work concurrently,
and reassess after discovery, material results, handoffs and slice boundaries. Require exact
GPT Astra/max parity, effective permission checks,
provenance and a completion reserve. At critical capacity drain owned work and
seal with \`pnpm handover:create -- --critical\` as the final action, then stop completely.

Keep private state inside this root's ignored CODEX_HOME. Never delete active runtime or a worktree
directory manually. Project licensing decisions belong to the project owner.
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
  writeRelative(targetRoot, "AGENTS.md", initialProjectAgents(projectName));
  writeRelative(
    targetRoot,
    "README.md",
    `# ${escapeMarkdownText(projectName)}

This repository owns its product and a bounded set of inspectable development tools.

## Setup And Start

\`\`\`bash
node scripts/deps/maintain-toolchain.mjs
bash scripts/setup/run-project.sh pnpm setup
bash scripts/setup/start-codex.sh
\`\`\`

Use \`--yolo\` only for an explicitly authorized Dev session; use \`--no-alt-screen\` when needed.
Enter prompts after native session selection. Restart through the launcher after runtime-tool changes.

If a verification or another lifecycle operation is still running, startup waits up to ten minutes
and reports its operation, coordinator PID and start time. Ctrl-C cancels only the waiting startup.
After release, startup checks session ownership again before maintenance. Uncertain ownership still
blocks startup; never remove a live lock or terminate an unrelated process to bypass it.

If startup reports an invalid or unsupported private session lease, exit all sessions using this
project. Its maintenance/update owner must reconstruct the installed runtime and restore the current
contract through a reviewed, quiescent regeneration. Preserve product changes, accounts and native
history. Do not delete \`.codex/runtime\` manually or run source-framework reset commands in this
independent project. Retry the canonical launcher only after recovery has been validated.

After a critical handover, exit Codex completely with \`/quit\`, then run
\`bash scripts/setup/start-codex.sh\` from this root in your terminal. Accept the preserved handover
when the new session announces it. \`/new\` and \`/resume\` inside the running CLI retain the old
launcher and cannot replace this restart. Keep the handover and runtime files intact.

## First Prompt: Define The Project

Read the current definition and any linked specification with Codex. Refine and confirm users,
workflows, boundaries and acceptance before implementation. Preserve separate UI approval gates.

## Documentation

- [Workflow and safety](instructions.md)
- [Infrastructure as Code: tools, layout and lifecycle](instructions.md#infrastructure-as-code)
- [Current technical inventory](docs/project.md)
- [Deferred module candidates](docs/future-modules.md)
- [Native session configuration](.codex/README.md)
${description ? "- [Requirements intake draft](docs/requirements.md)\n" : ""}
## Project Commands

Use \`pnpm context:map\` for repository navigation, \`pnpm context:read -- <document> --outline\`
for bounded reading and \`pnpm context:check\` for instruction growth.
Use \`bash scripts/setup/run-project.sh <command> [arguments]\` from a host shell to execute
through \`mise exec --locked\` with repository-local
home and mutable state. Pins and artifact locks live in \`.codex/mise.toml\` and \`.codex/mise.lock\`,
loaded explicitly so the outer host shell does not activate project tools after Codex exits.
The launcher selects native embedded mode (\`--no-daemon\`) for its session-only hooks and settings.
Follow the tool/account isolation policy before any authenticated use.
Platform-policy apply reads the private \`.auth/git-platform.json\` file with exact fields
\`schemaVersion\` (1), \`provider\`, \`hostname\`, \`repository\` (remote slug), and \`token\`;
it never inherits a host token. Keep this file and its parent private and outside source control.
Use \`pnpm tooling:doctor\` for local tool diagnosis, \`pnpm worktree:status -- --json\` for session
inventory, \`pnpm verify:changed -- --print-plan\` for selected evidence and \`pnpm verify\` for final
verification. \`pnpm repo:housekeeping -- --apply\` reconciles local repository facts. Apply
[Maintenance Scope And Verification](instructions.md#maintenance-scope-and-verification) before
these commands; inspect their side effects and selected checks against the accepted task.
Publication and deployment require their own explicit authority.

## Publish Source Changes

Review all non-ignored changes and authorize publication. Run from the owning Codex session or
from the terminal:

\`\`\`bash
bash scripts/setup/run-project.sh pnpm project:publish --message "<commit message>"
\`\`\`

This explicitly authorizes committing all non-ignored changes on the current branch and pushing
that exact verified commit to its configured upstream. The eight-phase display shows the current
task and elapsed time; add \`--verbose\` for sanitized check output. Failed checks stop publication;
a rejected push preserves the local commit for retry without an empty commit. No branch switch,
automatic merge, force push, native-session reset or direct deployment is performed. Existing Git
hooks, branch protections and any CI/deployment approvals still apply. A missing upstream must be
configured explicitly before publication. The calling canonical session is admitted through exact
Linux process ancestry; other or unverified active writers block publication. Drain owned agents
and background writers first. Session exit is unnecessary when this proof is available. Authorized
deployments can follow directly using project commands and existing project credentials; retain
the project's environment approvals. If process ancestry cannot be proven, publish from the terminal
after sessions exit.

Verification reuses successful evidence for unchanged source and the same effective toolchain.
Use \`pnpm verify:changed -- --print-plan\` to inspect the selected checks and admission reason.
Captured checks normalize terminal colors and presentation; changing terminals alone does not rerun
the product suite. Changed tools, verification controls or uncovered source require new evidence.
Use the project wrapper above to keep the selected toolchain consistent.

Persistent public tool settings belong in the project-private Mise configuration at
\`.auth/project-tools/config/mise/config.toml\`. The normal project wrapper loads them before
verification and publication. Prepare required SDKs or test runtimes once through their product
setup owner; use defaults that preserve explicit tool selections. Verification never installs them.

Commit author names and email addresses use project Git configuration first. When a value is
missing, publication reads only \`user.name\` and \`user.email\` from the operating-system user's
standard global Git configuration, without includes. It validates the resulting author and
committer before repository verification and rechecks them before staging. Global hooks, signing
settings and credentials are not imported; existing project signing remains in effect. No Git
configuration is changed. If neither configuration supplies a complete identity, the error shows
project-local \`git config\` commands.

Git remembers successful HTTPS sign-in in \`.auth/project-tools/home/.git-credentials\`, scoped to
the protocol, host and repository path. Enter a personal access token at Git's password prompt on
the first successful sign-in or after expiration/revocation. If no project credential is available
for a GitHub or GitLab host configured in \`.codex/tooling.json\`, the shared adapter tries global
Git helpers and then the matching existing CLI login (\`gh\` or \`glab\`), including self-hosted
instances. Native helpers resolve their user-home configuration and keyring. It never initiates login or sends global
credential store/erase requests. Git can cache an approved fallback account in the project store.
After a confirmed authentication rejection, publication tries remaining global credentials in up
to two automatic retries without another prompt, skipping already rejected credentials. Other Git
failures still stop the affected phase; global accounts remain unchanged.
The file is unencrypted, protected by owner-only permissions and excluded from source control and
generation. It survives housekeeping. Other providers, SSH and sibling accounts remain isolated.
A browser-only session does not authenticate Git; use \`gh auth login --hostname github.com\` or
\`glab auth login --hostname gitlab.com\` in a normal host terminal (substitute your configured host
for self-hosted instances). Never put a token in a command or a chat.

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
\`config.toml\` and \`agents/\` select the exact GPT Astra/max policy and requested permissions.
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
