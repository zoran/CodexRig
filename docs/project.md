# Project Manifest

This is the always-read, concise source of truth for the framework that exists in this repository.
It records integrated capabilities and current operating facts, not workflow policy or a roadmap.

Agent workflow authority: `instructions.md`. Optional project context cannot override this manifest.

## Definition

CodexRig is a neutral, code-first Codex framework and reusable source base. It generates isolated,
upgradeable product repositories while deliberately defining no child product or product stack.

## Users And Outcome

- Target users: developers and teams operating Codex on production-oriented software repositories.
- Problem and desired outcome: provide inspectable project policy, deterministic setup, bounded
  orchestration, semantic retrieval, modular delivery, child updates, and risk-based verification
  without imposing an application architecture before a product is defined.
- Success evidence: the framework doctor, project-generation lifecycle, managed-upgrade lifecycle,
  portable-source contracts, focused capability verifiers, and repository verification pass on the
  exact reviewed source state.

## Scope

- In scope: the reusable Codex harness, clean sibling-project generation, receipt-backed child
  updates, portable GitHub/GitLab adapters, dependency and toolchain policy, semantic retrieval,
  architecture evolution, environment-bound delivery policy, and deterministic verification.
- Non-goals: this source repository does not supply a child product, application runtime, public
  service, product data model, deployment destination, domain roadmap, or provider identity.

## System Shape

- Runtime shape: Node.js ECMAScript modules and shell entrypoints, managed by pnpm and mise.
- Primary flow: the launcher validates and isolates a Codex session; SessionStart injects the
  repository-reconstruction gate; tracked roles, skills, policy, and scripts guide resumed or new
  work; generated projects receive the portable surface and an installation receipt; verification
  selects evidence from current repository risk and delivery identity.
- Durable state: tracked source, configuration, contracts, documentation, tests, and lockfiles.
  `.codex/runtime/`, `.context-index/`, and `.project-state/` are disposable local state.
- Delivery state: no product deployment is integrated in this neutral source.
- Product delivery state is maintained by the bounded inventory below; no deploy operation is part
  of repository housekeeping.
- Product interface and trust state: no product UI, web application, public runtime API, or product
  Identity and Access or tenancy capability is integrated. Framework command contracts and the
  portable Auth, tenant-isolation, responsive-experience, and physical-surface verifiers remain
  inside their owning capability roots rather than a mixed application tree. Framework source,
  identifiers, tests, and technical headers are English; no child-facing locale set exists here.
- Infrastructure state: portable CI lives in `.github/workflows/ci.yml` and `.gitlab-ci.yml`,
  toolchain declarations live in `mise.toml`, `mise.lock`, and workspace manifests, and provider or
  delivery orchestration lives under `scripts/platform` and `scripts/setup`, while goal housekeeping
  lives under `scripts/goals`; none is mixed into a product runtime root.

<!-- codexrig:delivery-inventory:start -->

- Product delivery inventory: this neutral framework source has no integrated product environment.

<!-- codexrig:delivery-inventory:end -->

### Active Module Inventory

#### Workflow Skills

- Root: `.agents/skills`
- Responsibility: Defines discoverable, reusable workflows for implementation, architecture,
  slice-level whole-system coherence repair, retrieval, maintenance, generation, reset, and
  specialist review.
- Runtime and technology: Markdown/YAML skill contracts with Node.js ESM for referenced automation.
- Public contract: Each skill's `SKILL.md`, optional `agents/openai.yaml`, and referenced scripts,
  references, or assets.
- Private internals: Skill-specific implementation detail not named by its `SKILL.md`.
- Owned data and migrations: Tracked skill definitions only; no mutable data or migrations.
- Tenant isolation: Not applicable; source-framework capability with no child product data plane.
- Allowed dependencies: `scripts/context`, `scripts/contracts`, `scripts/docs`,
  `scripts/filesystem`, `scripts/framework`, `scripts/repository`, `scripts/setup`,
  `scripts/terminal`, `scripts/verify`.
- Focused verifier: `node scripts/verify/repository-smoke.mjs`
- Steward: Primary framework maintainer.

#### Codex Session And Agent Policy

- Root: `.codex`
- Responsibility: Injects the primary orchestration contract, exact global agent defaults, reviewed
  lifecycle hooks, least-privilege discovery/worker role requests, and effective-permission
  admission that fails closed when parent runtime overrides defeat a role sandbox.
