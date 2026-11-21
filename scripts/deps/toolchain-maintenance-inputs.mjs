/** Owns toolchain maintenance input projection for shared host tools and package-manager selection. */
import { inputRecord, readOptionalFile } from "../deps/dependency-inputs.mjs";
import { serializeCanonicalJson } from "../filesystem/repository-files.mjs";
import { validateMinimalMiseTools } from "../contracts/mise-toolchain-configuration.mjs";
import { pnpmGraphPaths } from "./pnpm-toolchain-graph.mjs";

export const toolchainConfigurationPaths = [
  ".codex/toolchain.json",
  ".codex/mise.toml",
  ".codex/mise.lock",
  ...pnpmGraphPaths,
];

/** Captures project-local toolchain inputs before an atomic maintenance transaction. */
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

/** Projects reviewed tool versions and archive digests while retaining project-specific tool pins. */
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
  return projected;
}
