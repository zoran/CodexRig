/** Checks the current project's portable entry documents and isolated native state boundary. */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  repositoryCodexHomeGitignoreBehaviorFindings,
  repositoryCodexHomeGitignoreFindings,
} from "../repository/source-inventory.mjs";
export const supportedCodexStartCommand = "bash scripts/setup/start-codex.sh";
export const portableContextContractFiles = Object.freeze([
  ".codex/agents/default.toml",
  ".codex/agents/explorer.toml",
  ".codex/agents/worker.toml",
  ".codex/config.toml",
  ".codex/hooks.json",
  ".codex/tooling.json",
  ".codex/toolchain.json",
  ".codex/verification.json",
  ".codex/README.md",
  ".gitignore",
  "AGENTS.md",
  "README.md",
  "docs/future-modules.md",
  "docs/project.md",
  "instructions.md",
  "package.json",
  "scripts/setup/start-codex.sh",
]);
export function portableContextContractFindings({ repositoryRoot }) {
  const findings = [];
  for (const relativePath of portableContextContractFiles) {
    const absolutePath = path.join(repositoryRoot, ...relativePath.split("/"));
    if (!existsSync(absolutePath)) {
      findings.push(`portable context contract is missing ${relativePath}`);
      continue;
    }
    const stats = lstatSync(absolutePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      findings.push(`portable context contract requires a regular file: ${relativePath}`);
      continue;
    }
  }

  const packagePath = path.join(repositoryRoot, "package.json");
  if (existsSync(packagePath) && lstatSync(packagePath).isFile()) {
    try {
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
      for (const [name, command] of [
        ["handover:create", "node scripts/context/critical-budget-handover.mjs create"],
        ["handover:receive", "node scripts/context/critical-budget-handover.mjs receive"],
        ["handover:acknowledge", "node scripts/context/critical-budget-handover.mjs acknowledge"],
        ["goal:new", "node scripts/goals/goal-publication-precondition.mjs"],
      ]) {
        if (packageJson.scripts?.[name] !== command) {
          findings.push(`portable context contract requires package.json script ${name}`);
        }
      }
    } catch {
      findings.push("portable context contract requires valid package.json JSON");
    }
  }
  const gitignorePath = path.join(repositoryRoot, ".gitignore");
  if (existsSync(gitignorePath) && lstatSync(gitignorePath).isFile()) {
    findings.push(
      ...repositoryCodexHomeGitignoreFindings(readFileSync(gitignorePath, "utf8")).map(
        (finding) => `portable context contract ${finding}`,
      ),
      ...repositoryCodexHomeGitignoreBehaviorFindings({ root: repositoryRoot }).map(
        (finding) => `portable context contract ${finding}`,
      ),
    );
  }
  return findings;
}

export function assertPortableContextContract(options) {
  const findings = portableContextContractFindings(options);
  if (findings.length > 0) {
    throw new Error(
      ["Portable context contract failed:", ...findings.map((item) => `- ${item}`)].join("\n"),
    );
  }
}
