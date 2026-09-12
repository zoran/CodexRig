# CodexRig Framework

CodexRig is a reusable, production-ready, code-first framework for isolated Codex projects. It
provides portable policy, compatible dependency maintenance, durable context recovery, modular
architecture guardrails, provider-neutral Git automation, and risk-based verification without
imposing a product stack.

## Start

Install a current [Codex CLI](https://developers.openai.com/codex/cli/),
[mise](https://mise.jdx.dev/installing-mise.html), Git, Bash, ripgrep, and ShellCheck. Then run from
the repository root:

```bash
bash scripts/setup/start-codex.sh
```

To start an explicitly authorized Dev session with no approval prompts, unrestricted command network
access, and no filesystem sandbox, you must exit the current Codex session and launch it through the
canonical entry point with `--yolo`:

```bash
bash scripts/setup/start-codex.sh --yolo
```

Only `--no-alt-screen` and `--yolo` are launcher controls. Enter prompts after selecting a session.
Changing permissions in the UI or parent runtime after a safe launch can change the effective live
permissions, but it cannot retroactively turn that session's startup attestation into a canonical
YOLO attestation. The tracked portable config intentionally remains on-request, network-disabled
`workspace-write`; it is the safe default for every clone and generated project, not a place to
persist machine-wide full access. Parent permission overrides can also be reapplied to child agents,
so every child still reports its effective runtime permissions before repository tools. YOLO is
Dev-only and does not grant credentials, broaden task scope, authorize unrelated external mutations,
or apply to staging or production.

Every canonical start inventories all same-clone worktrees and recovery metadata, then checks and
updates compatible workspace packages, Node.js, pnpm, mise, Codex, and the pinned CI tool/action
versions. Node.js and pnpm stay inside the compatibility matrix ranges; CI actions stay on their
annotated major lines. Official release metadata and changed archive digests are checked before host
updates. The complete candidate dependency graph is installed in isolation with strict peer and
Node.js engine checks. Project inputs are then published together and reproduced offline; failures
stop startup and preserve or restore the prior inputs. Registry failures are reported as
indeterminate freshness. An active or unsafe competing writer blocks startup maintenance.

The launcher then validates the maintained runtime, portable policy, model/license contract, and
local framework health before replacing itself with the mise-pinned session controller. The
controller binds external executables, accepts only bounded non-executable runtime metadata and
Codex-persisted model/reasoning preferences, rejects executable or unknown ignored runtime
configuration, and explicitly projects the tracked Astra/`ultra` policy into the native resume
picker without a fixed session ID or `--last`. Codex uses the repository root as `CODEX_HOME`;
private framework coordination stays in ignored `.codex/runtime/`. It reserves one current-schema
writer lease and uses Codex's stable `hooks/list` interface to require exactly the two
session-owned, enabled, hash-exact trusted lifecycle hooks. Only then does it start the gated
foreground supervisor and bind the exact Codex child. This gated preloaded supervisor keeps the
repository controller immutable while the child is active. SessionStart activates the lease and
recovery marker; terminal authenticated child proof is required before release. Cancelling the
picker creates no session/recovery record and never triggers an automatic replacement session. The
detailed process, crash, and ownership invariants have one canonical description in
[Project Instructions](instructions.md#session-start).

Use `/side` inside a running session for a separate temporary conversation. It keeps the main
session's worktree ownership and recovery point intact, including when opened more than 30 minutes
after launch. After a framework update that changes the preloaded controller, exit and restart
through the canonical launcher so the updated lifecycle code takes effect.

Portable TOML, project policy, and runtime-config validation have one constrained implementation;
the launcher uses that same owner before it admits a session.

At every primary startup/resume, Codex reconstructs the complete repository state before intake or a
new slice: manifest and bounded work state, roots/modules/surfaces/contracts, data/configuration,
tests/docs/composition, Git/upstream, every same-clone worktree, and safe latest-session recovery
metadata. It automatically resumes the unique coherent unfinished stream or consolidates only
unambiguous residue, preserves incompatible ambiguity and active writers, and course-checks the
result. Exact paths and `rg` handle known anchors; manifest-led discovery traces unclear ownership
and cross-file relationships through actual source without loading the whole repository.

Bootstrap Node.js and mise must be available before the launcher can inventory the repository. For a
first installation, prepare the locked runtime with the following commands. Canonical starts
thereafter perform freshness maintenance automatically; `install-compatible.mjs` remains the
explicit dependency-only entry point:

```bash
mise install --locked
mise exec --locked -- node scripts/deps/install-compatible.mjs
mise exec --locked -- pnpm setup
mise exec --locked -- pnpm framework:doctor -- --online
```

If startup reports an invalid or unsupported private session lease, exit every Codex session using
this framework. Then preview and apply the bounded reset; never delete `.codex/runtime` manually:

```bash
mise exec --locked -- pnpm framework:reset
mise exec --locked -- pnpm framework:reset --apply
mise exec --locked -- pnpm framework:reset
bash scripts/setup/start-codex.sh
```

## Current Contracts Only

CodexRig deliberately provides no backward compatibility for superseded internal contracts.
Regenerate a non-current generated installation from the current framework; after all owning
sessions exit, full reset discards incompatible private runtime without interpreting it.

CodexRig and generated projects retain exactly one current internal contract per concern. A contract
change migrates its owned durable and mutable state plus every producer and consumer in one coherent
change, then removes superseded schemas, shims, fallback branches, paths, tests, and documentation.
Robust, resilient, fault-tolerant behavior stays lightweight through strict validation, atomic
transitions, bounded recovery, and fail-closed indeterminate state—not parallel interpreters. No
runtime, reset, or framework-upgrade path interprets a superseded internal schema.

## Create A Project

### First Prompt: Define The Project

Tell Codex: `Create a new project called <Project Name>.` Codex immediately asks what the product
should actually do and invites a detailed project/manifest description in ordinary language. It
explains that it will structure the description, challenge gaps and contradictions, recommend
missing decisions, and keep helping refine the manifest inside the generated project. The user need
not arrive with a finished specification; this detailed project description may be explicitly
deferred.

The generated `<apps>/<Project Name>/code` repository contains both portable CI adapters, a
versioned installation receipt, a real empty `src/` Product Root, a pending current-state
`docs/project.md`, initialized `docs/future-modules.md`, and project-owned product/delivery/tenancy/
localization configuration. The transfer manifest classifies every selected source path as copied or
source-only; reusable content stays byte-identical except for declared identity/configuration
transformations.

On first start, Codex explains the successive Project Definition Intake, evaluates any creation
draft or filled manifest, identifies strengths, gaps, and contradictions, and asks whether to refine
it or—only when decision-ready—begin from confirmed scope. An incomplete definition continues the
focused interview before dependent implementation.

Generation never initializes Git, commits, or pushes. It removes only active-session-safe source
residue, preserves runtime, and prints the exact post-exit reset sequence. Optional
verification/staging/commit/push guidance appears only when the source worktree has changes.

## Framework Capability Map

This is the human map, not a second workflow authority. Exact rules and rationale live under the
linked sections of [Project Instructions](instructions.md).

### Product Truth And Architecture

- The [definition intake](instructions.md#first-prompt-project-definition-intake) turns a detailed
  description into confirmed durable truth. [Project Manifest](docs/project.md) contains current
  integrated reality only; [Future Modules](docs/future-modules.md) contains deferred candidates. A
  newly voiced idea is not implementation authorization. Ambiguous intent remains future-facing
  until clarified, and an implemented candidate moves into the manifest in the same change.
- [Feature placement](instructions.md#feature-to-domain-placement) automatically chooses an existing
  owner, a new module in an existing domain, or a new domain from invariants, data/lifecycle,
  contracts, trust, operations, change reason, and dependencies. Root `src/` is the default Product
  Root; cohesive modules expose narrow contracts, private internals, owned data/migrations, acyclic
  dependencies, focused verifiers, and assembled-system evidence.
- Material change invokes `$architecture-evolution` and reshapes stale files with boundaries.
  `$system-coherence` inspects each non-trivial slice through a representative assembled flow and
  real consumers, repairs duplicated/competing truth and drift at the canonical owner, and runs
  beside or after—not ahead of—the newest developer build.
- [Surface selection](instructions.md#product-surface-selection) confirms web/PWA, installed mobile,
  installed desktop, CLI/TUI, API/service, worker, library/SDK, embedded/realtime, or combinations
  before stack choice. Every integrated surface owns an interface directory or declared product
  package plus composition/adapters/contracts. Domain, UI/presentation, web, Identity and Access,
  public API contracts/transport, and infrastructure/deployment stay physically distinct;
  `scripts/verify/path-hygiene.mjs` rejects mixed ownership.
- The root Node.js/pnpm/mise stack is harness tooling, never a product default. Requirement-driven
  selection considers platform/ecosystem, real-time latency/jitter, resources, safety/FFI, trust,
  tenancy, team, operations, and maintenance. Codex gives a strong recommendation and asks for
  confirmation/override/delegation; `pnpm stack:detect` ignores harness-only evidence and each
  active module records actual `Runtime and technology`.

### Product Safety And Experience

- Every generated child is white-label. `config/product.json` owns replaceable identity,
  brand/theme/assets, public endpoints/contacts, and application IDs without a public-name default;
  repository/package names are never branding fallbacks. Other settings have typed owners,
  environment overlays, and separate secrets. CodexRig remains inspectable for developers and is
  mechanically excluded from product-facing runtime, UI, metadata, assets, and deployments.
- Identity and Access is a dedicated trust/domain boundary for authentication, authorization,
  account/user management, sessions/tokens, audit/persistence, and provider adapters. Other surfaces
  use narrow ports. Auth changes invoke `$architecture-evolution`, `$security-review`, and
  `pnpm auth:check`. Every child is tenant-capable through `config/tenancy.json`; runtime work
  begins only with verified tenant context, deny-by-default isolation, explicit global exceptions,
  and negative cross-tenant lifecycle evidence.
- Every UI assumes mobile, tablet, and desktop unless scope is narrowed. Web uses one accessible,
  responsive feature-parity experience across viewports, input modes, zoom, orientation, media, and
  constrained devices. Every hand-authored textual file has a format-native purpose/owner header;
  public types document contracts/invariants and Markdown headings remain unique and referenceable.
- Code, identifiers, files, tests, and technical headers are English. User-facing language is
  decided early in `config/localization.json`; pending ends before product code. Relevant copy uses
  `$native-language-content-review` and `pnpm localization:check`.

### Delivery And Quality

- Approved work continues across intermediate checks, recaps, and additive questions; only explicit
  pause/replacement or a real scope, safety, permission, capacity, or integration boundary
  interrupts it. Explicitly requested native Codex Goals provide multi-turn continuation;
  `pnpm goal:new` checks publication and does not create Goals. A finished slice is not the
  completed overall outcome.
  [Long-Session Course Checks](instructions.md#long-session-course-checks) recover the outcome after
  compaction/resume and check direction, downstream effects, useful cleanup and documentation during
  long slices too. The primary gives a brief course update at least every ten minutes of active
  work, subject to declared atomic safe boundaries, then keeps working. This also applies without
  subagents. Overengineering, micro-optimizations and work without an acceptance benefit or material
  risk are outside that mandate.
- Existing UI appearance, navigation, and interactions are preserved unless a material redesign is
  approved. New UI gets an early representative-flow review; affected real rendered states provide
  evidence that source checks and screenshots of a different state cannot replace. These decisions
  stay with existing manifest/design/component owners, not another framework subsystem.
  `$ui-ux-review` checks the actual affected experience; `$system-coherence` covers code quality and
  assembled integration. Review-only requests never authorize repairs.
- Delivery defaults to `dev`. The newest developer build/deploy and manual feedback outrank agent
  test generation/execution, which run isolated in parallel or afterward; latest-wins replaces stale
  Dev work. Portable Codex sessions default to on-request approval and network-disabled
  workspace-write; only an explicitly authorized Dev session launched with `--yolo` may use no
  approvals and danger-full-access, never staging or production. That session adds no redundant
  approvals. Its full-access mode never applies to staging/prod, which require explicit selection
  and stronger promotion, security, migration, rollback, approval, observability, and health gates.
  A safe session is not converted canonically in place: exit it and run
  `bash scripts/setup/start-codex.sh --yolo`. A live parent override may still make effective
  permissions differ from requested or startup-attested permissions, especially for children, so
  admission always checks the effective runtime facts. `config/delivery.json` separates the Dev
  default from real integrated targets. Once staging or prod is integrated, its clean-commit
  verification consumes a real ignored `.delivery/` manifest via `--artifact-manifest`, hashes every
  listed artifact/configuration byte, and runs the project-owned `verify:staging` or `verify:prod`;
  callers cannot assert a digest label.
- Pre-push checks the clean Git index and working tree before any reusable-evidence success message.
  Git pushes commits, not staged bytes: `git add` alone is insufficient; commit or amend the
  intended content, verify that exact state, and then push.
- Complex work uses planned goals and reviewable slices, focused changed-path evidence,
  review/repair to zero findings, fresh audit, and whole-repository course checks. Tests are
  risk-based and prefer realistic lifecycle/system scenarios. Never end at "ready to implement" when
  implementation is already authorized. Plans, reviews, audits, and intermediate goals are
  checkpoints.
- Housekeeping has two explicit layers. Primary-owned Orchestration Housekeeping observes budget,
  agents/tasks, checkpoints, ownership, and bounded state after slices and deeply at goals. After
  every completed slice, its lightweight Worktree Settlement trigger reruns read-only
  `pnpm worktree:status -- --json` and rechecks session, lease, recovery, task-branch, and cleanup
  claims. Preservation is a safety state, never completion: each no-longer-needed item is
  integrated, explicitly owner-confirmed and retired, or retained behind a concrete blocker and
  resolution condition. A completed goal stays open until every no-longer-needed goal-owned
  temporary worktree, branch, handover, reservation, preservation lock, prune transaction, and
  related residue is settled; the current session remains only through its mandatory post-exit
  reset. Repository-only `repo:housekeeping --apply` reconciles provable local facts and checks
  architecture, docs/headers, Auth/tenant/surface/white-label boundaries, dependencies, secrets,
  agent policy, and framework health. It accepts Git-less roots, clears proven-dead writer leases
  while retaining any valid recovery marker and repairing a missing or invalid marker from the exact
  active lease both on normal terminal release and before proven-stale cleanup; a current process
  identity observed outside its bound PID namespace or otherwise mechanically indeterminate remains
  an ownership-confirmation blocker. Linux reset also treats missing or unobservable procfs and
  `EACCES` or `EPERM` for descriptor state of a process observably bound to this exact root as
  indeterminate, never inactive. Housekeeping preserves an existing directory with a broken Git
  worktree link as another ownership-confirmation blocker and prunes only already-missing worktree
  registrations whose paths it holds with exact process-bound exclusive non-directory reservations
  for the complete native prune, while process-bound Git locks protect every non-missing linked
  sibling. Before native prune, one shared process-bound transaction in the Git common directory
  records every reserved path and preservation reason, so a crash remains discoverable even after
  Git removed the registration. A failed or changed reservation leaves the registration intact;
  after a hard cleanup crash, only an unchanged current-contract transaction, reservation, or
  preservation lock with a mechanically proven-dead owner is retired automatically. Native Git
  repair is explicit and primary-owned after the directory's ownership is confirmed. Per-root
  inconsistencies stay visible without suppressing the rest of the inventory; active, dirty, unsafe,
  invalid, or unintegrated worktrees are preserved. An invalid orphan recovery file is a visible
  advisory, not invented writer ownership. Housekeeping never deploys, commits, pushes, removes a
  worktree directory, or mutates external state.

### Collaboration And Capacity

- Central `main` is the only durable integration branch. Git is persistence and transport, not
  isolation. One physical host represents one developer, so Codex accounts never make that host's
  visible project changes foreign. Same-host independent sessions isolate writers in separate
  worktrees with one writer lease each; different hosts/developers use separate clones and ordinary
  short-lived task branches. Pre-slice coordination declares one writer per
  module/contract/data/configuration/file, permits all agents to read visible worktree state, and
  allows only confirmed-disjoint parallel writes. Shared contracts have one integrator.
- To survive physical host loss or transfer work, the primary commits and pushes each coherent
  resumable slice through the declared integration path: directly on `main` for serialized work when
  policy permits, otherwise through the short-lived task branch or protected path. Existing safety
  gates remain mandatory. There is no separate WIP/checkpoint workflow; anything newer and
  uncommitted remains host-local.
- The primary admits at most four live subagents only when independent scope and completion reserve
  justify them. Primary and subagents use the exact same configured GPT Astra model with `ultra`
  reasoning; global delegated defaults and roles match, and no spawn override differs. Within one
  primary-owned local run, writers may share a checkout only under continuously monitored exact
  disjoint file ownership. Across same-host independent sessions they use dedicated disjoint
  worktrees; across developers/hosts they use separate clones. Subagents never commit, merge, push,
  publish, deploy, or delegate.
- Role sandboxes are requested defaults because live parent/YOLO permissions can be reapplied to
  children. Before any child repository tool work, compare its reported effective permissions with
  the role; a broader or unobservable runtime closes that child and leaves work with the primary.
- Register every agent/background task with repository, primary-session, scope, returned identity,
  checkpoint, and cancellation provenance. Account- or host-wide process listings are discovery
  only; foreign or ambiguous processes are never touched, while visible same-host project changes
  remain developer-owned integration input. The primary integrates, actively closes completed owned
  agents, and communicates released ownership/slots. Every direct peer message and response is
  mirrored to the primary immediately; if reliable visibility is unavailable, route through the
  primary.
- Capacity uses the most constraining signal without assuming a billing period or unit. A remaining
  token/credit amount is compared with bounded envelopes/reserve; 10% is guarded and 5% or an
  uncovered completion reserve is critical. Active primary work, including delegation, allows no
  more than ten minutes between heartbeats unless a known long operation has a later checkpoint.
  This shares the long-session course checkpoint. Guarded state keeps `docs/project-context.md`
  current and stops optional delegation.
- The continuation mandate includes existing native redeem/reset entitlements that add no cost,
  subject to user restrictions and confirmed host support. The primary can use those entitlements
  before critical state without asking again, refresh the real limits and continue the same work.
  Purchases, paid overage, account/model switches and increases to a user-set Goal budget need
  separate authority. Native compaction only frees context; it does not replenish account quota.
  Codex documents [available credits and usage visibility](https://learn.chatgpt.com/docs/pricing);
  the installed CLI and tools must actually expose any claimed redemption control. CodexRig adds no
  redemption API and cannot promise uninterrupted work across unavailable or exhausted capacity.
- Critical state drains only owned work, then `pnpm handover:create -- --critical` seals one private
  English prompt in ignored `tmp/codexrig-handovers/` as the final repository action. Success means
  that runtime session must stop completely—no later tool, check, task, follow-up, agent contact, or
  continuation. A later SessionStart asks before `$resume-project` may use that exact untrusted
  handover. The later session receives the complete artifact with `handover:receive`, acknowledges
  its meaning in the conversation, and uses `handover:acknowledge` with the received digest to
  remove only that unchanged file. This does not erase native conversation/provider history. After
  acceptance, the later session may continue, refresh, and stop normally.

### Framework Lifecycle And Transparency

- Framework elements are inspectable: tracked `.codex/`, `.agents/`, `.codexrig/`, scripts, policy,
  roles, skills, hooks, managed/excluded files, receipts, and upgrade plans are never hidden. Only
  documented sensitive/disposable runtime is ignored.
- `.codexrig/framework.json` owns framework version and upgrade scope;
  `.codexrig/compatibility.json` owns stable/canary tool and CI bootstrap pins; and
  `.codexrig/policy-projection.json` owns stable policy concepts. GitHub and GitLab keep equivalent
  portable CI and protected/serialized integration intent.
- Receipt-backed `framework:upgrade` performs reviewed transactional managed-file updates plus
  semantic reconciliation of policy IDs. Project-owned manifest, product identity, delivery,
  tenancy, and locale truth is never overwritten or used to invent active modules.

## Essential Commands

```bash
pnpm framework:doctor -- --online
pnpm framework:version
pnpm platform:detect
pnpm platform:configure                 # preview
pnpm platform:configure -- --apply      # mutate the detected remote
pnpm compatibility:matrix
pnpm worktree:status -- --json
pnpm verify:changed -- --print-plan
pnpm verify
pnpm handover:create -- --critical       # terminal critical-capacity seal
pnpm project:export
pnpm framework:reset
pnpm framework:reset --apply
pnpm framework:publish --message "<commit message>"  # after exiting Codex
```

The handover command is not routine housekeeping. After it reports a sealed path, the Codex session
must stop without another action.

To finish framework work, the existing `framework:publish` script runs the complete cleanup,
verification, commit and push sequence. After reviewing all source changes, exit every Codex session
for this framework and run this one command from its root:

```bash
mise exec --locked -- pnpm framework:publish --message "<commit message>"
```

The `mise exec --locked --` prefix only selects the repository's declared Node.js and pnpm versions;
`framework:publish` owns the workflow. There is no need to run its reset or verification steps
separately beforehand. Running this command explicitly authorizes publication of all non-ignored
source changes on `main`. The command checks worktree ownership and the unique central upstream,
refreshes its tracking ref, previews and applies the reset, confirms a clean preview, runs
housekeeping, installs the managed Git hook, and invokes `pnpm verify`. It resets temporary
verification residue, stages and commits the exact verified source, pushes through `pre-push`,
confirms remote `main`, and checks `goal:new`. An unchanged source tree creates no empty commit; a
rejected push preserves the local commit for a later retry. Any failed gate stops the sequence.
Commit and push never run while a Codex session owns the runtime.

Reset removes obsolete process/runtime state while retaining only approved runtime identity and
exact publication evidence. It holds the lifecycle lock and proves repository-wide runtime
quiescence. Pre-push repeats the clean reset preview and security/evidence checks. The publisher is
source-framework tooling and is excluded from generated projects.

## Repository Housekeeping

After deep Orchestration Housekeeping, run `pnpm repo:housekeeping -- --apply` before the completed
goal's documentation review and final audit. In the source framework it also binds the configured
integration branch to one central remote branch, requires that branch's unique live commit to match
the local remote-tracking ref, classifies committed-but-unpublished plus working-tree changes
against that immutable published commit, and atomically reconciles the required SemVer across
`.codexrig/framework.json`, root `package.json`, and the manifest version block. Preview with
`pnpm framework:version`. Source apply then reproduces the existing lockfile offline with scripts
and pnpm hooks disabled, so a package-version change does not leave pnpm's dependency-state guard
blocking the next command. This does not resolve newer dependency versions. If a run stops after
writing version metadata, retry the same owner directly with
`mise exec --locked -- node scripts/goals/repository-housekeeping.mjs --apply`; it also repairs the
derived installation when the version mirrors already agree. Missing cached packages require the
explicit compatible dependency installer before retrying.

Do not count a preserved, unfinished, clean-but-unused, or already-integrated temporary worktree as
settled merely because its bytes are recoverable. The slice trigger records its live owner and
scope, integrates it, retires it after explicit ownership confirmation, or keeps a concrete blocker
and resolution condition. The completed-goal gate requires every no-longer-needed goal-owned
worktree and associated coordination residue to reach that terminal disposition.

`pnpm repo:housekeeping -- --check` is read-only. Weekly GitHub/GitLab schedules add `--online` for
dependency/tool freshness and report drift without applying or publishing it. Ambiguous
staging/production evidence remains a developer classification rather than guessed manifest truth.

## Documentation Context Economy

Every framework element remains visible, but each concern has one canonical owner. `AGENTS.md` is
the always-loaded safe-entry bootstrap capped at 24 KiB; `instructions.md` owns complete policy;
this README owns human setup/use; the manifest owns current reality; Future Modules owns deferred
ideas; and skills load progressively. Secondary documents summarize and link rather than duplicate
policy. Skills cover specialized work rather than a second orchestration stack: discovery lives in
[Context And Skills](instructions.md#context-and-skills), and review selection in `$task-quality`.
Native implicit invocation remains the default; an explicitly chosen explicit-only skill can set
`policy.allow_implicit_invocation: false`.

Superpowers is not bundled or required. The implementation workflow uses hypothesis-driven
root-cause investigation, informed by
[Superpowers debugging](https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/SKILL.md);
skill maintenance uses bounded realistic scenarios. No upstream plugin, planning store, hooks or
separate subagent workflow is installed by this framework.

`docs:check` and housekeeping enforce meaningful H1/H2 anchors, hierarchy, local links, and the
bootstrap budget. Larger context windows do not make duplicated or stale prose useful.

## Update Generated Projects

A child previews a reviewed framework with `pnpm framework:upgrade -- --source <new-codexrig-root>`;
this source previews a child with `pnpm framework:upgrade -- --target <child-root>`. Add `--apply`
only after reviewing the receipt-backed plan. Managed
roles/skills/hooks/scripts/contracts/dependencies update transactionally with rollback; stable
policy concepts are reconciled into local truth and the exact plan digest is acknowledged before
verification. `config/product.json` is never overwritten, nor are `config/delivery.json`,
`config/tenancy.json`, `config/localization.json`, or the product manifest.

Upgrade accepts only the current framework-contract, installation-receipt, and policy-projection
schemas. A non-current child is outside the upgrade contract and must be regenerated from the
current framework. Child package versions remain independent product truth;
`.codexrig/installation.json` records only the installed framework version.

The repository smoke check used by `pnpm verify` and the startup doctor share the installation
receipt validator. Unrecorded edits to managed framework files therefore block verification as well
as startup. Repair reusable tooling in the source framework, reconcile its release version, then
apply the reviewed child upgrade before handing the project over. Framework reset preserves these
versioned source corrections; `framework:publish` publishes them after all source sessions exit.

## License And Attribution

CodexRig is available under the [PolyForm Noncommercial License 1.0.0](LICENSE). Every noncommercial
copy, distribution, derivative work, and generated project must retain the license terms and the
[Required Notice](NOTICE), including the Zoran Kikic author credit and CodexRig Framework credit.
Commercial use requires a separate express written license from Zoran Kikic.

A separate commercial license may expressly permit those credits to be removed from a specific
project generated by CodexRig. It does not permit their removal from CodexRig itself: the framework
always retains its license, author credit, and framework credit.

## Project Authority

- [Project Instructions](instructions.md) own complete workflow and safety policy.
- [AGENTS.md](AGENTS.md) is the short safe-entry bootstrap.
- [Project Manifest](docs/project.md) owns current durable truth and active modules.
- [Future Modules](docs/future-modules.md) owns confirmed deferred candidates only.
- [.codex/README](.codex/README.md) explains portable Codex configuration and private runtime.
- `.codexrig/` owns versioned framework, compatibility, provider, and upgrade contracts.
