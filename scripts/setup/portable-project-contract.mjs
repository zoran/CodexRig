import { portableContextContractFiles } from "../context/portable-context-contract.mjs";
import { isRepositoryProcessArtifactPath, projectContextPath } from "../docs/document-scope.mjs";

export const requiredPortableContractFiles = new Set([
  ...portableContextContractFiles,
  "mise.lock",
  "mise.toml",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/context/portable-context-contract.mjs",
  "scripts/deps/install-compatible.mjs",
  "scripts/deps/dependency-owner-normalization.test.mjs",
  "scripts/git-hooks/pre-push",
  "scripts/repository/product-roots.mjs",
  "scripts/repository/product-roots.test.mjs",
  "scripts/setup/codex-launcher.test.mjs",
  "scripts/setup/install-git-hooks.mjs",
  "scripts/setup/install-git-hooks.sh",
  "scripts/setup/portable-project-contract.mjs",
  "scripts/setup/resolve-git-hooks-path.mjs",
  "scripts/setup/setup-regression-fixtures.mjs",
  "scripts/setup/stage-project-export.mjs",
  "scripts/setup/validate-staged-project.mjs",
  "scripts/verify/format-project.mjs",
  "scripts/web/update-sitemap-lastmod.test.mjs",
]);

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
