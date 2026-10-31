---
name: architecture-evolution
description:
  Reassess product or framework architecture before a material purpose, domain, surface, deployment,
  module, ownership, contract, data or layout change. Use for module addition, split, merge,
  retirement, replacement and cross-module migrations; not for a trivial edit or read-only review.
---

# Architecture Evolution

Own architectural decisions and coherent cutovers; [instructions](../../../instructions.md) own
policy and the manifest records integrated reality.

1. Read the actual roots, requirements/design, public ports, data/lifecycle and consumers. Trace a
   representative assembled flow and identify the requirement or failed invariant.
2. Place the change at a cohesive domain owner. Compare keeping, splitting, merging, replacing or
   retiring modules against real consumers, migration cost and operations. Prefer a modular monolith
   unless independent deployment has an evidenced reason. Deferred candidates are not active modules
   or implementation authority.
3. Resolve relevant surface, stack, UI/device/locale, identity/tenant, white-label, infrastructure
   and delivery boundaries under
   [architecture policy](../../../instructions.md#modular-architecture-parallel-ownership-and-integration).
   Harness Node/pnpm/mise is not a product-stack default; use `pnpm stack:detect` and current
   primary evidence when a technology choice depends on it. Benchmark material performance
   assumptions.
4. Plan one current contract: producers/consumers, composition, failure semantics, data migration
   and recovery. Keep provider, storage and transport implementation behind narrow public ports.
   Consumers should change at composition or through explicit migration, not scattered knowledge.
5. Move owners, code, state and consumers together; retire obsolete roots, schemas and tests. Update
   manifest responsibilities, contracts, runtime, data/tenancy, dependencies, focused verifier and
   steward only when the new shape integrates. Requirements/design remain at their own owners.
6. Prove affected owner behavior and a representative assembled flow, then use `$system-coherence`
   and `$task-quality`. Reuse evidence under
   [verification](../../../instructions.md#verification-selection-and-runtime); an architecture
   review does not trigger a full suite or a new design report.
