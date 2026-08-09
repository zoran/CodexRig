---
name: task-quality
description:
  Verify, prepare for push, close, or hand off completed project work with proportional
  deterministic checks, bounded review iterations until no relevant finding remains, and a fresh
  audit. Also supports an explicitly read-only final review without changing files or planning
  state. Use near completion of a planned slice or goal, not for ordinary implementation or a
  specialized domain review.
---

# Task Quality

## Authority Mode

Choose the mode from the user's request:

- **Review-only:** when asked to inspect, review, audit, diagnose, or report without changes. Do not
  edit files, accept risk for the owner, or perform external mutations. Run only checks needed to
  support the review.
- **Finish/handoff:** when completing an authorized implementation, preparing a push, or explicitly
  closing work. Fix findings only inside the original change scope.

## Workflow

1. Identify the requested outcome, changed files, owning boundaries, and risk surfaces.
2. Perform a whole-repository course check after every completed slice and at every major milestone
   and completed goal: confirm the implemented scope still matches the requested outcome, plan,
   durable project truth, and module map, and account for touched contracts, owners/consumers, risk
   boundaries, tests, docs, remaining slices, and unrelated or concurrent worktree changes. At a
   slice boundary, refresh available upstream state when a shared remote and network access exist,
   then compare changes by path, module, public contract, schema, and migration. Disjoint work
   continues; overlap reopens integration and affected verification before further writes. Keep this
   comparison in the conversation; do not create a completion artifact.
3. Run focused regressions and inspect adaptive changed-path admission first. A targeted review-only
   request does not imply full coverage. Run network-dependent maintenance only when the task is a
   release/dependency check.

4. Perform a bounded review iteration for regressions, root-cause quality, maintainability, docs
   drift, acceptance criteria, and whole-system impact. Invoke `$security-review` for affected
   trust, authentication, authorization, secret, personal-data, dependency, shell, CI,
   infrastructure, or runtime surfaces, `$code-pattern-review` for implementation/architecture
   changes, and specialized content/image/search review only when those surfaces changed. Keep
   findings in the conversation; do not create review, audit, or handoff documents. When research or
   publications support a decision or claim, confirm that the newest relevant primary or official
   sources were considered and that any older authority is used only for justified comparison,
   historical, foundational, or controlling purposes after checking newer evidence.
5. Classify findings by severity, relevance, reproducibility, and acceptance impact. In
   finish/handoff mode, fix every relevant, reproducible finding within scope; only the owner or
   documented project policy can accept material residual risk. Batch same-root-cause fixes and
   rerun only affected owners; a previous failure does not authorize broad work. Repeat the bounded
   review, repair, and focused-verification iteration until no relevant reproducible finding
   remains. In review-only mode, report findings without changing or accepting them and do not claim
   a clean state while relevant findings remain.
6. Before the final fresh audit, complete all repository-mutating cleanup for the slice, milestone,
   or goal: remove obsolete temporary or dead paths, reconcile code/tests/configuration/non-critical
   docs, update or delete bounded project context as appropriate, and refresh the in-session plan.
   Do not change critical documents through generic cleanup. Any repository edit reopens affected
   focused checks and steps 4-6 before continuing.
7. At every completed-goal boundary, after mutating cleanup and before the final fresh audit,
   inventory every active documentation surface, including root and `docs/` documents,
   workflow/bootstrap authorities, Codex guidance, and skill instructions. Compare each with current
   behavior, code/configuration, manifest truth, public contracts, operations, and still-active
   decisions. Update only where needed; consolidate or remove superseded, obsolete, and duplicate
   material instead of appending history; preserve every active directive and audience-specific
   requirement; and create no review artifact. Consolidation is not a shortening target. Treat the
   durable project manifest as critical documentation. Inspect it and every critical workflow,
   bootstrap, security/trust, operations/migration, or public-contract authority read-only first.
   Change one automatically only when completed authorized work requires an unambiguous factual
   correction and every directive and durable manifest decision is demonstrably preserved. Obtain
   explicit user confirmation before any normative or interpretive change, consolidation/removal,
   ambiguous conflict, uncertain replacement, or other doubtful write; do not let autonomous
   continuation bypass that pause. After an authorized critical-document change, perform a dedicated
   preservation review separate from the general review, preferably with an independent reviewer.
   Trace removed or materially rewritten directives and durable manifest decisions to surviving
   canonical text or explicit authorized retirement and preserve uncertain requirements. Any
   documentation edit reopens affected checks and steps 4-7 before continuing. For a slice-only
   checkpoint, retain the ordinary changed-contract documentation check without manufacturing an
   all-document pass.
