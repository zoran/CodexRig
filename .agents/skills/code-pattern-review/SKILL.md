---
name: code-pattern-review
description:
  Read-only review of changed implementation or architecture for root-cause quality, cohesion,
  boundaries, naming, error handling, local conventions, tests, and maintainability. Use near
  handoff for non-trivial code, scripts, infrastructure, or workflow changes; not as a mandatory
  ceremony for unrelated documentation-only work.
---

# Code Pattern Review

Review the changed behavior in its repository context. Report findings; do not edit files.

## Review

1. Identify the changed files, their owners, and the invariant the change is meant to preserve.
2. Compare boundaries, naming, layout, error handling, and tests with nearby established patterns.
3. Prefer a fix at the producing or owning boundary over duplicated guards and caller workarounds.
4. For non-trivial product code, compare the implementation with the manifest module map. Flag a
   missing or incoherent responsibility, deep imports into internals, undeclared or cyclic
   dependencies, cross-module data writes, shared mutable state, and public contracts that leak
   framework, provider, storage, or transport choices.
5. Apply the replacement test: an alternate implementation or adapter should require only
   composition/configuration, replacement-local work, and an explicit data migration. Flag scattered
   consumer edits, catch-all modules, speculative abstractions, hidden coupling, duplicated policy,
   and stale transitional layers.
6. Confirm that maintained executable modules stay at or below 700 physical lines and split only at
   cohesive ownership boundaries. Do not apply the quota to HTML, templates, schemas, test corpora,
   fixtures, snapshots, generated files, documentation, styles, or other context carriers.
7. Apply the risk-based Test Strategy as well as assessing coverage. Do not report a missing test
   without a concrete recurrence path or material-risk invariant. When coverage is justified, flag
   isolated one-off tests or verifier helpers if a broad, realistic end-to-end, system, or lifecycle
   scenario can cover the invariant coherently; narrow coverage needs a concrete reliability,
   proportionality, or diagnostic reason. Durable docs change only when the contract changed.
8. For parallel work, confirm one write owner per affected module or shared contract, a disjoint
   change footprint, and an explicit compatibility/integration order for contract, schema, or
   migration changes.

Return only material findings, ordered by severity. Include a file reference, concrete failure mode,
root-cause remedy, and smallest proving check. If none remain, say so and state any untested risk.
One targeted recheck is enough unless new evidence changes the risk.
