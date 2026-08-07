import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { stageProjectExport } from "./stage-project-export.mjs";
import {
  cleanupTemporaryRoots,
  initializeTrackedSource,
  readdirNames,
  root,
  runProjectGenerator,
  temporaryRoot,
} from "./project-initialization-test-helpers.mjs";

after(cleanupTemporaryRoots);

function copyMissingRuntimeContracts(source, runtimeContracts) {
  for (const runtimeContract of runtimeContracts) {
    const target = path.join(source, runtimeContract);
    if (existsSync(target)) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(root, runtimeContract), target);
  }
}

test("clean project initialization preserves additional validated agent roles", () => {
  const sourceParent = temporaryRoot("additional-agent-source-");
  const source = path.join(sourceParent, "source");
  stageProjectExport({ includeUntracked: true, sourceRoot: root, targetRoot: source });
  copyMissingRuntimeContracts(source, [
    ".codex/hooks.json",
    "mise.lock",
    "mise.toml",
    "scripts/context/portable-context-contract.mjs",
    "scripts/context/context-maintenance-safety.mjs",
    "scripts/context/context-publication-policy.mjs",
    "scripts/context/refresh-context-index-on-stop.mjs",
    "scripts/context/refresh-context-index-on-stop.sh",
    "scripts/context/terminal-output.test.mjs",
    "scripts/deps/dependency-owner-normalization.test.mjs",
    "scripts/goals/goal-publication-precondition.mjs",
    "scripts/goals/goal-publication-precondition.test.mjs",
    "scripts/repository/product-roots.mjs",
    "scripts/repository/product-roots.test.mjs",
    "scripts/repository/stable-file-snapshot.test.mjs",
    "scripts/setup/codex-launcher.test.mjs",
    "scripts/setup/setup-regression-fixtures.mjs",
    "scripts/verify/format-project.mjs",
    "scripts/verify/adaptive-cli.test.mjs",
    "scripts/verify/adaptive-options.mjs",
    "scripts/verify/verification-admission.mjs",
    "scripts/verify/adaptive-runner-routing.test.mjs",
    "scripts/verify/adaptive-runner-test-helpers.mjs",
    "scripts/verify/adaptive-runner.test.mjs",
    "scripts/verify/package-manifest.mjs",
    "scripts/verify/package-manifest.test.mjs",
    "scripts/verify/pre-push-steps.sh",
    "scripts/verify/pre-push.test.mjs",
    "scripts/verify/verification-evidence.mjs",
    "scripts/verify/verification-evidence-record.mjs",
    "scripts/verify/verification-evidence-integrity.test.mjs",
    "scripts/verify/verification-evidence-test-helpers.mjs",
    "scripts/verify/verification-evidence.test.mjs",
    "scripts/verify/verification-entrypoints.mjs",
    "scripts/verify/verification-executor.test.mjs",
    "scripts/verify/verification-git-basis.test.mjs",
    "scripts/verify/verification-risk-profile.mjs",
    "scripts/verify/verification-record-helpers.mjs",
    "scripts/verify/verification-runtime-identity.mjs",
    "scripts/verify/verification-git-basis.mjs",
    "scripts/verify/verification-session-lock.mjs",
    "scripts/verify/verification-session-lock.test.mjs",
    "scripts/verify/workspace-verification.mjs",
    "scripts/web/update-sitemap-lastmod.test.mjs",
  ]);
  const reviewerPath = path.join(source, ".codex", "agents", "reviewer.toml");
  const reviewer = readFileSync(path.join(source, ".codex", "agents", "default.toml"), "utf8")
    .replace('name = "default"', 'name = "reviewer"')
    .replace(
      'description = "General delegated work that does not require a narrower built-in role."',
      'description = "Bounded read-only review of a completed implementation slice."',
    )
    .concat('model_reasoning_effort = "ultra"\nsandbox_mode = "read-only"\n');
  writeFileSync(reviewerPath, reviewer, "utf8");
  initializeTrackedSource(source);

  const outputParent = temporaryRoot("additional-agent-output-");
  const result = runProjectGenerator([
    "--name",
    "Additional Agent Fixture",
    "--directory",
    "additional-agent-fixture",
    "--source",
    source,
    "--output-parent",
    outputParent,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const generatedReviewer = path.join(
    outputParent,
    "additional-agent-fixture",
    "code",
    ".codex",
    "agents",
    "reviewer.toml",
  );
  assert.equal(readFileSync(generatedReviewer, "utf8"), reviewer);
});

test("clean project initialization preserves a safe project folder and ends at code", () => {
  const outputParent = temporaryRoot("named-project-output-");
  const projectArgs = [
    "--name",
    "NamedProjectFixture",
    "--source",
    root,
    "--output-parent",
    outputParent,
    "--include-untracked",
  ];
  const result = runProjectGenerator(projectArgs);
  assert.equal(result.status, 0, result.stderr);

  const projectRoot = path.join(outputParent, "NamedProjectFixture");
  const generated = path.join(projectRoot, "code");
  assert.deepEqual(readdirNames(projectRoot), ["code"]);
  assert.equal(existsSync(path.join(generated, "package.json")), true);
  assert.equal(
    JSON.parse(readFileSync(path.join(generated, "package.json"), "utf8")).name,
    "namedprojectfixture",
  );
  assert.match(result.stdout, /Created the project successfully/);
  assert.equal(`${result.stdout}${result.stderr}`.includes(generated), false);
  assert.equal(`${result.stdout}${result.stderr}`.includes(outputParent), false);

  const duplicate = runProjectGenerator(projectArgs);
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /Target project directory already exists\./);
  assert.equal(`${duplicate.stdout}${duplicate.stderr}`.includes(projectRoot), false);
  assert.equal(`${duplicate.stdout}${duplicate.stderr}`.includes(outputParent), false);

  const missingSource = path.join(outputParent, "synthetic-secret-source-path");
  const missing = runProjectGenerator([
    "--name",
    "Missing Source Fixture",
    "--source",
    missingSource,
  ]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Missing required source repository/);
  assert.equal(`${missing.stdout}${missing.stderr}`.includes(missingSource), false);
});

test("clean project initialization refuses a polluted source baseline", () => {
  const sourceParent = temporaryRoot("polluted-project-source-");
  const source = path.join(sourceParent, "source");
  stageProjectExport({ includeUntracked: true, sourceRoot: root, targetRoot: source });
  copyMissingRuntimeContracts(source, [
    ".codex/hooks.json",
    "mise.lock",
    "mise.toml",
    "scripts/context/refresh-context-index-on-stop.mjs",
    "scripts/context/refresh-context-index-on-stop.sh",
    "scripts/verify/format-project.mjs",
  ]);
  initializeTrackedSource(source);
  writeFileSync(path.join(source, "docs", "project-context.md"), "# Temporary context\n", "utf8");

  const outputParent = temporaryRoot("polluted-project-output-");
  const result = runProjectGenerator([
    "--name",
    "PollutedSourceFixture",
    "--source",
    source,
    "--output-parent",
    outputParent,
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Source framework baseline is not clean/);
  assert.match(result.stderr, /docs\/project-context\.md/);
  assert.equal(existsSync(path.join(outputParent, "PollutedSourceFixture")), false);
});

test("clean project initialization refuses agent artifacts inside a product root", () => {
  const sourceParent = temporaryRoot("polluted-product-boundary-source-");
  const source = path.join(sourceParent, "source");
  stageProjectExport({ includeUntracked: true, sourceRoot: root, targetRoot: source });
  copyMissingRuntimeContracts(source, [
    ".codex/hooks.json",
    "mise.lock",
    "mise.toml",
    "scripts/context/refresh-context-index-on-stop.mjs",
    "scripts/context/refresh-context-index-on-stop.sh",
    "scripts/verify/format-project.mjs",
  ]);
  writeFileSync(path.join(source, "src", "AGENTS.md"), "agent pollution\n", "utf8");
  initializeTrackedSource(source);

  const outputParent = temporaryRoot("polluted-product-boundary-output-");
  const result = runProjectGenerator([
    "--name",
    "PollutedProductBoundaryFixture",
    "--source",
    source,
    "--output-parent",
    outputParent,
  ]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /src\/AGENTS\.md: agent instruction path is forbidden inside product unit src/,
  );
  assert.equal(existsSync(path.join(outputParent, "PollutedProductBoundaryFixture")), false);
});