8. Once no relevant finding remains and any goal documentation review is clean, perform a fresh
   audit against the request, plan, goal or slice success condition, manifest, touched
   owners/consumers, verification evidence, docs, and worktree scope. In finish/handoff mode, an
   audit finding reopens focused repair and the review-and-repair loop before the audit is repeated.
   In review-only mode, report audit findings without mutation.
9. After a clean slice, milestone, or goal audit and course check, do not mutate repository content.
   A newly required cleanup, context, documentation, or implementation edit reopens steps 4-8 and,
   at a completed goal, the all-document and critical-document gates. Before a next slice begins,
   repeat the goal/slice-based pre-slice coordination check against observable agent, session,
   account, and team-channel claims and resolve overlap or uncertain shared ownership. A local
   runtime lease or quiet worktree cannot prove that another clone, machine, or account is idle; use
   a shared coordination channel across that boundary and fail closed on uncertain shared ownership.
   Continue autonomously with the next planned slice or already-authorized goal when it remains
   inside the authorized outcome.
10. When publication is required, use the declared integration path. Serialized direct-main work
    remains on current `main` for final admission. For a temporary task branch or protected `main`,
    commit and push only its bounded integration input under normal pre-push evidence; one
    integrator or the detected provider's merge serializer publishes it. Refresh local `main`, then
    repeat the course check, affected review/repair and verification, completed-goal all-document
    review, any critical-document confirmation and preservation review, and fresh audit on the
    actual resulting commit. Do not create a marker commit.
11. On that actual target-`main` state, apply any required reset and invoke adaptive final admission
    once. Full coverage is allowed only when the plan names a concrete admission reason: no trusted
    successful basis, an uncovered risk, or an explicit owner instruction. In direct-main mode,
    commit exactly the attested goal-owned changes and push `main` after admission. Under protected
    integration, the merge or squash is already the publication commit. Treat unsafe scoping,
    missing upstream/authentication, unresolved integration, or rejected publication as a visible
    blocker. Never absorb unrelated changes, bypass hooks, force-push, rewrite history, or rerun an
    unchanged broad suite to manufacture closure. Pre-push may rebind an exactly content-identical
    dirty-to-commit transition without verifier commands, then must reuse exact-current successful
    evidence while rerunning security and pushed-object checks; changed input fails closed.
12. Immediately after publishing and verifying a green goal checkpoint, run `pnpm goal:new`. Do not
    open a subsequent goal until its executable fail-closed publication precondition passes. The
    gate must prove central `main` is current with a clean non-ignored worktree and exact equality
    to its locally recorded configured remote-tracking `main` upstream. It binds root-owned Git
    metadata, uses a fresh temporary index, and permits neither an active repository-local Git
    exclude rule nor hidden index flags. It also requires exact-current successful verification
    evidence; prose is not publication evidence, and the preceding push owns remote authentication.
    When the gate passes and another goal is already authorized, continue it without waiting for
    another prompt or returning a handoff.

## Handoff

Return a handoff only when the complete authorized outcome is done or a real blocker prevents safe
continuation; an intermediate goal alone is not a handoff boundary. Lead with the outcome. Include
verification, clean-review status, goal documentation and critical-document review status when
applicable, audit result, important decisions, accepted residual risks, and the next useful step
only when one remains.
