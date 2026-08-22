---
name: project-implementation
description:
  Implement, debug, refactor, or produce implementation-ready technical design with root-cause
  analysis, stack-aware conventions, evidence-backed decisions, proportionate end-to-end evidence,
  and whole-system handoff. Use for application, script, infrastructure, architecture, framework,
  migration, or performance work; not for a final review or dependency-only maintenance.
---

# Project Implementation

## Authority Mode

For an implementation/fix request, edit within the requested scope. For architecture, design,
explanation, or diagnosis requested without implementation, remain read-only and return evidence,
tradeoffs, and an implementation-ready recommendation; do not turn advice into repository changes.

## Preflight

In a generated project with a pending product definition—or whenever the request begins real product
definition—use the mandatory first-prompt Project Definition Intake in `instructions.md` before
implementation or architecture selection. Deliberately neutral source-framework maintenance does not
require an invented product. Explain the gate to the user, interview in focused successive rounds,
challenge ambiguity and contradictions, and continue until the intended users/outcome,
scope/non-goals, domain and candidate capability/module topology, data/integrations, trust
boundaries, operations, collaboration topology and any shared pre-slice coordination channel for
concurrent accounts, constraints, risks, and success evidence are precise. Present a final synthesis
for correction, write only user-confirmed durable truth into the manifest, keep its active inventory
limited to implemented roots, and put only explicitly confirmed deferred candidates in
`docs/future-modules.md`. Then proceed autonomously. Do not turn the intake into a fixed
questionnaire or repeat questions whose answers cannot change a decision. Resume the same intake
later when material ambiguity, contradictions, or changed intent, scope, module/public contracts,
data, integrations, trust, compatibility, or operations could alter the implementation. Pause only
affected writes, continue safe disjoint work, update user-confirmed durable truth, and then resume
autonomously.

For every new feature and every other complex task, complete the thorough planning contract in
`instructions.md` before implementation: define the authorized outcome and non-goals, material
decisions and unknowns, affected owners/consumers, ordered goals with success conditions, and
reviewable slices with risks and focused evidence. Review the plan until no relevant finding
remains, then perform its fresh audit. Keep the plan in the conversation and do not create a
planning document. Read the nearest package/build/test configuration and any directly relevant
project document that already exists. For complex multi-session work, update the single bounded
`docs/project-context.md` only when the repository workflow permits it; replace stale goal/slice
state instead of appending a log.

During a new product intake, determine the product surface as soon as users and workflows make it
meaningful and before stack selection. If unclear, ask promptly about usage context, devices,
installation/offline/distribution, OS/hardware/background capabilities, browser/public-link reach,
updates, and cross-device movement without requiring the user to name a platform. Strongly recommend
one web/PWA, mobile, desktop, CLI/TUI, API/service, worker, library/SDK, embedded/realtime, or
combined topology with at most one close alternative, then ask the user to confirm, override, or
delegate it. Record selected and integrated surface truth separately in the manifest. Give every
integrated web/PWA, mobile, desktop, CLI/TUI, API/service, worker, library/SDK, embedded, or
real-time surface its own interface directory or declared product package, entry/composition
boundary, platform adapters, and public client/contract where exposed. Never deep-import one surface
from another or share a generic `app` root; explicitly own genuinely common domain/application
contracts, view models, and presentation primitives while keeping platform lifecycle, navigation,
screens/routes, adapters, assets, and delivery entrypoints surface-local.

When implementation or a larger outcome is already authorized, a recap, research result, plan,
documentation gate, review, audit, definition synthesis, or readiness statement is an intermediate
commentary update followed by the next planned slice in the same run. Never end at "ready to
implement" when implementation is already authorized. A user's absence is not a pause; honor an
explicit approval pause and stop for a real authority, scope, safety, destructive-action,
integration, or external blocker. Persistence does not authorize expanded scope, bypassed controls,
new product goals, destructive action, or external mutation.

