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
publication and cleanup; read those applicable sections through `pnpm context:read` instead of
loading the complete reference. Use `pnpm context:map` for navigation; an outline never substitutes
for relevant evidence.

## Establish The Task

Follow [Task Scope And Completion](../../../instructions.md#task-scope-and-completion): identify the
accepted result, write scope, exclusions and stopping condition. Complete startup reconstruction and
ownership checks before writes. For features or extensive, complex or risky work use the canonical
[Planning](../../../instructions.md#planning-goals-slices-review-loops-and-audits) review/audit;
keep decisions in the conversation or sole bounded context cache. Reuse settled parent decisions.
The primary makes ordinary reversible implementation choices and continues necessary in-scope steps
without repeat approval. A delegated assignment ends at its result; the primary integrates that
handoff and continues the accepted outcome. Escalate only demonstrated blockers under the task
contract.

Read applicable requirements/design and affected current owners through bounded context navigation.
A pending product follows definition intake; framework tooling is not product evidence. Material
architecture or ownership changes use `$architecture-evolution`. Declare one writer per surface and
apply canonical orchestration/capacity admission for useful independent assignments.

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
   changed ownership. Infrastructure work follows
   [Infrastructure As Code](../../../instructions.md#infrastructure-as-code): implement the selected
   tool's real directory/file structure, owned inputs/state and verification together.
4. Read the existing typed owners for white-label identity and branding (`config/product.json`),
   delivery (`config/delivery.json`), tenant context/isolation (`config/tenancy.json`) and locales
   (`config/localization.json`). Resolve relevant pending product choices before implementation.
   Preserve applicable third-party licenses and the project owner's confirmed licensing terms. Use
   the
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

For interactive surface work, read [Rendered UI Implementation](references/rendered-ui.md). Other
work does not load that conditional workflow.

## Verify And Accept

Apply [Test Strategy](../../../instructions.md#test-strategy): for material behavior corrections,
observe the original regression before the fix and cover it in the existing owner suite. Prefer
realistic lifecycle evidence; justify narrow tests by a concrete boundary and proving value.
Editorial changes need no implementation-mirroring test. Distinguish source, fixture, rendered,
native and real-target evidence.

Apply [Documentation Currency](../../../instructions.md#documentation-currency) before slice
handoff: update affected owners within the write set and give the primary exact corrections for
protected documents. The primary integrates them before acceptance. Use `$system-coherence` for a
non-trivial slice and `$task-quality` at the acceptance boundary; specialist reviews apply only to
changed risks. Reuse their evidence in one primary review and fresh audit, including the canonical
whole-repository effectiveness, efficiency and quality assessment.

Apply
[Maintenance Scope And Verification](../../../instructions.md#maintenance-scope-and-verification)
before commands. Inspect `pnpm verify:changed -- --print-plan`, iterate with focused checks and
verify the stable integrated result within scope. Preserve Dev scheduling and actual publication
gates. Continue only unfinished accepted work; stop when its completion condition is satisfied.
Canonical capacity, provenance, settlement and terminal-handover rules remain binding.
