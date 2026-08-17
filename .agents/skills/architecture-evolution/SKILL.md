---
name: architecture-evolution
description:
  Reassess and evolve product or framework architecture, module boundaries, public contracts, data
  ownership, dependency direction, and repository layout. Use before or during a material change to
  product purpose, domain model, system shape, deployment shape, module
  add/split/merge/retire/replace, cross-module migration, large refactor, or when source layout
  drifts from the active manifest. Do not use for a trivial local edit or a final read-only code
  review.
---

# Architecture Evolution

Keep the implemented system, its ownership boundaries, and its physical file layout aligned as the
project changes. Treat `instructions.md` as workflow authority, `docs/project.md` as current-state
truth, and `docs/future-modules.md` as the only non-authoritative home for unimplemented candidates.

## Reconstruct The Implemented Architecture

1. Read the active manifest and relevant current source before proposing a target shape. Discover
   real Product Roots or source-framework capability roots, composition points, public entrypoints,
   data and migrations, external adapters, delivery environments, focused verifiers, and actual
   dependency direction.
2. Trace representative assembled flows across module boundaries. Do not infer a module from a
   directory name alone, and do not treat a future candidate as active.
3. Compare manifest claims with implementation. Record missing ownership, overlapping roots, deep
   imports, cross-module data writes, cycles, generic dumping grounds, duplicated adapters,
   transitional layers, and files whose location no longer matches responsibility.
4. If product purpose, scope, trust, data, public contracts, or operations remain materially
   ambiguous, resume the focused Project Definition Intake before architecture-dependent writes.

## Place Every Feature In A Domain

For every authorized feature, decide its owner before choosing or editing files. Use implemented
domain language and invariants, owned data and lifecycle, public contracts, actors and trust
boundary, operational responsibility, change reason, and dependencies to choose exactly one path:

1. extend an existing module when those forces stay cohesive with its current responsibility;
2. create a new module in an existing domain when it needs an independently improvable contract,
   lifecycle/data owner, responsibility, or dependency boundary; or
3. establish a new domain and its first module when its language, invariants, actors, data/trust
   ownership, or change reason is materially distinct from every active domain.

Do not infer ownership from the route, screen, endpoint, requested filename, or nearest directory.
UI, web, Identity and Access, public API, infrastructure/delivery, and composition are separately
owned surfaces that adapt or compose domain behavior; they do not silently become its domain owner.
Every non-trivial behavior needs exactly one active module owner. Reject an unclassified Product
Root file or generic `app`, `service`, `shared`, `common`, `utils`, `platform`, or `core` fallback.
When current implementation and confirmed durable truth do not resolve a consequential placement,
ask one focused question before dependent writes instead of guessing. Re-run the decision whenever
new evidence makes an existing boundary incohesive.

## Select Product Surfaces Early

Once user context and critical workflows are understood, derive whether the product should be
web/PWA, installed mobile, installed desktop, CLI/TUI, API/service, worker, library/SDK,
embedded/realtime, or a justified combination. If that remains material, promptly ask in experience
terms—where/how people work, device transitions, install/offline/distribution, OS/hardware,
files/notifications/background execution, browser reach, sharing, and update control—rather than
demanding a platform name. Give one strong evidence-backed topology recommendation with its limits
and at most one close alternative; ask the user to confirm, override, or delegate it. Record
selected but not-yet-integrated topology separately from real roots/deployments in manifest System
Shape. Technology selection follows this decision. Each integrated surface receives its own explicit
interface directory or declared product package, entry/composition boundary, platform adapters, and
public client/contract where exposed. Surface implementations never share a generic `app` root or
deep-import one another. A later surface change reshapes architecture and files.

## Define Localization Before Surfaces Harden

Keep source code, identifiers, filenames, tests, and technical headers English. During creation and
the first intake, determine whether user-facing UI/content, metadata, notifications, support, legal
text, and search need one locale or multiple locales. Confirm default, supported, and fallback
locales plus consequential formatting, text-direction, URL/search, content ownership, and
translation workflow before surface and stack choices make them expensive to change. Keep the
decision in project-owned `config/localization.json` and manifest System Shape; pending is valid
only before product implementation. Locale resources belong to their surface or an explicit shared
localization module behind narrow ports; never clone domain behavior by locale. Material changes
invoke this skill and changed user-facing copy invokes `$native-language-content-review`.

## Select Technology From Requirements

Treat the repository-root Node.js/pnpm/mise stack as harness tooling, never product-stack evidence.
After confirmed manifest requirements and module placement, compare each module or independently
deployable component's platform/ecosystem, hard/soft real-time deadline, tail latency and jitter,
throughput and resource limits, safety/FFI/hardware needs, data/trust/tenant boundary, team and
debug/profile tooling, deployment/rollback/observability, support horizon, and maintenance cost.
Choose the least complex language/framework/runtime that meets the evidence rather than extending a
habitual stack.

