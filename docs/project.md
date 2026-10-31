# Project Manifest

Current capabilities and module boundaries. Workflow policy belongs to
[instructions](../instructions.md), commands to [README](../README.md), and executable schemas to
code/configuration.

Agent workflow authority: `instructions.md`. Optional project context cannot override this manifest.

## Definition

CodexRig is a reusable Codex framework that generates isolated, upgradeable product repositories. It
defines no child product or product stack.

## Users And Outcome

Developers and teams use its inspectable policy, setup, recovery, generation/update and verification
workflows. Acceptance requires the affected contracts and lifecycle checks on the actual candidate;
this manifest is not a record of test results.

## Scope

The source owns the harness, portable policy/tooling, GitHub/GitLab adapters and child migrations.
It supplies no application, public service, product data model, deployment target or domain roadmap.

## System Shape

- Runtime: Node.js ESM and Bash, managed by pnpm and mise.
- Flow: launcher admission → repository-bound session/hooks → scoped work →
  verification/publication. Generated projects receive selected portable files and independently
  owned configuration.
- State: tracked contracts/code/docs/lockfiles; ignored `.codex/runtime/` and `.project-state/`
  coordinate current sessions, evidence and interrupted operations. Accounts remain private;
  installed tools and public caches may use the shared user-tool store.
- Delivery/infrastructure: GitHub/GitLab CI and local toolchain configuration are integrated. No
  product UI/API, runtime identity/tenancy service, infrastructure backend or deployment is
  configured. Portable product validators remain framework capabilities. Source and technical docs
  use English; no child-facing locale set is selected here.

<!-- project:delivery-inventory:start -->

- Product delivery inventory: no integrated product environment.

<!-- project:delivery-inventory:end -->

### Active Module Inventory

#### Workflow Skills

- Root: `.agents/skills`
- Responsibility: Task-specific implementation, maintenance, generation and review procedures;
  shared workflow policy belongs to instructions.md.
- Runtime and technology: Markdown/YAML skill contracts with Node.js ESM for referenced automation.
- Public contract: Each skill's `SKILL.md`, `agents/openai.yaml`, and referenced scripts,
  references, or assets.
- Private internals: Skill-specific guidance and helpers; source-only lifecycle skills are excluded
  from child selection.
- Owned data and migrations: Tracked skill definitions only; no mutable data or migrations.
- Tenant isolation: Framework only; no product tenant data.
- Allowed dependencies: `scripts/context`, `scripts/contracts`, `scripts/docs`,
  `scripts/filesystem`, `scripts/framework`, `scripts/goals`, `scripts/repository`, `scripts/setup`,
  `scripts/terminal`, `scripts/verify`.
- Focused verifier: `node scripts/verify/skill-paths.mjs`
- Steward: Primary framework maintainer.

#### Codex Session And Agent Policy

- Root: `.codex`
- Responsibility: Portable primary/role policy, model/permission defaults and trusted lifecycle-hook
  configuration.
- Runtime and technology: Declarative TOML, JSON, and Markdown consumed by Codex, with lifecycle
  entrypoints implemented in the framework's Node.js/Bash harness.
- Public contract: Tracked `.codex/config.toml`, `.codex/hooks.json`, `.codex/agents/*.toml` and
  their strict configuration validator. Generated policy follows the same source owners; packaging
  tests do not prove long-session model obedience.
- Private internals: Session-local ownership registries, role prompt wording, and sandbox-specific
  settings.
- Owned data and migrations: Tracked role configuration only; no mutable data or migrations.
- Tenant isolation: Framework only; no product tenant data.
- Allowed dependencies: `scripts/context`, `scripts/setup`.
- Focused verifier: `pnpm codex:validate`
- Steward: Primary framework maintainer.

#### Project Context And Recovery

- Root: `scripts/context`
- Responsibility: Work-state validation, context navigation, durable-session continuation and
  repository-bound critical handovers.
- Runtime and technology: Node.js ESM.
- Public contract: `context:map`, bounded `context:read`, `context:check`, `handover:create`,
  `handover:receive`, `handover:acknowledge` and exported portable validators. Receipt requires the
  accepted exact prompt and a distinct canonical session; current authority/capacity are reassessed.
