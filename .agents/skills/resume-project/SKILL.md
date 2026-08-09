---
name: resume-project
description:
  Recover durable repository context and continue work when the user says continue, resume, pick up,
  carry on, or equivalent, or when a fresh session must reconstruct active goals and next steps.
  Prefer current files and commands over remembered conversation state.
---

# Resume Project

1. Read the repository bootstrap, project manifest, optional bounded `docs/project-context.md`, and
   the current source and tests already named by those authorities.
2. Use known paths or `rg` for exact recovery. When no reliable exact anchor exists, ownership is
   unclear, or recovery depends on cross-file relationships, use
   `pnpm context:search -- "concept or relationship"` before broad repository exploration, then read
   every matched source used to reconstruct the work. A failed exact search is not a prerequisite.
3. Inspect Git state and focused command output. Use available session/memory evidence when the user
   refers to earlier work; current files and command results win.
4. Every resume and context-recovery point requires a whole-repository course check, as does every
   completed slice, major milestone, and completed goal under `instructions.md`. Reconcile the
   module map and current worktree with available upstream changes by path, module, public contract,
   schema, and migration. State the recovered objective, completed evidence, touched
   owners/consumers, blockers, current goal and slice, and next coherent planned action.
5. Before a resumed or newly selected slice begins, repeat the pre-slice coordination check from
   `instructions.md`: restate its goal, outcome, write set, and owners; inspect every observable
   agent, session, account, bounded-context, and shared team-channel claim before relying on Git;
   and resolve overlap or uncertain shared ownership to one writer and order. A local runtime lease
   or quiet worktree cannot prove that another clone, machine, or account is idle; use a shared
   coordination channel across that boundary and fail closed on uncertain shared ownership.
6. Clean up and update stale authorized work and planning context, then continue autonomously with
   the next planned slice or already-authorized goal without waiting for another prompt when no
   blocker remains; do not return merely because an intermediate goal checkpoint completed. Never
   end at "ready to implement" when implementation is already authorized. Treat a requested recap,
   recovered synthesis, research result, review, audit, gate, or user absence as an intermediate
   update, not an inferred pause; honor an explicit approval pause and every authority, scope,
   safety, destructive-action, integration, and external boundary. If the optional project-context
   cache exists, replace stale goal, slice, decision, and next-action entries with the compact
   current truth. Otherwise keep recovered plans, status, reviews, audits, and handoff context in
   the conversation instead of creating repository process documents.
7. Update product documentation only when a durable product or operational contract actually
   changed. A recovered completed goal remains open until its all-document currency review and any
   critical-document preservation review are clean. Treat the durable project manifest as critical
   documentation; inspect critical documents read-only first and obtain explicit user confirmation
   before writing whenever the factual correction or full preservation is uncertain.

Apply the current `instructions.md`, including its code-first documentation and proportional
verification rules.
