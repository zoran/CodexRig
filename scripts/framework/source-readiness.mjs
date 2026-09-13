/** Owns creation input readiness and source publication guidance, without touching private work state. */
import { readFrameworkContract } from "../contracts/framework-contract.mjs";
import { readProjectToolSelection } from "./project-tool-selection.mjs";
import { readRepositoryFile } from "../filesystem/repository-files.mjs";
import { validateCodexConfig } from "../setup/validate-codex-config.mjs";
import { neutralProductSourceFindings } from "../verify/path-hygiene.mjs";

export function assertProjectSourceReady(sourceRoot) {
  readFrameworkContract(sourceRoot);
  readProjectToolSelection(sourceRoot);
  validateCodexConfig(sourceRoot);
  if (
    (readRepositoryFile(sourceRoot, ".codex/config.toml").match(/^memories = false$/gmu)?.length ??
      0) !== 1
  )
    throw new Error("Source generation requires its disabled framework memory setting.");
}
export function assertSourceProductBoundaryClean(sourceRoot) {
  const findings = neutralProductSourceFindings({ repositoryRoot: sourceRoot });
  if (findings.length)
    throw new Error(`Source framework product boundary is not neutral: ${findings.join(", ")}`);
}
export function postProjectCreationGuidance({ sourceHasChanges }) {
  return [
    "Project creation did not modify source files, initialize Git, commit or push.",
    ...(sourceHasChanges
      ? [
          "Optional source publication after review and after every owning Codex session exits:",
          'mise exec --locked -- pnpm framework:publish --message "<message>"',
          "This explicit command resets, verifies, commits all non-ignored changes, pushes central main, and checks goal:new.",
        ]
      : []),
  ];
}