- Private internals: Work-marker revisions, continuation guards, prompt integrity and ignore-policy
  checks.
- Owned data and migrations: Bounded `.codex/runtime/stop-continuation/` state and private transient
  prompts under ignored `tmp/codexrig-handovers/`; no search database or model cache.
- Tenant isolation: Framework only; no product tenant data.
- Allowed dependencies: `scripts/contracts`, `scripts/docs`, `scripts/filesystem`,
  `scripts/repository`, `scripts/security`, `scripts/terminal`.
- Focused verifier: `pnpm context:test`
- Steward: Context capability maintainer.

#### Framework Contracts

- Root: `scripts/contracts`
- Responsibility: Versioned framework, startup, compatibility, platform and
  product/delivery/localization/tenancy contracts; tenancy schema 2 binds module policies to
  enforcement owners.
- Runtime and technology: Node.js ESM.
- Public contract: Exported contract readers, product/delivery/localization/tenancy-configuration
  renderers, normalizers, path guards, and canonical serializers.
- Private internals: Shared constrained TOML parser and schema-specific normalization.
- Owned data and migrations: No mutable data; schemas govern tracked `.codexrig/`, `.codex/` and
  `config/` contracts.
- Tenant isolation: Framework only; no product tenant data.
- Allowed dependencies: `scripts/filesystem`.
- Focused verifier:
  `node --test scripts/setup/startup-state.test.mjs scripts/verify/tenant-isolation.test.mjs scripts/verify/localization.test.mjs scripts/verify/white-label.test.mjs`
- Steward: Framework lifecycle maintainer.

#### Owned Filesystem Safety

- Root: `scripts/filesystem`
- Responsibility: Identity-bound filesystem operations for caller-owned state, independent of
  consuming workflows.
- Runtime and technology: Node.js ESM.
- Public contract: Exported owned-root bindings, stable reads, atomic file replacement, bounded tree
  validation/removal, and identity-checked directory/file mutation helpers.
- Private internals: Descriptor/mount discovery, identity checks, claim naming and durable syscall
  ordering.
- Owned data and migrations: No data; callers retain ownership of every state tree they pass in.
- Tenant isolation: Framework only; no product tenant data.
- Allowed dependencies: None.
- Focused verifier:
  `node --test scripts/setup/startup-state.test.mjs scripts/deps/dependency-policy.test.mjs`
- Steward: Framework filesystem safety maintainer.

#### Dependency Management

- Root: `scripts/deps`
- Responsibility: Compatible dependency/tool/CI resolution, isolated candidate validation,
  transactional pin publication and offline reproduction.
- Runtime and technology: Node.js ESM.
- Public contract: `deps:install`, `deps:report`, `deps:update*` and `maintain-toolchain.mjs`;
  `--startup` discovers releases, `--locked` reproduces frozen CI inputs. Existing lockfiles
  reproduce offline through the same owner.
- Private internals: Resolution/install journals, lifecycle locks, staged revalidation and rollback;
  native collectors retain referenced, live or uncertain state.
- Owned data and migrations: Managed changes to `package.json`, `pnpm-lock.yaml`, and approved
  dependency policy inputs; transient transaction state is disposable.
- Tenant isolation: Framework only; no product tenant data.
- Allowed dependencies: `scripts/contracts`, `scripts/filesystem`, `scripts/repository`,
  `scripts/terminal`.
- Focused verifier:
  `node --test scripts/deps/dependency-policy.test.mjs scripts/deps/tool-storage-housekeeping.test.mjs`
- Steward: Dependency capability maintainer.

#### Documentation Contracts

- Root: `scripts/docs`
- Responsibility: Document ownership, module inventory, delivery projections, links and bounded
  context validation.
- Runtime and technology: Node.js ESM.
- Public contract: `docs:check`, manifest/projection parsers, document classification, Markdown/HTML
  link and heading contracts.
- Private internals: Shared fenced-code parsing and deterministic document traversal.
- Owned data and migrations: No mutable data; validates tracked documentation.
- Tenant isolation: Framework only; no product tenant data.
- Allowed dependencies: `scripts/contracts`, `scripts/filesystem`, `scripts/repository`.
- Focused verifier:
  `node --test scripts/docs/document-scope.test.mjs scripts/docs/project-manifest-contract.test.mjs`
