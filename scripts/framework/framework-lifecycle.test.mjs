import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  compareSemver,
  parseSemver,
  readFrameworkContract,
  readInstallationReceipt,
  serializeCanonicalJson,
  writeInstallationReceipt,
} from "./framework-contract.mjs";
import {
  applyFrameworkUpgrade,
  buildFrameworkUpgradePlan,
  recoverInterruptedFrameworkUpgrade,
} from "./framework-upgrade.mjs";
import { authorizePlannedLockfile } from "./refresh-upgrade-dependencies.mjs";
import { ciCompatibilityTracks, gitlabChildPipeline } from "./compatibility-matrix.mjs";
import {
  issueRuntimeSessionLease,
  issueStartupAttestation,
  startupAttestedInputs,
  startupControlPolicies,
  verifyStartupAttestation,
} from "../setup/startup-attestation.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");
const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { force: true, recursive: true });
});

function temporaryRoot(prefix) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function write(root, relativePath, content, mode = 0o644) {
  const target = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, { encoding: "utf8", mode });
  chmodSync(target, mode);
}

function contract(version) {
  return {
    schemaVersion: 1,
    frameworkId: "codexrig",
    frameworkVersion: version,
    compatibilityFile: ".codexrig/compatibility.json",
    startup: { attestationMaxAgeSeconds: 600 },
    platform: {
      provider: "auto",
      integrationBranch: "main",
      hosts: { github: ["github.com"], gitlab: ["gitlab.com"] },
      apiBaseUrls: {
        github: { "github.com": "https://api.github.com" },
        gitlab: { "gitlab.com": "https://gitlab.com/api/v4" },
      },
      ci: { requiredCheck: "verify" },
      protection: {
        requiredApprovals: 1,
        requireCodeOwnerReview: false,
        preventAuthorApproval: true,
        preventCommitterApproval: true,
        preventApprovalRuleOverrides: true,
        resetApprovalsOnPush: true,
        mergeSerialization: "prefer",
      },
    },
    upgrade: {
      receiptFile: ".codexrig/installation.json",
      managedRoots: [".codexrig/compatibility.json", ".codexrig/framework.json", "managed"],
      excludedPaths: ["managed/excluded.txt"],
      managedPackageScripts: ["framework:doctor"],
      managedDevDependencies: ["prettier"],
    },
  };
}

const compatibility = {
  schemaVersion: 1,
  reviewedOn: "2026-08-07",
  stable: {
    node: { version: "24.19.0", range: ">=24.19.0 <25.0.0", channel: "lts" },
    pnpm: { version: "11.20.0", range: ">=11.20.0 <12.0.0", channel: "latest-11" },
    codex: { minimumVersion: "0.147.0", channel: "latest" },
  },
  canaries: [
    {
      id: "next-node-lts",
      description: "next Node line",
      node: "26",
      pnpm: "11.20.0",
      codex: "latest",
      required: false,
    },
  ],
};

function packageJson(version) {
  return serializeCanonicalJson({
    name: "codexrig",
    version,
    private: true,
    type: "module",
    packageManager: version === "1.0.0" ? "pnpm@11.19.0" : "pnpm@11.20.0",
    scripts: { "framework:doctor": `node doctor-${version}.mjs` },
    devDependencies: { prettier: version === "1.0.0" ? "^3.8.0" : "^3.9.0" },
  });
}

function frameworkFixture(version, content, { reusable = true } = {}) {
  const root = temporaryRoot(`codexrig-${version}-`);
  write(root, ".codexrig/framework.json", serializeCanonicalJson(contract(version)));
  write(root, ".codexrig/compatibility.json", serializeCanonicalJson(compatibility));
  write(
    root,
    ".codexrig/policy-projection.json",
    readFileSync(path.join(repositoryRoot, ".codexrig/policy-projection.json"), "utf8"),
  );
  if (reusable) {
    write(root, ".agents/skills/create-project-from-framework/SKILL.md", "# Fixture\n");
  }
  write(root, "managed/tool.mjs", content, 0o755);
  write(root, "package.json", packageJson(version));
  write(root, "pnpm-lock.yaml", `lockfileVersion: '${version}'\n`);
  return root;
}

