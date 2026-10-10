/** Verifies framework upgrade conflicts, rollback, runtime exclusion and product preservation. */
import assert from "node:assert/strict";
import fs, { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { stageRegenerationRuntime } from "./framework-upgrade-runtime.mjs";
import { atomicWriteOwnedFile } from "../filesystem/owned-file-operations.mjs";
import {
  beginFrameworkUpgrade,
  persistFrameworkUpgradeJournal,
} from "./framework-upgrade-journal.mjs";
import {
  applyFrameworkUpgrade,
  buildFrameworkUpgradePlan,
  desiredProjectToolFile,
  recoverInterruptedFrameworkUpgrade,
} from "./framework-upgrade.mjs";
import {
  cleanupTemporaryRoots,
  isolatedTrackedFrameworkSource,
  runProjectGenerator,
  temporaryRoot,
} from "../setup/project-initialization-test-helpers.mjs";
const write = (root, file, content) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
};
after(cleanupTemporaryRoots);
function fixture() {
  const source = isolatedTrackedFrameworkSource("migration-source-");
  const parent = temporaryRoot("migration-product-");
  const created = runProjectGenerator([
    "--source",
    source,
    "--name",
    "Migration Fixture",
    "--directory",
    "reference",
    "--output-parent",
    parent,
  ]);
  assert.equal(created.status, 0, created.stderr);
  const baseline = path.join(parent, "reference/code"),
    target = path.join(parent, "target");
  write(baseline, "scripts/framework/obsolete.mjs", "export const retired = true;\n");
  write(
    baseline,
    ".codexrig/installation.json",
    '{"oldPrivateSchema":"opaque; never interpreted"}\n',
  );
  write(baseline, "NOTICE", "obsolete generated notice\n");
  const pkg = JSON.parse(readFileSync(path.join(baseline, "package.json"), "utf8"));
  pkg.scripts["framework:upgrade"] = "node scripts/framework/obsolete.mjs";
  write(baseline, "package.json", JSON.stringify(pkg, null, 2) + "\n");
  cpSync(baseline, target, { recursive: true });
  for (const file of [
    "README.md",
    "AGENTS.md",
    "instructions.md",
    "docs/project.md",
    "docs/requirements.md",
    "docs/ui-reference.html",
    "src/product-data.json",
  ])
    write(target, file, `Product-owned ${file}\n`);
  const file = "scripts/docs/project-document-policy.mjs";
  const before = readFileSync(path.join(source, file), "utf8");
  write(source, file, before + "\n// Current selected tool revision.\n");
  return { sourceRoot: source, baselineRoot: baseline, targetRoot: target, file };
}

test("explicit migration removes obsolete source tools under ownership and preserves product documents and identity", async (t) => {
  const fixtureData = fixture(),
    plan = buildFrameworkUpgradePlan(fixtureData);
  for (const file of [
    "scripts/setup/start-codex.sh",
    "scripts/repository/runtime-session-lease.mjs",
  ]) {
    fs.chmodSync(path.join(fixtureData.sourceRoot, file), 0o660);
    assert.equal(
      desiredProjectToolFile(fixtureData.sourceRoot, file).mode,
      fs.lstatSync(path.join(fixtureData.baselineRoot, file)).mode & 0o777,
    );
  }
  assert.deepEqual(plan.conflicts, []);
  assert.ok(
    plan.operations.some(
      (op) => op.path === ".codexrig/installation.json" && op.action === "delete",
    ),
  );
  const beforePackage = JSON.parse(
    readFileSync(path.join(fixtureData.targetRoot, "package.json"), "utf8"),
  );
  const lifecycle = await import(
    pathToFileURL(path.join(fixtureData.targetRoot, "scripts/repository/runtime-session-lease.mjs"))
      .href
  );
  const removeDirectory = fs.rmdirSync;
  let checkedCleanupOwnership = false;
  const removal = t.mock.method(fs, "rmdirSync", (directory, ...options) => {
    if (fs.realpathSync(directory) === path.join(fixtureData.targetRoot, ".codexrig")) {
      checkedCleanupOwnership = true;
      assert.throws(() => {
        const contender = lifecycle.acquireRuntimeLifecycleLock({
          root: fixtureData.targetRoot,
          operation: "fixture-cleanup-contender",
        });
        lifecycle.releaseRuntimeLifecycleLock({ root: fixtureData.targetRoot, owner: contender });
      }, /lifecycle|already|active|mutation/iu);
    }
    return removeDirectory(directory, ...options);
  });
  syncBuiltinESMExports();
  try {
    await applyFrameworkUpgrade(plan);
  } finally {
    removal.mock.restore();
    syncBuiltinESMExports();
  }
  assert.equal(checkedCleanupOwnership, true);
  for (const file of [
    "README.md",
    "AGENTS.md",
    "instructions.md",
    "docs/project.md",
    "docs/requirements.md",
    "docs/ui-reference.html",
    "src/product-data.json",
  ])
    assert.equal(
      readFileSync(path.join(fixtureData.targetRoot, file), "utf8"),
      `Product-owned ${file}\n`,
    );
  for (const file of [
    "scripts/framework",
    ".codexrig",
    "NOTICE",
    ".project-state/framework-upgrade",
  ])
    assert.equal(existsSync(path.join(fixtureData.targetRoot, file)), false, file);
  const afterPackage = JSON.parse(
    readFileSync(path.join(fixtureData.targetRoot, "package.json"), "utf8"),
  );
  assert.equal(afterPackage.name, beforePackage.name);
  assert.equal(afterPackage.version, beforePackage.version);
  assert.equal(afterPackage.scripts["framework:upgrade"], undefined);
  assert.deepEqual(buildFrameworkUpgradePlan(fixtureData).operations, []);
});

