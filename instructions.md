# Project Instructions

This file is the single committed workflow authority for the repository. Other entry documents
repeat only the guardrails needed to remain safe when opened alone; resolve workflow detail here.

## Production-Ready Means Code That Keeps Working

Deliver correct behavior at the owning boundary, proportionate evidence, secure defaults, and the
smallest durable explanation another developer actually needs. Production code defaults to cohesive,
replaceable modules with explicit contracts so a change remains local, integrations remain
reviewable, and developers or Codex orchestrators can work in parallel without sharing an implicit
write surface. Every new feature and every other complex task nevertheless requires thorough
planning, explicit goals and slices, iterative review to a clean result, and a fresh audit. Keep
that work decision-relevant and in the approved workflow surfaces instead of multiplying permanent
project-management files or ceremonial prose.

Normal implementation should primarily change product code, tests, and necessary configuration.
Repository process artifacts are overhead unless the user explicitly requests one as a deliverable.

## First-Prompt Project Definition Intake

In a generated product repository, when `docs/project.md` still contains a pending product
definition, the first user interaction is a definition intake, not an implementation prompt. Begin
the first response by telling the user that the project must be understood and its durable manifest
established before product implementation. The deliberately neutral source framework itself may be
maintained without inventing a product definition; the intake starts when work is intended to define
or implement a product. Do not infer a product, stack, users, domain model, data policy, provider,
deployment shape, or trust boundary from the framework or from a vague request.

Interview the user iteratively in small, decision-focused batches. Challenge vague terms,
contradictions, implicit scope, and premature solution choices, and follow each answer with the next
material questions. Cover only what is relevant, but do not exit while an unknown could materially
change architecture, scope, safety, acceptance, or delivery:

- target users, their problem, desired outcome, primary workflows, and observable success evidence;
- in-scope behavior, explicit non-goals, priorities, constraints, compatibility, and migration
  needs;
- domain language, business capabilities, invariants, candidate bounded contexts, ownership, and
  which complexity does or does not justify strategic DDD;
- data and state ownership, lifecycle, sensitivity, retention, migrations, external systems, and
  integration failure behavior;
- identity, authorization, privacy, abuse, regulatory, and other trust boundaries;
- runtime, delivery, availability, performance, observability, support, and operational constraints;
  and
- expected developer/orchestrator collaboration, module stewardship, the shared pre-slice
  coordination channel when independent sessions or accounts may work concurrently, and any known
  shared-contract integration pressure.

Regularly restate the current understanding and distinguish user-confirmed facts from assumptions or
open decisions. The intake is complete only when the agent can explain the intended product, system
shape, initial module map, constraints, non-goals, risks, and acceptance evidence precisely enough
to produce a decision-ready plan, and the user has had a final opportunity to correct that
synthesis. Then replace the pending entries in `docs/project.md` with concise user-confirmed durable
truth and proceed to planning and autonomous delivery. Ask no ceremonial question whose answer
cannot affect a decision, and do not repeat resolved questions.

Resume the same focused intake later whenever a request, discovery, or concurrent change creates a
material ambiguity, contradiction, or possible change to product intent, scope, acceptance, module
or public-contract boundaries, owned data, migrations, integrations, trust, compatibility, or
operations. Pause only the affected write surface; continue safe disjoint work when possible. Ask
and challenge until the changed outcome and constraints are precise, present the revised synthesis
for correction, update user-confirmed durable truth before dependent implementation, and then resume
autonomous delivery. A clarification is necessary when its answer could change the result or make a
current write unsafe—not merely because more conversation is possible.

## Product-First Delivery And Verification Economy

Start every new feature and every other complex task with a thorough, decision-ready plan before
implementation. Convert the authorized outcome into explicit goals with success conditions and
ordered, reviewable slices, then implement the largest coherent, currently unblocked slice that can
be verified safely. Planning, review, and audit depth must match the task's complexity and resolve
material decisions; they stay useful by focusing on product behavior, owning configuration, risks,
and evidence rather than process prose or status artifacts.

Use the verification layers deliberately:

1. During implementation, run the narrow owner test or command that gives useful feedback.
2. Use changed-path routing to cover applicable format, static analysis, documentation/content
   policy, package or export boundaries, and focused owner, consumer, dependency, and security
   checks. A workspace package may expose `verify:preflight` as its explicit boundary verifier;
   routing invokes it only for the affected package owner. A package with stable owned export
   targets may declare only those subpaths in adjacent `package.exports.json`; unrelated sibling
   exports remain additive. A cheap defect discovered only by a broader suite is a routing defect;
   fix that route with the owning change.
3. Treat any nonzero broad result as diagnosis, never as permission for another complete run.
   Preserve the result, reproduce it with the smallest responsible verifier, batch every confirmed
   sibling fix, and recompute missing coverage and admission only at the final repaired state. When
   a prior successful basis remains safely advanceable, run only the affected focused owners and
   reuse it. Otherwise collect the complete fix batch before the one remaining broad run; a failure,
   cache miss, or profile miss alone cannot admit broad work.
4. At the publication boundary, after the coherent batch, applicable reset, and bounded reviews,
   invoke `pnpm verify`. This is an adaptive admission entry, not an unconditional full gate. It may
   select full coverage only for a named uncovered risk: no trusted successful basis, incomplete or
   unknown classification, a full-relevant path without a focused owner, an explicitly broad-only
   invariant, or a concrete owner instruction. A force request requires both `--force-full` and a
   structured `--force-reason "owner-request: <owner-id> - <reason>"` or
   `"uncovered-risk: <risk-id> - <reason>"`; cache bypass is forbidden.

Repository-owned successful evidence binds the exact Git `HEAD`, the complete dirty/untracked set,
the command plan, tool environment, and source fingerprints. A current delta is the union of the old
dirty set, every committed path since the evidence `HEAD`, and the current dirty set, including
formerly untracked paths that were later deleted. Fully classified green focused owners may advance
that basis without rerunning an unchanged product suite. Unknown, unowned, incomplete, broad-only,
or ambiguous coverage fails closed with an exact admission reason; a failed attempt never replaces
the last successful basis. Before its security and pushed-object checks, pre-push may rebind a
commit that exactly materializes already-attested dirty content to the new Git basis without running
any verifier command. Any source, plan, runtime, risk, or unsafe Git-delta change blocks that
basis-only path and requires normal adaptive verification. This local evidence is a workflow
performance cache, not a cryptographic attestation or a substitute for protected remote CI and
branch policy. A process running as the same local user can bypass any repository-owned hook; use an
external trusted executor when adversarial publication integrity is required.

