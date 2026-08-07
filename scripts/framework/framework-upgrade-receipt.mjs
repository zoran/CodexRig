import { buildInstallationReceipt, readFrameworkContract } from "./framework-contract.mjs";

export function buildUpgradedReceipt({ sourceSnapshot, targetRoot }) {
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
  return { installedContract, receipt };
}
