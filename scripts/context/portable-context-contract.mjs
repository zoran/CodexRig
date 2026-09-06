/** Owns portable context contract behavior for the portable policy and durable project-context boundary. */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { isProjectOwnedUpgradeDocumentPath } from "../docs/project-document-policy.mjs";
import {
  repositoryCodexHomeGitignoreBehaviorFindings,
  repositoryCodexHomeGitignoreFindings,
} from "../repository/source-inventory.mjs";
import { portableRequiredContent } from "./portable-context-required-content.mjs";

export const supportedCodexStartCommand = "bash scripts/setup/start-codex.sh";

export const portableContextContractFiles = Object.freeze([
  ".agents/skills/architecture-evolution/SKILL.md",
  ".agents/skills/architecture-evolution/agents/openai.yaml",
  ".agents/skills/system-coherence/SKILL.md",
  ".agents/skills/system-coherence/agents/openai.yaml",
  ".agents/skills/ui-ux-review/SKILL.md",
  ".agents/skills/ui-ux-review/agents/openai.yaml",
  ".agents/skills/dependency-maintenance/SKILL.md",
  ".agents/skills/dependency-maintenance/agents/openai.yaml",
  ".agents/skills/generated-image-quality-review/SKILL.md",
  ".agents/skills/generated-image-quality-review/agents/openai.yaml",
  ".agents/skills/native-language-content-review/SKILL.md",
  ".agents/skills/native-language-content-review/agents/openai.yaml",
  ".agents/skills/project-implementation/SKILL.md",
  ".agents/skills/project-implementation/agents/openai.yaml",
  ".agents/skills/resume-project/SKILL.md",
  ".agents/skills/resume-project/agents/openai.yaml",
  ".agents/skills/search-visibility/SKILL.md",
  ".agents/skills/search-visibility/agents/openai.yaml",
  ".agents/skills/security-review/SKILL.md",
  ".agents/skills/security-review/agents/openai.yaml",
  ".agents/skills/task-quality/SKILL.md",
  ".agents/skills/task-quality/agents/openai.yaml",
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
  "docs/future-modules.md",
  "docs/project.md",
  "instructions.md",
  "package.json",
  "scripts/context/context-lifecycle.test.mjs",
  "scripts/context/critical-budget-handover.mjs",
  "scripts/context/project-work-state.mjs",
  "scripts/context/portable-context-contract.mjs",
  "scripts/context/portable-context-contract.test.mjs",
  "scripts/context/portable-context-required-content.mjs",
  "scripts/context/portable-context-required-runtime-content.mjs",
  "scripts/context/session-stop-lifecycle.mjs",
  "scripts/terminal/terminal-output.mjs",
  "scripts/terminal/terminal-output.test.mjs",
  "scripts/docs/document-scope.mjs",
  "scripts/docs/ensure-project-manifest.mjs",
  "scripts/docs/project-document-policy.mjs",
  "scripts/docs/project-manifest-contract.mjs",
  "scripts/docs/project-manifest-contract.test.mjs",
  "scripts/framework/compatibility-matrix.mjs",
  "scripts/contracts/framework-contract.mjs",
  "scripts/contracts/portable-toml.mjs",
  "scripts/framework/framework-doctor.mjs",
  "scripts/framework/framework-installation-receipt.mjs",
  "scripts/framework/framework-lifecycle.test.mjs",
  "scripts/framework/policy-projection.mjs",
  "scripts/framework/framework-upgrade-io.mjs",
  "scripts/framework/framework-upgrade-journal.mjs",
  "scripts/framework/framework-upgrade-ownership.mjs",
  "scripts/framework/framework-upgrade-target.mjs",
  "scripts/framework/framework-upgrade-package.mjs",
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
  "scripts/repository/runtime-session-lease.mjs",
  "scripts/repository/sensitive-paths.mjs",
  "scripts/repository/source-inventory-git-environment.test.mjs",
  "scripts/repository/stable-file-snapshot.mjs",
  "scripts/repository/stable-file-snapshot.test.mjs",
  "scripts/repository/validate-transfer-source.mjs",
  "scripts/repository/worktree-path-reservation.mjs",
  "scripts/repository/worktree-preservation-lock.mjs",
  "scripts/repository/worktree-prune-transaction.mjs",
  "scripts/repository/worktree-recovery.mjs",
  "scripts/repository/worktree-recovery-cli.mjs",
  "scripts/repository/worktree-recovery-output.mjs",
  "scripts/repository/worktree-recovery.test.mjs",
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
  "scripts/setup/session-control-hook-command.mjs",
  "scripts/setup/start-codex.sh",
  "scripts/setup/startup-attestation.mjs",
  "scripts/setup/startup-codex-process.mjs",
  "scripts/setup/startup-runtime-executables.mjs",
  "scripts/setup/startup-session-controller.mjs",
  "scripts/setup/startup-session-controller.test.mjs",
  "scripts/setup/startup-session-context.mjs",
  "scripts/setup/stage-project-export.mjs",
  "scripts/setup/validate-staged-project.mjs",
  "scripts/setup/validate-static-module-imports.mjs",
  "scripts/setup/validate-codex-config.mjs",
  "scripts/verify/docs.mjs",
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
  "scripts/verify/api-security.mjs",
  "scripts/verify/api-security.test.mjs",
  "scripts/verify/git-remote-identity.mjs",
  "scripts/verify/git-remote-identity.test.mjs",
  "scripts/verify/image-assets.mjs",
  "scripts/verify/image-assets.test.mjs",
  "scripts/verify/identity-access.mjs",
  "scripts/verify/tenant-isolation.mjs",
  "scripts/verify/path-hygiene.mjs",
  "scripts/verify/package-manifest.mjs",
  "scripts/verify/package-manifest.test.mjs",
  "scripts/verify/patterns.mjs",
  "scripts/verify/pre-push.sh",
  "scripts/verify/pre-push-steps.sh",
  "scripts/verify/pre-push.test.mjs",
  "scripts/verify/pushed-object-scan.mjs",
  "scripts/verify/pushed-object-scan.test.mjs",
  "scripts/verify/repository-smoke-content.mjs",
  "scripts/verify/secret-content-scan.mjs",
  "scripts/security/secret-patterns.mjs",
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
const portableContextContractFileSet = new Set(portableContextContractFiles);
const inspectedContextContractFiles = new Set([
  ...portableContextContractFiles,
  ...requiredContent.keys(),
]);

const exactStartCommandFiles = new Set([
  ".codex/README.md",
  "AGENTS.md",
  "README.md",
  "instructions.md",
  "scripts/setup/check-prereqs.sh",
]);

function projectDocumentFinding(relativePath, detail) {
  if (!isProjectOwnedUpgradeDocumentPath(relativePath)) return detail;
  return `project-document reconciliation required before verification: ${detail}`;
}

export function portableContextContractFindings({ repositoryRoot }) {
  const findings = [];
  for (const relativePath of inspectedContextContractFiles) {
    const absolutePath = path.join(repositoryRoot, ...relativePath.split("/"));
    if (!existsSync(absolutePath)) {
      if (!portableContextContractFileSet.has(relativePath)) continue;
      findings.push(
        projectDocumentFinding(
          relativePath,
          `portable context contract is missing ${relativePath}`,
        ),
      );
      continue;
    }
    const stats = lstatSync(absolutePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      findings.push(
        projectDocumentFinding(
          relativePath,
          `portable context contract requires a regular file: ${relativePath}`,
        ),
      );
      continue;
    }
    const content = readFileSync(absolutePath, "utf8");
    if (exactStartCommandFiles.has(relativePath) && !content.includes(supportedCodexStartCommand)) {
      findings.push(
        projectDocumentFinding(
          relativePath,
          `portable context contract requires ${relativePath} to include the exact supported Codex start command`,
        ),
      );
    }
    const normalizedContent = content.replace(/\s+/g, " ");
    for (const expected of requiredContent.get(relativePath) ?? []) {
      if (!normalizedContent.toLowerCase().includes(expected.replace(/\s+/g, " ").toLowerCase())) {
        findings.push(
          projectDocumentFinding(
            relativePath,
            `portable context contract requires ${relativePath} to include ${expected}`,
          ),
        );
      }
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
