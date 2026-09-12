---
name: reset-framework
description:
  Restore CodexRig to a reusable, product-neutral framework baseline. Use whenever the framework
  itself was optimized, or when the user asks to reset, clean, sanitize, make pristine, remove
  goals/slices/planning/history, or prepare the framework for commit, export, or reuse.
---

# Reset CodexRig Framework

For a complete source-framework closure, lead with the existing publication orchestrator after every
owning Codex session exits:

```bash
mise exec --locked -- pnpm framework:publish --message "<commit message>"
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
invocation, name its commit/push effects and post-exit prerequisite, and give the combined command.
If publication is not authorized, explain that running it is the operator's explicit publication
choice; do not silently substitute only reset steps. The `mise` prefix selects the declared runtime.

For an explicitly reset-only/local outcome or a diagnosed recovery need, use the deterministic reset
boundary and explain why publication is outside that action:

```bash
mise exec --locked -- pnpm framework:reset
mise exec --locked -- pnpm framework:reset --apply
mise exec --locked -- pnpm framework:reset
```

The first command is a read-only preview and exits non-zero while reset candidates exist. Review its
exact list before using `--apply`, then require a clean preview. Runtime sanitation is allowed only
after every Codex session for the repository has ended; the launcher-owned runtime lease makes the
reset fail closed otherwise. The publication orchestrator already performs these reset steps.

Project generation uses the internal `--post-project-creation --apply` mode after publishing a new
target. That restricted mode may remove only reset-owned process/export residue that is safe during
the active session. It never migrates or deletes local runtime or SQLite/WAL state, and it never
substitutes for the mandatory full reset after Codex exits.

## Workflow

1. Confirm this is the CodexRig Framework and inspect Git status, branch, and remotes.
2. Preview the reset. Do not broaden deletion beyond reported framework process/generated state.
3. Apply after any optimization of the framework itself and whenever the user requests a reset. The
   script removes goal/slice/planning/review/handoff artifacts, optional active project context,
   project transaction state, generated exports, now-empty placeholder directories, disposable
   repository-root Codex runtime, obsolete mutable entries below `.codex/`, and disposable state
   below `.codex/runtime/`. Removal remains identity-bound and fails closed on unsafe content. Full
   reset holds the lifecycle lock and proves repository-wide runtime quiescence. It validates only
   the current lease schema; an incompatible private lease is discarded with disposable runtime
   rather than interpreted.
4. Preserve `.git`, source code, dependencies, and portable `.codex` policy. Preserve only the
   current runtime identity required for the next session in root CODEX_HOME (`auth.json`, root
   `config.toml`, and `installation_id`) plus exact current-schema, digest-valid successful
   publication evidence. Non-current or corrupt evidence and non-current identity copies are
   disposable state and are never interpreted or migrated. It removes sessions, history, memories,
   logs, databases and WAL files, caches, downloaded plugins/skills, snapshots, temporary files,
   startup attestations, and stale locks. Never rewrite Git history implicitly.
5. Ensure `docs/project.md` remains the concise, product-neutral central truth. Remove
   product-specific source manually only when the user explicitly placed it in scope; the reset
   script never guesses. Project generation may use the internal read-only
   `--portable-source-baseline` probe; framework verification uses the equivalent
   `--verification-source-baseline` only while its verification lock is active. These probes ignore
   contained runtime state that cannot enter generated output or verification evidence, but still
   reject process/planning residue and never substitute for publication cleanup.
6. Run the reset preview again. After applicable reviews, the publication workflow invokes adaptive
   `pnpm verify` admission once. Run the applied reset and clean preview once more after
   verification so any temporary state created by checks is gone while exact verification evidence
   is retained. The source-framework pre-push path repeats the read-only clean preview and fails
   closed if resettable state reappears.
7. Commit or push only when the user explicitly requested those external mutations. Project
   generation never performs them. Its success output always gives the exact post-exit full-reset
   sequence—preview, review, apply, and clean preview—and prints the optional explicit
   `framework:publish --message "<message>"` command only when the source worktree has changes. When
   an active Codex process owns the runtime, do not delete open SQLite databases or WAL files from
   inside that process.

Keep the result in code and configuration. Do not create reset reports, completion docs, or
archives.
