# CodexRig Framework

CodexRig provides isolated Codex sessions, portable project policy, dependency maintenance, durable
context recovery and modular verification without prescribing a product stack.

## Start

Provide a current Node.js bootstrap, Git, Bash, ripgrep, ShellCheck and the system archive tool.
Linux verification also needs Python 3 with `ctypes`. From the repository root:

```bash
bash -p scripts/setup/start-codex.sh
```

Startup maintains compatible tools/dependencies before native Codex resume. Defaults are
workspace-write, on-request approvals and disabled command network access. Starting with
`bash -p scripts/setup/start-codex.sh --yolo` gives advance approval for every step within the
requested outcome, including the publication and deployment required by a go-live. The startup hook
confirms the selected mode for new and resumed sessions. See
[YOLO session approval](instructions.md#yolo-session-approval). Keep `bash -p` to block inherited
shell startup code. Only `--yolo` and `--no-alt-screen` are launcher controls; enter prompts after
session selection. [Session Start](instructions.md#session-start) and
[Effective Permissions](instructions.md#effective-permissions-and-write-isolation) own these
boundaries.

One canonical Codex session owns writes across a project and its linked Git worktrees. Exit that
session before opening the picker in another worktree of the same clone.

For initial preparation without opening Codex:

```bash
env -u NODE_OPTIONS -u NODE_PATH node scripts/deps/maintain-toolchain.mjs
bash -p scripts/setup/run-project.sh pnpm setup
bash -p scripts/setup/run-project.sh pnpm framework:doctor -- --online
```

Frozen setup and local builds add `--locked` to the maintenance command; normal startup retains
release discovery. [Dependency maintenance](instructions.md#dependency-installation-and-freshness)
owns installation, migration and freshness. Startup waits for a live lifecycle coordinator;
cancelling the wait preserves the owner. A dead coordinator with surviving commands fails promptly
for owned recovery. Cancellable verification checks drain when their caller exits; other operations
retain their completion boundary. Never bypass a live or uncertain lock.

Startup checks official native downloads with a one-byte ranged GET and cancels each response body,
including when the server ignores Range. This avoids gateways that fail or stall on HEAD probes.
HTTP 502, 503 and 504 allow at most two retries of the canonical address within the original timeout
and total redirect allowance. HTTPS and artifact checks remain binding; persistent failures still
stop release selection and never justify a downgrade.

pnpm uses the official npm distribution on the pinned Node runtime. Its native GitHub builds are not
required for other platforms. Mise binds the portable graph under
`.codex/.mise/locks/pnpm/current/`; generation and transactional updates carry it with the pins.
Mise tracks this project's configurations under `.auth/project-tools/state/mise/`. Startup checks
the project's own pins and reuses verified shared installations even when another project uses
different versions or settings.

After framework changes, `/quit` and relaunch from the terminal; `/new` and `/resume` retain the
running launcher. `/side` opens an independent temporary conversation. For startup defects, update
the source with `git pull --ff-only`, or use its [child update path](#update-generated-projects).
[Startup recovery](instructions.md#startup-repository-reconstruction) owns other failures. An
invalid private lease requires exiting all affected sessions, then preview, apply and repeated
preview with the reset below before relaunch. Never delete runtime files manually.

```bash
env -u NODE_OPTIONS -u NODE_PATH node .agents/skills/reset-framework/scripts/reset-framework.mjs
env -u NODE_OPTIONS -u NODE_PATH node .agents/skills/reset-framework/scripts/reset-framework.mjs --apply
env -u NODE_OPTIONS -u NODE_PATH node .agents/skills/reset-framework/scripts/reset-framework.mjs
```

## Create A Project

Tell Codex: `Create a new project called <Project Name>.` Supply an ordinary-language project brief,
or explicitly defer it and develop requirements during
[project intake](instructions.md#first-prompt-project-definition-intake). The
[creation skill](.agents/skills/create-project-from-framework/SKILL.md) creates
`<apps>/<Project Name>/code` without initializing Git, committing or pushing.

## Documentation

- [AGENTS.md](AGENTS.md): safe entry; [instructions](instructions.md): workflow and safety policy.
- [Project manifest](docs/project.md): current owners and technical inventory;
  [future modules](docs/future-modules.md): confirmed deferred candidates.
- [Documentation ownership](instructions.md#documentation-ownership) and
  [currency](instructions.md#documentation-currency): discovery and maintenance.
- [Architecture](instructions.md#modular-architecture-parallel-ownership-and-integration),
  [agent admission](instructions.md#admission-intelligence-and-provenance) and
  [delegated release](instructions.md#delegated-release).
- [Delivery environments](instructions.md#delivery-environments),
  [dependency preflight](instructions.md#coherent-component-updates-and-release-batching),
  [continuous delivery and manual testing](instructions.md#continuous-delivery-and-manual-testing),
  [Infrastructure as Code](instructions.md#infrastructure-as-code) and
  [permission design](instructions.md#permission-design).
- [Codex configuration](.codex/README.md): session, agent and private runtime settings.
- [Infrastructure administration](scripts/infrastructure/README.md) covers the Python CLI, text menu
  and project operation catalog.

`.codexrig/` owns source release identity, compatibility experiments and project-tool selection.
`.codex/tooling.json`, `.codex/toolchain.json` and `.codex/verification.json` own runtime settings,
tool pins and the canonical verification contract. Use
[current contracts](instructions.md#current-contracts-only).

## Essential Commands

Inside a canonical session, run project commands directly. From a host terminal, prefix them with
`bash -p scripts/setup/run-project.sh`; the wrapper loads project pins and private accounts without
activating them in the host shell.

```bash
pnpm framework:doctor -- --online
pnpm framework:version
pnpm compatibility:matrix
pnpm platform:detect
pnpm platform:configure                 # preview; add -- --apply for an authorized remote change
pnpm worktree:status -- --json
pnpm verify:changed -- --print-plan
pnpm verify:changed
pnpm verify                             # explicit complete coverage
pnpm project:export -- --name "<Project Name>"
pnpm framework:reset                    # preview; add --apply after sessions exit
pnpm handover:check -- --inspect          # read current native account windows
pnpm handover:check                      # at a safe checkpoint, pause automatically at 5% or less
pnpm handover:create -- --critical       # terminal seal for a confirmed hard limit
```

Plan before running checks. Development selects affected units; missing full evidence, a review or
resumption does not start a full suite. Valid results survive independent failures and session or
commit changes; relevant inputs, commands, dependencies and environment determine reuse. Unknown
dependencies need a contract correction before claiming coverage. `--print-plan` explains selection,
reuse, prerequisites, remaining coverage and observed or unknown cost without executing checks.
`pnpm verify -- --print-plan` validates complete-coverage admission and fails on unmapped inputs
without running tests; missing results remain listed as pending coverage.
`pnpm verify:changed -- --check <key>` runs or reuses one registered check and retains its results.
Add `--test-file <path>` for one independent Node test file. Its result also counts in the complete
suite. `--test-name-pattern <pattern>` is diagnosis only and does not record complete-file evidence.
Bounded Node commands retain independent file evidence with `--test-timeout=<milliseconds>`;
changing that limit invalidates the affected execution identity.

Publication composes complete candidate coverage from valid and newly required results; manual
verification, publisher retries and the managed pre-push hook share evidence. After reviewing and
authorizing the source changes, publish through the existing owner:

```bash
bash -p scripts/setup/run-project.sh pnpm framework:publish --message "<commit message>"
```

Keep source-side notes, patches, reproductions and saved reports from child updates or repairs in
`.project-state/child-maintenance/`. Framework publication clears this scratch and recognizes loose
untracked upgrade previews and reconciliation JSON by their content. It checks the candidate and
outgoing local commits for misplaced review documents, loose patches and concrete external checkout
references. A finding identifies the source file for review. Cleanup preserves nested checkouts,
local build pipelines, releases and infrastructure state. Unfinished update or recovery journals
defer cleanup until their owner settles them.

When invoked with publication authority, the command cleans, verifies, commits and pushes reviewed
non-ignored source on `main`, then confirms the remote commit. Failures preserve source and local
commits. A verified calling session may remain active; full runtime reset requires stopped sessions.
`--verbose` shows sanitized check output. Verification progress shows reused results and the active
checks before completion. Generated projects use `project:publish` on their configured
branch/upstream, retaining history and accounts without framework reset. Neither publisher deploys.
Candidate pinning and isolated release clones follow
[Delegated Release](instructions.md#delegated-release); see
[publication gates](instructions.md#verification-and-publication-gates) for authority and evidence.

An ordinary 5% account pause saves unfinished work in the project's private
`tmp/codexrig-handovers/` directory. After switching accounts, tell Codex “Mache mit dem Handover
`<genauer Pfad>` als Goal weiter.” This selects the handover and authorizes the native Goal. A
hard-limit seal requires a separate canonical session.
[Capacity policy](instructions.md#capacity-admission-and-monitoring) owns admission and recovery.

## Local Builds

Run builds on the local host through the pinned project environment. From that environment use:

```sh
pnpm build:local init
pnpm build:local run
pnpm build:local list
```

Edit the generated `.project-state/build/pipeline.json` to name the project's build commands and
artifact paths. The default pnpm pipeline materializes the committed lockfile offline from the
shared store before building. Prepare its packages once. The runner builds a committed source
snapshot, publishes successful outputs to `.project-state/build/releases/` and keeps the three
newest successful releases across the project. Use `pnpm build:local run --jobs 4` to lower the
local worker budget and `pnpm build:local clean` to collect old work on demand. A pipeline can set
`memoryMiBPerJob` from a measured peak to bound parallel jobs by available memory as well as CPU.
Workspace verification builds the current working tree, including uncommitted source, in its own
scratch directory. Only declared outputs are cached in `.project-state/build/verification-outputs/`
for checks that consume them. The runner uses the host's shared, pinned tools. Keep project inputs,
pipeline definitions, work and release output isolated. GitHub and GitLab host source and reviews.
The pre-push hook checks outgoing history for private pipeline files and build output. For an
existing remote repository, preview the owner-scoped settings with `pnpm platform:configure`. Only a
separately authorized apply disables Actions or GitLab CI/CD and Auto DevOps and reconciles the
branch rules.

## Project Accounts

[Repository-local isolation](instructions.md#repository-local-tool-and-account-isolation) owns tool
and account boundaries. Private state uses `.auth/project-tools/`; native Codex keeps root
`CODEX_HOME`. Private state is excluded from generation/transfer. Use the project wrapper for
logins; public tool settings use `.auth/project-tools/config/mise/config.toml`. Product setup
prepares SDKs once; verification does not install them.

Publication uses project Git identity/signing; missing `user.name`/`user.email` may use global
config without includes. HTTPS credentials use owner-only
`.auth/project-tools/home/.git-credentials`, scoped to protocol, host and repository, **unencrypted
on disk** and preserved across reset. Missing credentials may use global Git helpers or existing
`gh`/`glab` accounts for configured hosts; ambient tokens are ignored. The adapter neither logs in
nor changes global accounts, and bounds retries.

A browser login does not authenticate Git. Establish a host account in a normal terminal with
`gh auth login --hostname github.com` or `glab auth login --hostname gitlab.com` (substitute your
configured host), or enter a personal access token at Git's password prompt. Never put tokens in
commands, history or chat. The platform API instead uses owner-only `.auth/git-platform.json` with
`schemaVersion: 1`, `provider`, `hostname`, `repository` and `token`, read only for explicit
platform apply. SSH uses the private home's `.ssh/id_ed25519` and `.ssh/known_hosts`, without host
SSH config or agents.

A failed remote mutation may already have applied: preserve its reconciliation journal and follow
[failure recovery](instructions.md#deployment-and-qualification-failure-recovery). For an obsolete
local platform lock, preview `pnpm platform:configure -- --recover-lock --json`. After independently
confirming stopped writers, use
`pnpm platform:configure -- --recover-lock --apply --confirm-quiescent --expected-lock-fingerprint <sha256>`.
This local recovery preserves the journal, rejects changed locks/live owners and makes no provider
request; retry remote configuration separately with its normal authority.

## Repository Housekeeping

Use `bash -p scripts/setup/run-project.sh pnpm repo:housekeeping -- --apply` for owned maintenance.
For a storage report without product checks, use `pnpm repo:housekeeping -- --storage-only`; add
`--apply` for safe collection.
[Closure](instructions.md#completed-goal-closure-and-repository-housekeeping) and
[storage policy](instructions.md#temporary-data-and-storage-housekeeping) own ordering, free-space
admission, migration, retention and uncertain ownership. Never empty `.tmp/` or `.auth/` wholesale.

Pins/checksums stay tracked. Shared installations use `~/.local/share/project-tools/`;
downloads/browser caches use `~/.cache/project-tools/`. pnpm shares graphs with project metadata in
`node_modules`. `PROJECT_TOOL_STORAGE_HOME` relocates tools only; accounts/device state stays
private. Project housekeeping retains shared runtime versions and bootstrap bundles. Native package
and cache collectors reclaim unused package data and expired downloads.

## Documentation Context Economy

Use `pnpm context:map` for task routes and owners, then
`pnpm context:read -- instructions.md --section "Task Reading Routes"` for bounded reading.
`--outline` discovers sections; `--subtree` includes their children within the output limit.
`pnpm context:check` checks instruction budgets and structure, not task quality or acceptance; those
follow [Task Scope And Completion](instructions.md#task-scope-and-completion).

## Update Generated Projects

Use the [update skill](.agents/skills/update-project-from-framework/SKILL.md) from the reviewed
source release (`pnpm framework:version`). Preview does not install tools or modify the target:

```bash
pnpm framework:upgrade -- --target <project-root>
pnpm framework:upgrade -- --target <project-root> --baseline <pristine-generated-tree>
pnpm framework:upgrade -- --target <project-root> --reconcile <reviewed-decisions.json>
```

Review the proposed writes, retirements and conflicts before adding `--apply`. Current-output
comparison adds missing portable tools, package commands and verification entries. It preserves
project-only files, package metadata and custom checks. Divergent shared commands or existing tool
implementations require a decision.

Updates retire the two former stock provider workflows. An edited workflow needs a reviewed
resolution so its project-specific behavior can move into the private local pipeline.

Supply the original pristine generated tree with `--baseline` when available. The updater then
merges independent text edits in shared tools, policies and generated documentation, combines
independent JSON fields and retires unchanged obsolete framework files. Overlapping edits,
modify/delete conflicts and competing lockfile changes stop the entire apply. JSON conflicts
identify the affected keys. Use `--reconcile` with the same baseline for reviewed exceptions. Writes
and recovery require inactive Codex sessions across the target clone's worktrees. Older targets
without that runtime owner require a fresh generated comparison and explicit
`--regenerate --confirm-quiescent --apply`; independently confirm quiescence because a new lock
cannot fence an old launcher. Interrupted ordinary updates use `--recover`; regeneration uses
`--regenerate --confirm-quiescent --recover` with the exact admitted source runtime.

One journal covers public tools/policy and named `--project-path` owners, excluding private runtime.
Children have no self-updater or installation receipt.

A successful `framework:upgrade -- --target <project-root> --apply` that changes the project
schedules a full reset of the local CodexRig session state. Finish the update checks and exit
CodexRig with `/quit`. The launcher then clears all framework threads, including archived ones,
their indexes and databases, the local work-context cache, and the source-side child maintenance
scratch. A terminal update can finish the reset immediately when the source is idle. After an
interrupted exit, the next launch retries before opening the session picker. Active sessions,
verification and unfinished recovery defer cleanup. Accounts, installation identity, source files
and the updated project are preserved. Previews, failed applies and already-current projects leave
session history in place.

[Lifecycle](instructions.md#framework-lifecycle-compatibility-and-git-platforms) and
[update scope](instructions.md#repository-update-scope) own reconciliation.
[Targeted acceptance](instructions.md#maintenance-scope-and-verification) ends the update without
product development, dependency refresh or broad product tests.

## License And Attribution

CodexRig itself is available under the [PolyForm Noncommercial License 1.0.0](LICENSE). Copies of
the framework retain its [Required Notice](NOTICE), Zoran Kikic author credit and CodexRig Framework
credit. Commercial use requires a separate express written license for the framework; the
generated-output permission does not permit their removal from CodexRig itself.

The copyright holder expressly permits the selected project tools and templates emitted into new
projects to be used, modified, distributed and sold without CodexRig attribution or inherited
license obligations. [NOTICE](NOTICE) owns this additional permission and its scope. Generated
projects contain no CodexRig license/notice files or references and start with no public product
license selected; their owner chooses product licensing. Third-party components retain their
applicable terms.
