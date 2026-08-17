# CodexRig Framework

CodexRig is a reusable, production-ready, code-first framework for isolated Codex projects. It
provides portable policy, compatible dependency maintenance, semantic retrieval, modular
architecture guardrails, provider-neutral Git automation, and risk-based verification without
imposing a product stack.

## Start

Install a current [Codex CLI](https://developers.openai.com/codex/cli/),
[mise](https://mise.jdx.dev/installing-mise.html), Git, Bash, ripgrep, and ShellCheck. Then run from
the repository root:

```bash
bash scripts/setup/start-codex.sh
```

The launcher updates Codex outside project isolation, installs the locked Node.js/pnpm toolchain,
resolves and installs the newest compatible stable dependency graph, runs the online framework
doctor, and issues a short-lived input-bound attestation before Codex receives ignored
`.codex/runtime/` as its isolated `CODEX_HOME`. A failed or indeterminate refresh blocks startup.
Only optional `--no-alt-screen` is a launcher control; prompt text follows `--`.

At every primary startup/resume, Codex reconstructs the complete repository state before intake or a
new slice: manifest and bounded work state, roots/modules/surfaces/contracts, data/configuration,
tests/docs/composition, Git/worktree/upstream, and safe evidence. It resumes unfinished authorized
work or consolidates only unambiguous residue, preserves ambiguous/user/concurrent work, and
course-checks the result. Exact paths and `rg` handle known anchors; semantic retrieval handles
unclear ownership and cross-file relationships without blindly loading the repository.

For explicit setup or repair:

```bash
mise install --locked
mise exec --locked -- node scripts/deps/install-compatible.mjs
mise exec --locked -- pnpm setup
```

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
residue, preserves runtime and `.context-index/`, and prints the exact post-exit reset sequence.
Optional verification/staging/commit/push guidance appears only when the source worktree has
changes.

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

- Delivery defaults to `dev`. The newest developer build/deploy and manual feedback outrank agent
  test generation/execution, which run isolated in parallel or afterward; latest-wins replaces stale
  Dev work. Portable Codex sessions default to on-request approval and network-disabled
  workspace-write; only an explicitly authorized Dev session launched with `--yolo` may use no
  approvals and danger-full-access, never staging or production. That session adds no redundant
  approvals. Its full-access mode never applies to staging/prod, which require explicit selection
  and stronger promotion, security, migration, rollback, approval, observability, and health gates.
  `config/delivery.json` separates the Dev default from real integrated targets. Once staging or
  prod is integrated, its clean-commit verification consumes a real ignored `.delivery/` manifest
  via `--artifact-manifest`, hashes every listed artifact/configuration byte, and runs the
  project-owned `verify:staging` or `verify:prod`; callers cannot assert a digest label.
- Complex work uses planned goals and reviewable slices, focused changed-path evidence,
  review/repair to zero findings, fresh audit, and whole-repository course checks. Tests are
  risk-based and prefer realistic lifecycle/system scenarios. Never end at "ready to implement" when
  implementation is already authorized. Plans, reviews, audits, and intermediate goals are
  checkpoints.
- Housekeeping has two explicit layers. Primary-owned Orchestration Housekeeping observes budget,
  agents/tasks, checkpoints, ownership, and bounded state after slices and deeply at goals.
  Repository-only `repo:housekeeping --apply` reconciles provable local facts and checks
  architecture, docs/headers, Auth/tenant/surface/white-label boundaries, dependencies, secrets,
  agent policy, and framework health without deploying, committing, pushing, or mutating external
  state.

### Collaboration And Capacity

- Central `main` is the only durable integration branch. Pre-slice coordination declares one writer
  per module/contract/data/configuration/file and permits only confirmed-disjoint parallel work.
  Different accounts use temporary branches in separate clones; same-account worktrees are not an
  authentication boundary. Shared contracts have one integrator.
- The primary admits at most four live subagents only when independent scope and completion reserve
  justify them. Primary and subagents use the exact same configured GPT Sol model with `ultra`
  reasoning; global delegated defaults and roles match, and no spawn override differs. Within one
  primary-owned local run, writers may share a checkout only under continuously monitored exact
  disjoint file ownership. Across independent sessions, accounts, or machines they use dedicated
  disjoint worktrees or clones. Subagents never commit, merge, push, publish, deploy, or delegate.
- Role sandboxes are requested defaults because live parent/YOLO permissions can be reapplied to
  children. Before any child repository tool work, compare its reported effective permissions with
  the role; a broader or unobservable runtime closes that child and leaves work with the primary.
- Register every agent/background task with repository, primary-session, scope, returned identity,
  checkpoint, and cancellation provenance. Account- or host-wide listings are discovery only;
  foreign or ambiguous work is never touched. The primary integrates, actively closes completed
  owned agents, and communicates released ownership/slots. Every direct peer message and response is
  mirrored to the primary immediately; if reliable visibility is unavailable, route through the
  primary.
- Capacity uses the most constraining signal without assuming a billing period or unit. A remaining
  token/credit amount is compared with bounded envelopes/reserve; 10% is guarded and 5% or an
  uncovered completion reserve is critical. Active delegation allows no more than ten minutes
  between heartbeats unless a known long operation has a later checkpoint. Guarded state keeps
  `docs/project-context.md` current and stops optional delegation.
- Critical state drains only owned work, then `pnpm handover:create -- --critical` seals one private
  English prompt in ignored `tmp/codexrig-handovers/` as the final repository action. Success means
  that runtime session must stop completely—no later tool, check, task, follow-up, agent contact, or
  continuation. A later SessionStart asks before `$resume-project` may use that exact untrusted
  handover; after acceptance, the later session may continue, refresh, and stop normally.

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
pnpm verify:changed -- --print-plan
pnpm verify
pnpm context:search -- "query"
pnpm handover:create -- --critical       # terminal critical-capacity seal
pnpm project:export
pnpm framework:reset
pnpm framework:reset --apply
```

The handover command is not routine housekeeping. After it reports a sealed path, the Codex session
must stop without another action.

For the source framework, final publication order is verification, Codex exit, reset preview,
reviewed apply, clean preview, commit, then push. Reset removes obsolete process/runtime/index state
while retaining only approved runtime identity and exact publication evidence. Pre-push repeats the
clean reset preview and security/evidence checks.

## Repository Housekeeping

After deep Orchestration Housekeeping, run `pnpm repo:housekeeping -- --apply` before the completed
goal's documentation review and final audit. In the source framework it also binds the configured
integration branch to one central remote branch, requires that branch's unique live commit to match
the local remote-tracking ref, classifies committed-but-unpublished plus working-tree changes
against that immutable published commit, and atomically reconciles the required SemVer across
`.codexrig/framework.json`, root `package.json`, and the manifest version block. Preview with
`pnpm framework:version`.

`pnpm repo:housekeeping -- --check` is read-only. Weekly GitHub/GitLab schedules add `--online` for
dependency/tool freshness and report drift without applying or publishing it. Ambiguous
staging/production evidence remains a developer classification rather than guessed manifest truth.

## Documentation Context Economy

Every framework element remains visible, but each concern has one canonical owner. `AGENTS.md` is
the always-loaded safe-entry bootstrap capped at 24 KiB; `instructions.md` owns complete policy;
this README owns human setup/use; the manifest owns current reality; Future Modules owns deferred
ideas; and skills load progressively. Secondary documents summarize and link rather than duplicate
policy. `docs:check` and housekeeping enforce meaningful H1/H2 anchors, hierarchy, local links, and
the bootstrap budget. Larger context windows do not make duplicated or stale prose useful.

## Update Generated Projects

A child previews a reviewed framework with `pnpm framework:upgrade -- --source <new-codexrig-root>`;
this source previews a child with `pnpm framework:upgrade -- --target <child-root>`. Add `--apply`
only after reviewing the receipt-backed plan. Managed
roles/skills/hooks/scripts/contracts/dependencies update transactionally with rollback; stable
policy concepts are reconciled into local truth and the exact plan digest is acknowledged before
verification. `config/product.json` is never overwritten, nor are `config/delivery.json`,
`config/tenancy.json`, `config/localization.json`, or the product manifest.

The active version-2 path has no parallel compatibility runtime. The one published `1.2.1` child
bootstrap starts from the reviewed current source with `--target`, validates the exact legacy input,
and migrates it transactionally. Child package versions remain independent product truth;
`.codexrig/installation.json` records only the installed framework version.

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
- [Context Index](docs/context-index.md) owns semantic retrieval and freshness.
- [.codex/README](.codex/README.md) explains portable Codex configuration and private runtime.
- `.codexrig/` owns versioned framework, compatibility, provider, and upgrade contracts.