test("migration detects divergent edits before writing and preserves an unchanged upstream field", () => {
  const data = fixture();
  write(data.targetRoot, data.file, "// Product-specific tool implementation.\n");
  const packagePath = path.join(data.targetRoot, "package.json");
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  pkg.packageManager = "pnpm@11.999.0";
  writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");
  const plan = buildFrameworkUpgradePlan(data);
  assert.ok(plan.conflicts.includes(data.file));
  const projected = plan.operations.find((op) => op.path === "package.json");
  assert.equal(JSON.parse(projected.content).packageManager, "pnpm@11.999.0");
  // Distinct corrupt byte sequences must never compare equal through replacement characters.
  writeFileSync(path.join(data.baselineRoot, data.file), Buffer.from([0x80]));
  writeFileSync(path.join(data.targetRoot, data.file), Buffer.from([0x81]));
  assert.throws(() => buildFrameworkUpgradePlan(data), /valid UTF-8 tool content/);
  assert.deepEqual(readFileSync(path.join(data.targetRoot, data.file)), Buffer.from([0x81]));
});

test("an installation failure restores the complete owned migration batch", async () => {
  const data = fixture(),
    plan = buildFrameworkUpgradePlan(data);
  const before = readFileSync(path.join(data.targetRoot, data.file), "utf8");
  let written = 0;
  await assert.rejects(
    applyFrameworkUpgrade(plan, {
      afterWrite() {
        if (++written === 2) throw new Error("fixture installation failure");
      },
    }),
    /fixture installation failure/,
  );
  assert.equal(readFileSync(path.join(data.targetRoot, data.file), "utf8"), before);
  assert.equal(existsSync(path.join(data.targetRoot, "NOTICE")), true);
  assert.deepEqual(buildFrameworkUpgradePlan(data).operations, plan.operations);
  assert.equal(existsSync(path.join(data.targetRoot, ".project-state/framework-upgrade")), false);
});

test("target-owned runtime exclusion blocks migration before any write", async () => {
  const data = fixture(),
    plan = buildFrameworkUpgradePlan(data);
  const lifecycle = await import(
    pathToFileURL(path.join(data.targetRoot, "scripts/repository/runtime-session-lease.mjs")).href
  );
  const owner = lifecycle.acquireRuntimeLifecycleLock({
    root: data.targetRoot,
    operation: "fixture-active-writer",
  });
  try {
    await assert.rejects(applyFrameworkUpgrade(plan), /lifecycle|already|active|mutation/iu);
  } finally {
    lifecycle.releaseRuntimeLifecycleLock({ root: data.targetRoot, owner });
  }
  assert.equal(existsSync(path.join(data.targetRoot, "NOTICE")), true);
});