- Runtime and technology: Declarative TOML, JSON, and Markdown consumed by Codex, with lifecycle
  entrypoints implemented in the framework's Node.js/Bash harness.
- Public contract: Root `developer_instructions` and `[agents]` defaults in `.codex/config.toml`,
  standalone role configuration layers under `.codex/agents/`, `.codex/hooks.json`, and the visible
  operator guide `.codex/README.md`.
- Private internals: Session-local ownership registries, role prompt wording, and sandbox-specific
  settings.
- Owned data and migrations: Tracked role configuration only; no mutable data or migrations.
- Tenant isolation: Not applicable; source-framework capability with no child product data plane.
- Allowed dependencies: `scripts/context`, `scripts/setup`.
- Focused verifier: `pnpm codex:validate`
- Steward: Primary framework maintainer.

#### Context Retrieval

- Root: `scripts/context`
- Responsibility: Builds, checks, searches, refreshes, and safely cleans the repository semantic
  index, owns bounded continuation state, and seals/discovers private critical-budget handovers used
  for explicit cross-session recovery.
- Runtime and technology: Node.js ESM and Bash on the framework's mise-pinned toolchain.
- Public contract: `context:index`, `context:check`, `context:search`, `context:clean`,
  `handover:create`, and the Stop hook entrypoint.
- Private internals: Source classification, token-aware chunking, hybrid lexical/vector ranking,
  implemented-versus-deferred intent weighting, embedding, locking, storage, and generation
  maintenance.
- Owned data and migrations: Disposable `.context-index/` generations, bounded
  `.codex/runtime/stop-continuation/` state, and private transient prompts under ignored
  `tmp/codexrig-handovers/`.
- Tenant isolation: Not applicable; source-framework capability with no child product data plane.
- Allowed dependencies: `scripts/contracts`, `scripts/docs`, `scripts/filesystem`,
  `scripts/repository`, `scripts/security`, `scripts/terminal`.
- Focused verifier: `pnpm context:test`
- Steward: Context capability maintainer.

#### Framework Contracts

- Root: `scripts/contracts`
- Responsibility: Parses and validates versioned framework, compatibility, startup, platform,
  managed-surface, generated white-label product-configuration, delivery-inventory, localization,
  and tenant-isolation contracts.
- Runtime and technology: Node.js ESM on the framework's mise-pinned toolchain.
- Public contract: Exported contract readers, product/delivery/localization/tenancy-configuration
  renderers, normalizers, path guards, and canonical serializers.
- Private internals: Validation helpers and schema-specific normalization.
- Owned data and migrations: No mutable data; schemas govern tracked `.codexrig/` documents.
- Tenant isolation: Not applicable; source-framework capability with no child product data plane.
- Allowed dependencies: `scripts/filesystem`.
- Focused verifier:
  `node --test scripts/framework/framework-lifecycle.test.mjs scripts/verify/api-security.test.mjs scripts/verify/localization.test.mjs scripts/verify/white-label.test.mjs`
- Steward: Framework lifecycle maintainer.

#### Owned Filesystem Safety

- Root: `scripts/filesystem`
- Responsibility: Provides identity-bound, held-directory filesystem operations for repository-owned
  state without belonging to any consuming workflow or data domain.
- Runtime and technology: Node.js ESM over operating-system file descriptors, filesystem identity,
  mount-boundary, mode, and durability primitives.
- Public contract: Exported owned-root bindings, stable reads, atomic file replacement, bounded tree
  validation/removal, and identity-checked directory/file mutation helpers.
- Private internals: Descriptor namespace discovery, mount-info parsing, object-identity comparison,
  temporary claim naming, and syscall ordering.
- Owned data and migrations: No data; callers retain ownership of every state tree they pass in.
- Tenant isolation: Not applicable; source-framework safety capability with no child product data
  plane.
- Allowed dependencies: None.
- Focused verifier:
  `node --test scripts/context/context-maintenance.test.mjs scripts/framework/framework-lifecycle.test.mjs scripts/deps/dependency-policy.test.mjs`
- Steward: Framework filesystem safety maintainer.

#### Dependency Management

- Root: `scripts/deps`
- Responsibility: Resolves, installs, reports, and updates the newest compatible dependency graph
  allowed by tracked ranges, pins, engines, peers, and supply-chain policy.
