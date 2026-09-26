/** Owns toolchain maintenance input projection for stable tools, CI and package-manager selection. */
import { inputRecord, readOptionalFile } from "../deps/dependency-inputs.mjs";
import { serializeCanonicalJson } from "../filesystem/repository-files.mjs";
import { validateMinimalMiseTools } from "../contracts/mise-toolchain-configuration.mjs";

export const toolchainConfigurationPaths = [
  ".codex/toolchain.json",
  ".codex/mise.toml",
  ".codex/mise.lock",
  ".github/workflows/ci.yml",
  ".gitlab-ci.yml",
];

/** Captures the current local toolchain and CI files before an atomic maintenance transaction. */
export function toolchainMaintenanceInputs(root) {
  const records = toolchainConfigurationPaths.map((relativePath) =>
    inputRecord(root, relativePath),
  );
  const contents = Object.fromEntries(
    toolchainConfigurationPaths.map((relativePath) => [
      relativePath,
      readOptionalFile(root, relativePath).content,
    ]),
  );
  for (const relativePath of toolchainConfigurationPaths)
    if (contents[relativePath] === null)
      throw new Error(`Missing toolchain input: ${relativePath}.`);
  const mise = validateMinimalMiseTools(contents[".codex/mise.toml"]);
  if (mise.errors.length)
    throw new Error(
      "Automatic tooling maintenance requires safe declarative exact mise pins; reconcile custom tool execution first.",
    );
  return { contents, records };
}

/** Changes only tool versions, archive digests and stable CI pins; keeps project CI behavior. */
export function projectToolchainConfiguration(contents, current, candidate) {
  const projected = { ...contents };
  const mise = validateMinimalMiseTools(contents[".codex/mise.toml"]);
  if (mise.errors.length) throw new Error(mise.errors.join("; "));
  projected[".codex/toolchain.json"] = serializeCanonicalJson(candidate);
  for (const tool of ["node", "pnpm"]) {
    const before = current.stable[tool].version;
    const after = candidate.stable[tool].version;
    const pattern = new RegExp(`^${tool}\\s*=\\s*(.+)$`, "mu");
    if (mise.versions[tool] !== before)
      throw new Error(`mise.toml ${tool} drift must be reconciled before maintenance.`);
    const pins = [after, ...mise.versionLists[tool].slice(1)];
    if (new Set(pins).size !== pins.length)
      throw new Error(`mise.toml ${tool} primary update collides with a secondary pin.`);
    projected[".codex/mise.toml"] = projected[".codex/mise.toml"].replace(
      pattern,
      (_, literal) =>
        `${tool} = ${JSON.stringify(Array.isArray(JSON.parse(literal)) ? pins : after)}`,
    );
  }
  const replacements = [
    [current.stable.node.version, candidate.stable.node.version],
    [current.stable.pnpm.version, candidate.stable.pnpm.version],
    [current.ci.codexVersion, candidate.ci.codexVersion],
    [current.ci.miseVersion, candidate.ci.miseVersion],
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