Establish likely owners before editing instead of guessing them. Use known paths or `rg` for exact
anchors. When no reliable exact anchor exists, ownership is unclear, or the change depends on
cross-file relationships, use `pnpm context:search -- "concept or relationship"` before broad
repository exploration, then read every matched source used for the implementation decision.

Use only the version-2 framework update contract. A child selects a reviewed source with
`pnpm framework:upgrade -- --source <framework-root>`; the reusable source selects a child with
`pnpm framework:upgrade -- --target <child-root>`. Preview first, then apply the same selection only
after reviewing managed operations, adopted identical files, conflicts, and changed policy IDs.
Managed capabilities update transactionally; project-owned documents never become blind copy
targets. Reconcile each listed policy concept into current local truth, preserve intentional child
adaptations, obtain user confirmation and a dedicated preservation review for uncertain critical
documents, then acknowledge the exact plan digest before verification. Do not add an alternate
same-version or compatibility path.

For non-trivial product work, establish the affected domain module before editing. Read the durable
module map in `docs/project.md`: responsibility/root, public contract and private internals, owned
data/migrations, allowed dependencies, focused verifier, and steward role or team when known. If it
needs an update, include that critical document in the declared slice write set and do not change it
until the pre-slice coordination and critical-document confirmation rules below are satisfied.
Declare the slice write set and one write owner for every affected module, public contract, schema,
migration, shared configuration, and file. Product Roots alone do not establish domain boundaries.

Before choosing files for every authorized feature, automatically decide whether its domain language
and invariants, data/lifecycle ownership, public contracts, trust/operations, change reason, and
dependencies fit an existing module, require a new module in an existing domain, or establish a new
domain and its first module. Give every non-trivial behavior exactly one active module owner.
UI/web, Identity and Access, public API, infrastructure/delivery, and composition may adapt or
compose that behavior but do not silently own it. Never fall back to an unclassified Product Root or
generic `app`, `service`, `shared`, `common`, `utils`, `platform`, or `core`; invoke
`$architecture-evolution` and ask one focused question when the material placement remains
ambiguous.

Before architecture-dependent writes for a material product, domain, system-shape, ownership,
dependency, UI/web, Identity and Access, public API, infrastructure, or repository-layout change,
invoke `$architecture-evolution`. Keep domain/application, UI/presentation, web, Identity and
Access, public API contract, public API transport, runtime adapter, and infrastructure/delivery
roots physically separate. Every web/PWA, mobile, desktop, CLI/TUI, API/service, worker,
library/SDK, embedded, and real-time implementation has an independent interface root or declared
package and never deep-imports another surface; shared domain/application contracts, view models,
and visual primitives use explicit shared owners. Within each UI root, also separate
views/components, presentation state and navigation, transport/API clients, and domain behavior; do
not let a design system own product workflow or data access. Within Identity and Access, separate
authentication/credentials, authorization/policy, principal/account lifecycle and user management,
sessions/tokens, audit/persistence, and provider adapters behind narrow public ports.
UI/web/API/domain/infra may consume those ports but never own provider SDKs, credentials, grants, or
session internals. Every material Auth change requires `$security-review` after implementation.
Treat every generated product as white-label: use `config/product.json` as the initial replaceable
owner for public identity, brand, public endpoints/contacts, and application IDs without treating
the repository name as a public fallback. Give every other setting a typed stack-native owner at its
module or composition boundary and explicit environment overlays rather than scattered literals or
ambient environment reads, keep secrets separate, and never expose CodexRig identity in
product-facing runtime, UI, assets, metadata, or deployment output. Keep the generated child's
`config/delivery.json` as the separate project-owned inventory for the Dev default,
developer-declared external environments, and repository-detected delivery evidence; do not treat
the default as proof of a deployment or use this inventory as provider configuration.