Once the confirmed product forces make comparison meaningful, consult current primary/official
ecosystem evidence and give the user one strong primary recommendation per materially different
runtime component, with its manifest-specific rationale, operational cost, material risk, and at
most one close alternative. Ask the user to confirm, override, or explicitly delegate the final
choice before implementation. Do not ask for an unexplained technology preference too early and do
not treat silence or YOLO as confirmation. Record a confirmed but not-yet-integrated selection as a
durable decision without activating a module; populate `Runtime and technology` only as real source
and toolchain evidence lands.

For real-time, low-jitter, systems, embedded, native-integration, or tightly resource-bounded work,
explicitly compare Rust and—where ABI/hardware/certification/native ecosystem or measured
determinism warrants its added memory-safety burden—C/C++. Use a bounded benchmark or spike for a
material performance claim. Do not reject managed runtimes or choose Rust/C without evidence.
Polyglot architecture needs a stable domain/trust/native/performance/deployment boundary whose
benefit exceeds extra toolchain and operator cost; keep narrow versioned contracts and assembled
evidence between runtimes. Record actual integrated choices under each module's
`Runtime and technology` field. `pnpm stack:detect` validates only product evidence; any later
requirement or measured mismatch reopens the architecture and physical-layout decision.

## Rebaseline After Material Change

Explicitly classify every affected current module as `keep`, `split`, `merge`, `rename`, `retire`,
or `replace`. Reconsider the repository layout even when the existing layout can technically hold
more files. A fundamental product or domain change never inherits an old boundary by default.

Choose the smallest cohesive target topology that satisfies current requirements:

- start with a modular monolith unless independent deployment has a concrete operational reason;
- align modules to stable business capabilities or another evidenced ownership boundary;
- give each module one real root, a narrow public contract, private internals, owned data and
  migrations, explicit acyclic dependencies, a focused verifier, and an accountable steward;
- keep provider, transport, persistence, framework, and algorithm choices behind boundary adapters;
- apply the replacement test: consumers should change only at composition, an explicit contract
  migration, or a deliberate data migration;
- keep delivery-environment differences in configuration and deployment adapters, not duplicated
  domain implementations; and
- preserve the white-label boundary: one replaceable product-configuration owner, typed environment
  overlays at composition, separate secrets, presentation-owned themes/assets, and no framework
  identity or brand literal in product-facing surfaces.

Reject a target that merely adds another layer, `shared`, `common`, `utils`, or compatibility shell
without a narrow owner and a scheduled removal condition.

## Separate Runtime And Delivery Surfaces

Classify every affected root as domain/application, UI/presentation, web interface, Identity and
Access, public API contract, public API transport adapter, runtime provider adapter, or
infrastructure/delivery. Use ecosystem-native names, but give each class an explicit separately
owned directory:

- every web/PWA, installed mobile, installed desktop, CLI/TUI, API/service, worker, library/SDK,
  embedded, and real-time surface has an independent interface root or declared product package,
  entry/composition boundary, platform adapters, and exposed public contract/client. No surface
  deep-imports another. Share genuinely common domain/application contracts, view models, design
  primitives, or tokens only from an explicit separately owned shared root; platform lifecycle,
  navigation, screens/routes, OS/browser adapters, assets, and delivery entrypoints remain local;
- domain/application modules contain business behavior and never depend on web, transport,
  provisioning, or provider implementation;
- a requested web app has its own declared package or interface root for routes, screens, assets,
  and browser adapters;
- every UI surface separately owns views/screens and visual components, interaction or presentation
  state, navigation, and transport/API clients. Views consume stable application contracts or view
  models rather than domain internals; visual components own no persistence, remote calls, business
  invariants, or deployment behavior. A design system owns visual primitives and tokens only;
- Identity and Access is a dedicated trust boundary, not UI state, transport middleware, a generic
  security helper, or provider configuration. Give authentication and credentials/authenticators,
  authorization and policy decisions, principal/account lifecycle and user management,
  sessions/tokens, audit/persistence, and provider adapters separate internal directories and files
  behind narrow public ports. UI/web owns only its presentation and client adapter, API transports
  invoke public authentication and policy guards, infrastructure owns only IdP provisioning, and
  product domains keep resource-specific business invariants; none owns credentials, grants,
  sessions, provider SDKs, or Identity and Access internals;
- versioned public API schemas and contracts live apart from transport handlers, and handlers
  consume only module public contracts;
- IaC, CI/CD, environment wiring, and deployment manifests stay outside product runtime modules;
  private runtime adapters may remain inside the module that owns them; and
- composition connects surfaces without becoming a mixed implementation directory.

Assume each UI serves mobile, tablet, and desktop unless narrower scope is user-confirmed. For web,
use a single content-driven responsive information architecture with narrow/medium/wide reflow,
fluid or container-aware layout, feature parity, touch/pointer/keyboard/assistive input, zoom/text
reflow, orientation/safe-area/dynamic viewport handling, responsive media, and constrained-device
performance. Avoid user-agent or physical-device breakpoints, fixed desktop shells/`100vh`, root
overflow masking, hover-only tasks, and copied device-specific domain flows. Keep responsive
tokens/primitives in presentation ownership. Require representative viewport, input, zoom,
loading/error, and slow-network evidence without delaying the latest Dev deploy; completed-goal and
scheduled housekeeping keep the surface-quality guard active.

