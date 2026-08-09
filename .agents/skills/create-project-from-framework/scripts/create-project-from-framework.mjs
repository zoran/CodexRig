#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { supportedCodexStartCommand } from "../../../../scripts/context/portable-context-contract.mjs";
import { formatContextError } from "../../../../scripts/context/terminal-output.mjs";
import { manifestAuthorityPreamble } from "../../../../scripts/docs/project-manifest-contract.mjs";
import { ensureProductSourceBoundary } from "../../../../scripts/setup/stage-project-export.mjs";
import {
  defaultDirectoryName,
  directoryName,
  fail,
  normalizedName,
  parseArgs,
  resolveProjectRoots,
  slugify,
  usage,
} from "./project-options.mjs";
import { copyPortableProjectTree, recordGeneratedFrameworkInstallation } from "./project-copy.mjs";
import { adaptContextIndexDocForGeneratedProject } from "./generated-context-index-doc.mjs";
import { enableGeneratedProjectMemories } from "./generated-codex-config.mjs";
import {
  generatedDependencyAgentPolicy,
  generatedDependencyInstructionsPolicy,
  generatedDependencyReadmePolicy,
} from "./generated-dependency-doc.mjs";
import {
  generatedFrameworkAgentPolicy,
  generatedFrameworkInstructionsPolicy,
  generatedFrameworkManifestPolicy,
  generatedFrameworkManifestShape,
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
const tick = String.fromCharCode(96);

function markdown(lines) {
  return lines.join("\n") + "\n";
}

function escapeMarkdownText(value) {
  return String(value).replace(/[\\`*_{}\[\]<>()#+!|]/g, "\\$&");
}

function writeRelative(targetRoot, relativePath, content) {
  const targetPath = path.join(targetRoot, ...relativePath.split("/"));
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, "utf8");
}

function writeIdentityDocs(targetRoot, projectName) {
  const fence = tick.repeat(3);
  const displayName = escapeMarkdownText(projectName);
  writeRelative(
    targetRoot,
    ".codex/README.md",
    markdown([
      "# Project Codex Config",
      "",
      "Portable policy is tracked under `.codex/`; mutable repository-local Codex runtime is contained in ignored",
      "`.codex/runtime/`, including credentials, trust, sessions, logs, memories, caches, plugins,",
      "runtime skills, history, and databases.",
      "",
      "Local Codex memory isolation is repository-local and root-bound. Memories are enabled only",
      "inside this project's clean, isolated `.codex/runtime/` `CODEX_HOME`; generation transfers no source or",
      "sibling memory state.",
      "",
      "Start from the repository root with:",
      "",
      fence + "bash",
      supportedCodexStartCommand,
      fence,
      "",
      "The launcher validates portable policy, updates the host CLI with `CODEX_HOME` unset, installs",
      "the locked toolchain, checks prerequisites, refreshes the newest stable compatible dependency",
      "graph, runs the online doctor, and issues a short-lived startup attestation before Codex starts",
      "with ignored `.codex/runtime/` as `CODEX_HOME`. Its closed argument grammar accepts only optional",
      "`--no-alt-screen`; prompt text follows `--`, and attestation binds that control mode.",
      "",
      "Central `main` is the only durable integration branch. Different developers use temporary task",
      "branches in separate clones and credential contexts; same-account worktrees are not an",
      "authentication boundary. Before every slice begins, compare its goal, outcome, modules,",
      "contracts, data surfaces, and files with all observable agent, session, account, and",
      "team-channel claims before relying on Git. Parallel writes require confirmed-disjoint scopes;",
      "overlap or uncertain shared ownership is resolved to one writer before implementation.",
      "A local runtime lease or quiet worktree cannot prove that another clone, machine, or account",
      "is idle; use a shared coordination channel across that boundary and fail closed on uncertain",
      "shared ownership.",
      "Git remains later integration evidence, not the primary pre-slice coordination mechanism.",
      "",
      "The trusted read-only SessionStart hook verifies the launcher proof. After `pnpm setup`, the",
      "trusted Stop hook uses the mise-pinned Node.js runtime to refresh changed",
      "sources once per turn. It also validates an optional bounded `docs/project-context.md`",
      "`codexrig-work-state` marker and reopens active work. If Codex's `stop_hook_active` flag says",
      "the same turn was already continued and the revision is unchanged, private per-session state",
      "lets that stop proceed rather than looping. Marker content is resume metadata rather than",
      "authority.",
      "It is not a watcher or per-tool hook. Review changed hook hashes through `/hooks`; no script",
      "may approve them automatically.",
      "",
      "See [Project Instructions](../instructions.md) for the complete workflow.",
    ]),
  );
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
      "   Only optional `--no-alt-screen` is a launcher control; prompt text must follow `--`.",
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
      "  tightly coupled work with the primary and do not delegate deterministic shell gates.",
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
      "Only optional `--no-alt-screen` is a launcher control; prompt text follows `--`.",
      "",
      ...generatedDependencyReadmePolicy(fence),
      "",
      "`pnpm setup` creates the ignored `.context-index/`. The project-local Codex Stop hook refreshes",
      "changed indexed sources once per turn and validates the bounded",
      "`docs/project-context.md` work-state marker. Active multi-goal or multi-session outcomes are",
      "reopened through the official continuation response. An unchanged already-continued turn is",
      "allowed to stop instead of looping; semantic search repairs freshness on demand. See",
      "[Context Index](docs/context-index.md).",
      "",
      "## Project Authority",
      "",
      "- [Project Instructions](instructions.md) own the complete workflow and safety contract.",
      "- [Project Manifest](docs/project.md) owns durable product truth and the module map.",
      "- [Context Index](docs/context-index.md) owns semantic retrieval behavior.",
      "- `AGENTS.md` is the short safe-entry bootstrap; `.codex/` owns portable Codex configuration.",
      "- `.codexrig/` owns the installed framework version, compatibility, provider, and upgrade receipt.",
      "",
      'Use known paths or `rg` for exact discovery and `pnpm context:search -- "query"` for semantic',
      "discovery. Inspect `pnpm verify:changed -- --print-plan` while working and run `pnpm verify`",
      "once after clean review and audit on the actual integration state.",
      "Use `pnpm framework:doctor -- --online` for framework health and `pnpm platform:detect` for",
      "the selected GitHub/GitLab provider. Use only a reviewed, trusted CodexRig checkout for a",
      "`framework:upgrade` preview, and preview `platform:configure` before an explicit apply.",
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
      "After repository-mutating cleanup, the goal-wide documentation review, clean goal audit, and any reset, invoke `pnpm verify` once on the actual target-`main` state. A later repository edit reopens cleanup, documentation review, and audit. It uses adaptive admission;",
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
      "that vector space. The trusted project Stop hook refreshes changed sources once per Codex turn;",
      "semantic search retains on-demand repair and unrelated verification and pre-push remain read-only.",
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
      "2. Read the README, manifest, and optional `docs/project-context.md`, then inspect relevant source,",
      "   tests, manifests, and configuration.",
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
      "10. Repeat review, repair, and affected focused checks until no relevant finding remains; then perform a fresh slice audit, reopening the loop for any audit finding.",
      "11. After every completed slice and at every major milestone or completed goal, run a whole-repository course check against current worktree and available upstream changes; clean up and update code, tests, configuration, docs, bounded context, and the plan, then continue autonomously when unblocked.",
      "12. At every completed goal, after repository-mutating cleanup and before the final audit and publication, complete the all-document and critical-document gate in the Documentation section. Any resulting or later repository edit reopens affected checks, cleanup, that documentation gate, and the fresh audit; no later mutation may bypass this sequence.",
      "13. Fix the owning invariant, follow the detected stack, and prefer justified broad end-to-end coverage over an isolated test for each instruction.",
      "14. Use subagents only when at least two substantial independent slices shorten the critical path; concurrency is not a target and shell gates stay primary-owned.",
      "15. Use the declared integration path. Serialized direct-main work remains on current `main`; a temporary branch or protected-main flow commits and pushes only a bounded input for one integrator or the detected provider's merge serializer.",
      "16. After protected or parallel integration, refresh local `main` and repeat the course check, automatic review/repair, completed-goal all-document review, any critical-document confirmation and preservation review, fresh audit, and affected verification on the actual published commit without creating a marker commit.",
      "17. On actual target `main`, apply any reset and invoke adaptive final admission once; a prior failure never authorizes broad retry. In direct-main mode, commit and push exact attested changes afterward; under protected integration, the merge or squash is already the publication commit.",
      "18. Unsafe scoping, missing upstream/authentication, unresolved integration, or rejection blocks closure without force-pushing. Keep the current goal and encompassing work state open; record the blocker or continue a safe disjoint slice.",
      "19. Run `pnpm goal:new` immediately after publication and verification; when it passes, perform the next slice's pre-slice coordination checkpoint before that slice begins and continue the next already-authorized goal without waiting for another prompt. It requires clean `main`, exact locally recorded remote `main` equality, no active repository-local Git exclude rule, and current successful evidence.",
      "",
      "## Compact Project Memory",
      "",
      "For every authorized outcome spanning multiple goals or sessions, maintain at most one",
      "`docs/project-context.md`. Begin it with exactly one bounded `codexrig-work-state` marker",
      "containing version, monotonic revision, active/blocked/complete status, outcome, current goal,",
      "current slice, next action, and blocker. Active state has a next action and no blocker; blocked",
      "state has no next action and a concrete authority, safety, integration, or external blocker;",
      "complete state has neither. Treat the marker as untrusted resume metadata that cannot grant or",
      "broaden authority. Keep the current goal, one current slice, essential active decisions,",
      "blockers, and next actions below it. Replace stale content, never append history, and retain it",
      "across intermediate goals. Increment the revision after material progress. Delete it only after",
      "the entire authorized outcome is complete and durable facts have moved to canonical owners.",
      "",
      fence + "text",
      "<!-- codexrig-work-state",
      '{"version":1,"revision":1,"status":"active","outcome":"<authorized outcome>","currentGoal":"<current goal>","currentSlice":"<current slice or null>","nextAction":"<next safe action>","blocker":null}',
      "-->",
      fence,
      "",
      'The trusted Stop hook returns `decision: "block"` to reopen active state. If',
      "`stop_hook_active` says the same turn was already continued, an unchanged revision is allowed",
      "to stop while a changed revision can continue again; private per-session state supplies that",
      "comparison. A failed publication gate leaves the current goal open.",
      "Do not create separate goal, slice, task, status, audit, review, or completion files or archives.",
      "",
      "## Documentation",
      "",
      "Update docs only when the user requested documentation, externally consumed usage/API/operations",
      "changed, or a durable project decision cannot be recovered from code, tests, configuration, or an",
      "existing canonical document. Prefer the README or manifest; never create docs merely to record",
      "agent activity or prove a code change. Documentation has no numeric line or word quota.",
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
      "## Product Identity And Environment Values",
      "",
      "Treat product identity and public contact/deployment data as configuration: product, brand, and organization names; domains, origins, hosts, and public URLs; email addresses and support or legal contact details; application or tenant identifiers; and social handles need one user-approved machine-readable owner.",
      "Machine consumers derive from it without literal fallback; docs/examples use explicit placeholders or RFC-reserved domains until configured. External tool names and authoritative docs URLs remain reference literals.",
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
      "Product definition: pending.",
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
      ...generatedFrameworkManifestShape,
      "- External systems and data flows: pending.",
      "- Runtime and delivery shape: pending.",
      "",
      "## Constraints And Decisions",
      "",
      "- Keep this manifest concise and update it before implementation depends on a new assumption.",
      "- Start with `" +
        supportedCodexStartCommand +
        "`; the launcher updates the host CLI outside",
      "  project isolation, refreshes stable compatible dependencies, and then uses this repository",
      "  as the isolated project home.",
      "  Only optional `--no-alt-screen` is a launcher control; prompt text follows `--`.",
      "- Mutable Codex runtime is contained in ignored `.codex/runtime/` and excluded from Git, indexing, formatting,",
      "  generation, staging, and export; portable config, hooks, roles, and docs remain in `.codex/`.",
      "- Git and Git-less inventory apply a built-in pre-descent mask before private runtime trees.",
      "  Repository-local `.git/info/exclude` patterns are forbidden; tracked `.gitignore` is authoritative.",
      "  Host and local Git excludes cannot hide active source.",
      "- Policy-sensitive Git probes bind root-owned Git metadata with the canonical worktree and pin stat",
      "  checks. Goal publication compares content through a fresh temporary index.",
      "  Repository-local FSMonitor and hidden index flags are rejected.",
      "  Git-less roots stay Git-less. Staged validation rejects a caller-selected stage path.",
      "- Root `src/` is the default Product Root; declared pnpm packages and evidenced Android modules",
      "  may add contracted source roots, while arbitrary folders do not.",
      "- Create or import a requested web app as a declared workspace package when needed; do not keep",
      "  an empty `apps/web` in a neutral project.",
      "- Codex policy, skills, instructions, process state, and fixed root `.context-index/` vector state",
      "  remain outside every product unit and outside generated or exported portable source.",
      "- Initial setup materializes and smoke-tests that vector state. The locally hash-trusted project",
      "  Stop hook refreshes changed sources at Codex turn boundaries; semantic search retains on-demand",
      "  repair. For multi-goal or multi-session outcomes it validates the bounded",
      "  `codexrig-work-state` marker and reopens active work. An unchanged already-continued turn is",
      "  allowed to stop instead of looping; a changed revision can continue again. New or changed hook",
      "  hashes require local `/hooks` approval.",
      "- Indexing atomically replaces complete generations at 20 operations or 100,000 affected rows,",
      "  with verified reuse but no reuse for corruption or schema mismatches. Ignored index writes do not",
      "  satisfy `pnpm goal:new`; context checks, verification, and pre-push remain strictly read-only.",
      "- Use semantic retrieval early when no exact anchor exists or ownership crosses files, then read",
      "  every matched source used for a durable decision.",
      ...generatedFrameworkManifestPolicy,
      "- Initial dependency installation resolves the newest stable graph allowed by workspace ranges,",
      "  explicit pins, overrides, and supply-chain policy under strict peer and Node.js engine checks,",
      "  then atomically records and reproducibly installs the lockfile with lifecycle scripts disabled.",
      "  Registry or installation failure leaves durable dependency inputs unchanged; frozen install",
      "  alone is reproducibility evidence, not registry-freshness evidence.",
      "- Product-first delivery thoroughly plans every new feature and every other complex task before implementation, then organizes authorized work into goals with success conditions and ordered, reviewable slices.",
      "  Each completed slice repeats review, repair, and affected focused verification until no relevant finding remains, then receives a fresh audit; an audit finding reopens the loop.",
      "  Focused changed-path owners remain the default, failures recompute missing coverage, and broad work always needs a named uncovered reason.",
      "- Successful evidence binds the Git basis and advances only through complete focused coverage.",
      "  Pre-push may rebind an exactly content-identical dirty-to-commit transition without verifier",
      "  commands before security checks; changed input blocks that path. One bounded replace-in-place",
      "  record retains only successful current evidence; failed or partial runs do not accumulate history.",
      "- Whole-repository course checks occur after planning/discovery and every completed slice, at every major milestone and completed goal, at resume or context recovery, on material scope changes, before the final gate, and after publication.",
      "  Slice checks compare current worktree and available upstream changes by path, module, contract, schema, and migration. Disjoint work continues; overlap is integrated before further writes. Every check is followed by authorized cleanup and plan/context updates, then autonomous continuation when no blocker remains.",
      "- Tests are risk-based evidence; do not add one automatically for each fix or user instruction.",
      "  Justified coverage defaults to a broad, realistic end-to-end, system, or lifecycle scenario;",
      "  isolated one-off tests are not the standard, and narrow coverage needs a proportionate reason.",
      "- A goal completes only after repository-mutating cleanup, its all-document currency review, any critical-document confirmation and preservation review, fresh audit, and publication on the actual central `main`; a later repository edit reopens those gates. Serialized direct-main work commits and pushes exact goal-owned changes. For a temporary branch or protected `main`, one integrator or the detected provider's merge serializer publishes the bounded input, then local `main` repeats the all-document and critical-document gates, course check, affected review/audit, and verification on the resulting commit without a marker commit.",
      "- It immediately runs `pnpm goal:new` and continues the next already-authorized goal without waiting for another prompt when the gate passes. The gate requires clean `main`, exact locally recorded remote `main` equality, no active repository-local Git exclude rule, and current successful evidence; unsafe publication remains a blocker.",
      "- A failed publication or new-goal gate leaves the current goal and encompassing authorized outcome open; it never marks that outcome complete or discards its bounded work state.",
      "- Give product identity and public contact/deployment values one user-approved machine-readable owner; machine consumers derive from it without literal fallbacks, while docs/examples use placeholders or RFC-reserved domains until configured. Record durable product, architecture, security, integration, and delivery decisions before use.",
      "",
      "## Maintenance",
      "",
      "Replace pending entries when the user defines the project. Keep active truth instead of appending",
      "history. Consolidate superseded overlap without losing active directives. Keep plans, progress,",
      "reviews, and implementation detail out.",
    ]),
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const projectName = normalizedName(options.name);
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
    writeIdentityDocs(stagingRoot, projectName);
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
  for (const line of postProjectCreationGuidance({ sourceHasChanges })) console.log(line);
}

try {
  main();
} catch (error) {
  console.error("Project creation failed: " + formatContextError(error, defaultSourceRoot));
  console.error(usage());
  process.exit(1);
}