test("migration recovery preserves unrelated edits and resumes only after reconciliation", async () => {
  const data = fixture();
  const plan = buildFrameworkUpgradePlan(data);
  let interrupted;
  await assert.rejects(
    applyFrameworkUpgrade(plan, {
      afterWrite(operation) {
        interrupted = operation;
        write(data.targetRoot, operation.path, "Unrelated concurrent edit.\n");
        throw new Error("interrupted fixture");
      },
    }),
    /preserved its journal/,
  );
  await assert.rejects(recoverInterruptedFrameworkUpgrade(data.targetRoot), /unrelated change/);
  assert.equal(
    readFileSync(path.join(data.targetRoot, interrupted.path), "utf8"),
    "Unrelated concurrent edit.\n",
  );
  if (interrupted.action === "delete") {
    const { rmSync } = await import("node:fs");
    rmSync(path.join(data.targetRoot, interrupted.path));
  } else write(data.targetRoot, interrupted.path, interrupted.content);
  assert.equal(await recoverInterruptedFrameworkUpgrade(data.targetRoot), true);
  assert.deepEqual(buildFrameworkUpgradePlan(data).operations, plan.operations);
  assert.equal(existsSync(path.join(data.targetRoot, ".project-state/framework-upgrade")), false);
});

test("current-output review requires policy decisions, preserves custom tools and rejects stale approvals", async () => {
  const data = fixture();
  write(data.targetRoot, "scripts/verify/product-check.mjs", "// Product verifier.\n");
  const options = { sourceRoot: data.sourceRoot, targetRoot: data.targetRoot };
  const preview = buildFrameworkUpgradePlan(options);
  assert.ok(preview.conflicts.includes("AGENTS.md"));
  assert.ok(preview.conflicts.includes("scripts/verify/product-check.mjs"));
  await assert.rejects(applyFrameworkUpgrade(preview), /explicit local reconciliation/);
  const resolutions = preview.differences.map(({ kind, ...entry }) => ({
    ...entry,
    action: entry.path === "scripts/verify/product-check.mjs" ? "keep" : "source",
    reason:
      entry.path === "scripts/verify/product-check.mjs"
        ? "Existing product test owner."
        : "Reviewed current generated behavior.",
  }));
  const reviewed = buildFrameworkUpgradePlan({ ...options, resolutions });
  assert.deepEqual(reviewed.conflicts, []);
  assert.deepEqual(
    reviewed.deviations.map((x) => x.path),
    ["scripts/verify/product-check.mjs"],
  );
  write(data.targetRoot, "AGENTS.md", "Changed after review.\n");
  assert.throws(
    () => buildFrameworkUpgradePlan({ ...options, resolutions }),
    /Stale reconciliation/,
  );
});

test("reviewed file modes survive a restrictive umask on apply and rollback", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX file modes");
  const data = fixture();
  const options = { sourceRoot: data.sourceRoot, targetRoot: data.targetRoot };
  const readme = path.join(data.targetRoot, "README.md");
  const original = readFileSync(readme, "utf8");
  fs.chmodSync(readme, 0o664);
  const preview = buildFrameworkUpgradePlan(options);
  const resolutions = preview.differences.map(({ kind, ...entry }) => ({
    ...entry,
    action: "keep",
    reason: "Unchanged fixture owners outside the reviewed document update.",
  }));
  resolutions.push({
    ...preview.documentBindings.find((entry) => entry.path === "README.md"),
    action: "replace",
    reason: "Preserve the reviewed group-readable mode through atomic publication and recovery.",
    content: "# Updated project commands\n",
    mode: 0o640,
  });
  const originalUmask = process.umask(0o077);
  try {
    const privateRoot = temporaryRoot("migration-private-mode-");
    const privateFile = path.join(privateRoot, "state");
    atomicWriteOwnedFile(privateRoot, privateFile, "private", 0o664);
    assert.equal(fs.statSync(privateFile).mode & 0o777, 0o600);
    await assert.rejects(
      applyFrameworkUpgrade(buildFrameworkUpgradePlan({ ...options, resolutions }), {
        afterWrite(operation) {
          if (operation.path === "README.md") {
            assert.equal(fs.statSync(readme).mode & 0o777, 0o640);
            throw new Error("Injected interruption after exact-mode publication");
          }
        },
      }),
      /Injected interruption after exact-mode publication/,
    );
    assert.equal(readFileSync(readme, "utf8"), original);
    assert.equal(fs.statSync(readme).mode & 0o777, 0o664);
    await applyFrameworkUpgrade(buildFrameworkUpgradePlan({ ...options, resolutions }));
    assert.equal(readFileSync(readme, "utf8"), "# Updated project commands\n");
    assert.equal(fs.statSync(readme).mode & 0o777, 0o640);
  } finally {
    process.umask(originalUmask);
  }
});

