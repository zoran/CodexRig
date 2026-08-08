# CodexRig Config

This repository separates portable project policy from mutable repository-local Codex runtime:

- tracked `.codex/config.toml`: project-scoped approval, sandbox, network, search, instruction,
  model, reasoning, service-tier, feature, and TUI defaults;
- tracked `.codex/hooks.json`: a read-only SessionStart attestation check and one project-local Stop
  hook, both reviewed and approved locally by content hash through `/hooks`;
- tracked `.codex/agents/*.toml`: built-in subagent-role overrides pinned to the installed catalog's
  second model tier, inheriting the primary's default `max` or explicit `xhigh`/`ultra` effort, with
  no stronger or weaker model fallback; roles follow the same exact-versus-semantic retrieval triage
  as the primary thread and read matched sources directly;
- ignored `.codex/runtime/`: authentication, trust, sessions, logs, memory data, plugins, caches,
  runtime skills, history, installation/model metadata, and Codex databases.

Local Codex memory isolation is repository-local and root-bound under ignored `.codex/runtime/`.
Memories are disabled in the reusable framework root, whose sessions cannot consume earlier task or
product memories or become inputs for future memory generation. During clean project creation the generator enables memories in the
target's copied config, while transferring no memory files or databases, so generated projects use
their own isolated memory normally. Ignored framework memory paths remain defensive legacy/runtime
boundaries and are removed by framework reset after the owning Codex session exits.

Run the supported command exactly from the repository root:

```bash
bash scripts/setup/start-codex.sh
```

The launcher validates portable policy, updates the host CLI without project isolation, installs the
locked toolchain, checks prerequisites, atomically refreshes the newest stable compatible dependency
graph, runs the online framework doctor, and issues an input-bound short-lived attestation before
starting Codex. A failed update or indeterminate resolution blocks startup. The trusted read-only
SessionStart hook rejects startup/resume without that proof. Only the final Codex process receives
the canonical repository's ignored `.codex/runtime/` as `CODEX_HOME`, so each project owns its
mutable runtime without polluting a global user home. Root-bound ignore rules and the shared
source inventory exclude that state from Git and every portable or source-consuming workflow. The
repository never writes credentials or trust into tracked configuration and never auto-trusts a
clone or approves a hook.

Generated product repositories use one central `main` as their only durable integration branch and
do not keep long-lived module or developer branches. A serialized writer may use `main` directly
when branch policy permits. Different developers or Codex accounts use temporary task branches in
separate clones with separate OS or provider credential contexts. Git worktrees may isolate parallel
tasks for the same trusted account, but they are not an authentication boundary: they can share
repository configuration and Git credential helpers. Each clone or worktree still uses its own
ignored `.codex/runtime/` for Codex runtime. Tracked `.codex/` policy is the shared behavior contract; mutable
account state is never copied between collaborators or committed. Parallel coding sessions receive
disjoint module and file scopes, while shared contracts have one write owner and integrator at a
time. A temporary branch is only an integration input; the actual published `main` receives the
final course check, affected review/audit, verification, and `goal:new` gate.

`bash scripts/setup/start-codex.sh` is the canonical launcher. It runs the host update with
`CODEX_HOME` unset, uses mise to install the locked Node.js and pnpm toolchain, refreshes compatible
dependencies, verifies the framework/provider contract, then sets `CODEX_HOME`, the ephemeral
attestation nonce, and `--cd` to the canonical repository root. It rejects conflicting root or
policy overrides before any update starts. Its closed argument grammar permits only optional
`--no-alt-screen`; prompt text follows `--`, and the attestation binds that control mode.

The repository root is intentionally the Codex and tooling workspace. Root `src/` is the default
Product Root; real declared pnpm packages and evidenced Android modules may add their contracted
source roots. Project policy, skills, instruction files, the fixed root `.context-index/` vector
space, and mutable agent state remain outside every product unit. Project `pnpm setup` materializes
and validates that vector space. Before bootstrap the Stop hook exits without touching Node.js,
mise, or index state; afterward it uses the mise-pinned Node.js runtime to refresh changed sources
once per turn. The same hook validates an optional bounded `docs/project-context.md`
`codexrig-work-state` marker and reopens an active multi-goal or multi-session outcome. If Codex's
`stop_hook_active` flag says the same turn was already continued and its semantic revision is
unchanged, the private per-session record lets that stop proceed rather than looping. Marker content
is resume metadata rather than authority, and missing local hook trust is never evidence that work
is complete. It is not a persistent watcher or a per-tool hook.

The tracked project config intentionally carries portable defaults that may differ between projects.
It contains no credentials, provider secrets, telemetry targets, notification commands, trust
entries, absolute personal paths, local domains, or other machine-local/private values. Repository
validation reads the tracked policy and path layout only; it never reads user credentials or session
data.

After changing a project's portable model, subagent tier, reasoning, feature, TUI, or hook defaults,
run `mise exec --locked -- pnpm codex:validate`. Review and approve a changed hook hash separately
through `/hooks`; the project never approves itself. Until local hash trust exists Codex warns and
skips a project hook, so this attestation is a supported-workflow guard rather than an adversarial
same-user security boundary. Security-boundary values remain fixed by repository policy unless that
policy and its regression are deliberately changed.

Clean project initialization and portable export retain `.codex/config.toml`, `.codex/hooks.json`,
`.codex/agents/`, this README, and the hook and launcher scripts while excluding mutable
`.codex/runtime/` and legacy loose root runtime. They also retain and validate the separate Product
Roots contract and default `src/` boundary. They never copy authentication, sessions, databases, or
local hook trust state.

Repository-owned skills live only under `.agents/skills/`. Root `skills/`, when created by Codex, is
ignored runtime content rather than project source.

See [Project Instructions](../instructions.md) for the project workflow.
