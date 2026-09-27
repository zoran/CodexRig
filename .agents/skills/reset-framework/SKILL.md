---
name: reset-framework
description:
  Restore CodexRig to a reusable, product-neutral framework baseline. Use whenever the framework
  itself was optimized, or when the user asks to reset, clean, sanitize, make pristine, remove
  goals/slices/planning/history, or prepare the framework for commit, export, or reuse.
---

# Reset CodexRig Framework

For a complete source-framework closure, use the existing publication orchestrator with explicit
user authority, including from the verified owning Codex session after its other writers drain:

```bash
bash scripts/setup/run-project.sh pnpm framework:publish --message "<commit message>"
```

This reset-owned orchestrator uses the existing worktree, housekeeping, verification, hook, and
goal-publication owners. It binds one central `main` remote, previews/applies reset and confirms a
clean baseline, runs housekeeping and verification, resets verification residue, and compares the
exact source snapshot before staging and committing under the lifecycle lock. It pushes that commit
through the managed pre-push hook, verifies remote `main`, and runs `goal:new` and Worktree
Settlement. Every failure stops subsequent steps. A rejected push preserves the local commit;
rerunning the command does not create an empty commit. This command and its implementation are
excluded from generated projects. The command does not infer publication authority for an agent.

Before a completion handoff, follow the command-selection rule in
[Verification](../../../instructions.md#verification): confirm the current package script and README
invocation, name its commit/push effects and ownership gate, and give the combined command. If
publication is not authorized, explain that running it is the operator's explicit publication
choice; do not silently substitute only reset steps. The `mise` prefix selects the declared runtime.

For an explicitly reset-only/local outcome or a diagnosed recovery need, use the deterministic reset
boundary and explain why publication is outside that action:

```bash
node .agents/skills/reset-framework/scripts/reset-framework.mjs
node .agents/skills/reset-framework/scripts/reset-framework.mjs --apply
node .agents/skills/reset-framework/scripts/reset-framework.mjs
```

The first command is a read-only preview and exits non-zero while reset candidates exist. Review its
exact list before using `--apply`, then require a clean preview. Runtime sanitation is allowed only
after every Codex session for the repository has ended; the launcher-owned runtime lease makes the
reset fail closed otherwise. Publication uses `--publication` internally: a proven calling session
receives source-only cleanup while its private runtime is preserved; outside active sessions it
performs the full reset.

Project generation preserves source state. Its positive file selection excludes private process and
runtime state, so generation never invokes reset or requires the source work cache to be empty.

## Workflow

1. Confirm this is the CodexRig Framework and inspect Git status, branch, and remotes.
2. Preview the reset. Do not broaden deletion beyond reported framework process/generated state.
3. Use publication mode for completed framework source cleanup. Apply full reset when the user
   requests runtime sanitation and the repository is quiescent. The script removes
   goal/slice/planning/review/handoff artifacts, optional active project context, project
   transaction state, generated exports, now-empty placeholder directories, disposable
   repository-root Codex runtime, obsolete mutable entries below `.codex/`, and disposable state
   below `.codex/runtime/`. Removal remains identity-bound and fails closed on unsafe content. Full
   reset holds the lifecycle lock and proves repository-wide runtime quiescence. It validates only
   the current lease schema; an incompatible private lease is discarded with disposable runtime
   rather than interpreted.
4. Preserve `.git`, source code, dependencies, portable `.codex` policy and repository-local account
   state under `.auth`. The
   [source inventory owner](../../../scripts/repository/source-inventory-policy.mjs) defines the
   native credential files retained in root CODEX_HOME; use that current classification rather than
   maintaining another credential list here. Preserve root `config.toml`, `installation_id` and
   exact current-schema, digest-valid successful publication evidence. Non-current or corrupt
   evidence and non-current identity copies are disposable state and are never interpreted or
   migrated; credential stores are not disposable runtime. Reset removes sessions, history,
   memories, logs, databases and WAL files, caches, downloaded plugins/skills, snapshots, temporary
   files, startup attestations, and stale locks. Never rewrite Git history implicitly.
5. Ensure `docs/project.md` remains the concise, product-neutral central truth. Remove
   product-specific source manually only when the user explicitly placed it in scope; the reset
   script never guesses. Framework verification uses the internal read-only
   `--verification-source-baseline` only while its verification lock is active. It ignores contained
   runtime state and the valid bounded unfinished work cache of an observably active repository
   session, but rejects other process/planning residue. Publication cleanup removes the work cache
   and source residue without deleting the verified calling session. Full reset still removes
   private runtime only after sessions exit.
6. Run the reset preview again. After applicable reviews, the publication workflow invokes adaptive
   `pnpm verify` admission once. The publication orchestrator repeats the applicable cleanup and
   preview after verification while retaining exact verification evidence. Source pre-push runs the
   read-only publication baseline: live caller runtime is allowed, source residue and competing
   writers are not.
7. Commit or push only when the user explicitly requested those mutations. Project generation never
   performs them or clears source context. When an active Codex process owns runtime, do not delete
   open SQLite databases or WAL files from inside that process.

Keep the result in code and configuration. Do not create reset reports, completion docs, or
archives.