test("reviewed policy and tools share rollback, custom replacements and convergence evidence", async () => {
  const data = fixture(),
    options = { sourceRoot: data.sourceRoot, targetRoot: data.targetRoot };
  const preview = buildFrameworkUpgradePlan(options);
  const original = readFileSync(path.join(data.targetRoot, "AGENTS.md"), "utf8");
  const originalReadme = readFileSync(path.join(data.targetRoot, "README.md"), "utf8");
  const resolutions = preview.differences.map(({ kind, ...entry }) => ({
    ...entry,
    action: "source",
    reason: "Reviewed migration.",
  }));
  resolutions.push({
    ...preview.documentBindings.find((x) => x.path === "README.md"),
    action: "replace",
    reason: "Reviewed operational commands.",
    content: "# Product\n\nCurrent operational commands.\n",
    mode: 0o644,
  });
  const policy = resolutions.find((x) => x.path === "AGENTS.md");
  Object.assign(policy, {
    action: "replace",
    content: "# Project\n\nPreserve the product approval gate.\n",
    mode: 0o644,
  });
  const reviewed = buildFrameworkUpgradePlan({ ...options, resolutions });
  await assert.rejects(
    applyFrameworkUpgrade(reviewed, {
      afterWrite(op) {
        if (op.path === "instructions.md") throw new Error("Injected policy failure");
      },
    }),
    /Injected policy failure/,
  );
  assert.equal(readFileSync(path.join(data.targetRoot, "AGENTS.md"), "utf8"), original);
  assert.equal(readFileSync(path.join(data.targetRoot, "README.md"), "utf8"), originalReadme);
  await applyFrameworkUpgrade(buildFrameworkUpgradePlan({ ...options, resolutions }));
  assert.equal(readFileSync(path.join(data.targetRoot, "AGENTS.md"), "utf8"), policy.content);
  const after = buildFrameworkUpgradePlan(options);
  assert.deepEqual(after.conflicts, ["AGENTS.md"]);
  assert.equal(after.operations.length, 0);
  const [{ kind, ...difference }] = after.differences;
  const settled = buildFrameworkUpgradePlan({
    ...options,
    resolutions: [{ ...difference, action: "keep", reason: "Current product gate retained." }],
  });
  assert.deepEqual(await applyFrameworkUpgrade(settled), { changed: false });
  assert.equal(existsSync(path.join(data.targetRoot, ".project-state/framework-upgrade")), false);
});

test("a runtime namespace cutover excludes installed and destination writers throughout writes", async () => {
  const data = fixture();
  for (const file of [
    "scripts/repository/runtime-session-lease.mjs",
    "scripts/repository/runtime-lifecycle-mutex.mjs",
  ]) {
    const text = readFileSync(path.join(data.targetRoot, file), "utf8").replaceAll(
      "project-lifecycle",
      "prior-lifecycle",
    );
    write(data.targetRoot, file, text);
  }
  const options = { sourceRoot: data.sourceRoot, targetRoot: data.targetRoot };
  const preview = buildFrameworkUpgradePlan(options);
  const resolutions = preview.differences.map(({ kind, ...entry }) => ({
    ...entry,
    action: "source",
    reason: "Atomic current runtime cutover.",
  }));
  const destination = await import(
    pathToFileURL(path.join(data.baselineRoot, "scripts/repository/runtime-session-lease.mjs")).href
  );
  let checked = false;
  await applyFrameworkUpgrade(buildFrameworkUpgradePlan({ ...options, resolutions }), {
    afterWrite() {
      assert.throws(
        () =>
          destination.acquireRuntimeLifecycleLock({
            root: data.targetRoot,
            operation: "competing-writer",
          }),
        /lock|owner|active|held|busy/i,
      );
      checked = true;
    },
  });
  assert.ok(checked);
  const owner = destination.acquireRuntimeLifecycleLock({
    root: data.targetRoot,
    operation: "post-upgrade-check",
  });
  destination.releaseRuntimeLifecycleLock({ root: data.targetRoot, owner });
});

