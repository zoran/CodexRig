---
name: create-project-from-framework
description:
  Create a clean sibling project from the CodexRig Framework when the user supplies a project name.
  Exclude Git history, local runtime/cache state, framework planning history, provider-specific
  collaboration metadata, and framework-only material while preserving both portable CI adapters,
  project policy, and reusable tooling.
---

# Create Project From CodexRig Framework

Require a user-provided project name. Do not invent one.

Treat the current prompt and current source tree as the only project-creation inputs. Local Codex
memories are disabled in the reusable source: never retrieve, use, or preserve historical task,
product, sibling-project, path, outcome, or session-derived facts while creating a fresh project. If
legacy memory is surfaced by the host despite that policy, classify it as invalid residue and do not
use it for identity, scope, defaults, decisions, or verification. The generator enables memories
again only in the fresh target's isolated `.codex/runtime/` `CODEX_HOME`, after excluding every
source memory file and database.

Run:

`mise exec --locked -- node .agents/skills/create-project-from-framework/scripts/create-project-from-framework.mjs --name "<Project Name>"`

Run `mise install --locked` and then
`mise exec --locked -- pnpm install --frozen-lockfile --ignore-scripts` in the source workspace
first. Creation uses the source's locked runtime and pinned formatter to make generated Markdown
deterministic. This is a source-only tooling hydration step, not the generated project's dependency
freshness policy.

Project creation must never edit the source framework or add the requested project name to source
tests, documentation, or policy. The generator requires a clean portable-source reset baseline,
which still rejects process/planning residue while ignoring active contained runtime and index
state, snapshots the full source Git status including ignored entries, rechecks both before
publication, and discards staging if the source changes. Use neutral fixture names for generator
regression coverage.

The default transfer uses the source repository's tracked files plus the required `mise.toml` and
`mise.lock` runtime contract, which staged validation checks before publication. Other local drafts
and ignored state cannot enter the new project. Use `--include-untracked` only when the user
explicitly asks to transfer a working-tree snapshot.

After publication, run `mise install --locked`,
`mise exec --locked -- node scripts/deps/install-compatible.mjs`, and
`mise exec --locked -- pnpm setup` in the generated project. The compatible installer must resolve
the newest stable graph allowed by the generated workspace ranges, explicit pins, overrides, and
supply-chain policy under strict peer and Node.js engine checks before it atomically refreshes and
installs the lockfile. Do not substitute a frozen install for this freshness step. Registry
uncertainty or an installation failure must leave durable dependency inputs unchanged and block
successful handoff.

Use `--directory <folder>` only when the user requests a specific outer project-folder name. The
default target preserves a safe single-segment project name and creates the workspace at
`<apps>/<Project Name>/code`. Names that are not safe path segments fall back to a lowercase slug.
The fixed final folder is always `code`; do not repeat the project name below it. Package identity
is derived from the outer project folder, not from the `code` folder. The `code` folder is the Codex
and tooling workspace; it must contain a real `src/` default Product Root. A real package matched by
`pnpm-workspace.yaml` with its own `package.json` and `src/` activates another product unit; an
evidenced Android Gradle module activates `<module>/src/main`. Arbitrary folders do not activate.
When the user later requests a web application, create or import the declared workspace package and
its `src/` as part of that task instead of pre-creating an empty `apps/web`. Agent policy, skills,
instructions, and process state remain outside every product unit. The repository-wide vector space
has one fixed, ignored location at root `.context-index/` and is never product source. Generation
does not copy or download vector state; the generated project's required `pnpm setup` creates it,
smoke-tests it, and reports its location and statistics. The portable project Stop hook then keeps
changed sources current once per Codex turn after local hash-bound approval through `/hooks`.

## Required Result

- no inherited `.git/`, remote, GitHub/GitLab collaboration metadata beyond the two portable CI
  adapters, environment secrets, installed dependency directories, build output, `.context-index/`,
  or source-project Codex runtime state;
- local-memory use and generation disabled in the reusable source, with no memory state transferred;
  normal memories enabled only in the generated project's own clean, isolated `.codex/runtime/`;
- portable `.codex/config.toml`, `.codex/hooks.json`, `.codex/agents/`, `.codex/README.md`, the
  project launcher, startup attestation, SessionStart verifier, and both context-index Stop-hook
  scripts retained;
- each generated project documents `bash scripts/setup/start-codex.sh` exactly: the launcher updates
  the host CLI outside project isolation, installs the locked toolchain, checks prerequisites,
  refreshes the newest stable compatible dependency graph, and only then uses the generated ignored
  `.codex/runtime/` as the isolated home for mutable Codex runtime; its closed interface accepts
  only optional `--no-alt-screen` as a control and requires prompt text after `--`;
- root-bound ignore and source-inventory policy exclude authentication, sessions, logs, caches,
  plugins, runtime skills, history, metadata, and Codex databases while retaining portable
  `.codex/config.toml`, hooks, roles, and documentation;