- Steward: Documentation contract maintainer.

#### Framework Lifecycle

- Root: `scripts/framework`
- Responsibility: Source releases, disposable compatibility experiments, clean generation and
  reviewed child updates; excluded from products.
- Runtime and technology: Node.js ESM.
- Public contract: `framework:doctor`, `framework:version`, `framework:upgrade`,
  `compatibility:matrix` and source housekeeping. Updates require explicit target/reconciliation or
  pristine baseline; they preserve product identity, requirements and intentional configuration.
- Private internals: Version/file/hash/mode comparison, conflict plans and journaled target-owned
  recovery; housekeeping reuses valid native pnpm installation state.
- Owned data and migrations: `.codexrig/framework.json`, `.codexrig/compatibility.json` and
  `.codexrig/project-tools.json`; transient target `.project-state/framework-upgrade/` journals.
  Generation and updates project the same portable instructions/AGENTS blocks and verification
  consumers/shared inputs. Customized registry commands require explicit reconciliation; settled
  updates are repeatable with no writes. Products retain no framework installation receipt.
- Tenant isolation: Framework only; no product tenant data.
- Allowed dependencies: `scripts/context`, `scripts/contracts`, `scripts/deps`, `scripts/docs`,
  `scripts/filesystem`, `scripts/goals`, `scripts/platform`, `scripts/repository`, `scripts/setup`,
  `scripts/terminal`, `scripts/verify`.
- Focused verifier:
  `node --test scripts/framework/framework-version.test.mjs scripts/framework/framework-upgrade.test.mjs scripts/framework/framework-upgrade-identity.test.mjs scripts/framework/compatibility-integrity.test.mjs`
- Steward: Framework lifecycle maintainer.

#### Git Hook Adapter

- Root: `scripts/git-hooks`
- Responsibility: Root-bound pre-push adapter that rejects substituted source before accepting
  reusable evidence.
- Runtime and technology: Bash adapter delegating to the Node.js ESM verification boundary.
- Public contract: `scripts/git-hooks/pre-push`.
- Private internals: Git environment sanitization and delegation to the verification entrypoint.
- Owned data and migrations: The installed local pre-push hook; no product data or migrations.
- Tenant isolation: Framework only; no product tenant data.
- Allowed dependencies: `scripts/verify`.
- Focused verifier: `node --test scripts/verify/pre-push.test.mjs`
- Steward: Verification capability maintainer.

#### Goal Lifecycle

- Root: `scripts/goals`
- Responsibility: Repository housekeeping and exact-candidate publication with session, upstream and
  protection admission.
- Runtime and technology: Node.js ESM.
- Public contract: `repo:housekeeping`, `goal:new`, `project:publish`; the source adapter owns
  framework publication. Publication authority, source snapshot binding, upstream/protection and
  session admission remain explicit.
- Private internals: Atomic reconciliation, inventory projection, Git publication and managed
  pre-push; health checks reuse evidence while runtime/freshness checks observe current state.
- Owned data and migrations: Project-owned `config/delivery.json` detected evidence and its bounded
  `docs/project.md` projection; in reusable source only, synchronized framework/package/manifest
  release metadata; no external environment or product data.
- Tenant isolation: Framework only; no product tenant data.
- Allowed dependencies: `scripts/contracts`, `scripts/deps`, `scripts/docs`, `scripts/filesystem`,
  `scripts/repository`, `scripts/setup`, `scripts/terminal`, `scripts/verify`.
- Focused verifier:
  `node --test scripts/goals/repository-housekeeping.test.mjs scripts/goals/goal-publication-precondition.test.mjs scripts/goals/project-publication.test.mjs scripts/goals/project-publication-integration.test.mjs scripts/goals/project-publication-verification.test.mjs scripts/goals/publication-command.test.mjs`
- Steward: Goal lifecycle maintainer.

#### Git Platform Adapters

- Root: `scripts/platform`
- Responsibility: GitHub/GitLab detection and authorized reconciliation of protected branches, CI,
  review and serialization.
