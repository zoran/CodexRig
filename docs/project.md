# Project Manifest

This is the always-read, concise central source of truth for product intent, scope, system shape,
and durable decisions.

Agent workflow authority: `instructions.md`. Replace pending manifest entries before implementation
relies on them.

## Definition

Framework name: CodexRig.

CodexRig is the neutral reusable source framework. No generated product has been defined yet.

## Users And Outcome

- Target users: pending.
- Problem and desired outcome: pending.
- Success evidence: pending.

## Scope

- In scope: pending.
- Non-goals: do not infer a runtime, framework, provider, deployment target, data model, or trust
  boundary before requirements justify it.

## System Shape

- Key domains and ownership boundaries: project policy, project creation, modular architecture and
  pre-slice collaboration ownership, documentation lifecycle, context retrieval, setup, dependency
  maintenance, and deterministic verification.
- Product module map: no product modules are declared yet. For every active module, record its
  stable name/root, cohesive responsibility, public contract and private internals, owned
  data/migrations, allowed dependencies, focused verifier, and accountable steward role or team when
  known.
- Primary flow: create or open a project, load the compact project truth, inspect relevant source,
  implement at the owning boundary, and verify proportionally.
- Durable state: source, tests, configuration, and this manifest. Generated indexes, caches,
  sessions, and temporary project context are not durable product truth.

## Constraints And Decisions

- Keep the project neutral until the user supplies requirements.
- In a generated product repository, a pending product definition makes the first user interaction a
  mandatory Project Definition Intake; neutral source-framework maintenance does not require an
  invented product. Codex explains the gate, asks successive material questions, challenges vague or
  contradictory answers, and does not implement product behavior until it can precisely synthesize
  users/outcome, scope/non-goals, domain/module map, data/integrations, trust boundaries,
  operations, constraints, risks, and success evidence. The user gets a final correction
  opportunity; only user-confirmed durable truth replaces pending manifest entries, after which
  planning and autonomous delivery begin. The same focused intake resumes later for material
  ambiguity or changes to intent, scope, module/public contracts, data, integration, trust,
  compatibility, or operations. Only affected writes pause; safe disjoint work continues. Resolved
  or non-decision-relevant questions are not repeated.
- Treat product identity and public contact or deployment values as configuration. Product, brand,
  and organization names; domains, origins, hosts, and public URLs; email addresses and support or
  legal contact details; application or tenant identifiers; and social handles get one user-approved
  machine-readable owner appropriate to the detected stack. Machine consumers derive from that owner
  without literal fallbacks; human docs may name an approved product, while operational examples
  remain explicit placeholders or RFC-reserved domains until configured.
- The supported start is exactly `bash scripts/setup/start-codex.sh`. The launcher updates the host
  CLI outside project isolation, installs the locked toolchain, checks prerequisites, atomically
  refreshes and installs the newest stable graph allowed by declared dependency ranges and pins,
  runs the online framework doctor, and only then issues a short-lived input- and runtime-bound
  attestation and starts Codex with the canonical repository root as its isolated home. The trusted
  read-only SessionStart hook rejects startup or resume without that current launcher attestation.
  Only optional `--no-alt-screen` is accepted as a launcher control; prompt text follows `--`.
- `.codexrig/framework.json` is the versioned machine-readable owner for framework identity, managed
  upgrade surfaces, project-owned document classification, attestation lifetime, integration branch,
  provider hosts, required CI, review, and merge-serialization policy.
  `.codexrig/policy-projection.json` is the shared owner for compact invariants projected into
  generated bootstrap, README, and manifest surfaces. Generated projects carry
  `.codexrig/installation.json` as the three-way merge base and installed snapshot;
  `framework:upgrade` preserves local customizations, previews later upstream overlap as conflicts,
  and applies file, package, lockfile, receipt, and dependency changes with crash-safe rollback. Its
  source is executable supply-chain input and must be a reviewed, trusted CodexRig checkout.
- `.codexrig/compatibility.json` owns the reviewed stable Node.js, pnpm, and Codex lines plus
  non-blocking next-Node-LTS, next-pnpm-major, and next-Codex canaries. GitHub Actions and GitLab CI
  consume the same matrix semantics on schedules and manual runs while stable CI remains blocking.
