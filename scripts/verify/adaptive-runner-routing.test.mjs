import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { repositoryCodexHomeRuntimeProbePaths } from "../repository/source-inventory.mjs";
import { buildPlan } from "./adaptive-runner.mjs";
import { internalDependencies, route, writeManifest } from "./adaptive-runner-test-helpers.mjs";

test("successful basis plus a fully owned product delta stays targeted even at the full entry", () => {
  const plan = route(["src/product.ts"], {
    workspaceManifests: [
      {
        directory: ".",
        internalDependencyNames: internalDependencies(),
        name: "root",
        scripts: { lint: "lint", "test:unit": "unit" },
      },
    ],
  });
  assert.equal(plan.admission.mode, "targeted");
  assert.deepEqual(plan.admission.fullRelevantPaths, ["src/product.ts"]);
  assert.deepEqual(plan.admission.unknownPaths, []);
  assert.deepEqual(plan.admission.uncoveredFullRelevantPaths, []);
  assert.ok(plan.admission.focusedCommandOwners[0].ownerKeys.includes("workspace:test:unit"));
  assert.equal(
    [...plan.readOnlyCommands, ...plan.workspaceCommands].some((command) =>
      ["broad", "workspace-build", "workspace-test"].includes(command.phase),
    ),
    false,
  );
});

test("unowned and unknown full-relevant paths receive exact fail-closed admission reasons", () => {
  const unowned = route(["src/unowned.ts"]);
  assert.equal(unowned.admission.mode, "full");
  assert.deepEqual(unowned.admission.uncoveredFullRelevantPaths, ["src/unowned.ts"]);
  assert.match(unowned.admission.reason, /src\/unowned\.ts/u);

  const unknown = route(["unexpected/new-surface.bin"]);
  assert.equal(unknown.admission.mode, "full");
  assert.deepEqual(unknown.admission.unknownPaths, ["unexpected/new-surface.bin"]);
  assert.match(unknown.admission.reason, /unknown changed paths/u);
});

test("local runtime markers are ignored instead of becoming unknown paths", () => {
  const paths = [
    ...repositoryCodexHomeRuntimeProbePaths,
    ".context-index/manifest.json",
    ".project-state/active.json",
  ];
  const plan = route(paths);
  assert.equal(plan.admission.mode, "targeted");
  assert.deepEqual(plan.admission.fullRelevantPaths, []);
  assert.deepEqual(plan.admission.unknownPaths, []);
  assert.equal(plan.readOnlyCommands.length, 0);
  assert.equal(plan.workspaceCommands.length, 0);

  const productMarker = route(["src/cache/runtime-state"], {
    workspaceManifests: [
      {
        directory: ".",
        internalDependencyNames: internalDependencies(),
        name: "root",
        scripts: { "test:unit": "unit" },
      },
    ],
  });
  assert.deepEqual(productMarker.admission.fullRelevantPaths, ["src/cache/runtime-state"]);
});

test("repository ignore policy routes to exact focused consumers", () => {
  const plan = route([".gitignore"]);
  const keys = new Set(plan.readOnlyCommands.map((command) => command.key));
  assert.equal(plan.admission.mode, "targeted");
  assert.deepEqual(plan.admission.unknownPaths, []);
  assert.deepEqual(plan.admission.uncoveredFullRelevantPaths, []);
  for (const key of ["codex-config", "context-policy", "path-hygiene", "repository-smoke"]) {
    assert.ok(keys.has(key), key);
  }
});

test("portable policy text exposes the checks that own its successful evidence", () => {
  const plan = route([
    ".agents/skills/code-pattern-review/SKILL.md",
    ".codex/config.toml",
    "instructions.md",
  ]);
  const owners = new Map(
    plan.admission.focusedCommandOwners.map((entry) => [entry.path, entry.ownerKeys]),
  );
  assert.deepEqual(owners.get(".agents/skills/code-pattern-review/SKILL.md"), ["docs", "skills"]);
  assert.deepEqual(owners.get(".codex/config.toml"), ["codex-config"]);
  assert.deepEqual(owners.get("instructions.md"), ["docs"]);
});

