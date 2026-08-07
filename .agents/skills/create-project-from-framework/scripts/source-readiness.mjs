import { spawnSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { formatContextError } from "../../../../scripts/context/terminal-output.mjs";
import { neutralProductSourceFindings } from "../../../../scripts/verify/path-hygiene.mjs";
import { fail } from "./project-options.mjs";

function resetScriptPath(sourceRoot) {
  return path.join(
    sourceRoot,
    ".agents",
    "skills",
    "reset-framework",
    "scripts",
    "reset-framework.mjs",
  );
}

function requireResetBoundary(sourceRoot) {
  const resetScript = resetScriptPath(sourceRoot);
  if (!existsSync(resetScript) || lstatSync(resetScript).isSymbolicLink()) {
    fail("Source repository is missing the real framework reset boundary.");
  }
  return resetScript;
}

export function assertSourceBaselineClean(sourceRoot) {
  const resetScript = requireResetBoundary(sourceRoot);
  const result = spawnSync(
    process.execPath,
    [resetScript, "--root", sourceRoot, "--portable-source-baseline"],
    {
      cwd: sourceRoot,
      encoding: "utf8",
      input: "",
      stdio: "pipe",
    },
  );
  if (result.error || result.status !== 0) {
    const detail = formatContextError(
      [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
      sourceRoot,
    );
    fail(
      "Source framework baseline is not clean. Review the reset preview and run `pnpm framework:reset --apply` before creating a project." +
        (detail ? `\n${detail}` : ""),
    );
  }
}

export function cleanupSourceAfterProjectCreation(sourceRoot) {
  const resetScript = requireResetBoundary(sourceRoot);
  const result = spawnSync(
    process.execPath,
    [resetScript, "--root", sourceRoot, "--post-project-creation", "--apply"],
    {
      cwd: sourceRoot,
      encoding: "utf8",
      input: "",
      stdio: "pipe",
    },
  );
  if (result.error || result.status !== 0) {
    const detail = formatContextError(
      result.error?.message ?? [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
      sourceRoot,
    );
    fail(
      "Source framework active-session cleanup failed; the generated project was not retained." +
        (detail ? `\n${detail}` : ""),
    );
  }
}

export function postProjectCreationGuidance({ sourceHasChanges }) {
  const lines = [
    "Source framework active-session cleanup completed; no commit or push was performed.",
    "After ending every Codex/CodexRig session for this framework, finish cleanup from the framework root:",
    "1. Preview (a non-zero exit is expected when cleanup candidates are listed): mise exec --locked -- pnpm framework:reset",
    "2. Review the listed paths.",
    "3. Apply: mise exec --locked -- pnpm framework:reset --apply",
    "4. Confirm the clean baseline: mise exec --locked -- pnpm framework:reset",
  ];
  if (sourceHasChanges) {
    lines.push(
      "",
      "Optional Git publication because the source worktree has changes (never performed automatically):",
      "- Before exiting Codex, verify reviewed changes: mise exec --locked -- pnpm verify",
      "- After the final clean reset preview, inspect: git status --short",
      "- Stage only reviewed paths: git add -- <reviewed-paths>",
      '- Commit if desired: git commit -m "<message>"',
      "- Push if desired: git push",
    );
  }
  return lines;
}

export function assertSourceProductBoundaryClean(sourceRoot) {
  const findings = neutralProductSourceFindings({ repositoryRoot: sourceRoot });
  if (findings.length > 0) {
    fail(`Source framework product boundary is not neutral: ${findings.join(", ")}`);
  }
}
