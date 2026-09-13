/** Owns project copy behavior for the portable clean-project generation boundary. */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { listRepositoryPathInventory } from "../repository/source-inventory.mjs";
import { readProjectToolSelection } from "./project-tool-selection.mjs";
import {
  captureStableRepositoryFileIdentity,
  copyStableRepositoryFile,
} from "../repository/stable-file-snapshot.mjs";
import { assertPortableProjectContract } from "./portable-project-contract.mjs";
import { fail } from "./project-options.mjs";
import {
  defaultUntrackedPortableContractFiles,
  projectTransferExclusionReason,
  requiredPortableContractFiles,
} from "./project-transfer-policy.mjs";

export function capturePortableProjectTransferManifest(sourceRoot, { includeUntracked }) {
  const selection = readProjectToolSelection(sourceRoot);
  const transferFiles = new Set(
    listRepositoryPathInventory({ root: sourceRoot, includeUntracked }).paths,
  );
  for (const relativePath of defaultUntrackedPortableContractFiles) {
    if (existsSync(path.join(sourceRoot, relativePath))) transferFiles.add(relativePath);
  }
  const missingContracts = selection.files.filter(
    (relativePath) => !existsSync(path.join(sourceRoot, relativePath)),
  );
  if (missingContracts.length > 0) {
    fail(`Source is missing required portable contract files: ${missingContracts.join(", ")}`);
  }
  const unpublishedContracts = selection.files.filter(
    (relativePath) => !transferFiles.has(relativePath),
  );
  if (unpublishedContracts.length > 0) {
    fail(
      `Required portable contract files are untracked or ignored; commit them or use --include-untracked: ${unpublishedContracts.join(", ")}`,
    );
  }
  const classifiedEntries = [...transferFiles].sort().map((relativePath) => ({
    exclusionReason: projectTransferExclusionReason(relativePath, { selection }),
    relativePath,
  }));
  const files = classifiedEntries
    .filter(({ exclusionReason }) => exclusionReason === null)
    .map(({ relativePath }) => ({
      relativePath,
      ...captureStableRepositoryFileIdentity({ repositoryRoot: sourceRoot, relativePath }),
    }));
  assertPortableProjectContract(files.map((entry) => entry.relativePath));
  return {
    excluded: classifiedEntries.filter(({ exclusionReason }) => exclusionReason !== null),
    files,
  };
}

export function copyPortableProjectTree(sourceRoot, targetRoot, { includeUntracked }) {
  mkdirSync(targetRoot, { recursive: true });
  const transferManifest = capturePortableProjectTransferManifest(sourceRoot, {
    includeUntracked,
  });
  for (const entry of transferManifest.files) {
    const targetPath = path.join(targetRoot, ...entry.relativePath.split("/"));
    mkdirSync(path.dirname(targetPath), { recursive: true });
    copyStableRepositoryFile({
      repositoryRoot: sourceRoot,
      relativePath: entry.relativePath,
      targetRoot,
      expectedIdentity: entry.identity,
    });
  }
  return transferManifest;
}
