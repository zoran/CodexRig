/** Verifies dependency policy behavior for the dependency and toolchain maintenance boundary. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  classifyUpdate,
  isPinned,
  normalizeOutdated,
  parsePnpmJsonResult,
  readOutdated,
  validatePolicy,
} from "./dependency-policy.mjs";
import {
  acquireDependencyTransactionLock,
  applyStoredDependencyPlan,
  contentHash,
  dependencyPlanHash,
  dependencyTransactionPaths,
  prepareDependencyPlan,
  releaseDependencyTransactionLock,
} from "./dependency-transaction.mjs";
import { registerCompatibleInstallationTests } from "./compatible-installation-test-cases.mjs";
import {
  assertTrustedPnpmConfiguration,
  trustedPnpmConfigurationFindings,
} from "../repository/pnpm-workspace-manifests.mjs";
import { trustedPnpmCommand } from "./trusted-pnpm-command.mjs";
import { inspectRuntimeLifecycleLock } from "../repository/runtime-session-lease.mjs";

const transactionRoots = [];
const sourceToolchain = readFileSync(
  path.resolve(import.meta.dirname, "..", "..", ".codex", "toolchain.json"),
  "utf8",
);

function writeCompatibility(root) {
  mkdirSync(path.join(root, ".codex"), { recursive: true });
  writeFileSync(path.join(root, ".codex", "toolchain.json"), sourceToolchain, "utf8");
}

async function waitForLifecycle(predicate, label, timeoutMilliseconds = 5_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;
  while (Date.now() <= deadline) {
    try {
      const result = predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}.`, { cause: lastError });
}

function terminateIfAlive(pid, signal = "SIGKILL") {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

after(() => {
  for (const root of transactionRoots) rmSync(root, { recursive: true, force: true });
});

function transactionFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "dependency-transaction-"));
  transactionRoots.push(root);
  mkdirSync(path.join(root, ".codex"));
  writeCompatibility(root);
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "transaction-fixture",
        private: true,
        dependencies: { example: "^1.2.0" },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(path.join(root, "dependency-policy.json"), '{"pins":[]}\n', "utf8");
  writeFileSync(
    path.join(root, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nfixture: old\n",
    "utf8",
  );
  return root;
}

registerCompatibleInstallationTests(transactionFixture);

test("trusted dependency paths reject executable pnpm configuration before pnpm can run", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "dependency-pnpmfile-boundary-"));
  transactionRoots.push(root);
  const sentinel = path.join(root, "pnpmfile-executed");
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), '{"name":"pnpmfile-boundary","private":true}\n');
  writeFileSync(
    path.join(root, "pnpm-workspace.yaml"),
    "packages: []\npnpmfile:\n  - scripts/alternate-pnpmfile.cjs\n",
  );
  writeFileSync(
    path.join(root, "scripts", "alternate-pnpmfile.cjs"),
    `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "executed\\n");\nmodule.exports = { hooks: {} };\n`,
  );

  assert.throws(
    () => assertTrustedPnpmConfiguration({ repositoryRoot: root }),
    /pnpm-workspace\.yaml pnpmfile can load repository-controlled executable configuration/u,
  );
  assert.equal(existsSync(sentinel), false);

  assert.deepEqual(
    trustedPnpmConfigurationFindings({
      repositoryRoot: root,
      workspaceContent: "packages: []\nignorePnpmfile: true\npnpmfile: []\n",
    }),
    [],
  );

  writeFileSync(path.join(root, ".pnpmfile.cjs"), "module.exports = {};\n");
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: []\nconfigDependencies: {}\n");
  assert.deepEqual(trustedPnpmConfigurationFindings({ repositoryRoot: root }), [
    ".pnpmfile.cjs is executable pnpm configuration and is forbidden on trusted framework paths",
    "pnpm-workspace.yaml configDependencies can load repository-controlled executable configuration",
  ]);
  assert.equal(existsSync(sentinel), false);
});

test("trusted pnpm resolution rejects repository-local command shadowing", () => {
  const root = transactionFixture();
  const current = JSON.parse(sourceToolchain).stable;
  const decoy = path.join(root, "node_modules", ".bin", "pnpm");
  const toolRoot = mkdtempSync(path.join(os.tmpdir(), "trusted-pnpm-tool-"));
  transactionRoots.push(toolRoot);
  const nodeExecutable = path.join(
    toolRoot,
    "installs",
    "node",
    current.node.version,
    "bin",
    "node",
  );
  const trusted = path.join(toolRoot, "installs", "pnpm", current.pnpm.version, "pnpm");
  const magicPathDecoy = path.join(
    toolRoot,
    "external",
    "installs",
    "pnpm",
    current.pnpm.version,
    "pnpm",
  );
  mkdirSync(path.dirname(decoy), { recursive: true });
  mkdirSync(path.dirname(nodeExecutable), { recursive: true });
  mkdirSync(path.dirname(trusted), { recursive: true });
  mkdirSync(path.dirname(magicPathDecoy), { recursive: true });
  writeFileSync(decoy, "decoy\n");
  writeFileSync(nodeExecutable, "node\n");
  writeFileSync(trusted, "trusted\n");
  writeFileSync(magicPathDecoy, "magic path decoy\n");
  chmodSync(decoy, 0o755);
  chmodSync(nodeExecutable, 0o755);
  chmodSync(trusted, 0o755);
  chmodSync(magicPathDecoy, 0o755);
  const calls = [];
  const command = trustedPnpmCommand({
    repositoryRoot: root,
    environment: {
      PATH: `${path.dirname(decoy)}${path.delimiter}${path.dirname(magicPathDecoy)}`,
      npm_execpath: decoy,
      COREPACK_HOME: path.join(root, "untrusted-corepack"),
    },
    nodeExecutable,
    spawn(executable, args, options) {
      calls.push({ executable, args, environment: options.env });
      return { status: 0, stdout: `${current.pnpm.version}\n`, stderr: "" };
    },
  });
  assert.equal(command.executable, trusted);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, trusted);
  assert.equal(calls[0].environment.COREPACK_HOME, undefined);
});

function localInputTransactionFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "dependency-local-input-"));
  transactionRoots.push(root);
  for (const directory of [
    ".codex",
    "package-source",
    "packages/example",
    "patches",
    "vendor/local-directory",
  ]) {
    mkdirSync(path.join(root, directory), { recursive: true });
  }
  writeCompatibility(root);
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "local-input-transaction-fixture",
        private: true,
        dependencies: {
          example: "^1.2.0",
          "local-directory": "file:vendor/local-directory",
          "local-source": "file:vendor/local-source-1.0.0.tgz",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(root, "packages/example/package.json"),
    `${JSON.stringify({ name: "example", version: "1.2.1" }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(root, "vendor/local-directory/package.json"),
    `${JSON.stringify({ name: "local-directory", version: "1.0.0" }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(root, "vendor/local-directory/index.js"),
    'export default "directory";\n',
  );
  writeFileSync(
    path.join(root, "package-source/package.json"),
    `${JSON.stringify({ name: "local-source", version: "1.0.0", main: "index.js" }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(path.join(root, "package-source/index.js"), 'export default "source";\n');
  const pack = spawnSync("pnpm", ["pack", "--pack-destination", path.join(root, "vendor")], {
    cwd: path.join(root, "package-source"),
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
    input: "",
    stdio: "pipe",
    timeout: 30_000,
  });
  assert.equal(pack.status, 0, `local tarball fixture setup failed: ${pack.stderr || pack.stdout}`);
  rmSync(path.join(root, "package-source"), { recursive: true });
  const patchContent = [
    "diff --git a/index.js b/index.js",
    "--- a/index.js",
    "+++ b/index.js",
    "@@ -1 +1 @@",
    '-export default "source";',
    '+export default "patched";',
    "",
  ].join("\n");
  writeFileSync(path.join(root, "patches/local-source.patch"), patchContent, "utf8");
  writeFileSync(path.join(root, "dependency-policy.json"), '{"pins":[]}\n', "utf8");
  writeFileSync(
    path.join(root, "pnpm-workspace.yaml"),
    [
      "packages:",
      "  - packages/*",
      "offline: true",
      "linkWorkspacePackages: true",
      "patchedDependencies:",
      "  local-source@1.0.0: patches/local-source.patch",
      "allowUnusedPatches: true",
      "",
    ].join("\n"),
    "utf8",
  );
  const install = spawnSync(
    "pnpm",
    ["install", "--lockfile-only", "--ignore-scripts", "--ignore-pnpmfile"],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
      input: "",
      stdio: "pipe",
      timeout: 30_000,
    },
  );
  assert.equal(
    install.status,
    0,
    `offline local-input fixture setup failed: ${install.stderr || install.stdout}`,
  );
  return {
    root,
    patchContent,
    tarballPath: path.join(root, "vendor/local-source-1.0.0.tgz"),
  };
}

const request = {
  level: "patch",
  select: [],
  allowMajor: false,
  includePinned: false,
};

function transactionUpdate(target = "1.2.1") {
  return {
    key: "package.json:dependencies:example",
    manifestPath: "package.json",
    workspacePath: ".",
    section: "dependencies",
    name: "example",
    current: "1.2.0",
    currentSpec: "^1.2.0",
    target,
    delta: "patch",
  };
}

function prepareFixturePlan(root, target = "1.2.1") {
  return prepareDependencyPlan({
    projectRoot: root,
    request,
    updates: [transactionUpdate(target)],
    manifestPaths: ["package.json"],
    now: new Date("2026-07-10T12:00:00.000Z"),
    lockfilePlanner: () => "lockfileVersion: '9.0'\nfixture: planned\n",
  });
}

function applyReviewedFixturePlan(root, planHash, options = {}) {
  return applyStoredDependencyPlan({
    projectRoot: root,
    request,
    planHash,
    ...options,
  });
}

const manifests = [
  {
    relativePath: "apps/one/package.json",
    workspacePath: "apps/one",
    name: "app-one",
    data: { dependencies: { shared: "^1.2.0" } },
  },
  {
    relativePath: "apps/two/package.json",
    workspacePath: "apps/two",
    name: "app-two",
    data: { dependencies: { shared: "^2.3.0" } },
  },
];

test("pnpm outdated status 1 is accepted only with valid JSON output", () => {
  const outdated = {
    example: {
      current: "1.2.0",
      wanted: "1.2.1",
      latest: "2.0.0",
      dependencyType: "dependencies",
    },
  };
  assert.deepEqual(
    parsePnpmJsonResult(
      { status: 1, stdout: JSON.stringify(outdated) },
      "pnpm recursive outdated",
      { acceptOutdatedStatus: true },
    ),
    outdated,
  );
  assert.throws(
    () => parsePnpmJsonResult({ status: 1, stdout: JSON.stringify(outdated) }, "registry lookup"),
    /failed with status 1/,
  );
  assert.throws(
    () =>
      parsePnpmJsonResult({ status: 1, stdout: "" }, "pnpm recursive outdated", {
        acceptOutdatedStatus: true,
      }),
    /failed with status 1/,
  );
  assert.throws(
    () =>
      parsePnpmJsonResult({ status: 2, stdout: JSON.stringify(outdated) }, "pnpm outdated", {
        acceptOutdatedStatus: true,
      }),
    /failed with status 2/,
  );
  assert.throws(
    () =>
      parsePnpmJsonResult({ status: 1, stdout: "not JSON" }, "pnpm outdated", {
        acceptOutdatedStatus: true,
      }),
    /returned invalid JSON/,
  );
  for (const stdout of ["{}", "[]", "null", '{"error":"ERR_PNPM_FETCH_401"}']) {
    assert.throws(
      () =>
        parsePnpmJsonResult({ status: 1, stdout }, "pnpm outdated", {
          acceptOutdatedStatus: true,
        }),
      /without a complete outdated result/,
    );
  }
  assert.throws(
    () =>
      parsePnpmJsonResult(
        {
          status: 1,
          stdout: JSON.stringify(outdated),
          stderr: "ERR_PNPM_FETCH_401 registry authentication failed",
        },
        "pnpm outdated",
        { acceptOutdatedStatus: true },
      ),
    /fatal pnpm diagnostic/,
  );
});

test("readOutdated normalizes pnpm status 1 as available updates", () => {
  const invocations = [];
  const fixtureManifests = [
    {
      relativePath: "package.json",
      workspacePath: ".",
      name: "fixture",
      data: { dependencies: { example: "^1.2.0" } },
    },
  ];
  const stdout = JSON.stringify({
    example: {
      current: "1.2.0",
      wanted: "1.2.1",
      latest: "2.0.0",
      dependencyType: "dependencies",
      dependentPackages: [
        { name: "fixture", location: path.resolve(import.meta.dirname, "..", "..") },
      ],
    },
  });
  const entries = readOutdated({
    manifests: fixtureManifests,
    spawnPnpm: (executable, args, options) => {
      invocations.push({ executable, args, cwd: options.cwd });
      return {
        status: 1,
        stdout,
      };
    },
  });

  assert.deepEqual(invocations, [
    {
      executable: "pnpm",
      args: ["outdated", "example", "--format", "json", "--prod", "--no-optional"],
      cwd: path.resolve(import.meta.dirname, "..", ".."),
    },
  ]);
  assert.deepEqual(
    entries.map(({ name, current, wanted, latest }) => ({ name, current, wanted, latest })),
    [{ name: "example", current: "1.2.0", wanted: "1.2.1", latest: "2.0.0" }],
  );
  assert.throws(
    () =>
      readOutdated({
        manifests: fixtureManifests,
        spawnPnpm: () => ({
          status: 1,
          stdout: '{"error":"ERR_PNPM_FETCH_401"}',
          stderr: "ERR_PNPM_FETCH_401 registry authentication failed",
        }),
      }),
    /fatal pnpm diagnostic/,
  );
  assert.throws(
    () =>
      readOutdated({
        manifests: fixtureManifests,
        spawnPnpm: () => ({
          status: 1,
          stdout,
          stderr: "ERR_PNPM_FETCH_401 registry authentication failed",
        }),
      }),
    /fatal pnpm diagnostic/,
  );
});

test("outdated entries retain manifest, workspace, section, and version-line identity", () => {
  const entries = normalizeOutdated(
    [
      {
        packageName: "shared",
        current: "1.2.0",
        wanted: "1.2.4",
        latest: "2.4.0",
        dependencyType: "dependencies",
        dependentPackageName: "app-one",
      },
      {
        packageName: "shared",
        current: "2.3.0",
        wanted: "2.3.2",
        latest: "2.4.0",
        dependencyType: "dependencies",
        dependentPackageName: "app-two",
      },
    ],
    manifests,
  );
  assert.deepEqual(
    entries.map((entry) => [entry.manifestPath, entry.current, entry.currentSpec]),
    [
      ["apps/one/package.json", "1.2.0", "^1.2.0"],
      ["apps/two/package.json", "2.3.0", "^2.3.0"],
    ],
  );
  assert.equal(new Set(entries.map((entry) => entry.key)).size, 2);
});

test("ambiguous registry output fails instead of collapsing workspaces", () => {
  assert.throws(
    () =>
      normalizeOutdated(
        {
          shared: {
            current: "1.2.0",
            wanted: "1.2.4",
            latest: "2.4.0",
            dependencyType: "dependencies",
          },
        },
        manifests,
      ),
    /did not identify one manifest/,
  );
});

test("pins can target one manifest and dependency section", () => {
  const [one, two] = normalizeOutdated(
    [
      {
        packageName: "shared",
        current: "1.2.0",
        wanted: "1.2.4",
        latest: "2.4.0",
        dependencyType: "dependencies",
        dependentPackageName: "app-one",
      },
      {
        packageName: "shared",
        current: "2.3.0",
        wanted: "2.3.2",
        latest: "2.4.0",
        dependencyType: "dependencies",
        dependentPackageName: "app-two",
      },
    ],
    manifests,
  );
  const policy = {
    pins: [
      {
        name: "shared",
        manifest: "apps/one/package.json",
        section: "dependencies",
        reason: "Upgrade investigation",
      },
    ],
  };
  assert.equal(isPinned(one, policy), true);
  assert.equal(isPinned(two, policy), false);
  assert.deepEqual(validatePolicy(policy), []);
});

test("zero-major minor movement is classified as major risk", () => {
  assert.equal(classifyUpdate("0.4.1", "0.5.0"), "major");
  assert.equal(classifyUpdate("1.4.1", "1.5.0"), "minor");
  assert.equal(classifyUpdate("1.4.1", "1.4.2"), "patch");
});

test("dependency preview freezes outputs and apply uses the exact reviewed plan", () => {
  const root = transactionFixture();
  const originalManifest = readFileSync(path.join(root, "package.json"), "utf8");
  const { plan, planPath } = prepareFixturePlan(root);
  assert.ok(existsSync(planPath));
  assert.match(plan.hash, /^[a-f0-9]{64}$/);
  assert.equal(readFileSync(path.join(root, "package.json"), "utf8"), originalManifest);
  assert.match(readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"), /fixture: old/);

  const applied = applyReviewedFixturePlan(root, plan.hash);
  assert.deepEqual(applied.changed, ["package.json"]);
  assert.equal(
    JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).dependencies.example,
    "^1.2.1",
  );
  assert.match(readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"), /fixture: planned/);
  const paths = dependencyTransactionPaths(root);
  assert.equal(existsSync(paths.plan), false);
  assert.equal(existsSync(paths.journal), false);
});

test("dependency apply binds stored bytes to the separately reviewed preview hash", () => {
  const root = transactionFixture();
  const { plan, planPath } = prepareFixturePlan(root);
  const forged = JSON.parse(readFileSync(planPath, "utf8"));
  forged.inputs = [];
  forged.outputs.manifests[0].content = `${JSON.stringify(
    {
      name: "transaction-fixture",
      private: true,
      scripts: { postinstall: "node attacker.mjs" },
      dependencies: { example: "^1.2.1" },
    },
    null,
    2,
  )}\n`;
  forged.outputs.manifests[0].hash = contentHash(forged.outputs.manifests[0].content);
  const { hash: priorHash, ...payload } = forged;
  assert.match(priorHash, /^[a-f0-9]{64}$/u);
  forged.hash = dependencyPlanHash(payload);
  writeFileSync(planPath, `${JSON.stringify(forged, null, 2)}\n`, "utf8");

  assert.throws(
    () => applyReviewedFixturePlan(root, plan.hash),
    /Dependency plan structure is incomplete|stored dependency plan differs from the explicitly reviewed plan hash/u,
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts,
    undefined,
  );
  assert.match(readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"), /fixture: old/);

  forged.hash = dependencyPlanHash(payload);
  assert.throws(
    () => applyReviewedFixturePlan(root, forged.hash),
    /plan structure is incomplete|omits required repository inputs|cannot be derived exactly/iu,
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts,
    undefined,
  );
});

test("dependency plans reject hash-valid output destinations outside the discovered inventory", () => {
  const root = transactionFixture();
  const { plan, planPath } = prepareFixturePlan(root);
  const forged = JSON.parse(readFileSync(planPath, "utf8"));
  forged.outputs.manifests[0].path = ".codex/agents/package.json";
  forged.outputs.lockfile.path = "package.json";
  const { hash: priorHash, ...payload } = forged;
  assert.equal(priorHash, plan.hash);
  forged.hash = dependencyPlanHash(payload);
  writeFileSync(planPath, `${JSON.stringify(forged, null, 2)}\n`, "utf8");

  assert.throws(
    () => applyReviewedFixturePlan(root, forged.hash),
    /output hash is invalid|lockfile hash is invalid/u,
  );
  assert.equal(existsSync(path.join(root, ".codex", "agents", "package.json")), false);
  assert.match(readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"), /fixture: old/);
});

test("dependency preview isolates and freezes repository-local pnpm inputs", () => {
  const { root, patchContent, tarballPath } = localInputTransactionFixture();
  const manifestPath = path.join(root, "package.json");
  const lockfilePath = path.join(root, "pnpm-lock.yaml");
  const localDirectoryPath = path.join(root, "vendor/local-directory/index.js");
  const patchPath = path.join(root, "patches/local-source.patch");
  const originalManifest = readFileSync(manifestPath);
  const originalLockfile = readFileSync(lockfilePath);
  const originalLocalDirectory = readFileSync(localDirectoryPath);
  const originalTarball = readFileSync(tarballPath);
  const originalPatch = readFileSync(patchPath);

  const { plan } = prepareDependencyPlan({
    projectRoot: root,
    request,
    updates: [transactionUpdate()],
    manifestPaths: ["package.json", "packages/example/package.json"],
    now: new Date("2026-07-10T12:00:00.000Z"),
  });

  assert.deepEqual(readFileSync(manifestPath), originalManifest);
  assert.deepEqual(readFileSync(lockfilePath), originalLockfile);
  assert.deepEqual(readFileSync(localDirectoryPath), originalLocalDirectory);
  assert.deepEqual(readFileSync(tarballPath), originalTarball);
  assert.deepEqual(readFileSync(patchPath), originalPatch);
  assert.deepEqual(
    plan.inputs
      .filter((input) =>
        [
          "patches/local-source.patch",
          "vendor/local-directory",
          "vendor/local-source-1.0.0.tgz",
        ].includes(input.path),
      )
      .map((input) => [input.path, input.kind]),
    [
      ["patches/local-source.patch", "file"],
      ["vendor/local-directory", "directory"],
      ["vendor/local-source-1.0.0.tgz", "file"],
    ],
  );
  assert.match(plan.outputs.lockfile.content, /specifier: \^1\.2\.1/);
  assert.match(plan.outputs.lockfile.content, /patchedDependencies:/);

  writeFileSync(patchPath, `${patchContent}# changed after preview\n`, "utf8");
  assert.throws(
    () => applyReviewedFixturePlan(root, plan.hash),
    /plan is stale because patches\/local-source\.patch changed/,
  );
  writeFileSync(patchPath, patchContent, "utf8");
  writeFileSync(tarballPath, Buffer.concat([originalTarball, Buffer.from("changed")]));
  assert.throws(
    () => applyReviewedFixturePlan(root, plan.hash),
    /plan is stale because vendor\/local-source-1\.0\.0\.tgz changed/,
  );
  assert.deepEqual(readFileSync(manifestPath), originalManifest);
  assert.deepEqual(readFileSync(lockfilePath), originalLockfile);
});

test("dependency apply rejects source or version changes after preview", () => {
  const root = transactionFixture();
  const { plan } = prepareFixturePlan(root);
  const manifestPath = path.join(root, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.dependencies.example = "^1.2.5";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  assert.throws(
    () => applyReviewedFixturePlan(root, plan.hash),
    /plan is stale because package.json changed/,
  );
  assert.equal(JSON.parse(readFileSync(manifestPath, "utf8")).dependencies.example, "^1.2.5");
  assert.match(readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"), /fixture: old/);
  assert.equal(existsSync(dependencyTransactionPaths(root).plan), true);
});

test("dependency apply arguments must match the reviewed preview", () => {
  const root = transactionFixture();
  const { plan } = prepareFixturePlan(root);
  assert.throws(
    () =>
      applyReviewedFixturePlan(root, plan.hash, {
        request: { ...request, level: "minor" },
      }),
    /arguments do not match the reviewed dependency preview/,
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).dependencies.example,
    "^1.2.0",
  );
  assert.match(readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"), /fixture: old/);
});

test("dependency preview rejects inputs changed while outputs are being planned", () => {
  const root = transactionFixture();
  const manifestPath = path.join(root, "package.json");
  assert.throws(
    () =>
      prepareDependencyPlan({
        projectRoot: root,
        request,
        updates: [transactionUpdate()],
        manifestPaths: ["package.json"],
        lockfilePlanner: () => {
          const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
          manifest.description = "concurrent edit";
          writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
          return "lockfileVersion: '9.0'\nfixture: planned\n";
        },
      }),
    /plan is stale because package.json changed/,
  );
  assert.equal(existsSync(dependencyTransactionPaths(root).plan), false);
});

test("dependency transaction lock enforces process ownership", () => {
  const root = transactionFixture();
  const lock = acquireDependencyTransactionLock(root, { token: "first-owner" });
  assert.throws(
    () => acquireDependencyTransactionLock(root),
    /cannot overlap another repository mutation/,
  );
  assert.throws(
    () =>
      releaseDependencyTransactionLock({
        ...lock,
        owner: { ...lock.owner, token: "different-owner" },
      }),
    /ownership changed/,
  );
  assert.ok(existsSync(lock.path));
  releaseDependencyTransactionLock(lock);
});

test(
  "a killed dependency coordinator remains excluded until its registered child exits",
  { skip: process.platform !== "linux" },
  async (t) => {
    const root = transactionFixture();
    const readyPath = path.join(root, "dependency-child-ready.json");
    const transactionUrl = new URL("./dependency-transaction.mjs", import.meta.url).href;
    const supervisorUrl = new URL("../repository/runtime-lifecycle-process.mjs", import.meta.url)
      .href;
    const targetSource = `
      import { writeFileSync } from "node:fs";
      writeFileSync(${JSON.stringify(readyPath)}, JSON.stringify({ pid: process.pid }));
      setInterval(() => {}, 1000);
    `;
    const coordinatorSource = `
      const { acquireDependencyTransactionLock, releaseDependencyTransactionLock } = await import(${JSON.stringify(transactionUrl)});
      const { spawnRuntimeLifecycleCommandSync } = await import(${JSON.stringify(supervisorUrl)});
      const lock = acquireDependencyTransactionLock(${JSON.stringify(root)});
      spawnRuntimeLifecycleCommandSync({
        args: ["--input-type=module", "--eval", ${JSON.stringify(targetSource)}],
        command: process.execPath,
        lifecycleCapability: lock.lifecycleCapability,
        options: { cwd: ${JSON.stringify(root)}, stdio: "ignore" },
        repositoryRoot: ${JSON.stringify(root)},
        role: "dependency-test-supervisor",
      });
      releaseDependencyTransactionLock(lock);
    `;
    const coordinator = spawn(
      process.execPath,
      ["--input-type=module", "--eval", coordinatorSource],
      { cwd: root, stdio: "ignore" },
    );
    let targetPid;
    t.after(() => {
      terminateIfAlive(targetPid);
      terminateIfAlive(coordinator.pid);
    });

    await waitForLifecycle(() => existsSync(readyPath), "dependency child readiness");
    targetPid = JSON.parse(readFileSync(readyPath, "utf8")).pid;
    await waitForLifecycle(
      () =>
        inspectRuntimeLifecycleLock({ root }).owner?.descendants?.some(
          (entry) =>
            entry.identity.pid === targetPid &&
            /^linux:[a-f0-9-]{36}:\d+:\d+:\d+$/u.test(entry.identity.startIdentity),
        ),
      "dependency child identity registration",
    );

    terminateIfAlive(coordinator.pid, "SIGKILL");
    await new Promise((resolve) => coordinator.once("exit", resolve));
    const orphaned = inspectRuntimeLifecycleLock({ root });
    assert.equal(orphaned.owner.coordinator.pid, coordinator.pid);
    assert.equal(orphaned.status, "active");
    assert.throws(
      () => acquireDependencyTransactionLock(root),
      /cannot overlap another repository mutation/,
    );

    terminateIfAlive(targetPid, "SIGTERM");
    let reclaimed;
    await waitForLifecycle(() => {
      try {
        reclaimed = acquireDependencyTransactionLock(root);
        return true;
      } catch (error) {
        if (/cannot overlap another repository mutation/u.test(error?.message ?? "")) return false;
        throw error;
      }
    }, "dependency lifecycle reclaim after child exit");
    releaseDependencyTransactionLock(reclaimed);
    assert.equal(inspectRuntimeLifecycleLock({ root }).status, "absent");
  },
);

test("interrupted dependency transaction is journaled, rolled back, and retried", () => {
  const root = transactionFixture();
  const { plan } = prepareFixturePlan(root);
  assert.throws(
    () =>
      applyReviewedFixturePlan(root, plan.hash, {
        injectedFailure: "after-manifests",
      }),
    /Injected dependency interruption/,
  );
  const paths = dependencyTransactionPaths(root);
  assert.equal(existsSync(paths.journal), true);
  assert.equal(
    JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).dependencies.example,
    "^1.2.1",
  );
  assert.match(readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"), /fixture: old/);

  const applied = applyReviewedFixturePlan(root, plan.hash);
  assert.equal(applied.recovered, "rolled-back");
  assert.equal(
    JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).dependencies.example,
    "^1.2.1",
  );
  assert.match(readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"), /fixture: planned/);
  assert.equal(existsSync(paths.journal), false);
});

test("dependency recovery preserves unrelated manual output changes and its journal", () => {
  const root = transactionFixture();
  const { plan } = prepareFixturePlan(root);
  assert.throws(
    () =>
      applyReviewedFixturePlan(root, plan.hash, {
        injectedFailure: "after-manifests",
      }),
    /Injected dependency interruption/,
  );

  const manifestPath = path.join(root, "package.json");
  const manualContent = `${JSON.stringify(
    {
      name: "transaction-fixture",
      private: true,
      description: "manual edit after interruption",
      dependencies: { example: "^1.2.7" },
    },
    null,
    2,
  )}\n`;
  writeFileSync(manifestPath, manualContent, "utf8");
  const paths = dependencyTransactionPaths(root);

  assert.throws(
    () => applyReviewedFixturePlan(root, plan.hash),
    /recovery refused to overwrite package\.json.*unrelated change.*journal preserved/i,
  );
  assert.equal(readFileSync(manifestPath, "utf8"), manualContent);
  assert.equal(existsSync(paths.journal), true);
  assert.equal(existsSync(paths.plan), true);
});

test("fully written interrupted dependency transaction is finalized idempotently", () => {
  const root = transactionFixture();
  const { plan } = prepareFixturePlan(root);
  assert.throws(
    () =>
      applyStoredDependencyPlan({
        projectRoot: root,
        request,
        planHash: plan.hash,
        injectedFailure: "after-lockfile",
      }),
    /Injected dependency interruption/,
  );
  const recovered = applyReviewedFixturePlan(root, plan.hash);
  assert.equal(recovered.recovered, "finalized");
  assert.equal(recovered.planHash, plan.hash);
  assert.equal(existsSync(dependencyTransactionPaths(root).journal), false);
});

test("corrupt dependency recovery journal is detected and preserved", () => {
  const root = transactionFixture();
  const { plan } = prepareFixturePlan(root);
  assert.throws(
    () =>
      applyReviewedFixturePlan(root, plan.hash, {
        injectedFailure: "after-manifests",
      }),
    /Injected dependency interruption/,
  );
  const journalPath = dependencyTransactionPaths(root).journal;
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  journal.originals[0].content = "tampered\n";
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
  assert.throws(
    () => applyReviewedFixturePlan(root, plan.hash),
    /journal is invalid; manual recovery is required/,
  );
  assert.equal(existsSync(journalPath), true);
});
