---
name: system-coherence
description:
  Review changed code and whole-system integration for root-cause quality, cohesion, conventions,
  ownership, contracts, data and lifecycle correctness. Use near handoff of non-trivial code,
  architecture, configuration or workflow changes, or for suspected drift. Review requests stay
  read-only; repair only within an already-authorized implementation. Skip trivial isolated edits.
---

# System Coherence

This skill owns code-quality and system-integration review together. Inspect the changed behavior
through actual consumers; do not start a speculative whole-repository rewrite.

## Authority Mode

A review, audit, diagnosis or status request is read-only: report findings without editing files,
planning state or accepting risk. During authorized implementation, repair material findings only
inside the declared scope and writer ownership. A review does not grant implementation authority.
Materially new boundaries use `$architecture-evolution` before dependent repair.

## Reconstruct The Slice In Context

1. Read `docs/project.md`, the diff, affected source/tests, public contracts and composition points.
   Identify the intended invariant, real producers/consumers, data/lifecycle owner and selected
   delivery/surface constraints. Future candidates are not active capabilities.
2. Follow [Context And Skills](../../../instructions.md#context-and-skills): scoped exact searches,
   direct matched-source reads, and a representative assembled flow from entry through owned
   behavior/state or adapter to result and failure handling.
3. Compare concurrent and upstream changes against the declared scope. Preserve other changes;
   uncertain overlap goes to the primary under the canonical coordination rules.

## Review Code And System Together

Inspect the changed neighborhood for material defects:

- correctness at the producer or invariant, rather than caller guards masking the same defect;
  naming, layout, error handling, resource ownership and test conventions that disagree with the
  existing stack or conceal behavior;
- semantic duplication of rules, validators, state machines, types, configuration, adapters,
  transformations or fixtures; competing truth and new abstractions beside existing extension
  points;
- missing module ownership, catch-all placement, deep imports, cycles, cross-module data writes,
  shared mutable state or provider/storage/transport types leaking through public contracts;
- incompatible lifecycle/failure semantics, partial state transitions, stale consumers, hidden
  coupling, environment or tenant drift, and an assembled flow broken despite local green tests;
- mixed domain/application, presentation, interface, Identity and Access or infrastructure concerns,
  and physical files or source/declaration headers that still describe the former owner;
- unrequested UI/navigation/interaction changes or shared component/token effects. Route actual
  interactive changes to `$ui-ux-review`; do not duplicate its visual review or claim rendered
  acceptance from source. Route changed trust surfaces to `$security-review`;
- missing meaningful regression evidence or tests that merely mirror implementation. Apply the
  [Test Strategy](../../../instructions.md#test-strategy): require a concrete material-risk
  invariant, prefer an existing realistic lifecycle scenario, and justify narrow tests by
  reliability or cost;
- maintained executable modules above 700 physical lines or splits without cohesive responsibility.
  Context carriers, styles, schemas, generated artifacts and test corpora are outside that quota.

Apply the replacement test: replacing an implementation should require composition/configuration,
replacement-local work or an explicit contract/data migration, not scattered consumer knowledge.
Distinguish intentional duplication (independent trust checks, generated views, surface-local
presentation) from identical semantics. Similar text alone does not justify centralization.

## Repair At The Owning Boundary

In authorized repair mode:

1. Correct the producer, invariant, contract, composition or state owner; preserve unrelated work.
2. For equivalent duplicate concepts, select one narrow owner, migrate every real consumer, and
   remove superseded implementations, configuration, exports, fixtures and docs. For distinct
   semantics, name and separate them rather than forcing reuse.
3. Move files and update purpose/owner and public-type descriptions with the boundary. Material
   topology or contract/data migrations use `$architecture-evolution`; the manifest changes only
   when the new shape actually integrates.
4. Follow [Current Contracts](../../../instructions.md#current-contracts-only): leave exactly one
   current interpretation, not an old internal reader or dormant bridge.
5. Run affected owner evidence and the assembled consumer flow, then search again for superseded
   concepts. Review material repairs to zero relevant findings before the fresh audit.

In read-only mode return these remedies as findings, without applying them. Dev scheduling and slice
acceptance follow
[Slice Acceptance](../../../instructions.md#best-available-engineering-not-quick-fixes); the latest
developer deploy retains priority, but an unreviewed slice is not a stable dependency.

## Report

Return material findings by severity with a file reference, concrete failure mode, root-cause remedy
and smallest proving check. Name the inspected assembled flow, retained intentional duplication,
actual evidence and untested risks. If none remain, say so within that inspected scope. Keep the
result in the conversation; `$task-quality` coordinates acceptance without a second code review.
