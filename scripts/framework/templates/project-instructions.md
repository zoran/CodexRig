# Project Instructions

This file owns this product repository's workflow. README owns setup/use and discovery links;
`docs/project.md` records integrated technical reality. Requirements and acceptance belong to the
existing specification owner. A static UI reference is a separate design artifact. Optional
`docs/project-context.md` carries only this repository's current bounded authorized task.

## Authorized Work And Native Codex

Work only on the user's current product outcome and accepted steering. Tool maintenance requires an
explicit request or a material blocker of that authorized outcome. Report unrelated findings
separately. A tooling finding cannot reopen completed product work or authorize another phase.

Continue authorized implementation through relevant repairs, verification and cleanup. Honor pauses,
cancellation and approval gates, including “approve the static UI before application
implementation.” A requirements draft, a work-state marker, a tool diagnostic, or a successful check
grants no new authority. A status question does not cancel active work. Never invent another task to
remain busy. Use native plans, sessions, approvals and subagents. Create a native Goal only on
explicit request; `goal:new` checks publication and never creates a Goal. Do not add a scheduler or
second task store.

### Long-Session Course Checks

After reconstruction, material changes, each slice and compaction, recover the original outcome,
accepted steering, evidence, remaining work and next safe action. During active work allow at most
ten minutes between brief course/capacity checks; declare the later safe boundary of an already
running atomic operation. Check project-wide effects, real owners and consumers, proportionality,
cleanup and documentation. Give a concise course update and continue safe authorized work.

## Session Start

Start from this repository with `bash scripts/setup/start-codex.sh`. It inventories worktrees,
maintains compatible local tools and dependencies, checks policy and archive integrity, then opens
native resume with this root as `CODEX_HOME` and `--cd`. Stable pins live in
`.codex/toolchain.json`; `.codex/tooling.json` owns local startup and Git-provider settings.

Portable sessions request on-request approval and network-disabled workspace-write. Only an
explicitly authorized Dev launch with `--yolo` requests no approvals and danger-full-access. That
control grants no new scope, credentials, deployment or publication authority. It never applies to
staging or production. Only `--no-alt-screen` and `--yolo` are launcher controls.

The controller requires exactly two trusted, enabled session-only hooks before admitting a writer.
Executable or unknown ignored runtime configuration, missing startup modules, unsafe ownership or
hook mismatch blocks startup. Do not disable these checks. After changing runtime tooling, exit and
restart through the launcher; preserve the private files needed by any active native session.

### Startup Repository Reconstruction

Before intake or writes, read AGENTS.md, README, this file, the manifest and its linked requirements
and design owners. In a persistent main conversation, inspect the optional bounded work context. Run
`pnpm worktree:status -- --json`; inspect every same-clone worktree and safe recovery marker,
leases, Git status/diff/untracked files, upstream and task branches. Inventory actual modules,
surfaces, contracts, data, configuration, delivery, dependencies, tests and composition. Continue
safe inventory across inconsistencies. Preserve competing/indeterminate writers and broken Git
worktree directories; native repair requires confirmed directory ownership.

Resume only the unique coherent authorized stream belonging to this project. Current source and
commands outrank remembered context. A native side conversation is independent and must not read
work context or trigger durable continuation. Accept a SessionStart-announced handover explicitly
before reading its prompt; use `$resume-project`, validate it against this repository, then receive
and acknowledge only the exact accepted artifact in a later canonical session.

## First-Prompt Project Definition Intake

A pending product starts with requirements discovery, not implementation. Read any linked existing
specification and creation brief first. Explain the successive interview: structure the user's
ordinary-language description, challenge gaps and contradictions, recommend decisions and preserve
confirmed facts at the existing requirements owner. Ask focused questions about users, outcomes,
workflows, scope/non-goals, domain boundaries, data/lifecycle, integrations, trust, surfaces,
locales, operations and observable acceptance. A name or tagline is insufficient. Restate a
decision-ready synthesis for correction before dependent implementation. Preserve any separate UI
approval gate.

A creation brief is an unconfirmed draft. Keep current modules in the manifest and only confirmed
unimplemented candidates in `docs/future-modules.md`. Reopen only materially changed requirements
later; do not duplicate a specification or overwrite a maintained project document with a template.

## Product-First Delivery And Verification Economy

Plan material work before writing: outcome, acceptance, owners/consumers, viable designs, risks,
ordered coherent slices, evidence and real authority boundaries. One writer owns each surface.
Review the plan, fix omissions and audit it before implementation. After each nontrivial slice,
perform `$system-coherence`, trace an assembled flow, fix relevant findings, repeat focused evidence
to zero findings and audit again. Run `pnpm worktree:status -- --json` at every completed slice.

