/** Owns portable project contract behavior for the setup, launch, and portable project boundary. */
import { readProjectToolSelection } from "./project-tool-selection.mjs";
import { isRepositoryProcessArtifactPath, projectContextPath } from "../docs/document-scope.mjs";

export const requiredPortableContractFiles = new Set(readProjectToolSelection().files);

export function nonPortableSnapshotPathReason(relativePath) {
  if (relativePath === projectContextPath) return "temporary project context";
  if (isRepositoryProcessArtifactPath(relativePath)) return "repository process artifact";
  return null;
}

export function portableProjectContractFindings(files) {
  if (!Array.isArray(files) || files.some((item) => typeof item !== "string" || !item)) {
    return ["portable project inventory is invalid"];
  }
  const inventory = new Set(files);
  const findings = [...requiredPortableContractFiles]
    .filter((relativePath) => !inventory.has(relativePath))
    .map((relativePath) => `missing required portable contract: ${relativePath}`);
  for (const relativePath of inventory) {
    const reason = nonPortableSnapshotPathReason(relativePath);
    if (reason) findings.push(`nonportable project path: ${relativePath} (${reason})`);
  }
  return findings.sort();
}

export function assertPortableProjectPaths(files) {
  const findings = files
    .map((relativePath) => {
      const reason = nonPortableSnapshotPathReason(relativePath);
      return reason ? `nonportable project path: ${relativePath} (${reason})` : null;
    })
    .filter(Boolean);
  if (findings.length > 0) {
    throw new Error(
      ["Portable project paths failed:", ...findings.map((item) => `- ${item}`)].join("\n"),
    );
  }
}

export function assertPortableProjectContract(files) {
  const findings = portableProjectContractFindings(files);
  if (findings.length > 0) {
    throw new Error(
      ["Portable project contract failed:", ...findings.map((item) => `- ${item}`)].join("\n"),
    );
  }
}
