import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  repositoryCodexHomeGitignoreBehaviorFindings,
  repositoryCodexHomeGitignoreFindings,
} from "../repository/source-inventory.mjs";
import { portableRequiredContent } from "./portable-context-required-content.mjs";

export const supportedCodexStartCommand = "bash scripts/setup/start-codex.sh";

export const portableContextContractFiles = Object.freeze([
  ".agents/skills/context-retrieval/SKILL.md",
  ".agents/skills/context-retrieval/agents/openai.yaml",
  ".agents/skills/project-implementation/SKILL.md",
  ".agents/skills/resume-project/SKILL.md",
  ".agents/skills/task-quality/SKILL.md",
  ".codex/agents/default.toml",
  ".codex/agents/explorer.toml",
  ".codex/agents/worker.toml",
  ".codex/config.toml",
  ".codex/hooks.json",
  ".codex/README.md",
  ".codexrig/compatibility.json",
  ".codexrig/framework.json",
  ".codexrig/policy-projection.json",
  ".github/workflows/ci.yml",
  ".gitlab-ci.yml",
  ".gitignore",
  "AGENTS.md",
  "README.md",
  "docs/context-index.md",
  "docs/project.md",
  "instructions.md",
  "package.json",
  "scripts/context/check-context-index.mjs",
  "scripts/context/clean-context-index.mjs",
  "scripts/context/context-build.mjs",
  "scripts/context/context-database.mjs",
  "scripts/context/context-index-lib.mjs",
  "scripts/context/context-maintenance-safety.mjs",
  "scripts/context/context-maintenance.mjs",
  "scripts/context/context-maintenance.test.mjs",
  "scripts/context/context-lifecycle.test.mjs",
  "scripts/context/context-manifest.mjs",
  "scripts/context/context-publication-policy.mjs",
  "scripts/context/context-storage.mjs",
  "scripts/context/context-worker-output.mjs",
  "scripts/context/index-codebase.mjs",
  "scripts/context/portable-context-contract.mjs",
  "scripts/context/portable-context-contract.test.mjs",
  "scripts/context/portable-context-required-content.mjs",
  "scripts/context/refresh-context-index-on-stop.mjs",
  "scripts/context/refresh-context-index-on-stop.sh",
  "scripts/context/search-context.mjs",
  "scripts/context/source-policy.mjs",
  "scripts/context/terminal-output.mjs",
  "scripts/context/terminal-output.test.mjs",
  "scripts/docs/document-scope.mjs",
  "scripts/framework/compatibility-matrix.mjs",
  "scripts/framework/framework-contract.mjs",
  "scripts/framework/framework-doctor.mjs",
  "scripts/framework/framework-lifecycle.test.mjs",
  "scripts/framework/policy-projection.mjs",
  "scripts/framework/framework-upgrade-io.mjs",
  "scripts/framework/framework-upgrade-journal.mjs",
  "scripts/framework/framework-upgrade-ownership.mjs",
  "scripts/framework/framework-upgrade-receipt.mjs",
  "scripts/framework/framework-upgrade.mjs",
  "scripts/framework/refresh-upgrade-dependencies.mjs",
  "scripts/git-hooks/pre-push",
  "scripts/goals/goal-publication-precondition.mjs",
  "scripts/goals/goal-publication-precondition.test.mjs",
  "scripts/repository/source-inventory.mjs",
  "scripts/repository/source-inventory-policy.mjs",
  "scripts/repository/git-runtime-isolation.mjs",
  "scripts/repository/product-roots.mjs",
  "scripts/repository/sensitive-paths.mjs",
  "scripts/repository/source-inventory-git-environment.test.mjs",
  "scripts/repository/stable-file-snapshot.mjs",
  "scripts/repository/stable-file-snapshot.test.mjs",
  "scripts/repository/validate-transfer-source.mjs",
  "scripts/platform/configure-platform.mjs",
  "scripts/platform/detect-platform.mjs",
  "scripts/platform/git-provider.mjs",
  "scripts/platform/github-platform.mjs",
  "scripts/platform/gitlab-platform.mjs",
  "scripts/platform/platform-api.mjs",
  "scripts/platform/platform-configuration-state.mjs",
  "scripts/platform/platform-lifecycle-harness.mjs",
  "scripts/platform/platform-lifecycle.test.mjs",
  "scripts/setup/check-prereqs.sh",
  "scripts/setup/codex-launcher.test.mjs",
  "scripts/setup/export-project.sh",
  "scripts/setup/install-git-hooks.mjs",
  "scripts/setup/install-git-hooks.sh",
  "scripts/setup/portable-project-contract.mjs",
  "scripts/setup/resolve-git-hooks-path.mjs",
  "scripts/setup/setup-regression-fixtures.mjs",
  "scripts/setup/setup-regression.test.mjs",
  "scripts/setup/staged-project-validator.test.mjs",
  "scripts/setup/start-codex.sh",
  "scripts/setup/startup-attestation.mjs",
  "scripts/setup/stage-project-export.mjs",
  "scripts/setup/validate-staged-project.mjs",
  "scripts/setup/validate-static-module-imports.mjs",
  "scripts/setup/validate-codex-bootstrap.sh",
  "scripts/setup/validate-codex-config.mjs",
  "scripts/setup/verify-startup-attestation-on-session-start.sh",
  "scripts/verify/format-project.mjs",
  "scripts/verify/adaptive.mjs",
  "scripts/verify/adaptive-cli.test.mjs",
  "scripts/verify/adaptive-options.mjs",
  "scripts/verify/verification-admission.mjs",
  "scripts/verify/adaptive-runner.mjs",
  "scripts/verify/adaptive-runner-routing.test.mjs",
  "scripts/verify/adaptive-runner-test-helpers.mjs",
  "scripts/verify/adaptive-runner.test.mjs",
  "scripts/verify/adaptive-state.mjs",
  "scripts/verify/adaptive-surfaces.mjs",
  "scripts/verify/adaptive-surfaces.test.mjs",
  "scripts/verify/git-remote-identity.mjs",
  "scripts/verify/git-remote-identity.test.mjs",
  "scripts/verify/image-assets.mjs",
  "scripts/verify/image-assets.test.mjs",
  "scripts/verify/path-hygiene.mjs",
  "scripts/verify/package-manifest.mjs",
  "scripts/verify/package-manifest.test.mjs",
  "scripts/verify/pre-push.sh",
  "scripts/verify/pre-push-steps.sh",
  "scripts/verify/pre-push.test.mjs",
  "scripts/verify/pushed-object-scan.mjs",
  "scripts/verify/pushed-object-scan.test.mjs",
  "scripts/verify/repository-smoke-content.mjs",
  "scripts/verify/secret-content-scan.mjs",
  "scripts/verify/secret-patterns.mjs",
  "scripts/verify/secrets.mjs",
  "scripts/verify/surface-quality.mjs",
  "scripts/verify/surface-quality.test.mjs",
  "scripts/verify/verification-evidence.mjs",
  "scripts/verify/verification-evidence-error.mjs",
  "scripts/verify/verification-evidence-record.mjs",
  "scripts/verify/verification-evidence-store.mjs",
  "scripts/verify/verification-evidence-integrity.test.mjs",
  "scripts/verify/verification-evidence-test-helpers.mjs",
  "scripts/verify/verification-evidence.test.mjs",
  "scripts/verify/verification-entrypoints.mjs",
  "scripts/verify/verification-executor.mjs",
  "scripts/verify/verification-executor.test.mjs",
  "scripts/verify/verification-git-basis.mjs",
  "scripts/verify/verification-git-basis.test.mjs",
  "scripts/verify/verification-risk-profile.mjs",
  "scripts/verify/verification-record-helpers.mjs",
  "scripts/verify/verification-runtime-identity.mjs",
  "scripts/verify/verification-session-lock.mjs",
  "scripts/verify/verification-session-lock.test.mjs",
  "scripts/verify/workspace-verification.mjs",
]);