test("reviewed child lifecycle dependencies survive destination staging and atomic reconciliation", async () => {
  const data = fixture();
  const ownerPath = "scripts/repository/runtime-session-lease.mjs";
  const customPath = "scripts/repository/product-lifecycle.mjs";
  const leafPath = "scripts/repository/product-lifecycle-value.mjs";
  const unrelatedPath = "scripts/verify/unrelated-product.mjs";
  write(
    data.targetRoot,
    ownerPath,
    readFileSync(path.join(data.targetRoot, ownerPath), "utf8") +
      '\nexport { productLifecycle } from "./product-lifecycle.mjs";\n',
  );
  write(
    data.targetRoot,
    customPath,
    'export { value as productLifecycle } from "./product-lifecycle-value.mjs";\n',
  );
  write(data.targetRoot, leafPath, "export const value = 1;\n");
  write(
    data.targetRoot,
    unrelatedPath,
    'throw new Error("unrelated product code must not run");\n',
  );
  const options = { sourceRoot: data.sourceRoot, targetRoot: data.targetRoot };
  const preview = buildFrameworkUpgradePlan(options);
  const retained = new Set([ownerPath, customPath, leafPath, unrelatedPath]);
  const resolutions = preview.differences.map(({ kind, ...entry }) => ({
    ...entry,
    action: retained.has(entry.path) ? "keep" : "source",
    reason: retained.has(entry.path)
      ? "Reviewed child runtime and product boundary."
      : "Current framework.",
  }));
  Object.assign(
    resolutions.find((entry) => entry.path === leafPath),
    {
      action: "replace",
      content: "export const value = 2;\n",
      mode: 0o644,
    },
  );
  await applyFrameworkUpgrade(buildFrameworkUpgradePlan({ ...options, resolutions }));
  assert.equal(
    readFileSync(path.join(data.targetRoot, leafPath), "utf8"),
    "export const value = 2;\n",
  );
  assert.match(
    readFileSync(path.join(data.targetRoot, ownerPath), "utf8"),
    /product-lifecycle\.mjs/u,
  );
  assert.equal(existsSync(path.join(data.targetRoot, ".project-state/framework-upgrade")), false);
});

test("destination lifecycle staging rejects imports outside the reviewed tool surface", async () => {
  const data = fixture();
  const ownerPath = "scripts/repository/runtime-session-lease.mjs";
  const original = readFileSync(path.join(data.targetRoot, ownerPath), "utf8");
  write(data.targetRoot, "src/product-private.mjs", 'throw new Error("product code evaluated");\n');
  const options = { sourceRoot: data.sourceRoot, targetRoot: data.targetRoot };
  const preview = buildFrameworkUpgradePlan(options);
  const resolutions = preview.differences.map(({ kind, ...entry }) => ({
    ...entry,
    action: "source",
    reason: "Current framework.",
  }));
  // Force a reviewed owner difference while keeping its installed runtime valid for admission.
  write(data.targetRoot, ownerPath, original + "\n// Child runtime owner.\n");
  const changed = buildFrameworkUpgradePlan(options).differences.find(
    (entry) => entry.path === ownerPath,
  );
  const { kind, ...binding } = changed;
  resolutions.push({
    ...binding,
    action: "replace",
    reason: "Exercise an unadmitted lifecycle dependency.",
    content: original + '\nimport "../../src/product-private.mjs";\n',
    mode: binding.currentMode,
  });
  await assert.rejects(
    applyFrameworkUpgrade(buildFrameworkUpgradePlan({ ...options, resolutions })),
    /Destination lifecycle dependency requires explicit tool review: src\/product-private\.mjs/u,
  );
  assert.equal(
    readFileSync(path.join(data.targetRoot, ownerPath), "utf8"),
    original + "\n// Child runtime owner.\n",
  );
  assert.equal(existsSync(path.join(data.targetRoot, ".project-state/framework-upgrade")), false);
});

