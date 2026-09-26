/** Verifies complete local Mise resolution before a command can fall back to a host runtime. */
import { realpathSync } from "node:fs";
import path from "node:path";
import { validateMinimalMiseTools } from "../contracts/mise-toolchain-configuration.mjs";
import { readRepositoryFile } from "../filesystem/repository-files.mjs";
import { projectToolPaths } from "../repository/project-tool-environment.mjs";
import { spawnSyncWithBoundedIo } from "../repository/runtime-process-io.mjs";

/** Mise can warn and continue after failed resolution even with --locked; require actual installs. */
export function assertInstalledProjectTools({
  root,
  configurationRoot = root,
  miseExecutable,
  environment,
}) {
  const configured = validateMinimalMiseTools(
    readRepositoryFile(configurationRoot, ".codex/mise.toml"),
  );
  if (configured.errors.length)
    throw new Error(`Project tool configuration is invalid: ${configured.errors.join("; ")}.`);
  const result = spawnSyncWithBoundedIo(miseExecutable, ["ls", "--current", "--json", "--locked"], {
    cwd: configurationRoot,
    env: environment,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error("Project runtime inventory failed; run canonical maintenance before retrying.");
  let actual;
  try {
    actual = JSON.parse(result.stdout);
  } catch {
    throw new Error("Project runtime inventory is not valid JSON.");
  }
  const missing = () => {
    throw new Error(
      "Project runtimes are missing or outside their locked local installation; run canonical maintenance. Host fallback is forbidden.",
    );
  };
  if (
    !actual ||
    typeof actual !== "object" ||
    Array.isArray(actual) ||
    Object.keys(actual).sort().join("\n") !== Object.keys(configured.versionLists).sort().join("\n")
  )
    missing();
  for (const [tool, pins] of Object.entries(configured.versionLists)) {
    const entries = actual[tool];
    if (
      !Array.isArray(entries) ||
      entries.length !== pins.length ||
      new Set(entries.map((entry) => entry?.requested_version)).size !== pins.length
    )
      missing();
    const parent = path.join(projectToolPaths(root).data, "mise", "installs", tool);
    for (const pin of pins) {
      const entry = entries.find((entry) => entry?.requested_version === pin);
      if (
        !entry ||
        entry.installed !== true ||
        entry.requested_version !== pin ||
        entry.source?.path !== path.join(configurationRoot, ".codex/mise.toml") ||
        typeof entry.install_path !== "string" ||
        path.dirname(entry.install_path) !== parent
      )
        missing();
      try {
        if (realpathSync.native(entry.install_path) !== entry.install_path) missing();
      } catch {
        missing();
      }
    }
  }
}
