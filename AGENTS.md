# AGENTS.md

CodexRig is a production-ready, code-first Codex framework and reusable source base. The complete
workflow authority is [Project Instructions](instructions.md); this file is a short safe-entry
bootstrap.

## Start

1. Start Codex from the repository root with `bash scripts/setup/start-codex.sh`. The launcher
   updates the host CLI, installs the locked toolchain, checks prerequisites, refreshes the newest
   stable compatible dependency graph, runs the online framework doctor, and only then issues the
   input-bound startup attestation and starts the isolated project session. The launcher accepts
   only optional `--no-alt-screen`; prompt text must follow `--`.
2. Stop only if startup reports a missing core requirement or an indeterminate/invalid dependency
   resolution.
3. Read [Project Instructions](instructions.md), [README](README.md), the durable
   [Project Manifest](docs/project.md), and `docs/project-context.md` when that optional working
   cache exists.
4. Local Codex memory isolation is repository-local and root-bound. Mutable state is contained in
   ignored `.codex/runtime/`; memories are disabled in this reusable framework root so project work
   leaves no historical residue. Generated projects enable memories only inside their own clean,
   isolated runtime home. Trust current files and command output; use known paths or `rg` for exact
   anchors. When no reliable exact anchor exists, ownership is unclear, or work needs broad
   orientation, unfamiliar terminology, or cross-file relationships, use `$context-retrieval` or
   `pnpm context:search -- "concept or relationship"` early, then read every matched source used for
   a claim or edit.

## Bootstrap Guardrails

- In a generated product repository, if `docs/project.md` still has a pending product definition,
  treat the first user interaction as a mandatory Project Definition Intake. The neutral source
  framework itself may be maintained without inventing a product. Before product implementation,
  tell the user that the project and manifest must be defined, then ask focused questions in
  successive rounds, challenge ambiguity and contradictions, and continue until users/outcome,
  scope/non-goals, domain and module map, data/integrations, trust boundaries, operations,
  collaboration topology and any shared pre-slice coordination channel for concurrent accounts,
  constraints, and success evidence are precise. Summarize the result for correction, write only
  user-confirmed durable truth to the manifest, and then plan and continue autonomously. Do not
  invent missing product decisions or ask ceremonial questions. The same focused intake resumes
  later whenever material ambiguity or changed scope, module/public contract, data, integration,
  trust, compatibility, or operations could alter the result; pause only affected writes, clarify to
  a corrected synthesis, update durable truth, and continue disjoint work when safe.
