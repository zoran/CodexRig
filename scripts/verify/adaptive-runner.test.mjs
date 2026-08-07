import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildPlan,
  parsePnpmWorkspaceProjects,
  workspaceLifecycleCommands,
} from "./adaptive-runner.mjs";
import { internalDependencies, writeManifest } from "./adaptive-runner-test-helpers.mjs";

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

  const manifests = parsePnpmWorkspaceProjects(
    JSON.stringify([{ path: product }, { path: module }]),
    { repositoryRoot: root },
  );
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

test("pnpm graph projects outside the repository fail closed", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "workspace-graph-root-"));
  const outside = mkdtempSync(path.join(tmpdir(), "workspace-graph-outside-"));
  t.after(() => {
    rmSync(root, { force: true, recursive: true });
    rmSync(outside, { force: true, recursive: true });
  });
  writeManifest(root, { name: "root" });
  writeManifest(outside, { name: "outside" });
  assert.throws(
    () =>
      parsePnpmWorkspaceProjects(JSON.stringify([{ path: outside }]), {
        repositoryRoot: root,
      }),
    /escapes the repository/,
  );
});

test("pnpm graph projects with symlinked path components fail closed", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "workspace-graph-symlink-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const realProject = path.join(root, "real", "project");
  writeManifest(root, { name: "root" });
  writeManifest(realProject, { name: "project" });
  symlinkSync(path.join(root, "real"), path.join(root, "linked"), "dir");
  assert.throws(
    () =>
      parsePnpmWorkspaceProjects(JSON.stringify([{ path: path.join(root, "linked", "project") }]), {
        repositoryRoot: root,
      }),
    /symlinked path component/,
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

test("changed packages select direct owners and immediate internal graph neighbors", () => {
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
    ["workspace:lint", "workspace:typecheck", "workspace:verify:preflight", "workspace:test:unit"],
  );
  assert.deepEqual(
    plan.workspaceCommands.map((command) => command.phase),
    ["preflight", "preflight", "preflight", "preflight"],
  );
  for (const command of plan.workspaceCommands) {
    assert.equal(command.args.includes("./packages/alpha"), true);
    assert.equal(command.args.includes("./packages/beta"), true);
    assert.equal(command.args.includes("./packages/core"), true);
    assert.equal(command.args.includes("./packages/unrelated"), false);
    assert.equal(command.args.includes("."), false);
  }
  assert.equal(
    [...plan.readOnlyCommands, ...plan.workspaceCommands].every(
      (command) => command.phase === "preflight",
    ),
    true,
    "changed package feedback must not contain broad, build, or full-test phases",
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
