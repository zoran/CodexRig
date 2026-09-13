---
name: create-project-from-framework
description:
  Create a clean sibling project from the CodexRig Framework after the user supplies a project name
  and is proactively invited to develop a detailed product description with Codex. Exclude Git
  history, local runtime/cache state, framework planning history, provider-specific collaboration
  metadata, and framework-only material while preserving both portable CI adapters, project policy,
  and reusable tooling.
---

# Create Project From CodexRig Framework

Require a user-provided project name. Do not invent one.

Immediately after receiving the name, ask what the product should actually do; a tagline or one- or
two-sentence summary is not the full creation intake. Invite a detailed description in the user's
own words and explain before asking that Codex will proactively structure it at its requirements
owner, challenge ambiguities and contradictions, recommend missing decisions, and continue refining
it with the user inside the generated project. Cover users/outcomes and critical workflows, scope
and non-goals, likely domains/capabilities, data/integrations/trust, desired surfaces/devices,
delivery constraints, and user-facing single- versus multi-locale needs without demanding jargon or
a finished specification. Do not ask again for facts already supplied. Summarize sufficient input
for correction; pass the confirmed detailed description with `--description`. If material creation
input is missing, continue small focused questions. Only an explicit user choice to defer the
description permits generation without it; silence or a short summary is not that choice.

Explain the handoff before generation: the description is stored as a visible intake draft, never as
active module inventory. On the child's first start, Codex evaluates any draft or existing
definition, explains the successive Project Definition Intake, identifies strengths, gaps, and
contradictions, and asks whether the user wants to refine it or—when decision-ready—begin from the
confirmed scope. Requirements stay refinable at that same owner; the manifest records current
technical inventory. Follow
[Documentation Ownership](../../../instructions.md#documentation-ownership). A supplied detailed
brief creates `docs/requirements.md` as an unconfirmed draft linked from the manifest. Without a
brief the product stays pending and no extra specification is generated.

Treat the current prompt and current source tree as the only project-creation inputs. Local Codex
memories are disabled in the reusable source: never retrieve, use, or preserve historical task,
product, sibling-project, path, outcome, or session-derived facts while creating a fresh project. If
obsolete memory is surfaced by the host despite that policy, classify it as invalid residue and do
not use it for identity, scope, defaults, decisions, or verification. The generator enables memories
again only in the fresh target's repository-root `CODEX_HOME`, after excluding every source memory
file and database.

Run:

`mise exec --locked -- node scripts/framework/create-project-from-framework.mjs --name "<Project Name>" --description "<Confirmed Detailed Product Description>"`

Run `mise install --locked` and then
`mise exec --locked -- pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile` in the
source workspace first. Creation uses the source's locked runtime and pinned formatter to make
generated Markdown deterministic. This is a source-only tooling hydration step, not the generated
project's dependency freshness policy.

The source-only recipe `.codexrig/project-tools.json` explicitly selects each reusable file, package
command, development dependency and verification capability. Selection validates the real module,
shell and command dependency closure; a newly added source file is excluded until selected.
`--include-untracked` permits selected unpublished files, never a broad working-tree copy. The
required mise runtime files may be untracked. Private files, work context, source release metadata,
generator/export/updater/reset tooling, internal suites and compatibility experiments are excluded.

Creation preserves source content, including its current task context. It snapshots source state,
prepares a new owned stage, validates it and rechecks source state before publication. A changed
source or pre-existing target blocks publication. Generation performs no source reset, Git
initialization, commit or push. The optional post-exit source publisher is guidance only when source
changes exist; publication remains separately authorized.

The generator creates product-owned AGENTS, instructions, README and technical manifest, a real
empty `src/`, four typed configuration owners and optional requirements draft. Selected tools
receive one consistent neutral protocol namespace. The output contains no CodexRig references,
source credits, inherited LICENSE/NOTICE or installation receipts. The rights holder's output
permission in source NOTICE authorizes this boundary; the product owner chooses licensing
separately.

Selected reusable bytes remain exact except for declared document, identity, namespace, local tool
configuration and CI projections. Parity rejects missing, unexpected or undeclared changed output.
Both stable CI adapters remain; source experiments and internal regression campaigns do not.

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
[portable transfer contract](../../../scripts/framework/portable-project-contract.mjs), and the
staged validation result when evaluating a failure.

Confirm these generation-specific outcomes:

- The explicit selection and dependency closure are complete. Output runs with the source checkout
  unavailable; selected tools do not import or invoke excluded source capabilities.
- A real `src/`, independent package identity/version, pending manifest or intake draft, and
  separate product/delivery/tenancy/localization owners exist. Source memory is excluded; the fresh
  target enables only its own native memory.
- The source-owned validator checks the explicitly owned stage with stable directory/file identity,
  contained imports, product boundaries, empty project hooks, complete configuration and secret
  scanning. Validation tooling for generation stays in the source repository.
- Native resume, permission controls, exact session hooks, leases, worktree isolation and stable
  archive integrity remain effective. Invalid context or a tool error grants no new continuation
  task. Only an existing authorized project task can drive continuation.
- Adaptive verification discovers real product tests even for unknown changes or without Git
  history. Retained runtime tests cover the selected safety boundary; source suites stay excluded.
- README provides setup and document discovery; the manifest records current technical inventory;
  requirements and UI references retain distinct owners. Source-private context and planning are
  neither output inputs nor automatic cleanup targets.

Report the generated path, package identity, actual verification and any failed boundary. No Git
initialization, remote creation, commit or push occurs. Optional Git guidance is not permission to
perform it. Preserve source-facing LICENSE/NOTICE under the canonical attribution contract.