function installedFixture() {
  const root = frameworkFixture("1.0.0", "export const value = 'old';\n", {
    reusable: false,
  });
  writeInstallationReceipt({ root });
  return root;
}

test("framework semantic versions follow prerelease precedence and reject invalid identifiers", () => {
  assert.equal(compareSemver("1.0.0-alpha.2", "1.0.0-alpha.10"), -1);
  assert.equal(compareSemver("1.0.0-alpha.10", "1.0.0"), -1);
  assert.equal(compareSemver("1.0.0+build.1", "1.0.0+build.2"), 0);
  assert.throws(() => parseSemver("1.0.0-alpha..1"), /semantic versioning/);
  assert.throws(() => parseSemver("1.0.0-alpha.01"), /semantic versioning/);
});

test("framework upgrade applies a clean three-way change and records the new contract", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'new';\n");
  const target = installedFixture();
  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });
  assert.deepEqual(plan.conflicts, []);
  assert.ok(plan.publicOperations.some((entry) => entry.path === "managed/tool.mjs"));
  const receipt = applyFrameworkUpgrade(plan, {
    refreshDependencies: () => {},
    repairDependencies: () => {},
  });
  assert.equal(readFrameworkContract(target).frameworkVersion, "2.0.0");
  assert.equal(readInstallationReceipt(target).frameworkVersion, "2.0.0");
  assert.equal(receipt.frameworkVersion, "2.0.0");
  assert.equal(
    readFileSync(path.join(target, "managed/tool.mjs"), "utf8"),
    "export const value = 'new';\n",
  );
  assert.match(readFileSync(path.join(target, "package.json"), "utf8"), /doctor-2\.0\.0/);
});

test("framework upgrade reports divergent edits before writing", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'new';\n");
  const target = installedFixture();
  write(target, "managed/tool.mjs", "export const value = 'local';\n", 0o755);
  const before = readFileSync(path.join(target, "managed/tool.mjs"), "utf8");
  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });
  assert.deepEqual(plan.conflicts, ["managed/tool.mjs"]);
  assert.throws(() => applyFrameworkUpgrade(plan), /has conflicts/);
  assert.equal(readFileSync(path.join(target, "managed/tool.mjs"), "utf8"), before);
});

test("framework upgrade rejects a generated project as its upstream source", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'new';\n", {
    reusable: false,
  });
  const target = installedFixture();
  assert.throws(
    () => buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target }),
    /reusable CodexRig source checkout/,
  );
});

test("framework upgrade keeps the upstream merge base separate from preserved local changes", () => {
  const sourceTwo = frameworkFixture("2.0.0", "export const value = 'old';\n");
  const target = installedFixture();
  write(target, "managed/tool.mjs", "export const value = 'local';\n", 0o755);
  const firstPlan = buildFrameworkUpgradePlan({ sourceRoot: sourceTwo, targetRoot: target });
  assert.deepEqual(firstPlan.conflicts, []);
  applyFrameworkUpgrade(firstPlan, {
    refreshDependencies: () => {},
    repairDependencies: () => {},
  });
  const receipt = readInstallationReceipt(target);
  assert.notEqual(
    receipt.managedFiles["managed/tool.mjs"].sha256,
    receipt.installedFiles["managed/tool.mjs"].sha256,
  );
  assert.equal(
    readFileSync(path.join(target, "managed/tool.mjs"), "utf8"),
    "export const value = 'local';\n",
  );

  const sourceThree = frameworkFixture("3.0.0", "export const value = 'upstream';\n");
  const secondPlan = buildFrameworkUpgradePlan({ sourceRoot: sourceThree, targetRoot: target });
  assert.deepEqual(secondPlan.conflicts, ["managed/tool.mjs"]);
});

