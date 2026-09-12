/** Owns coherent toolchain projections and the narrow installed package-manager receipt update. */
import { inputRecord, readOptionalFile } from "../deps/dependency-inputs.mjs";
import {
  readFrameworkContract,
  readInstallationReceipt,
  serializeCanonicalJson,
} from "../contracts/framework-contract.mjs";
import { validateMinimalMiseTools } from "../contracts/mise-toolchain-configuration.mjs";

export const toolchainConfigurationPaths = [
  ".codexrig/compatibility.json",
  "mise.toml",
  "mise.lock",
  ".github/workflows/ci.yml",
  ".gitlab-ci.yml",
];

/** Requires the current project-owned toolchain contract before independently updating a child. */
export function toolchainMaintenanceInputs(root) {
  const contract = readFrameworkContract(root);
  for (const relativePath of toolchainConfigurationPaths) {
    if (!contract.upgrade.projectOwnedDocuments.includes(relativePath))
      throw new Error(
        "Regenerate or upgrade this installation before automatic toolchain maintenance.",
      );
  }
  const paths = [
    ...toolchainConfigurationPaths,
    ".codexrig/framework.json",
    contract.upgrade.receiptFile,
  ];
  const records = paths.map((relativePath) => inputRecord(root, relativePath));
  const contents = Object.fromEntries(
    paths.map((relativePath) => [relativePath, readOptionalFile(root, relativePath).content]),
  );
  for (const relativePath of toolchainConfigurationPaths)
    if (contents[relativePath] === null)
      throw new Error(`Missing toolchain input: ${relativePath}.`);
  const mise = validateMinimalMiseTools(contents["mise.toml"]);
  if (mise.errors.length > 0 || Object.keys(mise.versions).sort().join(",") !== "node,pnpm")
    throw new Error(
      "Automatic harness maintenance requires the declarative Node.js/pnpm-only mise configuration; reconcile custom tool execution first.",
    );
  const receipt = readInstallationReceipt(root, contract, { optional: true });
  if (receipt?.pendingReconciliation)
    throw new Error(
      "Complete framework policy reconciliation before automatic toolchain maintenance.",
    );
  return { contract, contents, records, receipt };
}

/** Changes only tool versions, archive digests and stable CI pins; keeps project CI behavior. */
export function projectToolchainConfiguration(contents, current, candidate) {
  const projected = { ...contents };
  projected[".codexrig/compatibility.json"] = serializeCanonicalJson(candidate);
  for (const tool of ["node", "pnpm"]) {
    const before = current.stable[tool].version;
    const after = candidate.stable[tool].version;
    const pattern = new RegExp(`^${tool}\\s*=\\s*"${before.replaceAll(".", "\\.")}"\\s*$`, "mu");
    if (!pattern.test(projected["mise.toml"]))
      throw new Error(`mise.toml ${tool} drift must be reconciled before maintenance.`);
    projected["mise.toml"] = projected["mise.toml"].replace(pattern, `${tool} = "${after}"`);
  }
  const replacements = [
    [current.stable.node.version, candidate.stable.node.version],
    [current.stable.pnpm.version, candidate.stable.pnpm.version],
    [current.ci.codexVersion, candidate.ci.codexVersion],
    [current.ci.miseVersion, candidate.ci.miseVersion],
    [current.ci.codexNpmPackageIntegrity, candidate.ci.codexNpmPackageIntegrity],
    [current.ci.miseLinuxX64Sha256, candidate.ci.miseLinuxX64Sha256],
    ...["x64", "arm64"].flatMap((architecture) => [
      [
        current.ci.codexNpmPlatformIntegrities[architecture],
        candidate.ci.codexNpmPlatformIntegrities[architecture],
      ],
      [
        current.ci.miseNpmPackageIntegrities[architecture],
        candidate.ci.miseNpmPackageIntegrities[architecture],
      ],
    ]),
  ];
  // Simultaneous replacement cannot cascade when one tool's next version equals another's old pin.
  const changes = new Map(replacements.filter(([before, after]) => before !== after));
  if (changes.size) {
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const pattern = new RegExp(
      `(?<![A-Za-z0-9.])(?:${[...changes.keys()]
        .sort((a, b) => b.length - a.length)
        .map(escape)
        .join("|")})(?![A-Za-z0-9.])`,
      "gu",
    );
    for (const relativePath of [".github/workflows/ci.yml", ".gitlab-ci.yml"])
      projected[relativePath] = projected[relativePath].replace(pattern, (value) =>
        changes.get(value),
      );
  }
  return projected;
}

/** Preserves every installation proof except the package manager explicitly owned by maintenance. */
export function receiptWithMaintainedPackageManager(receipt, packageManager) {
  if (!receipt) return null;
  const result = structuredClone(receipt);
  result.installedPackage.packageManager = packageManager;
  result.managedPackage.packageManager = packageManager;
  return serializeCanonicalJson(result);
}
