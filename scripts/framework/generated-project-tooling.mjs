/** Projects selected project commands, evidence owners and tooling configuration; never installs a source updater. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  readProjectToolSelection,
  selectedProjectVerification,
} from "./project-tool-selection.mjs";

export function writeSelectedProjectTooling(sourceRoot, targetRoot, projectName) {
  writeFileSync(
    path.join(targetRoot, ".codex/tooling.json"),
    projectToolingConfiguration(
      readFileSync(path.join(sourceRoot, ".codex/tooling.json"), "utf8"),
      projectName,
    ),
  );
  const selection = readProjectToolSelection(sourceRoot);
  const verification = JSON.parse(
    readFileSync(path.join(sourceRoot, ".codex/verification.json"), "utf8"),
  );
  writeFileSync(
    path.join(targetRoot, ".codex/verification.json"),
    JSON.stringify(selectedProjectVerification(verification, selection), null, 2) + "\n",
  );
}

/** New products always require their four typed configuration owners. */
export function projectToolingConfiguration(content, displayName) {
  const configuration = JSON.parse(content);
  return (
    JSON.stringify(
      {
        ...configuration,
        startup: {
          ...configuration.startup,
          displayName: displayName ?? configuration.startup.displayName,
        },
        productConfigurationRequired: true,
      },
      null,
      2,
    ) + "\n"
  );
}