test("framework upgrade restores files, receipt, package, and lock after refresh failure", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'new';\n");
  const target = installedFixture();
  const before = Object.fromEntries(
    [
      ".codexrig/framework.json",
      ".codexrig/installation.json",
      "managed/tool.mjs",
      "package.json",
      "pnpm-lock.yaml",
    ].map((relativePath) => [relativePath, readFileSync(path.join(target, relativePath), "utf8")]),
  );
  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });
  assert.throws(
    () =>
      applyFrameworkUpgrade(plan, {
        refreshDependencies: (root) => {
          const content = "partially updated\n";
          authorizePlannedLockfile({ root, content });
          write(root, "pnpm-lock.yaml", content);
          throw new Error("synthetic refresh failure");
        },
        repairDependencies: () => {},
      }),
    /synthetic refresh failure/,
  );
  for (const [relativePath, content] of Object.entries(before)) {
    assert.equal(readFileSync(path.join(target, relativePath), "utf8"), content, relativePath);
  }
});

test("framework upgrade preserves an unrelated target edit when rollback is required", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'new';\n");
  const target = installedFixture();
  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });
  assert.throws(
    () =>
      applyFrameworkUpgrade(plan, {
        refreshDependencies: (root) => {
          write(root, "managed/tool.mjs", "export const value = 'concurrent';\n", 0o755);
          throw new Error("synthetic refresh failure");
        },
        repairDependencies: () => {},
      }),
    /rollback stopped safely.*unrelated change/u,
  );
  assert.equal(
    readFileSync(path.join(target, "managed/tool.mjs"), "utf8"),
    "export const value = 'concurrent';\n",
  );
  assert.equal(
    existsSync(path.join(target, ".project-state/framework-upgrade/journal.json")),
    true,
  );
});

test("framework upgrade receipt uses the immutable planned source snapshot", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'planned';\n");
  const target = installedFixture();
  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });
  const plannedFiles = structuredClone(plan.sourceSnapshot.managedFiles);
  const plannedPackage = structuredClone(plan.sourceSnapshot.managedPackage);
  const receipt = applyFrameworkUpgrade(plan, {
    refreshDependencies: () => {
      write(source, "managed/tool.mjs", "export const value = 'later';\n", 0o755);
      write(source, "package.json", packageJson("1.0.0"));
    },
    repairDependencies: () => {},
  });
  assert.deepEqual(receipt.managedFiles, plannedFiles);
  assert.deepEqual(receipt.managedPackage, plannedPackage);
  assert.equal(
    readFileSync(path.join(target, "managed/tool.mjs"), "utf8"),
    "export const value = 'planned';\n",
  );
});

