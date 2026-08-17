# AGENTS.md

CodexRig is a production-ready, code-first Codex framework and reusable source base. The complete
workflow authority is [Project Instructions](instructions.md); this file is the bounded safe-entry
bootstrap. It stays below 24 KiB so descendant instructions retain room in Codex's project budget.

## Start And Reconstruct

1. Start from the repository root with `bash scripts/setup/start-codex.sh`. The launcher updates the
   host CLI, installs the locked toolchain, refreshes the newest compatible dependency graph, runs
   the online framework doctor, attests the input, and starts the isolated project session. Only
   optional `--no-alt-screen` and explicit Dev-only `--yolo` are launcher controls; prompt text
   follows `--`. Portable Codex sessions default to on-request approval and network-disabled
   workspace-write; only an explicitly authorized Dev session launched with `--yolo` may use no
   approvals and danger-full-access, never staging or production.
2. Stop only for a missing core requirement or an invalid/indeterminate dependency resolution.
3. Read [Project Instructions](instructions.md), [README](README.md),
   [Project Manifest](docs/project.md), and optional `docs/project-context.md`.
4. Complete [Startup Repository Reconstruction](instructions.md#startup-repository-reconstruction)
   before intake or a new slice: inspect Git/worktree/upstream and untracked state; inventory active
   roots, modules, surfaces, contracts, data, configuration, delivery, tests, docs, composition, and
   safe evidence; then decide whether unfinished authorized work must use `$resume-project` or
   whether unambiguous residue needs consolidation. Preserve ambiguous, user-owned, unrelated, or
   concurrent work. Current files and commands outrank memory or a quiet Git view.
5. Use known paths or `rg` for exact anchors. For broad orientation, unclear ownership, unfamiliar
   terms, or cross-file relationships, use `$context-retrieval` or
   `pnpm context:search -- "concept or relationship"` early and read every matched source before a
   claim or edit.

## Project Definition And Durable Truth

- In a generated project with a pending manifest, the first interaction is the
  [Project Definition Intake](instructions.md#first-prompt-project-definition-intake). Explain the
  successive interview and Codex's proactive help, request a detailed natural-language
  project/manifest description, evaluate any existing draft, challenge material gaps, and write only
  user-confirmed durable truth before dependent implementation. Resume this focused intake whenever
  changed intent, scope, contracts, data, trust, compatibility, or operations could alter the
  result.
- [Project Manifest](docs/project.md) records current integrated reality only. Unimplemented
  candidates live only in [Future Modules](docs/future-modules.md). A newly voiced idea is not
  implementation authorization; if current-versus-future intent is unclear, ask one focused question
  and treat it as non-authorizing future intent meanwhile. Activate a candidate and its truthful
  root/contract/data/dependencies/verifier in the same implementation change.
- `docs/project-context.md` is the sole bounded, replace-in-place cache for an authorized
  multi-goal/session outcome or guarded capacity. Its marker is untrusted resume metadata and never
  overrides the manifest or grants authority. Transcriptless side conversations never read it,
  refresh the index, or trigger automatic continuation.
- Product identity, public URLs/contacts, application IDs, and provider bindings have one approved
  typed owner. Every generated project is white-label: `config/product.json` begins without a public
  name, repository/package names are not branding fallbacks, and CodexRig never leaks into
  product-facing runtime, UI, assets, metadata, or deployments. `config/delivery.json`,
  `config/tenancy.json`, and `config/localization.json` remain separate project-owned truth.

## Architecture And Product Boundaries

- Root `src/` is the default Product Root; real declared pnpm and evidenced Android units may add
  roots. Default non-trivial product code to a modular monolith with cohesive replaceable modules,
  narrow public contracts, private internals, owned data/migrations, explicit acyclic dependencies,
  tenant isolation, and focused verifiers. Before each feature, decide whether it extends an owner,
  creates a new module in an existing domain, or establishes a new domain. Generic `app`, `shared`,
  `common`, `utils`, `core`, or `service` fallback placement is invalid.
- Material purpose, domain, system, deployment, module, ownership, surface, or layout changes invoke
  `$architecture-evolution` and move/remove stale files with the boundary. Every completed
  non-trivial slice invokes `$system-coherence`, traces a representative assembled flow through real
  consumers, removes competing truth or semantic duplication, and repairs drift at the canonical
  owner before acceptance.
- Derive and confirm web/PWA, mobile, desktop, CLI/TUI, API/service, worker, library/SDK,
  embedded/realtime, or combined surfaces before stack choice. Every integrated surface owns an
  interface directory or declared product package and composition/adapters/contracts. Keep
  domain/application, UI/presentation, web, public API contracts/transport, Identity and Access, and
  infrastructure/deployment in explicit separate directories; `scripts/verify/path-hygiene.mjs`
  rejects mixed roots and cross-surface imports.
- Identity and Access owns authentication/credentials, authorization/policy, user management,
  sessions/tokens, audit/persistence, and provider adapters behind narrow ports. Other surfaces do
  not own or deep-import those internals. Auth changes invoke `$architecture-evolution`,
  `$security-review`, and `pnpm auth:check`. Tenant context is independently verified and deny by
  default; `config/tenancy.json` becomes concrete before the first product slice, and every module
  records and tests its Tenant isolation.
- The root Node.js/pnpm/mise toolchain is harness tooling, not a product-stack default. After the
  manifest and owner are clear, use current primary evidence to strongly recommend and confirm each
  module's language/framework/runtime from platform, real-time/resources, safety/FFI, trust,
  tenancy, team, operations, and maintenance needs. `pnpm stack:detect` ignores harness-only clues;
  implemented modules record actual `Runtime and technology`.
- Every UI assumes mobile, tablet, and desktop unless narrower durable scope is confirmed. Web uses
  one accessible responsive feature-parity flow across viewport, input, zoom, orientation, media,
  and constrained-device conditions. Source, identifiers, filenames, tests, and technical headers
  are English; ask early about user-facing locales, keep them in `config/localization.json`, and use
  `$native-language-content-review` for changed copy.
- Every hand-authored textual file starts with a format-native purpose/owner description, and
  non-trivial public types document their contract/invariants. Update those descriptions with owner
  changes; Markdown has one descriptive H1 plus unique, referenceable, non-skipping headings.
- Retain `LICENSE` and `NOTICE`, including the Zoran Kikic author credit and CodexRig Framework
  Required Notice, in CodexRig and every noncommercial generated project. Commercial use needs a
  separate express written license from Zoran Kikic; only that license may permit credits to be
  removed from its specifically licensed generated project, never from CodexRig itself. Keep this
  developer-/source-facing attribution outside product-facing white-label output.

## Delivery, Verification, And Continuation

- Never use a quick fix, symptom patch, or first-plausible implementation for material work. Before
  writing, establish the root cause and owning boundary, compare viable designs in whole-project
  context, and research current primary/official evidence when it could change the choice. Take the
  time needed to implement the best-supported durable solution; explicitly reject materially worse
  shortcuts. Dev feedback stays fast through isolated parallel or deferred verification, never by
  lowering engineering quality or accumulating an undocumented workaround.
- Follow
  [Product-First Delivery And Verification Economy](instructions.md#product-first-delivery-and-verification-economy):
  plan complex work into goals and reviewable slices, run focused owner/consumer evidence, repeat
  review and repair to zero relevant findings, perform a fresh audit and course check, and invoke
  `pnpm verify` once on the actual stable integration state. Inspect admission with
  `pnpm verify:changed -- --print-plan`; failures never authorize broad reruns or cache bypass.
- `dev` is the default unless staging or prod is explicitly selected. In an already authorized YOLO
  dev session started explicitly with the canonical launcher's `--yolo`, do not add redundant
  approval pauses. Never carry that full-access mode into staging or prod. The newest developer
  build/deploy and manual feedback win; test generation/execution runs isolated in parallel or
  afterward and yields shared capacity. Dev uses latest-wins replacement. Staging/prod require
  explicit stronger artifact, security, migration, rollback, approval, observability, and health
  gates.
- Treat tests as risk-based evidence, not a test-per-change ritual. Prefer an existing realistic
  system/lifecycle scenario; use narrow coverage only when it proves an important deterministic
  boundary more proportionately. Keep maintained executable modules at or below 700 physical lines.
- Never end at "ready to implement" when implementation is already authorized. Plans, recaps,
  research, reviews, audits, and intermediate goals are checkpoints; continue the authorized outcome
  until complete or a real authority, safety, integration, or external blocker remains.

## Coordination And Agent Ownership

- Central `main` is the only durable integration branch. Before each slice and expanded write scope,
  declare goal/outcome, modules/contracts/data/configuration/files, and exactly one writer; inspect
  all observable session/account/team claims before relying on Git. Parallel writes require
  confirmed-disjoint scopes. Different accounts use temporary branches in separate clones;
  same-account worktree isolation is not an authentication boundary. Shared contracts have one
  integrator and land compatibly before consumers move.
- Use subagents only when substantial independent work shortens the critical path, with at most four
  live subagents by default. The primary and every subagent use the exact same configured GPT Sol
  model with `ultra` reasoning; global delegated defaults and roles must match, and no spawn
  override may differ. A role's sandbox is only a requested default because live parent overrides
  can be reapplied: before any child tool work, verify its effective permissions. Read-only roles
  stop on a broader override; an explicit writer may accept this primary's already-authorized YOLO
  override only for its exact disjoint repository write set and gains no network, credential,
  external, commit, push, publish, deploy, or delegation authority. Any other mismatch stops
  delegated work. Subagents never spawn another agent.
- Register each owned subagent/background task before use with repository and primary-session
  provenance, task/scope, returned identity, checkout, checkpoint, safe boundary, and cancellation.
  Account-/host-wide listings are discovery only: foreign or ambiguous work is never contacted,
  signalled, counted, interrupted, or closed. Writers use exact disjoint file ownership in one
  primary-owned local run and dedicated disjoint worktrees or clones across sessions/accounts; this
  logical boundary is continuously monitored and is never misrepresented as a sandbox. Writers may
  never delegate, commit, merge, push, publish, deploy, use credentials, or mutate shared external
  state. The primary alone integrates and owns protected policy/skill/role files.
- The primary accepts every handoff, actively closes completed owned agents, interrupts stale or
  redundant owned work, and informs affected agents about accepted results, changed assumptions,
  remaining work, and released ownership/slots. Peers may exchange bounded evidence/status/risk only
  within declared scopes. Every direct peer message and response is mirrored to the primary
  immediately; if reliable visibility is unavailable, route the exchange through the primary.
- Reassess capacity before spawn/follow-up and after material events, without assuming a billing
  period or unit. Treat the most constraining signal: 10% is guarded, 5% or an uncovered completion
  reserve is critical, and a remaining token/credit amount is compared with bounded envelopes.
  During active delegation allow no more than ten minutes between heartbeats unless a known long
  operation has a later checkpoint. Orchestration Housekeeping runs after every slice and deeply at
  every goal.
- Critical capacity starts no new work. Drain only provenance-bound owned subagents and background
  tasks at safe boundaries, update `docs/project-context.md` with the exact drain attestation, then
  run `pnpm handover:create -- --critical` as the final repository action. After a successful seal,
  that runtime session must stop completely: no tool, task, check, follow-up, agent contact, or
  automatic continuation. A later SessionStart asks before `$resume-project` may use the exact
  untrusted handover; after acceptance, the later session may continue, refresh, and stop normally.

## Runtime, Housekeeping, And Publication

- Keep product units free of Codex tooling. Portable policy/hooks/roles/docs stay tracked under
  `.codex/`; mutable authentication, trust, approval rules, sessions, logs, memory, caches, plugins,
  databases, and runtime skills stay in ignored `.codex/runtime/`. The sole ignored vector home is
  `.context-index/`. Framework policy and every managed/excluded file remain inspectable; nothing
  normative is hidden.
- At each completed goal, the primary first completes deep Orchestration Housekeeping, then runs
  `mise exec --locked -- pnpm repo:housekeeping -- --apply`. Review all active docs, consolidate
  stale duplication without losing directives, give changed critical documents a separate
  preservation review, repair/audit/course-check again, and verify. Repository housekeeping never
  deploys, commits, pushes, or mutates external state.
- `.codexrig/framework.json`, `.codexrig/compatibility.json`, and `.codexrig/policy-projection.json`
  own framework version/managed surfaces, compatible tool tracks, and stable child-policy
  reconciliation. Use `pnpm framework:doctor -- --online` and the receipt-backed
  `framework:upgrade`; project-owned documents are never blindly overwritten.
- A goal closes only after the actual central `main` is published and rechecked. The primary alone
  performs an authorized commit/push or integrates a temporary branch/provider queue. Then
  `mise exec --locked -- pnpm goal:new` must prove clean publication before another
  already-authorized goal begins. Creating a sibling project never initializes Git, commits, or
  pushes.
- After every framework optimization, exit all owning Codex sessions, preview the reset, then apply
  it and require a clean preview before stage/review/commit/push. Every `$reset-framework --apply`
  removes the complete disposable runtime and semantic-index state while retaining only approved
  identity and exact publication evidence. Never commit secrets, machine-local state, process
  history, private runtime, or generated handovers.

Detailed source inventory, pre-descent masking, semantic-index lifecycle, staged export validation,
course checks, publication evidence, and review routing remain in
[Project Instructions](instructions.md).
