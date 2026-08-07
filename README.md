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
installation receipt, an empty `src/`, and a pending `docs/project.md`.

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
- Root `src/` is the default Product Root. Non-trivial code uses cohesive, replaceable modules with
  narrow public contracts and acyclic dependencies.
- Local Codex memory isolation is repository-local and root-bound under ignored `.codex/runtime/`.
  Generated projects receive no framework runtime residue. The project-local Codex Stop hook
  refreshes changed indexed sources after setup.
- Every new feature or other complex task uses reviewable slices. A slice advances only after
  affected checks and review confirm that no relevant finding remains, followed by a fresh audit.
  Published goals continue through `pnpm goal:new` without waiting for another prompt. Never end at
  "ready to implement" when implementation is already authorized.
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

## Project Authority

- [Project Instructions](instructions.md) own the complete workflow and safety contract.
- [AGENTS.md](AGENTS.md) is the short safe-entry bootstrap.
- [Project Manifest](docs/project.md) owns durable truth and the module map.
- [Context Index](docs/context-index.md) defines semantic retrieval and freshness.
- `.codexrig/` owns versioned identity, compatibility, startup, upgrade, Git-platform policy, and
  the shared generated-policy projection.
