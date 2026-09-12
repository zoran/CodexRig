/** Owns framework upgrade receipt behavior for the framework lifecycle and child upgrade boundary. */
import {
  buildInstallationReceipt,
  readFrameworkContract,
} from "../contracts/framework-contract.mjs";

export function buildUpgradedReceipt({ pendingReconciliation, sourceSnapshot, targetRoot }) {
  const installedContract = readFrameworkContract(targetRoot);
  if (installedContract.frameworkVersion !== sourceSnapshot.frameworkVersion) {
    throw new Error("Installed framework contract does not match the planned source snapshot.");
  }
  const receipt = buildInstallationReceipt({
    contract: installedContract,
    managedPaths: Object.keys(sourceSnapshot.managedFiles),
    root: targetRoot,
  });
  receipt.managedFiles = structuredClone(sourceSnapshot.managedFiles);
  receipt.managedPackage = structuredClone(sourceSnapshot.managedPackage);
  if (
    installedContract.upgrade.projectOwnedDocuments.includes(installedContract.compatibilityFile)
  ) {
    receipt.managedPackage.packageManager = receipt.installedPackage.packageManager;
  }
  receipt.pendingReconciliation = pendingReconciliation
    ? structuredClone(pendingReconciliation)
    : null;
  return { installedContract, receipt };
}
