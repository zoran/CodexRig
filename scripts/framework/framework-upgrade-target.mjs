/** Owns current-contract target validation for framework upgrades. */
import {
  readFrameworkContract,
  readInstallationReceipt,
} from "../contracts/framework-contract.mjs";
import { readPolicyProjection } from "./policy-projection.mjs";

/** Reads one installed child through only the current framework, receipt, and policy schemas. */
export function readFrameworkUpgradeTargetState(root) {
  const contract = readFrameworkContract(root);
  const receipt = readInstallationReceipt(root, contract);
  const policyProjection = readPolicyProjection(root);
  if (
    receipt.frameworkId !== contract.frameworkId ||
    receipt.frameworkVersion !== contract.frameworkVersion
  ) {
    throw new Error("Framework upgrade target contract and receipt identity do not match.");
  }
  return Object.freeze({ contract, policyProjection, receipt });
}
