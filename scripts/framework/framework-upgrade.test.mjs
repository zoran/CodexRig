/** Verifies framework upgrade conflicts, rollback, runtime exclusion and product preservation. */
import assert from "node:assert/strict";
import fs, { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  applyFrameworkUpgrade,
  buildFrameworkUpgradePlan,
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