Keep this mechanism bounded: one replace-in-place successful-evidence record and one verification
session lock. Do not add per-run receipts, checkpoint chains, or verification history unless a
measured project-specific need justifies that complexity.

Within the user's authorized objective, continue autonomously through the planned slices, focused
evidence, review fixes, audits, course checks, cleanup, and publication. Stop only for a real
external blocker, unsafe or ambiguous scope, missing authority for a materially different action, or
completion of the entire authorized outcome. A completed goal is a quality and integration
checkpoint, not a conversational handoff: after publication, immediately run `pnpm goal:new` and,
when it passes, begin the next already-authorized goal without waiting for another prompt. Never
invent a subsequent product goal merely to stay busy. A failed publication or `goal:new` gate leaves
the current goal open; it cannot complete the encompassing outcome or erase its bounded working
state.

A requested recap, research result, plan, documentation gate, review, audit, definition synthesis,
or statement that work is ready is an intermediate commentary update when implementation or a larger
outcome is already authorized. Never end at "ready to implement" when implementation is already
authorized. Begin the next planned implementation slice in the same working run. A user's absence,
departure, or inability to monitor increases the need for autonomous persistence and is not a pause
instruction. Honor an explicit user requirement to pause for approval before implementation; do not
infer that pause from a recap request or absence. Persistence never broadens scope, bypasses
approvals or safety controls, authorizes destructive or external action, invents a new product goal,
or conceals a genuine blocker.

## Planning, Goals, Slices, Review Loops, And Audits

For every new feature and every other complex task, complete a thorough planning phase before
implementation begins. Keep the plan in the conversation unless the bounded multi-session context
exception below applies. The plan is decision-ready only when it identifies:

- the authorized outcome, user-visible success conditions, scope, and non-goals;
- current-system evidence, owning boundaries, affected consumers, and relevant dependencies;
- material product, architecture, data, migration, security, privacy, operational, and compatibility
  decisions or explicit unknowns that must be resolved before a dependent slice starts;
- the goal sequence, each goal's acceptance evidence, and ordered slices with a concrete outcome,
  dependencies, likely files or owners, risks, and focused verification;
- review surfaces, audit criteria, cleanup expectations, publication boundaries, and any point that
  genuinely requires user or external input.

Review the plan for omissions, contradictions, unsafe assumptions, and unnecessary work. Resolve
every relevant finding and repeat the plan review until none remains, then perform a fresh plan
audit against the request, manifest, repository state, and downstream system before implementation.
If that audit finds a relevant issue, correct the plan, repeat the review loop, and audit again.

Treat a slice as the normal executable step: one coherent, bounded outcome that advances its current
goal and can be reviewed and verified independently. Keep one current goal and one current slice
unless genuinely independent work justifies concurrency. Do not use goal or slice labels to disguise
unplanned scope, split trivial edits into ceremony, or begin a dependent slice while a material
decision remains unresolved.

Immediately before every slice begins, and again before its write scope expands, perform a pre-slice
coordination check before any write:

1. Restate the current goal, slice outcome and success condition, then declare the affected modules,
   public contracts, schemas, migrations, shared configuration, and files plus exactly one writer
   for each surface.
2. Inspect all observable collaboration state before relying on Git: live agents and delegated
   assignments, available sessions or account-level work, the bounded project context, and any
   shared team or orchestration channel. Exchange or reconcile current goal and slice claims when
   another session or account may be working in the repository.
3. Compare the declared claims. Disjoint slices may proceed concurrently. Any overlap, ambiguous
   ownership, or newly discovered shared surface must be resolved by rescoping, ordering, or one
   explicit writer before either slice writes there.
4. When separate accounts, clones, or machines cannot be observed directly, do not treat absence of
   evidence as proof that a shared surface is free. Establish a shared coordination channel or
   obtain an ownership confirmation before shared-boundary work; record only the current bounded
   decision in conversation or existing working context, never a coordination history document.

This check coordinates goals and slices before implementation so overlapping edits do not become
merge conflicts. Later worktree, upstream, and provider checks are defense in depth and integration
evidence, not the primary coordination mechanism.

When research, papers, standards, guidance, or other publications inform the work, search for and
prioritize the newest relevant primary or official sources. Verify publication or update date,
version, correction or retraction state, and applicability to the current system; for scientific
claims, prefer current peer-reviewed primary research and up-to-date high-quality syntheses where
appropriate, and label preprints or other preliminary evidence. Recency does not override source
quality, but no claim may be presented as current or latest without a current search.

Use older sources primarily for comparison or historical context. Rely on an older source as current
authority only when it remains foundational, controlling, or uniquely relevant; explain that reason
and verify against newer work that it has not been superseded, corrected, or retracted. Distinguish
source evidence from inference and report material disagreement or uncertainty instead of silently
choosing the convenient publication.

After every completed slice:

1. Run the focused owner and consumer evidence needed for that slice.
2. Review the result for correctness, acceptance criteria, regressions, root-cause quality,
   maintainability, security/privacy where applicable, documentation drift, and whole-system impact.
3. Fix every relevant, reproducible finding within the authorized scope, batch same-root-cause
   corrections, and rerun only affected focused evidence.
4. Repeat review, repair, and focused verification until no relevant finding remains.
5. Only from that clean reviewed state, perform a fresh audit against the plan, current goal,
   manifest, touched boundaries, and repository state. An audit finding reopens the slice: fix it,
   repeat the review loop to zero relevant findings, and audit again.
6. Perform the slice-boundary course check defined below against the complete current repository and
   available upstream state. Reconcile concurrent changes before beginning the next dependent slice.

A finding is relevant when it is reproducible and affects the authorized outcome, acceptance
criteria, correctness, safety, maintainability, documented behavior, or a touched owner or consumer.
False positives, duplicates, and unrelated suggestions do not block closure, but classify them
explicitly in the conversation rather than silently ignoring them. Review and audit findings remain
conversation state; do not create review logs, audit reports, or per-slice documents.

