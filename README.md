# CodexRig Framework

CodexRig is a reusable, code-first framework for isolated Codex projects. It provides portable
policy, compatible dependency updates, semantic retrieval, modular architecture guardrails,
provider-neutral Git automation, and risk-based verification without imposing a product stack.

## Start

Install a current [Codex CLI](https://developers.openai.com/codex/cli/),
[mise](https://mise.jdx.dev/installing-mise.html), Git, Bash, ripgrep, and ShellCheck. From the
repository root run:

```bash
bash scripts/setup/start-codex.sh
```

The launcher updates Codex, installs the locked Node.js/pnpm toolchain, resolves and installs the
newest stable compatible dependency graph, runs the online framework doctor, and issues a
short-lived startup attestation before Codex receives ignored `.codex/runtime/` as its isolated
`CODEX_HOME`, with the canonical repository root retained as the project working directory. Failure
or indeterminate freshness blocks startup. A frozen install is reproducible evidence; it does not
establish registry freshness. Only `--no-alt-screen` is accepted as an optional launcher control;
pass prompt text after `--`.

For explicit setup or repair:

```bash
mise install --locked
mise exec --locked -- node scripts/deps/install-compatible.mjs
mise exec --locked -- pnpm setup
```

## Create A Project

Tell Codex: `Create a new project called <Project Name>. Short description: <one or two sentences>.`
No framework skill name or detailed specification is needed at this point. The generated
`<apps>/<Project Name>/code` repository contains both provider adapters, a versioned CodexRig
installation receipt, an empty `src/`, and a pending `docs/project.md`. A fail-closed transfer
manifest accounts for every selected source path: reusable files remain byte-identical except for
declared project-specific transformations, and every omission has an explicit source-only reason.
This includes all still-active capabilities inherited from earlier framework revisions.

After creation, open the generated `code` repository and start Codex there. In your first message,
provide the full project description. Codex then runs the detailed Project Definition Intake,
resolves material questions with you, and records only the definition you confirm before
implementation begins.

After publication, the generator automatically removes only source-framework residue that is safe to
clean while Codex is still active. It preserves local runtime and `.context-index/`, never commits
or pushes, and always prints the exact reset preview/apply/clean-preview sequence to run from the
framework root after every owning Codex/CodexRig session has ended. Optional verify, status, stage,
commit, and push commands appear only when the source worktree actually has changes.

## Core Contract

- **First Prompt: Define The Project.** A generated project has a pending manifest. Codex performs
  the Project Definition Intake, gives a final correction opportunity, records confirmed durable
  truth; the same focused intake resumes later when a material decision changes.
- Root `src/` is the default Product Root. Non-trivial code uses cohesive, replaceable components or
  modules with narrow public contracts and acyclic dependencies. They remain independently
  improvable or replaceable while contract, data, lifecycle, and failure semantics stay compatible
  and the assembled system is verified as one functioning unit.
- Local Codex memory isolation is repository-local and root-bound under ignored `.codex/runtime/`.
  Generated projects receive no framework runtime residue. The project-local Codex Stop hook
  refreshes changed indexed sources after setup and validates the bounded `docs/project-context.md`
  work-state marker. For an active multi-goal or multi-session outcome, it uses Codex's official
  continuation response so an intermediate handoff is reopened. If the same turn tries to stop again
  without a state revision change, `stop_hook_active` and private loop state allow the stop instead
  of creating an automatic loop.
- Every new feature or other complex task uses reviewable slices. A slice advances only after
  affected checks and review confirm that no relevant finding remains, followed by a fresh audit.
  Published goals continue through `pnpm goal:new` without waiting for another prompt. Never end at
  "ready to implement" when implementation is already authorized. Failed publication leaves the
  current goal open and cannot mark the encompassing authorized outcome complete.
- Research and publication-backed decisions prioritize the newest relevant primary or official
  sources and verify their date, version, correction/retraction state, and applicability. Older
  sources are used primarily for comparison or historical context unless a still-current
  foundational or controlling authority is explicitly justified against newer evidence.
- Before every slice begins, a pre-slice coordination check compares its goal, slice, modules,
  contracts, data surfaces, and files with all observable agent, session, account, and team-channel
  claims. Only confirmed-disjoint work proceeds in parallel; overlap or uncertain shared ownership
  is coordinated to one writer before implementation, with Git serving only as later integration
  evidence. A local runtime lease or quiet worktree cannot prove that another clone, machine, or
  account is idle; use a shared coordination channel across that boundary and fail closed on
  uncertain shared ownership.
- Every completed goal includes an all-document currency review before its final audit and
  publication. Stale or duplicate material is consolidated or removed instead of appended, active
  directives are preserved, and consolidation is not a shortening target. Changed critical authority
  documents receive a separate preservation review. The durable project manifest is critical
  documentation. Critical documents are inspected read-only first and changed automatically only
  when the factual correction and full preservation are unambiguous; otherwise Codex obtains
  explicit user confirmation before writing.
- GitHub and GitLab use equivalent checked-in CI. The framework detects the selected remote or CI
  provider, including configured self-hosts; `platform:configure` applies the matching protected
  branch, review, green-CI, and merge-serialization policy and verifies it by provider read-back.
- Central `main` is the only durable integration branch. Parallel writers use disjoint scopes and
  one owner per shared module, contract, schema, migration, configuration surface, or file.

## Essential Commands

```bash
pnpm framework:doctor -- --online
pnpm platform:detect
pnpm platform:configure                 # preview
pnpm platform:configure -- --apply      # mutate the detected remote
pnpm compatibility:matrix
pnpm verify:changed -- --print-plan
pnpm verify
pnpm context:search -- "query"
pnpm project:export
pnpm framework:reset
pnpm framework:reset --apply
```

For the reusable source framework, end Codex before the applied reset. It removes legacy root state,
sessions, history, logs, databases/WAL files, caches, downloaded runtime extensions, temporary
state, and the semantic index. Only the runtime identity needed for the next login/start and exact
successful verification evidence needed by pre-push remain. Source-framework pre-push runs the
read-only reset preview again and refuses a push if disposable state has returned.

The final source-framework publication order is:

```bash
pnpm verify
pnpm framework:reset          # expected to list candidates and exit non-zero once
pnpm framework:reset --apply
pnpm framework:reset
git commit ...
git push
```

Run the first command from a real Git worktree. Run the remaining commands only after the owning
Codex session has ended. Review the first reset preview before applying it; the final clean preview
and pre-push both fail closed if resettable state remains.

Generated projects can preview or apply a three-way, rollback-capable update from a reviewed,
trusted CodexRig checkout with `pnpm framework:upgrade -- --source <new-codexrig-root> [--apply]`.
Managed workflow skills, roles, scripts, and policy projections update transactionally;
project-owned identity, product, and operational documentation remains preserved for
repository-specific reconciliation. The current updater's preview and apply output lists those
unchanged documents explicitly. An upgrade launched by a pre-1.2 installed updater cannot
retroactively print the notice that it is installing. Review that legacy preview and do not apply it
if any write or delete targets a project-owned document. After a safe first apply succeeds, run the
same reviewed source once more with the newly installed updater as a preview only:
`pnpm framework:upgrade -- --source <same-codexrig-root> --allow-same`. Do not add `--apply` to this
reconciliation pass. Reconcile every listed document carefully before verification; portable
verification reports `project-document reconciliation required before verification` until stale
required policy is repaired. Obtain user confirmation for every uncertain critical-document change.

## Project Authority

- [Project Instructions](instructions.md) own the complete workflow and safety contract.
- [AGENTS.md](AGENTS.md) is the short safe-entry bootstrap.
- [Project Manifest](docs/project.md) owns durable truth and the module map.
- [Context Index](docs/context-index.md) defines semantic retrieval and freshness.
- `.codexrig/` owns versioned identity, compatibility, startup, managed upgrade and project-owned
  document classification, Git-platform policy, and the shared generated-policy projection.