test("explicit regeneration preserves private state, requires quiescence and rolls back public owners", async () => {
  const data = fixture();
  fs.rmSync(path.join(data.targetRoot, "scripts/repository/runtime-session-lease.mjs"));
  write(data.targetRoot, ".sandbox_migration", "private marker\n");
  write(data.targetRoot, ".codex/runtime/private.json", "opaque private bytes\n");
  write(data.targetRoot, "docs/obsolete-context.md", "# Obsolete Context\n");
  const options = {
    sourceRoot: data.sourceRoot,
    targetRoot: data.targetRoot,
    regenerate: true,
    projectPaths: [
      "docs/obsolete-context.md",
      "config/localization.json",
      "scripts/verify/product-runtime.mjs",
    ],
  };
  assert.throws(
    () => buildFrameworkUpgradePlan({ ...options, projectPaths: ["docs/../auth.json"] }),
    /public/,
  );
  const preview = buildFrameworkUpgradePlan(options);
  assert.ok(!preview.differences.some((x) => /private|sandbox_migration/.test(x.path)));
  const resolutions = preview.differences.map(({ kind, ...entry }) => ({
    ...entry,
    action: "source",
    reason: "Reviewed regenerated tools.",
  }));
  resolutions.push({
    ...preview.documentBindings.find((x) => x.path === "docs/obsolete-context.md"),
    action: "remove",
    reason: "The only obsolete public context contract is retired.",
  });
  resolutions.push({
    ...preview.documentBindings.find((x) => x.path === "scripts/verify/product-runtime.mjs"),
    action: "replace",
    content: "export const product = true;\n",
    mode: 0o644,
    reason: "Preserve product verification at its explicit new owner.",
  });
  const plan = buildFrameworkUpgradePlan({ ...options, resolutions });
  await assert.rejects(applyFrameworkUpgrade(plan), /confirmed quiescence/);
  await assert.rejects(
    applyFrameworkUpgrade(
      buildFrameworkUpgradePlan({ ...options, regenerate: false, resolutions }),
    ),
    /runtime-session-lease/,
  );
  const staged = await stageRegenerationRuntime(data.sourceRoot, plan.regenerationRuntimeHash);
  const writer = staged.lifecycle.acquireRuntimeLifecycleLock({
    root: data.targetRoot,
    operation: "competing-writer",
  });
  await assert.rejects(
    applyFrameworkUpgrade(plan, { confirmQuiescent: true }),
    /active|lock|held|busy/i,
  );
  staged.lifecycle.releaseRuntimeLifecycleLock({ root: data.targetRoot, owner: writer });
  staged.cleanup();
  await assert.rejects(
    applyFrameworkUpgrade(plan, {
      confirmQuiescent: true,
      afterWrite(op) {
        if (op.path === "scripts/repository/runtime-session-lease.mjs")
          throw new Error("injected late regeneration failure");
      },
    }),
    /injected late/,
  );
  assert.equal(
    existsSync(path.join(data.targetRoot, "scripts/repository/runtime-session-lease.mjs")),
    false,
  );
  assert.equal(
    readFileSync(path.join(data.targetRoot, "docs/obsolete-context.md"), "utf8"),
    "# Obsolete Context\n",
  );
  await applyFrameworkUpgrade(plan, { confirmQuiescent: true });
  assert.equal(
    readFileSync(path.join(data.targetRoot, ".sandbox_migration"), "utf8"),
    "private marker\n",
  );
  assert.equal(
    readFileSync(path.join(data.targetRoot, ".codex/runtime/private.json"), "utf8"),
    "opaque private bytes\n",
  );
  assert.equal(existsSync(path.join(data.targetRoot, "docs/obsolete-context.md")), false);
  assert.equal(
    readFileSync(path.join(data.targetRoot, "scripts/verify/product-runtime.mjs"), "utf8"),
    "export const product = true;\n",
  );
});

