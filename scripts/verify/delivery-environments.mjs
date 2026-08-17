/** Owns delivery environments behavior for the repository verification boundary. */
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deliveryReconciliationPlan } from "../docs/delivery-manifest.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");

export function deliveryEnvironmentFindings({ root = repositoryRoot, relativePaths } = {}) {
  const plan = deliveryReconciliationPlan({ root, relativePaths });
  return [...plan.blockingFindings, ...plan.driftFindings].sort();
}

function main() {
  const findings = deliveryEnvironmentFindings();
  if (findings.length > 0) {
    console.error("Delivery environment inventory verification failed:");
    for (const finding of findings) console.error(`- ${finding}`);
    process.exitCode = 1;
    return;
  }
  console.log("Delivery environment inventory and manifest projection passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main();
