/** Verifies deterministic automatic framework SemVer reconciliation and product-version isolation. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { serializeCanonicalJson } from "../contracts/framework-contract.mjs";
import { cleanGitEnvironment } from "../repository/git-runtime-isolation.mjs";
import { applyHousekeepingWrites } from "../goals/repository-housekeeping.mjs";
import {
  frameworkVersionEndMarker,
  frameworkVersionReconciliationPlan,
  frameworkVersionStartMarker,
  nextFrameworkVersion,
  projectManifestWithFrameworkVersion,
} from "./framework-version.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");

function write(root, relativePath, content) {
  const target = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function git(root, args) {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=CodexRig Test",
      "-c",
      "user.email=codexrig@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: cleanGitEnvironment(),
      input: "",
      stdio: "pipe",
    },
  );
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}

function versionManifest(version, schemaVersion = 2) {
  return `# Project Manifest

## Constraints And Decisions

${frameworkVersionStartMarker}

- Framework version: \`${version}\`.
- Framework contract schema: \`${schemaVersion}\`.

${frameworkVersionEndMarker}
`;
}

function fixture(t, { reusable = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "codexrig-version-"));
  const remote = mkdtempSync(path.join(os.tmpdir(), "codexrig-version-remote-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  t.after(() => rmSync(remote, { force: true, recursive: true }));
  const contract = JSON.parse(
    readFileSync(path.join(repositoryRoot, ".codexrig/framework.json"), "utf8"),
  );
  contract.frameworkVersion = "2.1.0";
  write(root, ".codexrig/framework.json", serializeCanonicalJson(contract));
  write(
    root,
    ".codexrig/policy-projection.json",
    readFileSync(path.join(repositoryRoot, ".codexrig/policy-projection.json"), "utf8"),
  );
  write(
    root,
    "package.json",
    serializeCanonicalJson({
      name: reusable ? "codexrig" : "generated-product",
      version: reusable ? "2.1.0" : "0.1.0",
      private: true,
      type: "module",
      scripts: { "framework:doctor": "node doctor.mjs" },
    }),
  );
  write(root, "docs/project.md", versionManifest("2.1.0"));
  write(root, "README.md", "# Fixture\n");
  if (reusable) {
    write(root, ".agents/skills/create-project-from-framework/SKILL.md", "# Generator\n");
  }
  git(remote, ["init", "--bare", "--quiet"]);
  git(root, ["init", "--quiet", "--initial-branch=main"]);
  git(root, ["add", "--all"]);
  git(root, ["commit", "--quiet", "-m", "baseline"]);
  git(root, ["remote", "add", "origin", remote]);
  git(root, ["push", "--quiet", "--set-upstream", "origin", "main"]);
  return root;
}

function setMirroredVersion(root, version) {
  const contractPath = path.join(root, ".codexrig/framework.json");
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  contract.frameworkVersion = version;
  write(root, ".codexrig/framework.json", serializeCanonicalJson(contract));
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  packageJson.version = version;
  write(root, "package.json", serializeCanonicalJson(packageJson));
  write(root, "docs/project.md", versionManifest(version));
}

test("framework version helpers produce stable major, minor, and patch successors", () => {
  assert.equal(nextFrameworkVersion("2.3.4", "major"), "3.0.0");
  assert.equal(nextFrameworkVersion("2.3.4", "minor"), "2.4.0");
  assert.equal(nextFrameworkVersion("2.3.4", "patch"), "2.3.5");
  assert.throws(() => nextFrameworkVersion("2.3.4-beta.1", "patch"), /stable semantic version/u);
  assert.throws(
    () =>
      projectManifestWithFrameworkVersion(
        `${versionManifest("2.3.4")}\n${versionManifest("2.3.4")}`,
        "2.3.5",
        2,
      ),
    /at most one complete source-framework version block/u,
  );
  assert.throws(
    () =>
      projectManifestWithFrameworkVersion(
        "- Version `1.0.0` with contract schema `1` is the current clean framework line.\n",
        "2.3.5",
        2,
      ),
    /missing its bounded source-framework version block/u,
  );
});

test("documentation-only change receives one idempotent patch release", (t) => {
  const root = fixture(t);
  write(root, "README.md", "# Fixture\n\nChanged documentation.\n");
  const plan = frameworkVersionReconciliationPlan({ root });
  assert.equal(plan.requiredBump, "patch");
  assert.equal(plan.targetVersion, "2.1.1");
  assert.deepEqual(
    plan.writes.map((writePlan) => writePlan.relativePath),
    [".codexrig/framework.json", "package.json", "docs/project.md"],
  );
  applyHousekeepingWrites({ root, writes: plan.writes });
  const repeated = frameworkVersionReconciliationPlan({ root });
  assert.equal(repeated.targetVersion, "2.1.1");
  assert.deepEqual(repeated.writes, []);
  assert.deepEqual(repeated.driftFindings, []);
});

test("deleting test-only coverage is patch-level while deleting production capability is major", (t) => {
  const testRoot = fixture(t);
  write(testRoot, "scripts/framework/example.test.mjs", "export const covered = true;\n");
  git(testRoot, ["add", "scripts/framework/example.test.mjs"]);
  git(testRoot, ["commit", "--quiet", "-m", "publish test coverage"]);
  git(testRoot, ["push", "--quiet", "origin", "main"]);
  rmSync(path.join(testRoot, "scripts/framework/example.test.mjs"));
  assert.equal(frameworkVersionReconciliationPlan({ root: testRoot }).requiredBump, "patch");

  const productionRoot = fixture(t);
  write(
    productionRoot,
    "scripts/framework/example-capability.mjs",
    "export const enabled = true;\n",
  );
  git(productionRoot, ["add", "scripts/framework/example-capability.mjs"]);
  git(productionRoot, ["commit", "--quiet", "-m", "publish capability"]);
  git(productionRoot, ["push", "--quiet", "origin", "main"]);
  rmSync(path.join(productionRoot, "scripts/framework/example-capability.mjs"));
  assert.equal(frameworkVersionReconciliationPlan({ root: productionRoot }).requiredBump, "major");
});

test("new framework capability receives a minor release", (t) => {
  const root = fixture(t);
  write(root, "scripts/example-capability.mjs", "export const enabled = true;\n");
  const plan = frameworkVersionReconciliationPlan({ root });
  assert.equal(plan.requiredBump, "minor");
  assert.equal(plan.minimumVersion, "2.2.0");
});

test("committed but unpublished capabilities remain part of the release calculation", (t) => {
  const root = fixture(t);
  write(root, "scripts/committed-capability.mjs", "export const enabled = true;\n");
  git(root, ["add", "scripts/committed-capability.mjs"]);
  git(root, ["commit", "--quiet", "-m", "unpublished capability"]);

  const plan = frameworkVersionReconciliationPlan({ root });
  assert.equal(plan.baselineReference, "refs/remotes/origin/main");
  assert.equal(plan.requiredBump, "minor");
  assert.equal(plan.minimumVersion, "2.2.0");
  assert.equal(plan.changedPaths.includes("scripts/committed-capability.mjs"), true);
});

test("source release reconciliation fails closed without the central upstream", (t) => {
  const root = fixture(t);
  git(root, ["branch", "--unset-upstream"]);
  assert.throws(
    () => frameworkVersionReconciliationPlan({ root }),
    /integration branch main remote must have exactly one local Git configuration value/iu,
  );
});

test("source release reconciliation fails closed for a stale remote-tracking baseline", (t) => {
  const root = fixture(t);
  const publishedCommit = git(root, ["rev-parse", "refs/remotes/origin/main"]);
  write(root, "scripts/published-capability.mjs", "export const enabled = true;\n");
  git(root, ["add", "scripts/published-capability.mjs"]);
  git(root, ["commit", "--quiet", "-m", "remote publication"]);
  git(root, ["push", "--quiet", "origin", "main"]);
  git(root, ["update-ref", "refs/remotes/origin/main", publishedCommit]);

  assert.throws(
    () => frameworkVersionReconciliationPlan({ root }),
    /publication baseline is stale; fetch origin/iu,
  );
});

test("source release reconciliation rejects an ambiguous central remote", (t) => {
  const root = fixture(t);
  git(root, ["config", "--add", "remote.origin.url", path.join(root, "another-remote.git")]);
  assert.throws(
    () => frameworkVersionReconciliationPlan({ root }),
    /central remote origin URL must have exactly one local Git configuration value/iu,
  );
});

test("managed-surface removal receives a major release", (t) => {
  const root = fixture(t);
  const contractPath = path.join(root, ".codexrig/framework.json");
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  contract.upgrade.managedRoots = contract.upgrade.managedRoots.filter(
    (entry) => entry !== ".codex/agents",
  );
  write(root, ".codexrig/framework.json", serializeCanonicalJson(contract));
  const plan = frameworkVersionReconciliationPlan({ root });
  assert.equal(plan.requiredBump, "major");
  assert.equal(plan.minimumVersion, "3.0.0");
});

test("policy reconciliation documents follow their own framework snapshot across retirement", (t) => {
  const root = fixture(t);
  const contract = JSON.parse(readFileSync(path.join(root, ".codexrig/framework.json"), "utf8"));
  const projection = JSON.parse(
    readFileSync(path.join(root, ".codexrig/policy-projection.json"), "utf8"),
  );
  const document = "docs/operations.md";
  contract.upgrade.projectOwnedDocuments.push(document);
  projection.policies[0].reconcileDocuments.push(document);
  projection.policies[0].version += 1;
  write(root, ".codexrig/framework.json", serializeCanonicalJson(contract));
  write(root, ".codexrig/policy-projection.json", serializeCanonicalJson(projection));
  write(root, document, "# Operations\n\nOwns the fixture operations policy.\n");
  git(root, ["add", "--all"]);
  git(root, ["commit", "--quiet", "-m", "publish owned operations document"]);
  git(root, ["push", "--quiet", "origin", "main"]);

  contract.upgrade.projectOwnedDocuments = contract.upgrade.projectOwnedDocuments.filter(
    (entry) => entry !== document,
  );
  write(root, ".codexrig/framework.json", serializeCanonicalJson(contract));
  assert.throws(
    () => frameworkVersionReconciliationPlan({ root }),
    /reconcileDocuments contains unsupported value docs\/operations\.md/u,
  );
  projection.policies[0].reconcileDocuments = projection.policies[0].reconcileDocuments.filter(
    (entry) => entry !== document,
  );
  projection.policies[0].version += 1;
  write(root, ".codexrig/policy-projection.json", serializeCanonicalJson(projection));
  rmSync(path.join(root, document));

  const plan = frameworkVersionReconciliationPlan({ root });
  assert.equal(plan.requiredBump, "major");
  assert.equal(plan.targetVersion, "3.0.0");
  applyHousekeepingWrites({ root, writes: plan.writes });
  assert.deepEqual(frameworkVersionReconciliationPlan({ root }).writes, []);
});

test("policy content cannot change without its own policy-version increment", (t) => {
  const root = fixture(t);
  const projectionPath = path.join(root, ".codexrig/policy-projection.json");
  const projection = JSON.parse(readFileSync(projectionPath, "utf8"));
  projection.policies[0].statement = `${projection.policies[0].statement} Changed without version.`;
  write(root, ".codexrig/policy-projection.json", serializeCanonicalJson(projection));
  assert.throws(
    () => frameworkVersionReconciliationPlan({ root }),
    /changed without increasing its policy version/u,
  );
});

test("an incompatible published schema is a major boundary, not an interpreted contract", (t) => {
  const root = fixture(t);
  const contractPath = path.join(root, ".codexrig/framework.json");
  const projectionPath = path.join(root, ".codexrig/policy-projection.json");
  const packagePath = path.join(root, "package.json");
  const manifestPath = path.join(root, "docs/project.md");
  const currentContract = readFileSync(contractPath, "utf8");
  const currentProjection = readFileSync(projectionPath, "utf8");
  const currentPackage = readFileSync(packagePath, "utf8");
  const currentManifest = readFileSync(manifestPath, "utf8");
  const incompatibleContract = JSON.parse(currentContract);
  incompatibleContract.schemaVersion = 1;
  incompatibleContract.frameworkVersion = "1.9.0";
  write(root, ".codexrig/framework.json", serializeCanonicalJson(incompatibleContract));
  const incompatibleProjection = JSON.parse(currentProjection);
  incompatibleProjection.schemaVersion = 2;
  write(root, ".codexrig/policy-projection.json", serializeCanonicalJson(incompatibleProjection));
  const publishedPackage = JSON.parse(currentPackage);
  publishedPackage.version = "1.9.0";
  write(root, "package.json", serializeCanonicalJson(publishedPackage));
  write(root, "docs/project.md", versionManifest("1.9.0", 1));
  git(root, [
    "add",
    ".codexrig/framework.json",
    ".codexrig/policy-projection.json",
    "package.json",
    "docs/project.md",
  ]);
  git(root, ["commit", "--quiet", "-m", "publish older policy schema"]);
  git(root, ["push", "--quiet", "origin", "main"]);
  write(root, ".codexrig/framework.json", currentContract);
  write(root, ".codexrig/policy-projection.json", currentProjection);
  write(root, "package.json", currentPackage);
  write(root, "docs/project.md", currentManifest);

  const plan = frameworkVersionReconciliationPlan({ root });
  assert.equal(plan.requiredBump, "major");
  assert.equal(plan.minimumVersion, "2.0.0");
});

test("an explicit higher synchronized release is preserved", (t) => {
  const root = fixture(t);
  write(root, "README.md", "# Fixture\n\nChanged documentation.\n");
  setMirroredVersion(root, "2.5.0");
  const plan = frameworkVersionReconciliationPlan({ root });
  assert.equal(plan.requiredBump, "patch");
  assert.equal(plan.minimumVersion, "2.1.1");
  assert.equal(plan.targetVersion, "2.5.0");
  assert.deepEqual(plan.writes, []);
});

test("divergent source version mirrors reconcile to the highest valid release", (t) => {
  const root = fixture(t);
  const contractPath = path.join(root, ".codexrig/framework.json");
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  contract.frameworkVersion = "2.2.0";
  write(root, ".codexrig/framework.json", serializeCanonicalJson(contract));
  const plan = frameworkVersionReconciliationPlan({ root });
  assert.equal(plan.requiredBump, "none");
  assert.equal(plan.targetVersion, "2.2.0");
  assert.deepEqual(
    plan.writes.map((writePlan) => writePlan.relativePath),
    ["package.json", "docs/project.md"],
  );
});

test("generated products keep their package version outside source release automation", (t) => {
  const root = fixture(t, { reusable: false });
  const before = readFileSync(path.join(root, "package.json"), "utf8");
  const plan = frameworkVersionReconciliationPlan({ root });
  assert.equal(plan.applicable, false);
  assert.deepEqual(plan.writes, []);
  assert.equal(readFileSync(path.join(root, "package.json"), "utf8"), before);
});