Assume mobile, tablet, and desktop for every UI unless the user confirms narrower scope. For web,
implement one content-driven responsive architecture across narrow/medium/wide viewports with
feature parity, fluid/container layout, touch/pointer/keyboard/assistive input, zoom/text reflow,
orientation/safe-area/dynamic viewport behavior, responsive media, and constrained-device budgets.
Do not branch on user-agent/device dimensions, hide root overflow, freeze desktop widths/`100vh`,
depend on hover, or clone domain flows per device. Keep responsive presentation concerns separate
and add representative viewport/input/zoom/loading/error evidence to the UI module's broad flow; in
Dev run it isolated in parallel or after the newest deploy. Surface-quality and housekeeping own the
portable responsive guard; `scripts/verify/path-hygiene.mjs` owns physical surface roots,
platform-SDK locality, UI concern separation, and cross-surface import isolation.

Keep source code, identifiers, filenames, tests, and technical source/declaration headers English.
Before the first product slice, resolve project-owned `config/localization.json`: confirm whether
user-facing surfaces are single- or multi-locale and record default, supported, and fallback locales
plus material formatting/content ownership in manifest truth. Do not infer user-facing English from
the source language, duplicate domain behavior by locale, or implement against `pending`. Run
`pnpm localization:check`; route changed user-facing copy through `$native-language-content-review`.

Keep every generated product tenant-capable. `config/tenancy.json` is project-owned and may remain
pending only before product implementation; the first product slice chooses trusted context sources
and creates separate tenancy context/resolution, policy/isolation, and public-port concerns.
Authorize principal, tenant membership, action, and resource together. Propagate immutable tenant
context through module contracts, repositories/data/uniqueness/migrations, cache/files/search,
messages/jobs, quotas, observability, integrations, and onboarding/offboarding. A caller tenant ID,
ambient mutable context, implicit default, or successful authentication is not isolation. Every
active module records its current tenant isolation and any separately owned global/control-plane
exception, and its broad lifecycle verifier proves tenant A cannot observe or affect tenant B.
Material tenancy work invokes `$architecture-evolution` and `$security-review`; run
`pnpm tenancy:check`, which completed-goal and scheduled housekeeping also own.

Immediately before every slice begins, and again before its declared scope expands, perform the
pre-slice coordination check from `instructions.md`. Restate the goal, slice outcome, success
condition, write set, and owners; inspect all observable live-agent assignments, sessions,
same-clone worktrees, safe latest-session markers, bounded context, and shared team or orchestration
channels before relying on Git; and compare current goal and slice claims. One host represents one
developer, so Codex accounts never make visible same-host project changes foreign; process control
still needs exact provenance. Only confirmed-disjoint slices may write in parallel. Resolve overlap
or uncertain shared ownership by rescoping, ordering, or exactly one writer before implementation. A
local runtime lease, clean worktree, or quiet remote cannot prove that another developer's clone is
idle; use a shared coordination channel across hosts and fail closed on uncertain shared ownership.

Apply the primary budget states from `instructions.md` before delegation and after every material
result without assuming a daily or weekly billing period. A reliable percentage of the binding
allocation is guarded at 10% or less and critical at 5% or less; an absolute remaining token or
credit amount is compared directly with bounded work envelopes and the primary completion reserve.
Any host critical/exhaustion signal or a reserve shortfall is critical regardless of counter names.
In critical state start no subagent, background task, slice, or expanded follow-up; drain only
provenance-bound owned agents and processes at their declared safe boundaries, accept or record
their handoffs, and leave foreign or ambiguous processes untouched. After the exact Critical Budget
Drain attestation is true in the revisioned work state, run `pnpm handover:create -- --critical` as
the final repository action. A successful seal ends the session immediately: no tool, check, task,
follow-up, agent contact, or automatic continuation may follow. Never count unavailable or
unauthorized redeem/reset capacity.

