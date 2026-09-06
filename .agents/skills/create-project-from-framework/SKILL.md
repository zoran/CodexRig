---
name: create-project-from-framework
description:
  Create a clean sibling project from the CodexRig Framework after the user supplies a project name
  and is proactively invited to develop a detailed product/manifest description with Codex. Exclude
  Git history, local runtime/cache state, framework planning history, provider-specific
  collaboration metadata, and framework-only material while preserving both portable CI adapters,
  project policy, and reusable tooling.
---

# Create Project From CodexRig Framework

Require a user-provided project name. Do not invent one.

Immediately after receiving the name, ask what the product should actually do; a tagline or one- or
two-sentence summary is not the full creation intake. Invite a detailed description in the user's
own words and explain before asking that Codex will proactively structure it into the manifest,
challenge ambiguities and contradictions, recommend missing decisions, and continue refining it with
the user inside the generated project. Cover users/outcomes and critical workflows, scope and
non-goals, likely domains/capabilities, data/integrations/trust, desired surfaces/devices, delivery
constraints, and user-facing single- versus multi-locale needs without demanding jargon or a
finished specification. Do not ask again for facts already supplied. Summarize sufficient input for
correction; pass the confirmed detailed description with `--description`. If material creation input
is missing, continue small focused questions. Only an explicit user choice to defer the description
permits generation without it; silence or a short summary is not that choice.

Explain the handoff before generation: the description is stored as a visible intake draft, never as
active module inventory. On the child's first start, Codex evaluates any draft or filled manifest,
explains the successive Project Definition Intake, identifies strengths, gaps, and contradictions,
and asks whether the user wants to refine it or—when decision-ready—begin from the confirmed scope.
The manifest remains refinable when later learning changes durable truth.

Treat the current prompt and current source tree as the only project-creation inputs. Local Codex
memories are disabled in the reusable source: never retrieve, use, or preserve historical task,
product, sibling-project, path, outcome, or session-derived facts while creating a fresh project. If
obsolete memory is surfaced by the host despite that policy, classify it as invalid residue and do
not use it for identity, scope, defaults, decisions, or verification. The generator enables memories
again only in the fresh target's repository-root `CODEX_HOME`, after excluding every source memory
file and database.

Run:

`mise exec --locked -- node .agents/skills/create-project-from-framework/scripts/create-project-from-framework.mjs --name "<Project Name>" --description "<Confirmed Detailed Product Description>"`

Run `mise install --locked` and then
`mise exec --locked -- pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile` in the
source workspace first. Creation uses the source's locked runtime and pinned formatter to make
generated Markdown deterministic. This is a source-only tooling hydration step, not the generated
project's dependency freshness policy.

Project creation must never change tracked or portable source-framework content or add the requested
project name to source tests, documentation, or policy. The generator requires a clean
portable-source reset baseline, which still rejects process/planning residue while ignoring active
contained runtime state, snapshots the tracked and portable source state, rechecks it before
publication, and discards staging if that state changes. After publication it invokes the reset
boundary's restricted active-session cleanup, which removes only reset-owned nonportable
process/export residue and deliberately preserves local runtime; it then rechecks the portable
baseline and source state before retaining the target. Use neutral fixture names for generator
regression coverage.

The success output must state that no commit or push occurred and must always give the exact
post-exit reset preview, review, apply, and clean-preview sequence for the source framework. Only
when the source Git worktree has changes may it additionally print optional verify, status, stage,
commit, and push commands. Those Git commands are guidance for the user, never generator actions.

The default transfer uses the source repository's tracked files plus the required `mise.toml` and
`mise.lock` runtime contract, which staged validation checks before publication. Other local drafts
and ignored state cannot enter the new project. Use `--include-untracked` only when the user
explicitly asks to transfer a working-tree snapshot.

Before publication, a complete selected-source transfer manifest must classify every inventoried
path as either copied or excluded for a non-empty source-only reason. Every copied reusable file
must remain byte-identical unless it is one of the explicit project identity/configuration
transformations; the generated installation receipt is the only required project-only file, with an
empty `src/.gitkeep` allowed only when the selected source has no file in its required Product Root.
A missing, unexpected, or undeclared changed file fails project creation. This invariant carries
every still-active framework capability, including work introduced in earlier framework revisions,
without copying retired or source-only generator/reset behavior into a product repository.

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
instructions, and process state remain outside every product unit. Repository discovery uses the
current manifest, scoped exact searches and direct matched-source reads. The preloaded session
controller handles durable Stop continuation through its built-in-only hook client; ephemeral side
conversations and other transcriptless contexts remain inert.

## Verify The Generated Boundary

The generator owns the executable transfer and publication contract; do not reimplement it manually.
Read the source's [Project Instructions](../../../instructions.md), the
[portable transfer contract](../../../scripts/setup/portable-project-contract.mjs), and the staged
validation result when evaluating a failure.

Confirm these generation-specific outcomes:

- Every selected source path is classified; copied reusable bytes change only at declared identity
  or configuration transformations. Both portable CI adapters and all current portable skills,
  policy, hooks, roles and runtime controllers remain. Source-only generation/reset capabilities,
  private native state, secrets, planning history and provider collaboration metadata do not
  transfer.
- The target has its installation receipt, real `src/`, pending manifest/intake draft, separate
  typed product/delivery/tenancy/localization owners, and coherent product/package identity. Source
  memory is excluded and memories are enabled only in the fresh target.
- Validate from the copied staged validator: stable stage identity, no caller-selected stage path,
  valid modules and contained resolvable relative imports. An existing outer target or changing
  portable source blocks publication; never overwrite it.
- Startup and lifecycle behavior retain the single current contract from
  [Session Start](../../../instructions.md#session-start), including native resume, Astra/ultra,
  explicit Dev-only YOLO, exactly two trusted session-only hooks and accepted-handover recovery.
- Durable child policy remains current through
  [Framework Lifecycle](../../../instructions.md#framework-lifecycle-compatibility-and-git-platforms)
  and its policy projection. Do not repeat global architecture, autonomy, coordination, review,
  cleanup or publication rules in this skill or invent a second generated authority.
- Post-publication active-session cleanup changes no tracked/portable source or live native runtime.
  Always print the exact post-exit full-reset sequence. Source-specific project facts never enter
  framework source, tests or docs.

Report the generated path, package identity, actual verification and any failed boundary. No Git
initialization, remote creation, commit or push occurs. Optional Git guidance is not permission to
perform it. Preserve source-facing LICENSE/NOTICE under the canonical attribution contract.
