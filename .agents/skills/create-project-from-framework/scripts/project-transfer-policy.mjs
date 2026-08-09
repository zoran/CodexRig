import { isManagedMarkdownPath } from "../../../../scripts/docs/document-scope.mjs";
import { generatedProjectDocumentPaths } from "../../../../scripts/docs/project-document-policy.mjs";
import {
  nonPortableSnapshotPathReason,
  requiredPortableContractFiles,
} from "../../../../scripts/setup/portable-project-contract.mjs";

const sourceOnlyPathReasons = new Map([
  [".agents/skills/create-project-from-framework", "project-creation tooling is source-only"],
  [".agents/skills/reset-framework", "reusable-framework reset tooling is source-only"],
  [
    "scripts/setup/project-initialization-test-helpers.mjs",
    "project-creation regression support is source-only",
  ],
  [
    "scripts/setup/project-initialization-boundaries.source.test.mjs",
    "project-creation regression coverage is source-only",
  ],
  [
    "scripts/setup/project-initialization.source.test.mjs",
    "project-creation regression coverage is source-only",
  ],
  [
    "scripts/setup/project-initialization-transfer.source.test.mjs",
    "project-creation regression coverage is source-only",
  ],
  [
    "scripts/setup/project-creator-contract.source.test.mjs",
    "project-creation regression coverage is source-only",
  ],
  [
    "scripts/setup/project-generator-state.test.mjs",
    "project-creation regression coverage is source-only",
  ],
  ["scripts/verify/source-baseline.mjs", "reusable-framework reset verification is source-only"],
]);

const portablePlatformFiles = new Set([".github/workflows/ci.yml", ".gitlab-ci.yml"]);

export const generatedProjectDocuments = new Set(generatedProjectDocumentPaths);

export const defaultUntrackedPortableContractFiles = new Set(["mise.lock", "mise.toml"]);

export { requiredPortableContractFiles };

function sourceOnlyPathReason(relativePath) {
  for (const [excludedPath, reason] of sourceOnlyPathReasons) {
    if (relativePath === excludedPath || relativePath.startsWith(excludedPath + "/")) return reason;
  }
  return null;
}

export function projectTransferExclusionReason(relativePath) {
  if (relativePath.startsWith(".github/") && !portablePlatformFiles.has(relativePath)) {
    return "provider-specific GitHub collaboration metadata is source-only";
  }
  if (relativePath.startsWith(".gitlab/")) {
    return "provider-specific GitLab collaboration metadata is source-only";
  }
  const sourceOnlyReason = sourceOnlyPathReason(relativePath);
  if (sourceOnlyReason) return sourceOnlyReason;
  const snapshotReason = nonPortableSnapshotPathReason(relativePath);
  if (snapshotReason) return snapshotReason;
  if (isManagedMarkdownPath(relativePath) && !generatedProjectDocuments.has(relativePath)) {
    return "source-only documentation is outside the generated minimal document set";
  }
  return null;
}

export function shouldSkipProjectTransferPath(relativePath) {
  return projectTransferExclusionReason(relativePath) !== null;
}