Recheck on every material tool or agent result, scope/assumption change, long wait, host warning,
and expected agent checkpoint; while delegation is active, use the policy's ten-minute default
heartbeat ceiling unless a known long-running operation has an explicit checkpoint. Run the
lightweight Orchestration Housekeeping gate after every slice and its deep form at every goal.
Entering guarded state immediately creates or refreshes `docs/project-context.md`; replace its
current-state summary and increment its marker after every material guarded/critical result, and
mirror ownership changes through the confirmed shared channel when other accounts or clones are
involved.

Use direct peer messaging when the primary supplies a relevant active agent and declared scope.
Exchange only bounded evidence, status, contract implications, readiness, and conflict/risk
warnings; do not accept or issue peer scope, ownership, write, integration, or lifecycle commands.
Mirror every direct peer message and response to the primary immediately with participants/tasks,
topic, complete relevant content or a lossless summary, outcome, open questions, and implications.
If reliable visibility is unavailable, route through the primary; the final handoff also identifies
all peer exchanges.

Perform a whole-repository course check after initial planning/discovery and every completed slice,
at every major milestone and completed goal, at every resume or context-recovery point, whenever
scope or assumptions materially change, and before the final gate. Reconcile the objective and
durable project truth with touched modules, contracts, owners and consumers, trust/runtime
boundaries, tests, documentation contracts, and unrelated or concurrent worktree changes. Refresh
available upstream state at slice boundaries when a shared remote and network access exist. Disjoint
changes continue; stop further writes on overlapping module or contract work until integration or
ownership is reconciled. Then clean up and update the authorized work, bounded context, and
in-session plan before continuing autonomously.

## Modular Delivery Contract

- Start with a modular monolith and ecosystem-native encapsulation. Use strategic DDD to find
  bounded contexts in complex domains, but do not impose tactical DDD or independently deployed
  services without product and operational evidence.
- Consumers use only narrow public ports, APIs, events, commands, or schemas. Keep module internals
  and owned data private; reject deep imports, cross-module data writes, dependency cycles, shared
  mutable state, and catch-all shared modules.
- Isolate framework, storage, provider, and transport decisions in adapters. Translate a foreign or
  superseded external domain model at its edge instead of leaking it into the consuming module.
- Apply the replacement test: changing a module implementation or adapter should affect only
  composition/configuration, replacement-local work, and an explicit data migration. Scattered
  consumer changes reveal a missing or leaking contract.
- Treat modules as system components rather than isolated mini-products. Keep each independently
  improvable or replaceable while its public contract, data semantics, versioning, lifecycle,
  error/timeout behavior, and operational expectations remain compatible with current consumers.
  Verify the focused boundary and a realistic assembled flow so the assembled system is verified as
  one functioning unit; a locally clean component is not done when its consumers no longer work.
- Keep one central `main` as the only durable integration branch; do not create long-lived module or
  developer branches. Git persists/transports work and never isolates writers. A serialized writer
  may use `main` directly when branch policy permits. Parallel read-heavy work may span modules. One
  host represents one developer: independent same-host sessions use separate one-lease worktrees
  with shared read visibility regardless of Codex account; different developers/hosts use temporary
  task branches in separate clones and credential contexts. Before each slice, coordinate goal and
  slice claims without waiting for Git evidence. Concurrent writes need confirmed-disjoint declared
  write sets and exactly one writer per module or shared contract. Give a shared contract change one
  integrator; migrate the contract, owned state, and consumers within one coherent integration, and
  remove superseded behavior before it becomes a stable dependency. For host-loss recovery or
  transfer, the primary commits and pushes each coherent resumable slice through the declared
  integration path: directly on `main` for serialized work when branch policy permits, otherwise
  through the short-lived task branch or protected path. Existing gates remain mandatory; this is
  not a WIP/checkpoint workflow, and later uncommitted bytes remain host-local. A task branch is
  only bounded recovery/integration input; close the goal after the actual published `main` passes
  its course check, affected review/audit, and verification.

## Workflow