## Best-Available Engineering, Not Quick Fixes

Reconstruct the system and establish root cause before material implementation. Compare viable
solutions in the whole project's context. Research current primary/official evidence when it can
change the decision. Avoid symptom patches, speculative hardening and cleanup without an acceptance
benefit or material risk. A temporary mitigation needs explicit authority or immediate containment,
a removal condition and an honest unfinished follow-up. Speed or quota pressure never lowers
quality.

## Current Contracts Only

Keep exactly one current internal contract per concern. Change owned state and every producer and
consumer together, then remove superseded schemas, shims, paths, tests and docs. Recover current
state atomically; never add private legacy readers. Unsupported tool installations require an
explicitly scoped replacement with a safe restart boundary.

## Modular Architecture, Parallel Ownership, And Integration

Use cohesive replaceable modules, narrow ports, private internals, owned data/migrations and acyclic
dependencies. The manifest records implemented roots, responsibilities, public contracts, allowed
dependencies, runtime technology, ownership and focused evidence. Use `$architecture-evolution` for
material boundary or layout changes; source and consumers move together.

### Feature-To-Domain Placement

Extend the existing capability owner, add a cohesive module in its domain or establish a justified
domain. Avoid generic app/shared/common/utils/core/service catchalls.

### Product Surface Selection

Confirm required web, mobile, desktop, CLI, API, worker or library surfaces before choosing their
technology. Root `src/` is the default Product Root. Real declared workspace packages or Android
modules can add roots; an arbitrary directory cannot. Keep tooling outside product roots.

### Requirement-Driven Technology Selection

Run `pnpm stack:detect`. Node.js/pnpm/mise provide development tools and do not prescribe the
product stack. Choose technology from confirmed requirements and record actual integrated runtime
facts.

### Physical Surface Boundaries

Separate domain/application, presentation/navigation, web, Identity and Access, API contracts and
transport, adapters and infrastructure. Composition wires explicit ports; consumers never reach into
another module's private data. Use English source names and purpose/owner headers. Keep maintained
executable modules at or below 700 physical lines.

### UI Intent And Change Boundaries

Preserve existing appearance, navigation and interaction. For a new UI, present a representative
rendered direction early and obtain its required acceptance before expanding or implementing the
next phase. A general repository approval is not redesign approval. Use actual rendered flows and
`$ui-ux-review`; static scans cannot certify usability or visual acceptance.

### Multi-Device Experience

Assume mobile, tablet and desktop unless confirmed scope is narrower. Inspect realistic loading,
empty, error and success states, keyboard/focus, zoom, touch and content length at relevant sizes.

### Localization And Language Strategy

`config/localization.json` owns source and user-facing language decisions. Confirm locales before
language-dependent implementation; use canonical translated copy and
`$native-language-content-review`.

### Tenant Isolation Boundary

`config/tenancy.json` owns trusted tenant-context resolution and deny-by-default isolation. Resolve
its pending strategy before product code. Enforce tenant scope in authorization, database queries,
cache keys, files, messages and jobs. Cover cross-tenant denial with real negative integration
tests. Identity and Access owns authentication, users, authorization, sessions and provider adapters
behind ports. Material trust changes require `$security-review`, `pnpm auth:check` and
`pnpm tenancy:check`.

## White-Label Product Configuration

`config/product.json` owns public product identity, branding and safe public settings. Repository
and package names are never runtime branding fallbacks. Keep delivery, tenancy and localization at
their separate typed owners; secrets never belong in public configuration.

## Documentation Ownership

README explains setup/use and links every active document under `docs/`. The manifest is a technical
inventory with concise discovery links. Requirements and acceptance stay at the established
specification owner, including a project-owned HTML specification. A static UI reference stays a
separate artifact. The future-module index links confirmed deferred candidates without duplicating
requirements. Do not generate review logs, history documents or a second task store.

### Context Economy And Canonical Owners

Use known paths or scoped `rg`, then read matched source and trace actual consumers. Keep each fact
at one owner and maintain discovery links when documents move. `docs/project-context.md` is an
optional bounded resume cache with one current `codexrig-work-state` marker, never an authority.
Refresh its current truth after material progress or remove it when no longer needed.

## Context And Skills

Use relevant local skills for implementation, architecture and conditional specialist reviews. Read
a skill on first application and announce it. Its guidance never expands the user's authority. Do
not apply a review simply because a keyword appears. Keep findings and evidence in conversation.

## Dependency Installation And Freshness

