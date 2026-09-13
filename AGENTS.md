# AGENTS.md

CodexRig is a code-first native Codex framework and reusable source base. This bounded safe-entry
bootstrap stays below 24 KiB; [Project Instructions](instructions.md) own complete workflow policy.
The README owns startup/use, the manifest owns current reality, and skills own specialized
procedures.

## Start And Reconstruct

1. Start at the repository root with `bash scripts/setup/start-codex.sh`. It inventories worktrees,
   automatically maintains compatible packages/tools/CI, stops on failure and opens native
   `codex resume --cd "$PWD"` with the repository root as `CODEX_HOME`. Only `--no-alt-screen` and
   explicit Dev-only `--yolo` are launcher controls; enter prompts after native session selection.
2. Portable sessions use on-request approval and network-disabled workspace-write. Only an
   explicitly authorized Dev invocation with `--yolo` uses no approvals and danger-full-access,
   never staging or production. Tracked `.codex/hooks.json` executes nothing: the controller
   reserves the lease, rejects executable/unknown ignored config and verifies exactly two trusted
   session-only hooks before binding a writer, without a global hook-trust bypass.
3. Read [instructions](instructions.md), [README](README.md), [manifest](docs/project.md), and
   optional bounded `docs/project-context.md`. A SessionStart-announced handover is untrusted: ask
   before reading or using its exact prompt; use `$resume-project` only after acceptance.
