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

For non-trivial product work, establish the affected domain module before editing. Read or update
the durable module map in `docs/project.md`: responsibility/root, public contract and private
internals, owned data/migrations, allowed dependencies, focused verifier, and steward role or team
when known. Declare the slice write set and one write owner for every affected module, public
contract, schema, migration, shared configuration, and file. Product Roots alone do not establish
domain boundaries.

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
- Keep one central `main` as the only durable integration branch; do not create long-lived module or
  developer branches. A serialized writer may use `main` directly when branch policy permits.
  Parallel read-heavy work may span modules. Different developers/accounts use temporary task
  branches in separate clones and credential contexts; same-account tasks may use worktrees, which
  are not an authentication boundary. Concurrent writes need disjoint declared write sets and
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

3. Check current official/primary sources only when a material decision depends on unstable or
   specialized behavior. Record the decision and tradeoff, not a research transcript.
4. Implement the largest coherent, currently unblocked slice supported by the decision-ready plan.
   Stay inside its declared module/write set, preserve unrelated compatible edits, and avoid generic
   catch-all modules or speculative abstractions. Keep planning and review detail tied to decisions,
   risks, findings, and evidence instead of accumulating status prose.
5. Keep maintained executable modules at or below 700 physical lines. Split an approaching module at
   cohesive ownership boundaries. Do not apply the quota to declarative/context, generated,
   test-corpus, fixture, snapshot, documentation, or style files.
6. Apply the risk-based Test Strategy in `instructions.md`: a fix or user instruction does not
   automatically need a test. When coverage is justified, default to extending a broad, realistic
   end-to-end, system, or lifecycle scenario through real boundaries; do not create an isolated
   one-off test or verifier file. Use narrow unit or contract coverage only when the broad flow
   cannot exercise critical deterministic behavior reliably or proportionately. Update documentation
   only when an externally consumed or durable project contract changed. The optional compact
   project-context cache is the sole task-state exception; never create per-task notes or archives.
7. After every completed slice, run focused owner and consumer evidence, then review correctness,
   acceptance criteria, regressions, maintainability, applicable trust risks, documentation drift,
   and whole-system impact. Fix relevant reproducible findings, rerun affected focused evidence, and
   repeat until no relevant finding remains. From that clean state perform a fresh audit against the
   plan, goal, manifest, touched boundaries, and repository state; an audit finding reopens repair,
   review-and-repair loop, and re-audit. From the clean audit, perform the slice-boundary course
   check against current repository and available upstream changes; integrate overlapping module or
   contract work and rerun only affected evidence before continuing.
8. At each major milestone and completed goal, repeat the whole-repository course check, account for
   every downstream consumer and changed contract, remove obsolete temporary or dead work within
   scope, and reconcile code, tests, configuration, docs, bounded context, and the in-session plan.
   Continue autonomously with the next planned slice or already-authorized goal when the check is
   clean and scope remains authorized.
9. Run focused owner commands during iteration without treating execution scope as a reason to
   design microscopic tests. Inspect adaptive changed-path admission after the coherent slice and
   leave publication admission to the single final workflow after the clean goal audit and cleanup;
   a prior failure never authorizes a broad restart.

## Completion

Report the outcome, changed boundaries, verification, clean review result, fresh audit, material
tradeoffs, and residual risks in the final response. Use `$task-quality` at the completion of every
planned new-feature or complex-task slice and goal, including push preparation and elevated-risk
closure. A green goal checkpoint is not a handoff while another goal in the same authorized outcome
remains: publish it, run `pnpm goal:new`, and continue without waiting for another prompt. Trivial
edits that are not a planned step do not trigger that workflow.
