/** Owns durable installation-receipt publication for generated and upgraded framework installations. */
import {
  buildInstallationReceipt,
  readFrameworkContract,
  resolveFrameworkPath,
  serializeCanonicalJson,
} from "../contracts/framework-contract.mjs";
import { atomicWriteOwnedFile } from "../filesystem/owned-file-operations.mjs";

export function writeInstallationReceipt({
  root,
  contract = readFrameworkContract(root),
  managedPaths,
}) {
  const receipt = buildInstallationReceipt({ root, contract, managedPaths });
  atomicWriteOwnedFile(
    root,
    resolveFrameworkPath(root, contract.upgrade.receiptFile),
    serializeCanonicalJson(receipt),
    0o644,
    { label: "framework installation receipt" },
  );
  return receipt;
}
