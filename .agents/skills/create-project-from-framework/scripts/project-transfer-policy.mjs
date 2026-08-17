/** Owns project transfer policy behavior for the portable clean-project generation boundary. */
import { isManagedMarkdownPath } from "../../../../scripts/docs/document-scope.mjs";
import { generatedProjectDocumentPaths } from "../../../../scripts/docs/project-document-policy.mjs";
import { readFrameworkContract } from "../../../../scripts/contracts/framework-contract.mjs";
import {
  nonPortableSnapshotPathReason,
  requiredPortableContractFiles,
} from "../../../../scripts/setup/portable-project-contract.mjs";

const portablePlatformFiles = new Set([".github/workflows/ci.yml", ".gitlab-ci.yml"]);

export const generatedProjectDocuments = new Set(generatedProjectDocumentPaths);

export const defaultUntrackedPortableContractFiles = new Set(["mise.lock", "mise.toml"]);

export { requiredPortableContractFiles };

function sourceOnlyPathReason(relativePath, frameworkContract) {
  for (const [excludedPath, reason] of Object.entries(
    frameworkContract.upgrade.excludedPathReasons,
  )) {
    if (relativePath === excludedPath || relativePath.startsWith(excludedPath + "/")) return reason;
  }
  return null;
}

export function projectTransferExclusionReason(
  relativePath,
  { frameworkContract = readFrameworkContract() } = {},
) {
  if (relativePath.startsWith(".github/") && !portablePlatformFiles.has(relativePath)) {
    return "provider-specific GitHub collaboration metadata is source-only";
  }
  if (relativePath.startsWith(".gitlab/")) {
    return "provider-specific GitLab collaboration metadata is source-only";
  }
  const sourceOnlyReason = sourceOnlyPathReason(relativePath, frameworkContract);
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
