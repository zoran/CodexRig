---
name: reset-framework
description:
  Restore CodexRig to a reusable, product-neutral framework baseline. Use whenever the framework
  itself was optimized, or when the user asks to reset, clean, sanitize, make pristine, remove
  goals/slices/planning/history, or prepare the framework for commit, export, or reuse.
---

# Reset CodexRig Framework

Use [maintenance scope](../../../instructions.md#maintenance-scope-and-verification): local
framework acceptance does not require publication or full runtime sanitation. Preserve
active/private and unrelated work. Confirm this is the source framework and inspect Git/worktree
state.

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

Full apply requires all sessions exited and proven runtime quiescence. Review exact candidates and
require a clean final preview. The owner's publication mode allows source cleanup for a proven live
caller; do not manually remove leases, runtime databases/WAL, worktrees or unknown recovery.

[Source inventory](../../../scripts/repository/source-inventory-policy.mjs) owns the precise
retained credential/runtime classification. Preserve Git/history, source, dependencies, portable
policy, `.auth`, admitted configuration/installation identity and valid exact publication evidence.
Remove only owner-classified process/generated/disposable state; incompatible private formats are
discarded under quiescence, never interpreted through a legacy reader. Product source is removed
only when explicitly in scope.

Keep the manifest product-neutral. Verification's lock-bound read-only source baseline may retain
valid unfinished context for an active session; completed source cleanup removes it. Reuse evidence
and fill relevant gaps, without a preliminary full run for reset/review/handoff. No reset reports,
archives, implicit Git history changes or additional product phase.
