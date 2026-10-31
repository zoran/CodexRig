/** Verifies adaptive runner behavior for the repository verification boundary. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import {
  buildPlan,
  discoverWorkspaceManifests,
  workspaceLifecycleCommands,
} from "./adaptive-runner.mjs";
import { internalDependencies, writeManifest } from "./adaptive-runner-test-helpers.mjs";
import {
  pendingVerificationPlan,
  verificationExecutionUnits,
  verificationCheckFingerprints,
} from "./verification-check-inputs.mjs";
import { runPlan } from "./verification-executor.mjs";
import { withVerificationSessionLock } from "./verification-session-lock.mjs";

test("acyclic workspace lifecycles reuse independent units and retain output prerequisites", () => {
  const manifests = [
    {
      directory: "apps/app",
      name: "app",
      internalDependencyNames: internalDependencies(["core"]),
      scripts: { build: "build", lint: "lint" },
    },
    {
      directory: "packages/core",
      name: "core",
      internalDependencyNames: internalDependencies(),
      scripts: { build: "build", lint: "lint" },
    },
    {
      directory: "apps/other",
      name: "other",
      internalDependencyNames: internalDependencies(),
      scripts: { build: "build", lint: "lint" },
    },
  ];
  const complete = workspaceLifecycleCommands(manifests);
  const selected = workspaceLifecycleCommands(manifests.slice(0, 2));
  for (const command of complete) {
    const units = verificationExecutionUnits(command);
    assert.deepEqual(
      units.map((unit) => unit.workspaceDirectories[0]),
      ["packages/core", "apps/app", "apps/other"],
    );
    assert.deepEqual(
      verificationExecutionUnits(selected.find((entry) => entry.key === command.key)).map(
        (unit) => unit.key,
      ),
      units.slice(0, 2).map((unit) => unit.key),
    );
    assert.ok(units.every((unit) => unit.serialGroup === command.key));
  }
  const build = complete.find((command) => command.key === "workspace:build");
  const units = verificationExecutionUnits(build);
  const fingerprints = new Map(units.map((unit) => [unit.key, "a".repeat(64)]));
  const checks = [units[0], units[2]].map((unit) => ({
    key: unit.key,
    fingerprint: fingerprints.get(unit.key),
    completedAt: new Date().toISOString(),
    elapsedMs: 2,
  }));
  const pending = pendingVerificationPlan(
    { readOnlyCommands: [], workspaceCommands: [build] },
    fingerprints,
    checks,
  );
  assert.deepEqual(
    pending.workspaceCommands.map((unit) => unit.workspaceDirectories[0]),
    ["apps/app"],
  );
  assert.equal(pending.evidence.prerequisites.length, 1);
  assert.match(
    pending.evidence.blockedPrerequisites[0],
    /Missing output contract.*packages\/core/u,
  );
  const cyclic = manifests
    .slice(0, 2)
    .map((manifest) =>
      manifest.name === "core"
        ? { ...manifest, internalDependencyNames: internalDependencies(["app"]) }
        : manifest,
    );
  assert.ok(
    workspaceLifecycleCommands(cyclic).every(
      (command) => verificationExecutionUnits(command).length === 1,
    ),
  );
});

test("missing or changed producer outputs rerun only that producer and its actual consumers", async (t) => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "workspace-output-reuse-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  const commands = ["core", "app", "independent"].map((name) => ({
    key: `build-${name}`,
    phase: "workspace-build",
    executable: process.execPath,
    args: [
      "--eval",
      `const fs = require('node:fs'); ${name === "app" ? "if(fs.readFileSync('core.out','utf8') !== 'valid') throw Error('invalid core artifact');" : ""} fs.writeFileSync('${name}.out','valid'); fs.appendFileSync('dispatch.log','${name}\\n');`,
    ],
    workspaceDirectories: [name],
    buildPrerequisites: name === "app" ? ["core"] : [],
    outputs: [`${name}.out`],
    artifactOwners: ["fixture-builds"],
  }));
  const fingerprints = new Map(commands.map((command) => [command.key, "a".repeat(64)]));
  let checks = [];
  const base = {
    options: { mode: "full", printPlan: false, simulatedPaths: [] },
    admission: { mode: "full", reason: "output fixture" },
    classifiedPaths: [],
    verificationScope: "fixture",
    readOnlyCommands: [],
    workspaceCommands: commands,
  };
  async function execute(expected, selected = commands) {
    const before = checks;
    const pending = pendingVerificationPlan(
      {
        ...base,
        workspaceCommands: selected,
        options: { ...base.options, mode: selected === commands ? "full" : "repo" },
        admission: { ...base.admission, mode: selected === commands ? "full" : "targeted" },
      },
      fingerprints,
      checks,
      {
        completeCommands: commands,
        repositoryRoot,
      },
    );
    assert.deepEqual(
      pending.workspaceCommands.map((unit) => unit.key),
      expected.map((name) => `build-${name}`),
    );
    writeFileSync(path.join(repositoryRoot, "dispatch.log"), "");
    const evidence = new Map(checks.map((check) => [check.key, check]));
    for (const key of pending.evidence.invalidatedKeys) evidence.delete(key);
    await withVerificationSessionLock(
      () =>
        runPlan(pending, {
          repositoryRoot,
          onResult(result) {
            assert.equal(result.status, 0);
            evidence.set(result.command.key, {
              key: result.command.key,
              fingerprint: fingerprints.get(result.command.key),
              completedAt: new Date().toISOString(),
              elapsedMs: result.elapsedMs,
              ...(result.outputFingerprint ? { outputFingerprint: result.outputFingerprint } : {}),
            });
          },
        }),
      { repositoryRoot },
    );
    checks = [...evidence.values()];
    assert.deepEqual(
      readFileSync(path.join(repositoryRoot, "dispatch.log"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean),
      expected,
    );
    if (!expected.includes("independent") && before.length)
      assert.deepEqual(
        checks.find((check) => check.key === "build-independent"),
        before.find((check) => check.key === "build-independent"),
      );
  }
  await execute(["core", "app", "independent"]);
  await execute([]);
  rmSync(path.join(repositoryRoot, "core.out"));
  await execute(["core", "app"]);
  writeFileSync(path.join(repositoryRoot, "core.out"), "corrupt");
  await execute(["core", "app"]);
  const manifests = [
    {
      directory: "core",
      name: "core",
      scripts: { build: "build" },
      internalDependencyNames: internalDependencies(),
    },
    {
      directory: "app",
      name: "app",
      scripts: { build: "build", "test:unit": "test" },
      internalDependencyNames: internalDependencies(["core"]),
    },
  ];
  const actualChangedUnit = workspaceLifecycleCommands([manifests[1]], {
    mode: "changed",
    dependencyManifests: manifests,
  }).flatMap(verificationExecutionUnits)[0];
  assert.equal(actualChangedUnit.phase, "workspace-test");
  assert.deepEqual(actualChangedUnit.buildPrerequisites, ["core", "app"]);
  const consumer = {
    ...actualChangedUnit,
    key: "build-test",
    executable: process.execPath,
    args: [
      "--eval",
      "const fs=require('node:fs'); for(const file of ['core.out','app.out']) if(fs.readFileSync(file,'utf8') !== 'valid') throw Error('bad prerequisite'); fs.appendFileSync('dispatch.log','test\\n');",
    ],
  };
  commands.push(consumer);
  fingerprints.set(consumer.key, "a".repeat(64));
  await execute(["test"], [consumer]);
  rmSync(path.join(repositoryRoot, "core.out"));
  await execute(["core", "app", "test"], [consumer]);
  writeFileSync(path.join(repositoryRoot, "core.out"), "corrupt");
  await execute(["core", "app", "test"], [consumer]);
  rmSync(path.join(repositoryRoot, "core.out"));
  symlinkSync("missing-output", path.join(repositoryRoot, "core.out"));
  assert.throws(
    () =>
      pendingVerificationPlan(base, fingerprints, checks, {
        completeCommands: commands,
        repositoryRoot,
      }),
    /non-symlink/u,
  );
  rmSync(path.join(repositoryRoot, "core.out"));
  writeFileSync(path.join(repositoryRoot, "core.out"), "valid");
  const undeclared = commands.map((command) =>
    command.key === "build-core" ? { ...command, outputs: undefined } : command,
  );
  const changed = new Map(fingerprints).set("build-app", "b".repeat(64));
  const blocked = pendingVerificationPlan(
    { ...base, workspaceCommands: undeclared },
    changed,
    checks,
    { completeCommands: undeclared, repositoryRoot },
  );
  assert.match(
    blocked.evidence.blockedPrerequisites[0],
    /Missing output contract.*core.*workspaceOutputs/u,
  );
  writeFileSync(path.join(repositoryRoot, "dispatch.log"), "");
  await assert.rejects(runPlan(blocked, { repositoryRoot }), /Missing output contract/u);
  assert.equal(readFileSync(path.join(repositoryRoot, "dispatch.log"), "utf8"), "");
  t.diagnostic(
    "Output lifecycle: full [3,0,2,2]; changed App test [1,3,3] after intact/deleted/corrupt Core outputs. Repairs order core before app before test; unrelated producer reused; missing contract dispatched 0.",
  );
});

test("shared workspace resolution inputs invalidate workspace units without native test fan-out", () => {
  const manifests = [
    {
      directory: "packages/product",
      name: "product",
      scripts: { "test:unit": "test" },
      internalDependencyNames: internalDependencies(),
    },
  ];
  const native = {
    key: "native",
    executable: process.execPath,
    args: ["--test", "scripts/native.test.mjs"],
    phase: "preflight",
  };
  const commands = [native, ...workspaceLifecycleCommands(manifests)];
  const configuration = {
    commands: [native],
    risks: [],
    exactConsumers: {},
    testConsumers: {},
    ownedCategories: {},
  };
  for (const file of [
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".codex/mise.toml",
    ".codex/mise.lock",
  ]) {
    const capture = (value) =>
      verificationCheckFingerprints({
        commands,
        configuration,
        workspaceManifests: manifests,
        repositoryRoot: process.cwd(),
        inputs: {
          runtimeDigest: "stable",
          sourceFiles: [{ path: file, fingerprint: value, semanticFingerprint: value }],
        },
      });
    const before = capture("a".repeat(64));
    const after = capture("b".repeat(64));
    for (const unit of commands.flatMap(verificationExecutionUnits))
      assert.equal(
        before.get(unit.key) !== after.get(unit.key),
        Boolean(unit.workspaceDirectories),
        `${file}: ${unit.key}`,
      );
  }
});

test("pnpm graph discovery includes root and arbitrary workspace layouts", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "workspace-graph-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const product = path.join(root, "products", "alpha");
  const module = path.join(root, "modules", "beta");
  writeManifest(root, {
    name: "root",
    scripts: {
      build: "pnpm -r --if-present build",
      lint: "bash scripts/verify/lint.sh",
      test: "node --test",
    },
  });
  writeManifest(product, { name: "alpha", scripts: { build: "vite build" } });
  writeManifest(module, {
    name: "beta",
    scripts: { typecheck: "tsc --noEmit" },
    dependencies: { alpha: "workspace:*", external: "^1.0.0" },
    devDependencies: { root: "workspace:*" },
    optionalDependencies: { alpha: "workspace:*" },
    peerDependencies: { root: "*" },
  });
  writeFileSync(
    path.join(root, "pnpm-workspace.yaml"),
    "packages:\n  - 'products/*'\n  - 'modules/*'\n",
  );

  const manifests = discoverWorkspaceManifests({ repositoryRoot: root });
  assert.deepEqual(
    manifests.map(({ directory }) => directory),
    [".", "modules/beta", "products/alpha"],
  );
  assert.deepEqual(manifests.find((manifest) => manifest.name === "beta").internalDependencyNames, {
    dependencies: ["alpha"],
    devDependencies: ["root"],
    optionalDependencies: ["alpha"],
    peerDependencies: ["root"],
  });

  const commands = workspaceLifecycleCommands(manifests);
  const build = commands.find((command) => command.key === "workspace:build");
  assert.ok(build.args.includes("./products/alpha"));
  assert.equal(build.args.includes("."), false, "recursive root aggregator must be skipped");
  assert.ok(
    commands.find((command) => command.key === "workspace:test").args.includes("."),
    "ordinary root lifecycle scripts must run",
  );
  assert.ok(
    commands
      .find((command) => command.key === "workspace:typecheck")
      .args.includes("./modules/beta"),
  );
  assert.equal(
    commands.some((command) => command.key === "workspace:lint"),
    false,
    "managed verification aliases must not duplicate direct DAG nodes",
  );
});

test("ambient package-manager filters cannot suppress workspace discovery", (t) => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "workspace-graph-environment-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  writeManifest(repositoryRoot, { name: "root" });
  writeFileSync(path.join(repositoryRoot, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
  writeManifest(path.join(repositoryRoot, "packages", "owned"), { name: "owned" });

  const manifests = discoverWorkspaceManifests({
    repositoryRoot,
    environment: {
      ...process.env,
      NPM_CONFIG_FILTER: "__codexrig_no_such_package__",
      PNPM_CONFIG_FILTER: "__codexrig_no_such_package__",
    },
  });
  assert.deepEqual(
    manifests.map(({ directory }) => directory),
    [".", "packages/owned"],
  );
});

test("workspace patterns exclude package manifests outside the declared graph", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "workspace-graph-root-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  writeManifest(root, { name: "root" });
  writeManifest(path.join(root, "fixtures", "rogue"), { name: "rogue" });
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
  assert.deepEqual(
    discoverWorkspaceManifests({ repositoryRoot: root }),
    [
      {
        declaredDependencyNames: undefined,
        directory: ".",
        internalDependencyNames: {
          dependencies: [],
          devDependencies: [],
          optionalDependencies: [],
          peerDependencies: [],
        },
        name: "root",
        scripts: {},
      },
    ].map(({ declaredDependencyNames: _ignored, ...entry }) => entry),
  );
});

test("workspace discovery rejects package manifests behind symlinked path components", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "workspace-graph-symlink-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const realProject = path.join(root, "real", "project");
  writeManifest(root, { name: "root" });
  writeManifest(realProject, { name: "project" });
  symlinkSync(path.join(root, "real"), path.join(root, "linked"), "dir");
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - 'linked/**'\n");
  assert.throws(
    () =>
      discoverWorkspaceManifests({
        repositoryRoot: root,
        relativePaths: ["package.json", "pnpm-workspace.yaml", "linked/project/package.json"],
      }),
    /symbolic link/,
  );
});

test("lifecycle filters reject ambiguous pnpm path metacharacters", () => {
  assert.throws(
    () =>
      workspaceLifecycleCommands([{ directory: "modules/[ambiguous]", scripts: { test: "x" } }]),
    /pnpm filter metacharacters/,
  );
});

test("root workspace preflight rejects recursive closure and publication entrypoints", () => {
  for (const command of [
    "pnpm run verify",
    "pnpm run verify:changed",
    "pnpm run verify:pre-push",
    "pnpm --silent run goal:new",
    "npm run verify",
    "npm run verify:pre-push",
    "yarn verify",
    "bun run goal:new",
    "corepack npm run verify:changed",
    "npx --yes pnpm run verify",
    "bash scripts/verify/pre-push.sh",
    "./scripts/verify/pre-push.sh",
    "node scripts/verify/adaptive.mjs --mode full",
    "node scripts/goals/goal-publication-precondition.mjs",
  ]) {
    assert.deepEqual(
      workspaceLifecycleCommands([{ directory: ".", scripts: { "verify:preflight": command } }], {
        mode: "changed",
      }),
      [],
      command,
    );
  }
  assert.equal(
    workspaceLifecycleCommands(
      [
        {
          directory: "product",
          scripts: { "verify:preflight": "node scripts/verify/package-manifest.mjs" },
        },
      ],
      { mode: "changed" },
    ).length,
    1,
  );
  assert.equal(
    workspaceLifecycleCommands(
      [
        {
          directory: ".",
          scripts: { "test:unit": "node scripts/verify/product-tests.mjs" },
        },
      ],
      { mode: "changed" },
    ).length,
    1,
    "a noncanonical root product verifier must remain a lifecycle owner",
  );
});

test("workspace lifecycle retains package-local verification product checks", () => {
  const commands = workspaceLifecycleCommands(
    [
      {
        directory: "packages/product",
        scripts: {
          lint: "bash scripts/verify/lint.sh",
          "verify:preflight": "node scripts/verify/package-boundary.mjs",
          "test:unit": "node scripts/verify/product-tests.mjs",
        },
      },
    ],
    { mode: "changed" },
  );

  assert.deepEqual(
    commands.map((command) => command.key),
    ["workspace:lint", "workspace:verify:preflight", "workspace:test:unit"],
  );
  for (const command of commands) {
    assert.ok(command.args.includes("./packages/product"), command.key);
  }
});

test("changed packages select prerequisites and transitive integration consumers", () => {
  const productLayout = {
    findings: [],
    sourceRoots: [
      "src",
      "packages/alpha/src",
      "packages/beta/src",
      "packages/core/src",
      "packages/unrelated/src",
    ],
    units: [
      {
        root: ".",
        sourceRoots: ["src"],
        surfaceRoot: "src",
        kind: "default",
        declaredBy: "fixture",
      },
      {
        root: "packages/alpha",
        sourceRoots: ["packages/alpha/src"],
        surfaceRoot: "packages/alpha",
        kind: "workspace",
        declaredBy: "packages/alpha/package.json",
      },
      {
        root: "packages/beta",
        sourceRoots: ["packages/beta/src"],
        surfaceRoot: "packages/beta",
        kind: "workspace",
        declaredBy: "packages/beta/package.json",
      },
      {
        root: "packages/core",
        sourceRoots: ["packages/core/src"],
        surfaceRoot: "packages/core",
        kind: "workspace",
        declaredBy: "packages/core/package.json",
      },
      {
        root: "packages/unrelated",
        sourceRoots: ["packages/unrelated/src"],
        surfaceRoot: "packages/unrelated",
        kind: "workspace",
        declaredBy: "packages/unrelated/package.json",
      },
    ],
  };
  const lifecycleScripts = {
    lint: "lint",
    typecheck: "typecheck",
    "verify:preflight": "node scripts/verify/package-exports.mjs",
    build: "build",
    test: "test",
    "test:unit": "test-unit",
    "test:integration": "test-integration",
    "test:e2e": "test-e2e",
  };
  const plan = buildPlan(
    { mode: "repo", printPlan: true, simulatedPaths: [] },
    {
      gitAvailable: true,
      changedPaths: ["packages/alpha/package.json", "packages/alpha/src/index.ts"],
      productLayout,
      workspaceManifests: [
        {
          directory: ".",
          name: "root",
          scripts: { test: "root-test" },
          internalDependencyNames: internalDependencies(),
        },
        {
          directory: "packages/alpha",
          name: "alpha",
          scripts: lifecycleScripts,
          internalDependencyNames: internalDependencies(["core"]),
        },
        {
          directory: "packages/beta",
          name: "beta",
          scripts: lifecycleScripts,
          internalDependencyNames: internalDependencies(["alpha"]),
        },
        {
          directory: "packages/core",
          name: "core",
          scripts: lifecycleScripts,
          internalDependencyNames: internalDependencies(),
        },
        {
          directory: "packages/gamma",
          name: "gamma",
          scripts: lifecycleScripts,
          internalDependencyNames: internalDependencies(["beta"]),
        },
        {
          directory: "packages/unrelated",
          name: "unrelated",
          scripts: lifecycleScripts,
          internalDependencyNames: internalDependencies(),
        },
      ],
    },
  );

  assert.equal(plan.verificationScope, "targeted");
  assert.equal(
    plan.readOnlyCommands.some((command) => command.key === "verification-boundary-regressions"),
    false,
    "changed feedback must not select the mixed complete boundary suite",
  );
  assert.deepEqual(
    plan.workspaceCommands.map((command) => command.key),
    [
      "workspace:lint",
      "workspace:typecheck",
      "workspace:verify:preflight",
      "workspace:test:unit",
      "workspace:test:integration",
    ],
  );
  assert.deepEqual(
    plan.workspaceCommands.map((command) => command.phase),
    ["preflight", "preflight", "preflight", "workspace-test", "workspace-test"],
  );
  for (const command of plan.workspaceCommands) {
    assert.equal(command.args.includes("./packages/alpha"), true);
    assert.equal(command.args.includes("./packages/beta"), true);
    assert.equal(command.args.includes("./packages/gamma"), true);
    assert.equal(command.args.includes("./packages/core"), true);
    assert.equal(command.args.includes("./packages/unrelated"), false);
    assert.equal(command.args.includes("."), false);
  }
  assert.equal(
    [...plan.readOnlyCommands, ...plan.workspaceCommands].every((command) =>
      ["preflight", "workspace-test"].includes(command.phase),
    ),
    true,
    "changed package feedback contains only selected preflight and test units",
  );
  assert.deepEqual(
    workspaceLifecycleCommands([
      {
        directory: "packages/alpha",
        name: "alpha",
        scripts: lifecycleScripts,
        internalDependencyNames: internalDependencies(),
      },
    ]).map((command) => command.key),
    [
      "workspace:lint",
      "workspace:typecheck",
      "workspace:verify:preflight",
      "workspace:build",
      "workspace:test",
      "workspace:test:unit",
      "workspace:test:integration",
      "workspace:test:e2e",
    ],
    "full mode must retain the complete workspace lifecycle",
  );

  const rootPlan = buildPlan(
    { mode: "repo", printPlan: true, simulatedPaths: [] },
    {
      gitAvailable: true,
      changedPaths: ["src/index.ts"],
      productLayout,
      workspaceManifests: [
        {
          directory: ".",
          name: "root",
          scripts: lifecycleScripts,
          internalDependencyNames: internalDependencies(),
        },
        {
          directory: "packages/alpha",
          name: "alpha",
          scripts: lifecycleScripts,
          internalDependencyNames: internalDependencies(),
        },
      ],
    },
  );
  assert.equal(rootPlan.verificationScope, "targeted");
  for (const command of rootPlan.workspaceCommands) {
    assert.equal(command.args.includes("."), true);
    assert.equal(command.args.includes("./packages/alpha"), false);
  }
});
