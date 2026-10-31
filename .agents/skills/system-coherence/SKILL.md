---
name: system-coherence
description:
  Review changed code and whole-system integration for root-cause quality, cohesion, conventions,
  ownership, contracts, data and lifecycle correctness. Use near handoff of non-trivial code,
  architecture, configuration or workflow changes, or for suspected drift. Review requests stay
  read-only; repair only within an already-authorized implementation. Skip trivial isolated edits.
---

# System Coherence

Review changed code and assembled-system behavior together. Explicit review/audit stays read-only;
repair only within an existing authorized implementation and writer scope. General authority,
planning and closure live in [instructions](../../../instructions.md).

Read relevant requirements/design, manifest, diff and real producers/consumers. Trace one meaningful
entry-to-result/failure flow, including state ownership and concurrent changes. Future candidates,
configured adapters and observed deployment are different facts.

Inspect for actual defects in correctness, error/lifecycle/resource handling, stack conventions,
shared mutable data, deep imports/cycles, stale contracts and consumers. Find duplicate semantics or
competing owners; similar text alone does not justify merging distinct concerns. The replacement
test asks whether changing an implementation stays at composition/local code or an explicit
migration, rather than spreading knowledge through consumers. Include affected infrastructure/state
owners, identity/tenant boundaries, UI intent and declaration headers.

Keep one current contract, migrate consumers and remove superseded paths. Material topology changes
use `$architecture-evolution`. Executable modules stay within 700 physical lines; tests, schemas,
styles, context carriers and generated artifacts are exempt. Splits must represent real ownership.

Evaluate meaningful regression/assembled-flow evidence under
[test strategy](../../../instructions.md#test-strategy). Reuse valid results; review alone is not a
rerun trigger. Route trust risks to `$security-review` and actual interactive changes to
`$ui-ux-review`, avoiding duplicate review. Assess total outcome, maintenance and verification cost
under [efficiency](../../../instructions.md#repository-efficiency-and-effectiveness). Static policy
checks do not prove model effectiveness.

Return material findings by severity with location, failure path, root-cause remedy and smallest
proving check. Name inspected integration, intentional duplication and evidence limits. Report
protected-document corrections to the primary. Stop at the assigned question; `$task-quality`
composes acceptance without a second code review or speculative rewrite.