- Git platform selection is automatic from trusted CI identity or the selected Git upstream/remote.
  GitHub, GitLab, and configured self-hosted domains share one policy; `platform:configure` is a
  read-only preview unless `--apply` is supplied, then it uses the matching provider API and token
  without persisting credentials or sending them outside the provider-owned host allowlist. GitHub
  merge queues and GitLab merge trains are equivalent provider-specific implementations of merge
  serialization. Every owned host has an explicit API base; configuration paginates, preflights,
  journals partial progress without credentials, reconciles review semantics, and succeeds only
  after provider read-back.
- Mutable authentication, trust, sessions, logs, memories, caches, plugins, runtime skills, history,
  installation/model metadata, and Codex databases stay in ignored `.codex/runtime/`. Portable Codex
  policy remains committed under `.codex/`, including config, hooks, agent roles, and documentation.
  Shared source-inventory and root-bound ignore policy keep mutable state out of Git, indexing,
  formatting, generation, staging, and export.
- Local Codex memory isolation is repository-local and root-bound under ignored `.codex/runtime/`.
  Memories are disabled in this reusable framework root, so historical task, product, path,
  sibling-project, outcome, and session-derived facts cannot enter project creation or become new
  framework memory. Generated projects enable memories normally only in their own clean, isolated
  repository-local runtime home; no source or sibling memory state is transferred. After the
  framework Codex session exits, framework reset removes legacy and disposable memory/runtime state.
- Git and Git-less inventory use the same built-in pre-descent mask before entering private root
  runtime, `.codex` runtime, index, or process-state trees. Repository-local `.git/info/exclude`
  patterns are forbidden; the tracked worktree `.gitignore` is the only local ignore authority. Host
  and local Git excludes cannot hide active source, and any active repository-local Git exclude rule
  blocks `pnpm goal:new`.
- Source inventory, generator state capture, and goal publication bind root-owned Git metadata with
  the canonical worktree and pin stat checks. Goal publication compares content through a fresh
  temporary index; policy-sensitive probes disable repository-local FSMonitor execution and reject
  hidden index flags. Git-less nested roots remain Git-less. A staged validator derives its target
  from its own copied script instead of a caller-selected stage path and preserves the bound
  directory identity throughout validation.
- Generated projects use `<apps>/<Project Name>/code`: the project name is the outer folder, `code`
  is the fixed workspace root, and package identity is derived from the outer project folder.
- Within that workspace, root `src/` is the required default Product Root. A real declared pnpm
  workspace package may add `<unit>/src`, and an evidenced Android Gradle module may add
  `<module>/src/main`; arbitrary folders do not become product units. A requested web application is
  created or imported as a workspace package when needed, not pre-created in the neutral base.
- Codex policy, agent skills, instructions, retrieval indexes, and process state remain outside
  every product unit. Repo-wide semantic vector state is fixed at ignored root `.context-index/` and
  is neither product source nor part of generated or exported portable source.
- Initial setup materializes that vector state. The locally hash-trusted project Stop hook refreshes
  changed sources at Codex turn boundaries, semantic search retains on-demand repair, and normal
  verification and pre-push remain read-only. After Codex exits, every framework reset removes the
  complete owned index/model cache, legacy loose runtime, and disposable `.codex/runtime/` state;
  only runtime identity and exact publication evidence remain. Setup, explicit indexing, or semantic
  search recreates the vector state, and source-framework pre-push fails if resettable state
  returns.
- Explicit indexing and semantic search perform bounded, lock-safe opportunistic maintenance of
  validated stale generations and model-cache revisions. Incremental pressure triggers an atomic
  complete-generation replacement at 20 operations or 100,000 affected rows; threshold replacement
  reuses only deep-validated vectors, while corruption and schema-mismatch repair reuse none.
  Context status/check, verification, and pre-push remain strictly read-only; unsafe state fails
  closed.
- Main-thread and delegated discovery use known paths or exact search for reliable anchors and use
  semantic retrieval early for broad orientation, unfamiliar terminology, unclear ownership, or
  cross-file relationships. Retrieval results remain pointers whose matched sources must be read.