test("verify-only root manifest changes use orchestration owners without product aggregates", () => {
  const plan = route(["package.json"], {
    verifyOnlyRootManifest: true,
    workspaceManifests: [
      {
        directory: ".",
        internalDependencyNames: internalDependencies(),
        name: "root",
        scripts: { build: "build", test: "test" },
      },
    ],
  });
  const keys = new Set(plan.readOnlyCommands.map((command) => command.key));
  assert.equal(plan.admission.mode, "targeted");
  assert.ok(keys.has("verification-orchestration-regressions"));
  assert.ok(keys.has("verification-entrypoints"));
  for (const key of ["dependencies", "package-manifests", "repository-smoke"]) {
    assert.equal(keys.has(key), false, key);
  }
  assert.equal(plan.workspaceCommands.length, 0);
});

test("package-local export contracts route through their manifest owner", (t) => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "focused-export-contract-owner-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  writeManifest(path.join(repositoryRoot, "packages", "widget"), {
    exports: { "./owned": "./src/owned.mjs" },
    name: "widget",
    private: true,
  });
  writeFileSync(
    path.join(repositoryRoot, "packages", "widget", "package.exports.json"),
    `${JSON.stringify({
      ownedExports: { "./owned": "./src/owned.mjs" },
      schemaVersion: 1,
    })}\n`,
    "utf8",
  );
  const plan = route(["packages/widget/package.exports.json"], { repositoryRoot });
  const manifestCommand = plan.readOnlyCommands.find((command) =>
    command.key.startsWith("focused-manifest:"),
  );
  assert.ok(manifestCommand);
  assert.deepEqual(manifestCommand.args, [
    "scripts/verify/package-manifest.mjs",
    "--path",
    "packages/widget/package.json",
  ]);
});

test("ordinary package manifests use their exact whole-manifest owner", (t) => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "focused-manifest-owner-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  writeManifest(path.join(repositoryRoot, "packages", "widget"), {
    name: "widget",
    private: true,
  });
  const plan = route(["packages/widget/package.json"], { repositoryRoot });
  const manifestCommand = plan.readOnlyCommands.find((command) =>
    command.key.startsWith("focused-manifest:"),
  );
  assert.ok(manifestCommand);
  assert.deepEqual(manifestCommand.args, [
    "scripts/verify/package-manifest.mjs",
    "--path",
    "packages/widget/package.json",
  ]);
  assert.equal(
    plan.readOnlyCommands.some((command) => command.key === "package-manifests"),
    false,
  );
});