- Git-less inventory carries the same built-in pre-descent mask so private root/runtime trees are
  never entered without Git metadata; repository-local `.git/info/exclude` patterns are forbidden,
  and the tracked worktree `.gitignore` is the only local ignore authority; host and local Git
  excludes cannot hide active source, while source-state probes bind root-owned Git metadata with
  the canonical worktree and pin stat checks; goal publication compares content through a fresh
  temporary index; policy-sensitive probes disable repository-local FSMonitor execution and reject
  hidden index flags; a Git-less nested root remains Git-less;
- staged validation runs from its copied validator, accepts no caller-selected stage path, and keeps
  its canonical stage-directory identity stable through validation;
- the executable `goal:new` publication gate retained and required before any subsequent goal; it
  fails closed unless central `main` is current, the non-ignored worktree is clean, and `main`
  exactly matches a locally verifiable configured remote-tracking `main` upstream, with no active
  repository-local Git exclude rule remaining and exact-current successful verification evidence
  available;
- product-first delivery that thoroughly plans every new feature and every other complex task before
  implementation, organizes authorized work into goals with success conditions and reviewable
  slices, repeats review/repair/focused verification after each slice until no relevant finding
  remains, then performs a fresh audit;
- a mandatory first-prompt Project Definition Intake while the generated manifest is pending: Codex
  explains the gate, asks successive material questions, challenges ambiguity and contradictions,
  presents a precise synthesis for correction, and writes only user-confirmed durable truth before
  planning and autonomous implementation. The same intake resumes later when material ambiguity or
  changed intent, scope, module/public contracts, data, integrations, trust, compatibility, or
  operations could alter the result; only affected writes pause and resolved or irrelevant questions
  are not repeated;
- a durable module map and modular-monolith default for non-trivial product code: cohesive domain
  responsibilities, narrow public contracts, private internals, owned data/migrations, allowed
  acyclic dependencies, focused verifiers, and replacement-local ports/adapters; strategic DDD only
  when domain complexity justifies it;
- one central `main` as the only durable integration branch, without long-lived module or developer
  branches. Serialized work may use `main` directly when branch policy permits. Different
  developers/accounts use temporary task branches in separate clones and credential contexts;
  same-account tasks may use worktrees, which are not an authentication boundary. Concurrent writes
  need disjoint write sets, exactly one write owner per module or shared surface, and one integrator
  for shared contracts. A temporary branch is only an integration input; a goal completes after the
  published resulting `main` passes its course check, affected review/audit, and verification;
- whole-repository course checks after planning/discovery and every completed slice, at every major
  milestone and completed goal, at resume or context recovery, on material scope/assumption changes,
  before the final gate, and after publication. Slice checks compare current worktree and available
  upstream changes by path, module, public contract, schema, and migration; disjoint work continues,
  overlap is integrated before further writes, and each check is followed by authorized cleanup,
  current-plan updates, and autonomous continuation;
- a goal-checkpoint autonomy contract that runs `pnpm goal:new` immediately after publication on
  `main` and continues the next already-authorized goal without waiting for another prompt, stopping
  only at the complete outcome or a real authority, safety, integration, or external blocker;
- proportional subagent use only when at least two substantial independent slices shorten the
  critical path enough to justify coordination, without treating concurrency limits as targets or
  duplicating deterministic gates;
- a real default `src/` Product Root retained by portable export, with declared pnpm and evidenced
  Android units recognized by the same contract and guarded against nested `.codex`, `.agents`,
  agent instruction files, retrieval indexes, and process state;
- no planning history, status, review, audit, or handoff artifacts and no framework-only
  project-creation skill; later complex multi-session work may use one bounded, overwritten
  `docs/project-context.md`, never per-slice files or archives;
- a small code-first documentation surface with project name, package identity, and core workflow
  rewritten consistently;
- a setup command that materializes the generated project's own root `.context-index/` vector space
  and fails unless the database and smoke search are usable;
- an initial dependency command that resolves the newest compatible stable workspace graph before
  atomically recording and reproducibly installing it with lifecycle scripts disabled, while failing
  closed without durable-input mutation on registry or installation errors;
- threshold-driven atomic context-database generation replacement with verified reuse, plus
  automatic no-reuse repair for corruption and older ignored manifest schemas;
- an always-read primary-agent workflow that uses exact search for known anchors, semantic retrieval
  early for broad orientation or unclear cross-file ownership, and direct matched-source reads
  before claims or edits;
- exactly one validated SessionStart attestation hook plus one Stop hook. The Stop hook is inert
  before bootstrap, uses the mise-pinned runtime afterward, refreshes incrementally through the
  sanitized worker, and keeps local hook trust out of portable source;
- refusal when the outer project directory already exists and post-copy verification before handoff;
- refusal when the source has resettable process state or changes during generation;
- no source-framework mutation or project-specific source trace from creating the new project.

Do not initialize Git, create a remote, commit, or push unless the user separately asks. Report the
generated path, package name, and verification result.
