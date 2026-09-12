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
  orchestration, durable context recovery, modular delivery, child updates, and risk-based
  verification without imposing an application architecture before a product is defined.
- Success evidence: the framework doctor, project-generation lifecycle, managed-upgrade lifecycle,
  portable-source contracts, focused capability verifiers, and repository verification pass on the
  exact reviewed source state.

## Scope

- In scope: the reusable Codex harness, clean sibling-project generation, receipt-backed child
  updates, portable GitHub/GitLab adapters, dependency and toolchain policy, durable context
  recovery, architecture evolution, environment-bound delivery policy, and deterministic
  verification.
- Non-goals: this source repository does not supply a child product, application runtime, public
  service, product data model, deployment destination, domain roadmap, or provider identity.

## System Shape

- Runtime shape: Node.js ECMAScript modules and shell entrypoints, managed by pnpm and mise.
- Primary flow: the launcher validates and isolates a Codex session; SessionStart binds its private
  lease/recovery state and injects the resilient repository-reconstruction gate; tracked roles,
  skills, policy, and scripts guide resumed or new work; generated projects receive the portable
  surface and an installation receipt; verification selects evidence from current repository risk
  and delivery identity.
- Durable state: tracked source, configuration, contracts, documentation, tests, and lockfiles.
  `.codex/runtime/` and `.project-state/` are disposable local state.
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
  combined code/system review, UI/UX preservation review, maintenance, generation, reset and
  explicitly requested post-exit source publication through `framework:publish`. Discovery follows
  canonical instructions rather than a separate skill; specialist reviews remain conditional on the
  affected surface.
- Runtime and technology: Markdown/YAML skill contracts with Node.js ESM for referenced automation.
- Public contract: Each skill's `SKILL.md`, `agents/openai.yaml`, and referenced scripts,
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
- Responsibility: Injects the primary orchestration contract, exact global agent defaults, an empty
  project-file hook declaration, least-privilege discovery/worker role requests, and
  effective-permission admission that fails closed when parent runtime overrides defeat a role
  sandbox. The setup controller injects and narrowly trusts the two lifecycle hooks at issue time;
  SessionStart requires complete same-clone worktree/session reconstruction before intake or writes.
  Native developer instructions carry long-session continuation, course/capacity checkpoints and
  incremental cleanup guidance through the existing policy layer, including primary-only work.
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

#### Project Context And Recovery

- Root: `scripts/context`
- Responsibility: Owns durable work-state validation, preloaded Stop continuation, portable context
  contracts, and private critical-budget handover creation, discovery, full receipt and exact-file
  acknowledgement. The existing continuation response reminds the primary to reconcile outcome,
  whole-project effects, proportionality, cleanup and current documentation before further work.
- Runtime and technology: Node.js ESM and built-ins on the framework's mise-pinned toolchain.
- Public contract: `handover:create`, `handover:receive`, `handover:acknowledge`, exported portable
  context validators, and the preloaded Stop lifecycle. Receipt requires an active canonical session
  distinct from the sealing session and the exact accepted repository-bound artifact;
  acknowledgement removes only unchanged received bytes, not native conversation history.
- Private internals: Work-marker validation, bounded continuation loop state, private prompt binding
  and digest checks, and required portable-policy declarations.
- Owned data and migrations: Bounded `.codex/runtime/stop-continuation/` state and private transient
  prompts under ignored `tmp/codexrig-handovers/`; no search database or model cache.
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
- Private internals: One constrained portable-TOML parser, validation helpers, and schema-specific
  normalization; no parallel parser exists.
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
  `node --test scripts/framework/framework-lifecycle.test.mjs scripts/deps/dependency-policy.test.mjs`
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
  Startup and repository verification consume the same local installation validator, so an
  unrecorded managed-file edit cannot pass verification while preventing the next start.
- Runtime and technology: Node.js ESM on the framework's mise-pinned toolchain.
- Public contract: `framework:doctor`, `framework:version`, `framework:upgrade`, and
  `compatibility:matrix` commands; `frameworkInstallationFindings` provides local receipt
  diagnostics to startup and verification consumers.
- Private internals: Conservative SemVer classification, current-schema target validation, three-way
  planning, journals, ownership locks, rollback, receipt publication, dependency refresh, and policy
  reconciliation plans.
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
- Responsibility: Provides the tracked, root-bound pre-push adapter installed into local Git and
  rejects staged or unstaged substitute content before any reusable-evidence success message.
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
  before a new goal begins. The primary consumes the read-only Worktree Settlement trigger after
  every completed slice and keeps a goal open until all no-longer-needed goal-owned worktrees,
  branches, session/recovery claims, and cleanup artifacts reach an explicit terminal disposition;
  preservation alone is safety, not completion. Its consolidated health pass also checks delivery,
  manifest/module, white-label, localization, Identity and Access, tenancy, physical-surface,
  source/declaration-header, stack, dependency, secret, model, and framework drift. Apply mode also
  accepts Git-less roots, clears proven-dead worktree writer leases, restores missing or invalid
  recovery from the exact active-phase lease during normal release or stale cleanup, and retains any
  valid latest marker; a current process identity observed outside its bound PID namespace or
  otherwise mechanically indeterminate remains an ownership-confirmation blocker. It preserves
  existing directories with broken Git links until their ownership is explicitly confirmed and
  removes only registrations whose missing paths remain held by exact process-bound non-directory
  reservations across the native prune while process-bound Git locks protect every non-missing
  linked sibling and every actual unfinished worktree. A shared process-bound transaction in the Git
  common directory records every reserved path and preservation reason before prune, preserving
  discovery after registration removal. Only unchanged current-contract cleanup artifacts with a
  proven-dead exact owner are recovered after a crash. Reset treats missing or unobservable Linux
  procfs and permission-obscured descriptor state for an exact-root-bound process as indeterminate
  rather than inactive.
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
  Git runtime isolation, every same-clone worktree inventory, repository-bound writer leases and
  exact latest-session recovery markers, Git-less root classification, safe classification and
  preservation of broken worktree links, the shared crash-recoverable prune transaction, path
  reservations and preservation locks, stable snapshots, delivery-environment evidence discovery,
  and transfer-source validation. Per-root inconsistencies remain visible without discarding other
  safe inventory; orphan recovery corruption is advisory unless writer ownership is also unsafe.