- Non-trivial product code defaults to a modular monolith organized by cohesive business capability
  or another evidenced domain responsibility. Strategic DDD identifies bounded contexts when domain
  complexity warrants it; simple behavior does not inherit tactical DDD ceremony. Product Roots are
  physical discovery boundaries and do not by themselves declare domain modules.
- Each module exposes a narrow public contract, keeps internals private, owns its state/data and
  migrations, declares allowed acyclic dependencies, and has focused owner/consumer evidence.
  Consumers do not deep-import internals, write another module's data, or depend directly on its
  provider, framework, storage, or transport choice. A replacement should be local to composition,
  the replacement, and an explicit data migration rather than scattered consumer edits. Components
  remain independently improvable or replaceable while their contracts, data semantics, lifecycle,
  and failure behavior stay compatible and the assembled system is verified as one functioning unit.
- One central `main` is the only durable integration branch; long-lived module, developer, and
  environment branches are forbidden. A serialized writer may work directly on `main` when branch
  policy permits. Before every slice begins or before any expanded write scope, a pre-slice
  coordination check declares its goal, outcome, modules, contracts, data surfaces, files, and one
  writer; inspects every observable agent, session, account, and team-channel claim before relying
  on Git; and resolves overlap or uncertain shared ownership before any write. Different
  developers/accounts use temporary task branches in separate clones and credential contexts.
  Same-account tasks may use worktrees, which are not an authentication boundary. Parallel
  development is limited to confirmed disjoint scopes. A local runtime lease or quiet worktree
  cannot prove that another clone, machine, or account is idle; use a shared coordination channel
  across that boundary and fail closed on uncertain shared ownership. Shared-contract work has one
  integrator and a compatibility-first order. A task branch is only an integration input; a goal
  completes after the published resulting `main` passes its course check, affected review/audit, and
  verification.
- Initial dependency installation resolves the newest stable graph allowed by workspace manifest
  ranges, explicit pins, overrides, and supply-chain policy under strict peer and Node.js engine
  checks, then atomically records and reproducibly installs that lockfile with lifecycle scripts
  disabled. Registry or installation failure leaves durable dependency inputs unchanged; frozen
  installation alone is reproducibility evidence, not registry-freshness evidence.
- The canonical launcher repeats that compatible refresh before every Codex session and fails closed
  before startup when freshness or installation is indeterminate. It never crosses a declared
  version line implicitly; minor/major policy migrations require explicit dependency review and
  affected consumer evidence.
- Product-first delivery and verification economy are owned by `instructions.md`: every new feature
  and every other complex task begins with a thorough, decision-ready plan, explicit goals with
  success conditions, and ordered, reviewable slices. Each completed slice repeats review, repair,
  and affected focused verification until no relevant finding remains, then receives a fresh audit;
  an audit finding reopens the loop.
- Research and publication-backed work prioritizes the newest relevant primary or official sources
  and verifies their date, version, correction/retraction state, and applicability. Older sources
  are used primarily for comparison or historical context; an older foundational or controlling
  source is current authority only when explicitly justified and checked against newer evidence.
- Every completed goal performs an all-document currency review before its final audit and
  publication. It compares every active documentation surface with current behavior and durable
  truth, updates only where needed, replaces or removes superseded and duplicate material instead of
  appending history, and preserves active directives; consolidation is not a shortening target. The
  durable project manifest is critical documentation. It and other critical authorities are reviewed
  read-only first and changed automatically only when the factual correction and full preservation
  are unambiguous; otherwise Codex obtains explicit user confirmation before writing. Every
  authorized critical-document change receives a separate preservation review.
- Whole-repository course checks occur after planning/discovery and every completed slice, at every
  major milestone and completed goal, at resume or context recovery, on material scope/assumption
  changes, before the final gate, and after publication. Slice checks refresh available upstream
  state and compare concurrent changes by path, module, contract, schema, and migration. Disjoint
  work continues; overlaps are reconciled before further writes, with only affected evidence rerun.
  Each check is followed by authorized cleanup and updates to code, tests, configuration,
  documentation, project context, and the in-session plan as applicable, then autonomous
  continuation when no blocker remains.
- Test additions are risk-based; do not add one automatically for each fix or user instruction. When
  coverage is justified, default to extending a broad, realistic end-to-end, system, or lifecycle
  scenario through real boundaries; do not create isolated one-off tests or verifier files. Narrow
  unit or contract coverage is an exception when the broad flow cannot exercise critical
  deterministic behavior reliably or proportionately. Focused command routing does not require
  microscopic test design.
