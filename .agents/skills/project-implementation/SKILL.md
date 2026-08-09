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
scope/non-goals, domain and initial module map, data/integrations, trust boundaries, operations,
collaboration topology and any shared pre-slice coordination channel for concurrent accounts,
constraints, risks, and success evidence are precise. Present a final synthesis for correction,
write only user-confirmed durable truth into the manifest, and then proceed autonomously. Do not
turn the intake into a fixed questionnaire or repeat questions whose answers cannot change a
decision. Resume the same intake later when material ambiguity, contradictions, or changed intent,
scope, module/public contracts, data, integrations, trust, compatibility, or operations could alter
the implementation. Pause only affected writes, continue safe disjoint work, update user-confirmed
durable truth, and then resume autonomously.

For every new feature and every other complex task, complete the thorough planning contract in
`instructions.md` before implementation: define the authorized outcome and non-goals, material
decisions and unknowns, affected owners/consumers, ordered goals with success conditions, and
reviewable slices with risks and focused evidence. Review the plan until no relevant finding
remains, then perform its fresh audit. Keep the plan in the conversation and do not create a
planning document. Read the nearest package/build/test configuration and any directly relevant
project document that already exists. For complex multi-session work, update the single bounded
`docs/project-context.md` only when the repository workflow permits it; replace stale goal/slice
state instead of appending a log.

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

After a framework upgrade launched by an installed updater that predates project-document
reconciliation, the first process cannot print a notice introduced by the updater it is installing.
Inspect that legacy preview and do not apply it if any write or delete targets a project-owned
document. Once a safe apply succeeds, run the newly installed updater against the exact same
reviewed source once as a preview only with
`pnpm framework:upgrade -- --source <same-framework-root> --allow-same`; do not add `--apply`.
Reconcile every listed project-owned document before verification. Treat any
`project-document reconciliation required before verification` finding as a fail-closed request for
that careful local reconciliation, including user confirmation and dedicated preservation review for
uncertain critical-document changes.

For non-trivial product work, establish the affected domain module before editing. Read the durable
module map in `docs/project.md`: responsibility/root, public contract and private internals, owned
data/migrations, allowed dependencies, focused verifier, and steward role or team when known. If it
needs an update, include that critical document in the declared slice write set and do not change it
until the pre-slice coordination and critical-document confirmation rules below are satisfied.
Declare the slice write set and one write owner for every affected module, public contract, schema,
migration, shared configuration, and file. Product Roots alone do not establish domain boundaries.

Immediately before every slice begins, and again before its declared scope expands, perform the
pre-slice coordination check from `instructions.md`. Restate the goal, slice outcome, success
condition, write set, and owners; inspect all observable live-agent assignments, sessions,
account-level work, bounded context, and shared team or orchestration channels before relying on
Git; and compare current goal and slice claims. Only confirmed-disjoint slices may write in
parallel. Resolve overlap or uncertain shared ownership by rescoping, ordering, or exactly one
writer before implementation. A local runtime lease, clean worktree, or quiet remote cannot prove
that another clone, machine, or account is idle; use a shared coordination channel across that
boundary and fail closed on uncertain shared ownership.

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
  legacy domain model at its edge instead of leaking it into the consuming module.
- Apply the replacement test: changing a module implementation or adapter should affect only
  composition/configuration, replacement-local work, and an explicit data migration. Scattered
  consumer changes reveal a missing or leaking contract.
- Treat modules as system components rather than isolated mini-products. Keep each independently
  improvable or replaceable while its public contract, data semantics, versioning, lifecycle,
  error/timeout behavior, and operational expectations remain compatible with current consumers.
  Verify the focused boundary and a realistic assembled flow so the assembled system is verified as
  one functioning unit; a locally clean component is not done when its consumers no longer work.
- Keep one central `main` as the only durable integration branch; do not create long-lived module or
  developer branches. A serialized writer may use `main` directly when branch policy permits.
  Parallel read-heavy work may span modules. Different developers/accounts use temporary task
  branches in separate clones and credential contexts; same-account tasks may use worktrees, which
  are not an authentication boundary. Before each slice, coordinate goal and slice claims without
  waiting for Git evidence. Concurrent writes need confirmed-disjoint declared write sets and
  exactly one writer per module or shared contract. Give a shared contract change one integrator and
  land compatibility before consumer migrations. A task branch is only a bounded integration input;
  close the goal after the actual published `main` passes its course check, affected review/audit,
  and verification.

## Workflow

1. Trace the behavior to its owning domain module, public contract, data/state transition, or
   workflow. Fix the producer/invariant rather than scattering caller guards, and preserve the
   module's replacement boundary.
2. Detect the existing stack before framework-specific work:

   ```bash
   pnpm stack:detect
   ```

   Follow local language, framework, naming, error, dependency, and test conventions. Do not add a
   framework without a documented need.

   Follow the repository's Product Roots contract: root `src/` is the default implementation root; a
   real declared pnpm package activates `<unit>/src`; an evidenced Android Gradle module activates
   `<module>/src/main`. Arbitrary folders do not activate product behavior. When the user requests a
   web application, create or import the declared workspace package and its `src/` as part of that
   task instead of pre-creating an empty `apps/web`. Keep repo-wide vector state at root
   `.context-index/`, outside every product unit. Project setup is not complete until that vector
   space has been materialized and smoke-tested. The locally trusted project Stop hook maintains it
   at turn boundaries, semantic search retains on-demand repair, and normal verification and
   pre-push remain read-only.

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
   test-corpus, fixture, snapshot, documentation, or style files.
7. Apply the risk-based Test Strategy in `instructions.md`: a fix or user instruction does not
   automatically need a test. When coverage is justified, default to extending a broad, realistic
   end-to-end, system, or lifecycle scenario through real boundaries; do not create an isolated
   one-off test or verifier file. Use narrow unit or contract coverage only when the broad flow
   cannot exercise critical deterministic behavior reliably or proportionately. Update documentation
   only when an externally consumed or durable project contract changed. The optional compact
   project-context cache is the sole task-state exception; never create per-task notes or archives.
8. After every completed slice, run focused owner and consumer evidence, then review correctness,
   acceptance criteria, regressions, maintainability, applicable trust risks, documentation drift,
   and whole-system impact. Fix relevant reproducible findings, rerun affected focused evidence, and
   repeat until no relevant finding remains. From that clean state perform a fresh audit against the
   plan, goal, manifest, touched boundaries, and repository state; an audit finding reopens repair,
   review-and-repair loop, and re-audit. From the clean audit, perform the slice-boundary course
   check against current repository and available upstream changes; integrate overlapping module or
   contract work and rerun only affected evidence before continuing.
9. At each major milestone and completed goal, repeat the whole-repository course check, account for
   every downstream consumer and changed contract, remove obsolete temporary or dead work within
   scope, and reconcile code, tests, configuration, docs, bounded context, and the in-session plan.
   Any repository edit in this step reopens affected evidence and review before a new audit. At a
   completed goal, inventory every active documentation surface before the final whole-goal audit.
   Update only stale material; consolidate or remove superseded duplication instead of appending
   history; and preserve active directives. Consolidation is not a shortening target. Treat the
   durable project manifest as critical documentation. Inspect it and every other critical authority
   read-only first; change one automatically only when the factual correction and full preservation
   are unambiguous; otherwise obtain explicit user confirmation before writing. Give every
   authorized critical-document change a dedicated preservation review. Documentation findings
   reopen affected checks and review before the fresh audit. Continue autonomously with the next
   planned slice or already-authorized goal when the check is clean and scope remains authorized.
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
