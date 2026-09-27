# CodexRig Framework

CodexRig is a reusable, production-ready, code-first framework for isolated Codex projects. It
provides portable policy, compatible dependency maintenance, durable context recovery, modular
architecture guardrails, provider-neutral Git automation, and risk-based verification without
imposing a product stack.

## Start

Provide a current Node.js bootstrap, Git, Bash, ripgrep, ShellCheck and the system archive tool. The
launcher installs reviewed Mise, Codex and locked project runtimes inside the repository; it does
not update host installations. Run from the repository root:

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
For permission boundaries, session recovery and agent inheritance, see
[Session Start](instructions.md#session-start) and
[Effective Permissions](instructions.md#effective-permissions-and-write-isolation).

The launcher maintains compatible tools and dependencies before opening native Codex resume. See
[Dependency Installation And Freshness](instructions.md#dependency-installation-and-freshness) for
maintenance behavior and failure handling, and
[Startup Repository Reconstruction](instructions.md#startup-repository-reconstruction) for recovery.

Use `/side` inside a running session for a separate temporary conversation. After a framework
update, exit and restart through the canonical launcher so the updated lifecycle code takes effect.

For noninteractive initial preparation, the same maintenance owner can install the toolchain and
compatible dependencies without opening Codex. Every subsequent project command uses the common
repository-local entry:

```bash
node scripts/deps/maintain-toolchain.mjs
bash scripts/setup/run-project.sh pnpm setup
bash scripts/setup/run-project.sh pnpm framework:doctor -- --online
```

CI and reproducible setup use `node scripts/deps/maintain-toolchain.mjs --locked` to install only
the reviewed tool pins and frozen dependency graph. CI runs in disposable containers; source-only
compatibility experiments explicitly prepare a declared candidate in their disposable checkout. They
retain the full verification and release checks.

If startup reports an invalid or unsupported private session lease, exit every Codex session using
this framework. Run the reset owner directly with the read-only Node bootstrap, because the normal
command entry correctly refuses an unsafe lease. Never delete `.codex/runtime` manually:

```bash
node .agents/skills/reset-framework/scripts/reset-framework.mjs
node .agents/skills/reset-framework/scripts/reset-framework.mjs --apply
node .agents/skills/reset-framework/scripts/reset-framework.mjs
bash scripts/setup/start-codex.sh
```

## Current Contracts Only

See [Current Contracts Only](instructions.md#current-contracts-only) for the supported contract
boundary and regeneration of non-current installations.

## Create A Project

### First Prompt: Define The Project

Tell Codex: `Create a new project called <Project Name>.` Provide a detailed project description in
ordinary language, or explicitly defer it and develop the requirements with Codex during intake. The
new project is created at `<apps>/<Project Name>/code`; generation does not initialize Git, commit
or push.

Follow [Project Definition Intake](instructions.md#first-prompt-project-definition-intake) to
develop and confirm the scope. The
[creation skill](.agents/skills/create-project-from-framework/SKILL.md) owns generation, transfer
boundaries and handling of an optional creation brief.

## Documentation

- [Current technical inventory](docs/project.md)
- [Deferred module candidates](docs/future-modules.md)
- [Workflow and safety policy](instructions.md)
- [Project definition intake](instructions.md#first-prompt-project-definition-intake)
- [Documentation ownership and discovery](instructions.md#documentation-ownership)
- [Architecture and product boundaries](instructions.md#modular-architecture-parallel-ownership-and-integration)
- [Parallel development and the four-subagent default](instructions.md#admission-intelligence-and-provenance)
- [Delivery and verification](instructions.md#delivery-environments)
- [Infrastructure and application permission design](instructions.md#permission-design)
- [Session and agent configuration](.codex/README.md)

## Essential Commands

Run these commands inside the canonical session. From a host shell, prefix them with
`bash scripts/setup/run-project.sh`. Project pins and locks live under `.codex/` and are loaded
explicitly, so the host shell does not activate them after Codex exits. The launcher explicitly uses
Codex's embedded mode (`--no-daemon`) for its trusted session-only hooks and settings. An ASCII name
reveal introduces five startup phases. The launcher name is owned by `startup.displayName` in
`.codex/tooling.json`; generated projects receive their supplied project name. Logs, CI, `TERM=dumb`
and `NO_COLOR` use static text without motion or terminal escapes.

```bash
pnpm framework:doctor -- --online
pnpm framework:version
pnpm platform:detect
pnpm platform:configure                 # preview
pnpm platform:configure -- --apply      # mutate the detected remote
pnpm compatibility:matrix
pnpm worktree:status -- --json
bash scripts/setup/run-project.sh <command> [arguments] # project environment, then mise exec --locked
pnpm verify:changed -- --print-plan
pnpm verify
pnpm handover:create -- --critical       # terminal critical-capacity seal
pnpm project:export -- --name "<Project Name>"
pnpm framework:reset
pnpm framework:reset --apply
pnpm framework:publish --message "<commit message>"  # after exiting Codex
```

Verification reuses successful evidence for unchanged source and the same effective toolchain.
`verify:changed -- --print-plan` reports the selected checks and the reason before executing them.
Captured checks use a consistent terminal presentation, so color settings or switching terminals do
not trigger another product suite. Changes to verification controls, tools or uncovered source still
require the corresponding evidence. Use the project wrapper from a host shell so the selected
toolchain also remains consistent.

The handover command is not routine housekeeping. After it reports a sealed path, the Codex session
must stop without another action. To continue from that handover, exit Codex completely with
`/quit`, then run `bash scripts/setup/start-codex.sh` from the project root in your terminal. Accept
the handover when the new session announces it. `/new` and `/resume` inside the running CLI retain
its existing launcher; they cannot replace this restart. Keep the handover and runtime files intact.

To finish framework work, the existing `framework:publish` script runs the complete cleanup,
verification, commit and push sequence. After reviewing all source changes, exit every Codex session
for this framework and run this one command from its root:

```bash
bash scripts/setup/run-project.sh pnpm framework:publish --message "<commit message>"
```

The wrapper establishes the project environment and executes the existing
`bash scripts/setup/run-project.sh pnpm framework:publish --message "<commit message>"` pipeline.
Project Git identity takes precedence, with the public name/email fallback described below. Signing
remains project-owned. HTTPS authentication can reuse the explicit GitHub/GitLab global-login
fallback.

Publication shows eight numbered phases, the current task and elapsed time. Successful checks stay
compact; a failure identifies the stopped phase and shows its diagnostic tail. Add `--verbose` after
the commit message to show sanitized command output after each check. Interactive terminals show a
live progress line; redirected output uses plain status lines. `NO_COLOR` disables colors. Git
sign-in prompts remain interactive. After the first successful HTTPS authentication, subsequent
publishes reuse the project credential described below until it expires or is revoked.

Running this command explicitly authorizes publication of all non-ignored source changes on `main`.
It performs reset, housekeeping, verification, commit and push; do not run its individual steps
separately beforehand. See [Verification And Publication](instructions.md#verification) for the
exact gates, evidence and recovery behavior. Generated projects do not include this source
publisher.

Generated projects receive their own `project:publish --message "<commit message>"` command through
the same `bash scripts/setup/run-project.sh` entry. It verifies, commits and pushes the current
branch to its configured upstream with the same progress display and project-local HTTPS sign-in. It
preserves native session history and accounts and performs no framework reset or direct deployment.
Review all non-ignored changes and exit the project's Codex sessions before running it; existing
hooks, branch protections and CI/deployment approvals remain effective. In this source repository
`project:publish` is an alias for the framework publisher above.

## Project Accounts

[Repository-local isolation](instructions.md#repository-local-tool-and-account-isolation) owns the
account boundary and future tool admission. Private tool home, configuration, installations, caches
and temporary state live under `.auth/project-tools/`; native Codex state remains in the root
`CODEX_HOME`. These paths are excluded from Git, context, generation and transfer. Login commands
must run through `bash scripts/setup/run-project.sh`; existing project credentials remain private.

Persistent public tool settings belong in the project-private Mise configuration at
`.auth/project-tools/config/mise/config.toml`. The normal project wrapper loads them before
verification and publication. Prepare required SDKs or test runtimes once through their product
setup owner; use defaults that preserve explicit tool selections. Verification never installs them.

Commit author names and email addresses use project Git configuration first. When a value is
missing, publication reads only `user.name` and `user.email` from the operating-system user's
standard global Git configuration, without includes. It validates the resulting author and committer
before repository verification and rechecks them before staging. Global hooks, signing settings and
credentials are not imported; existing project signing remains in effect. No Git configuration is
changed. If neither configuration supplies a complete identity, the error shows project-local
`git config` commands.

Git HTTPS authentication uses Git's built-in `credential-store`, explicitly bound to
`.auth/project-tools/home/.git-credentials`. Git remembers a successfully authenticated username and
token there and removes rejected credentials through its normal credential lifecycle. The store is
scoped by protocol, host and repository path, has owner-only file permissions, and survives reset.
It is **unencrypted on disk** and excluded from Git and generated projects. If no project credential
is available, the adapter tries the user's global Git helpers and then the matching existing CLI
login: `gh` for GitHub or `glab` for GitLab. This applies equally to the provider hosts declared in
`.codex/tooling.json`, including configured self-hosted instances. Native helpers resolve their
user-home configuration and keyring; ambient token variables are not imported. The adapter never
requests global credential storage/deletion or starts a login. Git may cache an approved fallback
credential in the project store. Other providers and SSH accounts remain project-local.

If Git rejects a credential during publication, the publisher tries the remaining available global
credentials in up to two automatic retries, without another prompt. It skips already rejected
credentials and preserves global accounts. This recovery applies only to confirmed authentication
rejections; other Git failures still stop the affected phase.

A browser-only session does not authenticate Git. If no local or global credential exists, establish
one in a normal host terminal with `gh auth login --hostname github.com` or
`glab auth login --hostname gitlab.com` (use your configured host for self-hosted instances), or
enter a personal access token at Git's password prompt. Never put a token in a command, shell
history or chat.

The platform-policy API uses `.auth/git-platform.json`, with private owner-only permissions and
exact fields `schemaVersion` (1), `provider`, `hostname`, `repository` (the selected remote's slug),
and `token`. It reads this file only for explicit `platform:configure -- --apply`; inherited host
tokens are ignored. Configure this private file locally without putting its contents into prompts,
command history or source control. Git's SSH transport uses the project home's `.ssh/id_ed25519` and
`.ssh/known_hosts`, with host SSH configuration and agents disabled. Other authentication adapters
must meet the same boundary before use.

## Repository Housekeeping

Run `bash scripts/setup/run-project.sh pnpm repo:housekeeping -- --apply` for repository
maintenance. See
[closure and housekeeping](instructions.md#completed-goal-closure-and-repository-housekeeping) for
its required order, preservation boundaries and source-version reconciliation.

## Documentation Context Economy

Use `pnpm context:map` for navigation, `pnpm context:read -- instructions.md --outline` for section
discovery, and `pnpm context:check` to detect automatic instruction growth. Large reference
documents stay intact; select relevant sections instead of loading them all. The byte budgets are
repository guardrails, not native model limits or proof of quality. They complement outcome-based
review. The design follows
[OpenAI context guidance](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)
and [progressive skill disclosure](https://learn.chatgpt.com/docs/build-skills). The
[repository-context study, revision 2](https://arxiv.org/html/2602.11988v2) found no general success
improvement from added context files and higher costs in its tested settings; that is motivation to
measure actual tasks, not an Astra-specific performance guarantee.

See [Documentation Ownership](instructions.md#documentation-ownership) for where content belongs and
how README links are maintained when documents are added, moved or retired.

## Update Generated Projects

Use [Update Project from Framework](.agents/skills/update-project-from-framework/SKILL.md). From
this source, preview the current generated tools and policy against an explicit target:

```bash
pnpm framework:upgrade -- --target <project-root>
pnpm framework:upgrade -- --target <project-root> --reconcile <reviewed-decisions.json>
```

Every divergent existing file needs a reasoned decision bound to its current and desired hashes and
modes. Review the write/delete plan and intentional product deviations before adding `--apply`. All
target sessions must be stopped; its own runtime owner enforces exclusion. For an old target without
that owner, prepare a small fresh generated candidate and reconcile it before using explicit
`--regenerate --confirm-quiescent --apply`. Confirm stopped writers independently: a new lock cannot
fence an old launcher. Interrupted regeneration uses `--regenerate --confirm-quiescent --recover`
and requires the exact admitted source runtime; ordinary recovery uses `--recover`. The single
current journal covers public policy, tools and explicitly named `--project-path <path>` document or
configuration owners; private runtime is never a migration input. A real pristine ancestor may
additionally support `--baseline <pristine-generated-reference>` for a three-way comparison. Never
substitute a customized checkout for that reference. Maintained product documents, identity and
custom verification require local reconciliation, not blind replacement. Generated projects contain
no self-updater or installation receipt. See
[Framework Lifecycle](instructions.md#framework-lifecycle-compatibility-and-git-platforms) and
[Repository Update Scope](instructions.md#repository-update-scope).

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

## Project Authority

- [Project Instructions](instructions.md) own complete workflow and safety policy.
- [AGENTS.md](AGENTS.md) is the short safe-entry bootstrap.
- [Project Manifest](docs/project.md) is the current technical inventory.
- [Future Modules](docs/future-modules.md) owns confirmed deferred candidates only.
- [.codex/README](.codex/README.md) explains portable Codex configuration and private runtime.
- `.codexrig/` owns source release identity, future compatibility experiments and explicit
  project-tool selection.
- `.codex/tooling.json`, `.codex/toolchain.json` and `.codex/verification.json` own local runtime,
  stable tool pins and selected verification respectively.
