/** Owns portable project contract behavior for the setup, launch, and portable project boundary. */
import { portableContextContractFiles } from "../context/portable-context-contract.mjs";
import { isRepositoryProcessArtifactPath, projectContextPath } from "../docs/document-scope.mjs";

export const requiredPortableContractFiles = new Set([
  ...portableContextContractFiles,
  "LICENSE",
  "NOTICE",
  "mise.lock",
  "mise.toml",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/context/context-regression-helpers.mjs",
  "scripts/context/portable-context-contract.mjs",
  "scripts/contracts/compatibility-contract.mjs",
  "scripts/contracts/delivery-configuration.mjs",
  "scripts/contracts/localization-configuration.mjs",
  "scripts/contracts/mise-toolchain-configuration.mjs",
  "scripts/contracts/product-configuration.mjs",
  "scripts/contracts/semver-contract.mjs",
  "scripts/contracts/tenancy-configuration.mjs",
  "scripts/filesystem/owned-file-operations.mjs",
  "scripts/filesystem/owned-path-safety.mjs",
  "scripts/deps/dependency-inputs.mjs",
  "scripts/deps/dependency-plan.mjs",
  "scripts/deps/dependency-policy.mjs",
  "scripts/deps/dependency-transaction-state.mjs",
  "scripts/deps/dependency-transaction.mjs",
  "scripts/deps/install-compatible.mjs",
  "scripts/framework/maintain-toolchain.mjs",
  "scripts/framework/toolchain-maintenance-inputs.mjs",
  "scripts/framework/toolchain-releases.mjs",
  "scripts/framework/toolchain-maintenance.test.mjs",
  "scripts/deps/trusted-pnpm-command.mjs",
  "scripts/deps/update.mjs",
  "scripts/deps/verify-pnpm-execution-policy.mjs",
  "scripts/deps/dependency-owner-normalization.test.mjs",
  "scripts/docs/delivery-manifest.mjs",
  "scripts/docs/project-document-policy.mjs",
  "scripts/git-hooks/pre-push",
  "scripts/goals/repository-housekeeping.mjs",
  "scripts/repository/repository-housekeeping-files.mjs",
  "scripts/repository/repository-housekeeping-transaction.mjs",
  "scripts/goals/repository-housekeeping.test.mjs",
  "scripts/framework/framework-upgrade-target.mjs",
  "scripts/framework/framework-upgrade-package.mjs",
  "scripts/framework/framework-version.mjs",
  "scripts/framework/framework-version.test.mjs",
  "scripts/repository/delivery-environment-discovery.mjs",
  "scripts/repository/local-import-resolution.mjs",
  "scripts/repository/pnpm-workspace-manifests.mjs",
  "scripts/repository/product-roots.mjs",
  "scripts/repository/product-roots.test.mjs",
  "scripts/repository/runtime-lifecycle-mutex.mjs",
  "scripts/repository/runtime-lifecycle-process.mjs",
  "scripts/repository/runtime-lifecycle-schema.mjs",
  "scripts/repository/runtime-owned-state.mjs",
  "scripts/repository/runtime-process-identity.mjs",
  "scripts/repository/runtime-process-io.mjs",
  "scripts/repository/runtime-session-lease.mjs",
  "scripts/repository/runtime-session-state.mjs",
  "scripts/repository/source-import-specifiers.mjs",
  "scripts/setup/codex-launcher.test.mjs",
  "scripts/setup/install-git-hooks.mjs",
  "scripts/setup/install-git-hooks.sh",
  "scripts/setup/portable-project-contract.mjs",
  "scripts/setup/resolve-git-hooks-path.mjs",
  "scripts/setup/setup-regression-fixtures.mjs",
  "scripts/setup/stage-project-export.mjs",
  "scripts/setup/startup-executable-closure.mjs",
  "scripts/setup/validate-codex-model-policy.mjs",
  "scripts/setup/validate-staged-project.mjs",
  "scripts/stack/stack-detector.mjs",
  "scripts/verify/a11y.mjs",
  "scripts/verify/delivery-artifact.mjs",
  "scripts/verify/delivery-environments.mjs",
  "scripts/verify/format-project.mjs",
  "scripts/verify/identity-access.mjs",
  "scripts/verify/localization.mjs",
  "scripts/verify/localization.test.mjs",
  "scripts/verify/licensing.mjs",
  "scripts/verify/licensing.test.mjs",
  "scripts/verify/repository-smoke-inventory.mjs",
  "scripts/verify/source-evidence.mjs",
  "scripts/verify/tenant-isolation.mjs",
  "scripts/verify/verification-admission-commands.mjs",
  "scripts/verify/verification-admission-decision.mjs",
  "scripts/verify/verification-admission-registry.mjs",
  "scripts/verify/responsive.mjs",
  "scripts/verify/seo.mjs",
  "scripts/verify/stack-standards.mjs",
  "scripts/verify/api-security.test.mjs",
  "scripts/verify/web-stack.mjs",
  "scripts/verify/white-label.mjs",
  "scripts/verify/white-label.test.mjs",
  "scripts/web/sitemap-files.mjs",
  "scripts/web/sitemap-metadata.mjs",
  "scripts/web/update-sitemap-lastmod.mjs",
  "scripts/web/update-sitemap-lastmod.test.mjs",
  "scripts/web/web-quality-scan.mjs",
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