At every completed slice, major milestone, and completed goal, perform a whole-repository course
check. Compare the original objective and current plan with the manifest and module map, implemented
behavior, touched owners and consumers, remaining slices, risks, tests, documentation, runtime and
publication boundaries, and unrelated or concurrent worktree state. At a slice boundary, refresh the
available upstream view when a shared remote and network access exist, then compare changes since
the slice base by path, module, public contract, schema, and migration. Disjoint concurrent changes
do not stop progress. An overlap at an owned module or shared contract pauses further writes until
the change is integrated or ownership and order are reconciled; rerun only affected evidence. A
remote refresh failure is visible uncertainty: isolated disjoint work may continue, but
shared-boundary work waits for a trustworthy integration view. This course check does not itself
authorize broad verification.

Then clean up and update the authorized work: remove obsolete temporary work and dead paths,
reconcile code/tests/configuration/docs, refresh or delete the bounded project context as
appropriate, and update the in-session plan to the current truth. After a clean course check,
continue autonomously with the next planned slice. At a completed-goal boundary, complete the goal
documentation review defined below before the final whole-goal audit, admission, or publication.
Only then choose the declared integration path. A serialized writer may finish the final audit,
reset, verification, exact commit, and push directly on current `main` only when remote policy
permits it; any newly required repository cleanup or edit reopens affected checks, the goal
documentation review, any critical-document confirmation and preservation review, and the fresh
audit. Work from a temporary task branch—or any change targeting protected `main`—is first committed
and pushed only as a bounded integration input; one integrator or the detected provider's merge
serializer lands it. Then refresh local `main` to the published remote result and repeat the
whole-repository course check, affected review, completed-goal documentation review, any
critical-document confirmation and preservation review, fresh audit, and adaptive verification on
that actual integrated state. The merge or squash is the publication commit; do not manufacture an
empty follow-up commit. After either path has produced a clean, verified, published `main`,
immediately run `pnpm goal:new` and continue the next already-approved goal when the gate passes. Do
not return merely because a goal checkpoint completed. If publication or the gate fails, keep the
current goal and encompassing work state open, record the concrete integration or external blocker
when no safe disjoint work remains, and never misreport that intermediate checkpoint as the
completed outcome.

## Modular Architecture, Parallel Ownership, And Integration

Use a domain-modular architecture for non-trivial product code. Start with a modular monolith and
ecosystem-native module boundaries unless independently deployable services are justified by a
concrete scaling, availability, security, ownership, or release-lifecycle need. Strategic
domain-driven design is the default way to discover boundaries in a complex business domain:
separate cohesive bounded contexts and make their relationships explicit. Do not impose tactical DDD
patterns, layers, aggregates, events, or service extraction on simple behavior whose complexity does
not justify them.

Product Roots are physical discovery and verification boundaries; they are not automatically domain
modules. Before implementation depends on a new or changed module, keep the active module map in the
`System Shape` section of `docs/project.md`. For each module record only durable facts:

- a stable name and source root plus one cohesive domain responsibility or change reason;
- its public entry points, ports, commands, events, or schemas and the internals consumers must not
  import;
- the state, data, migrations, invariants, and operational responsibilities it owns;
- explicitly allowed module dependencies and integration direction;
- its focused owner/consumer verification command or package boundary; and
- the accountable steward role or team when one exists, without turning the manifest into a live
  task-assignment board.

Design every module so consumers depend on its public contract rather than its implementation:

- hide storage, framework, provider, transport, and algorithm choices behind narrow ports or APIs;
  keep adapters at the module edge and translate foreign models through an anti-corruption adapter
  when their semantics differ;
- reject dependency cycles, deep imports into another module's internals, cross-module writes to
  owned data, shared mutable state, and generic `utils`, `common`, or `shared` dumping grounds;
- share code only when its semantics and lifecycle are genuinely shared, give that shared contract
  one owner, and keep domain policy with the domain that owns it;
- evolve public contracts compatibly when practical. For a breaking contract, schema, or data move,
  land an explicit expand/migrate/contract sequence or another rollback-safe compatibility path
  before removing the old behavior;
- apply a replacement test during design and review: replacing a module implementation or external
  adapter should require changes only in composition/configuration, the replacement itself, and an
  explicit data migration—not edits throughout its consumers; and
- once a module structure is stable enough to justify maintenance cost, use the detected ecosystem's
  boundary tooling to enforce public-API-only access, allowed dependencies, and acyclic structure.

Treat these modules as system components, not isolated mini-products. Each component must be
independently improvable or replaceable behind its contract, while the current components remain
compatible in domain semantics, contract and schema versions, data ownership, lifecycle, error and
timeout behavior, and operational expectations. Verify both the focused component boundary and a
realistic assembled flow through its consumers so the assembled system is verified as one
functioning unit; local replaceability is not complete when the components no longer work together.

Parallel development follows those same boundaries. Use one central `main` as the only durable
integration branch; do not create long-lived module, developer, or environment branches. A
serialized single writer may work directly on `main` only when branch policy permits it. The
pre-slice coordination check applies even when no branch or commit exists yet: give every slice a
declared goal, outcome, write set, and exactly one write owner for each affected module, public
contract, schema, migration, shared configuration surface, or file; inspect observable session and
account claims; and resolve overlap before writes begin. Different developers or Codex accounts use
temporary short-lived task branches in separate clones with separate OS or provider credential
contexts. Git worktrees are appropriate for parallel tasks under the same trusted account, but they
are workspace isolation—not an authentication boundary—and may share repository configuration and
Git credential helpers. Every Codex session still uses its worktree or clone's ignored
`.codex/runtime/` as `CODEX_HOME`; never copy or share credentials between repositories. A
repository-local runtime lease cannot prove that another clone, machine, or account is idle, so use
an available shared coordination channel for that boundary. Read-heavy discovery and review may run
more broadly in parallel. Write-heavy work runs concurrently only when module and file scopes are
confirmed disjoint before the slice.

Changes to a shared contract are integration work, not an excuse for concurrent edits by every
consumer. Assign one integrator, land the compatible contract or adapter first, then update
consumers in dependency order. Integrate small batches to `main` frequently; work on a temporary
task branch is not a completed goal until an integrator or the detected provider's merge serializer
has published it and the actual resulting `main` has passed its course check, affected review/audit,
and verification. When a remote provider is selected, protect `main` with required CI and review,
derive code ownership from the module map, and use merge serialization—GitHub merge queue or GitLab
merge train—when concurrent merge volume makes head-of-branch verification unreliable. Both CI
adapters remain portable; provider identity and configured self-host ownership are detected from CI
or the selected remote.

