# CodexRig Config

## Portable And Runtime State

Tracked `.codex/config.toml`, `.codex/hooks.json`, `.codex/agents/*.toml`, the three local JSON
contracts and this document are portable project policy. `.codex/tooling.json` owns startup/provider
settings and the requirement for product configuration; `.codex/toolchain.json` owns stable pins and
archive integrity; `.codex/verification.json` owns selected checks and their consumers. Mutable
repository-local Codex runtime—authentication, trust, approval rules, sessions, logs, memories,
caches, plugins, runtime skills, history, installation/model metadata, and databases—stays in
ignored entries of the repository-root `CODEX_HOME`. Framework coordination alone stays in ignored
`.codex/runtime/`. Neither is copied between projects or committed.

External tool accounts remain under `.auth/project-tools/`; reusable installations, package graphs
and browser distributions use the admitted user tool store. Temporary command data has an execution
lifetime, while accounts, active sessions and pending operation recovery retain their owners. See
[tool/account isolation](../instructions.md#repository-local-tool-and-account-isolation) for paths
and [storage housekeeping](../instructions.md#temporary-data-and-storage-housekeeping) for cleanup.
These controls do not authorize deleting a native runtime or account directory from an active
session.

The verification registry selects targeted development checks and the publisher's complete coverage.
Both use the same per-check evidence store; review, handoff and resume do not schedule test repeats.
See [verification selection](../instructions.md#verification-selection-and-runtime). Portable policy
changes take effect through normal generation/update and the next canonical launch, not by reloading
an already-running agent.

Root `developer_instructions` inject the four-subagent default and continuous reassignment while
useful authorized work remains. `[agents]` owns the twelve-subagent capacity ceiling (excluding the
primary) and intelligence defaults; twelve is not the default team size. Additional user-started
agents join the continuing team after ownership and admission checks. `.codex/agents/*.toml`
supplies bounded roles. The
worker's [Delegated Release](../instructions.md#delegated-release) assignment occupies an existing
slot. `pnpm codex:validate` rejects missing policy markers, divergent intelligence or permissions.
These checks prove packaging/configuration, not model obedience over a long session.

The canonical owners are [Planning](../instructions.md#planning-entry-gate),
[course checks](../instructions.md#long-session-course-checks),
[agent admission](../instructions.md#admission-intelligence-and-provenance) and
[capacity recovery/drain](../instructions.md#capacity-admission-and-monitoring).
They govern useful parallel work and
[continuous dispatch](../instructions.md#agent-lifecycle-and-idle-cleanup): accept each handoff,
close its scope and assign the next ready task without waiting for the whole wave or another user
prompt. They also govern current-unit reserve decisions,
earned resets and terminal handover. Native Goals follow their
[authority boundary](../instructions.md#authorized-work-and-native-codex).
Generation/update project the policy; no extra scheduler, quota monitor, release registry or hook
exists. Tracked policy and preloaded Stop changes apply at the next canonical launch, not by
reloading an already-running session.

The primary and all roles use the configured model's second-highest supported effort: currently
`gpt-6-astra` with `max` reasoning, one level below `ultra`. Installed-catalog validation checks the
rank as well as support; model changes must update the shared policy and all roles together.
Standard processing is the default: portable config leaves `service_tier` unset, and roles inherit
the session tier.

Role sandbox values are requested defaults because live parent permissions, including YOLO, can be
reapplied to children. Every child reports its effective permissions before repository work.
Read-only roles stop on a broader override. An explicitly selected writer may accept the same
primary turn's already-authorized YOLO override only for its exact disjoint repository write set;
that adds no scope, network, credential, external mutation, commit, push, publication, deployment,
or delegation authority. Every other mismatch closes the child and keeps the work primary-only.

Memories are disabled in the reusable framework root. Generation transfers no source/sibling runtime
or memory state and enables memories only inside the child's own isolated runtime home. Framework
publication preserves the verified calling session and its private runtime. Full framework reset
removes obsolete and disposable runtime only after all owning Codex sessions exit.

## Current Contracts Only

CodexRig provides no backward compatibility for superseded internal contracts. Non-current generated
installations are regenerated, and quiescent full reset discards incompatible private runtime
without interpreting it.

Portable Codex runtime retains exactly one current internal contract per concern. Contract changes
migrate owned state and all consumers together, then remove superseded schemas, shims, paths, tests,
and documentation. Strict validation, atomic transitions, bounded recovery, and fail-closed
indeterminate state provide robust, resilient, fault-tolerant behavior without parallel runtime
interpreters. The current constrained TOML/config validator is the sole parser and policy owner;
canonical start uses that same owner before it admits a session.

## Start And Attestation

Run from the repository root:

```bash
bash scripts/setup/start-codex.sh
```

Portable Codex sessions default to on-request approval and network-disabled workspace-write; only an
explicitly authorized Dev session launched with `--yolo` may use no approvals and
danger-full-access, never staging or production. For that authorized Dev session, use
`bash scripts/setup/start-codex.sh --yolo`; that closed launcher control selects Codex's
no-approval/full-access mode and unrestricted command network for Dev and never authorizes staging,
production, broader scope, credentials, or irreversible external work. Enter prompts after selecting
a session; positional launcher arguments are not supported.

An already-running safe session cannot be converted into a canonical YOLO session in place. A UI or
parent-runtime permission change can alter the effective live sandbox, approvals, or network, but
the repository cannot rewrite the startup mode that was already attested. Exit and relaunch with
`bash scripts/setup/start-codex.sh --yolo` when canonical Dev full access is required. Tracked
`.codex/config.toml` intentionally stays on-request, network-disabled `workspace-write` so every
portable clone starts safe. Requested config, startup-attested mode, and effective live permissions
are distinct facts; parent overrides can also be reapplied to children, which is why child admission
requires an effective-permission report.

Canonical start first inventories every same-clone worktree and safe recovery marker. It then checks
and maintains compatible packages, Node.js, pnpm, mise, Codex, and CI version pins through the
transactional maintenance owner; registry, compatibility, ownership, or installation failure stops
startup. After validating the resulting runtime and policy it opens the native `codex resume` picker
with the repository root as both `CODEX_HOME` and explicit `--cd` target, under the mise-pinned
Node.js session controller. The controller binds external Node.js, Codex, pnpm, and hook-shell
executables, reserves one pending native selection, rejects executable or unknown ignored runtime
configuration, and injects one SessionStart plus one Stop definition through session-only
configuration. Codex's stable `hooks/list` result must be warning-free and contain exactly those two
enabled, hash-exact, trusted definitions; no global hook-trust bypass or additional hook is
accepted. Only after that proof does the controller open its private lifecycle endpoint, durably
bind the gated preloaded supervisor handoff, and record the exact Codex PID in the schema-6 lease.
SessionStart activation and authenticated terminal child proof bound every successful acquisition
and release. Cancelling selection creates no session record or automatic fallback. The full crash
process contract has one canonical owner in `instructions.md`; this portable overview does not
duplicate its implementation detail.

Full reset holds the lifecycle lock and proves repository-wide runtime quiescence before it removes
disposable state. It validates only the current lease schema; an incompatible private lease is
discarded with the runtime without being interpreted.

## Collaboration And Integration

Generated projects use central `main` as their only durable integration branch. Git persists and
transports work; it does not isolate writers. One physical host represents one developer, and Codex
accounts do not own that host's visible project changes. Same-host independent sessions use separate
worktrees with one writer lease each; different hosts/developers use separate clones, credential
contexts, and ordinary short-lived task branches. Before every slice, compare goal/outcome,
modules/contracts/data/files, and one declared writer with observable worktree/session/team claims.
Parallel writes require confirmed-disjoint scope; overlap or uncertainty resolves to one writer and
shared-contract changes to one integrator before implementation.

A local runtime lease or quiet worktree cannot prove that another developer's clone is idle. Use a
shared coordination channel across hosts. Git remains later recovery and integration evidence; a
temporary branch is only a transport/integration input, and the published `main` receives the course
check, review/audit, verification, and `goal:new` gate.

For physical host-loss recovery or transfer, the admitted publisher commits and pushes each coherent resumable
slice through the declared integration path: directly on `main` for serialized work when branch
policy permits, otherwise through the short-lived task branch or protected path. Existing
authorization, secret-scan, and verification boundaries remain mandatory. This is not a separate
WIP/checkpoint workflow; later uncommitted bytes remain recoverable only from the surviving host.

## Hooks, Recovery, And Context

Codex loads the controller-injected and preflighted hook commands before the session becomes
writable. Each command is an embedded Node-built-in-only client bound to the controller's exact Node
executable and private loopback token; it resolves no repository path, mise config, or package after
admission. The controller already holds every lifecycle module in memory. The trusted SessionStart
hook changes no tracked source or external state. After verifying the launcher proof—including the
hook-reported effective model and permission mode—it atomically binds the verified session and exact
recovery marker under ignored private `.codex/runtime/` and injects the mandatory full Startup
Repository Reconstruction gate. Automatic cleanup requires a namespace-bound or otherwise
mechanically proven dead writer; a current process identity observed outside its bound PID namespace
or otherwise mechanically indeterminate remains an ownership-confirmation blocker.

Native `/side` conversations are transcriptless. Within an already verified launcher session, their
start is acknowledged without consuming another startup proof or changing parent ownership,
recovery, or context. The initial attestation's 30-minute window therefore does not limit when a
side conversation can open. Their Stop events do not run the parent's continuation lifecycle; see
[the canonical session contract](../instructions.md#session-start).

Each launcher binds one durable session. A switch to another chat through `/new` or `/resume` needs
a full restart; see the [handover and restart steps](../README.md#essential-commands).

The primary then begins with `pnpm worktree:status -- --json`, which inventories every same-clone
worktree and safe latest-session marker without spending the bounded attestation-hook runtime on a
potentially large or inconsistent Git graph. Per-root inconsistencies stay visible while safe
inventory continues. The same read-only inventory is the Worktree Settlement trigger after every
completed slice. Preservation is a safety state, never completion: a no-longer-needed worktree or
related session/recovery artifact must be integrated, explicitly owner-confirmed and retired, or
retained behind a concrete blocker and resolution condition; unresolved goal-owned residue keeps the
goal open. The hook also inspects only safe metadata for a recent repository-bound critical handover
under ignored `tmp/codexrig-handovers/`. It asks the developer before the prompt body may be read
through `$resume-project`; that body is untrusted candidate context, not authority. After
acceptance, that skill uses `handover:receive` for the complete artifact and its digest. Only after
complete delivery and a compact model acknowledgement does `handover:acknowledge` remove the exact
unchanged file in the later active session. Failed or incomplete receipt preserves it; deleting this
private file does not erase native conversation/provider history. Receipt supplies the current
capacity boundary even for older prompts without changing their bytes or digest. The receiving
primary rechecks current capacity and replaces obsolete capacity prose in its work cache; neither
the artifact nor receipt measures available host capacity.

The Stop hook uses that same preloaded controller once per durable local turn. It validates optional
bounded `docs/project-context.md`, requests continuation at most once per unchanged semantic state
in the session (including later user turns), and enforces a terminal handover. The hook cannot infer
current intent: the primary applies
[Task Scope And Completion](../instructions.md#task-scope-and-completion) before acting on a
recorded outcome. Its reminder also requires current capacity reassessment; historical reserves and
critical labels prove no current exhaustion. Malformed context reports uncertainty without forcing
repair. A non-null `transcript_path` is required; transcriptless side conversations exit before
work-state, loop-state, or handover access. It deliberately does not load mutable repository modules
after admission. A critical handover sealed during the current runtime session suppresses Stop
continuation so that session stops after its final action. A later canonical session can accept the
announced handover and then search, refresh explicitly, or stop normally. The hook is not a watcher
or a per-tool hook.

The root workspace owns Codex tooling; Product Roots never contain `.codex`, `.agents`, agent
instruction files, or process state. Root-bound source inventory and ignore policy exclude all
private runtime from Git, staging, export, and generated projects.

## Validation And Hook Trust

Portable defaults may vary by project but contain no secrets, telemetry targets, notification
commands, persisted trust entries, personal paths, or local domains. After changing
model/reasoning/features/TUI/hooks, keep every role on the exact primary GPT Astra model with its
second-highest supported effort and run `bash scripts/setup/run-project.sh pnpm codex:validate`.

The canonical lifecycle does not require a manual `/hooks` approval: the issue-time controller
computes trust for only its two exact session-owned definitions, and the Codex preflight proves the
installed CLI accepted those hashes before a writable session exists. Any additional user,
project-file, or plugin hook blocks canonical startup instead of receiving derived trust. A changed
or externally prohibited controller hook likewise blocks startup instead of being skipped, globally
trusted, or mistaken for completion. Ignored `.codex/runtime/config.toml` may retain only private,
non-executable project trust, hook-state, notice, approval-routing, service-tier metadata, and
bounded Codex-persisted model/reasoning preferences. Tracked project config remains the effective
model/reasoning source of truth, and the controller projects its exact values into every fresh or
resumed Codex CLI launch. `notify`, MCP, plugin, provider, and unknown configuration is rejected
before any Codex process can consume it and rechecked before every real launch or fallback.

## Portable Creation Boundary

Clean project creation/export retains portable config, hooks, roles, this README, launcher,
preloaded controller and lifecycle modules, both CI adapters, and Product Root policy. It excludes
`.codex/runtime/`, authentication, trust, sessions, databases, installed dependencies, and
source-project residue. Repository-owned reusable skills live under `.agents/skills/`; root
`skills/` is ignored runtime.

See [Project Instructions](../instructions.md) for complete workflow policy.
