#!/usr/bin/env node
/** Diagnoses source release, distribution and licensing while product tools use their own doctor. */
import process from "node:process";
import { fileURLToPath } from "node:url";
import { toolingRoot, readRepositoryFile } from "../filesystem/repository-files.mjs";
import {
  readFrameworkContract,
  readCompatibilityMatrix,
} from "../contracts/framework-contract.mjs";
import { readProjectToolSelection } from "./project-tool-selection.mjs";
import { licensingFindings } from "../verify/licensing.mjs";
import { diagnoseTooling } from "../setup/tooling-doctor.mjs";
export async function diagnoseFramework(options = {}) {
  const root = options.root ?? toolingRoot;
  const result = await diagnoseTooling({ ...options, root });
  try {
    const contract = readFrameworkContract(root);
    readCompatibilityMatrix(root, contract);
    readProjectToolSelection(root);
    for (const message of licensingFindings({ root }))
      result.errors.push({ code: "source.license", message });
    const pkg = JSON.parse(readRepositoryFile(root, "package.json"));
    if (pkg.version !== contract.frameworkVersion)
      result.errors.push({
        code: "owner.framework-version.drift",
        message: "Source package version does not match the framework contract version.",
      });
  } catch (error) {
    result.errors.push({ code: "contract.invalid", message: error.message });
  }
  return result;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  if (args.some((value) => !["--json", "--online", "--help"].includes(value)))
    throw new Error("Unknown source doctor option.");
  const result = await diagnoseFramework({ online: args.includes("--online") });
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    for (const item of result.warnings) console.warn(`Warning [${item.code}]: ${item.message}`);
    for (const item of result.errors) console.error(`Error [${item.code}]: ${item.message}`);
    if (!result.errors.length) console.log("Source framework doctor passed.");
  }
  if (result.errors.length) process.exitCode = 1;
}
