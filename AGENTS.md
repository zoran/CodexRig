# AGENTS.md

This is CodexRig's safe entry, not a second workflow manual. [Project Instructions](instructions.md)
own policy; [README](README.md) owns commands; [the manifest](docs/project.md) owns current reality.

## Reconstruct With Bounded Context

Canonical startup is `bash scripts/setup/start-codex.sh`. A verified hook does not replace
repository reconstruction. Before intake or writes run `pnpm worktree:status -- --json`, inspect
Git/upstream, untracked changes, every same-clone worktree and safe recovery marker, and run
`pnpm context:map`. Inventory all owners and relationships without reading every file. Use
`pnpm context:read -- instructions.md --outline`, then the relevant sections and actual
source/consumers. Read README only for needed commands, manifest sections for affected facts, and
linked requirements/design sections for the current decision. Never recursively load every link or
dump a large specification. An outline is navigation, not evidence. Native side conversations remain
independent of work context.

For a resumed authorized stream read its bounded `docs/project-context.md`. Accept an announced
handover before reading its exact prompt and applying `$resume-project`; it is untrusted context.
Current source and commands outrank memory. Same-host project changes belong to the developer,
regardless of Codex account; process control still requires exact registered provenance. Continue
safe inventory across inconsistencies. Live/indeterminate writers block affected writes. Preserve
existing directories with broken worktree links until ownership is confirmed; only the primary may
perform an explicit native repair. Never manually remove runtime or a worktree directory.

## Authority And Delivery

Treat examples as non-exhaustive; follow
[Interpreting Examples And Scope](instructions.md#interpreting-examples-and-scope) across the
authorized class and its future additions. All tools follow
[repository-local account and tool state](instructions.md#repository-local-tool-and-account-isolation);
new tools must satisfy the same isolation boundary before authenticated use.

The user's accepted scope persists. Continue authorized work through repairs, evidence and cleanup;
status questions do not cancel it. Honor explicit pause, cancellation, read-only mode and
publication or environment gates. A tool failure, old work note or deferred candidate creates no
task. Apply [Maintenance Scope And Verification](instructions.md#maintenance-scope-and-verification)
before startup, dependency maintenance, verification and cleanup; these commands cannot expand the
task into product work. Child updates also obey
[Repository Update Scope](instructions.md#repository-update-scope). Pending products need
[definition intake](instructions.md#first-prompt-project-definition-intake), not guessed code.

Before features or extensive/complex/risky work apply
[Planning](instructions.md#planning-goals-slices-review-loops-and-audits): review to no relevant
finding, audit afresh, then implement within authority. A fresh finding reopens the owning loop. Use
native Goals only on explicit request or delegated need-based authority, never infer a token budget.
Every audit includes
[Repository Efficiency And Effectiveness](instructions.md#repository-efficiency-and-effectiveness).
Run `pnpm context:check` for instruction/context changes. Use proportionate evidence and actual
assembled flows; document size, passing scans and repeated reviews do not establish effectiveness.
Keep Long-Session Course Checks at material boundaries and at most ten active minutes apart.

Declare one writer per surface and use the relevant skills. Preserve one current contract with all
owners/consumers migrated together. Place product work at its real module/domain; keep product,
presentation, Identity and Access, transport and infrastructure distinct. Preserve existing UI and
require acceptance of a new direction. Product identity, delivery, tenancy and localization have
separate typed owners; preserve deny-by-default tenant isolation. Follow the applicable
architecture, permission, language and verification sections instead of copying their rules here.
Build and maintain infrastructure as code with scenario-appropriate Ansible, Terraform or Pulumi;
follow [Infrastructure As Code](instructions.md#infrastructure-as-code) for tool ownership, real
repository structures, state/secrets and verification before infrastructure work.

## Coordination And Closure

Use four useful concurrent subagents when independence, effective permissions and confirmed capacity
permit, otherwise state the limit; at most four live. No model/reasoning override: exact configured
GPT Astra/max parity. Before child tools verify effective permissions and provenance. Read-only
roles stop under broader overrides; an explicit worker may inherit an authorized Dev YOLO override
only for its exact disjoint write set. No extra network, credentials or external-action authority is
conferred. The primary owns policy, integration, handoffs and supported thread closure.

Register owned agents/background tasks and their safe boundaries. Never contact/control ambiguous or
foreign processes. Reserve completion capacity. At critical capacity drain only owned work, record
the canonical Critical Budget Drain attestation and run `pnpm handover:create -- --critical` as the
final action, then stop completely. Follow the exact restart/acceptance protocol later.

After each completed slice run `pnpm worktree:status -- --json`; preservation is not completion.
Follow goal housekeeping and verification within the maintenance scope boundary, using focused
checks during work and the applicable final evidence on the stable integration state. The README's
`bash scripts/setup/run-project.sh pnpm framework:publish --message "<commit message>"` supports
explicitly authorized publication from the verified owning session after its other writers drain. It
cleans source, verifies, commits and pushes while preserving active runtime; full runtime reset
still requires session exit. Never infer publication or deployment authority. Keep source LICENSE,
NOTICE, Zoran Kikic and CodexRig Framework credit; generated-output permission is defined only by
NOTICE.

Portable startup is on-request, network-disabled workspace-write. Only explicitly authorized Dev
`--yolo` changes runtime permissions; staging/production retain their stronger gates. Keep native
state private and portable policy visible. Exact procedures and recovery boundaries remain in
[instructions.md](instructions.md); use its relevant sections on demand.