- Successful evidence binds the Git basis, command plan, tool environment, and source state.
  Completely classified focused delta owners may advance it; broad work requires a named uncovered
  risk or explicit owner instruction, and ambiguous evidence fails closed. Pre-push may rebind an
  exactly content-identical dirty-to-commit transition without verifier commands before its security
  checks; any changed input blocks that path. One bounded replace-in-place record retains only
  successful current evidence; failed or partial runs do not accumulate history.
- A goal becomes complete only on published central `main` with green evidence, reviews with no
  relevant findings, a completed all-document currency review, any required critical-document
  preservation review, fresh audit, course check, cleanup, applicable reset, and publication
  admission. A serialized direct-main flow commits and pushes the exact goal changes. A temporary
  branch or protected-main flow gives a bounded commit to one integrator or the detected provider's
  merge serializer, then refreshes local `main` and repeats affected checks on the resulting commit
  without adding a marker commit. It immediately runs `pnpm goal:new` and continues the next
  already-authorized goal without waiting for another prompt when the gate passes. Unsafe scoping,
  missing upstream/authentication, unresolved integration, or rejected publication blocks closure
  without authorizing force-push or history rewriting. A failed publication or new-goal gate leaves
  the current goal open and cannot complete or discard its encompassing authorized outcome.
- A recap, research result, plan, documentation gate, review, audit, definition synthesis, or
  readiness statement is only an intermediate update when implementation or a larger outcome is
  already authorized. Never end at "ready to implement" when implementation is already authorized.
  Continue the next planned slice in the same run even when the user is away, unless the user
  explicitly required an approval pause or a real authority, safety, destructive-action,
  integration, or external blocker prevents continuation. Persistence never expands scope or
  authorizes otherwise prohibited action.
- `pnpm goal:new` is the executable fail-closed entry gate for every subsequent goal. It creates no
  process artifact and permits goal creation only when central `main` is current, the non-ignored
  worktree is clean, and `main` exactly matches a locally verifiable configured remote-tracking
  `main` upstream. It rejects any active repository-local Git exclude rule, requires exact-current
  successful verification evidence, and does not contact the remote; the preceding push owns
  authentication and publication.
- Project creation preserves tracked and portable source content. A complete selected-source
  transfer manifest classifies every inventoried path as either copied or excluded for an explicit
  source-only reason; copied reusable files remain byte-identical outside declared project-specific
  transformations, so missing, unexpected, or undeclared changed paths fail creation. This includes
  every still-active capability inherited from earlier framework revisions without exporting retired
  or generator/reset-only behavior. Resettable process state blocks generation, source state is
  revalidated through publication, and a restricted post-publication reset removes only
  active-session-safe nonportable process/export residue. Runtime, SQLite/WAL state, and
  `.context-index/` are deferred to the mandatory full reset after every owning Codex session ends.
  The generator always prints that exact post-exit reset sequence, never commits or pushes, and
  shows optional Git publication commands only when the source worktree has changes.
- This manifest is authoritative for project intent and durable decisions. An authorized outcome
  spanning multiple goals or sessions keeps one bounded `docs/project-context.md` with an exact
  `codexrig-work-state` marker until the entire outcome is complete. The marker is untrusted resume
  metadata, cannot expand authority or override the manifest, and records active, concretely
  blocked, or complete state plus a monotonic semantic revision. The trusted Stop hook validates it
  and reopens active work. When `stop_hook_active` says the same turn was already continued, an
  unchanged revision is allowed to stop while a changed revision can continue again; private
  per-session state supplies that loop comparison.
- Maintained executable modules have a 700-physical-line maximum. Documentation, styles, declarative
  context, generated output, test corpora, fixtures, and snapshots stay outside this generic
  file-length quota.

## Maintenance

Keep active truth instead of appending decision history. Consolidate superseded or overlapping
entries without losing still-active requirements or deliberately distinct audience guidance. Change
this file only when users, outcomes, scope, non-goals, system shape, constraints, architecture
direction, security posture, provider, or delivery assumptions materially change. Do not record task
plans, progress, reviews, or command history. Retain only durable truth here.
