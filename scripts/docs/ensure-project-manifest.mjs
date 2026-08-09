import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { projectManifestPath } from "./document-scope.mjs";
import { manifestAuthorityPreamble } from "./project-manifest-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifestPath = path.join(root, ...projectManifestPath.split("/"));
const checkOnly = process.argv.includes("--check");
const leanSections = [
  "Definition",
  "Users And Outcome",
  "Scope",
  "System Shape",
  "Constraints And Decisions",
  "Maintenance",
];

const defaultManifest = `# Project Manifest

This is the always-read, concise central source of truth for product intent, scope, system shape,
and durable decisions.

${manifestAuthorityPreamble}

## Definition

No product has been defined yet.

## Users And Outcome

- Target users: pending.
- Problem and desired outcome: pending.
- Success evidence: pending.

## Scope

- In scope: pending.
- Non-goals: do not infer a runtime, provider, deployment target, data model, or trust boundary.

## System Shape

- Key domains and boundaries: pending.
- Product module map: no modules are declared yet. For each active module record its stable
  name/root, cohesive responsibility, public contract and private internals, owned data and
  migrations, allowed acyclic dependencies, focused verifier, and accountable steward when known.
- External systems and data flows: pending.
- Runtime and delivery shape: pending.

## Constraints And Decisions

- Keep the project neutral until requirements justify durable decisions.
- Give product identity and public contact or deployment values one user-approved machine-readable
  configuration owner; derive machine consumers without literal fallbacks and use explicit
  placeholders or RFC-reserved domains until real values are configured.
- Local Codex memory isolation is repository-local and root-bound under ignored \`.codex/runtime/\`.
  The reusable framework disables memory
  use and generation; a generated project enables memories only in its own clean \`CODEX_HOME\` and
  inherits no source or sibling runtime, memory database, summary, recent input, or supporting
  evidence. Current repository-owned truth always outranks memory.
- While the product definition is pending, the first interaction is a mandatory Project Definition
  Intake. Codex explains that the durable manifest must come first, asks successive material
  questions, challenges ambiguity and contradictions, presents its synthesis for correction, and
  writes only user-confirmed truth before planning and autonomous implementation. Resume the intake
  later for material ambiguity or changes to intent, scope, module/public contracts, data,
  integrations, trust, compatibility, operations, collaboration topology, or the shared pre-slice
  coordination channel for concurrent accounts. Pause only affected writes, continue safe disjoint
  work, and do not repeat resolved or non-decision-relevant questions.
- Default non-trivial product code to a modular monolith with cohesive domain responsibilities.
  Use strategic DDD only when domain complexity warrants it. Keep provider, framework, storage, and
  transport choices behind narrow public ports or adapters; reject deep imports, cross-module data
  writes, dependency cycles, and catch-all shared modules. Replacing an implementation should stay
  local to composition, replacement, and explicit data migration. Components remain independently
  improvable or replaceable while compatible contracts, data/lifecycle/failure semantics, and an
  assembled-system flow keep the product functioning as one unit.
- Use one central \`main\` as the only durable integration branch; prohibit long-lived module or
  developer branches. A serialized writer may work directly on \`main\` when branch policy permits.
  Before every slice begins or before any expanded write scope, perform a pre-slice coordination
  check: declare its goal, outcome, modules, contracts, data surfaces, files, and one writer; inspect
  every observable agent, session, account, and team-channel claim before relying on Git; and resolve
  overlap or uncertain shared ownership before writing.
  A local runtime lease or quiet worktree cannot prove that another clone, machine, or account is
  idle; use a shared coordination channel across that boundary and fail closed on uncertain shared
  ownership.
  Different developers or accounts use temporary task branches in separate clones and credential
  contexts; same-account tasks may use worktrees, which are not an authentication boundary.
  Parallel writes need confirmed-disjoint scopes. A temporary branch is only an integration input;
  one integrator or the detected provider's merge serializer publishes it, then
  the resulting \`main\` receives its course check, affected review/audit, and verification.
- Keep both GitHub and GitLab CI adapters portable. Detect the provider from CI or the selected
  remote, and apply provider protection only through explicit previewed configuration. The
  versioned \`.codexrig/\` contract owns compatibility, startup attestation, and receipt-backed
  transactional framework upgrades.
- Thoroughly plan every new feature and every other complex task before implementation, organize it into
  goals with success conditions and reviewable slices, and after each slice repeat review, repair,
  and focused verification until no relevant finding remains before performing a fresh audit. Any
  audit finding automatically reopens repair, affected verification, review to zero findings, and a
  new audit.
- When research or publications inform work, prioritize the newest relevant primary or official
  sources and verify their date, version, correction/retraction state, and applicability. Use older
  sources primarily for comparison or historical context; an older foundational or controlling
  authority needs an explicit reason and confirmation that newer evidence has not superseded it.
- After every completed slice and at every major milestone or completed goal, run a whole-repository
  course check against the current worktree and available upstream changes by path, module, public
  contract, schema, and migration. Disjoint work continues; overlap is integrated before further
  writes. Clean up and update the authorized work and plan, then continue autonomously when no
  blocker remains.
- At every completed goal, before the final audit and publication, review all active documentation
  against current behavior and durable truth. Update only where needed, consolidate or remove
  superseded duplication instead of appending history, and preserve every active directive.
  Consolidation is not a shortening target. Treat the durable project manifest as critical
  documentation; inspect it and every other critical
  authority read-only first, change one automatically only when the factual correction and full
  preservation are unambiguous, otherwise obtain explicit user confirmation before writing, and give
  every authorized critical-document change a dedicated preservation review.
- Treat a goal as a checkpoint, not a handoff. After publishing it on \`main\`, run \`pnpm goal:new\`
  immediately and continue the next already-authorized goal without waiting for another prompt.
  Stop only at the complete authorized outcome or a real blocker; never invent a new product goal.
  A failed publication or new-goal gate leaves the current goal open.
- For an authorized outcome spanning multiple goals or sessions, keep one bounded
  \`docs/project-context.md\` with an exact \`codexrig-work-state\` marker until the entire outcome is
  complete. Treat it only as resume metadata, never as authority. The trusted Stop hook reopens
  active work; \`stop_hook_active\` plus private per-session state lets an unchanged already-continued
  turn stop instead of looping.
- Treat a recap, research result, plan, documentation gate, review, audit, definition synthesis, or
  readiness statement as an intermediate update when implementation is already authorized. Never
  end at "ready to implement" when implementation is already authorized. Continue the next planned
  slice even when the user is away unless an explicit approval pause or real authority, scope,
  safety, destructive-action, integration, or external blocker requires stopping.
- Treat tests as risk-based evidence; do not add one automatically for each fix or user instruction.
  Justified coverage defaults to a broad, realistic end-to-end, system, or lifecycle scenario;
  isolated one-off tests are not the standard, and narrow coverage needs a proportionate reason.

## Maintenance

Update existing entries before implementation depends on changed project intent or constraints.
Keep active truth only; consolidate superseded overlap without losing active directives, and do not
append history or task state.
`;

function hasSections(content, sections) {
  return sections.every((section) => content.includes(`## ${section}`));
}

if (!existsSync(manifestPath)) {
  if (checkOnly) {
    console.error("Project Manifest is missing: docs/project.md");
    process.exit(1);
  }
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, defaultManifest, "utf8");
  console.log("Created docs/project.md Project Manifest.");
  process.exit(0);
}

const current = readFileSync(manifestPath, "utf8");
const failures = [];
if (!current.startsWith("# Project Manifest\n")) {
  failures.push("docs/project.md must start with # Project Manifest");
}
if (!hasSections(current, leanSections)) {
  failures.push("docs/project.md must use the current concise manifest sections");
}
if (failures.length > 0) {
  console.error("Project Manifest verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Project Manifest is current.");