test("regeneration rejects a changed lifecycle dependency before creating its journal", async () => {
  const data = fixture();
  fs.rmSync(path.join(data.targetRoot, "scripts/repository/runtime-session-lease.mjs"));
  const options = { sourceRoot: data.sourceRoot, targetRoot: data.targetRoot, regenerate: true };
  const dependency = "scripts/repository/runtime-lifecycle-mutex.mjs";
  const current = readFileSync(path.join(data.targetRoot, dependency), "utf8");
  write(data.targetRoot, dependency, current + "\n// divergent lifecycle contract\n");
  const preview = buildFrameworkUpgradePlan(options);
  const resolutions = preview.differences.map(({ kind, ...entry }) => ({
    ...entry,
    action: entry.path === dependency ? "keep" : "source",
    reason: "Exercise explicit lifecycle divergence admission.",
  }));
  await assert.rejects(
    applyFrameworkUpgrade(buildFrameworkUpgradePlan({ ...options, resolutions }), {
      confirmQuiescent: true,
    }),
    /current lifecycle contract/,
  );
  assert.equal(existsSync(path.join(data.targetRoot, ".project-state/framework-upgrade")), false);
  assert.equal(
    existsSync(path.join(data.targetRoot, "scripts/repository/runtime-session-lease.mjs")),
    false,
  );
});

test("regeneration recovery uses the bound source closure even when the installed owner is invalid", async () => {
  const data = fixture();
  const ownerPath = "scripts/repository/runtime-session-lease.mjs";
  fs.rmSync(path.join(data.targetRoot, ownerPath));
  const options = { sourceRoot: data.sourceRoot, targetRoot: data.targetRoot, regenerate: true };
  const preview = buildFrameworkUpgradePlan(options);
  const resolutions = preview.differences.map(({ kind, ...entry }) => ({
    ...entry,
    action: "source",
    reason: "Current regeneration.",
  }));
  const plan = buildFrameworkUpgradePlan({ ...options, resolutions });
  const stage = await stageRegenerationRuntime(data.sourceRoot, plan.regenerationRuntimeHash);
  const { journal, lifecycleCapability } = beginFrameworkUpgrade(plan, stage.lifecycle);
  const item = journal.originals.find((x) => x.path === ownerPath);
  // Model an admitted interrupted file state without relying on target module evaluation.
  const broken = "export const incomplete = ;\n";
  const { sha256 } = await import("../filesystem/repository-files.mjs");
  item.allowedSha256 = sha256(broken);
  item.allowedMode = 0o644;
  persistFrameworkUpgradeJournal(data.targetRoot, journal);
  write(data.targetRoot, ownerPath, broken);
  fs.chmodSync(path.join(data.targetRoot, ownerPath), item.allowedMode);
  stage.lifecycle.releaseRuntimeLifecycleLock({
    root: data.targetRoot,
    owner: lifecycleCapability,
  });
  stage.cleanup();
  await assert.rejects(
    recoverInterruptedFrameworkUpgrade(data.targetRoot),
    /explicit regeneration recovery/,
  );
  const recovery = { regenerate: true, confirmQuiescent: true, sourceRoot: data.sourceRoot };
  const sourceOwner = path.join(data.sourceRoot, ownerPath);
  const original = readFileSync(sourceOwner, "utf8");
  writeFileSync(sourceOwner, original + "\n// changed runtime\n");
  await assert.rejects(
    recoverInterruptedFrameworkUpgrade(data.targetRoot, recovery),
    /exact admitted/,
  );
  writeFileSync(sourceOwner, original);
  const contenderStage = await stageRegenerationRuntime(
    data.sourceRoot,
    plan.regenerationRuntimeHash,
  );
  const writer = contenderStage.lifecycle.acquireRuntimeLifecycleLock({
    root: data.targetRoot,
    operation: "competing-writer",
  });
  await assert.rejects(
    recoverInterruptedFrameworkUpgrade(data.targetRoot, recovery),
    /active|held|busy|lock/i,
  );
  contenderStage.lifecycle.releaseRuntimeLifecycleLock({ root: data.targetRoot, owner: writer });
  contenderStage.cleanup();
  assert.equal(await recoverInterruptedFrameworkUpgrade(data.targetRoot, recovery), true);
  assert.equal(existsSync(path.join(data.targetRoot, ownerPath)), false);
  assert.equal(existsSync(path.join(data.targetRoot, ".project-state/framework-upgrade")), false);
});