const requiredContent = portableRequiredContent(supportedCodexStartCommand);

const exactStartCommandFiles = new Set([
  ".codex/README.md",
  "AGENTS.md",
  "README.md",
  "docs/project.md",
  "instructions.md",
  "scripts/setup/check-prereqs.sh",
]);

const hookMutationContractFiles = new Set([
  ".agents/skills/context-retrieval/SKILL.md",
  ".agents/skills/project-implementation/SKILL.md",
  ".codex/README.md",
  "AGENTS.md",
  "README.md",
  "docs/context-index.md",
  "docs/project.md",
  "instructions.md",
]);

const leadingQualifiedHookScope =
  /(?:\b(?:before|until|prior to)\s+(?:the\s+)?(?:initial\s+)?bootstrap\b|\bpre-bootstrap\b|\bcontext:check\b|\bpre-push\b|\b(?:during|for)\s+(?:normal\s+|ordinary\s+)?verification\b|\bduring\s+pre-push\b|\bafter\s+(?:each|every|an?\s+individual|a\s+single)\s+tool\s+(?:call|invocation)\b)[\s,:-]*$/iu;
const trailingQualifiedHookScope =
  /^[\s,:-]*(?:(?:before|until|prior to)\s+(?:the\s+)?(?:initial\s+)?bootstrap|(?:during|for)\s+(?:normal\s+|ordinary\s+)?verification|during\s+pre-push|after\s+(?:each|every|an?\s+individual|a\s+single)\s+tool\s+(?:call|invocation))\b/iu;