Use `scripts/verify/path-hygiene.mjs` as the stack-neutral physical guard for these boundaries. It
rejects Product Root-level surface files, UI implementation outside explicit concern directories,
platform-specific SDKs outside their surface, domain/shared imports of a surface, and imports from
one surface implementation into another.

Reject a file or catch-all `app`, `platform`, `server`, `shared`, `security`, or `config` directory
that owns two or more of these change reasons. A new or materially changed UI/web, Identity and
Access, public API, or infrastructure surface requires a physical layout rebaseline even if the
existing directory can hold more files. An Identity and Access change also requires the security
review workflow after implementation.

For authorization, make the server-side policy decision explicit and deny by default. Evaluate the
requested action against the current principal, resource, tenant/relationship, and domain-owned
facts on every protected operation; token presence, client/UI state, caller-supplied
user/tenant/role, or network location is never the authorization decision. Keep identity-provider
assertions and models behind an anti-corruption adapter. Treat session/token creation, rotation,
revocation, reauthentication, expiry, recovery, and audit as an owned lifecycle rather than
incidental handler code, and never log credential, token, session-secret, or recovery values. Keep
provider selection, issuer/audience, redirect origins, and public client IDs in one typed Identity
and Access configuration owner with explicit environment overlays; signing material and provider
credentials remain secret, and provider branding is not a product-brand fallback.

Treat tenancy as a separate cross-cutting trust boundary that every product domain participates in,
not as an Auth provider feature or a database filter. Before the first product implementation,
replace the pending resolution in `config/tenancy.json` with verified sources and establish separate
tenancy context/resolution, policy/isolation, and public-port concerns. Decide and record the actual
isolation model for each module and runtime resource. Propagate immutable tenant context through
authorization, persistence and uniqueness, migrations, cache/files/search, messages/jobs, quotas,
observability, integrations, onboarding/offboarding, exports/deletion, and backup/restore. A raw
caller tenant ID, ambient mutable tenant, implicit default, or authentication success is never
isolation. Put truly global data and cross-tenant control-plane operations behind explicit separate
owners, capabilities, least privilege, and audit. Material tenancy changes require the security
review workflow and cross-tenant negative assembled evidence; the completed-goal and scheduled
housekeeping paths must keep `pnpm tenancy:check` green.

Keep `config/product.json` as the generated child's initial visible white-label owner until an
explicit compatible migration establishes stack-native typed owners. It owns public identity,
brand/theme/assets, public endpoints/contacts, and application IDs, never a generic settings dump or
repository-name branding fallback. Every other setting remains with its module or composition owner.
Configuration resolution and environment-overlay precedence belong at composition; domain modules
receive narrow values or ports, never ambient environment reads. Rebranding or tenant variation
changes configuration, presentation tokens/assets, and adapters without cloning domain code. Keep
`config/delivery.json` as the separate project-owned inventory for the Dev selection default,
developer-declared external targets, and repository-detected integrated environment evidence. It is
not a provider settings or secret store. A delivery-boundary change must remain discoverable by the
completed-goal housekeeping pass and keep its bounded manifest projection current.

## Migrate Architecture And Files Together

Plan a compatibility-first sequence before moving implementation:

1. Introduce or expand the target public contract and composition path.
2. Migrate owned data with an explicit rollback-safe sequence when data ownership changes.
3. Move internals and consumers in dependency order, preserving an assembled working path.
4. Move, rename, or split physical files so their location expresses the new owner. Update each
   moved file's format-native purpose/owner header and each affected class or public type's adjacent
   contract/invariant documentation in the same migration; stale descriptions are architecture
   drift, not harmless comments.
5. Remove retired roots, duplicate adapters, temporary bridges, dead exports, and stale tests after
   all consumers leave them.

Do not leave the old directory topology behind as permanent archaeology. Preserve compatibility only
where a current consumer or rollout requires it, and make the retirement boundary explicit.

## Update Durable Truth At Activation

Update `docs/project.md` only in the same change that makes the target module real and integrated.
The active entry must describe actual root, responsibility, public contract, private internals,
owned data and migrations, allowed dependencies, focused verifier, and steward. Remove the matching
candidate from `docs/future-modules.md` in that same change. If implementation is deferred, leave
the manifest unchanged and keep only a structured future candidate.

A newly voiced idea is not implementation authorization. If it is unclear whether the developer
wants present implementation or only a future option, ask before architecture-dependent writes and
treat it as non-authorizing future intent until confirmed. Do not activate it in the manifest or
record an ambiguous candidate as durable truth.

When a module is retired or merged, remove or rewrite its active entry in the same change that
removes the old implementation root. Keep actual configured/deployed `dev`, `staging`, and `prod`
surfaces truthful; do not document an environment that does not exist.

## Prove The New Shape

Run the manifest/module-architecture contract first, then the focused verifier for every affected
module and a realistic assembled-system flow. Inspect actual imports and owned state again after the
move. Continue review and repair until there are no relevant cohesion, boundary, naming, dependency,
migration, or file-layout findings, then invoke `$system-coherence` to detect competing concepts and
whole-project integration drift before handing the stable implementation to the normal code-pattern
and task-quality workflow.