- Runtime and technology: Node.js ESM.
- Public contract: `platform:detect`, `platform:configure`; preview is credential-free. Explicit
  apply uses the private provider/host/repository-bound account and reads back effective policy.
- Private internals: Provider clients, pagination, endpoint ownership, capability validation and
  original-operation reconciliation.
- Owned data and migrations: Private bounded pending-operation journal and lock; preserve
  partial/uncertain remote state until verified recovery.
- Tenant isolation: Framework only; no product tenant data.
- Allowed dependencies: `scripts/contracts`, `scripts/filesystem`, `scripts/repository`,
  `scripts/terminal`.
- Focused verifier:
  `node --test scripts/platform/platform-lifecycle.test.mjs scripts/platform/platform-configuration-state.test.mjs`
- Steward: Platform integration maintainer.

#### Repository Boundaries

- Root: `scripts/repository`
- Responsibility: Source inventory, isolated Git/tool environments, worktree/session ownership,
  snapshots, publication admission and owned tool/scratch storage.
- Runtime and technology: Node.js ESM.
- Public contract: `worktree:status` and exported source/path, recovery, lease, snapshot, delivery,
  tool-storage and publication APIs. Caller admission proves exact native-process ancestry; isolated
  release requires independent Git metadata. Git credential fallback is provider/repository-bound;
  public author metadata recovery grants no account authority.
- Private internals: Leases, mutexes, process identity, bounded I/O/cancellation and recoverable
  file batches; incomplete ownership preserves state.
- Owned data and migrations: Ignored writer leases/latest-session markers under `.codex/runtime/`,
  current `.project-state/repository-housekeeping/` journal, private operation-bound credential
  recovery and temporary roots. Full runtime removal requires proven quiescence; no product data is
  owned here.
- Tenant isolation: Framework only; no product tenant data.
- Allowed dependencies: `scripts/contracts`, `scripts/filesystem`, `scripts/terminal`.
- Focused verifier:
  `node --test scripts/repository/source-inventory.test.mjs scripts/repository/worktree-recovery.test.mjs scripts/setup/startup-state.test.mjs scripts/context/context-lifecycle.test.mjs scripts/repository/global-git-credential.test.mjs scripts/repository/git-publication-identity.test.mjs`
- Steward: Repository boundary maintainer.

#### Secret Classification

- Root: `scripts/security`
- Responsibility: Shared local/pushed-content secret classification, including conservative handling
  of ambiguous non-credential matches.
- Runtime and technology: Node.js ESM.
- Public contract: Exported secret patterns and match helpers.
- Private internals: Pattern ordering and false-positive guards.
- Owned data and migrations: No mutable data or migrations.
- Tenant isolation: Framework only; no product tenant data.
- Allowed dependencies: None.
- Focused verifier: `node --test scripts/verify/secrets.test.mjs`
- Steward: Security boundary maintainer.

#### Setup And Project Portability

- Root: `scripts/setup`
- Responsibility: Startup maintenance/admission, native session selection, portable configuration,
  trusted hooks and project export.
- Runtime and technology: Node.js ESM and Bash.
- Public contract: `codex:start`, `codex:validate`, `setup`, `hooks:install`, `project:export`, and
  the common locked project command wrapper. `.codex/tooling.json` owns launcher identity; both
  generation and CI use the same portable contracts.
- Private internals: Preloaded controller, exact SessionStart/Stop hooks, supervisor, PID/terminal
  proofs and current attestations.
- Owned data and migrations: Disposable current-schema startup attestation under
  `.codex/runtime/cache/codexrig/` plus the installed local Git hook. Repository Boundaries owns the
  short-lived writer lease and separate latest-session recovery marker that Setup coordinates.
- Tenant isolation: Framework only; no product tenant data.
- Allowed dependencies: `scripts/context`, `scripts/contracts`, `scripts/deps`, `scripts/docs`,
  `scripts/filesystem`, `scripts/platform`, `scripts/repository`, `scripts/terminal`.
- Focused verifier:
  `node --test scripts/setup/setup-regression.test.mjs scripts/setup/codex-launcher.test.mjs scripts/setup/startup-session-controller.test.mjs scripts/setup/startup-state.test.mjs`
- Steward: Setup capability maintainer.

