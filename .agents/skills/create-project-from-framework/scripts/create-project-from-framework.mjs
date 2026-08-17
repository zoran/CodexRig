#!/usr/bin/env node
/** Owns create project from framework behavior for the portable clean-project generation boundary. */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { supportedCodexStartCommand } from "../../../../scripts/context/portable-context-contract.mjs";
import {
  initialDeliveryConfiguration,
  parseDeliveryConfiguration,
  deliveryConfigurationPath,
} from "../../../../scripts/contracts/delivery-configuration.mjs";
import {
  initialProductConfiguration,
  productConfigurationPath,
} from "../../../../scripts/contracts/product-configuration.mjs";
import {
  initialTenancyConfiguration,
  tenancyConfigurationPath,
} from "../../../../scripts/contracts/tenancy-configuration.mjs";
import {
  initialLocalizationConfiguration,
  localizationConfigurationPath,
} from "../../../../scripts/contracts/localization-configuration.mjs";
import { formatContextError } from "../../../../scripts/terminal/terminal-output.mjs";
import {
  activeModuleInventoryHeading,
  initialFutureModulesDocument,
  manifestAuthorityPreamble,
  noActiveModulesStatement,
} from "../../../../scripts/docs/project-manifest-contract.mjs";
import { renderDeliveryManifestProjection } from "../../../../scripts/docs/delivery-manifest.mjs";
import { ensureProductSourceBoundary } from "../../../../scripts/setup/stage-project-export.mjs";
import {
  defaultDirectoryName,
  directoryName,
  fail,
  normalizedName,
  normalizedProjectDescription,
  parseArgs,
  resolveProjectRoots,
  slugify,
  usage,
} from "./project-options.mjs";
import { copyPortableProjectTree, recordGeneratedFrameworkInstallation } from "./project-copy.mjs";
import {
  escapeMarkdownText,
  initialDescriptionLines,
  markdown,
  markdownFence,
  writeRelative,
} from "./generated-document-helpers.mjs";
import { adaptContextIndexDocForGeneratedProject } from "./generated-context-index-doc.mjs";
import {
  enableGeneratedProjectMemories,
  writeGeneratedCodexReadme,
} from "./generated-codex-config.mjs";
import {
  generatedDependencyAgentPolicy,
  generatedDependencyInstructionsPolicy,
  generatedDependencyReadmePolicy,
} from "./generated-dependency-doc.mjs";
import {
  generatedFrameworkAgentPolicy,
  generatedFrameworkInstructionsPolicy,
  generatedFrameworkReadmePolicy,
} from "./generated-framework-policy.mjs";
import {
  assertGeneratedProjectClean,
  assertGeneratedProjectParity,
  formatGeneratedMarkdown,
  runGeneratedNode,
  updateGeneratedPackage,
} from "./generated-project-finalization.mjs";
import {
  assertSourceBaselineClean,
  assertSourceProductBoundaryClean,
  cleanupSourceAfterProjectCreation,
  postProjectCreationGuidance,
} from "./source-readiness.mjs";
import {
  assertSourceGitStateUnchanged,
  captureSourceGitState,
  sourceHasGitChanges,
} from "./source-git-state.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultSourceRoot = path.resolve(scriptDirectory, "..", "..", "..", "..");
function writeIdentityDocs(targetRoot, projectName, projectDescription) {
  const fence = markdownFence;
  const displayName = escapeMarkdownText(projectName);
  const deliveryConfiguration = initialDeliveryConfiguration();
  const tenancyConfiguration = initialTenancyConfiguration();
  const localizationConfiguration = initialLocalizationConfiguration();
  writeRelative(targetRoot, productConfigurationPath, initialProductConfiguration(projectName));
  writeRelative(targetRoot, deliveryConfigurationPath, deliveryConfiguration);
  writeRelative(targetRoot, tenancyConfigurationPath, tenancyConfiguration);
  writeRelative(targetRoot, localizationConfigurationPath, localizationConfiguration);
  writeGeneratedCodexReadme(targetRoot);
  writeRelative(
    targetRoot,
    "AGENTS.md",
    markdown([
      "# AGENTS.md",
      "",
      "This is a code-first Codex project. `instructions.md` owns the complete agent workflow; this",
      "file is a short safe-entry bootstrap. The README owns setup and use, `docs/project.md` owns",
      "durable project truth, and optional `docs/project-context.md` holds only bounded current work.",
      "",
      "## Start",
      "",
      "1. Start Codex from this repository root with `" +
        supportedCodexStartCommand +
        "`. The launcher",
      "   updates the host CLI, installs the locked toolchain, checks prerequisites, refreshes the",
      "   newest stable compatible dependency graph, runs the online doctor, attests startup, and then",
      "   starts the isolated project session.",
      "   Only optional `--no-alt-screen` and explicit Dev-only `--yolo` are launcher controls; prompt",
      "   text must follow `--`. Portable defaults remain on-request, network-disabled workspace-write.",
      "2. Stop only if startup reports a missing requirement or an indeterminate dependency refresh.",
      "3. Read `instructions.md`, the README, the manifest, and optional working context, then inspect",
      "   task-relevant source, tests, manifests, and configuration. Current files and command output",
      "   outrank remembered context.",
      "4. Use known paths or `rg` for exact anchors. When no reliable exact anchor exists, ownership is",
      "   unclear, or cross-file relationships matter, use `$context-retrieval` or",
      '   `pnpm context:search -- "concept or relationship"` early, then read every matched source used',
      "   for a claim or edit. A failed `rg` attempt is not required.",
      "",
      "## Bootstrap Guardrails",
      "",
      ...generatedFrameworkAgentPolicy,
      "- Follow the Product-First Delivery And Verification Economy policy in `instructions.md`: plan",
      "  every new feature and every other complex task thoroughly before implementation, organize the",
      "  authorized outcome into goals and reviewable slices, run focused changed-path owners, and",
      "  advance only trusted evidence. A failure never authorizes a broad restart or cache bypass.",
      "- Root `src/` is the default Product Root. A real declared pnpm package activates `<unit>/src`;",
      "  an evidenced Android Gradle module activates `<module>/src/main`. Arbitrary folders do not",
      "  activate, and a web package is created only when requested.",
      "- Keep Codex tooling and mutable state outside product units. Portable config, hooks, roles, and",
      "  docs stay tracked under `.codex/`; private runtime and `.context-index/` remain ignored at root.",
      "  Git and Git-less inventory use the same pre-descent mask.",
      "- Treat product identity and public contact or deployment data as configuration with one",
      "  user-approved machine-readable owner; use placeholders or RFC-reserved domains until configured.",
      ...generatedDependencyAgentPolicy,
      "- Use subagents only when at least two substantial independent slices shorten the critical",
      "  path enough to justify coordination. Concurrency is a ceiling, not a target; keep small or",
      "  tightly coupled work with the primary and do not delegate deterministic shell gates. Every",
      "  subagent uses the exact same configured GPT Sol model and `ultra` reasoning as the primary.",
      "- Fix root causes at the owning boundary. Tests are risk-based evidence; do not add one",
      "  automatically for each fix or user instruction. When justified, default to extending",
      "  a broad, realistic end-to-end, system, or lifecycle scenario; do not create isolated one-off",
      "  tests or verifier files. Narrow coverage needs a proportionate reason. Keep maintained",
      "  executable modules at or below 700 physical lines; preserve unrelated work and private",
      "  local state.",
      "- Inspect `pnpm verify:changed -- --print-plan` while working; invoke `pnpm verify` once on the actual target-`main` state after repository-mutating cleanup, the goal-wide documentation and critical-document gates, the clean goal audit, and applicable reset. A later repository edit reopens those gates. Full coverage requires a named uncovered reason.",
      "- A green goal closes only on the actual published central `main`. In serialized direct-main",
      "  mode, the primary commits and pushes only goal-owned changes. With a temporary branch or",
      "  protected `main`, one integrator or the provider merge serializer publishes the bounded input; refresh local",
      "  `main` and repeat the goal-wide documentation and critical-document gates, affected",
      "  review/audit, course check, and verification on that resulting commit without adding a marker",
      "  commit. `pnpm goal:new` must then prove a clean worktree with",
      "  exact locally recorded remote `main` equality and current successful evidence; failure never",
      "  authorizes force-push.",
      "",
      "All detailed boundaries—including repository course checks, pre-descent isolation, semantic-index",
      "lifecycle, staged validation, evidence reuse, and publication—are owned by `instructions.md`.",
    ]),
  );
  writeRelative(
    targetRoot,
    "README.md",
    markdown([
      "# " + displayName,
      "",
      "A code-first Codex project with isolated runtime, portable policy, compatible dependency",
      "updates, semantic retrieval, modular architecture guardrails, and risk-based verification.",
      "",
      ...generatedFrameworkReadmePolicy,
      "",
      "## Start",
      "",
      "Install the current [Codex CLI](https://developers.openai.com/codex/cli/),",
      "[mise](https://mise.jdx.dev/installing-mise.html), Git, Bash, ripgrep, and ShellCheck. Then run:",
      "",
      fence + "bash",
      supportedCodexStartCommand,
      fence,
      "",
      "The launcher updates the host CLI, installs the locked toolchain, checks prerequisites,",
      "atomically installs the newest stable graph allowed by declared ranges and pins, runs the",
      "online framework doctor, and attests startup. Failed or indeterminate refreshes block startup;",
      "only the final process receives ignored `.codex/runtime/` as `CODEX_HOME`.",
      "Only optional `--no-alt-screen` and explicit Dev-only `--yolo` are launcher controls; prompt",
      "text follows `--`. Portable defaults remain on-request, network-disabled workspace-write.",
      "",
      ...generatedDependencyReadmePolicy(fence),
      "",
      "`pnpm setup` creates the ignored `.context-index/`. SessionStart announces only safe metadata",
      "for a recent repository-bound sealed handover under ignored `tmp/codexrig-handovers/` and asks",
      "before `$resume-project` may read or use it. The project-local Codex Stop hook refreshes",
      "changed indexed sources and validates the bounded `docs/project-context.md` work-state marker",
      "only for durable local Stop events with a non-null `transcript_path`. Ephemeral side conversations",
      "and other transcriptless contexts exit before index or work-state access. Active multi-goal or",
      "multi-session outcomes are reopened through the official continuation response. An unchanged",
      "already-continued durable turn is allowed to stop instead of looping. A sealed handover stops",
      "without index refresh or autonomous continuation; semantic search otherwise repairs",
      "freshness on demand. See",
      "[Context Index](docs/context-index.md).",
      "",
      "## White-Label Configuration",
      "",
      `Public product identity, brand/theme/assets, public endpoints/contacts, and application IDs have one replaceable machine owner in [${productConfigurationPath}](${productConfigurationPath}).`,
      "The repository name is not a public brand fallback. Runtime, UI, metadata, manifests, tests, and deployment adapters derive or inject product-facing values from that owner rather than repeating literals. Every other setting has one typed owner at its module or composition boundary, with explicit environment overlays and separate secrets. Framework metadata remains inspectable for developers but must never appear in product-facing output.",
      `Delivery target truth has its own project-owned inventory in [${deliveryConfigurationPath}](${deliveryConfigurationPath}). It keeps the default Dev selection separate from explicitly declared or repository-detected integrated environments. Goal housekeeping reconciles unambiguous evidence and the manifest without deploying anything; ambiguous environment hints require developer classification.`,
      "",
      "## Identity And Access Boundary",
      "",
      "Identity and Access is a dedicated trust and domain boundary. Its explicit root separates authentication and credentials/authenticators, authorization and server-side policy decisions, principal/account lifecycle and user management, sessions/tokens, audit/persistence, and identity-provider adapters behind narrow public ports. UI and web own only sign-in/account presentation, API transports invoke public guards, infrastructure owns only provider provisioning, and product domains retain resource-specific business invariants; none may own provider SDKs, credentials, grants, or session internals. Provider selection and public IDs use one typed Auth configuration owner with environment overlays; credentials/signing material remain secret and provider branding is not a product fallback. Material Auth changes invoke both `$architecture-evolution` and `$security-review`.",
      "`pnpm auth:check` owns the stack-neutral structural guard; the actual Auth module owns its stack-native integration and security tests.",
      "",
      "## Tenant Isolation Boundary",
      "",
      `Every product starts with the visible project-owned tenant-isolation contract in [${tenancyConfigurationPath}](${tenancyConfigurationPath}). Its initial pending resolver is valid only while no product runtime exists. Before the first product implementation, choose trusted tenant-context sources and implement a dedicated tenancy boundary with context resolution, deny-by-default isolation policy, and narrow public ports. Authentication alone is not tenant isolation: authorization combines principal, tenant membership, action, and resource ownership on every protected operation. Data, uniqueness, migrations, cache keys, files, messages/events/jobs, quotas, exports/deletion, and operational correlation remain tenant-scoped; caller-supplied tenant IDs and implicit default tenants are invalid. Cross-tenant control-plane work requires a separate explicit capability and audit.`,
      "`pnpm tenancy:check` owns the portable structural contract; the active modules own stack-native cross-tenant negative lifecycle tests.",
      "",
      "## Localization And Source Language",
      "",
      `Source code, identifiers, filenames, tests, and technical source/declaration headers remain English. User-facing locale truth has its own project-owned machine contract in [${localizationConfigurationPath}](${localizationConfigurationPath}); it begins pending until the first intake confirms single- or multi-locale strategy, default, supported and fallback locales. UI/content, public metadata, emails/notifications, support, legal text, formatting, direction, URLs, and search follow that explicit decision rather than the source language.`,
      "Use `$native-language-content-review` for changed user-facing copy and `pnpm localization:check` for the portable configuration/manifest boundary.",
      "",
      "## Repository Housekeeping",
      "",
      "After the mutating work of every completed goal and before its goal-wide documentation review/final audit, run `pnpm repo:housekeeping -- --apply`. It reconciles unambiguous delivery evidence and the bounded manifest projection, formats the result, and checks repository architecture/docs/headers, localization, Identity and Access, white-label configuration, dependencies, secrets, agent policy, and framework health. It never deploys, commits, pushes, or changes external state. The weekly GitHub/GitLab schedules run the read-only online mode; ambiguous staging/production evidence requires developer classification.",
      "",
      "## Project Authority",
      "",
      "- [Project Instructions](instructions.md) own the complete workflow and safety contract.",
      "- [Project Manifest](docs/project.md) owns durable product truth and the current active module inventory.",
      "- [Future Modules](docs/future-modules.md) is the initialized, non-authoritative home for unimplemented module candidates.",
      "- [Context Index](docs/context-index.md) owns semantic retrieval behavior.",
      "- `AGENTS.md` is the short safe-entry bootstrap; `.codex/` owns portable Codex configuration.",
      "- `.codexrig/` owns the installed framework version, compatibility, provider, and upgrade receipt.",
      "",
      "## License And Attribution",
      "",
      "This generated project includes CodexRig Framework material under the PolyForm Noncommercial License 1.0.0. Every noncommercial copy, distribution, and derivative work must retain `LICENSE` and `NOTICE`, including the Zoran Kikic author credit and CodexRig Framework credit. Commercial use requires a separate express written license from Zoran Kikic.",
      "A separate written commercial license may expressly permit complete removal of those credits from this generated project only. It does not permit their removal from CodexRig itself. See `LICENSE` and `NOTICE` for the controlling terms and public licensing contact.",
      "",
      'Use known paths or `rg` for exact discovery and `pnpm context:search -- "query"` for semantic',
      "discovery. Inspect `pnpm verify:changed -- --print-plan` while working and run `pnpm verify`",
      "once after clean review and audit on the actual integration state.",
      "Use `pnpm framework:doctor -- --online` for framework health and `pnpm platform:detect` for",
      "the selected GitHub/GitLab provider. Use only a reviewed, trusted CodexRig checkout for a",
      "`framework:upgrade` preview, and preview `platform:configure` before an explicit apply.",
      "",
      "## Framework Updates",
      "",
      "Preview a reviewed newer CodexRig checkout from this child project:",
      "",
      fence + "bash",
      "pnpm framework:upgrade -- --source <new-codexrig-root>",
      fence,
      "",
      "The source framework can instead preview this child with",
      "`pnpm framework:upgrade -- --target <child-root>`. Review the receipt-backed plan before",
      "adding `--apply`. The upgrade adopts managed capabilities and versioned policy concepts, not",
      "a blind copy of project-owned documents. Reconcile changed stable policy IDs into this",
      "project's current truth, acknowledge the exact plan digest, and then verify the child.",
      `The project-owned ${productConfigurationPath} is never overwritten by a framework upgrade.`,
      `The project-owned ${deliveryConfigurationPath} is never overwritten either; after policy reconciliation, repository housekeeping refreshes only its detected evidence while preserving explicit declarations.`,
      `The project-owned ${tenancyConfigurationPath} is also preserved; a changed tenant-isolation policy must be reconciled into its current resolver, module inventory, and runtime evidence before upgrade acknowledgment.`,
      `The project-owned ${localizationConfigurationPath} is preserved as well; reconcile changed language policy into actual surfaces, content ownership, and manifest truth rather than replacing locale decisions.`,
      "Framework roles, skills, hooks, policies, managed files, exclusions, receipts, and planned",
      "upgrade actions remain tracked and inspectable; normative behavior is never hidden.",
    ]),
  );
  writeRelative(
    targetRoot,
    "instructions.md",
    markdown([
      "# Project Instructions",
      "",
      "This file is the single committed workflow authority. Other entry documents repeat only the",
      "guardrails needed to remain safe when opened alone; resolve workflow detail here.",
      "",
      "Normal development should primarily change product code, tests, and necessary configuration.",
      "The concise `docs/project.md` manifest is the central truth for intent, scope, system shape,",
      "constraints, and durable decisions.",
      "",
      ...generatedFrameworkInstructionsPolicy,
      "## Product-First Delivery And Verification Economy",
      "",
      "Every new feature and every other complex task starts with a thorough, decision-ready plan before implementation.",
      "The plan resolves outcome, scope, owners/consumers, material decisions, risks, acceptance evidence, cleanup, and publication boundaries.",
      "Organize authorized work into explicit goals with success conditions and ordered, reviewable slices; treat a completed slice as the normal executable step.",
      "After each slice, repeat focused verification, review, and repair until no relevant finding remains, then perform a fresh audit; an audit finding reopens the loop.",
      "After every completed slice and at every major milestone or completed goal, run a whole-repository course check against the current repository and available upstream state, clean up and update the authorized work and plan, and continue autonomously when unblocked.",
      "",
      "During implementation, run narrow owner checks. Use changed-path routing",
      "through `pnpm verify:changed` for applicable format, static, docs/content, package/export",
      "boundary, and focused owner checks.",
      "A workspace package may expose `verify:preflight` as its explicit affected-owner boundary check.",
      "Stable owned export targets may be declared by subpath in adjacent `package.exports.json`;",
      "unrelated sibling exports remain additive.",
      "A cheap failure found only by a broad suite is a routing defect. Preserve any failure, reproduce",
      "it with the smallest owner, batch sibling fixes, and recompute missing coverage and admission",
      "at the final repaired state. Reuse a safely advanceable successful basis through focused owners;",
      "otherwise collect the complete fix batch before the remaining broad run.",
      "",
      "After repository-mutating cleanup, run `pnpm repo:housekeeping -- --apply`, then complete the goal-wide documentation review and clean goal audit. After any reset, invoke `pnpm verify` once on the actual target-`main` state. A later repository edit reopens housekeeping, cleanup, documentation review, and audit. Verification uses adaptive admission;",
      "full coverage requires a named missing basis, unknown or incomplete scope, unowned path,",
      "broad-only risk, or explicit owner instruction. Force needs a concrete reason; cache bypass is",
      "forbidden. Successful Git-bound evidence advances only after complete focused delta coverage.",
      "Pre-push may rebind an exactly content-identical dirty-to-commit transition without verifier",
      "commands before security checks; any changed input blocks that basis-only path. Missing,",
      "corrupt, stale, or ambiguous evidence fails closed with an exact reason.",
      "Keep one replace-in-place successful-evidence record and one session lock; do not add per-run",
      "receipts, checkpoint chains, or verification history without a measured project-specific need.",
      "Local evidence is a workflow performance cache, not a cryptographic attestation or substitute",
      "for protected remote CI and branch policy. A same-user process can bypass repository hooks;",
      "use an external trusted executor when adversarial publication integrity is required.",
      "",
      "## Test Strategy",
      "",
      "Tests are durable product evidence; do not add one automatically for each fix or user instruction.",
      "Weigh realistic recurrence, material impact, existing coverage, and maintenance cost first.",
      "When justified, default to extending a broad, realistic end-to-end, system, or lifecycle",
      "scenario through real boundaries; do not create isolated one-off tests or verifier files.",
      "Narrow unit or contract coverage is an exception when the broad flow cannot exercise critical",
      "deterministic behavior reliably or proportionately. Focused commands control execution cost,",
      "not test granularity. Temporary reproduction scripts do not enter the repository.",
      "",
      "Continue autonomously within the user's authorized objective through planned slices, focused",
      "evidence, review-and-repair loops, audits, course checks, cleanup, and publication. A goal is a",
      "checkpoint, not a handoff: after integration and publication on `main`, run `pnpm goal:new`",
      "immediately and continue the next already-authorized goal without waiting for another prompt.",
      "Stop at the complete outcome, a real external blocker, or materially different scope; do not",
      "invent another product goal. A failed publication or new-goal gate leaves the current goal and",
      "the encompassing authorized outcome open.",
      "",
      "## Product Roots",
      "",
      "Root `src/` is the required default Product Root. A real package matched by",
      "`pnpm-workspace.yaml`, with its own `package.json` and `src/`, activates `<unit>/src`. A declared",
      "Android Gradle module with a build file, manifest, and `src/main/` activates that implementation",
      "root. Arbitrary folders do not activate. Create or import a requested web app as a declared",
      "package then; do not pre-create an empty `apps/web` in a neutral project.",
      "",
      "Keep `.codex`, `.agents`, `AGENTS.md`, process state, and other Codex tooling outside every",
      "product unit. The repo-wide semantic vector state is fixed at ignored root `.context-index/` and",
      "cannot be redirected into product source. Product verification shares this one roots contract.",
      "Git and Git-less inventory use a built-in pre-descent mask before entering private",
      "`.codex/runtime` CODEX_HOME, legacy root runtime, index, or process-state trees. Repository-local",
      "`.git/info/exclude` patterns are forbidden; tracked `.gitignore` is the local ignore authority.",
      "Host and local Git excludes cannot hide active source. `pnpm setup` materializes and smoke-tests",
      "that vector space. The trusted project Stop hook refreshes changed sources once per Codex turn",
      "only for a durable local Stop input with a non-null `transcript_path`; ephemeral side conversations",
      "and other transcriptless contexts exit first. Semantic search retains on-demand repair, while",
      "unrelated verification and pre-push remain read-only.",
      "Policy-sensitive Git probes bind root-owned Git metadata with the canonical worktree and pin stat",
      "checks. Goal publication compares content through a fresh temporary index.",
      "Repository-local FSMonitor and hidden index flags are rejected.",
      "Git-less roots stay Git-less. Staged validation rejects a caller-selected stage path.",
      "",
      ...generatedDependencyInstructionsPolicy,
      "",
      "## Workflow",
      "",
      "1. Start with `" +
        supportedCodexStartCommand +
        "`; the launcher updates the host CLI, checks",
      "   prerequisites, refreshes compatible dependencies, and then uses ignored `.codex/runtime/` as the repository-local Codex home.",
      "2. Complete Startup Repository Reconstruction before new work: read README/manifest/optional work state, inventory roots/modules/surfaces/contracts/config/tests/docs, inspect Git and safe evidence, and resume or safely consolidate unfinished state before the course check.",
      "3. Use known paths or `rg` for exact names, symbols, and narrow questions. When no reliable exact",
      "   anchor exists, ownership is unclear, or work depends on broad orientation, unfamiliar",
      "   terminology, or cross-file relationships, use `$context-retrieval` or",
      '   `pnpm context:search -- "concept or relationship"` before broad repository exploration.',
      "4. Treat retrieval results as discovery pointers: read every matched source used for a claim or",
      "   edit. A failed `rg` attempt is not required first, and semantic search is not ceremony.",
      "5. Local Codex memory isolation is repository-local and root-bound under ignored `.codex/runtime/`. Memories are enabled only inside this project's clean isolated runtime home; no source or sibling memory is inherited. Trust current files and command output. For every new feature and every other complex task, finish the thorough plan before implementation and keep it in the conversation.",
      "6. Organize the plan into goals with success conditions and ordered slices with concrete outcomes, owners, dependencies, risks, focused evidence, review surfaces, and audit criteria.",
      "7. Review the plan until no relevant finding remains, then perform a fresh plan audit; an audit finding reopens the loop.",
      "8. Before the slice begins, restate its goal, outcome, success condition, modules, contracts, schemas/migrations/shared configuration, repository-relative write set, and one writer. Inspect all observable agent, session, account, bounded-context, and shared team-channel claims before relying on Git. Resolve overlap or uncertain shared ownership before implementation.",
      "9. Implement one coherent planned slice inside that coordinated write set and run focused owner and consumer evidence.",
      "10. For every non-trivial implementation, architecture, configuration-boundary, or integration slice, invoke `$system-coherence` before acceptance: trace a representative assembled flow, search real consumers and the current module map for competing or redundant concepts, repair material whole-project drift at the canonical owner, and finish this lane before promotion. In Dev it runs in parallel with or after the latest developer deploy.",
      "11. Repeat review, repair, and affected focused checks until no relevant finding remains; then perform a fresh slice audit, reopening the loop for any audit finding.",
      "12. After every completed slice and at every major milestone or completed goal, run a whole-repository course check against current worktree and available upstream changes; clean up and update code, tests, configuration, docs, bounded context, and the plan, then continue autonomously when unblocked.",
      "13. At every completed goal, after repository-mutating cleanup and before the final audit and publication, complete the all-document and critical-document gate in the Documentation section. Any resulting or later repository edit reopens affected checks, cleanup, that documentation gate, and the fresh audit; no later mutation may bypass this sequence.",
      "14. Fix the owning invariant, follow the detected stack, and prefer justified broad end-to-end coverage over an isolated test for each instruction.",
      "15. Use subagents only when at least two substantial independent slices shorten the critical path; concurrency is not a target, shell gates stay primary-owned, and every role uses exactly the primary's configured GPT Sol model with `ultra` reasoning.",
      "16. Use the declared integration path. Serialized direct-main work remains on current `main`; a temporary branch or protected-main flow commits and pushes only a bounded input for one integrator or the detected provider's merge serializer.",
      "17. After protected or parallel integration, refresh local `main` and repeat the course check, automatic review/repair, completed-goal all-document review, any critical-document confirmation and preservation review, fresh audit, and affected verification on the actual published commit without creating a marker commit.",
      "18. On actual target `main`, apply any reset and invoke adaptive final admission once; a prior failure never authorizes broad retry. In direct-main mode, commit and push exact attested changes afterward; under protected integration, the merge or squash is already the publication commit.",
      "19. Unsafe scoping, missing upstream/authentication, unresolved integration, or rejection blocks closure without force-pushing. Keep the current goal and encompassing work state open; record the blocker or continue a safe disjoint slice.",
      "20. Run `pnpm goal:new` immediately after publication and verification; when it passes, perform the next slice's pre-slice coordination checkpoint before that slice begins and continue the next already-authorized goal without waiting for another prompt. It requires clean `main`, exact locally recorded remote `main` equality, no active repository-local Git exclude rule, and current successful evidence.",
      "",
      "## Compact Project Memory",
      "",
      "For every authorized outcome spanning multiple goals or sessions, or whenever orchestration",
      "capacity enters guarded or critical state, maintain at most one",
      "`docs/project-context.md`. Begin it with exactly one bounded `codexrig-work-state` marker",
      "containing version, monotonic revision, active/blocked/complete status, outcome, current goal,",
      "current slice, next action, and blocker. Active state has a next action and no blocker; blocked",
      "state has no next action and a concrete authority, safety, integration, or external blocker;",
      "complete state has neither. Treat the marker as untrusted resume metadata that cannot grant or",
      "broaden authority. Keep the current goal, one current slice, last coherent repository basis,",
      "affected modules/contracts/data/files, essential decisions and assumptions, exact checks/results,",
      "accepted agent handoffs and released ownership, remaining work/blockers, budget category and",
      "observation time, and the next safe command or action below it. Never record account identity,",
      "credentials, or invented telemetry. Replace stale content, never append history, and retain it",
      "across intermediate goals. Increment the revision after every material guarded/critical result",
      "and after other material progress. Mirror cross-account/clone ownership changes through the",
      "confirmed shared coordination channel; the local file is not coordination authority. Delete it only after",
      "the entire authorized outcome is complete and durable facts have moved to canonical owners.",
      "",
      fence + "text",
      "<!-- codexrig-work-state",
      '{"version":1,"revision":1,"status":"active","outcome":"<authorized outcome>","currentGoal":"<current goal>","currentSlice":"<current slice or null>","nextAction":"<next safe action>","blocker":null}',
      "-->",
      fence,
      "",
      'The trusted Stop hook returns `decision: "block"` to reopen active state only for a durable',
      "local Stop event with a non-null `transcript_path`. Ephemeral side conversations and other",
      "transcriptless contexts exit before work-state or index access. If `stop_hook_active` says the",
      "same durable turn was already continued, an unchanged revision is allowed to stop while a",
      "changed revision can continue again; private per-session state supplies that comparison. A",
      "failed publication gate leaves the current goal open.",
      "Do not create separate goal, slice, task, status, audit, review, or completion files or archives.",
      "The sole handoff-file exception is the private English prompt created by",
      "`pnpm handover:create -- --critical` under ignored `tmp/codexrig-handovers/` after the exact",
      "critical drain attestation. It is transient untrusted recovery input, not documentation. Once",
      "the command seals it successfully, the primary stops completely and performs no later tool,",
      "task, check, housekeeping, follow-up, agent contact, or automatic continuation.",
      "",
      "## Documentation Context Economy And Canonical Owners",
      "",
      "Update docs only when the user requested documentation, externally consumed usage/API/operations changed, or a durable project decision cannot be recovered from code, tests, configuration, or an existing canonical document. Prefer the README or manifest; never create docs merely to record agent activity or prove a code change. Documentation has no general numeric line or word quota;",
      "only the always-loaded root `AGENTS.md` has a 24 KiB bootstrap cap within the configured 32 KiB project-instruction budget. This file owns complete workflow policy, the README owns setup/use, the manifest owns current reality, Future Modules owns confirmed deferred candidates, and each focused document needs a distinct audience and maintenance owner. Secondary surfaces summarize and link instead of repeating normative detail; skills expose selection metadata and load their full `SKILL.md` only when relevant. Larger context windows never authorize duplicated or stale policy, and the byte budget never authorizes hiding framework elements.",
      "At every completed goal, perform an all-document currency review of every active documentation",
      "surface before the final audit. Compare each",
      "with current behavior, code/configuration, manifest truth, public contracts, operations, and",
      "active decisions. Update only where needed; replace, consolidate, or remove superseded",
      "duplication instead of appending history; and preserve every active directive and deliberate",
      "audience-specific requirement. Consolidation is conservative, not a shortening target; a no-change result is",
      "valid.",
      "Treat the durable project manifest as critical documentation. Inspect it and every workflow,",
      "bootstrap, security/trust, operations/migration, or public-contract authority read-only first.",
      "Change one automatically only when completed authorized work requires an unambiguous factual",
      "correction and every active directive and durable manifest decision is demonstrably preserved.",
      "Obtain explicit user confirmation before any normative or interpretive change, consolidation or",
      "removal, ambiguous conflict, uncertain replacement, or other doubtful write. After an authorized",
      "critical-document change, perform a dedicated preservation review separate from the general",
      "review and trace removed or materially",
      "rewritten directives and manifest decisions to surviving canonical text or explicit retirement.",
      "Preserve uncertain requirements. Documentation edits reopen affected checks, cleanup, this",
      "documentation gate, and the fresh audit. Keep review results in conversation rather than creating",
      "a process document.",
      "",
      "Keep maintained executable modules at or below 700 physical lines and split only at cohesive",
      "ownership boundaries. The quota does not apply to documentation, styles, declarative context,",
      "generated output, test corpora, fixtures, or snapshots.",
      "",
      "## White-Label Product Configuration",
      "",
      `Every generated product is white-label. ${productConfigurationPath} is the initial replaceable machine owner for public product identity, brand/theme/assets, public endpoints/contacts, and application IDs. It deliberately starts without a public name: repository/package names are never runtime brand fallbacks. Keep every other setting behind one typed configuration contract at its owning module or composition boundary; checked-in safe defaults live with that owner, environment-specific values use explicit overlays or deployment injection, and secrets stay in the secret boundary.`,
      "Keep every approved public product identity value in that one user-approved machine-readable owner.",
      "UI, web output, metadata, manifests, API clients, infrastructure adapters, tests, fixtures, and examples derive or inject values from those owners without literal fallbacks. CodexRig names and assets may remain in developer-facing framework policy, receipts, and upgrade documentation because framework behavior must stay inspectable, but they never appear in a product-facing runtime or public artifact.",
      "Rebranding or tenant variation changes configuration and owned assets, not domain behavior or copied source trees. Docs/examples use explicit placeholders or RFC-reserved domains until configured. External tool names and authoritative docs URLs remain reference literals.",
      "",
      "## Licensing And Attribution",
      "",
      "`LICENSE` contains the unmodified PolyForm Noncommercial License 1.0.0 and `NOTICE` contains the controlling CodexRig Required Notice. Every noncommercial copy, distribution, and derivative work must retain both files, the Zoran Kikic author credit, and the CodexRig Framework credit. They are managed portable framework inputs and `pnpm license:check` fails closed on drift.",
      "Commercial use requires a separate express written license from Zoran Kikic. CodexRig itself always retains its license and credits. A separate written commercial license may expressly permit complete removal of those credits only from the specifically licensed project generated by CodexRig; noncommercial use never permits removal. Required source attribution remains separate from product-facing white-label output.",
      "",
      "## Tenant Isolation",
      "",
      `Every generated project is tenant-capable from creation. ${tenancyConfigurationPath} is the visible project-owned invariant contract: tenant context is required, cross-tenant access is forbidden by default, and authorization, data, cache, files, messages/jobs, and operational correlation stay tenant-scoped. The initial pending resolution is truthful only while no product implementation exists. Before the first product slice, select trusted resolver sources and implement a dedicated tenancy boundary with separate context/resolution, policy/isolation, and public-contract concerns.`,
      "Never trust a tenant identifier merely because it came from a header, URL, query, body, UI selector, token presence, or network boundary. Resolve it through authenticated membership, a verified domain, a signed integration/job envelope, or an explicit control-plane capability; then authorize the current principal, tenant, action, and resource together. Keep tenant context request/job scoped and propagate it explicitly through commands, queries, repositories, messages, jobs, cache keys, storage paths, logs/metrics/traces, onboarding/offboarding, exports, retention, deletion, backup/restore, and migrations. Global or control-plane data and cross-tenant operations need an explicit separately owned boundary, least privilege, and audit; there is no implicit default tenant.",
      "Every active module records its tenant-isolation and global/control-plane exceptions in the manifest and owns realistic negative evidence that one tenant cannot read, list, infer, mutate, delete, cache-hit, download, or trigger work for another. Use database or infrastructure isolation as defense in depth, never as a replacement for application authorization. Material tenancy changes invoke both `$architecture-evolution` and `$security-review`; run `pnpm tenancy:check` plus the affected assembled lifecycle verifier.",
      "Keep secrets, personal paths, local trust/runtime state, and private context out of Git. Preserve compatible user changes. Use specialized security or domain review only for changed surfaces.",
      "Keep review output in the conversation. Delegated agents never commit or push; the primary owns integration and goal publication without force-pushing or rewriting history.",
      "",
      "The setup-created vector space is an ordinary discovery aid under the workflow above; the Stop",
      "hook owns routine freshness, search repairs on demand, and manual indexing is not a normal step.",
    ]),
  );
  writeRelative(
    targetRoot,
    "docs/project.md",
    markdown([
      "# Project Manifest",
      "",
      "This is the always-read, concise central source of durable project truth for " +
        displayName +
        ".",
      "",
      manifestAuthorityPreamble,
      "This manifest owns product intent, scope, system shape, constraints, and durable decisions.",
      "",
      "## Definition",
      "",
      "Project name: " + displayName,
      "",
      projectDescription
        ? "Product definition: pending intake validation of the supplied creation brief."
        : "Product definition: pending.",
      ...initialDescriptionLines(projectDescription),
      "",
      "## Users And Outcome",
      "",
      "- Target users: pending.",
      "- Problem and desired outcome: pending.",
      "- Success evidence: pending.",
      "",
      "## Scope",
      "",
      "- In scope: pending.",
      "- Non-goals: do not infer a stack, provider, deployment target, data model, or trust boundary.",
      "",
      "## System Shape",
      "",
      "- Key domains and ownership boundaries: pending.",
      "- External systems and data flows: pending.",
      "- Runtime and delivery shape: no product runtime or deployment is integrated.",
      "- Product surface decision: pending; derive and confirm web/PWA, installed mobile/desktop,",
      "  CLI/TUI, API/service, worker, library/SDK, embedded/realtime, or a justified combination",
      "  from the intended user experience before selecting product technology.",
      "- Product languages and localization: pending; decide early whether user-facing UI, public",
      "  content, messages, metadata, support, and legal text are single- or multi-locale.",
      "- Source code, identifiers, filenames, and technical source documentation use English.",
      "",
      renderDeliveryManifestProjection({
        configuration: parseDeliveryConfiguration(deliveryConfiguration),
      }),
      "",
      "- Product interface roots: no product UI, web application, or public runtime API is integrated.",
      "- Tenant isolation runtime: no product tenant resolver or data plane is integrated; the required",
      `  initial invariant contract exists at ${tenancyConfigurationPath} with pending resolution.`,
      "- Product infrastructure roots: none are integrated; inherited CI and framework delivery",
      "  scripts remain tooling rather than invented product infrastructure.",
      "- Public product identity and brand: not configured; the repository/project name is not a",
      "  runtime branding fallback.",
      "- Runtime configuration owners beyond the initial white-label descriptor: none are integrated.",
      "",
      activeModuleInventoryHeading,
      "",
      noActiveModulesStatement,
      "",
      "## Constraints And Decisions",
      "",
      "- Keep the product neutral until user-confirmed requirements justify durable decisions.",
      "- Root `src/` is the default Product Root; declared pnpm packages and evidenced Android modules",
      "  may add contracted source roots, while arbitrary folders do not.",
      "- Framework workflow authority lives in `instructions.md`; this manifest records facts, not",
      "  duplicated process policy.",
      `- White-label product configuration owner: ${productConfigurationPath}; it currently owns only`,
      "  an explicitly unconfigured identity plus empty replaceable maps while the product definition",
      "  is pending. Repository and package names remain developer/build identifiers, not public brand",
      "  defaults.",
      `- Delivery inventory owner: ${deliveryConfigurationPath}; it records the Dev default separately`,
      "  from actually declared or detected integrated environments and contains no credentials.",
      `- Tenant-isolation owner: ${tenancyConfigurationPath}; it requires tenant context and`,
      "  deny-by-default cross-tenant behavior, but records pending resolution until the first real",
      "  product implementation establishes trusted sources and stack-native enforcement.",
      `- Localization owner: ${localizationConfigurationPath}; it keeps the immutable English source`,
      "  language separate from the pending user-facing default, fallback, and supported locales.",
      "",
      "## Maintenance",
      "",
      "Replace pending entries when the user defines the project. Keep active truth only. A change that",
      "implements a module adds its active inventory entry and removes its candidate from",
      "`docs/future-modules.md` in the same change. Keep workflow, plans, progress, reviews, and history",
      "outside this manifest.",
    ]),
  );
  writeRelative(targetRoot, "docs/future-modules.md", initialFutureModulesDocument());
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const projectName = normalizedName(options.name);
  const projectDescription = normalizedProjectDescription(options.description);
  const projectDirectoryName = directoryName(
    options.directory || defaultDirectoryName(projectName),
  );
  const packageName = slugify(projectDirectoryName, "package name");
  const roots = resolveProjectRoots({ defaultSourceRoot, options, projectDirectoryName });
  const sourceGitState = captureSourceGitState(roots.sourceRoot);
  assertSourceBaselineClean(roots.sourceRoot);
  assertSourceProductBoundaryClean(roots.sourceRoot);
  const stagingProjectRoot = path.join(
    roots.outputParent,
    `.${projectDirectoryName}.staging-${process.pid}-${randomUUID()}`,
  );
  const stagingRoot = path.join(stagingProjectRoot, "code");
  let staged = false;
  let published = false;
  let sourceHasChanges = false;

  try {
    mkdirSync(stagingProjectRoot, { mode: 0o700 });
    staged = true;
    mkdirSync(stagingRoot, { mode: 0o700 });
    const transferManifest = copyPortableProjectTree(roots.sourceRoot, stagingRoot, {
      includeUntracked: options.includeUntracked,
    });
    ensureProductSourceBoundary(stagingRoot);
    writeIdentityDocs(stagingRoot, projectName, projectDescription);
    adaptContextIndexDocForGeneratedProject(stagingRoot);
    updateGeneratedPackage(stagingRoot, packageName);
    enableGeneratedProjectMemories(stagingRoot);
    formatGeneratedMarkdown(roots.sourceRoot, stagingRoot);
    recordGeneratedFrameworkInstallation(roots.sourceRoot, stagingRoot);
    runGeneratedNode(stagingRoot, "scripts/setup/validate-staged-project.mjs");
    if (!options.skipVerify) {
      runGeneratedNode(stagingRoot, "scripts/verify/repository-smoke.mjs");
    }
    assertGeneratedProjectClean(stagingRoot, packageName);
    assertGeneratedProjectParity({
      sourceRoot: roots.sourceRoot,
      targetRoot: stagingRoot,
      transferManifest,
    });
    assertSourceBaselineClean(roots.sourceRoot);
    assertSourceProductBoundaryClean(roots.sourceRoot);
    assertSourceGitStateUnchanged(roots.sourceRoot, sourceGitState);
    if (existsSync(roots.projectRoot)) fail("Target project directory appeared during creation.");
    renameSync(stagingProjectRoot, roots.projectRoot);
    staged = false;
    published = true;
    assertSourceBaselineClean(roots.sourceRoot);
    assertSourceProductBoundaryClean(roots.sourceRoot);
    assertSourceGitStateUnchanged(roots.sourceRoot, sourceGitState);
    cleanupSourceAfterProjectCreation(roots.sourceRoot);
    assertSourceBaselineClean(roots.sourceRoot);
    assertSourceProductBoundaryClean(roots.sourceRoot);
    assertSourceGitStateUnchanged(roots.sourceRoot, sourceGitState);
    sourceHasChanges = sourceHasGitChanges(roots.sourceRoot);
    published = false;
  } catch (error) {
    if (staged && existsSync(stagingProjectRoot)) {
      rmSync(stagingProjectRoot, { force: true, recursive: true });
    }
    if (published && existsSync(roots.projectRoot)) {
      rmSync(roots.projectRoot, { force: true, recursive: true });
    }
    throw error;
  }
  console.log("Created the project successfully in its requested output workspace.");
  console.log("Source framework tracked and portable state remained unchanged and baseline-clean.");
  console.log("Run pnpm setup in the generated project to create and validate .context-index/.");
  console.log(
    projectDescription
      ? "The supplied detailed description is stored as an intake draft; on first start Codex evaluates it and asks whether to refine it or begin from the confirmed decision-ready scope."
      : "The manifest remains pending; on first start Codex asks for a detailed description and actively guides the definition interview before implementation.",
  );
  for (const line of postProjectCreationGuidance({ sourceHasChanges })) console.log(line);
}
try {
  main();
} catch (error) {
  console.error("Project creation failed: " + formatContextError(error, defaultSourceRoot));
  console.error(usage());
  process.exit(1);
}
