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
workspace-write, on-request approvals and disabled command network access. Explicitly authorized Dev
sessions use `bash -p scripts/setup/start-codex.sh --yolo` for unrestricted access without approval
prompts; task scope stays unchanged. Keep `bash -p` to block inherited shell startup code. Only
`--yolo` and `--no-alt-screen` are launcher controls; enter prompts after session selection.
[Session Start](instructions.md#session-start) and
[Effective Permissions](instructions.md#effective-permissions-and-write-isolation) own these
boundaries.

For initial preparation without opening Codex:

```bash
env -u NODE_OPTIONS -u NODE_PATH node scripts/deps/maintain-toolchain.mjs
bash -p scripts/setup/run-project.sh pnpm setup
bash -p scripts/setup/run-project.sh pnpm framework:doctor -- --online
```

Frozen setup and CI add `--locked` to the maintenance command; normal startup retains release
discovery. [Dependency maintenance](instructions.md#dependency-installation-and-freshness) owns
installation, migration and freshness. Busy lifecycle owners are reported and waited for; cancelling
the wait preserves the owner. Never bypass a live or uncertain lock.

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
  [Infrastructure as Code](instructions.md#infrastructure-as-code) and
  [permission design](instructions.md#permission-design).
- [Codex configuration](.codex/README.md): session, agent and private runtime settings.

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
pnpm handover:create -- --critical       # terminal seal after a confirmed critical-capacity decision
```

Plan before running checks. Development selects affected units; missing full evidence, a review or
resumption does not start a full suite. Valid results survive independent failures and session or
commit changes; relevant inputs, commands, dependencies and environment determine reuse. Unknown
dependencies need a contract correction before claiming coverage. `--print-plan` explains selection,
reuse, prerequisites, remaining coverage and observed or unknown cost without executing checks.
`pnpm verify:changed -- --check <key>` reproduces one registered check without recording acceptance;
native Node checks also accept `--test-name-pattern <pattern>`.

Publication composes complete candidate coverage from valid and newly required results; manual
verification, publisher retries and the managed pre-push hook share evidence. After reviewing and
authorizing the source changes, publish through the existing owner:

```bash
bash -p scripts/setup/run-project.sh pnpm framework:publish --message "<commit message>"
```

This authorizes cleanup, verification, commit and push of reviewed non-ignored source on `main`,
followed by remote confirmation. Failures preserve source and local commits. A verified calling
session may remain active; full runtime reset requires stopped sessions. `--verbose` shows sanitized
check output. Generated projects use `project:publish` on their configured branch/upstream,
retaining history and accounts without framework reset. Neither publisher deploys. Candidate pinning
and isolated release clones follow [Delegated Release](instructions.md#delegated-release); see
[publication gates](instructions.md#verification-and-publication-gates) for authority and evidence.

A sealed critical handover is terminal: stop, exit Codex, relaunch and accept the announced
handover. Keep its files intact; restart alone proves no capacity recovery.
[Capacity policy](instructions.md#capacity-admission-and-monitoring) owns admission and recovery.

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
private. Native references and observed use protect other projects. Runtime/browser owners retire
payloads; disposable checks reuse installations and clean their own managed scratch.

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
pnpm framework:upgrade -- --target <project-root> --reconcile <reviewed-decisions.json>
```

Review the write/delete plan and hash/mode-bound decisions for every divergent file, preserving
product identity, documents and custom checks. Add `--apply` only with target sessions stopped; the
target runtime enforces exclusion. A real pristine generated ancestor may supply `--baseline`. Older
targets without that runtime owner require a fresh generated comparison and explicit
`--regenerate --confirm-quiescent --apply`; independently confirm quiescence because a new lock
cannot fence an old launcher. Interrupted ordinary updates use `--recover`; regeneration uses
`--regenerate --confirm-quiescent --recover` with the exact admitted source runtime.

One journal covers public tools/policy and named `--project-path` owners, excluding private runtime.
Children have no self-updater or installation receipt.
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
