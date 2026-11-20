---
name: project-implementation
description:
  Implement, debug, refactor, or produce implementation-ready technical design with root-cause
  analysis, stack-aware conventions, evidence-backed decisions, proportionate end-to-end evidence,
  and whole-system handoff. Use for application, script, infrastructure, architecture, framework,
  migration, or performance work; not for a final review or dependency-only maintenance.
---

# Project Implementation

Own root-cause implementation and meaningful assembled-flow evidence. Use the
[task routes](../../../instructions.md#task-reading-routes) for authority, planning, coordination
and closure; a delegated task inherits its accepted parent plan.

## Implement At The Owner

Read requirements/design and trace the public entry through composition, contract, state and actual
consumers. Establish a falsifiable failure hypothesis and the smallest discriminating observation.
Read the relevant diagnostic; compare a working case before adding a fix. Sanitize observations and
remove temporary probes. Repeated disproven hypotheses require reassessment, not stacked guards.

Choose the smallest complete owner-level repair. Use `$architecture-evolution` for material boundary
changes and `pnpm stack:detect` before product-stack decisions. Harness tools are not product
requirements. Preserve typed product/delivery/tenancy/localization owners, third-party obligations
and existing design intent. Match the owning stack's layout, errors and lifecycle conventions.

Keep narrow public ports and private data/migrations; consumers must not deep-import or mutate
another module's internals. Migrate one current contract and all consumers together, remove obsolete
paths and update purpose/owner headers. Maintain executable modules at most 700 physical lines,
splitting only at real responsibilities; schemas, generated output and test corpora are exempt.

Use installed runtimes and shared browser payloads directly. Private profiles and mutable run data
belong in owned scratch, with cleanup/recovery on failure as well as success. Preserve only compact
checkpoints and required references, not copies of entire tool homes. Before repeating external or
stateful work apply
[failure recovery](../../../instructions.md#deployment-and-qualification-failure-recovery).

## Select Evidence And Finish

For material defects prove the original failure and affected consumers through shipped code. Mocks
may isolate external systems, not replace the invariant under test. Exercise contracts directly with
existing specimens; keep complete provisioning and recovery journeys at one explicit integration
owner. A module check must not replay prerequisite domains. Editorial edits need no
implementation-mirroring tests. Distinguish fixture, rendered, native and real-target evidence.

Inspect `pnpm verify:changed -- --print-plan`, reuse valid results and run only necessary checks.
Use `--check <key>` and, for an independent Node file, `--test-file <path>` to retain focused
successes for later composition. Filtered case diagnosis is not complete-file evidence. Place new
tests at a small behavior owner; keep costly integration setup out of unrelated unit cases. Missing
complete coverage does not start a development full run. Apply
[documentation currency](../../../instructions.md#documentation-currency), report protected-owner
corrections to the primary, and use `$system-coherence` plus relevant specialist review at
acceptance. `$task-quality` composes that evidence without another blanket pass. Continue unfinished
authorized work and stop when acceptance is met.

Tie every additional investigation or repair to an unmet acceptance condition. Park unrelated
findings in the handoff without adopting them; follow the course-check limit when attempts stop
producing new evidence. A review is a bounded acceptance decision, not a search for more work.

For interactive surfaces read [Rendered UI Implementation](references/rendered-ui.md); other work
does not load that conditional workflow.
