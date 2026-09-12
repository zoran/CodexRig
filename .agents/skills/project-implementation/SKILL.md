---
name: project-implementation
description:
  Implement, debug, refactor, or produce implementation-ready technical design with root-cause
  analysis, stack-aware conventions, evidence-backed decisions, proportionate end-to-end evidence,
  and whole-system handoff. Use for application, script, infrastructure, architecture, framework,
  migration, or performance work; not for a final review or dependency-only maintenance.
---

# Project Implementation

This skill owns implementation planning, owner-level changes and rendered UI evidence. The current
[instructions](../../../instructions.md) own general workflow, authority, coordination, capacity,
publication and cleanup; read those applicable sections instead of duplicating their procedures
here.

## Authority And Preflight

An implementation/fix request authorizes in-scope changes. An explanation, diagnosis or design
request without implementation stays read-only. Follow
[Authorized Work And Native Codex](../../../instructions.md#authorized-work-and-native-codex):
approvals persist within scope, additive questions return to the active outcome, explicit pauses are
respected, and neither user absence nor an intermediate result is completion. Never end at "ready to
implement" when implementation is already authorized.

Before a new feature or other complex task, complete the decision-ready plan, review and fresh audit
from [Planning](../../../instructions.md#product-first-delivery-and-verification-economy). Keep the
plan in the conversation, or the sole bounded project-context cache when its lifecycle applies.
Identify the user outcome, non-goals, acceptance evidence, material unknowns and tradeoffs, affected
owners/consumers, ordered slices, integration, and recovery. Do not reopen an already settled choice
without new evidence. Before extra work, identify the outcome, blocker or material risk it improves.

Complete
[Startup Repository Reconstruction](../../../instructions.md#startup-repository-reconstruction) and
the pre-slice coordination check before writing or expanding the write set. One primary owns
integration; every writer has an exact disjoint scope. Read the established requirements and design
owners linked from the manifest under
[Documentation Ownership](../../../instructions.md#documentation-ownership), then current source,
nearest package/build/test configuration and relevant durable decisions. Use
[Context And Skills](../../../instructions.md#context-and-skills) for manifest-led discovery, scoped
exact searches and direct matched-source reads before acting.

A pending generated product first follows
[Project Definition Intake](../../../instructions.md#first-prompt-project-definition-intake). Do not
infer a product from framework tooling. Confirm decision-relevant scope, surface and module
technology before dependent implementation; invite the user to confirm, override or delegate
choices. Use `$architecture-evolution` for material topology, surface, trust, ownership or layout
changes. A new feature extends its current owner, creates a new module in an existing domain, or
establishes a domain; there is no generic catch-all placement.

For a framework upgrade, use only the current receipt-backed contract documented in
[Framework Lifecycle](../../../instructions.md#framework-lifecycle-compatibility-and-git-platforms).
Preview the exact source/target and review changes, conflicts and policy reconciliation before
apply. Project-owned documents never become blind copy targets; preserve child decisions,
acknowledge the exact plan digest, and verify the assembled child. No compatibility path or
alternative updater.

## Implement At The Owner

1. Trace the behavior through its public entry, composition, owning module, contract and data/state
   transition to the real consumers. Establish the failed invariant and root cause before writing.
   Compare viable approaches in whole-project context and choose the smallest durable solution that
   meets the confirmed acceptance boundary. No symptom guard, speculative abstraction or local
   workaround.
2. Run `pnpm stack:detect` before selecting/changing a product stack. The root Node.js/pnpm/mise
   toolchain is harness tooling, not product evidence. Apply
   [Requirement-Driven Technology](../../../instructions.md#requirement-driven-technology-selection)
   and the architecture skill; current ecosystem evidence matters only when it can change the
   choice. Keep actual integrated `Runtime and technology` in the manifest, not an invented product
   stack.
3. Keep cohesive modules independently improvable or replaceable: narrow public ports, private
   internals, owned data/migrations and acyclic dependencies. A consumer never deep-imports another
   module, mutates its data or silently owns its behavior. Separate domain/application,
   UI/presentation, web, Identity and Access, API contracts/transport, adapters and infrastructure.
   Use the current Product Roots and `scripts/verify/path-hygiene.mjs`; move stale files with
   changed ownership.
4. Read the existing typed owners for white-label identity and branding (`config/product.json`),
   delivery (`config/delivery.json`), tenant context/isolation (`config/tenancy.json`) and locales
   (`config/localization.json`). Resolve relevant pending product choices before implementation.
   Preserve source-facing LICENSE/NOTICE and keep CodexRig identity out of product-facing output.
   Use the
   [architecture and product contracts](../../../instructions.md#modular-architecture-parallel-ownership-and-integration)
   for detailed boundaries; do not copy their implementation into this skill.
5. Implement the largest coherent unblocked slice within the declared write set. Match the owning
   stack's naming, layout, error, dependency and test conventions. Keep maintained executable
   modules at or below 700 physical lines, splitting only at real responsibility/lifecycle
   boundaries. Update format-native purpose and owning-boundary headers and non-trivial public-type
   invariants with each move or contract change.
6. Migrate an owned contract, its state and every producer/consumer together, then remove the
   superseded schema, path, alias, test and documentation. Keep exactly one current interpretation.
   Update README discovery links when durable documents are added, moved or retired; keep their
   substantive content at the canonical owner. Verify a representative assembled flow across actual
   boundaries; a locally passing module is insufficient when consumers no longer agree.

## Debug From Evidence

For a bug or failing check, first reproduce the observed failure and read the complete relevant
diagnostic. Trace inputs, configuration and state across the affected boundaries; use sanitized
observations, never credential values or bulk environment dumps. Compare a nearby working case and
recent changes before concluding which invariant failed.

State one falsifiable root-cause hypothesis and the smallest discriminating check. A failed
hypothesis returns to investigation; do not stack speculative fixes. Once supported, correct the
canonical owner and prove the original failure plus affected consumers. Repeated failures that
expose coupling reopen the architecture decision, not a ritual permission request for an already
authorized fix. Temporary probes do not become permanent infrastructure without a current owner and
need; remove them after use.

## Rendered UI Work

Use [UI Intent And Change Boundaries](../../../instructions.md#ui-intent-and-change-boundaries)
before changing an interactive surface. Do not treat general repository approval as a redesign
mandate or existing visuals as retrospectively approved.

1. Identify the affected user task and states, existing navigation/interaction/visual direction,
   presentation owners and shared consumers. State what the change will preserve. Read the actual
   components, tokens, assets and current product decisions; do not impose a new design system.
2. For new UI, make one representative coherent flow concrete early, including important loading,
   empty, error and success states. Show the direction for confirmation before spreading material
   design choices across the product. Do not restart a full design interview for ordinary
   maintenance.
3. For existing UI, preserve established appearance and behavior. In-scope bug fixes, consistency
   corrections and accessibility improvements within that direction need no extra approval ritual.
   Seek a focused decision before a material change in visual language, information architecture,
   navigation, central interaction or design system, including a necessary correction with that
   impact.
4. Implement through the canonical copy/locale, token, component, layout or surface owner. Keep
   views, presentation/navigation state, transport/API clients and domain behavior separate. Fix
   shared causes and inspect affected consumers; do not mask clipping by shrinking text, hiding
   overflow, removing useful content, or adding per-screen style overrides.
5. Inspect the real affected flow and representative states using realistic content and applicable
   viewport/input/zoom/locale conditions. Assume mobile, tablet, and desktop unless scope is
   narrower; apply [Multi-Device Experience](../../../instructions.md#multi-device-experience).
   Compare before and after for meaningful changes when available. Check hierarchy, legibility,
   wording, spacing, focus, navigation consistency, recovery and completion of the user task, not
   only isolated screens.
6. Separate source/static, simulated, rendered and actual-target evidence. Report unavailable
   browser or target observations rather than claiming visual acceptance from a scanner, mock or
   screenshot alone. Add no universal screenshot infrastructure or mandatory visual ceremony for
   framework work without product UI. In Dev, run relevant evidence beside or after the newest
   developer deploy.

Keep confirmed durable UX decisions at their established requirements/design owner; do not mirror
tokens/components into a new registry. Changed user-facing copy uses
`$native-language-content-review`; changed interactive flows use `$ui-ux-review` before acceptance.

## Verify, Review And Continue

Apply the [Test Strategy](../../../instructions.md#test-strategy). For a material behavior
correction, observe the original failing regression before the fix and document the problem/contract
concisely in the existing owner suite. Prefer realistic lifecycle evidence; use narrow coverage for
important deterministic boundaries that cannot be exercised proportionately through a broad flow.
Editorial changes alone need no implementation-mirroring test. Source checks do not prove native
delivery, rendered UX, model compliance or actual account-backed behavior.

At every non-trivial completed slice, use `$system-coherence`, then proportionate review and repair
to zero relevant findings, a fresh audit and a whole-repository course check. Examine real
consumers, unrequested UI changes, shared styles, contract/data drift and the next highest-value
unfinished step. Use `$task-quality` at the planned slice/goal boundary, `$security-review` for
changed trust surfaces, and other reviews only where relevant. Keep results in the conversation.

Use `pnpm verify:changed -- --print-plan` for admission and focused evidence while iterating; one
final `pnpm verify` belongs on the stable integrated candidate. Preserve Dev feedback priority. The
verification and documentation sections of [instructions](../../../instructions.md) define full
audit, all-document currency review, critical-document preservation, `repo:housekeeping`, post-exit
reset, publication and `pnpm goal:new` gates. Preserve the durable project manifest and never bypass
a gate because an intermediate slice is green.

The
[orchestration authority](../../../instructions.md#subagent-orchestration-and-integration-authority)
owns permission checks, agent/process provenance, capacity admission, ownership and drain. A
critical handover uses `pnpm handover:create -- --critical` as the final repository action after the
exact drain attestation; then no tool or continuation is allowed. Otherwise continue the authorized
outcome and state a concrete blocker only when no safe in-scope progress remains.