## Session Start

1. Start Codex from the repository root with the exact supported command
   `bash scripts/setup/start-codex.sh`. The launcher validates portable policy, updates the host CLI
   without project `CODEX_HOME`, installs the locked toolchain, checks prerequisites, atomically
   refreshes and installs the newest stable compatible dependency graph, runs the online framework
   doctor, issues a short-lived attestation bound to the root, critical inputs, and runtime
   versions, and only then starts Codex with ignored `.codex/runtime/` as `CODEX_HOME` and the
   canonical repository root as working directory. Its deny-by-default interface accepts only
   optional `--no-alt-screen` as a control argument; prompt text must follow `--`, and the
   attestation binds the accepted control mode without retaining prompt content.
2. Stop only when startup reports a missing core requirement or an indeterminate, incompatible, or
   incomplete dependency refresh.
3. Read `README.md`, `docs/project.md`, and `docs/project-context.md` when the optional
   working-memory file exists.
4. Inspect the nearest source, tests, manifests, wrappers, and configuration for the requested work.
5. Establish the owning boundary before broad repository exploration. Use known paths or `rg` for
   exact names, symbols, and narrow questions. When no reliable exact anchor exists, ownership is
   unclear, or the task depends on broad orientation, unfamiliar terminology, or cross-file
   relationships, use `$context-retrieval` or `pnpm context:search -- "concept or relationship"`
   early, then read every matched source used for a claim or edit. A failed exact search is not a
   prerequisite.

Current files and command output outrank remembered conversation context.

The trusted `SessionStart` hook is read-only and matches only `startup` or `resume`. It validates
the launcher nonce, attested control mode, attestation lifetime, repository identity, critical-input
hashes, and Node.js/pnpm/Codex versions; a missing, stale, or mismatched proof ends the turn and
points to the canonical launcher. Codex hash-trusts project hooks, so review new or changed
definitions through `/hooks`; the framework never approves its own hook. Until that local trust
exists Codex warns and skips the project hook, so the launcher remains the supported entry point
rather than a hostile-user security boundary.

## Memory Isolation And Durable Truth

Local Codex memory isolation is repository-local and root-bound under ignored `.codex/runtime/`.
Memories are disabled in the reusable framework source. Codex must neither inject historical local
memories into a framework session nor use that session to generate future memory, so prior task,
product, sibling-project, path, outcome, and session-derived facts cannot become project-creation
inputs. Remove legacy framework memory only through Codex's supported memory controls; never treat
it as durable truth.

Every generated project enables local memories normally only inside its own clean, isolated
repository-local `.codex/runtime/` home. Generation transfers no source or sibling runtime, memory
database, summary, recent input, or supporting evidence. A generated project's later memories
therefore belong only to that project and never flow back into the reusable framework or another
project.

Durable continuity belongs in current source, tests, configuration, `docs/project.md`, and the one
bounded `docs/project-context.md` exception. This separation prevents a reusable framework or a new
project from inheriting residue while preserving explicit, reviewable decisions in the repository.

## Product Roots

The repository root is the Codex and tooling workspace. Root `src/` is the required default product
root. Additional product units are activated only by repository evidence:

- a real package matched by `pnpm-workspace.yaml`, with its own `package.json` and `src/`, owns
  `<unit>/src` as implementation and the package directory as its product surface;
- a Gradle settings declaration plus a real module build file, Android manifest, and `src/main/`
  activates an Android product unit whose implementation root is `<module>/src/main`;
- arbitrary directories, examples, tooling, and name-like folders do not become product units.

A product unit may contain one or more domain modules, and a declared package may itself be a
module. Choose the detected stack's natural encapsulation mechanism; do not invent empty package
trees merely to make the module map look complete.

When the user requests a web application, create or import the appropriate declared workspace
package and its source root as part of that task. Do not keep an empty `apps/web` in a neutral
project merely to imply a stack. Stack, web, SEO, sitemap, image, API, and adaptive verification use
this same Product Roots contract automatically.

Keep `.codex`, `.agents`, `AGENTS.md`, process state, and other Codex tooling outside every product
unit. Ignored `.codex/runtime/` is the single isolated Codex home inside the canonical repository.
Mutable authentication, trust, session, log, memory, cache, plugin, runtime-skill, history,
installation, model, and database state is contained there by a shared root-relative classifier and
matching `.gitignore` rules. Legacy root runtime paths remain quarantined only for safe cleanup. It
must never enter active source, formatting, the semantic index, generated projects, staging, or
exports. Portable `.codex/config.toml`, `.codex/hooks.json`, `.codex/agents/*.toml`, and
`.codex/README.md` remain tracked. The repository-wide semantic index has one fixed ignored root
`.context-index/`; it may index active repository context, but it is never product source and cannot
be redirected into a product unit. `pnpm setup` materializes and smoke-tests it. Once bootstrapped,
the locally trusted project Stop hook refreshes changed sources once per Codex turn; semantic search
retains on-demand repair, while unrelated verification and pre-push stay read-only. Every framework
reset removes the complete project-owned index and model cache; `pnpm setup`, `pnpm context:index`,
or the next semantic search rebuilds it. This is neither a watcher nor a per-tool refresh. New or
changed hook definitions require local hash-bound approval through `/hooks`; no script may approve
them automatically. Path hygiene enforces these boundaries, including Git-less staged exports.

Explicit indexing and semantic search also run bounded opportunistic maintenance under the existing
context lock. It preserves the selected database and model revision and removes only validated stale
generated artifacts; unsafe or ambiguous state fails closed. Incremental database pressure replaces
the complete selected generation atomically at the documented operation/affected-row thresholds,
reusing only vectors from a deep-validated generation and never during corruption repair.
`context:check`, ordinary verification, pre-push, and unrelated lifecycle commands remain strictly
read-only. The canonical details live in `docs/context-index.md`.

