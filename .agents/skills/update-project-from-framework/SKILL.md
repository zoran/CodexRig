---
name: update-project-from-framework
description:
  Review or update an explicitly selected child from current generated output while preserving
  project adaptations. Feasibility reviews stay read-only.
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

The source's versioned selection and formatter project current output. The default plan retains
target-only files and combines missing package commands and verification entries with product
extensions. Review differing shared keys and existing opaque tools. Prefer the actual pristine
generated ancestor with `--baseline` when available. It merges disjoint text changes in tools,
policies, READMEs and manifest documents, merges JSON by key and retires unchanged obsolete tools.
Inspect overlapping edits and modify/delete conflicts. Regenerate conflicting dependency locks from
the merged manifests through the target's dependency owner within the authorized scope. Classify
differences as current source behavior, intentional product extension, obsolete behavior or
unresolved ownership. Trace imports/commands before retirement. Review startup, roles/hooks,
instructions/skills, registry and maintained docs together; keeping a file does not prove that it
received the fix.

Prefer current implementations with necessary extensions at narrow owners. Preserve typed product,
delivery, tenancy and locale decisions, actual module context/negative-test owners, dependency
patches/locks, launcher name and explicit `.codex/mise.*` discovery. Update all affected consumers
and retire superseded ones. Do not fill tenancy requirements with empty defaults or artificial
tests.

## Apply A Bound, Recoverable Change

Keep source-side previews, reconciliation JSON, patches, logs and reproductions in the ignored
`.project-state/child-maintenance/` directory. Keep real checkouts and recovery journals with their
target. Use synthetic names and portable paths for any regression retained in the framework. Use an
ephemeral reconciliation JSON array from the preview. Each decision retains `path`, `currentHash`,
`currentMode`, `desiredHash`, `desiredMode` and, with a baseline, `baseHash` and `baseMode`, with
`action` (`source`, `keep`, `replace`, `remove`) and a concrete reason. Replacement adds reviewed
UTF-8 `content` and integer `mode`. `keep` needs a product reason. For a target-only path, `source`
explicitly retires it. For a package or verification conflict, the proposed source combines
independent product fields with the shared values at the reported keys. With a baseline a source
decision also retains text edits outside overlapping hunks. Maintained documents without a pristine
ancestor use explicit document bindings. Preserve private work context. `--project-path <path>`
admits additional reviewed owners without authorizing their deletion.

Preview with `--reconcile <absolute-decisions.json>` and the original baseline when used. Source,
target or reference hash or mode drift invalidates review. Only a reviewed conflict-free plan gains
`--apply`. The target's current runtime owner locks, journals and rolls back proven
transaction-owned bytes. Reconcile child lifecycle extensions and imports before staging that owner.
Use `--target <root> --recover` after interruption; preserve unrelated changes and recovery
blockers.

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
Also run `pnpm verify -- --print-plan` through the target wrapper: require successful full admission
with no unmapped inputs before accepting the update. This plans complete coverage without running
checks; missing unit results are not an admission failure or a reason to start product suites. Use
isolated startup fixtures when real maintenance exceeds update authority. `--locked` may prepare
frozen inputs separately; preserve `--startup` in the normal launcher. Missing evidence, required
restart and fixture-only claims remain explicit.

A final current-output preview must explain every intentional deviation. Repeating a settled update
must make no target writes. Check that custom commands still dispatch and product files survive. The
source upgrade command schedules the
[post-update session reset](../../../README.md#update-generated-projects) when it applies changes.
Finish verification and settle recovery while the source session is open. Report version, changes,
preservation, exact tests and limits. Stop at update acceptance without adopting the child's backlog
or running `goal:new` to invent work. No installation receipt or universal self-updater.