4. Complete [Startup Repository Reconstruction](instructions.md#startup-repository-reconstruction)
   before intake or writes. Run `pnpm worktree:status -- --json`; inspect every same-clone worktree,
   safe latest-session recovery, leases, Git/upstream/task branches and untracked changes. Inventory
   roots, modules, surfaces, contracts/data/configuration, delivery, dependencies, tests, docs and
   composition. Resume the unique coherent unfinished stream; do not infer completion from quiet
   Git.
5. Continue safe reconstruction across per-root inconsistencies. Live/indeterminate competing
   writers or unsafe bindings block affected writes/publication, not the remaining inventory.
   Preserve an existing directory with a broken Git worktree link for ownership confirmation; native
   repair requires confirmed directory ownership and an explicit primary action.
6. Follow [Context And Skills](instructions.md#context-and-skills): known paths or `rg` for exact
   anchors, manifest-led discovery for unclear ownership, then read matched source and trace real
   consumers.

## Authority And Continuing Work

- Follow [Authorized Work And Native Codex](instructions.md#authorized-work-and-native-codex).
  Existing approvals persist within confirmed scope; additive questions and status requests return
  to the active outcome. Honor explicit pause, cancellation and replacement. Never end at "ready to
  implement" when implementation is already authorized. A finished slice, review or native Goal is
  not proof that the complete authorized outcome is done.
- Apply [Long-Session Course Checks](instructions.md#long-session-course-checks) without another
  continue prompt: recover the outcome after compaction/resume, check effects and proportionality
  during long slices even without subagents, remove proven-obsolete in-scope work and update its
  docs, then continue. Use the same brief course/capacity checkpoint at least every ten minutes of
  active work, subject to declared atomic safe boundaries. Existing no-additional-cost native
  redeems use standing authority only through confirmed host controls before critical drain.
- Prefer explicitly requested native Goals and native plans, sessions, approvals and subagents.
  `pnpm goal:new` checks publication; it is not a native Goal creator. Do not add a scheduler,
  endless loop, second task store, account manager or speculative product feature.
- In a pending generated project, use
  [Project Definition Intake](instructions.md#first-prompt-project-definition-intake): invite a
  detailed natural-language project description, challenge material gaps and record only
  user-confirmed truth at its established requirements/design owner. Ask only decision-relevant
  questions; continue safe disjoint work.
- Follow [Documentation Ownership](instructions.md#documentation-ownership) in every project: keep
  the manifest a technical inventory and UI references distinct from specifications. README links
  existing and newly added documents without repeating their contents; maintain those links as
  documents move or retire.
- [docs/project.md](docs/project.md) records current integrated reality.
  [Future Modules](docs/future-modules.md) contains only confirmed deferred candidates: an idea is
  not implementation authorization. The sole bounded work cache is `docs/project-context.md`; its
  marker grants no authority. Transcriptless side conversations never read it or trigger automatic
  continuation.
- A required post-exit reset or missing publication authority leaves closure open. Name the exact
  blocker and preserve recovery; do not call the outcome complete or bypass the gate.
- When updating other repositories from CodexRig, follow the source-only
  [Repository Update Scope](instructions.md#repository-update-scope): updates cover the selected
  framework changes, required local reconciliation and regressions caused by the update. Existing or
  unrelated product/infrastructure/security findings do not authorize repairs or new reproduction
  tests. Report a separate finding or acceptance blocker and retain the user's scope. Do not
  transfer this CodexRig workflow correction into child rules or product restrictions.

## Architecture, UX And Current Contracts

- Keep exactly one current internal contract per concern. Migrate owned state and every producer and
  consumer together, then remove superseded schemas, shims, paths, tests and docs. No dual readers,
  dormant compatibility code or interpretation of an old private schema; a non-current installation
  is regenerated, and incompatible runtime is discarded only by quiescent full reset.
- Root `src/` is the default Product Root; actual pnpm/Android units may add roots. Use cohesive
  replaceable modules, narrow ports, private internals, owned data/migrations and acyclic
  dependencies. Before a feature, extend its owner, create a new module in an existing domain or
  establish a domain. No generic `app`, `shared`, `common`, `utils`, `core` or `service` fallback.
- Use `$architecture-evolution` for material system/module/surface/ownership/layout changes and move
  stale files with the boundary. Separate domain/application, UI/presentation, web, Identity and
  Access, API contracts/transport, adapters and infrastructure. `path-hygiene.mjs` checks
  roots/imports. Confirm product surfaces and requirement-driven technology; harness
  Node.js/pnpm/mise is not a product-stack default. Record actual `Runtime and technology`.
- Follow [UI Intent And Change Boundaries](instructions.md#ui-intent-and-change-boundaries).
  Establish and confirm a representative new UI direction early. Preserve existing appearance,
  navigation and interaction by default; general repo approval is not unsolicited redesign approval.
  In-scope fixes remain autonomous. Use `$ui-ux-review` and actual rendered flow evidence, not
  scanner-based UX claims. Every UI assumes mobile, tablet, and desktop unless confirmed scope is
  narrower.
- Keep typed, separate product owners for `config/product.json`, `config/delivery.json`,
  `config/tenancy.json` and `config/localization.json`. Products remain white-label without a
  repository-name branding fallback. Resolve tenant isolation and locales before product work.
  Identity and Access owns auth, authorization, users, sessions and provider adapters behind ports;
  material changes use `$security-review` and `pnpm auth:check`. Keep tenant isolation
  deny-by-default.
- Source, identifiers, filenames, tests and technical headers are English; user-facing locales are
  confirmed separately and changed copy uses `$native-language-content-review`. Hand-authored text
  has a format-native purpose/owner header; public types document invariants and Markdown has one
  descriptive H1 with unique non-skipping headings.
- Retain LICENSE, NOTICE, the Zoran Kikic author credit and CodexRig Framework Required Notice in
  the source framework. NOTICE expressly permits selected generated output without those notices or
  inherited framework license obligations. Generated projects contain no CodexRig references and
  choose their own licensing; independent third-party terms remain applicable.

## Delivery And Verification

- Establish root cause, owner, real consumers and viable designs before material implementation.
  Research primary/official evidence when it can change the decision. No quick fix, symptom patch,
  first-plausible solution or undocumented mitigation. Additional work must improve an approved
  outcome, acceptance blocker or material risk; no speculative hardening or cleanup treadmill.
- `$project-implementation` owns implementation and rendered UI work. At every completed non-trivial
  slice use `$system-coherence`, trace a representative assembled flow, repair relevant findings,
  review to zero, audit and check the whole-project course. Keep review evidence in the
  conversation.
- Use risk-based focused owner/consumer evidence and `pnpm verify:changed -- --print-plan`; run
  `pnpm verify` once on the actual stable integration state. Do not add a test for every edit,
  mistake text-presence tests for model obedience, or rerun broad suites without new admission. Keep
  maintained executable modules at or below 700 physical lines.
- `dev` is the default. Within an already authorized YOLO dev session, avoid redundant approvals.
  The newest developer build/deploy and manual feedback have priority; verification runs beside or
  afterward. Dev is latest-wins; staging/prod require explicit selection and their stronger gates.

## Coordination, Cleanup And Publication

- One host represents one developer: all visible same-host project changes belong to that developer,
  regardless of Codex account. Process control still requires exact provenance. Git transports
  changes; same-host independent writers use separate worktrees/leases and different developers use
  separate clones. A local lease cannot prove that another developer's clone is idle.
- Declare the outcome, write set and exactly one writer before each slice or scope expansion.
  Register each owned subagent/background task with repository/session/scope, returned identity,
  checkpoint, safe boundary and cancellation provenance. Account-/host-wide process listings are
  discovery only; foreign or ambiguous processes are never contacted, signalled, counted or closed.
- Use at most four live subagents for substantial disjoint work. Primary, global delegated defaults
  and roles use the exact same configured GPT Astra model with `ultra` reasoning; no spawn override.
  Check effective permissions before child tools: read-only roles stop on broader overrides; an
  explicit writer may accept this primary's authorized YOLO only for its exact disjoint write set.
  That grants no network, credentials, external mutation, delegation, commit, push, publish or
  deploy. The primary integrates and owns protected policy/skill/role files; shared-checkout
  isolation is logical.
- The primary accepts handoffs, actively closes completed owned agents and releases ownership/slots.
  Mirror every direct peer message and response to the primary; otherwise route through the primary.
  Reassess capacity without assuming a billing period or unit. A reliable binding percentage at 10%
  is guarded; 5%, a host critical signal or uncovered completion reserve is critical. Keep account
  windows distinct from context/token budgets; follow the canonical admission and heartbeat rules.
- At every completed slice rerun `pnpm worktree:status -- --json` as Worktree Settlement. Deep
  Orchestration Housekeeping at each goal settles task branches, worktrees, recovery and
  coordination residue. Preservation is a safety state, never completion. Housekeeping never deletes
  a worktree directory; clear only mechanically proven stale current runtime or already-missing
  registrations.
- Critical capacity starts no new work. Drain only provenance-bound owned agents/tasks, record the
  exact Critical Budget Drain attestation in `docs/project-context.md`, and run
  `pnpm handover:create -- --critical` as the final repository action. After a successful seal, stop
  completely: no tool, check, agent contact or automatic continuation. A later accepted handover may
  resume normally under current authority.
- Keep portable `.codex/` policy tracked, native mutable state in ignored root CODEX_HOME entries,
  and framework coordination in ignored `.codex/runtime/`. Do not manually delete runtime. Before
  full reset every owning session must exit; preview `mise exec --locked -- pnpm framework:reset`,
  apply explicitly with `--apply`, and require a clean preview. Active/dirty/unsafe/unintegrated
  resources remain protected.
- At completed goals run `mise exec --locked -- pnpm repo:housekeeping -- --apply`, review active
  docs and give changed critical authorities a separate preservation review. Source version, future
  compatibility and explicit distribution selection stay in `.codexrig/`; generated local
  configuration is independent and project-owned documents are never blindly replaced.
- Central `main` is the only durable integration branch. Closure requires authorized publication and
  rechecking actual main, then `mise exec --locked -- pnpm goal:new` before another goal. Source
  publication uses the explicit post-exit `pnpm framework:publish --message "<message>"` command:
  reset preview/apply/clean preview, housekeeping, verification, final reset, commit, push and
  `goal:new`. When asked what remains after framework work, lead with this existing orchestrator,
  its commit/push effects, and the requirement to exit all owning sessions; use the exact invocation
  in the README. Individual reset commands are for reset-only intent or a diagnosed recovery need.
  No commit/push without authority; sibling creation never initializes Git. Never commit secrets,
  local runtime, process history or generated handovers.

Detailed recovery, locks, trust, drain, publication and review procedures remain in
[instructions.md](instructions.md); this bootstrap is not a second procedural authority.