1. Trace the behavior to its owning domain module, public contract, data/state transition, or
   workflow. Fix the producer/invariant rather than scattering caller guards, and preserve the
   module's replacement boundary.
2. Detect the existing stack before framework-specific work:

   ```bash
   pnpm stack:detect
   ```

   In an existing product, follow evidenced language, framework, naming, error, dependency, and test
   conventions unless confirmed requirements reopen the architecture. In a new generated product, no
   detected product stack is the correct initial result: the root Node.js/pnpm/mise harness is not
   product evidence. Select each module's language/framework/runtime only after manifest and domain
   placement, using platform/ecosystem, hard/soft real-time latency/jitter, throughput/resources,
   safety/FFI, data/trust/tenancy, team/tooling, deployment/operations, and maintainability
   evidence. Explicitly evaluate Rust and, where deterministic native/hardware/ABI constraints
   justify its safety cost, C/C++ for real-time/system components. Measure consequential claims.
   Polyglot use requires a real module/deployment boundary, narrow versioned contracts, and benefit
   beyond the extra toolchain cost. Record actual integrated choices in the module's
   `Runtime and technology` manifest field; do not add a framework speculatively. Once intake facts
   make selection meaningful, use current primary/official evidence to give one strong primary
   recommendation per distinct runtime component, explain its manifest-specific fit, cost, risk, and
   at most one close alternative, then explicitly ask the user to confirm, override, or delegate the
   final choice before implementation. Silence and YOLO are not stack confirmation.

   Follow the repository's Product Roots contract: root `src/` is the default implementation root; a
   real declared pnpm package activates `<unit>/src`; an evidenced Android Gradle module activates
   `<module>/src/main`. Arbitrary folders do not activate product behavior. When the user requests a
   web application, create or import the declared workspace package and its `src/` as part of that
   task instead of pre-creating an empty `apps/web`. Keep repo-wide vector state at root
   `.context-index/`, outside every product unit. Project setup is not complete until that vector
   space has been materialized and smoke-tested. Semantic search repairs stale or invalid index
   state on demand, while explicit `context:index` owns proactive refresh. The preloaded Stop
   lifecycle never imports mutable index code; ephemeral side conversations and other transcriptless
   contexts exit before work-state access. Normal verification and pre-push remain read-only.

3. When research or publications inform the work, search for and prioritize the newest relevant
   primary or official sources. Verify publication/update date, version, correction/retraction
   state, and applicability; distinguish evidence from inference and label preliminary evidence. Use
   older sources primarily for comparison or historical context. Treat an older foundational or
   controlling source as current authority only with an explicit reason and confirmation that newer
   evidence has not superseded it. Record the decision and tradeoff, not a research transcript.
4. Run the pre-slice coordination check against every observable session/account claim and the
   declared goal, slice, module/contract/data/file write set. Do not begin or expand writes until
   overlapping or uncertain shared ownership has one explicit owner and order.
5. Implement the largest coherent, currently unblocked slice supported by the decision-ready plan.
   Stay inside its declared module/write set, preserve unrelated compatible edits, and avoid generic
   catch-all modules or speculative abstractions. Keep planning and review detail tied to decisions,
   risks, findings, and evidence instead of accumulating status prose.
6. Keep maintained executable modules at or below 700 physical lines. Split an approaching module at
   cohesive ownership boundaries. Do not apply the quota to declarative/context, generated,
   test-corpus, fixture, snapshot, documentation, or style files. Every new hand-authored textual
   file also receives a format-native purpose and owning-boundary header, and every class or
   non-trivial public type receives declaration-adjacent responsibility and contract/invariant
   documentation. Update those descriptions with any rename, ownership, trust-boundary, or contract
   change; preserve shebangs, licenses, directives, and schema rules.
