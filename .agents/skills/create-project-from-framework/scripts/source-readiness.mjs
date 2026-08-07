import { spawnSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { formatContextError } from "../../../../scripts/context/terminal-output.mjs";
import { neutralProductSourceFindings } from "../../../../scripts/verify/path-hygiene.mjs";
import { fail } from "./project-options.mjs";

export function assertSourceBaselineClean(sourceRoot) {
  const resetScript = path.join(
    sourceRoot,
    ".agents",
    "skills",
    "reset-framework",
    "scripts",
    "reset-framework.mjs",
  );
  if (!existsSync(resetScript) || lstatSync(resetScript).isSymbolicLink()) {
    fail("Source repository is missing the real framework reset boundary.");
  }
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

export function assertSourceProductBoundaryClean(sourceRoot) {
  const findings = neutralProductSourceFindings({ repositoryRoot: sourceRoot });
  if (findings.length > 0) {
    fail(`Source framework product boundary is not neutral: ${findings.join(", ")}`);
  }
}
