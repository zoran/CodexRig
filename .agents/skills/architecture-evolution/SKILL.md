---
name: architecture-evolution
description:
  Reassess product or framework architecture before a material purpose, domain, surface, deployment,
  module, ownership, contract, data or layout change. Use for module addition, split, merge,
  retirement, replacement and cross-module migrations; not for a trivial edit or read-only review.
---

# Architecture Evolution

This skill owns architecture decisions and coherent cutovers.
[Project Instructions](../../../instructions.md) own product, trust and workflow policy;
`docs/project.md` records only integrated reality.

## Reconstruct And Place The Change

1. Read the manifest and affected source: real roots, composition, public entrypoints, state and
   migrations, adapters, delivery, focused verifiers and actual dependency direction. Trace a
   representative assembled flow. A folder name or future candidate is not an implemented module.
2. State the failed invariant or new requirement, affected owners/consumers, current constraints and
   acceptance evidence. Classify affected modules as `keep`, `split`, `merge`, `rename`, `retire` or
   `replace`; identify dead roots and competing truth.
3. Place each feature by language/invariants, data and lifecycle, trust, operations, change reason
   and dependencies: extend a cohesive existing owner, create a module in an existing domain, or
   establish a genuinely distinct domain. A route, requested filename or generic catch-all is not an
   owner. Use [Feature Placement](../../../instructions.md#feature-to-domain-placement).
4. Compare viable designs against real consumers, replacement cost, data migration, operational
   complexity and maintenance. Prefer a modular monolith unless independent deployment has an
   evidenced reason. Avoid an extra abstraction or shared root without current compatible consumers
   or a concrete separate responsibility.
5. Resolve material ambiguity through the focused
   [Project Definition Intake](../../../instructions.md#first-prompt-project-definition-intake). An
   idea is not implementation authorization; keep confirmed deferred candidates only in
   `docs/future-modules.md`. Do not reopen settled choices without new evidence.

## Resolve The Relevant Boundaries

Read only the canonical contracts affected by this decision:

- [Product Surfaces](../../../instructions.md#product-surface-selection): confirm where and how
  users work before selecting web/PWA, mobile, desktop, CLI/TUI, service, worker, SDK or real-time
  topology. Give a strong recommendation and at most one close alternative; ask for confirmation,
  override or delegation when the choice remains open.
- [Technology](../../../instructions.md#requirement-driven-technology-selection): run
  `pnpm stack:detect`; harness Node.js/pnpm/mise is not a product default. Compare platform,
  latency/jitter/resources, safety/FFI, trust/tenancy, team, operations and maintenance from current
  primary evidence when it could change the decision. Benchmark material performance assumptions.
  Record actual integrated `Runtime and technology`, not an unevidenced stack.
- [Physical Surfaces](../../../instructions.md#physical-surface-boundaries): separate
  domain/application, UI/presentation, interface/transport, Identity and Access, adapters and
  infrastructure. Composition wires narrow public contracts; no deep imports, cross-module data
  writes or mixed concern roots. Use `scripts/verify/path-hygiene.mjs`.
- [UI Intent](../../../instructions.md#ui-intent-and-change-boundaries),
  [Multi-Device Experience](../../../instructions.md#multi-device-experience) and
  [Localization](../../../instructions.md#localization-and-language-strategy): preserve established
  direction, keep presentation owners explicit, and resolve device/locale choices before dependent
  surfaces harden. UI implementation uses `$project-implementation`; review uses `$ui-ux-review`.
- [Tenant Isolation](../../../instructions.md#tenant-isolation-boundary) and
  [Security](../../../instructions.md#security-and-privacy): identify principal, verified tenant
  context, policy, state and provider boundaries independently. Material trust changes need
  `$security-review` and negative assembled evidence.
- [White-Label Configuration](../../../instructions.md#white-label-product-configuration) and
  [Delivery](../../../instructions.md#delivery-environments): preserve separate typed owners
  `config/product.json`, `config/delivery.json`, `config/tenancy.json` and
  `config/localization.json`; configuration resolution belongs at composition, secrets separately.

These links retain the detailed rules; do not clone them into a new design document or skill. Keep
decision-ready plans in the conversation or the applicable existing bounded work cache.

## Migrate Architecture And Files Together

Plan one single-current-contract cutover:

1. Define the target public contract, composition, failure/lifecycle semantics, state
   transformation, and every producer/consumer. Apply the replacement test: consumers change at
   composition or through an explicit contract/data migration, not through scattered implementation
   knowledge.
2. Migrate owned state transactionally with a safe recovery boundary and retain only the current
   representation. Follow [Current Contracts](../../../instructions.md#current-contracts-only); do
   not add a second internal reader or compatibility shell.
3. Move internals and consumers in dependency order within the same coherent change. Move files with
   their owner and update each format-native purpose/owner header and public-type invariant.
4. Remove superseded roots, schemas, exports, adapters, fixtures, tests and documentation.
5. Activate the real module and its root, responsibility, public contract, private internals,
   data/migrations, tenant isolation, runtime, dependencies, focused verifier and steward in
   `docs/project.md`. Remove its matching future candidate in that same change. Retired modules
   leave the active inventory; selected but unimplemented topology remains a decision, not a root.

## Prove The Shape

Run the manifest/module contract, affected owner checks and one realistic assembled flow. Reinspect
imports, data ownership and removed concepts. Use `$system-coherence` to review code quality and
system integration together; material findings reopen the owning change. Pass the stable result to
`$task-quality` for the existing acceptance gates, without creating another review artifact.
