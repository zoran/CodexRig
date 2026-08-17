/** Owns generated Codex configuration and operator documentation for clean projects. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { supportedCodexStartCommand } from "../../../../scripts/context/portable-context-contract.mjs";
import { markdown, markdownFence, writeRelative } from "./generated-document-helpers.mjs";

export function writeGeneratedCodexReadme(targetRoot) {
  const fence = markdownFence;
  writeRelative(
    targetRoot,
    ".codex/README.md",
    markdown([
      "# Project Codex Config",
      "",
      "## Portable And Runtime State",
      "",
      "Portable policy is tracked under `.codex/`; mutable repository-local Codex runtime is contained in ignored",
      "`.codex/runtime/`, including credentials, trust, sessions, logs, memories, caches, plugins,",
      "runtime skills, history, and databases.",
      "",
      "Tracked config is an executable policy layer: root `developer_instructions` in",
      "`.codex/config.toml` inject the primary orchestration,",
      "owned-work provenance, exact Sol/`ultra` parity, critical drain, and terminal-stop contract.",
      "Its `[agents]` table owns the four-thread ceiling and exact global subagent defaults; the",
      "project-scoped `.codex/agents/*.toml` configuration layers inject corresponding bounded role",
      "behavior. Never pass a model or reasoning override at spawn. `pnpm codex:validate` rejects",
      "missing or divergent primary/subagent policy.",
      "Role sandbox values are requested defaults, not proof: live parent permission overrides such",
      "as YOLO can be reapplied to children. Before any delegated repository tool, the child reports",
      "its effective runtime sandbox. A read-only role stops before repository work when the override",
      "is broader. An explicitly selected writer may accept the same primary turn's already-authorized",
      "YOLO override only for its exact disjoint repository write set; it gains no additional scope,",
      "network, credential, external-mutation, commit, push, publication, deployment, or delegation",
      "authority. Close every other permission mismatch and continue primary-only.",
      "",
      "Local Codex memory isolation is repository-local and root-bound. Memories are enabled only",
      "inside this project's clean, isolated `.codex/runtime/` `CODEX_HOME`; generation transfers no source or",
      "sibling memory state.",
      "",
      "## Start And Attestation",
      "",
      "Start from the repository root with:",
      "",
      fence + "bash",
      supportedCodexStartCommand,
      fence,
      "",
      "Portable Codex sessions default to on-request approval and network-disabled workspace-write;",
      "only an explicitly authorized Dev session launched with `--yolo` may use no approvals and",
      "danger-full-access, never staging or production. Use `bash scripts/setup/start-codex.sh --yolo`",
      "only for that explicitly authorized autonomous Dev",
      "session. That closed control selects no-approval/full-access Dev operation; it never authorizes",
      "staging, production, broader scope, credentials, or irreversible external work.",
      "",
      "The launcher validates portable policy, updates the host CLI with `CODEX_HOME` unset, installs",
      "the locked toolchain, checks prerequisites, refreshes the newest stable compatible dependency",
      "graph, runs the online doctor, and issues a short-lived startup attestation before Codex starts",
      "with ignored `.codex/runtime/` as `CODEX_HOME`. Its closed argument grammar accepts only optional",
      "`--no-alt-screen` and explicit Dev-only `--yolo`; prompt text follows `--`, and attestation",
      "binds that control mode.",
      "",
      "## Collaboration And Integration",
      "",
      "Central `main` is the only durable integration branch. Different developers use temporary task",
      "branches in separate clones and credential contexts; same-account worktrees are not an",
      "authentication boundary. Before every slice begins, compare its goal, outcome, modules,",
      "contracts, data surfaces, and files with all observable agent, session, account, and",
      "team-channel claims before relying on Git. Parallel writes require confirmed-disjoint scopes;",
      "overlap or uncertain shared ownership is resolved to one writer before implementation.",
      "A local runtime lease or quiet worktree cannot prove that another clone, machine, or account",
      "is idle; use a shared coordination channel across that boundary and fail closed on uncertain",
      "shared ownership.",
      "Git remains later integration evidence, not the primary pre-slice coordination mechanism.",
      "",
      "## Hooks, Recovery, And Context",
      "",
      "The trusted read-only SessionStart hook verifies the launcher proof and inspects only safe",
      "metadata for a recent repository-bound critical handover under ignored",
      "`tmp/codexrig-handovers/`; it asks the developer before the prompt body may be read through",
      "`$resume-project`. The trusted Stop hook uses the mise-pinned Node.js runtime once per durable",
      "local turn to validate optional bounded work state and terminal handovers even before a vector",
      "index exists. After `pnpm setup`, the same lifecycle also refreshes changed index sources. Its",
      "optional bounded `docs/project-context.md` carries the `codexrig-work-state` marker used to",
      "reopen active work. Only a durable local Stop event with a",
      "non-null `transcript_path` reaches either operation; ephemeral side conversations and other",
      "transcriptless contexts exit before work-state, loop-state, or index access. If Codex's",
      "`stop_hook_active` flag says the same durable turn was already continued and the revision is",
      "unchanged, private per-session state lets that stop proceed rather than looping. Marker content",
      "is resume metadata rather than authority. A handover sealed during the current runtime session",
      "suppresses Stop continuation and index refresh so no work follows that session's terminal seal.",
      "A later canonical session may accept the announced handover and then refresh or stop normally.",
      "It is not a watcher or per-tool hook. Review changed hook hashes through `/hooks`; no script",
      "may approve them automatically.",
      "",
      "## Validation And Authority",
      "",
      "See [Project Instructions](../instructions.md) for the complete workflow.",
    ]),
  );
}

export function enableGeneratedProjectMemories(targetRoot) {
  const configPath = path.join(targetRoot, ".codex", "config.toml");
  const config = readFileSync(configPath, "utf8");
  const disabledAssignments = config.match(/^memories\s*=\s*false\s*$/gmu) ?? [];
  if (disabledAssignments.length !== 1 || /^memories\s*=\s*true\s*$/mu.test(config)) {
    throw new Error(
      "Source portable config must contain exactly one disabled memories assignment.",
    );
  }
  writeFileSync(configPath, config.replace(/^memories\s*=\s*false\s*$/mu, "memories = true"));
}
