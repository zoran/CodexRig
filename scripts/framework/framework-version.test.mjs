/** Verifies deterministic automatic framework SemVer reconciliation and product-version isolation. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { serializeCanonicalJson } from "../filesystem/repository-files.mjs";
import { cleanGitEnvironment } from "../repository/git-runtime-isolation.mjs";
import { reconcileHousekeepingVersion } from "./source-housekeeping.mjs";
import { applyHousekeepingWrites } from "../repository/repository-housekeeping-transaction.mjs";
import { trustedPnpmCommand } from "../deps/trusted-pnpm-command.mjs";
import { pnpmHooksDisabledEnvironment } from "../repository/pnpm-workspace-manifests.mjs";
import { acquireVerificationSessionLock } from "../verify/verification-session-lock.mjs";
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

function versionManifest(version, schemaVersion = 3) {
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
    ".codex/tooling.json",
    readFileSync(path.join(repositoryRoot, ".codex/tooling.json"), "utf8"),
  );
  if (reusable) write(root, ".codexrig/project-tools.json", "{}\n");
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

for (const interrupted of [false, true]) {
  test(`housekeeping leaves guarded pnpm usable after ${interrupted ? "an interrupted" : "a new"} version change`, (t) => {
    const root = fixture(t);
    write(root, ".gitignore", "node_modules/\n.codex/runtime/\n.project-state/\n");
    write(
      root,
      ".codex/toolchain.json",
      readFileSync(path.join(repositoryRoot, ".codex/toolchain.json"), "utf8"),
    );
    write(
      root,
      "pnpm-workspace.yaml",
      "packages: []\nverifyDepsBeforeRun: error\nignorePnpmfile: true\npnpmfile: []\n",
    );
    const command = trustedPnpmCommand({ repositoryRoot: root });
    const pnpm = (args) =>
      spawnSync(command.executable, [...command.argsPrefix, ...args], {
        cwd: root,
        encoding: "utf8",
        env: pnpmHooksDisabledEnvironment(process.env),
        timeout: 30_000,
      });
    const initial = pnpm(["install", "--offline", "--ignore-scripts", "--ignore-pnpmfile"]);
    assert.equal(initial.status, 0, initial.stderr);
    const originalLockfile = readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
    const plan = frameworkVersionReconciliationPlan({ root });
    const probe = () => pnpm(["exec", "node", "-e", "process.exit(0)"]);
    assert.equal(probe().status, 0);
    if (interrupted) {
      applyHousekeepingWrites({ root, writes: plan.writes });
      assert.deepEqual(frameworkVersionReconciliationPlan({ root }).writes, []);
      const blocked = probe();
      assert.notEqual(blocked.status, 0);
      assert.match(`${blocked.stdout}${blocked.stderr}`, /ERR_PNPM_VERIFY_DEPS_BEFORE_RUN/u);
      reconcileHousekeepingVersion({ root, apply: false });
      assert.notEqual(
        probe().status,
        0,
        "check mode must leave stale installation state unchanged",
      );
    }
    const reconcile = () => {
      const lock = acquireVerificationSessionLock({ repositoryRoot: root });
      try {
        reconcileHousekeepingVersion({
          root,
          apply: true,
          lifecycleCapability: lock.lifecycleCapability,
        });
      } finally {
        lock.release();
      }
    };
    if (interrupted) {
      const pendingPlan = ".project-state/dependency-update/plan.json";
      write(root, pendingPlan, "{}\n");
      assert.throws(
        reconcile,
        /reviewed dependency update transaction.*housekeeping is incomplete/su,
      );
      assert.equal(readFileSync(path.join(root, pendingPlan), "utf8"), "{}\n");
      assert.equal(readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"), originalLockfile);
      rmSync(path.join(root, pendingPlan));
    }
    reconcile();
    assert.equal(probe().status, 0);
    assert.equal(
      JSON.parse(readFileSync(path.join(root, "package.json"))).version,
      plan.targetVersion,
    );
    assert.deepEqual(frameworkVersionReconciliationPlan({ root }).writes, []);
    assert.equal(readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"), originalLockfile);
  });
}

test("generated-project housekeeping does not install dependencies or alter product versions", (t) => {
  const root = fixture(t, { reusable: false });
  const manifest = readFileSync(path.join(root, "package.json"), "utf8");
  reconcileHousekeepingVersion({ root, apply: true });
  assert.equal(readFileSync(path.join(root, "package.json"), "utf8"), manifest);
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

test("an incompatible published schema is a major boundary, not an interpreted contract", (t) => {
  const root = fixture(t);
  const contractPath = path.join(root, ".codexrig/framework.json");
  const packagePath = path.join(root, "package.json");
  const manifestPath = path.join(root, "docs/project.md");
  const currentContract = readFileSync(contractPath, "utf8");
  const currentPackage = readFileSync(packagePath, "utf8");
  const currentManifest = readFileSync(manifestPath, "utf8");
  const incompatibleContract = JSON.parse(currentContract);
  incompatibleContract.schemaVersion = 1;
  incompatibleContract.frameworkVersion = "1.9.0";
  write(root, ".codexrig/framework.json", serializeCanonicalJson(incompatibleContract));
  const publishedPackage = JSON.parse(currentPackage);
  publishedPackage.version = "1.9.0";
  write(root, "package.json", serializeCanonicalJson(publishedPackage));
  write(root, "docs/project.md", versionManifest("1.9.0", 1));
  git(root, ["add", ".codexrig/framework.json", "package.json", "docs/project.md"]);
  git(root, ["commit", "--quiet", "-m", "publish older policy schema"]);
  git(root, ["push", "--quiet", "origin", "main"]);
  write(root, ".codexrig/framework.json", currentContract);
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
