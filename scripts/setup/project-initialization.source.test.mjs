import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { supportedCodexStartCommand } from "../context/portable-context-contract.mjs";
import {
  repositoryCodexHomeGitignoreFindings,
  repositoryCodexHomeRuntimeProbePaths,
} from "../repository/source-inventory.mjs";
import {
  assertGeneratedDependencyFreshnessContract,
  assertGeneratedTaskBranchIntegration,
  assertGeneratedWorkflowRuntime,
  cleanupTemporaryRoots,
  gitState,
  provideGeneratedDependenciesForTest,
  readdirNames,
  recordGeneratedVerificationEvidence,
  root,
  runGeneratedGoalGate,
  runProjectGenerator,
  temporaryRoot,
  textFiles,
} from "./project-initialization-test-helpers.mjs";

after(cleanupTemporaryRoots);

test("clean project initialization removes inherited state and source-specific text", () => {
  const outputParent = temporaryRoot("codexrig-create-");
  const sourceStateBefore = gitState(root);
  const result = runProjectGenerator([
    "--name",
    "Generated Isolation Fixture",
    "--directory",
    "generated-isolation-fixture",
    "--source",
    root,
    "--output-parent",
    outputParent,
    "--include-untracked",
  ]);
  assert.equal(result.status, 0, result.stderr);
  for (const localValue of [root, outputParent]) {
    assert.equal(`${result.stdout}${result.stderr}`.includes(localValue), false, localValue);
  }
  assert.deepEqual(gitState(root), sourceStateBefore);
  assert.match(
    result.stdout,
    /Source framework tracked and portable state remained unchanged and baseline-clean\./,
  );
  assert.match(result.stdout, /active-session cleanup completed; no commit or push was performed/i);
  assert.match(result.stdout, /After ending every Codex\/CodexRig session/);
  assert.match(result.stdout, /pnpm framework:reset --apply/);
  assert.match(result.stdout, /Optional Git publication/);
  assert.match(result.stdout, /git status --short/);
  assert.match(result.stdout, /git add -- <reviewed-paths>/);
  assert.match(result.stdout, /git commit -m "<message>"/);
  assert.match(result.stdout, /git push/);

  const generated = path.join(outputParent, "generated-isolation-fixture", "code");
  const generatedAgents = readFileSync(path.join(generated, "AGENTS.md"), "utf8");
  const generatedReadme = readFileSync(path.join(generated, "README.md"), "utf8");
  const generatedCodexReadme = readFileSync(path.join(generated, ".codex", "README.md"), "utf8");
  const generatedInstructions = readFileSync(path.join(generated, "instructions.md"), "utf8");
  const generatedManifest = readFileSync(path.join(generated, "docs", "project.md"), "utf8");
  const generatedContextIndex = readFileSync(
    path.join(generated, "docs", "context-index.md"),
    "utf8",
  );
  const generatedRetrievalSkill = path.join(generated, ".agents/skills/context-retrieval/SKILL.md");
  const generatedRetrievalMetadata = path.join(
    generated,
    ".agents/skills/context-retrieval/agents/openai.yaml",
  );
  for (const forbidden of [
    ".git",
    ".context-index",
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
  assert.equal(frameworkReceipt.frameworkVersion, "1.0.0");
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
  const generatedAgentEntries = readdirNames(path.join(generated, ".codex", "agents"));
  for (const requiredAgent of ["default.toml", "explorer.toml", "worker.toml"]) {
    assert.equal(generatedAgentEntries.includes(requiredAgent), true, requiredAgent);
  }
  assert.deepEqual(readdirNames(path.join(generated, "src")), [".gitkeep"]);
  assert.equal(readFileSync(path.join(generated, "src", ".gitkeep"), "utf8"), "");
  const packageJson = JSON.parse(readFileSync(path.join(generated, "package.json"), "utf8"));
  assert.equal(packageJson.name, "generated-isolation-fixture");
  assert.equal(packageJson.version, "0.1.0");
  assert.equal(
    readFileSync(path.join(generated, "scripts/setup/export-project.sh"), "utf8"),
    readFileSync(path.join(root, "scripts/setup/export-project.sh"), "utf8"),
  );
  assert.equal(
    packageJson.scripts["framework:doctor"],
    "node scripts/framework/framework-doctor.mjs",
  );
  assert.equal(packageJson.scripts["platform:detect"], "node scripts/platform/detect-platform.mjs");
  assert.equal(packageJson.scripts["codex:start"], "bash scripts/setup/start-codex.sh");
  assert.match(packageJson.scripts.setup, /node scripts\/context\/index-codebase\.mjs --setup$/);
  assert.equal(
    packageJson.scripts["context:check"],
    "node scripts/context/check-context-index.mjs",
  );
  assert.equal(packageJson.scripts["context:index"], "node scripts/context/index-codebase.mjs");
  assert.equal(packageJson.scripts["context:search"], "node scripts/context/search-context.mjs");
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
    generatedManifest,
  ]) {
    assert.equal(content.includes(supportedCodexStartCommand), true);
  }
  assert.match(generatedManifest, /hash-trusted project\s+Stop hook refreshes/);
  assert.match(generatedCodexReadme, /mutable repository-local Codex runtime/);
  assertGeneratedDependencyFreshnessContract(generated);
  assert.match(generatedReadme, /Root `src\/` is the default Product Root/);
  assert.match(generatedReadme, /`pnpm setup` creates the ignored `\.context-index\/`/);
  assert.match(
    generatedReadme,
    /project-local Codex Stop hook refreshes\s+changed indexed sources once per turn/,
  );
  assert.match(
    generatedContextIndex,
    /Use `context:clean` when complete index deletion is intentional/,
  );
  assert.doesNotMatch(generatedContextIndex, /framework:reset|Every framework reset/);
  assert.match(generatedCodexReadme, /Review changed hook hashes through\s+`\/hooks`/);
  assert.equal(
    readFileSync(path.join(generated, ".codex", "hooks.json"), "utf8"),
    readFileSync(path.join(root, ".codex", "hooks.json"), "utf8"),
  );
  assert.equal(
    existsSync(path.join(generated, "scripts/context/refresh-context-index-on-stop.sh")),
    true,
  );
  assert.equal(
    existsSync(path.join(generated, "scripts/context/refresh-context-index-on-stop.mjs")),
    true,
  );
  assertGeneratedWorkflowRuntime(generated);
  assert.equal(
    existsSync(path.join(generated, "scripts/setup/project-initialization-test-helpers.mjs")),
    false,
  );
  const generatedContextWorker = readFileSync(
    path.join(generated, "scripts/context/context-worker-output.mjs"),
    "utf8",
  );
  assert.match(generatedContextWorker, /sanitizeMultilineForTerminal\(output, repositoryRoot\)/);
  assert.match(generatedContextWorker, /stdio: "pipe"/);
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
  assert.equal(focusedVerificationTests.status, 0, focusedVerificationTests.stderr);
  const generatedEntrypointCheck = spawnSync(
    process.execPath,
    ["scripts/verify/verification-entrypoints.mjs"],
    { cwd: generated, encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.equal(generatedEntrypointCheck.status, 0, generatedEntrypointCheck.stderr);
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
  assert.equal(existsSync(path.join(generated, "scripts/context/terminal-output.test.mjs")), true);
  assert.equal(existsSync(path.join(generated, "scripts/context/context-maintenance.mjs")), true);
  assert.equal(
    existsSync(path.join(generated, "scripts/context/context-maintenance-safety.mjs")),
    true,
  );
  assert.equal(
    existsSync(path.join(generated, "scripts/context/context-maintenance.test.mjs")),
    true,
  );
  const generatedRuntimeSources = textFiles(path.join(generated, "scripts", "context")).filter(
    (filePath) => filePath.endsWith(".mjs") && !filePath.endsWith(".test.mjs"),
  );
  const optimizeMethodPattern = new RegExp(`\\.${["opt", "imize"].join("")}\\s*\\(`, "u");
  assert.equal(
    generatedRuntimeSources.some((filePath) =>
      optimizeMethodPattern.test(readFileSync(filePath, "utf8")),
    ),
    false,
  );
  const generatedStoragePath = path.join(generated, "scripts/context/context-storage.mjs");
  const generatedStorage = readFileSync(generatedStoragePath, "utf8");
  writeFileSync(
    generatedStoragePath,
    `${generatedStorage}\nasync function unsafe(table) { await table.optimize(); }\n`,
    "utf8",
  );
  const unsafeRuntimeVerification = spawnSync(
    process.execPath,
    [path.join(generated, "scripts/verify/repository-smoke.mjs")],
    { cwd: generated, encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.equal(unsafeRuntimeVerification.status, 1);
  assert.match(unsafeRuntimeVerification.stderr, /unsafe in-place maintenance/);
  writeFileSync(generatedStoragePath, generatedStorage, "utf8");
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
  assert.match(generatedAgents, /`instructions\.md` owns the complete agent workflow/);
  assert.match(generatedAgents, /checks prerequisites/);
  assert.match(generatedAgents, /Local Codex memory isolation is repository-local and root-bound/);
  for (const content of [generatedAgents, generatedInstructions]) {
    assert.match(content, /no reliable exact\s+anchor/);
    assert.match(content, /cross-file\s+relationships/);
    assert.match(content, /read\s+every matched source/);
    assert.match(content, /failed `rg` attempt is not\s+required/);
    assert.match(content, /pnpm goal:new/);
    assert.match(content, /one\s+user-approved\s+machine-readable owner/);
    assert.match(content, /each fix or user\s+instruction/i);
    assert.match(content, /broad,\s+realistic\s+end-to-end/i);
    assert.match(content, /every\s+new\s+feature/i);
    assert.match(content, /reviewable\s+slices/i);
    assert.match(content, /no\s+relevant\s+finding\s+remains/i);
    assert.match(content, /fresh\s+audit/i);
  }
  for (const content of [generatedAgents, generatedInstructions, generatedManifest]) {
    assert.match(content, /Local Codex memory isolation is repository-local and root-bound/i);
    assert.match(content, /audit\s+finding.*reopen/is);
    assert.match(content, /branch\s+policy\s+permits/i);
    assert.match(content, /marker\s+commit/i);
  }
  for (const content of [generatedAgents, generatedInstructions, generatedManifest]) {
    assert.match(content, /modular\s+monolith/i);
    assert.match(content, /only\s+durable\s+integration\s+branch/i);
    assert.match(content, /not\s+an\s+authentication\s+boundary/i);
    assert.match(content, /every\s+completed\s+slice/i);
    assert.match(content, /without\s+waiting\s+for\s+another\s+prompt/i);
  }
  assert.match(generatedManifest, /Product module map/i);
  assert.match(generatedManifest, /public contract and private internals/i);
  assert.match(generatedInstructions, /replacement test/i);
  assert.match(generatedInstructions, /exactly one write owner/i);
  assert.match(generatedAgents, /temporary task branches/i);
  for (const content of [generatedAgents, generatedInstructions, generatedManifest]) {
    assert.match(content, /Project\s+Definition\s+Intake/i);
  }
  assert.match(generatedReadme, /## First Prompt: Define The Project/i);
  assert.match(generatedAgents, /first user interaction/i);
  assert.match(generatedInstructions, /Begin\s+the\s+first\s+response/i);
  assert.match(generatedInstructions, /final\s+opportunity\s+to\s+correct/i);
  assert.match(generatedReadme, /same\s+focused\s+intake\s+resumes\s+later/i);
  assert.match(generatedAgents, /short safe-entry bootstrap/);
  assert.equal(generatedAgents.length < generatedInstructions.length, true);
  assert.match(generatedAgents, /major milestone/i);
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
  assert.match(generatedReadme, /pnpm context:search.*semantic\s+discovery/s);
  assert.match(generatedManifest, /replace-in-place\s+record/i);
  for (const filePath of [generatedRetrievalSkill, generatedRetrievalMetadata]) {
    const stats = lstatSync(filePath);
    assert.equal(stats.isFile(), true);
    assert.equal(stats.isSymbolicLink(), false);
  }
  assert.equal(
    readFileSync(generatedRetrievalSkill, "utf8"),
    readFileSync(path.join(root, ".agents/skills/context-retrieval/SKILL.md"), "utf8"),
  );
  assert.equal(
    readFileSync(generatedRetrievalMetadata, "utf8"),
    readFileSync(path.join(root, ".agents/skills/context-retrieval/agents/openai.yaml"), "utf8"),
  );
  assert.match(readFileSync(generatedRetrievalMetadata, "utf8"), /allow_implicit_invocation: true/);
  for (const role of ["default", "explorer", "worker"]) {
    const roleContent = readFileSync(
      path.join(generated, ".codex", "agents", `${role}.toml`),
      "utf8",
    );
    assert.match(roleContent, /context:search/, role);
    assert.match(roleContent, /matched source/, role);
    assert.match(roleContent, /whole-repository course check/, role);
    assert.match(roleContent, /context recovery/, role);
    assert.match(roleContent, /milestone/, role);
    assert.match(roleContent, /fresh audit/, role);
    assert.match(roleContent, /audit finding reopens/, role);
    assert.match(roleContent, /module/, role);
    assert.match(roleContent, /overlap/, role);
    assert.match(roleContent, /every completed/, role);
    assert.match(roleContent, /do not commit or push/, role);
  }
  assert.match(generatedReadme, /## Project Authority/);
  assert.match(generatedInstructions, /single committed workflow authority/);
  assert.match(generatedInstructions, /Documentation has no numeric line or word quota/);
  assert.match(generatedInstructions, /at or below 700 physical lines/);
  assert.match(generatedManifest, /Agent workflow authority: `instructions\.md`/);
  assert.match(generatedManifest, /whole-repository course checks/i);
  assert.match(generatedManifest, /Product-first delivery/);
  assert.match(generatedManifest, /failures\s+recompute\s+missing\s+coverage/);
  assert.match(generatedManifest, /major milestone/i);
  assert.match(generatedManifest, /fresh audit/i);
  assert.match(generatedManifest, /pnpm goal:new/);
  assert.match(generatedManifest, /pre-descent mask/);
  assert.match(generatedManifest, /marker\s+commit/);
  assert.match(generatedContextIndex, /opportunistic maintenance/i);
  assert.match(generatedContextIndex, /strictly read-only/i);
  assert.match(generatedContextIndex, /source classifications/i);
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
    "docs/context-index.md",
    "docs/project.md",
    "instructions.md",
  ]);
  const frameworkIdentityFiles = textFiles(generated)
    .filter((filePath) => /\bCodexRig\b/i.test(readFileSync(filePath, "utf8")))
    .map((filePath) => path.relative(generated, filePath).split(path.sep).join("/"))
    .filter(
      (relativePath) =>
        !relativePath.startsWith(".codex/") &&
        !relativePath.startsWith(".codexrig/") &&
        !relativePath.startsWith("scripts/"),
    )
    .sort();
  assert.deepEqual(frameworkIdentityFiles, [
    "AGENTS.md",
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