test("direct verifier and support files route exact smallest consumers", () => {
  const verifier = route(["scripts/verify/api-security.mjs"]);
  const verifierArgs = verifier.readOnlyCommands.flatMap((command) => command.args);
  assert.equal(verifier.admission.mode, "targeted");
  assert.ok(
    verifier.readOnlyCommands.some(
      (command) =>
        command.key === "api-security" && command.args[0] === "scripts/verify/api-security.mjs",
    ),
  );
  assert.equal(verifierArgs.includes("scripts/verify/api-security.test.mjs"), false);
  assert.equal(
    verifier.readOnlyCommands.some(
      (command) => command.key === "verification-orchestration-regressions",
    ),
    false,
  );

  const support = route(["scripts/verify/secret-patterns.mjs"]);
  const supportArgs = support.readOnlyCommands.flatMap((command) => command.args);
  for (const consumer of [
    "scripts/context/terminal-output.test.mjs",
    "scripts/verify/git-remote-identity.test.mjs",
    "scripts/verify/pushed-object-scan.test.mjs",
    "scripts/verify/secrets.test.mjs",
  ]) {
    assert.ok(supportArgs.includes(consumer), consumer);
  }
  assert.equal(
    support.readOnlyCommands.some((command) => command.key === "verification-boundary-regressions"),
    false,
  );

  const accessibility = route(["scripts/verify/a11y.mjs"]);
  assert.equal(accessibility.admission.mode, "targeted");
  assert.ok(accessibility.readOnlyCommands.some((command) => command.key === "surface-quality"));
  assert.equal(
    accessibility.readOnlyCommands.some((command) =>
      command.args.includes("scripts/verify/surface-quality.test.mjs"),
    ),
    false,
  );

  const state = route(["scripts/verify/adaptive-state.mjs"]);
  assert.equal(state.admission.mode, "targeted");
  for (const consumer of [
    "scripts/verify/adaptive-runner-routing.test.mjs",
    "scripts/verify/adaptive-runner.test.mjs",
    "scripts/verify/pre-push.test.mjs",
    "scripts/verify/verification-git-basis.test.mjs",
  ]) {
    assert.ok(
      state.readOnlyCommands.some((command) => command.args.includes(consumer)),
      consumer,
    );
  }

  const helper = route(["scripts/verify/adaptive-runner-test-helpers.mjs"]);
  const helperArgs = helper.readOnlyCommands.flatMap((command) => command.args);
  for (const consumer of [
    "scripts/verify/adaptive-runner-routing.test.mjs",
    "scripts/verify/adaptive-runner.test.mjs",
  ]) {
    assert.ok(helperArgs.includes(consumer), consumer);
  }

  const evidenceHelper = route(["scripts/verify/verification-evidence-test-helpers.mjs"]);
  const evidenceHelperArgs = evidenceHelper.readOnlyCommands.flatMap((command) => command.args);
  for (const consumer of [
    "scripts/verify/verification-evidence-integrity.test.mjs",
    "scripts/verify/verification-evidence.test.mjs",
  ]) {
    assert.ok(evidenceHelperArgs.includes(consumer), consumer);
  }

  const runtimeIdentity = route(["scripts/verify/verification-runtime-identity.mjs"]);
  const runtimeIdentityArgs = runtimeIdentity.readOnlyCommands.flatMap((command) => command.args);
  for (const consumer of [
    "scripts/verify/verification-evidence-integrity.test.mjs",
    "scripts/verify/verification-executor.test.mjs",
  ]) {
    assert.ok(runtimeIdentityArgs.includes(consumer), consumer);
  }

  const sessionLock = route(["scripts/verify/verification-session-lock.mjs"]);
  const sessionLockArgs = sessionLock.readOnlyCommands.flatMap((command) => command.args);
  for (const consumer of [
    "scripts/verify/verification-evidence-integrity.test.mjs",
    "scripts/verify/verification-evidence.test.mjs",
    "scripts/verify/verification-executor.test.mjs",
    "scripts/verify/verification-session-lock.test.mjs",
  ]) {
    assert.ok(sessionLockArgs.includes(consumer), consumer);
  }
});

test("broad entrypoint implementations route to focused orchestration without recursion", () => {
  const plan = route(["scripts/verify/pre-push.sh"]);
  assert.equal(plan.admission.mode, "targeted");
  assert.equal(
    plan.admission.focusedCommandOwners[0].ownerKeys.some((key) => key.startsWith("focused-test:")),
    true,
  );
  assert.equal(
    plan.readOnlyCommands.some(
      (command) => command.key === "verification-orchestration-regressions",
    ),
    false,
  );
  assert.equal(
    [...plan.readOnlyCommands, ...plan.workspaceCommands].some(
      (command) =>
        command.args.includes("scripts/verify/pre-push.sh") ||
        command.key === "verify:pre-push" ||
        command.key === "verify:full" ||
        command.key === "verify:repo",
    ),
    false,
  );
});

