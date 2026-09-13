/** Classifies source paths against the explicit project capability selection. */
import { generatedProjectDocumentPaths } from "../docs/project-document-policy.mjs";
import { readProjectToolSelection } from "./project-tool-selection.mjs";
import {
  nonPortableSnapshotPathReason,
  requiredPortableContractFiles,
} from "./portable-project-contract.mjs";
export const generatedProjectDocuments = new Set(generatedProjectDocumentPaths);
export const defaultUntrackedPortableContractFiles = new Set(["mise.lock", "mise.toml"]);
export { requiredPortableContractFiles };
export function projectTransferExclusionReason(
  relativePath,
  { selection = readProjectToolSelection() } = {},
) {
  return (
    nonPortableSnapshotPathReason(relativePath) ??
    (selection.files.includes(relativePath)
      ? null
      : "source file has no selected project capability or consumer")
  );
}
export function shouldSkipProjectTransferPath(relativePath) {
  return projectTransferExclusionReason(relativePath) !== null;
}
