/** Projects selected project commands, evidence owners and stable CI; never installs a source updater. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  readProjectToolSelection,
  selectedProjectVerification,
} from "./project-tool-selection.mjs";

export function projectCiProjection(relativePath, source) {
  if (relativePath === ".github/workflows/ci.yml") {
    const job = source.match(/^  verify:\n[\s\S]*?(?=^  [A-Za-z][\w-]*:|$(?![\s\S]))/mu)?.[0];
    if (!job) throw new Error("Source CI needs one reviewed stable verify job.");
    return (
      `# Owns stable project verification in CI.\nname: Project verification\non:\n  push:\n    branches: [main]\n  pull_request:\n  merge_group:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n${job
        .replace(
          /      - name: Check scheduled repository housekeeping and freshness\n        if:[^\n]*\n        run:[^\n]*\n/u,
          "",
        )
        .replaceAll("pnpm framework:doctor", "pnpm tooling:doctor")
        .replace(
          "Validate framework and detected platform contracts",
          "Validate project tools and detected platform",
        )}`.trimEnd() + "\n"
    );
  }
  if (relativePath === ".gitlab-ci.yml") {
    const job = source.match(/^verify:\n[\s\S]*?(?=^[A-Za-z][\w-]*:|$(?![\s\S]))/mu)?.[0];
    if (!job) throw new Error("Source CI needs one reviewed stable verify job.");
    const image = source.match(/^  image:[^\n]+/mu)?.[0]?.trim();
    if (!image) throw new Error("Source CI needs its reviewed stable image.");
    return (
      `# Owns stable project verification in CI.\n${image}\nstages: [verify]\nvariables:\n  NPM_CONFIG_IGNORE_PNPMFILE: "true"\n  PNPM_CONFIG_IGNORE_PNPMFILE: "true"\n  npm_config_ignore_pnpmfile: "true"\n  pnpm_config_ignore_pnpmfile: "true"\nworkflow:\n  rules:\n    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'\n    - if: "$CI_COMMIT_BRANCH"\n${job.replace(/^    - if \[ "\$CI_PIPELINE_SOURCE" = "schedule"[^\n]*\n/mu, "").replaceAll("pnpm framework:doctor", "pnpm tooling:doctor")}`.trimEnd() +
      "\n"
    );
  }
  throw new Error("Unknown project CI adapter.");
}

export function writeSelectedProjectTooling(sourceRoot, targetRoot) {
  writeFileSync(
    path.join(targetRoot, ".codex/tooling.json"),
    projectToolingConfiguration(readFileSync(path.join(sourceRoot, ".codex/tooling.json"), "utf8")),
  );
  const selection = readProjectToolSelection(sourceRoot);
  const verification = JSON.parse(
    readFileSync(path.join(sourceRoot, ".codex/verification.json"), "utf8"),
  );
  writeFileSync(
    path.join(targetRoot, ".codex/verification.json"),
    JSON.stringify(selectedProjectVerification(verification, selection), null, 2) + "\n",
  );
  for (const file of [".github/workflows/ci.yml", ".gitlab-ci.yml"])
    writeFileSync(
      path.join(targetRoot, file),
      projectCiProjection(file, readFileSync(path.join(sourceRoot, file), "utf8")),
    );
}

/** New products always require their four typed configuration owners. */
export function projectToolingConfiguration(content) {
  return (
    JSON.stringify({ ...JSON.parse(content), productConfigurationRequired: true }, null, 2) + "\n"
  );
}
