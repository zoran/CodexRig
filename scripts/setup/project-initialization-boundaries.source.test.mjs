/** Verifies project initialization boundaries behavior for the setup, launch, and portable project boundary. */
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { copyPortableSetupFixture } from "./setup-regression-test-helpers.mjs";
import {
  cleanupTemporaryRoots,
  initializeTrackedSource,
  isolatedTrackedFrameworkSource,
  readdirNames,
  root,
  runProjectGenerator,
  temporaryRoot,
} from "./project-initialization-test-helpers.mjs";

after(cleanupTemporaryRoots);

test("clean project initialization includes additional validated agent roles only after explicit selection", () => {
  const sourceParent = temporaryRoot("additional-agent-source-");
  const source = path.join(sourceParent, "source");
  copyPortableSetupFixture(source);
  const reviewerPath = path.join(source, ".codex", "agents", "reviewer.toml");
  const reviewer = readFileSync(path.join(source, ".codex", "agents", "default.toml"), "utf8")
    .replace('name = "default"', 'name = "reviewer"')
    .replace(
      'description = "General read-only delegated analysis that does not require a narrower role."',
      'description = "Bounded read-only review of a completed implementation slice."',
    );
  writeFileSync(reviewerPath, reviewer, "utf8");
  const selectionPath = path.join(source, ".codexrig/project-tools.json");
  const selection = JSON.parse(readFileSync(selectionPath, "utf8"));
  selection.capabilities["project-entry"].push(".codex/agents/reviewer.toml");
  writeFileSync(selectionPath, JSON.stringify(selection));
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
  assert.equal(
    readFileSync(generatedReviewer, "utf8"),
    reviewer
      .replaceAll("CODEXRIG", "PROJECT")
      .replaceAll("CodexRig", "Project")
      .replaceAll("codexrig", "project"),
  );
});

test("clean project initialization preserves a safe project folder and ends at code", () => {
  const source = isolatedTrackedFrameworkSource("named-project-source-");
  const outputParent = temporaryRoot("named-project-output-");
  const projectArgs = [
    "--name",
    "NamedProjectFixture",
    "--source",
    source,
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

test("clean project initialization preserves and excludes private source context", () => {
  const sourceParent = temporaryRoot("polluted-project-source-");
  const source = path.join(sourceParent, "source");
  copyPortableSetupFixture(source);
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
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(path.join(source, "docs/project-context.md"), "utf8"),
    "# Temporary context\n",
  );
  assert.equal(
    existsSync(path.join(outputParent, "PollutedSourceFixture/code/docs/project-context.md")),
    false,
  );
});

test("clean project initialization refuses agent artifacts inside a product root", () => {
  const sourceParent = temporaryRoot("polluted-product-boundary-source-");
  const source = path.join(sourceParent, "source");
  copyPortableSetupFixture(source);
  mkdirSync(path.join(source, "src"), { recursive: true });
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
