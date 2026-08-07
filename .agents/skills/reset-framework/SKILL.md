---
name: reset-framework
description:
  Restore CodexRig to a reusable, product-neutral framework baseline. Use whenever the framework
  itself was optimized, or when the user asks to reset, clean, sanitize, make pristine, remove
  goals/slices/planning/history, or prepare the framework for commit, export, or reuse.
---

# Reset CodexRig Framework

Use the deterministic reset boundary:

```bash
pnpm framework:reset
pnpm framework:reset --apply
```

The first command is a read-only preview and exits non-zero while reset candidates exist. Review its
exact list before using `--apply`. Runtime sanitation is allowed only after every Codex session for
the repository has ended; the launcher-owned runtime lease makes the reset fail closed otherwise.

Project generation uses the internal `--post-project-creation --apply` mode after publishing a new
target. That restricted mode may remove only reset-owned process/export residue that is safe during
the active session. It never migrates or deletes local runtime, SQLite/WAL state, or
`.context-index/`, and it never substitutes for the mandatory full reset after Codex exits.

## Workflow

1. Confirm this is the CodexRig Framework and inspect Git status, branch, and remotes.
2. Preview the reset. Do not broaden deletion beyond reported framework process/generated state.
3. Apply after any optimization of the framework itself and whenever the user requests a reset. The
   script removes goal/slice/planning/review/handoff artifacts, optional active project context,
   project transaction state, generated exports, now-empty placeholder directories, the complete
   ignored `.context-index/` vector/model state, legacy loose root runtime, obsolete mutable entries
   below `.codex/`, and disposable state below `.codex/runtime/`. Index removal uses the same
   fixed-path ownership and maintenance-lock checks as `pnpm context:clean` and fails closed on
   unsafe content.
4. Preserve `.git`, source code, dependencies, and portable `.codex` policy. Preserve only the
   runtime identity required for the next session (`auth.json`, runtime `config.toml`, and
   `installation_id`) plus the exact successful publication evidence. The reset migrates those
   identity files from the former root locations on first cleanup. It removes sessions, history,
   memories, logs, databases and WAL files, caches, downloaded plugins/skills, snapshots, temporary
   files, startup attestations, and stale locks. Conflicting identity copies are a blocker rather
   than an overwrite guess. Never rewrite Git history implicitly.
5. Ensure `docs/project.md` remains the concise, product-neutral central truth. Remove
   product-specific source manually only when the user explicitly placed it in scope; the reset
   script never guesses. Project generation may use the internal read-only
   `--portable-source-baseline` probe; framework verification uses the equivalent
   `--verification-source-baseline` only while its verification lock is active. These probes ignore
   contained runtime/index state that cannot enter generated output or verification evidence, but
   still reject process/planning residue and never substitute for publication cleanup.
6. Run the reset preview again. After applicable reviews, the publication workflow invokes adaptive
   `pnpm verify` admission once. Run the applied reset and clean preview once more after
   verification so any index or temporary state created by checks is gone while exact verification
   evidence is retained. The source-framework pre-push path repeats the read-only clean preview and
   fails closed if resettable state reappears. The next setup, explicit index operation, or semantic
   search rebuilds the vector state.
7. Commit or push only when the user explicitly requested those external mutations. Project
   generation never performs them. Its success output always gives the exact post-exit full-reset
   sequence—preview, review, apply, and clean preview—and prints optional
   verify/status/stage/commit/ push guidance only when the source worktree has changes. When an
   active Codex process owns the runtime, do not delete open SQLite databases or WAL files from
   inside that process.

Keep the result in code and configuration. Do not create reset reports, completion docs, or
archives.