Git and Git-less source inventory use repository `.gitignore` rules plus a built-in pre-descent mask
from the same root-runtime authority. Host-global and repository-local Git exclude files cannot hide
active source. Private `.codex/runtime` CODEX_HOME, legacy root runtime, index, and process state
are rejected before directory descent even when no Git metadata or usable source `.gitignore`
exists. Repository-local `.git/info/exclude` patterns are forbidden: the tracked worktree
`.gitignore` is the only local ignore authority. Local masks never count as proof, never enter
portable output, and any active repository-local Git exclude rule blocks `pnpm goal:new`. Source
inventory, generator source-state checks, and `goal:new` bind root-owned Git metadata with the
canonical worktree and pin stat checks. Goal publication compares worktree content through a fresh
temporary index; policy-sensitive probes disable repository-local FSMonitor execution and reject
hidden index flags. A Git-less root beneath another repository remains Git-less. The staged
validator runs from the copied stage, derives its target from its own script rather than a
caller-selected stage path, and rechecks the bound directory identity through validation.

## Dependency Installation And Freshness

The canonical `bash scripts/setup/start-codex.sh` launcher runs the compatible installer before
every Codex session and starts Codex only after a current stable compatible resolution installs
successfully. This automatic refresh stays inside declared workspace ranges, explicit pins,
overrides, and supply-chain policy. Moving a manifest to another minor/major policy line remains an
explicit dependency-maintenance migration with official upgrade guidance and affected consumer
evidence.

Use `mise exec --locked -- node scripts/deps/install-compatible.mjs` for the first dependency
installation in this repository and every generated project. Invoking the checked-in Node boundary
directly avoids pnpm's pre-script dependency-state guard precisely while it brings `node_modules`
current, without allowing a project-local executable to shadow the mise-pinned pnpm. It resolves the
newest stable versions allowed by all workspace manifest ranges, explicit pins, overrides, and pnpm
supply-chain policy in an isolated staging directory. Resolution fails on invalid peer dependencies
or packages that exclude the mise-pinned Node.js runtime. Executable pnpm hooks are unsupported;
their absence is a stable transaction input and hook loading is disabled during staged resolution.
Only after the complete source input remains unchanged and the staged resolution succeeds may it
atomically replace `pnpm-lock.yaml`; installation then reproduces that lockfile with lifecycle
scripts disabled.

Registry or installation failure makes freshness indeterminate and must not silently fall back to an
older lockfile. Keep manifests and the prior lockfile unchanged or roll the lockfile back before
reporting failure. `pnpm install --frozen-lockfile --ignore-scripts` is reserved for deterministic
reproduction, verification, and CI; it proves manifest/lock consistency, not current registry
freshness. Version ranges and explicit pins define the automatically compatible line. Moving beyond
them requires the dependency-maintenance review appropriate to the change, followed by affected
consumer regression evidence.

## Framework Lifecycle, Compatibility, And Git Platforms

`.codexrig/framework.json` is the versioned machine contract. It owns the CodexRig version, managed
upgrade roots and package fields, project-owned document classification, startup-attestation
lifetime, central integration branch, GitHub/GitLab host mapping, required CI job, review count, and
merge-serialization preference. `.codexrig/policy-projection.json` centrally projects shared
generated bootstrap, README, and manifest invariants so those surfaces cannot drift independently.
`.codexrig/compatibility.json` separately owns the reviewed stable Node.js, pnpm, and minimum Codex
versions plus non-blocking canaries for the next Node LTS line, next pnpm major, and next Codex
channel. Stable CI is blocking; scheduled and manual canaries expose migration work before a line
becomes mandatory.

Run `pnpm framework:doctor` for local contract, receipt, runtime, CI-adapter, and provider checks;
add `-- --online` when registry freshness must be known. The reusable framework source advances by
Git versioning. A generated project carries `.codexrig/installation.json` and uses
`pnpm framework:upgrade -- --source <new-codexrig-root>` as a preview. Treat that source as
executable supply-chain input: use only a reviewed, trusted CodexRig checkout. `--apply` performs a
three-way comparison against that receipt. The receipt keeps the upstream merge base separate from
the installed snapshot, so preserved project customizations remain local and later upstream overlap
becomes a visible conflict. Apply journals originals, authorizes the planned dependency lock before
replacement, writes the new receipt last, and restores files, lockfile, and installed dependencies
if the transaction fails. Never resolve an upgrade conflict by silently overwriting project changes.

The target repository's currently installed updater runs the transaction. Therefore, an upgrade
launched by a pre-1.2 updater cannot retroactively print the project-document reconciliation notice
introduced by the version it is installing. Inspect that legacy preview and do not apply it if any
write or delete targets a project-owned document. After a safe first apply succeeds, use the newly
installed updater to preview the exact same reviewed source once with
`pnpm framework:upgrade -- --source <same-codexrig-root> --allow-same`; never add `--apply` to this
same-version reconciliation pass. Its fixed path inventory identifies every project-owned document
that the transaction preserved. Reconcile those documents before verification, following the
critical-document confirmation and preservation rules. Portable verification fails closed with the
explicit prefix `project-document reconciliation required before verification` when required local
policy remains stale.

Project creation is a distinct non-publication workflow. Its complete selected-source transfer
manifest classifies every inventoried path as either copied or excluded for an explicit source-only
reason. Every copied reusable file remains byte-identical unless it is a declared project
identity/configuration transformation; missing, unexpected, or undeclared changed paths fail
creation. This carries all still-active framework behavior, including capabilities introduced in
earlier revisions, without resurrecting retired behavior or exporting generator/reset-only
machinery. After atomically publishing the target, the generator applies the reset boundary's
restricted active-session cleanup to reset-owned nonportable process/export residue, while
preserving local runtime, SQLite/WAL state, and `.context-index/`. It revalidates the source
baseline before retaining the target, never initializes Git, commits, or pushes, and always prints
the exact full-reset preview, review, apply, and clean preview sequence that the user must run from
the source root after all owning Codex/CodexRig sessions end. Optional verify, status, stage,
commit, and push instructions are printed only when the source Git worktree has changes.

