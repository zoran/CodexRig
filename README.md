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
For permission boundaries, session recovery and agent inheritance, see
[Session Start](instructions.md#session-start) and
[Effective Permissions](instructions.md#effective-permissions-and-write-isolation).

The launcher maintains compatible tools and dependencies before opening native Codex resume. See
[Dependency Installation And Freshness](instructions.md#dependency-installation-and-freshness) for
maintenance behavior and failure handling, and
[Startup Repository Reconstruction](instructions.md#startup-repository-reconstruction) for recovery.

Use `/side` inside a running session for a separate temporary conversation. After a framework
update, exit and restart through the canonical launcher so the updated lifecycle code takes effect.

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
- [Delivery and verification](instructions.md#delivery-environments)
- [Session and agent configuration](.codex/README.md)

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

Running this command explicitly authorizes publication of all non-ignored source changes on `main`.
It performs reset, housekeeping, verification, commit and push; do not run its individual steps
separately beforehand. See [Verification And Publication](instructions.md#verification) for the
exact gates, evidence and recovery behavior. Generated projects do not include this source
publisher.

## Repository Housekeeping

Run `mise exec --locked -- pnpm repo:housekeeping -- --apply` for repository maintenance. See
[closure and housekeeping](instructions.md#completed-goal-closure-and-repository-housekeeping) for
its required order, preservation boundaries and source-version reconciliation.

## Documentation Context Economy

See [Documentation Ownership](instructions.md#documentation-ownership) for where content belongs and
how README links are maintained when documents are added, moved or retired.

## Update Generated Projects

A child previews a reviewed framework with `pnpm framework:upgrade -- --source <new-codexrig-root>`;
this source previews a child with `pnpm framework:upgrade -- --target <child-root>`. Add `--apply`
only after reviewing the receipt-backed plan. Follow
[Framework Lifecycle](instructions.md#framework-lifecycle-compatibility-and-git-platforms) and
[Repository Update Scope](instructions.md#repository-update-scope).

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
- [Project Manifest](docs/project.md) is the current technical inventory.
- [Future Modules](docs/future-modules.md) owns confirmed deferred candidates only.
- [.codex/README](.codex/README.md) explains portable Codex configuration and private runtime.
- `.codexrig/` owns versioned framework, compatibility, provider, and upgrade contracts.
