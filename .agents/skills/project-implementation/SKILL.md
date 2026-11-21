---
name: project-implementation
description:
  Implement, debug, refactor or design a concrete change at its owner and verify the affected flow.
  Dependency-only maintenance and final review have separate skills.
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
splitting only at real responsibilities; schemas, generated output and test corpora are exempt. For
multi-component changes or deployments use the shared
[dependency plan and preflight](../../../instructions.md#coherent-component-updates-and-release-batching).

Use installed runtimes and shared browser payloads directly. Private profiles and mutable run data
belong in owned scratch, with cleanup/recovery on failure as well as success. Preserve only compact
checkpoints and required references, not copies of entire tool homes. Before repeating external or
stateful work apply
[failure recovery](../../../instructions.md#deployment-and-qualification-failure-recovery).

## Select Evidence And Finish

For material defects exercise the original failure and affected consumers through shipped code. Keep
external effects isolated and complete provisioning/recovery journeys at their integration owner.
Choose checks through [test strategy](../../../instructions.md#test-strategy) and
[verification selection](../../../instructions.md#verification-selection-and-runtime). Distinguish
fixture, rendered, native and real-target evidence.

Reconcile [documentation](../../../instructions.md#documentation-currency) and report protected
corrections to the primary. At acceptance use `$system-coherence` for nontrivial integration and
`$task-quality` to compose relevant evidence. Follow up on a finding only when it blocks the
accepted outcome.

For interactive surfaces read [Rendered UI Implementation](references/rendered-ui.md); other work
does not load that conditional workflow.