- Runtime and technology: Node.js ESM orchestrating the pnpm and mise toolchain.
- Public contract: `deps:install`, `deps:report`, and `deps:update*` commands.
- Private internals: Resolution transactions, input normalization, and rollback state.
- Owned data and migrations: Managed changes to `package.json`, `pnpm-lock.yaml`, and approved
  dependency policy inputs; transient transaction state is disposable.
- Tenant isolation: Not applicable; source-framework capability with no child product data plane.
- Allowed dependencies: `scripts/filesystem`, `scripts/repository`, `scripts/terminal`.
- Focused verifier: `node --test scripts/deps/dependency-policy.test.mjs`
- Steward: Dependency capability maintainer.

#### Documentation Contracts

- Root: `scripts/docs`
- Responsibility: Enforces document scope, current-state manifest ownership, the separate deferred
  module inventory, delivery-inventory projection, and project-document reconciliation requirements.
- Runtime and technology: Node.js ESM with deterministic Markdown parsing.
- Public contract: `docs:check`, manifest and delivery-projection parsers, document classification,
  and initialization.
- Private internals: Markdown section parsing and repository-to-manifest discovery.
- Owned data and migrations: No mutable data; validates tracked documentation.
- Tenant isolation: Not applicable; source-framework capability with no child product data plane.
- Allowed dependencies: `scripts/contracts`, `scripts/repository`.
- Focused verifier: `node --test scripts/docs/document-scope.test.mjs`
- Steward: Documentation contract maintainer.

#### Framework Lifecycle

- Root: `scripts/framework`
- Responsibility: Diagnoses framework health, derives the source release version from every change
  since the unique live configured central-remote commit that matches the local tracking ref, and
  performs receipt-backed, transactional, policy-aware child updates and compatibility reporting.
- Runtime and technology: Node.js ESM on the framework's mise-pinned toolchain.
- Public contract: `framework:doctor`, `framework:version`, `framework:upgrade`, and
  `compatibility:matrix` commands.
- Private internals: Conservative SemVer classification, three-way planning, the bounded published
  schema-1-to-2 child bootstrap, journals, ownership locks, rollback, receipt publication,
  dependency refresh, and policy reconciliation plans.
- Owned data and migrations: Child `.codexrig/installation.json` receipts and disposable
  `.project-state/framework-upgrade/` transaction state.
- Tenant isolation: Not applicable; source-framework capability with no child product data plane.
- Allowed dependencies: `scripts/contracts`, `scripts/deps`, `scripts/docs`, `scripts/filesystem`,
  `scripts/platform`, `scripts/repository`, `scripts/terminal`.
- Focused verifier:
  `node --test scripts/framework/framework-version.test.mjs scripts/framework/framework-lifecycle.test.mjs`
- Steward: Framework lifecycle maintainer.

#### Git Hook Adapter

- Root: `scripts/git-hooks`
- Responsibility: Provides the tracked, root-bound pre-push adapter installed into local Git.
- Runtime and technology: Bash adapter delegating to the Node.js ESM verification boundary.
- Public contract: `scripts/git-hooks/pre-push`.
- Private internals: Git environment sanitization and delegation to the verification entrypoint.
- Owned data and migrations: The installed local pre-push hook; no product data or migrations.
- Tenant isolation: Not applicable; source-framework capability with no child product data plane.
- Allowed dependencies: `scripts/verify`.
- Focused verifier: `node --test scripts/verify/pre-push.test.mjs`
- Steward: Verification capability maintainer.

#### Goal Lifecycle

- Root: `scripts/goals`
- Responsibility: Reconciles bounded repository housekeeping after completed goals and proves that a
  goal is clean, published on central `main`, and covered by exact-current successful evidence
  before a new goal begins. Its consolidated health pass also checks delivery, manifest/module,
  white-label, localization, Identity and Access, tenancy, physical-surface,
  source/declaration-header, stack, dependency, secret, model, and framework drift.
- Runtime and technology: Node.js ESM on the framework's mise-pinned toolchain.
- Public contract: `repo:housekeeping` and `goal:new`.
- Private internals: Atomic local reconciliation, health-check orchestration, Git publication,
  source identity, and evidence admission checks.
- Owned data and migrations: Project-owned `config/delivery.json` detected evidence and its bounded
  `docs/project.md` projection; in reusable source only, synchronized framework/package/manifest
  release metadata; no external environment or product data.
- Tenant isolation: Not applicable; source-framework capability with no child product data plane.
- Allowed dependencies: `scripts/contracts`, `scripts/docs`, `scripts/filesystem`,
  `scripts/framework`, `scripts/repository`, `scripts/terminal`, `scripts/verify`.
