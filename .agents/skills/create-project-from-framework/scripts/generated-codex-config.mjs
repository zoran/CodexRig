import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function enableGeneratedProjectMemories(targetRoot) {
  const configPath = path.join(targetRoot, ".codex", "config.toml");
  const config = readFileSync(configPath, "utf8");
  const disabledAssignments = config.match(/^memories\s*=\s*false\s*$/gmu) ?? [];
  if (disabledAssignments.length !== 1 || /^memories\s*=\s*true\s*$/mu.test(config)) {
    throw new Error(
      "Source portable config must contain exactly one disabled memories assignment.",
    );
  }
  writeFileSync(configPath, config.replace(/^memories\s*=\s*false\s*$/mu, "memories = true"));
}
