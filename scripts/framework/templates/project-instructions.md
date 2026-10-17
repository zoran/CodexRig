# Project Instructions

This file owns this product repository's workflow. README owns setup/use and discovery links;
`docs/project.md` records integrated technical reality. Requirements and acceptance belong to the
existing specification owner. A static UI reference is a separate design artifact. Optional
`docs/project-context.md` carries only this repository's current bounded authorized task.

## Interpreting Examples And Scope

<!-- current-examples-and-scope-policy -->

## Repository-Local Tool And Account Isolation

<!-- current-tool-account-isolation-policy -->

## Repository Efficiency And Effectiveness

<!-- current-repository-efficiency-policy -->

## Task Scope And Completion

<!-- current-task-scope-policy -->

## Maintenance Scope And Verification

<!-- current-maintenance-scope-policy -->

## Authorized Work And Native Codex

Follow [Task Scope And Completion](#task-scope-and-completion) for the current accepted outcome.
Tool maintenance requires an explicit request or a material blocker of that authorized outcome.
Report unrelated findings separately. A tooling finding cannot reopen completed product work or
authorize another phase.

Continue authorized implementation through relevant repairs, verification and cleanup. Honor pauses,
cancellation and approval gates, including “approve the static UI before application
implementation.” A requirements draft, a work-state marker, a tool diagnostic, or a successful check
grants no new authority. A status question does not cancel active work. Never invent another task to
remain busy. Use native plans, sessions, approvals and subagents. Planning goals are acceptance
milestones, not automatically native Goals. Use a native Goal when explicitly requested or when the
user expressly delegates need-based Goal use and durable continuation across turns with a verifiable
stopping condition helps. Honor that delegation without asking again; reuse an existing matching
Goal instead of replacing unfinished work. Task size alone grants no Goal authority. Set a token
budget only when explicitly requested; never raise a user-set budget. `goal:new` checks publication
and never creates a Goal. Do not add a scheduler or second task store.

### Long-Session Course Checks

<!-- current-course-check-policy -->

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

Each launcher binds one durable session. To switch to another chat, including after a critical
handover, the developer exits Codex completely with `/quit` and runs
`bash scripts/setup/start-codex.sh` from the project root in the terminal. `/new` and `/resume`
inside the running CLI retain its existing launcher and cannot replace this restart. The later
session may accept the preserved handover; no manual runtime deletion or extension of the old proof
is needed.

### Startup Repository Reconstruction

Before intake or writes, follow the loaded AGENTS.md and run `pnpm context:map`. Read applicable
sections of this policy, relevant manifest entries and their requirements/design owners through
`pnpm context:read`; use README for needed commands. Do not recursively load linked documents. In a
persistent main conversation recovering authorized work, inspect bounded work context. Run
`pnpm worktree:status -- --json`; inspect every same-clone worktree and safe recovery marker,
leases, Git status/diff/untracked files, upstream and task branches. Inventory actual modules,
surfaces, contracts, data, configuration, delivery, dependencies, tests and composition. Continue
safe inventory across inconsistencies. Preserve competing/indeterminate writers and broken Git
worktree directories; native repair requires confirmed directory ownership.

Resume only a coherent stream matching current accepted authority. Preserve unrelated old product
work during maintenance; finish the update at its own acceptance boundary. Current source and
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

Follow [Planning](#planning-goals-slices-review-loops-and-audits) before material implementation and
keep evidence proportional to the outcome and risks. One writer owns each surface. Run
`pnpm worktree:status -- --json` at every completed slice.

## Planning, Goals, Slices, Review Loops, And Audits

<!-- current-planning-policy -->

## Best-Available Engineering, Not Quick Fixes

Reconstruct the system and establish root cause before material implementation. Compare viable
solutions in the whole project's context. Research current primary/official evidence when it can
change the decision. Avoid symptom patches, speculative hardening and cleanup without an acceptance
benefit or material risk. A temporary mitigation needs explicit authority or immediate containment,
a removal condition and an honest unfinished follow-up. Speed or quota pressure never lowers
quality.

After each nontrivial slice, perform `$system-coherence`, trace an assembled flow and resolve
relevant findings with affected review and focused evidence. Then perform a fresh audit against
outcome, plan, manifest and consumers; a relevant finding reopens only affected repair and evidence.
All iterations follow [Long-Session Course Checks](#long-session-course-checks); unresolved findings
do not license unlimited investment in the same approach. Reuse unaffected evidence and deliver when
acceptance is satisfied. The relevance criteria below apply to every proposed follow-up. A real
authority or evidence blocker stays explicit with its resolution condition; continue safe
independent work and never label the affected state clean.

For both plans and implementation, a relevant finding needs evidence of a reproducible defect,
demonstrated omission/contradiction, or plausible material failure path and its consequence for the
authorized outcome, acceptance, correctness, safety, documented behavior or maintainability. A
planning risk does not require an existing implementation failure. A touched file or personal
preference alone is insufficient. Classify duplicates, false positives, unrelated suggestions and
optional micro-optimizations; they do not block closure or authorize extra work. Add no review
rounds, polish, abstractions, benchmarks, tests or research unless they change acceptance or a
material risk.

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

`config/tenancy.json` (schema 2) owns trusted tenant-context resolution and deny-by-default
isolation. Resolve its pending strategy before product code. Its `contextBoundaries` name
non-overlapping runtime roots and distinct contained `resolver`, `policy`, `publicContract` files;
outside consumers use those public contracts. `modulePolicies` bind actual manifest module roots to
`scope` (`tenant-owned`, `tenant-independent`, `control-plane`) and `rationale`.
Tenant-owned/control-plane entries also name module-local `enforcement` files and `evidence` entries
with an existing selected verification `command` key and concrete `tests` paths. Configured commands
use their existing `coveredTestPaths` or explicit test arguments; workspace test lifecycle keys use
package ownership. Update these bindings with module changes; the manifest remains the sole module
inventory.

Enforce tenant scope in authorization, data, caches, files, messages and jobs. Bound handles need no
repeated identifier in every helper; pure tenant-independent modules need no artificial tenant test.
Reuse existing composed negative tests through their actual owner, without duplicate execution.
`pnpm tenancy:check` checks structure and evidence selection, not semantic isolation: review actual
script coverage and trace trusted identity through resource access, including cross-tenant denial,
handle reuse and switching. Identity and Access owns authentication, users, authorization, sessions
and provider adapters behind ports. Material trust changes require `$security-review`,
`pnpm auth:check` and `pnpm tenancy:check`.

## White-Label Product Configuration

`config/product.json` owns public product identity, branding and safe public settings. Repository
and package names are never runtime branding fallbacks. Keep delivery, tenancy and localization at
their separate typed owners; secrets never belong in public configuration.

## Documentation Ownership

<!-- current-documentation-ownership-policy -->

## Documentation Currency

<!-- current-documentation-currency-policy -->

## Context Economy And Canonical Owners

Use known paths or scoped `rg`, then read matched source and trace actual consumers. Keep each fact
at one owner and maintain discovery links when documents move. `docs/project-context.md` is an
optional bounded resume cache with one current `codexrig-work-state` marker, never an authority. Its
exact path is excluded by the portable root `.gitignore`; recovery reads it directly. Do not rely on
a local Git exclude to keep this working cache private. Refresh its current truth after material
progress or remove it when no longer needed. The Stop guard cannot infer current intent from this
cache. An unchanged state triggers at most once per session, including across later user turns; only
real progress or a real state change may refresh it. Malformed context does not force repair.

Read critical workflow, trust, operations, migration and public-contract documents before changing
them. Preserve active requirements, constraints, rationale and evidence limits; trace removals to
surviving owners or an authorized retirement. A requested policy revision or consolidation supplies
authority within its scope; otherwise obtain a focused decision before changing normative authority
or resolving ambiguous content. Give authorized critical-document changes a separate preservation
review before the fresh audit. Keep that evidence in the conversation.

## Context And Skills

Use relevant local skills for implementation, architecture and conditional specialist reviews. Read
a skill on first application and announce it. Its guidance never expands the user's authority. Do
not apply a review simply because a keyword appears. Keep findings and evidence in conversation.

## Dependency Installation And Freshness

Prepare project-pinned tools in user storage and compatible dependencies with
`node scripts/deps/maintain-toolchain.mjs`, then run `bash scripts/setup/run-project.sh pnpm setup`.
Normal `start-codex.sh` invokes `maintain-toolchain.mjs --startup` to discover new releases before
session admission. Preserve that invocation; `--locked` is separate reproducible preparation and CI,
and deliberately skips release discovery. The portable launcher regression checks the actual shell
entry during affected development checks and publication. The compatible installer owns
range/pin/peer/engine policy, archive integrity, transaction and rollback. Keep manifests, lockfiles
and pins in Git; installed payloads use the shared user storage owner and pnpm global virtual store.
Account configuration stays project-private. The installer reuses verified legacy bundles without
downloading them again, preserves manifests and lockfiles, and holds the shared lifecycle lock
through pin publication and cleanup. `--locked` reproduces declared pins and the existing lockfile
when relocating installed state. Its online stage prepares the final destination's required rebuild
before offline reproduction. The [storage owner](#temporary-data-and-storage-housekeeping) owns
capacity admission before staging and gates retirement on references and quiescence. A frozen
install proves reproducibility, not registry freshness. CI uses reviewed stable pins, frozen inputs,
disabled install scripts/pnpmfile and verified archives. Report offline or registry uncertainty
honestly; do not substitute unverified success or automatic source repairs.

## Infrastructure As Code

<!-- current-infrastructure-as-code-policy -->

## Delivery Environments

`config/delivery.json` owns declared and detected environments. Dev is the default, not evidence
that a deployment exists. The newest authorized developer build/deploy and manual feedback have
priority; run isolated verification beside or afterward. Dev is latest-wins outside a frozen
[Delegated Release](#delegated-release). Staging/prod require explicit selection and their scoped
credentials, immutable artifact/configuration, migration and rollback evidence, serialized promotion
and health checks. `pnpm verify` does not deploy.

### Deployment And Qualification Failure Recovery

<!-- current-delivery-failure-policy -->

## Test Strategy

<!-- current-test-strategy-policy -->

## Verification

First apply [Maintenance Scope And Verification](#maintenance-scope-and-verification). The launcher,
final-verification and cleanup requirements below operate within the accepted task; broad product
execution is not an implicit condition of a framework update.

When target execution is authorized, acceptance for a launcher or publication change must exercise
the normal documented command with persistently prepared project tools. A direct verifier run with
temporary environments or extra selectors proves only that invocation. Test the assembled launcher,
publication gate and pre-push path, including unchanged evidence reuse, semantic-input invalidation
and useful failure output. Preserve declared tool selectors and verification controls across those
boundaries; verification must not install prerequisites or silently discard a real toolchain change.

### Verification Selection And Runtime

<!-- current-verification-runtime-policy -->

### Verification And Publication Gates

Use the README's `project:publish` command. The publisher verifies, commits and pushes to the
configured upstream through the managed pre-push hook, confirms the remote commit and preserves
native history/accounts. Pre-push consumes exact-current evidence and retains security/pushed-object
checks. Active callers require the exact live canonical lease and observable Linux process ancestry;
without it, publish after that clone's sessions exit. No force push, automatic merge, hook bypass or
empty commit is permitted. Failures preserve source and any local commit for reconciliation.

#### Delegated Release

<!-- current-delegated-release-policy -->

## Completed-Goal Closure And Repository Housekeeping

Apply [Maintenance Scope And Verification](#maintenance-scope-and-verification) before the commands
below. Finish authorized code, documentation, cleanup and reviews. Settle every no-longer-needed
owned worktree and coordination claim through its owner. Preserve ambiguous directories and active
runtime; never manually delete `.codex/runtime/` or a worktree directory. Run
`bash scripts/setup/run-project.sh pnpm repo:housekeeping -- --apply`, audit current truth, reuse
valid evidence and fill only affected gaps. Complete verification belongs to publication, not each
review or handoff. Commit/push only with authority and the actual integration policy; `goal:new`
checks clean, verified publication on central main. An unrelated tooling finding does not reactivate
completed product work or impose another cleanup task.

## Temporary Data And Storage Housekeeping

<!-- current-temporary-storage-policy -->

## Subagent Orchestration And Integration Authority

### Admission, Intelligence, And Provenance

<!-- current-agent-admission-policy -->

### Effective Permissions And Write Isolation

Never override the configured GPT Astra model and its second-highest supported reasoning effort,
currently `max`. Keep primary, global agent defaults, roles and the shared validation policy in
agreement; the installed model catalog must confirm the configured effort's rank before canonical
startup.

One host represents one developer; visible local changes are developer-owned, but process control
requires exact provenance. Different clones need explicit coordination; a local lease cannot prove
them idle.

Before child tools, require effective sandbox, approvals, network and checkout. Read-only roles stop
on broader live overrides. An explicitly selected worker may accept this primary's authorized YOLO
only for its exact disjoint write set, with no new network, credential, delegation, external
mutation, commit, push or deploy authority. The primary owns protected policy, integration and
closure. Never contact or control foreign/ambiguous processes.

### Capacity Admission And Monitoring

<!-- current-capacity-admission-policy -->

### Agent Lifecycle And Idle Cleanup

<!-- current-agent-lifecycle-policy -->

### Guarded And Critical Drain

Establish critical state through current evidence under Capacity Admission And Monitoring above; an
inherited estimate or classification cannot trigger a new seal. At critical state start no work.
Drain only provenance-bound agents/tasks at safe boundaries, update the bounded context with the
exact Critical Budget Drain attestation, then run `pnpm handover:create -- --critical` as the final
repository action. After a successful seal stop completely: no tool, agent contact, check or
automatic continuation. Return only the handover path and the developer's full-restart instruction
from [Session Start](#session-start); this authorizes no further action in the sealing session.
Required attestation:

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

### Permission Design

For cloud infrastructure (including AWS, Google Cloud, and comparable providers) and applications
themselves, prefer broader, reusable roles and permission bundles that cover complete authorized
workflows. Apply this default to operator access, application users, internal services, service
accounts, and deployment automation. Use a small, understandable set of roles at the relevant
project, service, team, or environment boundary so routine work does not require repeated permission
changes.

Do not introduce separate grants, custom policies, or approval steps for every API action, resource,
screen, or workflow step without a concrete benefit. Finer granularity needs a material security,
tenant-isolation, sensitive-data, or regulatory requirement that justifies its development,
deployment, support, and maintenance cost. Prefer an existing role that covers the responsibility
over a bespoke permission matrix when both satisfy those requirements. Least privilege means
bounding the role to its authorized responsibility; it does not require the smallest technically
expressible grant.

Preserve server-side authorization, tenant and sensitive-data isolation, environment boundaries,
revocation, and existing external-action approval requirements. Broader roles remain bounded by
their authorized responsibility; unrestricted global administration is not the automatic default.
Reviewers must assess the actual access risk and operational cost instead of treating finer
granularity as inherently better.