- Focused verifier:
  `node --test scripts/goals/repository-housekeeping.test.mjs scripts/goals/goal-publication-precondition.test.mjs`
- Steward: Goal lifecycle maintainer.

#### Git Platform Adapters

- Root: `scripts/platform`
- Responsibility: Detects GitHub or GitLab and previews or reconciles equivalent protected-branch,
  review, CI, and merge-serialization policy with provider read-back.
- Runtime and technology: Node.js ESM using credential-free contract parsing and HTTPS adapters.
- Public contract: `platform:detect` and `platform:configure`.
- Private internals: Provider API clients, pagination, host allowlists, and reconciliation state.
- Owned data and migrations: Disposable local reconciliation state; remote changes occur only on an
  explicit primary-owned apply.
- Tenant isolation: Not applicable; source-framework capability with no child product data plane.
- Allowed dependencies: `scripts/contracts`, `scripts/repository`.
- Focused verifier: `node --test scripts/platform/platform-lifecycle.test.mjs`
- Steward: Platform integration maintainer.

#### Repository Boundaries

- Root: `scripts/repository`
- Responsibility: Owns canonical source inventory, Product Root discovery, sensitive-path masking,
  Git runtime isolation, repository-bound session leases, stable snapshots, delivery-environment
  evidence discovery, and transfer-source validation.
- Runtime and technology: Node.js ESM over filesystem and isolated Git process boundaries.
- Public contract: Exported inventory, path-policy, Product Root, runtime-lease, delivery-discovery,
  and snapshot APIs.
- Private internals: Repository inventory, process-identity, session-lifecycle, and Git/Git-less
  traversal detail.
- Owned data and migrations: No mutable data or migrations.
- Tenant isolation: Not applicable; source-framework capability with no child product data plane.
- Allowed dependencies: `scripts/contracts`, `scripts/filesystem`.
- Focused verifier:
  `node --test scripts/repository/source-inventory.test.mjs scripts/framework/framework-lifecycle.test.mjs scripts/context/context-lifecycle.test.mjs`
- Steward: Repository boundary maintainer.

#### Secret Classification

- Root: `scripts/security`
- Responsibility: Owns reusable secret-pattern classification shared by indexing, terminal output,
  and repository verification.
- Runtime and technology: Node.js ESM deterministic pattern contracts.
- Public contract: Exported secret patterns and match helpers.
- Private internals: Pattern ordering and false-positive guards.
- Owned data and migrations: No mutable data or migrations.
- Tenant isolation: Not applicable; source-framework capability with no child product data plane.
- Allowed dependencies: None.
- Focused verifier: `node --test scripts/verify/secrets.test.mjs`
- Steward: Security boundary maintainer.

#### Setup And Project Portability

- Root: `scripts/setup`
- Responsibility: Launches isolated Codex sessions, attests startup, announces safe recent handover
  metadata for developer-controlled resume, validates portable configuration and staged white-label
  tenant-capable projects, installs hooks, initializes repositories, and exports the portable
  surface.
- Runtime and technology: Node.js ESM and Bash on the mise-pinned framework toolchain.
- Public contract: `codex:start`, `codex:validate`, `setup`, `hooks:install`, and `project:export`.
- Private internals: Startup attestations, staged identity binding, bootstrap checks, and transfer
  fixtures.
- Owned data and migrations: Disposable `.codex/runtime/codexrig-session.json` and startup
  attestation state plus the installed local Git hook.
- Tenant isolation: Not applicable; source-framework capability with no child product data plane.
- Allowed dependencies: `scripts/context`, `scripts/contracts`, `scripts/docs`,
  `scripts/filesystem`, `scripts/repository`, `scripts/terminal`, `scripts/verify`.
- Focused verifier: `node --test scripts/setup/setup-regression.test.mjs`
- Steward: Setup capability maintainer.

#### Stack Detection

- Root: `scripts/stack`
- Responsibility: Detects evidenced product stacks and their applicable verification surfaces while
  excluding the repository-root Node.js/pnpm/mise harness from product-stack evidence.