7. Apply the risk-based Test Strategy in `instructions.md`: a fix or user instruction does not
   automatically need a test. When coverage is justified, default to extending a broad, realistic
   end-to-end, system, or lifecycle scenario through real boundaries; do not create an isolated
   one-off test or verifier file. Use narrow unit or contract coverage only when the broad flow
   cannot exercise critical deterministic behavior reliably or proportionately. Update documentation
   only when an externally consumed or durable project contract changed. The optional compact
   project-context cache is the sole task-state exception; never create per-task notes or archives.
8. After every completed slice, run focused owner and consumer evidence. For every non-trivial
   implementation, architecture, configuration-boundary, or integration slice, invoke
   `$system-coherence`: trace a representative assembled flow, compare the change with current
   manifest/module ownership and real consumers, search for competing implementations and semantic
   duplication, and repair material contract, dependency, data, configuration, layout, or
   integration drift at the owner. A trivial isolated slice records why the workflow is not
   applicable. In Dev, keep the latest developer deploy ahead of this lane and run it in parallel or
   immediately afterward, while requiring a clean result before slice acceptance or promotion. Then
   review correctness, acceptance criteria, regressions, maintainability, applicable trust risks,
   documentation drift, and whole-system impact. Fix relevant reproducible findings, rerun affected
   focused evidence, and repeat until no relevant finding remains. From that clean state perform a
   fresh audit against the plan, goal, manifest, touched boundaries, and repository state; an audit
   finding reopens repair, review-and-repair loop, and re-audit. From the clean audit, perform the
   slice-boundary course check against current repository and available upstream changes; integrate
   overlapping module or contract work and rerun only affected evidence before continuing.
9. At each major milestone and completed goal, repeat the whole-repository course check, account for
   every downstream consumer and changed contract, remove obsolete temporary or dead work within
   scope, and reconcile code, tests, configuration, docs, bounded context, and the in-session plan.
   Any repository edit in this step reopens affected evidence and review before a new audit. At a
   completed goal, the primary runs `pnpm repo:housekeeping -- --apply` after mutating cleanup; it
   reconciles only unambiguous repository facts and runs consolidated health checks without any
   deploy, commit, push, or external mutation. Resolve ambiguous environment evidence with the
   developer and rerun idempotently. Immediately before that command, the primary performs the
   host-session portion of housekeeping: inventory live agents, preserve or accept handoffs,
   actively close completed/unneeded agents, interrupt stale or redundant agents, and notify
   affected remaining agents about accepted results, changed contracts/assumptions, remaining work,
   and released ownership/slots. Then inventory every active documentation surface before the final
   whole-goal audit. Update only stale material; consolidate or remove superseded duplication
   instead of appending history; and preserve active directives. Consolidation is not a shortening
   target. Treat the durable project manifest as critical documentation. Inspect it and every other
   critical authority read-only first; change one automatically only when the factual correction and
   full preservation are unambiguous; otherwise obtain explicit user confirmation before writing.
   Give every authorized critical-document change a dedicated preservation review. Documentation
   findings reopen affected checks and review before the fresh audit. Continue autonomously with the
   next planned slice or already-authorized goal when the check is clean and scope remains
   authorized.
10. Run focused owner commands during iteration without treating execution scope as a reason to
    design microscopic tests. Inspect adaptive changed-path admission after the coherent slice and
    leave publication admission to the single final workflow after repository-mutating cleanup, the
    goal documentation and critical-document gates, and the clean goal audit; a prior failure never
    authorizes a broad restart.

## Completion

Report the outcome, changed boundaries, verification, clean review result, fresh audit, material
tradeoffs, and residual risks in the final response. Use `$task-quality` at the completion of every
planned new-feature or complex-task slice and goal, including push preparation and elevated-risk
closure. A goal cannot close until its all-document currency review and any critical-document
preservation review are clean. A green goal checkpoint is not a handoff while another goal in the
same authorized outcome remains: publish it, run `pnpm goal:new`, perform the next slice's pre-slice
coordination check, and continue without waiting for another prompt. Trivial edits that are not a
planned step do not trigger that workflow.
