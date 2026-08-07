import { isManagedMarkdownPath } from "../../../../scripts/docs/document-scope.mjs";
import {
  nonPortableSnapshotPathReason,
  requiredPortableContractFiles,
} from "../../../../scripts/setup/portable-project-contract.mjs";

const sourceOnlyPaths = new Set([
  ".agents/skills/create-project-from-framework",
  ".agents/skills/reset-framework",
  "scripts/setup/project-initialization-test-helpers.mjs",
  "scripts/setup/project-initialization-boundaries.source.test.mjs",
  "scripts/setup/project-initialization.source.test.mjs",
  "scripts/setup/project-initialization-transfer.source.test.mjs",
  "scripts/setup/project-creator-contract.source.test.mjs",
  "scripts/setup/project-generator-state.test.mjs",
  "scripts/verify/source-baseline.mjs",
]);

const portablePlatformFiles = new Set([".github/workflows/ci.yml", ".gitlab-ci.yml"]);

export const generatedProjectDocuments = new Set([
  "AGENTS.md",
  "README.md",
  "docs/context-index.md",
  "docs/project.md",
  "instructions.md",
]);

export const defaultUntrackedPortableContractFiles = new Set(["mise.lock", "mise.toml"]);

export { requiredPortableContractFiles };

function isSourceOnly(relativePath) {
  for (const excludedPath of sourceOnlyPaths) {
    if (relativePath === excludedPath || relativePath.startsWith(excludedPath + "/")) return true;
  }
  return false;
}

export function shouldSkipProjectTransferPath(relativePath) {
  if (relativePath.startsWith(".github/") && !portablePlatformFiles.has(relativePath)) return true;
  if (relativePath.startsWith(".gitlab/")) return true;
  if (isSourceOnly(relativePath)) return true;
  if (nonPortableSnapshotPathReason(relativePath)) return true;
  return isManagedMarkdownPath(relativePath) && !generatedProjectDocuments.has(relativePath);
}