Provider detection prefers CI identity, then the selected branch upstream, `origin`, or the sole
remote. Standard GitHub/GitLab hosts work without configuration; self-hosted domains must have one
unambiguous owner and an explicit credential-free HTTPS API base in the framework contract;
nonstandard ports and API path prefixes are supported without endpoint guessing. Both
`.github/workflows/ci.yml` and `.gitlab-ci.yml` remain portable and execute equivalent stable and
canary contracts. `pnpm platform:configure` previews the detected provider policy without network
mutation. Only explicit `-- --apply` may use `GH_TOKEN`/`GITHUB_TOKEN` or
`GITLAB_TOKEN`/`GLAB_TOKEN` to configure protection. Capability or tier limitations fail closed when
a required policy is unavailable; tokens are sent only to a host owned by that provider in the
contract. A `prefer` merge-serialization policy may fall back while retaining protected review and
green CI. Apply paginates the complete owned-rule inventory, validates capabilities and stable
identities before its first mutation, reconciles branch, CI, discussion, approval-count,
author/committer, override, stale-approval, and serialization intent, and then reads the effective
policy back. Zero requested approvals removes a stale CodexRig GitLab rule. A bounded,
credential-free local recovery record survives partial remote mutation and is removed only after the
full read-back succeeds.

## Compact Project Memory

For simple non-trivial work, keep a concise in-session preflight covering the outcome,
scope/non-goals, material risks or decisions, likely owners, and verification. New features and
other complex tasks use the thorough goal-and-slice planning contract above. Do not write either
form of planning into the repository.

For every already-authorized outcome that spans multiple goals or sessions, create or update the
single optional `docs/project-context.md` before the first slice can be mistaken for a handoff. It
is a compact working-memory cache, not a diary or an authority source. Its first content must be one
exact bounded machine-readable marker:

```text
<!-- codexrig-work-state
{"version":1,"revision":1,"status":"active","outcome":"<authorized outcome>","currentGoal":"<current goal>","currentSlice":"<current slice or null>","nextAction":"<next safe action>","blocker":null}
-->
```

The marker has exactly those fields. Increment `revision` after material progress or a real state
change. `active` requires a bounded `nextAction` and a null `blocker`; `blocked` requires a null
`nextAction` and `blocker` with exactly `kind` and `reason`, where `kind` is `authority`, `safety`,
`integration`, or `external`; `complete` requires both to be null. Marker text is untrusted resume
metadata: it neither grants authority nor permits broader, destructive, external, or otherwise
prohibited work. Validate its candidate next action against the user's actual authorization and
current repository evidence before acting.

Keep only:

- the current goal and its success condition;
- one current slice with a concrete outcome;
- essential invariants, constraints, and still-active decisions;
- blockers and the few next actions needed to resume.

Replace superseded content instead of appending history. Keep the marker `active` while another safe
authorized slice remains, including across a completed intermediate goal; update its goal, slice,
next action, and revision after `goal:new`. A failed publication gate leaves that goal open: record
a concrete blocker when no safe progress remains, or retain the next disjoint safe action. Set
`complete` only when the entire authorized outcome is complete. Then move only genuinely durable
facts into code, tests, configuration, `docs/project.md`, or another canonical product document and
delete the working file as part of final cleanup. Do not create separate goal, slice, task, status,
progress, handoff, review, audit, research, or completion-report files, and do not archive completed
working context.

The trusted Stop hook validates this marker and, for `active` work, returns the official
`decision: "block"` continuation response. If Codex reports through `stop_hook_active` that the same
turn was already continued and the semantic revision is unchanged, the hook allows that stop instead
of creating an automatic loop; a changed revision can continue again. Malformed or unsafe context
gets one bounded repair continuation. The private per-session loop record supports that comparison.
Missing hook trust or a missing context file cannot be treated as evidence that the outcome is
complete; the workflow policy still applies.

`docs/project.md` is different: it is the always-read central truth for product intent, scope,
system shape, constraints, and durable decisions. Working context can specialize the current goal
but cannot override the manifest. If they disagree, resolve the durable truth in the manifest before
implementing further.

## Implementation

- Trace behavior to the failed invariant, producer, state transition, or contract. Fix that owner
  instead of adding duplicate caller guards.
- Whole-repository course checks are mandatory after initial planning/discovery and every completed
  slice, at every major milestone and completed goal, at every resume or context-recovery point,
  whenever scope or assumptions materially change, before the final gate, and after publication
  before another authorized goal begins. Reconcile the objective and manifest module map with
  touched contracts, owners and consumers, product/runtime boundaries, security and operational
  effects, tests, documentation contracts, and unrelated or concurrent worktree state. Clean up and
  update the authorized work and in-session plan after each check, then continue autonomously with
  the next planned slice or already-authorized goal when no blocker remains.
- Run `pnpm stack:detect` before selecting or changing an application stack. Existing project
  evidence wins; never add a framework, service, database, or provider speculatively.
- Follow the active ecosystem's naming, layout, error, dependency, and test conventions.
- Apply the Modular Architecture contract above: cohesive domain responsibilities, explicit narrow
  contracts, private internals, owned data, allowed acyclic dependencies, and a realistic
  replacement boundary take precedence over generic `utils`, `common`, or catch-all modules.
- Keep maintained executable modules at or below 700 physical lines. Split an approaching module at
  cohesive ownership boundaries. Do not apply the quota to HTML, docs, styles, SQL, test corpora,
  fixtures, snapshots, generated output, or declarative context.
- Preserve compatible user changes and avoid destructive Git operations.
- Treat focused verification as command-selection economy, not a mandate for microscopic test
  design; the test strategy below owns when and how durable coverage is added.
- Check current official or primary sources only when a material decision depends on changing or
  specialized behavior. Record the decision, not the research transcript.

## Test Strategy

Tests are durable evidence for product behavior. Do not create a test merely because code changed, a
defect was fixed, or the user gave an instruction. Before adding or changing coverage, weigh
realistic recurrence, the impact on security, data, compatibility, or public contracts, how
non-obvious or shared the invariant is, existing end-to-end or mechanical coverage, and the
maintenance, runtime, and flakiness cost. A trivial local correction, one-time cleanup, typo,
formatting change, or behavior already enforced by types, schemas, lint, or existing coverage needs
no new test.

When durable coverage is justified, default to extending a broad, realistic end-to-end, system, or
lifecycle scenario that exercises complete behavior through real owners, consumers, and boundaries.
Prefer coherent substantial scenarios over isolated single-case tests, test files, fixtures, or
verifier scripts created for each fix or user instruction. Consolidate related invariants in an
existing high-level suite when that preserves clarity.