Prepare the locked runtime with `mise install --locked`, then run
`mise exec --locked -- node scripts/deps/install-compatible.mjs` and
`mise exec --locked -- pnpm setup`. The compatible installer owns range/pin/peer/engine policy,
archive integrity, transaction and rollback. A frozen install proves reproducibility, not registry
freshness. CI uses reviewed stable pins, frozen inputs, disabled install scripts/pnpmfile and
verified archives. Report offline or registry uncertainty honestly; do not substitute unverified
success or automatic source repairs.

## Delivery Environments

`config/delivery.json` owns declared and detected environments. Dev is the default, not evidence
that a deployment exists. The newest authorized developer build/deploy and manual feedback have
priority; run isolated verification beside or afterward. Dev is latest-wins. Staging/prod require
explicit selection and their scoped credentials, immutable artifact/configuration, migration and
rollback evidence, serialized promotion and health checks. `pnpm verify` does not deploy.

## Test Strategy

Use proportionate owner and consumer evidence. Extend realistic lifecycle scenarios for material
regressions; avoid tests that merely mirror wording. Retained runtime changes need negative trust
and recovery evidence. Distinguish static, simulated, rendered and native/account-backed evidence.
Configuration and hook outputs do not prove model obedience.

## Verification

`.codex/verification.json` declares this repository's checks and consumers. Use
`pnpm verify:changed -- --print-plan`, then affected evidence. Unknown paths or missing Git basis
must still include real product/workspace lifecycles. Document/UI planning does not authorize
application implementation. Stable tools have their own bounded safety tests.

Run `pnpm verify` on the stable integrated state. Preserve failures, diagnose with the smallest
owning check, batch repairs and reuse sound evidence. A failure alone never justifies another full
run. A tooling defect blocks only the affected unsafe operation; name the blocker without changing
the product task. Pre-push checks current successful evidence, the actual pushed objects and
secrets.

## Completed-Goal Closure And Repository Housekeeping

Finish authorized code, documentation, cleanup and reviews. Settle every no-longer-needed owned
worktree and coordination claim through its owner. Preserve ambiguous directories and active
runtime; never manually delete `.codex/runtime/` or a worktree directory. Run
`mise exec --locked -- pnpm repo:housekeeping -- --apply`, audit current truth and verify the stable
state. Commit/push only with authority and the actual integration policy; `goal:new` checks clean,
verified publication on central main. An unrelated tooling finding does not reactivate completed
product work or impose another cleanup task.

## Subagent Orchestration And Integration Authority

At most four live subagents, only for substantial disjoint work. Never override the configured GPT
Astra/ultra model pair. Register owned agents and background tasks with repository/session identity,
exact scope, returned identity, checkpoint, safe boundary and cancellation provenance. One host
represents one developer; visible local changes are developer-owned, but process control requires
exact provenance. Different clones need explicit coordination; a local lease cannot prove them idle.

Before child tools, require effective sandbox, approvals, network and checkout. Read-only roles stop
on broader live overrides. An explicitly selected worker may accept this primary's authorized YOLO
only for its exact disjoint write set, with no new network, credential, delegation, external
mutation, commit, push or deploy authority. The primary owns protected policy, integration and
closure. Never contact or control foreign/ambiguous processes. Accept handoffs and close unneeded
owned agents.

### Guarded And Critical Drain

Use actual host capacity signals without assuming units or billing periods. Unknown capacity admits
no new agent. Reserve primary integration/verification/handoff capacity. Ten percent or less of a
reliable binding allocation is guarded; five percent, a host critical signal or an uncovered
completion reserve is critical. Native no-cost redeems need confirmed supported controls and a fresh
limit check; no purchase, paid overage, account/model switch or user Goal-budget increase.

At critical state start no work. Drain only provenance-bound agents/tasks at safe boundaries, update
the bounded context with the exact Critical Budget Drain attestation, then run
`pnpm handover:create -- --critical` as the final repository action. After a successful seal stop
completely: no tool, agent contact, check or automatic continuation. Required attestation:

```text
## Critical Budget Drain
- Owned subagents: none live; all handoffs are accepted or recorded.
- Owned background tasks: none live; queued work is cancelled and atomic sections are complete.
- Foreign agents and tasks: not contacted, interrupted, or changed.
```

## Security And Privacy

Keep credentials, personal paths, native transcripts/memories, runtime identities, logs, handovers
and verification evidence out of tracked source and product artifacts. This repository's private
native state belongs only in its own ignored `CODEX_HOME`. The project owner selects project
licensing terms before distribution. Preserve applicable third-party licenses.
