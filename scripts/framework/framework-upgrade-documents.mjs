/** Owns preserved local document discovery and input binding for framework upgrade planning. */
import { projectDocumentOwners } from "../docs/project-document-owners.mjs";
import { targetUpgradeFileState } from "./framework-upgrade-io.mjs";

/** Declared owners are preserved inputs, never inferred prose migrations or managed-copy targets. */
export function planUpgradeDocuments({ target, receipt, changes, targetInputSnapshots }) {
  const documentOwners = projectDocumentOwners({ root: target });
  if (documentOwners.findings.length) {
    throw new Error(
      `Resolve documentation ownership before upgrade: ${documentOwners.findings.join("; ")}`,
    );
  }
  const ownerPaths = [...new Set(documentOwners.entries.map((entry) => entry.path))].sort();
  const managedOwnerConflicts = ownerPaths.filter(
    (relativePath) => receipt.managedFiles[relativePath],
  );
  if (managedOwnerConflicts.length) {
    throw new Error(
      `Documentation owner conflicts with installed managed files: ${managedOwnerConflicts.join(", ")}`,
    );
  }
  const policyChanges = changes.map((change) => ({
    ...change,
    documents: change.documents.includes("docs/project.md")
      ? [...new Set([...change.documents, ...ownerPaths])].sort()
      : change.documents,
  }));
  for (const relativePath of [...new Set(["docs/project.md", ...ownerPaths])]) {
    const state = targetUpgradeFileState(target, relativePath);
    if (state.exists)
      targetInputSnapshots[relativePath] = { mode: state.mode, sha256: state.sha256 };
  }

  return { ownerPaths, policyChanges };
}