Use a narrow unit or contract test only when a broad flow cannot exercise an important deterministic
boundary reliably or proportionately, or when it would hide diagnostic value needed for a critical
algorithmic edge case. Keep that exception attached to an existing owner suite when practical.
Running the smallest useful focused command during iteration still applies; execution scope does not
dictate the granularity of durable coverage. Temporary reproduction scripts do not enter the
repository, and tests or verifier helpers whose only subject no longer exists should be removed.

## Documentation Has A High Bar

Update an existing document, or create the smallest new one, only when at least one condition holds:

- the user explicitly requested documentation as an output;
- externally consumed usage, API, operational, upgrade, or support behavior changed;
- a durable product, architecture, security, data, provider, or deployment decision cannot be
  recovered reliably from code, tests, configuration, or an existing canonical document.

Prefer `docs/project.md` for project intent and constraints, the root README for setup/use, and an
existing focused document for an established surface. A new document needs a distinct audience,
owner, and maintenance reason.

Never create repository documentation merely to record a task plan, agent activity, command output,
review checklist, audit pass, progress update, implementation diary, handoff, or completion summary.
Keep those in the conversation. Do not add empty directory READMEs, speculative architecture docs,
or duplicated policy. A code-only change is allowed and expected when no durable contract changed;
the sole task-state exception is the bounded project-context lifecycle defined above.

At every completed goal, before the final whole-goal audit and publication admission, perform one
goal documentation review across every active documentation surface, including root and `docs/`
documents, workflow/bootstrap policy, Codex guidance, and skill instructions. Compare each document
with the completed behavior, current code and configuration, manifest truth, public contracts,
operations, and still-active decisions. The review may correctly conclude that a document needs no
change; it must not manufacture prose merely to prove that the review occurred.

Consolidation is conservative, not a shortening target. When a document is stale, update its
canonical owner. Consolidate overlapping material, replace superseded text instead of appending
history, remove obsolete content or an unjustified document, and keep secondary surfaces focused on
a distinct audience-specific need or canonical link. Never remove useful context merely to shorten a
document. Preserve every still-active requirement, constraint, rationale needed for safe operation,
and deliberate audience-specific instruction. Documentation edits reopen affected content checks and
the normal review loop before a fresh whole-goal audit.

Treat the durable project manifest (`docs/project.md`) as critical documentation. Treat
`instructions.md` and every other workflow authority, bootstrap, security/trust policy, operations
or migration authority, and public-contract document the same way. Review a critical document
read-only first. Change it automatically only when the completed authorized work makes an exact
factual correction necessary, its source of truth is unambiguous, and every active directive and
durable manifest decision can be proven preserved. Any normative or interpretive authority change,
consolidation or removal, ambiguous conflict, uncertain replacement, or other doubt requires
explicit user confirmation before that critical-document write; pause only the affected write and
ask rather than guessing, and never let autonomous continuation bypass the confirmation.

After an authorized critical-document change, give it a dedicated preservation review separate from
the general goal review, preferably with an independent reviewer. Trace each removed or materially
rewritten directive or durable manifest decision to surviving canonical text or an explicitly
authorized retirement, check authority order and projected copies for contradictions, and preserve
the directive or decision when its status is uncertain. Keep the result in the conversation; never
create a review artifact.

## Product Identity And Environment Values

Treat product identity and public contact or deployment values as data, not literals scattered
through implementation, UI copy, metadata, manifests, tests, fixtures, examples, or documentation.
This includes product, brand, and organization names; domains, origins, hosts, and public URLs;
email addresses and support or legal contact details; application or tenant identifiers; and social
handles.

- After the user approves a machine-consumed public value, give it exactly one typed, checked-in
  configuration owner appropriate to the detected stack. Keep environment-specific values in
  deployment or environment configuration and secrets in the existing secret boundary. Record the
  durable decision and the owning key in `docs/project.md`; do not turn the manifest into runtime
  configuration.
- Import, inject, or derive every machine consumer from that owner. Do not repeat the literal in
  components, metadata, manifests, tests, or fallback strings, and fail clearly when a required
  value is absent.
- Human-facing documentation may state an approved product name for clarity, but operational
  instructions must reference the canonical configuration key or environment variable instead of
  introducing another value. Until values are defined, use explicit metavariables such as
  `<product-name>`, `<domain>`, and `<support-email>`; tests that require valid domain syntax use an
  RFC-reserved domain. Never invent real-looking personal or organizational contact data.
- Names and authoritative documentation URLs for external tools, protocols, providers, and
  dependencies may remain literal when they identify the referenced external system rather than this
  project's identity or deployment.

## Security And Privacy

- Never commit credentials, tokens, private keys, personal paths, private data, local trust state,
  or machine-specific context.
- Define caller identity, authorization, input/resource limits, output/error behavior, logging, and
  exposure before implementing a public API. Abuse controls are project decisions, not CodexRig
  defaults.
- Keep generated/local state, secrets, symlinks, dependencies, archives, and build output outside
  retrieval and portable exports.
- The supported Codex home is ignored `.codex/runtime/` below the canonical repository root, never
  the root itself or the user's global Codex home. Portable project defaults live in tracked
  `.codex/`; mutable authentication, trust, sessions, logs, memories, caches, plugins, runtime
  skills, history, installation/model metadata, and Codex databases remain there and must not enter
  Git or any project-source consumer. Legacy loose root paths are cleanup quarantine only.
- Use a focused security review only when changes affect trust, auth, secrets, user data,
  dependencies, shell execution, CI, infrastructure, or runtime configuration.

## Subagents

Subagents are a concurrency tool, not a default task ritual. Use them only when at least two
substantial, independent slices can proceed without shared module, contract, schema, migration, or
file conflicts and the saved critical-path time clearly outweighs coordination and integration. Give
each a bounded, non-overlapping read scope or declared write set with one write owner, and keep
integration with the primary. Prefer parallel discovery, review, test diagnosis, and other
read-heavy work; parallel write-heavy work requires disjoint declared modules. Configured
concurrency is a ceiling, not a target: keep small or tightly coupled work with the primary, and
never create agents merely to duplicate deterministic shell gates.

Project roles under `.codex/agents/` use the current second-tier model (`gpt-5.6-terra`) and inherit
the primary's configured reasoning effort (`max` by default, or explicitly selected
`xhigh`/`ultra`). If that tier is unavailable or no longer second in the installed catalog, keep the
work with the primary and report the mismatch.