#### Stack Detection

- Root: `scripts/stack`
- Responsibility: Product-stack detection excluding the Node.js/pnpm/mise harness from product
  evidence.
- Runtime and technology: Node.js ESM.
- Public contract: `stack:detect` and exported stack classification APIs.
- Private internals: Product Root, declared package, source-extension, and toolchain heuristics.
- Owned data and migrations: No mutable data or migrations.
- Tenant isolation: Framework only; no product tenant data.
- Allowed dependencies: `scripts/repository`.
- Focused verifier: `node --test scripts/stack/stack-detector.test.mjs`
- Steward: Verification capability maintainer.

#### Safe Terminal Output

- Root: `scripts/terminal`
- Responsibility: Bounded, sanitized diagnostics and progress; workflow owners decide gates and
  outcomes.
- Runtime and technology: Node.js ESM.
- Public contract: Exported terminal sanitization, context-error formatting and publication progress
  helpers. The publication owner supplies tasks and outcomes; the renderer never decides gates.
- Private internals: Replacement ordering and output bounds.
- Owned data and migrations: No mutable data or migrations.
- Tenant isolation: Framework only; no product tenant data.
- Allowed dependencies: `scripts/security`.
- Focused verifier: `node --test scripts/terminal/terminal-output.test.mjs`
- Steward: Security boundary maintainer.

#### Adaptive Verification

- Root: `scripts/verify`
- Responsibility: Owner/consumer check selection, independent workspace lifecycles and complete
  publication coverage from valid per-unit evidence.
- Runtime and technology: Node.js ESM and Bash.
- Public contract: `verify`, `verify:changed`, `verify:pre-push`, `verify:external`, `docs:check`,
  `auth:check`, `localization:check`, `tenancy:check`, and `format*` commands.
- Private internals: One verification registry and atomic evidence store. Command/input/runtime
  fingerprints, freshness and declared output hashes control reuse; unknown owners stop coverage.
  Audited static checks bind owned data and executable imports. Independent successes survive
  failure; workspace cycles stay grouped.
- Owned data and migrations: One atomic validated evidence record and verification lock under
  ignored `.codex/runtime/`; incompatible disposable evidence is rejected, without a parallel reader
  or receipt history.
- Tenant isolation: Framework only; no product tenant data.
- Allowed dependencies: `scripts/context`, `scripts/contracts`, `scripts/deps`, `scripts/docs`,
  `scripts/filesystem`, `scripts/repository`, `scripts/security`, `scripts/setup`, `scripts/stack`,
  `scripts/terminal`, `scripts/web`.
- Focused verifier: `node --test scripts/verify/adaptive-cli.test.mjs`
- Steward: Verification capability maintainer.

#### Web Quality

- Root: `scripts/web`
- Responsibility: Public web-surface checks and sitemap modification metadata; static results do not
  prove rendered behavior.
- Runtime and technology: Node.js ESM.
- Public contract: `web:update-sitemap-lastmod` and exported web/sitemap scan APIs.
- Private internals: Shared static HTML and sitemap parsing, framework-specific metadata handling
  and false-positive guards for examples/frontmatter.
- Owned data and migrations: Managed sitemap metadata changes only; no service data or migrations.
- Tenant isolation: Framework only; no product tenant data.
- Allowed dependencies: `scripts/repository`, `scripts/stack`.
- Focused verifier: `node --test scripts/web/web-quality-scan.test.mjs`
- Steward: Web quality maintainer.

## Constraints And Decisions

<!-- codexrig:framework-version:start -->

- Framework version: `7.0.0`.
- Framework contract schema: `3`.

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
- Explicit project-tool migrations run from the source framework against current generated output
  with reviewed hash-bound decisions, or an optional pristine reference. File comparison detects
  conflicts, and the target's own runtime lock protects the complete transaction through cleanup.
  Project documents and product identity are preserved; generated projects contain no self-updater
  or installation receipt.

## Maintenance

Keep current facts only. The change that integrates a module must add or update its active inventory
entry and remove the matching candidate from `docs/future-modules.md`. Keep workflow rules in
`instructions.md`, configuration values in their machine-readable owners, and plans, progress,
reviews, and history outside this manifest.
