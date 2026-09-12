/** Verifies project initialization behavior for the setup, launch, and portable project boundary. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { supportedCodexStartCommand } from "../context/portable-context-contract.mjs";
import { deliveryConfigurationFindings } from "../contracts/delivery-configuration.mjs";
import { localizationConfigurationFindings } from "../contracts/localization-configuration.mjs";
import { productConfigurationFindings } from "../contracts/product-configuration.mjs";
import { tenancyConfigurationFindings } from "../contracts/tenancy-configuration.mjs";
import { readFrameworkContract } from "../contracts/framework-contract.mjs";
import {
  repositoryCodexHomeGitignoreFindings,
  repositoryCodexHomeRuntimeProbePaths,
} from "../repository/source-inventory.mjs";
import {
  assertGeneratedDependencyFreshnessContract,
  assertGeneratedTaskBranchIntegration,
  assertGeneratedTransferParityContract,
  assertGeneratedWorkflowRuntime,
  cleanupTemporaryRoots,
  gitState,
  isolatedTrackedFrameworkSource,
  provideGeneratedDependenciesForTest,
  readdirNames,
  recordGeneratedVerificationEvidence,
  root,
  runGeneratedGoalGate,
  runProjectGenerator,
  temporaryRoot,
  textFiles,
} from "./project-initialization-test-helpers.mjs";
import { assertGeneratedWorkflowPolicyContract } from "../../.agents/skills/create-project-from-framework/scripts/project-initialization-policy-test-helpers.mjs";

after(cleanupTemporaryRoots);

// Problem: an active primary's bounded work cache prevented constructing a clean generator fixture.
// Contract: fixture selection excludes process state, preserves the source, and retains export gates.
test("clean project initialization removes inherited state and source-specific text", () => {
  const sourceStateBefore = gitState(root);
  const source = isolatedTrackedFrameworkSource("codexrig-source-");
  assert.equal(existsSync(path.join(source, "docs/project-context.md")), false);
  assert.deepEqual(gitState(root), sourceStateBefore);
  const outputParent = temporaryRoot("codexrig-create-");
  const isolatedSourceStateBefore = gitState(source, { includeIgnored: false });
  const result = runProjectGenerator([
    "--name",
    "Generated Isolation Fixture",
    "--directory",
    "generated-isolation-fixture",
    "--source",
    source,
    "--output-parent",
    outputParent,
    "--include-untracked",
  ]);
  assert.equal(result.status, 0, result.stderr);
  for (const localValue of [root, source, outputParent]) {
    assert.equal(`${result.stdout}${result.stderr}`.includes(localValue), false, localValue);
  }
  assert.deepEqual(gitState(root), sourceStateBefore);
  assert.deepEqual(gitState(source, { includeIgnored: false }), isolatedSourceStateBefore);
  assert.match(
    result.stdout,
    /Source framework tracked and portable state remained unchanged and baseline-clean\./,
  );
  assert.match(result.stdout, /active-session cleanup completed; no commit or push was performed/i);
  assert.match(result.stdout, /After ending every Codex\/CodexRig session/);
  assert.match(result.stdout, /pnpm framework:reset --apply/);
  assert.match(result.stdout, /Optional Git publication/);
  assert.match(result.stdout, /pnpm framework:publish --message "<message>"/);

  const generated = path.join(outputParent, "generated-isolation-fixture", "code");
  const generatedAgents = readFileSync(path.join(generated, "AGENTS.md"), "utf8");
  const generatedReadme = readFileSync(path.join(generated, "README.md"), "utf8");
  const generatedCodexReadme = readFileSync(path.join(generated, ".codex", "README.md"), "utf8");
  const generatedInstructions = readFileSync(path.join(generated, "instructions.md"), "utf8");
  // CodexRig's child-maintenance workflow is source-only, not generated product policy.
  assert.match(
    readFileSync(path.join(source, "instructions.md"), "utf8"),
    /## Repository Update Scope/,
  );
  assert.doesNotMatch(generatedInstructions, /## Repository Update Scope/);
  const generatedManifest = readFileSync(path.join(generated, "docs", "project.md"), "utf8");
  const generatedUiReviewSkill = path.join(generated, ".agents/skills/ui-ux-review/SKILL.md");
  const generatedCoherenceSkill = path.join(generated, ".agents/skills/system-coherence/SKILL.md");
  const generatedCoherenceMetadata = path.join(
    generated,
    ".agents/skills/system-coherence/agents/openai.yaml",
  );
  const generatedUiReviewMetadata = path.join(
    generated,
    ".agents/skills/ui-ux-review/agents/openai.yaml",
  );
  assert.ok(
    Buffer.byteLength(generatedAgents, "utf8") <= 24 * 1024,
    `generated AGENTS.md exceeds the 24 KiB bootstrap budget (${Buffer.byteLength(generatedAgents, "utf8")} bytes)`,
  );
  for (const forbidden of [
    ".git",
    ".codex/runtime",
    ".project-state",
    "node_modules",
    ".agents/skills/create-project-from-framework",
    "scripts/setup/project-initialization-boundaries.source.test.mjs",
    "scripts/setup/project-initialization.source.test.mjs",
    "scripts/setup/project-initialization-transfer.source.test.mjs",
  ]) {
    assert.equal(existsSync(path.join(generated, forbidden)), false, forbidden);
  }
  assert.equal(existsSync(path.join(generated, ".github", "workflows", "ci.yml")), true);
  assert.equal(existsSync(path.join(generated, ".gitlab-ci.yml")), true);
  const frameworkReceipt = JSON.parse(
    readFileSync(path.join(generated, ".codexrig", "installation.json"), "utf8"),
  );
  assert.equal(frameworkReceipt.frameworkId, "codexrig");
  assert.equal(frameworkReceipt.frameworkVersion, readFrameworkContract(root).frameworkVersion);
  assert.equal(frameworkReceipt.schemaVersion, 2);
  assert.equal(frameworkReceipt.pendingReconciliation, null);
  assert.equal("config/product.json" in frameworkReceipt.managedFiles, false);
  assert.equal("config/delivery.json" in frameworkReceipt.managedFiles, false);
  assert.equal("config/tenancy.json" in frameworkReceipt.managedFiles, false);
  assert.equal("config/localization.json" in frameworkReceipt.managedFiles, false);
  assert.deepEqual(readdirNames(path.join(generated, ".codex")), [
    "README.md",
    "agents",
    "config.toml",
    "hooks.json",
  ]);
  const sourceCodexConfig = readFileSync(path.join(root, ".codex", "config.toml"), "utf8");
  const generatedCodexConfig = readFileSync(path.join(generated, ".codex", "config.toml"), "utf8");
  assert.match(sourceCodexConfig, /memories = false/);
  assert.equal(
    generatedCodexConfig,
    sourceCodexConfig.replace("memories = false", "memories = true"),
  );
  assert.match(generatedCodexConfig, /memories = true/);
  assert.match(
    generatedCodexConfig,
    /developer_instructions = """[\s\S]*primary orchestrator[\s\S]*pnpm handover:create -- --critical[\s\S]*After a successful seal, stop completely/,
  );
  assert.match(generatedCodexConfig, /never pass a model or\s+reasoning override/);
  const generatedAgentEntries = readdirNames(path.join(generated, ".codex", "agents"));
  for (const requiredAgent of ["default.toml", "explorer.toml", "worker.toml"]) {
    assert.equal(generatedAgentEntries.includes(requiredAgent), true, requiredAgent);
    const roleConfig = readFileSync(
      path.join(generated, ".codex", "agents", requiredAgent),
      "utf8",
    );
    assert.match(roleConfig, /model = "gpt-6-astra"/);
    assert.match(roleConfig, /model_reasoning_effort = "ultra"/);
    assert.match(roleConfig, /critical-drain request/);
    assert.match(roleConfig, /start no further tool or task/);
  }
  assert.deepEqual(readdirNames(path.join(generated, "src")), [".gitkeep"]);
  assert.equal(readFileSync(path.join(generated, "src", ".gitkeep"), "utf8"), "");
  const packageJson = JSON.parse(readFileSync(path.join(generated, "package.json"), "utf8"));
  assert.equal(packageJson.name, "generated-isolation-fixture");
  assert.equal(packageJson.version, "0.1.0");
  const productConfigurationText = readFileSync(
    path.join(generated, "config", "product.json"),
    "utf8",
  );
  const productConfiguration = JSON.parse(productConfigurationText);
  assert.deepEqual(productConfigurationFindings(productConfigurationText), []);
  assert.equal(productConfiguration.identity.displayName, null);
  assert.equal(productConfiguration.identity.organizationName, null);
  assert.deepEqual(productConfiguration.identity.applicationIds, {});
  assert.deepEqual(productConfiguration.brand, { assets: {}, theme: {} });
  assert.deepEqual(productConfiguration.public, {
    contacts: {},
    domains: {},
    social: {},
    urls: {},
  });
  assert.doesNotMatch(productConfigurationText, /Generated Isolation Fixture|CodexRig/iu);
  const deliveryConfigurationText = readFileSync(
    path.join(generated, "config", "delivery.json"),
    "utf8",
  );
  const deliveryConfiguration = JSON.parse(deliveryConfigurationText);
  assert.deepEqual(deliveryConfigurationFindings(deliveryConfigurationText), []);
  assert.equal(deliveryConfiguration.defaultTarget, "dev");
  assert.deepEqual(deliveryConfiguration.declaredTargets, []);
  assert.deepEqual(deliveryConfiguration.detectedTargets, []);
  const tenancyConfigurationText = readFileSync(
    path.join(generated, "config", "tenancy.json"),
    "utf8",
  );
  const tenancyConfiguration = JSON.parse(tenancyConfigurationText);
  assert.deepEqual(tenancyConfigurationFindings(tenancyConfigurationText), []);
  assert.equal(tenancyConfiguration.tenantContext.required, true);
  assert.equal(tenancyConfiguration.tenantContext.resolutionStrategy, "pending");
  assert.deepEqual(tenancyConfiguration.tenantContext.trustedSources, []);
  assert.equal(tenancyConfiguration.crossTenantOperations.default, "forbidden");
  const localizationConfigurationText = readFileSync(
    path.join(generated, "config", "localization.json"),
    "utf8",
  );
  const localizationConfiguration = JSON.parse(localizationConfigurationText);
  assert.deepEqual(localizationConfigurationFindings(localizationConfigurationText), []);
  assert.equal(localizationConfiguration.codeLanguage, "en");
  assert.equal(localizationConfiguration.userFacing.strategy, "pending");
  assert.deepEqual(localizationConfiguration.userFacing.supportedLocales, []);
  assert.equal(
    readFileSync(path.join(generated, "scripts/setup/export-project.sh"), "utf8"),
    readFileSync(path.join(root, "scripts/setup/export-project.sh"), "utf8"),
  );
  assert.equal(
    packageJson.scripts["framework:doctor"],
    "node scripts/framework/framework-doctor.mjs",
  );
  assert.equal(
    packageJson.scripts["framework:version"],
    "node scripts/framework/framework-version.mjs",
  );
  assert.equal(packageJson.scripts["platform:detect"], "node scripts/platform/detect-platform.mjs");
  assert.equal(packageJson.scripts["codex:start"], "bash scripts/setup/start-codex.sh");
  assert.equal(packageJson.scripts["auth:check"], "node scripts/verify/identity-access.mjs");
  assert.equal(packageJson.scripts["tenancy:check"], "node scripts/verify/tenant-isolation.mjs");
  assert.equal(packageJson.scripts["localization:check"], "node scripts/verify/localization.mjs");
  assert.ok(packageJson.scripts.setup.endsWith("bash scripts/setup/install-git-hooks.sh"));
  assert.deepEqual(Object.keys(packageJson.devDependencies), ["prettier"]);
  assert.deepEqual(
    Object.keys(packageJson.scripts).filter((name) => name.startsWith("context:")),
    ["context:test"],
  );
  assert.equal(
    packageJson.scripts["handover:create"],
    "node scripts/context/critical-budget-handover.mjs create",
  );
  assert.equal(packageJson.scripts.verify, "node scripts/verify/adaptive.mjs --mode full");
  assert.equal(
    packageJson.scripts["verify:changed"],
    "node scripts/verify/adaptive.mjs --mode repo",
  );
  assert.equal(packageJson.scripts["verify:pre-push"], "bash scripts/verify/pre-push.sh");
  assert.equal(
    packageJson.scripts["goal:new"],
    "node scripts/goals/goal-publication-precondition.mjs",
  );
  for (const removedCommand of [
    "framework:reset",
    "framework:publish",
    "docs:sync",
    "goal:close",
    "planning:reset",
    "slice:close",
    "slice:new",
  ]) {
    assert.equal(packageJson.scripts[removedCommand], undefined, removedCommand);
  }
  assert.equal(
    readFileSync(path.join(generated, "mise.toml"), "utf8"),
    readFileSync(path.join(root, "mise.toml"), "utf8"),
  );
  assert.equal(
    readFileSync(path.join(generated, "mise.lock"), "utf8"),
    readFileSync(path.join(root, "mise.lock"), "utf8"),
  );
  assert.equal(
    readFileSync(path.join(generated, "pnpm-workspace.yaml"), "utf8"),
    readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8"),
  );
  assert.equal(
    readFileSync(path.join(generated, "pnpm-lock.yaml"), "utf8"),
    readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"),
  );
  for (const content of [
    generatedAgents,
    generatedReadme,
    generatedCodexReadme,
    generatedInstructions,
  ]) {
    assert.equal(content.includes(supportedCodexStartCommand), true);
  }
  assert.match(generatedCodexReadme, /mutable repository-local Codex runtime/);
  assertGeneratedDependencyFreshnessContract(generated);
  assert.match(generatedInstructions, /Root `src\/` is the required default Product Root/);
  assert.match(generatedInstructions, /non-null `transcript_path`/);
  assert.match(generatedCodexReadme, /canonical lifecycle needs\s+no manual `\/hooks` approval/);
  assert.equal(
    readFileSync(path.join(generated, ".codex", "hooks.json"), "utf8"),
    readFileSync(path.join(root, ".codex", "hooks.json"), "utf8"),
  );
  assert.equal(
    existsSync(path.join(generated, "scripts/context/session-stop-lifecycle.mjs")),
    true,
  );
  assert.equal(
    existsSync(path.join(generated, "scripts/setup/session-control-hook-command.mjs")),
    true,
  );
  assert.equal(existsSync(path.join(generated, "scripts/setup/startup-codex-process.mjs")), true);
  assert.equal(
    existsSync(path.join(generated, "scripts/setup/startup-runtime-executables.mjs")),
    true,
  );
  assert.equal(
    existsSync(path.join(generated, "scripts/setup/startup-session-controller.mjs")),
    true,
  );
  assertGeneratedWorkflowRuntime(generated);
  assertGeneratedTransferParityContract(source, generated);
  assert.equal(
    existsSync(path.join(generated, "scripts/setup/project-initialization-test-helpers.mjs")),
    false,
  );
  assert.equal(existsSync(path.join(generated, "scripts/verify/format-project.mjs")), true);
  const focusedVerificationTests = spawnSync(
    process.execPath,
    [
      "--test",
      "scripts/verify/adaptive-runner-routing.test.mjs",
      "scripts/verify/adaptive-runner.test.mjs",
      "scripts/verify/package-manifest.test.mjs",
    ],
    { cwd: generated, encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.equal(
    focusedVerificationTests.status,
    0,
    `${focusedVerificationTests.stderr}\n${focusedVerificationTests.stdout}`,
  );
  const generatedEntrypointCheck = spawnSync(
    process.execPath,
    ["scripts/verify/verification-entrypoints.mjs"],
    { cwd: generated, encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.equal(generatedEntrypointCheck.status, 0, generatedEntrypointCheck.stderr);
  const generatedVersionCheck = spawnSync(
    process.execPath,
    ["scripts/framework/framework-version.mjs", "--check"],
    { cwd: generated, encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.equal(generatedVersionCheck.status, 0, generatedVersionCheck.stderr);
  assert.match(generatedVersionCheck.stdout, /product version is project-owned/u);
  assert.equal(
    JSON.parse(readFileSync(path.join(generated, "package.json"), "utf8")).version,
    "0.1.0",
  );
  const generatedEvidenceTest = spawnSync(
    process.execPath,
    [
      "--test",
      "scripts/verify/verification-evidence-integrity.test.mjs",
      "scripts/verify/verification-evidence.test.mjs",
    ],
    { cwd: generated, encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.equal(generatedEvidenceTest.status, 0, generatedEvidenceTest.stderr);
  assert.equal(existsSync(path.join(generated, "scripts/terminal/terminal-output.test.mjs")), true);
  assert.equal(existsSync(path.join(generated, "scripts/verify/image-assets.mjs")), true);
  assert.equal(existsSync(path.join(generated, "scripts/verify/image-assets.test.mjs")), true);
  assert.equal(
    existsSync(path.join(generated, "scripts/deps/dependency-owner-normalization.test.mjs")),
    true,
  );
  assert.equal(
    existsSync(path.join(generated, "scripts/goals/goal-publication-precondition.mjs")),
    true,
  );
  assert.equal(existsSync(path.join(generated, "scripts/context/project-work-state.mjs")), true);
  assert.equal(
    existsSync(path.join(generated, "scripts/context/critical-budget-handover.mjs")),
    true,
  );
  assert.match(generatedAgents, /`instructions\.md` owns the complete agent workflow/);
  assert.match(
    generatedAgents,
    /inventories worktrees\/recovery, maintains compatible tools\/packages\/CI, stops on failure/,
  );
  assert.match(generatedAgents, /Keep local Codex state in ignored repository-root CODEX_HOME/);
  for (const content of [generatedAgents, generatedInstructions]) {
    assert.match(content, /no reliable exact\s+anchor/);
    assert.match(content, /cross-file\s+relationships/);
    assert.match(content, /read\s+every\s+matched\s+source/);
    assert.match(content, /pnpm goal:new/);
    assert.match(content, /one\s+user-approved\s+machine-readable owner/);
    assert.match(content, /each fix or user\s+instruction/i);
    assert.match(content, /broad,\s+realistic\s+end-to-end/i);
    assert.match(content, /every\s+new\s+feature/i);
    assert.match(content, /reviewable\s+slices/i);
    assert.match(content, /(?:no\s+relevant\s+finding\s+remains|zero\s+relevant\s+findings)/i);
    assert.match(content, /fresh\s+audit/i);
  }
  assert.match(
    generatedInstructions,
    /Local Codex state\/memories use ignored repository-root `CODEX_HOME` entries/,
  );
  assert.match(generatedInstructions, /audit\s+finding.*reopen/is);
  assert.match(generatedInstructions, /branch\s+policy\s+permits/i);
  assert.match(generatedInstructions, /marker\s+commit/i);
  for (const content of [generatedAgents, generatedInstructions]) {
    assert.match(content, /modular\s+monolith/i);
    assert.match(content, /only\s+durable\s+integration\s+branch/i);
  }
  assert.match(generatedInstructions, /not\s+an\s+authentication\s+boundary/i);
  assert.match(generatedInstructions, /pnpm handover:create -- --critical/u);
  assert.match(generatedInstructions, /final repository action/u);
  assert.match(generatedInstructions, /stop completely/u);
  assert.match(generatedInstructions, /ignored `tmp\/codexrig-handovers\//u);
  assert.doesNotMatch(generatedReadme, /`\.tmp\/codexrig-handovers\//u);
  assert.match(generatedInstructions, /every\s+completed\s+slice/i);
  assert.match(generatedInstructions, /without\s+waiting\s+for\s+another\s+prompt/i);
  assertGeneratedWorkflowPolicyContract({
    generated,
    agents: generatedAgents,
    readme: generatedReadme,
    codexReadme: generatedCodexReadme,
    instructions: generatedInstructions,
    manifest: generatedManifest,
  });
  assert.match(generatedManifest, /### Active Module Inventory/i);
  assert.match(generatedManifest, /No active product modules\./i);
  assert.match(generatedManifest, /docs\/future-modules\.md/i);
  assert.doesNotMatch(generatedManifest, /Product module map|pre-slice|fresh audit|marker commit/i);
  assert.match(generatedInstructions, /replacement test/i);
  assert.match(generatedInstructions, /exactly one write owner/i);
  assert.match(generatedAgents, /temporary (?:task )?branches/i);
  for (const content of [generatedAgents, generatedInstructions]) {
    assert.match(content, /Project\s+Definition\s+Intake/i);
  }
  assert.match(generatedManifest, /Product definition: pending/i);
  assert.match(generatedReadme, /## First Prompt: Define The Project/i);
  assert.match(generatedInstructions, /Begin\s+the\s+first\s+response/i);
  assert.match(generatedInstructions, /final\s+opportunity\s+to\s+correct/i);
  assert.match(generatedInstructions, /Resume the same focused intake later whenever/u);
  assert.match(generatedAgents, /short safe-entry bootstrap/);
  assert.equal(generatedAgents.length < generatedInstructions.length, true);
  assert.match(generatedInstructions, /## Product-First Delivery And Verification Economy/);
  assert.match(generatedInstructions, /whole-repository course check/i);
  assert.match(generatedInstructions, /recompute\s+missing coverage/i);
  assert.match(generatedInstructions, /cache\s+bypass\s+is\s+forbidden/i);
  assert.match(generatedInstructions, /package\.exports\.json/i);
  assert.match(generatedInstructions, /replace-in-place\s+successful-evidence\s+record/i);
  assert.match(
    generatedInstructions,
    /content-identical\s+dirty-to-commit\s+transition\s+without\s+verifier\s+commands/i,
  );
  assert.match(generatedInstructions, /not a target/i);
  assert.match(generatedInstructions, /pre-descent mask/);
  assert.match(generatedInstructions, /marker\s+commit/);
  assert.match(generatedInstructions, /major milestone/i);
  assert.match(generatedInstructions, /manifest-led discovery/);
  assert.match(generatedInstructions, /replace-in-place\s+successful-evidence\s+record/i);
  for (const filePath of [generatedUiReviewSkill, generatedUiReviewMetadata]) {
    const stats = lstatSync(filePath);
    assert.equal(stats.isFile(), true);
    assert.equal(stats.isSymbolicLink(), false);
  }
  assert.equal(
    readFileSync(generatedUiReviewSkill, "utf8"),
    readFileSync(path.join(root, ".agents/skills/ui-ux-review/SKILL.md"), "utf8"),
  );
  assert.equal(
    readFileSync(generatedUiReviewMetadata, "utf8"),
    readFileSync(path.join(root, ".agents/skills/ui-ux-review/agents/openai.yaml"), "utf8"),
  );
  for (const role of ["default", "explorer", "worker"]) {
    const roleContent = readFileSync(
      path.join(generated, ".codex", "agents", `${role}.toml`),
      "utf8",
    );
    assert.match(roleContent, /manifest-led discovery/, role);
    assert.match(roleContent, /matched source/, role);
    assert.match(roleContent, /whole-repository course check/, role);
    assert.match(roleContent, /context recovery/, role);
    assert.match(roleContent, /milestone/, role);
    assert.match(roleContent, /fresh audit/, role);
    assert.match(roleContent, /token envelope/, role);
    assert.match(roleContent, /critical-drain request/, role);
    assert.match(roleContent, /overlap/, role);
    assert.match(
      roleContent,
      /Mirror every direct peer message and\s+response to\s+the\s+primary/,
      role,
    );
    assert.match(roleContent, /every\s+completed/, role);
    assert.match(roleContent, /Never[\s\S]*commit/, role);
    assert.match(roleContent, /never delegate or spawn another\s+agent/i, role);
  }
  assert.match(generatedReadme, /## Project Authority/);
  assert.match(generatedReadme, /\(instructions\.md\)/);
  assert.match(generatedReadme, /Documentation Context Economy/);
  assert.match(generatedInstructions, /single committed workflow authority/);
  assert.match(generatedInstructions, /Documentation has no general numeric line or word quota/);
  assert.match(generatedInstructions, /\$system-coherence/);
  assert.match(generatedInstructions, /24 KiB bootstrap cap/);
  assert.match(generatedAgents, /\$system-coherence/);
  assert.match(generatedInstructions, /at or below 700 physical lines/);
  assert.match(generatedManifest, /Agent workflow authority: `instructions\.md`/);
  assert.doesNotMatch(
    generatedManifest,
    /whole-repository course checks|Product-first delivery|pnpm goal:new|pre-descent mask|marker commit/i,
  );
  assert.equal(
    readFileSync(generatedCoherenceSkill, "utf8"),
    readFileSync(path.join(root, ".agents/skills/system-coherence/SKILL.md"), "utf8"),
  );
  assert.equal(
    readFileSync(generatedCoherenceMetadata, "utf8"),
    readFileSync(path.join(root, ".agents/skills/system-coherence/agents/openai.yaml"), "utf8"),
  );
  assert.equal(
    [generatedAgents, generatedReadme, generatedInstructions, generatedManifest].filter((content) =>
      content.includes("## Compact Project Memory"),
    ).length,
    1,
  );
  assert.equal(existsSync(path.join(generated, "docs", "planning")), false);
  const projectMarkdown = textFiles(generated)
    .map((filePath) => path.relative(generated, filePath).split(path.sep).join("/"))
    .filter(
      (relativePath) =>
        relativePath.endsWith(".md") &&
        !relativePath.startsWith(".agents/") &&
        !relativePath.startsWith(".codex/"),
    )
    .sort();
  assert.deepEqual(projectMarkdown, [
    "AGENTS.md",
    "README.md",
    "docs/future-modules.md",
    "docs/project.md",
    "instructions.md",
  ]);
  const frameworkIdentityFiles = textFiles(generated)
    .filter((filePath) => /\bCodexRig\b/i.test(readFileSync(filePath, "utf8")))
    .map((filePath) => path.relative(generated, filePath).split(path.sep).join("/"))
    .filter(
      (relativePath) =>
        !relativePath.startsWith(".agents/") &&
        !relativePath.startsWith(".codex/") &&
        !relativePath.startsWith(".codexrig/") &&
        !relativePath.startsWith("scripts/"),
    )
    .sort();
  assert.deepEqual(frameworkIdentityFiles, [
    "AGENTS.md",
    "NOTICE",
    "README.md",
    "docs/project.md",
    "instructions.md",
  ]);
  const obsoleteIdentityFiles = textFiles(generated)
    .filter((filePath) =>
      /\x62\x6f\x69\x6c\x65\x72\x70\x6c\x61\x74\x65/iu.test(readFileSync(filePath, "utf8")),
    )
    .map((filePath) => path.relative(generated, filePath).split(path.sep).join("/"));
  assert.deepEqual(obsoleteIdentityFiles, []);
  provideGeneratedDependenciesForTest(generated);

  // Skills delegate policy to local instructions; their references must survive real generation.
  for (const verifier of ["scripts/verify/docs.mjs", "scripts/verify/skill-paths.mjs"]) {
    const checked = spawnSync(process.execPath, [verifier], {
      cwd: generated,
      encoding: "utf8",
      stdio: "pipe",
      timeout: 30_000,
    });
    assert.equal(checked.status, 0, `${verifier}\n${checked.stdout}\n${checked.stderr}`);
  }

  const generatedGitignore = readFileSync(path.join(generated, ".gitignore"), "utf8");
  assert.equal(generatedGitignore, readFileSync(path.join(root, ".gitignore"), "utf8"));
  assert.deepEqual(repositoryCodexHomeGitignoreFindings(generatedGitignore), []);
  for (const relativePath of repositoryCodexHomeRuntimeProbePaths) {
    const target = path.join(generated, ...relativePath.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "generated-project Codex runtime fixture\n", "utf8");
  }
  const initialized = spawnSync("git", ["init", "-q", "-b", "main"], {
    cwd: generated,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  const installedHook = spawnSync("bash", ["scripts/setup/install-git-hooks.sh"], {
    cwd: generated,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
  });
  assert.equal(installedHook.status, 0, installedHook.stderr);
  for (const relativePath of repositoryCodexHomeRuntimeProbePaths) {
    const ignored = spawnSync(
      "git",
      ["check-ignore", "--no-index", "--quiet", "--", relativePath],
      {
        cwd: generated,
        encoding: "utf8",
        input: "",
        stdio: "pipe",
      },
    );
    assert.equal(ignored.status, 0, relativePath);
  }
  const addedGenerated = spawnSync("git", ["add", "-A"], {
    cwd: generated,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
  });
  assert.equal(addedGenerated.status, 0, addedGenerated.stderr);
  for (const relativePath of repositoryCodexHomeRuntimeProbePaths) {
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", relativePath], {
      cwd: generated,
      encoding: "utf8",
      input: "",
      stdio: "pipe",
    });
    assert.equal(tracked.status, 1, relativePath);
  }
  for (const relativePath of [
    ".codex/README.md",
    ".codex/config.toml",
    ".codex/hooks.json",
    ".codex/agents/default.toml",
  ]) {
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", relativePath], {
      cwd: generated,
      encoding: "utf8",
      input: "",
      stdio: "pipe",
    });
    assert.equal(tracked.status, 0, relativePath);
  }

  const generatedRemote = path.join(outputParent, "generated-goal-remote.git");
  const generatedRemoteUrl = `git@example.invalid:${generatedRemote}`;
  const sshTransport = path.join(outputParent, "generated-goal-ssh-transport.sh");
  writeFileSync(sshTransport, ["#!/bin/sh", "shift", 'exec sh -c "$1"', ""].join("\n"), "utf8");
  chmodSync(sshTransport, 0o700);
  const pushEnvironment = {
    ...process.env,
    GIT_SSH_COMMAND: sshTransport,
    GIT_SSH_VARIANT: "simple",
  };
  assert.equal(
    spawnSync("git", ["init", "--bare", "-q", "-b", "main", generatedRemote], {
      cwd: outputParent,
      encoding: "utf8",
      input: "",
      stdio: "pipe",
    }).status,
    0,
  );
  for (const [key, value] of [
    ["user.name", "Generated Goal Test"],
    ["user.email", "generated-goal@example.invalid"],
  ]) {
    const configured = spawnSync("git", ["config", key, value], {
      cwd: generated,
      encoding: "utf8",
      input: "",
      stdio: "pipe",
    });
    assert.equal(configured.status, 0, configured.stderr);
  }
  for (const args of [["commit", "-q", "-m", "initial generated project"]]) {
    const published = spawnSync("git", args, {
      cwd: generated,
      encoding: "utf8",
      env: pushEnvironment,
      input: "",
      stdio: "pipe",
    });
    assert.equal(published.status, 0, published.stderr);
  }
  recordGeneratedVerificationEvidence(generated);
  const remoteAdded = spawnSync("git", ["remote", "add", "origin", generatedRemoteUrl], {
    cwd: generated,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
  });
  assert.equal(remoteAdded.status, 0, remoteAdded.stderr);
  const redirectedWorktree = path.join(outputParent, "generated-redirected-worktree");
  const redirectedSentinel = path.join(outputParent, "generated-redirected-hook-ran");
  mkdirSync(path.join(redirectedWorktree, "scripts", "verify"), { recursive: true });
  const redirectedRunner = path.join(redirectedWorktree, "scripts", "verify", "pre-push.sh");
  writeFileSync(
    redirectedRunner,
    `#!/bin/sh\nprintf 'redirected\\n' >${JSON.stringify(redirectedSentinel)}\nexit 0\n`,
    "utf8",
  );
  chmodSync(redirectedRunner, 0o700);
  assert.equal(
    spawnSync("git", ["config", "core.worktree", redirectedWorktree], { cwd: generated }).status,
    0,
  );
  const published = spawnSync("git", ["push", "-q", "-u", "origin", "HEAD"], {
    cwd: generated,
    encoding: "utf8",
    env: pushEnvironment,
    input: "",
    stdio: "pipe",
  });
  assert.equal(published.status, 0, `${published.stdout}${published.stderr}`);
  assert.equal(existsSync(redirectedSentinel), false);
  assert.equal(
    spawnSync(
      "git",
      [`--git-dir=${path.join(generated, ".git")}`, "config", "--unset", "core.worktree"],
      { cwd: generated },
    ).status,
    0,
  );
  const prePushEvidence = spawnSync(
    "mise",
    [
      "exec",
      "--locked",
      "--",
      "pnpm",
      "verify:pre-push",
      "--",
      "origin",
      "https://example.com/generated-goal.git",
    ],
    {
      cwd: generated,
      encoding: "utf8",
      input: "",
      stdio: "pipe",
    },
  );
  assert.equal(prePushEvidence.status, 0, prePushEvidence.stderr);
  assert.match(prePushEvidence.stdout, /successful verification evidence/i);
  assert.doesNotMatch(prePushEvidence.stdout, /running the complete deterministic verification/i);
  const ready = runGeneratedGoalGate(generated, outputParent);
  assert.equal(ready.status, 0, ready.stderr);
  assert.match(ready.stdout, /publication precondition passed/i);
  assert.equal(`${ready.stdout}${ready.stderr}`.includes(generated), false);

  writeFileSync(path.join(generated, "src", ".gitkeep"), "unpublished completion\n", "utf8");
  for (const args of [
    ["add", "src/.gitkeep"],
    ["commit", "-q", "-m", "unpublished goal completion"],
  ]) {
    const committed = spawnSync("git", args, {
      cwd: generated,
      encoding: "utf8",
      input: "",
      stdio: "pipe",
    });
    assert.equal(committed.status, 0, committed.stderr);
  }
  recordGeneratedVerificationEvidence(generated);
  const blocked = runGeneratedGoalGate(generated);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /ahead 1, behind 0/i);
  assert.equal(`${blocked.stdout}${blocked.stderr}`.includes(generated), false);
  const republished = spawnSync("git", ["push", "-q"], {
    cwd: generated,
    encoding: "utf8",
    env: pushEnvironment,
    input: "",
    stdio: "pipe",
  });
  assert.equal(republished.status, 0, republished.stderr);
  assert.equal(runGeneratedGoalGate(generated).status, 0);

  assertGeneratedTaskBranchIntegration({ generated, pushEnvironment });

  writeFileSync(
    path.join(generated, "src", "secret.txt"),
    ["-----BEGIN PRIVATE", " KEY-----\nsynthetic fixture only\n"].join(""),
    "utf8",
  );
  for (const args of [
    ["add", "src/secret.txt"],
    ["commit", "-q", "-m", "rejected secret fixture"],
  ]) {
    const committed = spawnSync("git", args, {
      cwd: generated,
      encoding: "utf8",
      input: "",
      stdio: "pipe",
    });
    assert.equal(committed.status, 0, committed.stderr);
  }
  recordGeneratedVerificationEvidence(generated);
  const rejectedPush = spawnSync("git", ["push", "-q"], {
    cwd: generated,
    encoding: "utf8",
    env: pushEnvironment,
    input: "",
    stdio: "pipe",
  });
  assert.equal(rejectedPush.status, 1);
  assert.match(`${rejectedPush.stdout}${rejectedPush.stderr}`, /private key|secret/i);
  assert.notEqual(
    spawnSync("git", ["rev-parse", "HEAD"], { cwd: generated, encoding: "utf8" }).stdout.trim(),
    spawnSync("git", ["rev-parse", "@{upstream}"], {
      cwd: generated,
      encoding: "utf8",
    }).stdout.trim(),
  );
});