- Runtime and technology: Node.js ESM with stack-neutral product-source discovery.
- Public contract: `stack:detect` and exported stack classification APIs.
- Private internals: Product Root, declared package, source-extension, and toolchain heuristics.
- Owned data and migrations: No mutable data or migrations.
- Tenant isolation: Not applicable; source-framework capability with no child product data plane.
- Allowed dependencies: `scripts/repository`.
- Focused verifier: `node --test scripts/stack/stack-detector.test.mjs`
- Steward: Verification capability maintainer.

#### Safe Terminal Output

- Root: `scripts/terminal`
- Responsibility: Sanitizes paths, secrets, and multiline errors before diagnostics reach terminals.
- Runtime and technology: Node.js ESM deterministic output sanitization.
- Public contract: Exported terminal sanitization and context-error formatting helpers.
- Private internals: Replacement ordering and output bounds.
- Owned data and migrations: No mutable data or migrations.
- Tenant isolation: Not applicable; source-framework capability with no child product data plane.
- Allowed dependencies: `scripts/security`.
- Focused verifier: `node --test scripts/terminal/terminal-output.test.mjs`
- Steward: Security boundary maintainer.

#### Adaptive Verification

- Root: `scripts/verify`
- Responsibility: Routes changed-path and full checks, binds successful evidence to source, runtime,
  Git basis, delivery environment, verified artifact/configuration bytes and a target-specific plan,
  rejects product identity/framework-brand leakage, checks delivery-inventory drift, enforces
  Identity and Access/provider/public-contract and tenant-isolation boundaries, enforces physical
  surface and cross-surface import separation, checks responsive multi-device hazards,
  localization/source-language truth, product-stack drift, and source/declaration-header currency,
  and performs repository quality gates.
- Runtime and technology: Node.js ESM orchestration plus bounded Bash verifier adapters.
- Public contract: `verify`, `verify:changed`, `verify:pre-push`, `verify:external`, `docs:check`,
  `auth:check`, `localization:check`, `tenancy:check`, and `format*` commands.
- Private internals: Risk profiles, command admission, schema-three evidence records, immutable
  delivery manifests, session locks, scanners, and stack-specific check selection.
- Owned data and migrations: One replace-in-place evidence record and verification lock under
  ignored `.codex/runtime/`; no product data or migrations.
- Tenant isolation: Not applicable; source-framework capability with no child product data plane.
- Allowed dependencies: `scripts/context`, `scripts/contracts`, `scripts/deps`, `scripts/docs`,
  `scripts/filesystem`, `scripts/repository`, `scripts/security`, `scripts/stack`,
  `scripts/terminal`, `scripts/web`.
- Focused verifier: `node --test scripts/verify/adaptive-cli.test.mjs`
- Steward: Verification capability maintainer.

#### Web Quality

- Root: `scripts/web`
- Responsibility: Checks public web quality and maintains sitemap modification metadata for detected
  web stacks.
- Runtime and technology: Node.js ESM with stack-neutral web-surface scanning.
- Public contract: `web:update-sitemap-lastmod` and exported web/sitemap scan APIs.
- Private internals: Sitemap discovery, metadata normalization, and stack-specific file matching.
- Owned data and migrations: Managed sitemap metadata changes only; no service data or migrations.
- Tenant isolation: Not applicable; source-framework capability with no child product data plane.
- Allowed dependencies: `scripts/repository`, `scripts/stack`.
- Focused verifier: `node --test scripts/web/web-quality-scan.test.mjs`
- Steward: Web quality maintainer.

## Constraints And Decisions

<!-- codexrig:framework-version:start -->

- Framework version: `2.1.0`.
- Framework contract schema: `2`.

<!-- codexrig:framework-version:end -->

- Root `src/` remains the default child Product Root; a real declared pnpm package or evidenced
  Android Gradle module can activate an additional Product Root.
- No child product identity, product module, product Identity and Access or tenancy capability,
  product surface, public port/protocol, data store, or deployment target is configured in this
  neutral source.
- Tracked `.codex/`, `.agents/`, `.codexrig/`, and `scripts/` surfaces are user-inspectable. Only
  sensitive or disposable runtime state is ignored; normative framework policy is never hidden.
- Generated projects can preview and apply a reviewed source update; the source framework can target
  a child. Managed capabilities update transactionally while project-owned truth is reconciled by
  stable policy identity instead of blind document replacement.

## Maintenance

Keep current facts only. The change that integrates a module must add or update its active inventory
entry and remove the matching candidate from `docs/future-modules.md`. Keep workflow rules in
`instructions.md`, configuration values in their machine-readable owners, and plans, progress,
reviews, and history outside this manifest.
