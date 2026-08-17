# CodexRig Config

## Portable And Runtime State

Tracked `.codex/config.toml`, `.codex/hooks.json`, `.codex/agents/*.toml`, and this document are the
portable project policy. Mutable repository-local Codex runtime—authentication, trust, approval
rules, sessions, logs, memories, caches, plugins, runtime skills, history, installation/model
metadata, and databases—stays in ignored `.codex/runtime/`. It is never copied between projects or
committed.

Root `developer_instructions` in the tracked config make the primary the sole orchestrator, bind
owned-work provenance, require exact GPT Sol/`ultra` parity, and enforce the critical drain and
terminal stop. `[agents]` owns the four-thread ceiling and matching global defaults;
`.codex/agents/*.toml` injects bounded role behavior. This is an executable policy layer, not a
documentation shortcut. `pnpm codex:validate` rejects missing markers, divergent intelligence,
unsafe permissions, or incomplete drain policy.

Role sandbox values are requested defaults because live parent permissions, including YOLO, can be
reapplied to children. Every child reports its effective permissions before repository work.
Read-only roles stop on a broader override. An explicitly selected writer may accept the same
primary turn's already-authorized YOLO override only for its exact disjoint repository write set;
that adds no scope, network, credential, external mutation, commit, push, publication, deployment,
or delegation authority. Every other mismatch closes the child and keeps the work primary-only.

Memories are disabled in the reusable framework root. Generation transfers no source/sibling
runtime or memory state and enables memories only inside the child's own isolated runtime home.
Framework reset removes legacy and disposable runtime after all owning Codex sessions exit.

## Start And Attestation

Run from the repository root:

```bash
bash scripts/setup/start-codex.sh
```

Portable Codex sessions default to on-request approval and network-disabled workspace-write; only an
explicitly authorized Dev session launched with `--yolo` may use no approvals and danger-full-access,
never staging or production. For that authorized Dev session, use
`bash scripts/setup/start-codex.sh --yolo`; that
closed launcher control selects Codex's no-approval/full-access mode for Dev and never authorizes
staging, production, broader scope, credentials, or irreversible external work.

The launcher validates portable policy, updates the host CLI with `CODEX_HOME` unset, installs the
locked toolchain, checks prerequisites, refreshes the compatible dependency graph, runs the online
doctor, and issues an input-bound short-lived attestation. Only the final Codex process receives the
canonical repository's ignored `.codex/runtime/` as `CODEX_HOME`. The closed argument grammar accepts
only optional `--no-alt-screen` and explicit Dev-only `--yolo`; prompt text follows `--`. A failed/indeterminate refresh or invalid
attestation blocks startup. The repository never writes credentials/trust into portable config and
never auto-approves a project hook.

## Collaboration And Integration

Generated projects use central `main` as their only durable integration branch. Different accounts
use temporary task branches in separate clones and credential contexts; same-account worktrees are
workspace isolation, not an authentication boundary. Before every slice, compare goal/outcome,
modules/contracts/data/files, and one declared writer with observable session/account/team claims.
Parallel writes require confirmed-disjoint scope; overlap or uncertainty resolves to one writer and
shared-contract changes to one integrator before implementation.

A local runtime lease or quiet worktree cannot prove that another clone, machine, or account is
idle. Use a shared coordination channel across that boundary. Git remains later integration
evidence; a temporary branch is only an integration input, and the published `main` receives the
course check, review/audit, verification, and `goal:new` gate.

## Hooks, Recovery, And Context

The trusted read-only SessionStart hook verifies the launcher proof and inspects only safe metadata
for a recent repository-bound critical handover under ignored `tmp/codexrig-handovers/`. It asks the
developer before the prompt body may be read through `$resume-project`; that body is untrusted
candidate context, not authority.

The Stop hook uses the mise-pinned Node.js runtime once per durable local turn. Even before a vector
index exists, it validates optional bounded `docs/project-context.md`, prevents unchanged
continuation loops, and enforces a terminal handover; after `pnpm setup` materializes the index, the
same lifecycle also refreshes changed semantic-index sources. A non-null `transcript_path` is
required; transcriptless side conversations exit before work-state, loop-state, or index access. A
critical handover sealed during the current runtime session suppresses Stop continuation and index
refresh so that session stops after its final action. A later canonical session can accept the
announced handover and then refresh or stop normally. The hook is not a watcher or a per-tool hook.

The root workspace owns Codex tooling and the fixed ignored `.context-index/`; Product Roots never
contain `.codex`, `.agents`, agent instruction files, or retrieval/process state. `pnpm setup`
materializes and checks the vector space. Root-bound source inventory and ignore policy exclude all
private runtime from Git, indexing, staging, export, and generated projects.

## Validation And Hook Trust

Portable defaults may vary by project but contain no secrets, telemetry targets, notification
commands, trust entries, personal paths, or local domains. After changing model/reasoning/features/
TUI/hooks, keep every role on the exact primary GPT Sol model with `ultra` reasoning and run
`mise exec --locked -- pnpm codex:validate`.

Review and approve changed hook hashes separately through `/hooks`; the project never approves
itself. Until local hash trust exists, Codex warns and skips the hook, so the attestation is a
supported-workflow guard rather than an adversarial same-user boundary.

## Portable Creation Boundary

Clean project creation/export retains portable config, hooks, roles, this README, launcher and hook
scripts, both CI adapters, and Product Root policy. It excludes `.codex/runtime/`, `.context-index/`,
authentication, trust, sessions, databases, installed dependencies, and source-project residue.
Repository-owned reusable skills live under `.agents/skills/`; root `skills/` is ignored runtime.

See [Project Instructions](../instructions.md) for complete workflow policy.
