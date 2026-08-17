---
name: system-coherence
description:
  Inspect and repair a completed non-trivial slice in whole-project context so its behavior,
  architecture, module ownership, contracts, data, configuration, tests, and physical layout remain
  coherent without redundant or competing implementations. Use after implementation stabilizes and
  before a slice is accepted, or whenever project-wide drift, duplication, or locally plausible but
  system-inconsistent code is suspected. Do not use for a trivial isolated edit or as a broad
  speculative rewrite.
---

# System Coherence

Evaluate the changed slice as part of the implemented system, then repair material incoherence at
its owning boundary. Absolute optimality is not a claim: prefer the smallest demonstrably cohesive
shape that satisfies current manifest truth, module contracts, operational constraints, and real
consumer needs.

## Reconstruct The Slice In Context

1. Read `docs/project.md`, the slice diff, affected source and tests, each touched module's public
   contract and composition point, and the real consumers/producers on both sides. Treat
   `docs/future-modules.md` as non-authoritative and never use a candidate to justify current code.
2. Identify the authorized outcome, owning domain/module or framework capability, changed
   invariants, data and lifecycle ownership, trust and tenant boundaries, selected product surfaces,
   delivery target, and expected assembled flow. If ownership is materially ambiguous, pause
   dependent repair, ask one focused question, and use `$architecture-evolution` before choosing a
   new boundary.
3. Use `rg` for exact symbols and known concepts. When terminology differs, ownership is unclear, or
   relationships cross files, invoke `$context-retrieval` or
   `pnpm context:search -- "concept or relationship"`, then read every matched source used in a
   conclusion.
4. Compare available concurrent or upstream changes by module, contract, and file. Do not absorb
   another writer's overlapping scope; route ownership and integration conflicts to the primary.

## Find System-Level Incoherence

Trace at least one representative assembled flow from entry surface through application/domain
behavior, owned state or external adapter, and result/error handling. Inspect the changed
neighborhood for:

- duplicate or parallel domain rules, validators, state machines, types, schemas, configuration,
  adapters, queries, caches, errors, transformations, and test fixtures that express the same
  concept under different names;
- behavior placed by route, screen, transport, provider, or convenient directory rather than its
  single domain/module owner;
- deep imports, dependency cycles, cross-module writes, leaking persistence/provider/transport
  types, shared mutable state, generic `shared`, `common`, `utils`, `core`, or `service` dumping
  grounds, and composition roots that have accumulated business behavior;
- a new abstraction beside an existing extension point, competing sources of truth, duplicated
  environment or tenant logic, incompatible errors or lifecycle semantics, and local fixes that
  leave the producer invariant broken;
- UI/presentation, web, mobile/desktop, public API, Identity and Access, tenancy, infrastructure,
  and product-domain concerns mixed across their declared physical boundaries;
- source/declaration headers, manifest entries, tests, and focused verifiers that describe a prior
  owner or shape; and
- locally clean code that breaks a real consumer, assembled flow, operational behavior, or the
  module replacement boundary.

Distinguish intentional duplication—such as independent trust validation, generated artifacts, or
surface-local presentation—from accidental semantic duplication. Do not centralize code merely
because text looks similar, and do not add an abstraction without at least two current compatible
consumers or another concrete ownership reason.

## Repair At The Owning Boundary

1. Correct the producer, invariant, public contract, composition wiring, or data owner instead of
   adding caller workarounds. Preserve compatible unrelated work.
2. When duplicate concepts are semantically identical, select the narrow canonical owner, migrate
   consumers through its public contract, and remove the superseded implementation and stale tests.
   When semantics differ, name and separate the distinction instead of forcing false reuse.
3. Keep contracts narrow and dependency direction explicit. Move files when their physical location
   lies about ownership; update format-native purpose/owner headers and adjacent public type
   documentation in the same repair.
4. Invoke `$architecture-evolution` when the coherent fix requires a module add/split/merge/rename,
   public-contract migration, data-ownership migration, surface change, or repository-layout
   rebaseline. Update `docs/project.md` only with current integrated reality and remove a matching
   future candidate only in the change that activates it.
5. Remove temporary bridges, dead exports, obsolete configuration, parallel validators, and stale
   fixtures after every real consumer has migrated. Do not leave compatibility archaeology without a
   current consumer and explicit retirement condition.

## Prove Coherence Without Blocking Dev Feedback

Run the smallest focused checks for touched owners plus one realistic assembled consumer flow.
Re-read dependency direction and search again for the superseded concept after repair. A material
finding reopens this loop until none remains; report any consciously retained duplication with its
distinct semantics and owner.

In `dev`, the newest developer build or replaceable deploy keeps scheduling priority. Perform this
analysis and its tests in a disjoint parallel lane or immediately after deployment when safe; never
hold an already authorized latest developer deploy merely to finish the coherence pass. The slice is
not accepted, promoted to staging/prod, or used as a stable dependency until coherence repairs and
required evidence are complete.

Return a compact in-conversation result naming the inspected assembled flow, material findings and
repairs, retained trade-offs, focused evidence, and any untested system risk. Do not create a review
document.
