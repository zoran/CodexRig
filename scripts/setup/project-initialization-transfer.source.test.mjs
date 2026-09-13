/** Verifies project initialization transfer behavior for the setup, launch, and portable project boundary. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { copyPortableSetupFixture } from "./setup-regression-test-helpers.mjs";
import {
  assertGeneratedProjectQuality,
  cleanupTemporaryRoots,
  initializeTrackedSource,
  isolatedTrackedFrameworkSource,
  root,
  runProjectGenerator,
  temporaryRoot,
} from "./project-initialization-test-helpers.mjs";

after(cleanupTemporaryRoots);

test("clean project initialization escapes and formats long project names", () => {
  const source = isolatedTrackedFrameworkSource("long-project-source-");
  const outputParent = temporaryRoot("long-project-name-");
  const projectName =
    "A [linked project label with many words](https://example.invalid/path) that remains neutral";
  const projectDescription =
    "Field technicians document offline equipment inspections on phones and supervisors review exceptions on desktop.\n\nThe first release should support German and English; billing is only a later idea. # Not a manifest heading";
  const result = runProjectGenerator([
    "--name",
    projectName,
    "--description",
    projectDescription,
    "--directory",
    "long-project-name-fixture",
    "--source",
    source,
    "--output-parent",
    outputParent,
    "--include-untracked",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const generated = path.join(outputParent, "long-project-name-fixture", "code");
  assert.match(readFileSync(path.join(generated, "README.md"), "utf8"), /^# A \\\[linked/m);
  const manifest = readFileSync(path.join(generated, "docs/project.md"), "utf8");
  const requirements = readFileSync(path.join(generated, "docs/requirements.md"), "utf8");
  assert.match(manifest, /Requirements owner: \[Product requirements\]\(requirements\.md\)/u);
  assert.doesNotMatch(manifest, /Field technicians|Initial Project Description/u);
  assert.match(requirements, /Field technicians document offline equipment inspections/u);
  assert.match(requirements, /billing is only a later idea/u);
  assert.match(manifest, /pending intake validation of the supplied creation brief/u);
  assert.doesNotMatch(manifest, /^# Not a manifest heading$/mu);
  assert.match(result.stdout, /stored as an intake draft/u);
  assertGeneratedProjectQuality(generated);
  const verificationPlan = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { existsSync } from 'node:fs';
import { completeVerificationCommands } from './scripts/verify/adaptive-runner.mjs';
const missing = completeVerificationCommands().flatMap(command => command.args)
  .filter(argument => argument.endsWith('.test.mjs') && !existsSync(argument));
console.log(JSON.stringify(missing));`,
    ],
    { cwd: generated, encoding: "utf8" },
  );
  assert.equal(verificationPlan.status, 0, verificationPlan.stderr);
  assert.deepEqual(
    JSON.parse(verificationPlan.stdout),
    [],
    "child verification must use installed suites",
  );
  for (let pass = 0; pass < 2; pass += 1) {
    const ensure = spawnSync(process.execPath, ["scripts/docs/ensure-project-manifest.mjs"], {
      cwd: generated,
      encoding: "utf8",
    });
    assert.equal(ensure.status, 0, ensure.stderr);
    assert.equal(readFileSync(path.join(generated, "docs/project.md"), "utf8"), manifest);
    assert.equal(readFileSync(path.join(generated, "docs/requirements.md"), "utf8"), requirements);
  }
  // Later documentation becomes discoverable through a link, without copying its contents.
  writeFileSync(
    path.join(generated, "docs/operations.html"),
    '<!doctype html><title>Operations</title><h1 id="recovery">Recovery</h1><p>Restore inspections from the operator backup.</p>',
  );
  const docsCheck = () =>
    spawnSync(process.execPath, ["scripts/verify/docs.mjs"], { cwd: generated, encoding: "utf8" });
  const missingDiscovery = docsCheck();
  assert.equal(missingDiscovery.status, 1);
  assert.match(missingDiscovery.stderr, /README.md must link to docs\/operations.html/);
  const readmePath = path.join(generated, "README.md");
  writeFileSync(
    readmePath,
    readFileSync(readmePath, "utf8") + "\n[Operations](docs/operations.html#recovery)\n",
  );
  const discovered = docsCheck();
  assert.equal(discovered.status, 0, discovered.stderr);
  assert.doesNotMatch(
    readFileSync(readmePath, "utf8"),
    /Restore inspections from the operator backup|Field technicians document/u,
  );
});

test("clean project initialization excludes untracked source drafts by default", () => {
  const sourceParent = temporaryRoot("tracked-project-source-");
  const source = path.join(sourceParent, "source");
  copyPortableSetupFixture(source);
  writeFileSync(path.join(source, "docs", "tracked-guide.mdx"), "# Tracked guide\n", "utf8");
  initializeTrackedSource(source);
  const untrackedRuntimeContract = spawnSync(
    "git",
    ["rm", "--cached", "--quiet", "mise.lock", "mise.toml"],
    { cwd: source, encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.equal(untrackedRuntimeContract.status, 0, untrackedRuntimeContract.stderr);
  const draftPath = path.join(source, "drafts", "untracked.txt");
  mkdirSync(path.dirname(draftPath), { recursive: true });
  writeFileSync(draftPath, "do not transfer this working-tree draft\n", "utf8");

  const outputParent = temporaryRoot("tracked-project-output-");
  const result = runProjectGenerator([
    "--name",
    "Tracked Snapshot Fixture",
    "--directory",
    "tracked-snapshot-fixture",
    "--source",
    source,
    "--output-parent",
    outputParent,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    existsSync(
      path.join(outputParent, "tracked-snapshot-fixture", "code", "drafts", "untracked.txt"),
    ),
    false,
  );
  assert.equal(
    existsSync(
      path.join(outputParent, "tracked-snapshot-fixture", "code", "docs", "tracked-guide.mdx"),
    ),
    false,
  );
  assert.equal(
    existsSync(path.join(outputParent, "tracked-snapshot-fixture", "code", "mise.toml")),
    true,
  );
  assert.equal(
    existsSync(path.join(outputParent, "tracked-snapshot-fixture", "code", "mise.lock")),
    true,
  );
  assert.equal(
    existsSync(
      path.join(
        outputParent,
        "tracked-snapshot-fixture",
        "code",
        "scripts/deps/dependency-owner-normalization.test.mjs",
      ),
    ),
    false,
  );

  const unpublishedContracts = [
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "scripts/verify/adaptive-options.mjs",
  ];
  const unpublished = spawnSync("git", ["rm", "--cached", "--quiet", ...unpublishedContracts], {
    cwd: source,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
  });
  assert.equal(unpublished.status, 0, unpublished.stderr);
  const rejectedOutput = temporaryRoot("tracked-project-rejected-");
  const rejected = runProjectGenerator([
    "--name",
    "Rejected Unpublished Contract",
    "--directory",
    "rejected-unpublished-contract",
    "--source",
    source,
    "--output-parent",
    rejectedOutput,
  ]);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /commit them or use --include-untracked/);
  for (const unpublishedContract of unpublishedContracts) {
    assert.match(rejected.stderr, new RegExp(unpublishedContract.replaceAll(".", "\\.")));
  }
  assert.equal(existsSync(path.join(rejectedOutput, "rejected-unpublished-contract")), false);

  const consentOutput = temporaryRoot("tracked-project-consent-");
  const consent = runProjectGenerator([
    "--name",
    "Consented Working Tree Snapshot",
    "--directory",
    "consented-working-tree-snapshot",
    "--source",
    source,
    "--output-parent",
    consentOutput,
    "--include-untracked",
  ]);
  assert.equal(consent.status, 0, consent.stderr);
  for (const unpublishedContract of unpublishedContracts) {
    assert.equal(
      existsSync(
        path.join(consentOutput, "consented-working-tree-snapshot", "code", unpublishedContract),
      ),
      true,
    );
  }
  assert.equal(
    existsSync(
      path.join(
        consentOutput,
        "consented-working-tree-snapshot",
        "code",
        "drafts",
        "untracked.txt",
      ),
    ),
    false,
  );

  const lockfilePath = path.join(source, "pnpm-lock.yaml");
  const lockfile = readFileSync(lockfilePath, "utf8");
  rmSync(lockfilePath);
  const missingLockOutput = temporaryRoot("missing-lock-project-");
  const missingLock = runProjectGenerator([
    "--name",
    "Missing Lock Contract",
    "--directory",
    "missing-lock-contract",
    "--source",
    source,
    "--output-parent",
    missingLockOutput,
    "--include-untracked",
  ]);
  assert.equal(missingLock.status, 1);
  assert.match(missingLock.stderr, /Missing required repository file: pnpm-lock\.yaml/u);
  assert.equal(existsSync(path.join(missingLockOutput, "missing-lock-contract")), false);
  writeFileSync(lockfilePath, lockfile, "utf8");

  const sourceFormatter = path.join(source, "node_modules", "prettier");
  rmSync(sourceFormatter, { force: true, recursive: true });
  mkdirSync(path.join(sourceFormatter, "bin"), { recursive: true });
  writeFileSync(path.join(sourceFormatter, "bin", "prettier.cjs"), "process.exit(73);\n", "utf8");
  const formatterOutput = temporaryRoot("source-formatter-owner-");
  const formatterFailure = runProjectGenerator([
    "--name",
    "Source Formatter Owner",
    "--directory",
    "source-formatter-owner",
    "--source",
    source,
    "--output-parent",
    formatterOutput,
    "--include-untracked",
  ]);
  assert.equal(formatterFailure.status, 1);
  assert.match(formatterFailure.stderr, /Generated Markdown formatter failed with status 73/);
  assert.equal(existsSync(path.join(formatterOutput, "source-formatter-owner")), false);
});
