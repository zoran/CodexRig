/** Verifies production routing for documentation, runtime and policy inputs. */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  isRepositoryCodexHomePath,
  repositoryCodexHomeRuntimeProbePaths,
} from "../repository/source-inventory.mjs";
import { internalDependencies, route } from "./adaptive-runner-test-helpers.mjs";
import { commandCoversTest } from "./verification-admission-commands.mjs";

test("license and required-notice changes route to the licensing owner", () => {
  const plan = route(["LICENSE", "NOTICE"]);
  assert.deepEqual(plan.admission.unknownPaths, []);
  assert.deepEqual(plan.admission.uncoveredFullRelevantPaths, []);
  assert.ok(
    plan.classifiedPaths.every((entry) =>
      entry.categories.includes("licensing and attribution contract"),
    ),
  );
  assert.ok(plan.readOnlyCommands.some((command) => command.key === "licensing"));
});

test("native Codex home deltas retain an exclusion owner when source policy changes", () => {
  const nativePaths = [
    ...repositoryCodexHomeRuntimeProbePaths.filter(isRepositoryCodexHomePath),
    "auth.json.lock",
    "auth.lock",
    "tui-thread-reference-capabilities/current-thread",
    "sessions/untrusted.test.mjs",
    "skills/.system/untrusted.test.mjs",
    ".codex/runtime/cache/untrusted.test.mjs",
  ];
  assert.ok(nativePaths.includes("session_index.jsonl"));
  assert.ok(nativePaths.includes("session_index.jsonl.lock"));
  const plan = route([...nativePaths, ".gitignore"]);
  const owners = new Map(
    plan.admission.focusedCommandOwners.map((entry) => [entry.path, entry.ownerKeys]),
  );
  assert.equal(plan.admission.mode, "targeted");
  assert.deepEqual(plan.admission.fullRelevantPaths, [".gitignore"]);
  assert.deepEqual(plan.admission.unknownPaths, []);
  for (const relativePath of nativePaths) {
    assert.deepEqual(owners.get(relativePath), ["codex-config"], relativePath);
  }
  assert.ok(
    plan.readOnlyCommands.every((command) =>
      command.args.every((argument) => !nativePaths.includes(argument)),
    ),
  );
  assert.equal(plan.workspaceCommands.length, 0);

  const completePlan = route(nativePaths, { entryMode: "full" });
  assert.deepEqual(completePlan.admission.fullRelevantPaths, []);
  assert.deepEqual(completePlan.admission.unknownPaths, []);
});

test("non-Codex local runtime markers are ignored instead of becoming unknown paths", () => {
  const plan = route([
    ...repositoryCodexHomeRuntimeProbePaths.filter((entry) => !isRepositoryCodexHomePath(entry)),
    ".project-state/active.json",
  ]);
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
  for (const key of ["codex-config", "path-hygiene", "repository-smoke"]) {
    assert.ok(keys.has(key), key);
  }
});

test("ordinary policy documentation retains its lightweight verification owners", () => {
  const plan = route([
    ".agents/skills/ui-ux-review/SKILL.md",
    ".codex/config.toml",
    ".codex/README.md",
  ]);
  const owners = new Map(
    plan.admission.focusedCommandOwners.map((entry) => [entry.path, entry.ownerKeys]),
  );
  assert.deepEqual(owners.get(".agents/skills/ui-ux-review/SKILL.md"), [
    "delivery-environments",
    "docs",
    "language",
    "path-hygiene",
    "secrets",
    "skills",
  ]);
  assert.deepEqual(owners.get(".codex/config.toml"), ["codex-config"]);
  assert.deepEqual(owners.get(".codex/README.md"), [
    "delivery-environments",
    "docs",
    "language",
    "path-hygiene",
    "secrets",
  ]);
  assert.equal(
    plan.readOnlyCommands.some((command) => command.args.includes("--test")),
    false,
  );
});

test("executable policy inputs select their explicit generation consumers without broad suites", () => {
  const consumers = [
    "scripts/setup/project-creator-contract.source.test.mjs",
    "scripts/setup/project-initialization.source.test.mjs",
    "scripts/setup/staged-project-validator.test.mjs",
    "scripts/framework/framework-upgrade.test.mjs",
  ];
  for (const source of [
    "AGENTS.md",
    "instructions.md",
    "scripts/framework/generated-project-documents.mjs",
    "scripts/docs/document-context.mjs",
  ]) {
    const plan = route([source]);
    assert.equal(plan.admission.mode, "targeted", source);
    const keys = new Set(plan.readOnlyCommands.map((command) => command.key));
    for (const consumer of consumers) {
      assert.ok(
        plan.readOnlyCommands.some((command) => commandCoversTest(command, consumer)),
        `${source} must select ${consumer}`,
      );
    }
    for (const broadOwner of ["setup-regressions", "framework-regressions"]) {
      assert.equal(keys.has(broadOwner), false, `${source} must remain focused`);
    }
    if (source.endsWith(".md")) assert.ok(keys.has("docs"), source);
    const owners = plan.admission.focusedCommandOwners.find((entry) => entry.path === source);
    assert.ok(
      owners.ownerKeys.every((key) => keys.has(key)),
      source,
    );
  }
});