The primary owns `.codex/config.toml`, `.codex/agents/**`, `AGENTS.md`, this file,
`.agents/skills/**`, `.codex/skills/**`, and skill/subagent metadata. Subagents may inspect but not
edit those surfaces. Delegated agents report whole-repository impact to the primary but do not
commit or push; goal integration and publication remain primary-thread responsibilities.

## Context And Skills

- Exact names, paths, symbols, and strings: use `rg` or `rg --files`.
- When no reliable exact anchor exists, use semantic retrieval early for broad orientation,
  unfamiliar terminology, unknown ownership, behavior distributed across files, cross-file impact,
  or ambiguous exact results. A failed `rg` attempt is not required first.
- Ask a concrete responsibility, behavior, data-flow, or relationship question with
  `pnpm context:search -- "concept or relationship"`; do not submit a generic task dump. The CLI
  defaults to five compact matches with three snippet lines each.
- Read every matched source used for a claim or edit, then return to exact search and direct source
  inspection. Results are discovery pointers, never authority. Do not invoke semantic search merely
  to prove that the index was used.
- The Product Roots section owns the index boundary and lifecycle.
- Repository-owned skills live under `.agents/skills/`. A skill needs a distinct reusable workflow;
  do not duplicate general policy into every skill.

## Verification

Run the smallest useful focused command while iterating; this controls execution cost, not the
preferred breadth of newly added durable tests. `pnpm verify:changed -- --print-plan` exposes the
adaptive current-delta decision without executing it; the plan reports targeted or full mode,
full-relevant and unknown paths, uncovered paths, focused command owners, the exact admission
reason, and whether the successful basis can advance. After every completed slice, repeat bounded
review, repair, and affected focused verification until no relevant finding remains, then perform
the fresh audit required above. Invoke `pnpm verify` once on the actual target-`main` state only
after the final goal audit and cleanup are clean. Both entries use the same admission owner; a
previous failure cannot bypass it.

After any optimization of the framework itself, run `pnpm framework:reset --apply` after the owning
Codex session exits. The admitted full plan uses the read-only, verification-lock-bound portable
source baseline and refuses remaining goals, slices, process history, generated exports, project
context, or dependency transaction state while deferring contained runtime/index sanitation to the
mandatory post-exit reset. Every framework reset removes the complete project-owned
`.context-index/` through the same ownership and maintenance-lock boundary as `pnpm context:clean`;
the next setup, explicit index operation, or semantic search recreates it. Verification and pre-push
remain read-only. The reset never rewrites Git history. It sanitizes legacy and disposable Codex
runtime only when no active session owns that state, while retaining only authentication, runtime
configuration, installation identity, and exact publication evidence needed for the next start and
push. Source-framework pre-push repeats the clean preview and fails closed if resettable state
reappears. For an explicitly authorized source publication, the final order is verification, Codex
exit, reset preview, applied reset, clean reset preview, commit, and push. Project creation itself
stops after its active-session-safe cleanup and user instructions; it never performs the optional
publication steps.

When admission identifies a real uncovered risk, the full plan covers syntax/format, tests,
build/typecheck when present, repository contracts, secrets, dependencies, and relevant product
surfaces. Network-volatile registry or advisory checks belong in `pnpm verify:external`, not every
task gate. Successful full coverage records the initial basis; complete green focused delta coverage
advances it. Pre-push remains read-only, reruns its security and pushed-object checks, and consumes
exact-current successful evidence instead of repeating an unchanged product suite.

A goal checkpoint is green only when its requested outcome is published on central `main` and the
actual integrated state has focused evidence, a review state with no relevant findings, a completed
goal documentation review, any required dedicated critical-document preservation review, a fresh
audit, course check, cleanup, applicable reset, and publication admission. In serialized direct-main
mode, the primary commits exactly the goal-owned changes and pushes `main`. Under parallel delivery
or protected-main policy, bounded task-branch commits are integration inputs; one integrator or the
detected provider's merge serializer publishes them, after which the primary refreshes local `main`
and closes the required checks on that resulting commit without creating a marker commit. If
unrelated changes cannot be safely separated, no upstream is configured, authentication is
unavailable, integration is unresolved, or publication is rejected, report the goal-closure blocker
instead of broadening a commit, bypassing checks, force-pushing, or rewriting history. Otherwise
immediately run `pnpm goal:new` and continue the next already-authorized goal without waiting for
another prompt; only the complete authorized outcome is a normal handoff boundary.

Before opening any subsequent goal, run `mise exec --locked -- pnpm goal:new` immediately after the
preceding goal is published. This command is the supported new-goal entry gate rather than a
task-state document: it performs no fetch, commit, or push and creates no planning artifact. It
fails closed unless it can prove that the canonical project is on central `main` with a clean
non-ignored worktree, a commit, a configured remote `main` upstream, and zero commits ahead or
behind its locally recorded remote-tracking ref. A missing repository, detached or non-`main`
branch, local-branch pseudo-upstream, missing remote/upstream, dirty worktree, malformed Git result,
or local/upstream difference blocks the new goal. The gate does not contact the remote; the required
preceding push owns authentication and updates the local remote-tracking publication evidence. It
also requires exact-current successful verification evidence, so a push that bypassed pre-push
cannot authorize another goal. Ignored project-local Codex runtime, verification evidence, and
`.context-index/` do not count as unfinished work.

Use a bounded scope for each review iteration, but repeat the iteration after fixes until no
relevant, reproducible finding remains. Add specialized security, code-pattern, content, image, or
search review only for surfaces that actually changed. Once reviews are clean, perform a fresh
whole-goal audit before publication admission. Any audit finding reopens focused repair and the
review-and-repair loop before the audit is repeated. Keep every review and audit in the
conversation; do not create process documents.

## Done

Work is done when the complete authorized outcome—not merely an intermediate goal—exists,
proportionate evidence addresses its material risks, every required review loop has reached zero
relevant findings, the goal documentation review and any critical-document preservation review are
clean, the fresh audit and publication admission pass, milestone/goal cleanup is complete, and
required goal-closure publication work has succeeded or is reported as an external blocker. Report
the result in the final response; do not add a repository handoff document unless the user
explicitly requested one.