test(
  "framework upgrade recovers a journal after the applying process is killed",
  { skip: process.platform === "win32" },
  () => {
    const source = frameworkFixture("2.0.0", "export const value = 'new';\n");
    const target = installedFixture();
    const before = Object.fromEntries(
      [
        ".codexrig/framework.json",
        ".codexrig/installation.json",
        "managed/tool.mjs",
        "package.json",
        "pnpm-lock.yaml",
      ].map((relativePath) => [
        relativePath,
        readFileSync(path.join(target, relativePath), "utf8"),
      ]),
    );
    const upgradeUrl = pathToFileURL(
      path.join(repositoryRoot, "scripts/framework/framework-upgrade.mjs"),
    ).href;
    const dependencyRefreshUrl = pathToFileURL(
      path.join(repositoryRoot, "scripts/framework/refresh-upgrade-dependencies.mjs"),
    ).href;
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { writeFileSync } from "node:fs";
import path from "node:path";
import { applyFrameworkUpgrade, buildFrameworkUpgradePlan } from ${JSON.stringify(upgradeUrl)};
import { authorizePlannedLockfile } from ${JSON.stringify(dependencyRefreshUrl)};
const plan = buildFrameworkUpgradePlan({ sourceRoot: process.argv[1], targetRoot: process.argv[2] });
applyFrameworkUpgrade(plan, {
  refreshDependencies: (root) => {
    const content = "interrupted compatible lockfile\\n";
    authorizePlannedLockfile({ root, content });
    writeFileSync(path.join(root, "pnpm-lock.yaml"), content, "utf8");
    process.kill(process.pid, "SIGKILL");
  },
  repairDependencies: () => {},
});`,
        source,
        target,
      ],
      { encoding: "utf8", stdio: "pipe" },
    );
    assert.equal(child.signal, "SIGKILL", child.stderr);
    assert.equal(
      recoverInterruptedFrameworkUpgrade(target, { repairDependencies: () => {} }),
      true,
    );
    for (const [relativePath, content] of Object.entries(before)) {
      assert.equal(readFileSync(path.join(target, relativePath), "utf8"), content, relativePath);
    }
  },
);

test("compatibility matrix renders equivalent provider tracks", () => {
  const tracks = ciCompatibilityTracks(compatibility);
  assert.deepEqual(
    tracks.map((entry) => entry.id),
    ["next-node-lts"],
  );
  const gitlab = gitlabChildPipeline(compatibility);
  assert.match(gitlab, /compatibility:next-node-lts:/);
  assert.match(gitlab, /CODEXRIG_COMPATIBILITY_TRACK: 'next-node-lts'/);
  assert.match(gitlab, /allow_failure: true/);
  assert.match(gitlab, /apt-get install -y --no-install-recommends ripgrep shellcheck/);
  assert.match(gitlab, /npm install --global mise@latest/);
});

function attestationFixture() {
  const root = temporaryRoot("codexrig-attestation-");
  for (const relativePath of startupAttestedInputs) {
    const source = path.join(repositoryRoot, relativePath);
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  return root;
}

test("startup attestation binds nonce, root, lifetime, inputs, and tool versions", () => {
  const root = attestationFixture();
  const now = 1_000_000;
  const controlPolicy = startupControlPolicies.default;
  issueRuntimeSessionLease({ root, pid: process.pid });
  const issued = issueStartupAttestation({ root, now: () => now, controlPolicy });
  const hookInput = { hook_event_name: "SessionStart", source: "startup", cwd: root };
  const verified = verifyStartupAttestation({
    root,
    hookInput,
    nonce: issued.nonce,
    now: () => now + 1,
    controlPolicy,
  });
  assert.equal(verified.frameworkVersion, "1.0.0");
  const statePath = path.join(root, ".codex/runtime/cache/codexrig/startup-attestation.json");
  assert.equal(statSync(statePath).mode & 0o777, 0o600);
  assert.equal(readFileSync(statePath, "utf8").includes(issued.nonce), false);
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        hookInput,
        nonce: "x".repeat(43),
        now: () => now + 1,
        controlPolicy,
      }),
    /does not match/,
  );
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        hookInput,
        nonce: issued.nonce,
        now: () => now + 1,
        controlPolicy: startupControlPolicies.noAltScreen,
      }),
    /control arguments differ/,
  );
  write(root, "package.json", "{}\n");
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        hookInput,
        nonce: issued.nonce,
        now: () => now + 1,
        controlPolicy,
      }),
    /startup-critical input changed/,
  );
});

test("startup attestation rejects expired launcher state", () => {
  const root = attestationFixture();
  const controlPolicy = startupControlPolicies.default;
  issueRuntimeSessionLease({ root, pid: process.pid });
  const issued = issueStartupAttestation({
    root,
    now: () => 1_000_000,
    controlPolicy,
  });
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        hookInput: { hook_event_name: "SessionStart", source: "resume", cwd: root },
        nonce: issued.nonce,
        now: () => 2_801_000,
        controlPolicy,
      }),
    /stale/,
  );
});

test("startup attestation rejects a missing runtime session lease", () => {
  const root = attestationFixture();
  const now = 1_000_000;
  const controlPolicy = startupControlPolicies.default;
  const issued = issueStartupAttestation({ root, now: () => now, controlPolicy });
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        hookInput: { hook_event_name: "SessionStart", source: "startup", cwd: root },
        nonce: issued.nonce,
        now: () => now + 1,
        controlPolicy,
      }),
    /runtime session lease is missing or inactive/,
  );
});
