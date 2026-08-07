import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { listPortableTransferFiles } from "../../../../scripts/repository/source-inventory.mjs";
import {
  listManagedFrameworkFiles,
  readFrameworkContract,
  writeInstallationReceipt,
} from "../../../../scripts/framework/framework-contract.mjs";
import {
  captureStableRepositoryFileIdentity,
  copyStableRepositoryFile,
} from "../../../../scripts/repository/stable-file-snapshot.mjs";
import { assertPortableProjectContract } from "../../../../scripts/setup/portable-project-contract.mjs";
import { fail } from "./project-options.mjs";
import {
  defaultUntrackedPortableContractFiles,
  requiredPortableContractFiles,
  shouldSkipProjectTransferPath,
} from "./project-transfer-policy.mjs";

export function copyPortableProjectTree(sourceRoot, targetRoot, { includeUntracked }) {
  mkdirSync(targetRoot, { recursive: true });
  const transferFiles = new Set(listPortableTransferFiles({ root: sourceRoot, includeUntracked }));
  for (const relativePath of defaultUntrackedPortableContractFiles) {
    if (existsSync(path.join(sourceRoot, relativePath))) transferFiles.add(relativePath);
  }
  const missingContracts = [...requiredPortableContractFiles].filter(
    (relativePath) => !existsSync(path.join(sourceRoot, relativePath)),
  );
  if (missingContracts.length > 0) {
    fail(`Source is missing required portable contract files: ${missingContracts.join(", ")}`);
  }
  const unpublishedContracts = [...requiredPortableContractFiles].filter(
    (relativePath) => !transferFiles.has(relativePath),
  );
  if (unpublishedContracts.length > 0) {
    fail(
      `Required portable contract files are untracked or ignored; commit them or use --include-untracked: ${unpublishedContracts.join(", ")}`,
    );
  }
  assertPortableProjectContract([...transferFiles]);
  const entries = [...transferFiles]
    .sort()
    .filter((relativePath) => !shouldSkipProjectTransferPath(relativePath))
    .map((relativePath) => ({
      relativePath,
      ...captureStableRepositoryFileIdentity({ repositoryRoot: sourceRoot, relativePath }),
    }));
  assertPortableProjectContract(entries.map((entry) => entry.relativePath));
  for (const entry of entries) {
    const targetPath = path.join(targetRoot, ...entry.relativePath.split("/"));
    mkdirSync(path.dirname(targetPath), { recursive: true });
    copyStableRepositoryFile({
      repositoryRoot: sourceRoot,
      relativePath: entry.relativePath,
      targetRoot,
      expectedIdentity: entry.identity,
    });
  }
}

export function recordGeneratedFrameworkInstallation(sourceRoot, targetRoot) {
  writeInstallationReceipt({
    contract: readFrameworkContract(targetRoot),
    managedPaths: listManagedFrameworkFiles(sourceRoot, readFrameworkContract(sourceRoot)),
    root: targetRoot,
  });
}
