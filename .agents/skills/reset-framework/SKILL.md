---
name: reset-framework
description:
  Inspect residue after framework optimization. Prepare source cleanup for publication or explicitly
  requested reset, sanitation and reuse. Preserve active runtime.
---

# Reset CodexRig Framework

After framework changes inspect their source residue under
[maintenance scope](../../../instructions.md#maintenance-scope-and-verification). Confirm the
framework and worktree. Use publication cleanup for authorized publication and full sanitation only
for an explicit reset. Preserve active, private and unrelated work.

For authorized publication use the existing combined owner:

```bash
bash -p scripts/setup/run-project.sh pnpm framework:publish --message "<commit message>"
```

It owns source preparation, complete candidate coverage, exact commit/push and settlement. Follow
[delegated release](../../../instructions.md#delegated-release) when assigned; display is not
authority. The source publisher is excluded from children. Generation preserves source state and
needs no reset.

For explicit sanitation/recovery, preview before applying:

```bash
env -u NODE_OPTIONS -u NODE_PATH node .agents/skills/reset-framework/scripts/reset-framework.mjs
env -u NODE_OPTIONS -u NODE_PATH node .agents/skills/reset-framework/scripts/reset-framework.mjs --apply
```

The [source upgrade command](../../../README.md#update-generated-projects) also schedules a full
session reset after a successful child change. Its launcher settles the request after exit or before
the next picker. A manual full apply requires all sessions exited and proven runtime quiescence.
Review exact candidates and require a clean final preview. The owner's publication mode allows
source cleanup for a proven live caller; do not manually remove leases, runtime databases/WAL,
worktrees or unknown recovery.

[Source inventory](../../../scripts/repository/source-inventory-policy.mjs) owns the precise
retained credential/runtime classification. Preserve Git/history, source, dependencies, portable
policy, `.auth`, admitted configuration/installation identity and valid exact publication evidence.
Remove only owner-classified process/generated/disposable state; incompatible private formats are
discarded under quiescence, never interpreted through a legacy reader. Product source is removed
only when explicitly in scope.

Child updates and repairs use `.project-state/child-maintenance/` for disposable source-side
material. Publication removes recognized untracked upgrade documents and checks the exact Git
candidate and outgoing history for child artifacts and checkout references. Resolve findings in
durable source before retrying. Preserve nested repositories, private accounts, local build
pipelines and releases, and infrastructure plans and state. Their respective tools own retention.

Keep the manifest product-neutral. Verification's lock-bound read-only source baseline may retain
valid unfinished context for an active session; completed source cleanup removes it. Reuse evidence
and fill relevant gaps, without a preliminary full run for reset/review/handoff. No reset reports,
archives, implicit Git history changes or additional product phase.