const contradictoryHookIndexContracts = [
  /\b(?:the\s+)?(?:(?:project(?:-local)?|stop)\s+)?hooks?\s+(?:never|will\s+never|will\s+not|do\s+not|does\s+not|must\s+not|cannot)\s+(?:ever\s+)?(?:touch(?:es)?|modif(?:y|ies)|mutat(?:e|es)|write(?:s)?(?:\s+to)?|update(?:s)?|refresh(?:es)?|change(?:s)?)\s+(?:the\s+)?(?:(?:context\s+)?index|`?\.context-index\/?`?)(?![\p{L}\p{N}_])/giu,
  /\b(?:the\s+)?(?:(?:context\s+)?index|`?\.context-index\/?`?)(?![\p{L}\p{N}_])[^.;!?]{0,24}\b(?:never|not)\s+(?:be\s+)?(?:touched|modified|mutated|written(?:\s+to)?|updated|refreshed|changed)\s+by\s+(?:the\s+)?(?:(?:project(?:-local)?|stop)\s+)?hooks?\b/giu,
];

function claimHasQualifiedScope(clause, match) {
  const before = clause.slice(0, match.index);
  const after = clause.slice(match.index + match[0].length);
  return leadingQualifiedHookScope.test(before) || trailingQualifiedHookScope.test(after);
}

export function hasContradictoryStopHookIndexContract(content) {
  const clauses = content.replace(/\s+/g, " ").split(/[.!?;](?:\s+|$)|,?\s+(?:but|however)\s+/iu);
  for (const clause of clauses) {
    for (const pattern of contradictoryHookIndexContracts) {
      for (const match of clause.matchAll(pattern)) {
        if (!claimHasQualifiedScope(clause, match)) return true;
      }
    }
  }
  return false;
}

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
    const content = readFileSync(absolutePath, "utf8");
    if (exactStartCommandFiles.has(relativePath) && !content.includes(supportedCodexStartCommand)) {
      findings.push(
        `portable context contract requires ${relativePath} to include the exact supported Codex start command`,
      );
    }
    const normalizedContent = content.replace(/\s+/g, " ");
    if (
      hookMutationContractFiles.has(relativePath) &&
      hasContradictoryStopHookIndexContract(content)
    ) {
      findings.push(
        `portable context contract rejects a contradictory Stop-hook index contract in ${relativePath}`,
      );
    }
    for (const expected of requiredContent.get(relativePath) ?? []) {
      if (!normalizedContent.toLowerCase().includes(expected.replace(/\s+/g, " ").toLowerCase())) {
        findings.push(`portable context contract requires ${relativePath} to include ${expected}`);
      }
    }
  }
  const contextRuntimeDirectory = path.join(repositoryRoot, "scripts", "context");
  if (existsSync(contextRuntimeDirectory) && lstatSync(contextRuntimeDirectory).isDirectory()) {
    const optimizeMethodPattern = new RegExp(`\\.${["opt", "imize"].join("")}\\s*\\(`, "u");
    for (const entry of readdirSync(contextRuntimeDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".mjs") || entry.name.endsWith(".test.mjs")) {
        continue;
      }
      const relativePath = `scripts/context/${entry.name}`;
      const absolutePath = path.join(contextRuntimeDirectory, entry.name);
      const stats = lstatSync(absolutePath);
      if (stats.isSymbolicLink() || stats.nlink !== 1) {
        findings.push(
          `portable context runtime requires a single-link regular file: ${relativePath}`,
        );
        continue;
      }
      if (optimizeMethodPattern.test(readFileSync(absolutePath, "utf8"))) {
        findings.push(
          `portable context runtime contains unsafe in-place maintenance: ${relativePath}`,
        );
      }
    }
  }
  const packagePath = path.join(repositoryRoot, "package.json");
  if (existsSync(packagePath) && lstatSync(packagePath).isFile()) {
    try {
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
      for (const [name, command] of [
        ["context:check", "node scripts/context/check-context-index.mjs"],
        ["context:clean", "node scripts/context/clean-context-index.mjs"],
        ["context:index", "node scripts/context/index-codebase.mjs"],
        ["context:search", "node scripts/context/search-context.mjs"],
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
