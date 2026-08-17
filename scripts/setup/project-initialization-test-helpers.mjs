/** Owns project initialization test helpers behavior for the setup, launch, and portable project boundary. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertGeneratedProjectParity } from "../../.agents/skills/create-project-from-framework/scripts/generated-project-finalization.mjs";
import { capturePortableProjectTransferManifest } from "../../.agents/skills/create-project-from-framework/scripts/project-copy.mjs";
import { stageProjectExport } from "./stage-project-export.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const temporaryRoots = [];

export function temporaryRoot(prefix) {
  const value = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(value);
  return value;
}

export function cleanupTemporaryRoots() {
  for (const temporaryRootPath of temporaryRoots.splice(0)) {
    rmSync(temporaryRootPath, { force: true, recursive: true });
  }
}

export function isolatedTrackedFrameworkSource(prefix) {
  const sourceParent = temporaryRoot(prefix);
  const source = path.join(sourceParent, "source");
  stageProjectExport({ includeUntracked: true, sourceRoot: root, targetRoot: source });
  initializeTrackedSource(source);
  return source;
}

export function readdirNames(directory) {
  return readdirSync(directory).sort();
}

export function textFiles(directory) {
  const files = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolutePath);
      else if (entry.isFile()) files.push(absolutePath);
    }
  }
  return files;
}

export function assertGeneratedWorkflowRuntime(generated) {
  for (const relativePath of [
    "scripts/setup/codex-launcher.test.mjs",
    "scripts/setup/install-git-hooks.mjs",
    "scripts/setup/install-git-hooks.sh",
    "scripts/setup/portable-project-contract.mjs",
    "scripts/setup/resolve-git-hooks-path.mjs",
    "scripts/setup/setup-regression-fixtures.mjs",
    "scripts/contracts/product-configuration.mjs",
    "scripts/contracts/localization-configuration.mjs",
    "scripts/contracts/mise-toolchain-configuration.mjs",
    "scripts/contracts/tenancy-configuration.mjs",
    "scripts/verify/adaptive.mjs",
    "scripts/verify/adaptive-options.mjs",
    "scripts/verify/adaptive-runner.mjs",
    "scripts/verify/adaptive-runner-routing.test.mjs",
    "scripts/verify/adaptive-runner-test-helpers.mjs",
    "scripts/verify/adaptive-runner.test.mjs",
    "scripts/verify/adaptive-state.mjs",
    "scripts/verify/package-manifest.mjs",
    "scripts/verify/identity-access.mjs",
    "scripts/verify/localization.mjs",
    "scripts/verify/localization.test.mjs",
    "scripts/verify/tenant-isolation.mjs",
    "scripts/verify/white-label.mjs",
    "scripts/verify/white-label.test.mjs",
    "scripts/verify/pre-push-steps.sh",
    "scripts/verify/verification-admission.mjs",
    "scripts/verify/verification-admission-decision.mjs",
    "scripts/verify/verification-evidence.mjs",
    "scripts/verify/verification-evidence-record.mjs",
    "scripts/verify/verification-evidence-integrity.test.mjs",
    "scripts/verify/verification-evidence-test-helpers.mjs",
    "scripts/verify/verification-evidence.test.mjs",
    "scripts/verify/verification-entrypoints.mjs",
    "scripts/verify/verification-executor.mjs",
    "scripts/verify/verification-git-basis.mjs",
    "scripts/verify/verification-risk-profile.mjs",
    "scripts/verify/verification-record-helpers.mjs",
    "scripts/verify/verification-runtime-identity.mjs",
    "scripts/verify/verification-session-lock.mjs",
    "scripts/verify/workspace-verification.mjs",
  ]) {
    assert.equal(existsSync(path.join(generated, relativePath)), true, relativePath);
  }
}

export function initializeTrackedSource(sourceRoot) {
  const initialized = spawnSync("git", ["init", "-q"], {
    cwd: sourceRoot,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  const added = spawnSync("git", ["add", "-A"], {
    cwd: sourceRoot,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
  });
  assert.equal(added.status, 0, added.stderr);
  const modulesRoot = path.join(sourceRoot, "node_modules");
  mkdirSync(modulesRoot, { recursive: true });
  symlinkSync(
    path.join(root, "node_modules", "prettier"),
    path.join(modulesRoot, "prettier"),
    "dir",
  );
}

export function runProjectGenerator(args) {
  const script = path.join(
    root,
    ".agents/skills/create-project-from-framework/scripts/create-project-from-framework.mjs",
  );
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
    timeout: 30_000,
  });
}

export function gitState(sourceRoot, { includeIgnored = true } = {}) {
  const argumentsList = ["status", "--porcelain=v1", "-z", "--untracked-files=all"];
  if (includeIgnored) argumentsList.push("--ignored=matching");
  const result = spawnSync("git", argumentsList, {
    cwd: sourceRoot,
    encoding: null,
    input: Buffer.alloc(0),
    stdio: "pipe",
  });
  assert.equal(result.status, 0, result.stderr?.toString("utf8"));
  return result.stdout;
}

export function provideGeneratedDependenciesForTest(targetRoot) {
  const sourceModules = path.join(root, "node_modules");
  const targetModules = path.join(targetRoot, "node_modules");
  assert.equal(existsSync(targetModules), false, "generated project inherited node_modules");
  const sourceStats = lstatSync(sourceModules);
  assert.equal(sourceStats.isDirectory() && !sourceStats.isSymbolicLink(), true);
  mkdirSync(targetModules);
  for (const entry of readdirSync(sourceModules, { withFileTypes: true })) {
    const sourceEntry = path.join(sourceModules, entry.name);
    const targetEntry = path.join(targetModules, entry.name);
    if (entry.isFile()) {
      copyFileSync(sourceEntry, targetEntry);
      continue;
    }
    const targetType = process.platform === "win32" ? "junction" : "dir";
    symlinkSync(sourceEntry, targetEntry, targetType);
  }
  const packageJson = JSON.parse(readFileSync(path.join(targetRoot, "package.json"), "utf8"));
  const workspaceStatePath = path.join(targetModules, ".pnpm-workspace-state-v1.json");
  const workspaceState = JSON.parse(readFileSync(workspaceStatePath, "utf8"));
  workspaceState.lastValidatedTimestamp = Date.now();
  workspaceState.projects = {
    [targetRoot]: {
      name: packageJson.name,
      version: packageJson.version,
    },
  };
  writeFileSync(workspaceStatePath, `${JSON.stringify(workspaceState, null, 2)}\n`, "utf8");
}

export function assertGeneratedDependencyFreshnessContract(generated) {
  const packageJson = JSON.parse(readFileSync(path.join(generated, "package.json"), "utf8"));
  const generatedReadme = readFileSync(path.join(generated, "README.md"), "utf8");
  const generatedInstructions = readFileSync(path.join(generated, "instructions.md"), "utf8");
  const workspaceConfig = readFileSync(path.join(generated, "pnpm-workspace.yaml"), "utf8");

  assert.equal(packageJson.scripts["deps:install"], "node scripts/deps/install-compatible.mjs");
  assert.match(
    generatedReadme,
    /mise install --locked\nmise exec --locked -- node scripts\/deps\/install-compatible\.mjs/,
  );
  assert.match(generatedReadme, /frozen install.*does not\s+establish\s+registry\s+freshness/is);
  assert.match(generatedInstructions, /## Dependency Installation And Freshness/);
  assert.equal(existsSync(path.join(generated, "scripts/deps/install-compatible.mjs")), true);
  assert.match(workspaceConfig, /strictPeerDependencies: true[\s\S]*engineStrict: true/);
}

export function assertGeneratedAutonomousContinuationContract({
  generated,
  policyDocuments,
  instructions,
  codexReadme,
}) {
  for (const content of policyDocuments) {
    assert.match(content, /codexrig-work-state/i);
    assert.match(content, /failed\s+publication.*current\s+goal.*open/is);
    assert.match(content, /ephemeral\s+side\s+conversations?/i);
    assert.match(content, /transcript_path/i);
  }
  assert.match(
    instructions,
    /<!-- codexrig-work-state\s+\{"version":1,"revision":1,"status":"active"/,
  );
  assert.match(instructions, /stop_hook_active/);
  assert.match(instructions, /untrusted resume metadata/i);
  assert.match(codexReadme, /same\s+(?:durable\s+)?turn\s+was\s+already\s+continued/i);
  assert.match(codexReadme, /resume\s+metadata\s+rather\s+than\s+authority/i);
  assert.match(codexReadme, /ephemeral\s+side\s+conversations?/i);
  assert.match(codexReadme, /transcript_path/i);
  assert.equal(
    existsSync(path.join(generated, "scripts/context/refresh-context-index-on-stop.mjs")),
    true,
  );
}

export function assertGeneratedWorkflowPolicyContract({
  generated,
  agents,
  readme,
  codexReadme,
  instructions,
  manifest,
}) {
  assert.match(agents, /current-state inventory, never a roadmap/i);
  assert.match(agents, /docs\/future-modules\.md/i);
  assert.match(agents, /\$architecture-evolution/i);
  assert.match(agents, /Identity and Access/i);
  assert.match(agents, /\$security-review/i);
  assert.match(agents, /at most four live subagents/i);
  assert.match(agents, /exact same configured GPT Sol model/i);
  assert.match(agents, /`ultra` reasoning/i);
  assert.match(agents, /dedicated(?:\s+disjoint)?\s+worktrees?\s+or\s+clones?/i);
  assert.match(agents, /never permits subagents to commit, merge, push, publish/i);
  assert.match(agents, /`dev` is the default/i);
  assert.match(agents, /already authorized YOLO session/i);
  assert.match(agents, /white-label/i);
  assert.match(agents, /config\/product\.json/i);
  assert.match(agents, /config\/tenancy\.json/i);
  assert.match(readme, /config\/localization\.json/i);
  assert.match(readme, /mobile, tablet, and desktop/i);
  assert.match(readme, /Runtime and technology/i);
  assert.match(readme, /hand-authored textual file/i);
  const patterns = readFileSync(path.join(generated, "scripts/verify/patterns.mjs"), "utf8");
  const housekeeping = readFileSync(
    path.join(generated, "scripts/goals/repository-housekeeping.mjs"),
    "utf8",
  );
  assert.match(patterns, /fileHeaderFindings/);
  assert.match(patterns, /declarationDocumentationFindings/);
  assert.match(housekeeping, /scripts\/verify\/patterns\.mjs/);

  assert.match(instructions, /pre-slice\s+coordination\s+check/i);
  const workflowSection = /## Workflow\n\n([\s\S]*?)\n\n## Compact Project Memory/u.exec(
    instructions,
  )?.[1];
  assert.ok(workflowSection, "generated instructions must contain their bounded Workflow section");
  assert.deepEqual(
    [...workflowSection.matchAll(/^(\d+)\.\s/gmu)].map((match) => Number(match[1])),
    Array.from({ length: 20 }, (_, index) => index + 1),
    "generated Workflow steps must be uniquely and consecutively numbered",
  );
  assert.match(instructions, /before\s+(?:every|the)\s+slice\s+begins?/i);
  assert.match(instructions, /observable\s+agent,?\s+session,?\s+account/i);
  assert.match(instructions, /before\s+relying\s+on\s+Git/i);
  assert.match(instructions, /confirmed-disjoint/i);
  assert.match(instructions, /## White-Label Product Configuration/i);
  assert.match(instructions, /Identity and Access is a dedicated trust and\s+domain boundary/i);
  assert.match(instructions, /### Product Surface Selection/i);
  assert.match(instructions, /### Requirement-Driven Technology Selection/i);
  assert.match(instructions, /### Source And Declaration Headers/i);
  assert.match(instructions, /scripts\/verify\/patterns\.mjs/i);
  assert.match(instructions, /### Localization And Language Strategy/i);
  assert.match(instructions, /pnpm localization:check/i);
  assert.match(instructions, /### Multi-Device Experience/i);
  assert.match(instructions, /### Tenant Isolation Boundary/i);
  assert.match(instructions, /deny-by-default/i);
  assert.match(instructions, /scripts\/verify\/path-hygiene\.mjs/i);
  assert.match(instructions, /deep-import one another/i);
  assert.match(instructions, /\$security-review/i);
  assert.match(
    instructions,
    /repository\/package\s+names\s+are\s+never\s+runtime\s+brand\s+fallbacks/i,
  );
  assert.match(readme, /## White-Label Configuration/i);
  assert.match(readme, /## Identity And Access Boundary/i);
  assert.match(readme, /## Tenant Isolation Boundary/i);
  assert.match(readme, /## Localization And Source Language/i);
  assert.match(readme, /asks whether to refine it further/i);
  assert.match(manifest, /Public product identity and brand: not configured/i);
  assert.match(manifest, /Product surface decision: pending/i);
  assert.match(manifest, /Tenant isolation runtime: no product tenant resolver/i);
  assert.match(manifest, /Product languages and localization: pending/i);
  assert.match(manifest, /technical source documentation use English/i);
  assert.match(
    codexReadme,
    /cannot\s+prove\s+that\s+another\s+clone,?\s+machine,?\s+or\s+account\s+is\s+idle/i,
  );
  for (const content of [agents, readme, instructions]) {
    assert.match(content, /modular monolith/i);
    assert.match(content, /(?:replaceable modules|independently improvable or replaceable)/i);
  }
  assert.match(instructions, /assembled\s+system\s+is\s+verified\s+as\s+one\s+functioning\s+unit/i);
  assert.match(instructions, /newest\s+relevant\s+primary\s+or\s+official\s+sources/i);
  assert.match(instructions, /older\s+sources.*comparison\s+or\s+historical\s+context/is);
  assert.match(instructions, /explicit\s+user\s+confirmation/i);
  assert.match(
    instructions,
    /consolidation\s+is\s+conservative,?\s+not\s+a\s+shortening\s+target/i,
  );
  assert.match(instructions, /shared\s+pre-slice\s+coordination\s+channel/i);
  assert.match(instructions, /--source <new-framework-root>/i);
  assert.match(instructions, /--target <child-root>/i);
  assert.match(instructions, /version-2\s+contract\s+is\s+the\s+sole\s+active\s+upgrade\s+model/i);
  assert.doesNotMatch(instructions, /--allow-same|pre-1\.2|legacy preview/i);
  assert.match(readme, /## Framework Updates/i);
  assert.match(readme, /config\/product\.json.*never overwritten/is);
  assert.match(readme, /--source <new-codexrig-root>/i);
  assert.match(readme, /--target <child-root>/i);
  assert.match(readme, /changed stable policy IDs/i);
  assert.match(readme, /normative\s+behavior\s+is\s+never\s+hidden/i);
  assert.match(manifest, /### Active Module Inventory/i);
  assert.match(manifest, /No active product modules\./i);
  assert.match(manifest, /docs\/future-modules\.md/i);
  assert.doesNotMatch(manifest, /pre-slice|fresh audit|marker commit|framework:upgrade/i);
  assert.match(
    instructions,
    /After all mutating work for a completed\s+goal.*repo:housekeeping.*before the goal-wide documentation\s+review,\s+final audit/is,
  );
  assert.match(
    instructions,
    /resulting `main` receives.*completed-goal documentation review.*critical-document confirmation and preservation review/is,
  );
  assert.match(
    instructions,
    /After protected or parallel integration.*rerun read-only\s+housekeeping/is,
  );
  for (const role of ["default", "explorer", "worker"]) {
    const roleContent = readFileSync(
      path.join(generated, ".codex", "agents", `${role}.toml`),
      "utf8",
    );
    assert.match(roleContent, /Before every assigned slice begins/, role);
    assert.match(roleContent, /observable collaboration claims/, role);
    assert.match(roleContent, /token envelope/, role);
    assert.match(roleContent, /never delegate or spawn another\s+agent/i, role);
    assert.match(roleContent, /newest relevant primary or official sources/, role);
    assert.match(roleContent, /Never[\s\S]*commit/, role);
  }
  assertGeneratedAutonomousContinuationContract({
    generated,
    policyDocuments: [instructions],
    instructions,
    codexReadme,
  });
}

export function assertGeneratedTransferParityContract(generated) {
  const transferManifest = capturePortableProjectTransferManifest(root, {
    includeUntracked: true,
  });
  assertGeneratedProjectParity({
    sourceRoot: root,
    targetRoot: generated,
    transferManifest,
  });

  const reusablePath = "scripts/docs/project-document-policy.mjs";
  const generatedReusablePath = path.join(generated, reusablePath);
  const original = readFileSync(generatedReusablePath, "utf8");
  try {
    writeFileSync(generatedReusablePath, `${original}\n// undeclared generated mutation\n`, "utf8");
    assert.throws(
      () =>
        assertGeneratedProjectParity({
          sourceRoot: root,
          targetRoot: generated,
          transferManifest,
        }),
      /reusable files changed outside declared project-specific transformations/,
    );
    rmSync(generatedReusablePath);
    assert.throws(
      () =>
        assertGeneratedProjectParity({
          sourceRoot: root,
          targetRoot: generated,
          transferManifest,
        }),
      /transfer parity failed \(missing: scripts\/docs\/project-document-policy\.mjs\)/,
    );
  } finally {
    writeFileSync(generatedReusablePath, original, "utf8");
  }

  const packagePath = path.join(generated, "package.json");
  const originalPackage = readFileSync(packagePath, "utf8");
  try {
    const changedPackage = JSON.parse(originalPackage);
    delete changedPackage.scripts["context:search"];
    writeFileSync(packagePath, `${JSON.stringify(changedPackage, null, 2)}\n`, "utf8");
    assert.throws(
      () =>
        assertGeneratedProjectParity({
          sourceRoot: root,
          targetRoot: generated,
          transferManifest,
        }),
      /Generated package exceeds the declared identity and source-reset transformation/,
    );
  } finally {
    writeFileSync(packagePath, originalPackage, "utf8");
  }
  assertGeneratedProjectParity({
    sourceRoot: root,
    targetRoot: generated,
    transferManifest,
  });
}

export function assertGeneratedProjectQuality(targetRoot) {
  const formatterPath = path.join(root, "node_modules", "prettier", "bin", "prettier.cjs");
  const formatResult = spawnSync(process.execPath, [formatterPath, "--check", "."], {
    cwd: targetRoot,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
  });
  assert.equal(formatResult.status, 0, formatResult.stderr);
  const entrypointResult = spawnSync(
    process.execPath,
    ["scripts/verify/verification-entrypoints.mjs"],
    { cwd: targetRoot, encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.equal(entrypointResult.status, 0, entrypointResult.stderr);
  const contractResult = spawnSync(
    process.execPath,
    ["--test", "scripts/context/portable-context-contract.test.mjs"],
    { cwd: targetRoot, encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.equal(contractResult.status, 0, contractResult.stderr);
  const licensingResult = spawnSync(process.execPath, ["scripts/verify/licensing.mjs"], {
    cwd: targetRoot,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
  });
  assert.equal(licensingResult.status, 0, licensingResult.stderr);
  const focusedVerificationResult = spawnSync(
    process.execPath,
    [
      "--test",
      "scripts/framework/framework-lifecycle.test.mjs",
      "scripts/repository/source-inventory.test.mjs",
      "scripts/verify/adaptive-cli.test.mjs",
      "scripts/verify/adaptive-runner-routing.test.mjs",
      "scripts/verify/adaptive-runner.test.mjs",
      "scripts/verify/package-manifest.test.mjs",
      "scripts/verify/api-security.test.mjs",
      "scripts/verify/white-label.test.mjs",
      "scripts/verify/verification-executor.test.mjs",
    ],
    { cwd: targetRoot, encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.equal(focusedVerificationResult.status, 0, focusedVerificationResult.stderr);
  const evidenceResult = spawnSync(
    process.execPath,
    [
      "--test",
      "scripts/verify/verification-evidence-integrity.test.mjs",
      "scripts/verify/verification-evidence.test.mjs",
    ],
    { cwd: targetRoot, encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.equal(evidenceResult.status, 0, evidenceResult.stderr);
  provideGeneratedDependenciesForTest(targetRoot);
  const packageEntrypointResult = spawnSync(
    "mise",
    ["exec", "--locked", "--", "pnpm", "verify:changed", "--", "--print-plan"],
    {
      cwd: targetRoot,
      encoding: "utf8",
      input: "",
      stdio: "pipe",
      timeout: 120_000,
    },
  );
  assert.equal(packageEntrypointResult.status, 0, packageEntrypointResult.stderr);
  assert.match(packageEntrypointResult.stdout, /Admission mode:/);
}

function pnpmRunPath(generated) {
  const packagePath = path.join(generated, "package.json");
  const original = readFileSync(packagePath, "utf8");
  const packageJson = JSON.parse(original);
  packageJson.scripts["test:runtime-path"] = 'node -p "JSON.stringify(process.env.PATH)"';
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  let result;
  try {
    result = spawnSync("mise", ["exec", "--locked", "--", "pnpm", "run", "test:runtime-path"], {
      cwd: generated,
      encoding: "utf8",
      input: "",
      stdio: "pipe",
    });
  } finally {
    writeFileSync(packagePath, original, "utf8");
  }
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const runtimePath = result.stdout
    .split(/\r?\n/u)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .findLast((value) => typeof value === "string");
  assert.equal(typeof runtimePath, "string", result.stdout);
  return runtimePath;
}

export function recordGeneratedVerificationEvidence(generated) {
  const runnerUrl = pathToFileURL(path.join(generated, "scripts/verify/adaptive-runner.mjs")).href;
  const evidenceUrl = pathToFileURL(
    path.join(generated, "scripts/verify/verification-evidence.mjs"),
  ).href;
  const basisUrl = pathToFileURL(
    path.join(generated, "scripts/verify/verification-git-basis.mjs"),
  ).href;
  const lockUrl = pathToFileURL(
    path.join(generated, "scripts/verify/verification-session-lock.mjs"),
  ).href;
  const source = `
    const { buildPlan } = await import(${JSON.stringify(runnerUrl)});
    const {
      currentVerificationEvidenceInputs,
      recordSuccessfulFullEvidence,
    } = await import(${JSON.stringify(evidenceUrl)});
    const { captureVerificationGitBasis } = await import(${JSON.stringify(basisUrl)});
    const { acquireVerificationSessionLock } = await import(${JSON.stringify(lockUrl)});
    const plan = buildPlan({ mode: "full", printPlan: false, simulatedPaths: [] });
    const broadPlan = [...plan.readOnlyCommands, ...plan.workspaceCommands]
      .map(({ args, artifactOwners = [], executable, key, phase }) => ({
        args, artifactOwners, executable, key, phase
      }));
    const expectedInputs = currentVerificationEvidenceInputs({ broadPlan });
    const expectedGitBasis = captureVerificationGitBasis({ repositoryRoot: ${JSON.stringify(generated)} });
    const lock = acquireVerificationSessionLock({ repositoryRoot: ${JSON.stringify(generated)} });
    try {
      const commands = [...plan.readOnlyCommands, ...plan.workspaceCommands];
      recordSuccessfulFullEvidence({
        broadPlan, expectedGitBasis, expectedInputs,
        successfulCommandKeys: commands.map((command) => command.key)
      });
    } finally {
      lock.release();
    }
  `;
  const result = spawnSync(
    "mise",
    ["exec", "--locked", "--", "node", "--input-type=module", "--eval", source],
    {
      cwd: generated,
      encoding: "utf8",
      env: process.env,
      input: "",
      stdio: "pipe",
    },
  );
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
}

export function runGeneratedGoalGate(generated, cwd = generated) {
  return spawnSync(
    "node",
    [path.join(generated, "scripts/goals/goal-publication-precondition.mjs")],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, PATH: pnpmRunPath(generated) },
      input: "",
      stdio: "pipe",
    },
  );
}

export function assertGeneratedTaskBranchIntegration({ generated, pushEnvironment }) {
  assert.equal(
    spawnSync("git", ["checkout", "-q", "-b", "temporary-task-branch"], {
      cwd: generated,
      encoding: "utf8",
      input: "",
      stdio: "pipe",
    }).status,
    0,
  );
  writeFileSync(
    path.join(generated, "src", "task-branch.txt"),
    "bounded integration input\n",
    "utf8",
  );
  for (const args of [
    ["add", "src/task-branch.txt"],
    ["commit", "-q", "-m", "bounded task branch input"],
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
  const taskBranchPublished = spawnSync(
    "git",
    ["push", "-q", "-u", "origin", "temporary-task-branch"],
    {
      cwd: generated,
      encoding: "utf8",
      env: pushEnvironment,
      input: "",
      stdio: "pipe",
    },
  );
  assert.equal(taskBranchPublished.status, 0, taskBranchPublished.stderr);
  assert.match(runGeneratedGoalGate(generated).stderr, /central main branch/i);
  assert.equal(
    spawnSync("git", ["checkout", "-q", "main"], {
      cwd: generated,
      encoding: "utf8",
      input: "",
      stdio: "pipe",
    }).status,
    0,
  );
  const integrated = spawnSync(
    "git",
    ["merge", "-q", "--no-ff", "-m", "integrate bounded task input", "temporary-task-branch"],
    {
      cwd: generated,
      encoding: "utf8",
      input: "",
      stdio: "pipe",
    },
  );
  assert.equal(integrated.status, 0, integrated.stderr);
  recordGeneratedVerificationEvidence(generated);
  assert.match(runGeneratedGoalGate(generated).stderr, /ahead 2, behind 0/i);
  const integratedPublished = spawnSync("git", ["push", "-q"], {
    cwd: generated,
    encoding: "utf8",
    env: pushEnvironment,
    input: "",
    stdio: "pipe",
  });
  assert.equal(integratedPublished.status, 0, integratedPublished.stderr);
  assert.equal(runGeneratedGoalGate(generated).status, 0);
}
