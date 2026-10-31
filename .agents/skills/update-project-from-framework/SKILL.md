---
name: update-project-from-framework
description:
  Update an existing child repository from this framework, reconcile portable workflow and tooling
  with current generation, and preserve intentional product adaptations. Use for explicitly
  requested child updates or update feasibility reviews; a review stays read-only.
---

# Update Project From Framework

This source-only procedure reconciles current generated tooling/policy with an explicitly selected
child while preserving product adaptations. Apply
[update scope](../../../instructions.md#repository-update-scope) and
[maintenance scope](../../../instructions.md#maintenance-scope-and-verification). A review stays
read-only; update acceptance does not start product work, dependency refresh or publication.

## Review Current Output

Reconstruct source and target Git/worktrees, recovery and writers; active/indeterminate target
owners block mutation. Identify product requirements, configuration, toolchains, patches, custom
checks and approval gates. Preserve accounts/history and inspect private paths by name only.

```bash
pnpm framework:upgrade -- --target <root>
```

The source's versioned selection/formatter projects current output. An optional real pristine
`--baseline` adds three-way comparison; it does not replace policy review. Classify differences as
current source behavior, intentional product extension, obsolete behavior or unresolved ownership.
Trace imports/commands before retirement. Review startup, roles/hooks, instructions/skills,
registry, CI and maintained docs together; keeping a file does not prove that it received the fix.

Prefer current implementations with necessary extensions at narrow owners. Preserve typed product,
delivery, tenancy and locale decisions, actual module context/negative-test owners, dependency
patches/locks, launcher name and explicit `.codex/mise.*` discovery. Update all affected consumers
and retire superseded ones. Do not fill tenancy requirements with empty defaults or artificial
tests.

## Apply A Bound, Recoverable Change

Use an ephemeral reconciliation JSON array from the preview. Each decision retains `path`,
`currentHash`, `currentMode`, `desiredHash`, `desiredMode`, with `action` (`source`, `keep`,
`replace`, `remove`) and a concrete reason. Replacement adds reviewed UTF-8 `content` and integer
`mode`. `keep` needs a product reason; `source` for a target-only path explicitly retires it.
Maintained README/manifest/context use explicit document bindings, never wholesale template
replacement. `--project-path <path>` admits additional reviewed owners without authorizing their
deletion.

Preview with `--reconcile <absolute-decisions.json>`; source/target hash or mode drift invalidates
review. Only a reviewed conflict-free plan gains `--apply`. The target's current runtime owner
locks, journals and rolls back proven transaction-owned bytes. Reconcile child lifecycle extensions
and imports before staging that owner. Use `--target <root> --recover` after interruption; preserve
unrelated changes and recovery blockers.

Unsupported old runtime requires explicit `--regenerate --confirm-quiescent --apply` after all
target writers stop and a fresh inventory. Prepare a disposable current child and reconcile product
owners; never strip the target or copy dependency/build/native-session state first. Recovery uses
`--regenerate --confirm-quiescent --recover` with the exact admitted source runtime. Preserve that
source until settlement. Operator confirmation does not mechanically fence an old launcher. Unknown
private schemas are not migrated through fallback readers; confirmed native preference/hook
conflicts must be reconciled under the current owner without discarding accounts/history or
weakening validators.

## Prove And Stop

Check current policy/context and affected tool consumers. Inspect `verify:changed -- --print-plan`;
prove selected actual dispatch/reuse and retained custom commands without broad product execution.
Use isolated startup fixtures when real maintenance exceeds update authority. `--locked` may prepare
frozen inputs separately; preserve `--startup` in the normal launcher. Missing evidence, required
restart and fixture-only claims remain explicit.

A final current-output preview must explain every intentional deviation. Repeating a settled update
must make no writes; customized registry metadata stays explicitly reconciled. Use existing reviews
and evidence, settle owned source/target state and remove owned temporary decisions. Report version,
changes, preservation, exact tests and limits; stop at update acceptance without adopting the
child's backlog or running `goal:new` to invent work. No installation receipt or universal
self-updater.