- Runtime and technology: Node.js ESM over filesystem and isolated Git process boundaries.
- Public contract: `worktree:status` with current/unfinished/settled human markers plus exported
  inventory, path-policy, Product Root, worktree-recovery, runtime-lease/session-recovery,
  delivery-discovery, and snapshot APIs.
- Private internals: Repository inventory, process-identity, session-lifecycle, isolated Git,
  launcher/writer liveness aggregation, per-root recovery classification, and Git/Git-less traversal
  detail. The session lease accepts only current schema 6 with namespace-bound coordinator,
  supervisor, and exact Codex process identities. Lease mutation authenticates the exact controller
  caller, terminal child proof becomes a durable `completed` transition before release, and a
  crashed child-PID handoff, corrupt state, or any other mechanically indeterminate state fails
  closed. Isolated Git accepts only an ordinary terminal result or the exact bounded managed-sandbox
  completion marker with matching PID, arguments, status, signal, and output contract.
- Owned data and migrations: Private ignored per-worktree writer lease and latest verified Codex
  session recovery marker under `.codex/runtime/`. Full reset holds the lifecycle lock, proves
  repository-wide runtime quiescence, and removes incompatible private runtime without interpreting
  another lease schema. No product data.
- Tenant isolation: Not applicable; source-framework capability with no child product data plane.
- Allowed dependencies: `scripts/contracts`, `scripts/filesystem`.
- Focused verifier:
  `node --test scripts/repository/source-inventory.test.mjs scripts/repository/worktree-recovery.test.mjs scripts/framework/framework-lifecycle.test.mjs scripts/context/context-lifecycle.test.mjs`
- Steward: Repository boundary maintainer.

#### Secret Classification

- Root: `scripts/security`
- Responsibility: Owns reusable secret-pattern classification shared by terminal output and
  repository verification.
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
- Responsibility: Updates the host Codex CLI before admission and stops on update failure, then
  opens the native resume picker with repository-root CODEX_HOME and explicit working directory. It
  reserves the checkout before selection and binds the selected session only at authenticated
  SessionStart, preloads every lifecycle module, accepts bounded non-executable Codex
  model/reasoning preferences beneath tracked project policy, rejects executable or unknown ignored
  runtime configuration, projects the tracked Astra/`ultra` policy into every fresh or resumed CLI
  launch, and injects exactly two session-owned hook definitions. Codex's stable `hooks/list`
  inventory must contain only those exact trusted/enabled definitions; only afterward may the
  controller bind the gated supervisor, durable handoff, and exact Codex PID. Lease release requires
  the exact controller to authenticate the supervisor's terminal child-exit proof against its
  private issue-time gate secret and persist completion; a wrapper exit code alone is insufficient,
  and cancellation before SessionStart creates no activation or recovery record. The embedded
  built-in-only client is bound to the controller's exact Node executable and token-bound loopback
  endpoint. The capability also validates portable configuration and staged white-label
  tenant-capable projects, installs hooks, initializes repositories, and exports the portable
  surface.
- Runtime and technology: Node.js ESM and Bash on the mise-pinned framework toolchain.
- Public contract: `codex:start`, `codex:validate`, `setup`, `hooks:install`, and `project:export`.
- Private internals: Atomic native-picker reservation and authenticated selected-session binding,
  preloaded session controller, private typed non-executable runtime-config validation, exact
  model/reasoning CLI projection, absolute external Node.js/Codex/pnpm/hook-shell executable
  binding, built-in gated supervisor, token-bound proof, and parent-liveness channel, exact
  child-PID handoff, exact session-hook hash/CLI projection plus stable hook-list preflight,
  embedded lifecycle client, startup attestations, staged identity binding, prepared-state checks,
  and transfer fixtures.
- Owned data and migrations: Disposable current-schema startup attestation under
  `.codex/runtime/cache/codexrig/` plus the installed local Git hook. Repository Boundaries owns the
  short-lived writer lease and separate latest-session recovery marker that Setup coordinates.
- Tenant isolation: Not applicable; source-framework capability with no child product data plane.
- Allowed dependencies: `scripts/context`, `scripts/contracts`, `scripts/docs`,
  `scripts/filesystem`, `scripts/repository`, `scripts/terminal`, `scripts/verify`.
- Focused verifier:
  `node --test scripts/setup/setup-regression.test.mjs scripts/setup/codex-launcher.test.mjs scripts/setup/startup-session-controller.test.mjs scripts/framework/framework-lifecycle.test.mjs`
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
  `scripts/filesystem`, `scripts/framework`, `scripts/repository`, `scripts/security`,
  `scripts/stack`, `scripts/terminal`, `scripts/web`.
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

- Framework version: `3.2.0`.
- Framework contract schema: `2`.

<!-- codexrig:framework-version:end -->

- Root `src/` remains the default child Product Root; a real declared pnpm package or evidenced
  Android Gradle module can activate an additional Product Root.
- Every internal concern retains one current contract only. Owned state and all consumers migrate in
  one coherent change; superseded schemas, readers, writers, shims, paths, tests, and documentation
  are removed. No runtime, reset, or framework-upgrade path interprets a superseded internal schema.
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