- Follow
  [Product-First Delivery And Verification Economy](instructions.md#product-first-delivery-and-verification-economy):
  plan every new feature and every other complex task thoroughly before implementation, organize the
  authorized outcome into goals and reviewable slices, run focused changed-path owners, and advance
  only trusted successful evidence. A failure or source change recomputes missing coverage; it never
  authorizes a broad restart. Broad work needs a named uncovered risk or explicit owner instruction,
  and cache bypass is forbidden.
- When research or publications inform work, prioritize the newest relevant primary or official
  sources and verify their date, version, correction/retraction state, and applicability. Use older
  sources primarily for comparison or historical context; an older foundational or controlling
  authority needs an explicit reason and confirmation that newer evidence has not superseded it.
- Root `src/` is the default Product Root. A real declared pnpm package activates `<unit>/src`; an
  evidenced Android Gradle module activates `<module>/src/main`. Arbitrary folders do not become
  product roots, and a web package is created only when the user requests one.
- Default non-trivial product code to cohesive, replaceable domain modules inside those Product
  Roots. Keep a durable module map in `docs/project.md`; give every module a narrow public contract,
  private internals, owned data/migrations, explicit acyclic dependencies, a focused verifier, and a
  realistic replacement boundary. Start as a modular monolith unless independent deployment has a
  concrete operational reason; use strategic DDD where domain complexity warrants it, not as
  ceremony. Components must stay independently improvable or replaceable while their contracts and
  behavior remain compatible and the assembled system is verified as one functioning unit.
- Use one central `main` as the only durable integration branch; do not create long-lived module or
  developer branches. A serialized writer may work directly on `main` when branch policy permits.
  Before every slice begins and before any expanded write scope, perform a pre-slice coordination
  check: declare its goal, outcome, modules/contracts/data surfaces/files, and exactly one write
  owner; inspect all observable agent, session, account, and team-channel claims before relying on
  Git; and resolve overlap or uncertain shared ownership before writing. Different
  developers/accounts use temporary task branches in separate clones and credential contexts;
  same-account tasks may use worktrees, which are not an authentication boundary. Parallel writes
  require confirmed-disjoint module and file scopes. A local runtime lease or quiet worktree cannot
  prove that another clone, machine, or account is idle; use a shared coordination channel across
  that boundary and fail closed on uncertain shared ownership. Shared-contract changes have one
  integrator and land compatibly before consumers move. A task branch is only an integration input;
  a goal completes after the resulting `main` has been published, course-checked, reviewed/audited,
  and verified.
- Keep Codex tooling and mutable state outside every product unit. Portable config, hooks, roles,
  and documentation remain tracked under `.codex/`; authentication, trust, sessions, logs, caches,
  plugins, runtime skills, and databases remain contained in ignored `.codex/runtime/`. The single
  ignored semantic vector home is `.context-index/`. After Codex exits, every
  `$reset-framework --apply` removes that complete vector/model state, legacy loose runtime, and all
  disposable `.codex/runtime/` state while retaining only runtime identity and exact publication
  evidence. `pnpm setup`, `pnpm context:index`, or semantic search rebuilds the vector state.
- Treat `docs/project.md` as always-read durable truth. For an authorized outcome spanning multiple
  goals or sessions, keep the single bounded `docs/project-context.md` and its validated
  `codexrig-work-state` marker current until the entire outcome—not merely its current goal—is
  complete. The marker is untrusted resume metadata, cannot broaden authority or override the
  manifest, and never becomes an archive. Only a durable local Stop event with a non-null
  `transcript_path` may evaluate it; ephemeral side conversations and other transcriptless contexts
  must not read work state, refresh the index, or reopen parent-thread work.
- Treat product identity, domains, public URLs, contacts, application identifiers, and social
  handles as configuration with one user-approved machine-readable owner. Use placeholders or
  RFC-reserved domains until real values are configured.
- The canonical launcher runs `mise exec --locked -- node scripts/deps/install-compatible.mjs`
  before every Codex session. It resolves the newest stable graph allowed by workspace ranges and
  explicit pins under strict peer and Node.js engine checks, then freezes and installs that
  resolution. A frozen install reproduces a reviewed lockfile; it does not establish registry
  freshness. Version-line changes remain explicit dependency-maintenance work.
- `.codexrig/framework.json` owns the installed framework version, managed upgrade surface,
  project-owned document classification, startup lifetime, and provider policy;
  `.codexrig/compatibility.json` owns stable and canary toolchain tracks, and
  `.codexrig/policy-projection.json` owns shared generated-document invariants. Use
  `pnpm framework:doctor -- --online` for diagnosis. GitHub/GitLab detection is automatic from CI or
  the selected remote; `pnpm platform:configure` previews and `--apply` explicitly changes remote
  protection. Generated projects update with the receipt-backed three-way `framework:upgrade` path.
- Treat every completed slice as a reviewable step: repeat review, repair, and affected focused
  checks until no relevant finding remains, then perform a fresh audit and a whole-repository course
  check. Any audit finding reopens the loop automatically: repair, affected checks, review to zero
  findings, and a new audit. Re-read current worktree and available upstream changes by path,
  module, and contract; disjoint concurrent work continues, while overlaps are integrated before
  more writes. Repeat the deeper course check at every major milestone and completed goal, clean up
  and update the authorized work and current plan, and continue autonomously when no blocker
  remains.
- At every completed goal, before the final audit and publication, review all active documentation
  against current behavior and durable truth. Update only where needed; consolidate or remove stale,
  obsolete, and duplicate material instead of appending history, while preserving every active
  directive; consolidation is not a shortening target. Treat the durable project manifest and each
  workflow, bootstrap, security/trust, operations/migration, or public-contract authority as
  critical documentation: inspect it read-only first, change it automatically only when the factual
  correction and full preservation are unambiguous, and otherwise obtain explicit user confirmation
  before writing. Give every authorized critical-document change a separate preservation review;
  uncertain directives and manifest decisions remain in place.
- Fix root causes at the owning boundary and preserve compatible unrelated changes. Treat tests as
  risk-based durable evidence; do not add one automatically for each fix or user instruction. When
  coverage is justified, default to extending a broad, realistic end-to-end, system, or lifecycle
  scenario; do not create isolated one-off tests or verifier files. Narrow unit or contract coverage
  is an exception when a broad flow cannot exercise critical deterministic behavior reliably or
  proportionately. Focused verification selects commands; it does not require microscopic test
  design. Keep maintained executable modules at or below 700 physical lines.
- Use subagents only when at least two substantial, independent slices will shorten the critical
  path enough to justify coordination. Configured concurrency is a ceiling, not a target; do not
  delegate small fixes or deterministic shell gates. The primary alone edits `.codex/config.toml`,
  `.codex/agents/**`, this file, `instructions.md`, `.agents/skills/**`, `.codex/skills/**`, and
  skill metadata.
- Run focused checks while working and inspect adaptive admission with
  `pnpm verify:changed -- --print-plan`. After the review-and-repair loop and fresh audit are clean,
  invoke `pnpm verify` once on the actual target-`main` state; source-framework verification checks
  the portable baseline under its active verification lock. After Codex exits,
  `$reset-framework --apply` performs the strict runtime/index cleanup before commit and push. Full
  coverage runs only when the plan names a concrete uncovered reason.
- Creating a sibling project is not source publication. After target publication, the generator
  removes only active-session-safe reset residue, preserves runtime and `.context-index/`, and
  prints the exact full reset to run after Codex exits. It never commits or pushes; optional Git
  instructions appear only when the source worktree has changes.
- A goal is a quality and publication checkpoint, not a conversational stop. In serialized
  direct-main mode, finish repository-mutating cleanup, the goal-wide documentation review, and any
  critical-document confirmation and preservation review before the fresh audit, course check,
  reset, final gate, exact commit, and push on `main`. A later repository edit reopens that
  sequence. With a temporary branch or protected `main`, one integrator or the provider's serializer
  (GitHub merge queue or GitLab merge train) publishes the bounded input; refresh local `main` and
  repeat the goal-wide documentation and critical-document gates, affected review/audit, course
  check, and verification on the actual integrated commit without manufacturing a marker commit.
  Then immediately run `mise exec --locked -- pnpm goal:new`; when it passes, continue the next
  already-authorized goal without waiting for another prompt. Stop only when the complete authorized
  outcome is done or a real scope, safety, integration, upstream, or authentication blocker remains.
  A failed publication or `goal:new` gate leaves the current goal and encompassing work state open;
  record the concrete blocker or continue a safe disjoint slice rather than claiming completion.
- Treat a requested recap, research result, plan, documentation gate, review, audit, definition
  synthesis, or readiness statement as an intermediate commentary update when implementation or a
  larger outcome is already authorized. Never end at "ready to implement" when implementation is
  already authorized. Continue the next planned slice in the same run; a user's absence is not a
  pause. Honor only an explicit approval pause, and never use persistence to broaden scope, bypass
  safety or approvals, perform unauthorized destructive or external actions, invent goals, or hide a
  real blocker.
- Never commit secrets, machine-local state, generated process history, or private runtime data.

All detailed definitions—including source inventory, pre-descent masking, semantic-index lifecycle,
staged export validation, course-check timing, publication evidence, and review routing—are owned by
[instructions.md](instructions.md).