test("pure re-export barrels select direct packages and consumers but not upstream dependencies", (t) => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "pure-barrel-owner-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  const barrelDirectory = path.join(repositoryRoot, "packages", "alpha", "src");
  mkdirSync(barrelDirectory, { recursive: true });
  writeFileSync(
    path.join(barrelDirectory, "index.ts"),
    'export { coreValue } from "@fixture/core";\n',
    "utf8",
  );
  const lifecycleScripts = { lint: "lint", "test:unit": "unit" };
  const plan = buildPlan(
    { mode: "repo", printPlan: true, simulatedPaths: [] },
    {
      basis: { reason: "", trusted: true },
      changedPaths: ["packages/alpha/src/index.ts"],
      gitAvailable: true,
      productLayout: {
        findings: [],
        sourceRoots: ["packages/alpha/src", "packages/beta/src", "packages/core/src"],
        units: ["alpha", "beta", "core"].map((name) => ({
          declaredBy: `packages/${name}/package.json`,
          kind: "workspace",
          root: `packages/${name}`,
          sourceRoots: [`packages/${name}/src`],
          surfaceRoot: `packages/${name}`,
        })),
      },
      repositoryRoot,
      workspaceManifests: [
        {
          directory: "packages/alpha",
          internalDependencyNames: internalDependencies(["core"]),
          name: "alpha",
          scripts: lifecycleScripts,
        },
        {
          directory: "packages/beta",
          internalDependencyNames: internalDependencies(["alpha"]),
          name: "beta",
          scripts: lifecycleScripts,
        },
        {
          directory: "packages/core",
          internalDependencyNames: internalDependencies(),
          name: "core",
          scripts: lifecycleScripts,
        },
      ],
    },
  );
  const args = plan.workspaceCommands.flatMap((command) => command.args);
  assert.ok(args.includes("./packages/alpha"));
  assert.ok(args.includes("./packages/beta"));
  assert.equal(args.includes("./packages/core"), false);
  assert.equal(
    plan.readOnlyCommands.some((command) => command.key === "dependencies"),
    false,
  );
});

test("an executable index file retains upstream dependency coverage", (t) => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "executable-index-owner-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  const sourceDirectory = path.join(repositoryRoot, "packages", "alpha", "src");
  mkdirSync(sourceDirectory, { recursive: true });
  writeFileSync(
    path.join(sourceDirectory, "index.ts"),
    'import { coreValue } from "@fixture/core";\nexport const initialized = coreValue();\n',
    "utf8",
  );
  const lifecycleScripts = { lint: "lint", "test:unit": "unit" };
  const plan = buildPlan(
    { mode: "repo", printPlan: true, simulatedPaths: [] },
    {
      basis: { reason: "", trusted: true },
      changedPaths: ["packages/alpha/src/index.ts"],
      gitAvailable: true,
      productLayout: {
        findings: [],
        sourceRoots: ["packages/alpha/src", "packages/beta/src", "packages/core/src"],
        units: ["alpha", "beta", "core"].map((name) => ({
          declaredBy: `packages/${name}/package.json`,
          kind: "workspace",
          root: `packages/${name}`,
          sourceRoots: [`packages/${name}/src`],
          surfaceRoot: `packages/${name}`,
        })),
      },
      repositoryRoot,
      workspaceManifests: [
        {
          directory: "packages/alpha",
          internalDependencyNames: internalDependencies(["core"]),
          name: "alpha",
          scripts: lifecycleScripts,
        },
        {
          directory: "packages/beta",
          internalDependencyNames: internalDependencies(["alpha"]),
          name: "beta",
          scripts: lifecycleScripts,
        },
        {
          directory: "packages/core",
          internalDependencyNames: internalDependencies(),
          name: "core",
          scripts: lifecycleScripts,
        },
      ],
    },
  );
  const args = plan.workspaceCommands.flatMap((command) => command.args);
  assert.ok(args.includes("./packages/alpha"));
  assert.ok(args.includes("./packages/beta"));
  assert.ok(args.includes("./packages/core"));
});
