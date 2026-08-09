import { frameworkRoot, readFrameworkContract } from "../framework/framework-contract.mjs";

const generatedDocumentPaths = [
  "AGENTS.md",
  "README.md",
  "docs/context-index.md",
  "docs/project.md",
  "instructions.md",
];

export const generatedProjectDocumentPaths = Object.freeze(generatedDocumentPaths);

export const projectOwnedUpgradeDocumentPaths = Object.freeze([
  ...readFrameworkContract(frameworkRoot).upgrade.projectOwnedDocuments,
]);

const projectOwnedUpgradeDocumentPathSet = new Set(projectOwnedUpgradeDocumentPaths);

for (const relativePath of [".codex/README.md", ...generatedDocumentPaths]) {
  if (!projectOwnedUpgradeDocumentPathSet.has(relativePath)) {
    throw new Error(`Framework contract must classify ${relativePath} as project-owned.`);
  }
}

export function isProjectOwnedUpgradeDocumentPath(relativePath) {
  return projectOwnedUpgradeDocumentPathSet.has(relativePath);
}
