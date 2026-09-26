#!/usr/bin/env node
/** Owns explicit framework upgrade planning, conflict detection and atomic project-tool migration. */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  toolingRoot,
  readRepositoryFile,
  serializeCanonicalJson,
  sha256,
} from "../filesystem/repository-files.mjs";
import { readFrameworkContract } from "../contracts/framework-contract.mjs";
import { listPortableTransferFiles } from "../repository/source-inventory.mjs";
import {
  readProjectToolSelection,
  selectedProjectPackage,
  selectedProjectVerification,
} from "./project-tool-selection.mjs";
import { projectCiProjection, projectToolingConfiguration } from "./generated-project-tooling.mjs";
import { projectOutputText } from "./project-output-projection.mjs";
import {
  isProjectToolPath,
  atomicWriteUpgradeFile,
  realUpgradeDirectory,
  targetUpgradeFileState,
} from "./framework-upgrade-io.mjs";
import {
  beginFrameworkUpgrade,
  readFrameworkUpgradeJournal,
  recoverFrameworkUpgradeState,
  removeFrameworkUpgradeState,
  restoreFrameworkUpgradeJournal,
} from "./framework-upgrade-journal.mjs";
import {
  assertRegenerationLifecycleClosure,
  holdDestinationUpgradeRuntime,
  regenerationRuntimeHash,
  stageRegenerationRuntime,
} from "./framework-upgrade-runtime.mjs";
import { buildReviewedFrameworkUpgradePlan } from "./framework-upgrade-review.mjs";
import {
  removeOwnedRegularFile,
  removeOwnedEmptyDirectory,
} from "../filesystem/owned-file-operations.mjs";

function same(left, right) {
  return left.sha256 === right.sha256 && left.mode === right.mode;
}
export function desiredProjectToolFile(source, file, selection) {
  let content = readRepositoryFile(source, file);
  if (file === ".codex/config.toml") {
    if ((content.match(/^memories = false$/gmu)?.length ?? 0) !== 1)
      throw new Error("Source memory configuration is not the current template.");
    content = content.replace(/^memories = false$/mu, "memories = true");
  } else if (file === ".codex/tooling.json") {
    content = projectToolingConfiguration(content);
  } else if (file === ".codex/verification.json") {
    content =
      JSON.stringify(selectedProjectVerification(JSON.parse(content), selection), null, 2) + "\n";
  } else if ([".github/workflows/ci.yml", ".gitlab-ci.yml"].includes(file))
    content = projectCiProjection(file, content);
  content = projectOutputText(content);
  return {
    exists: true,
    content,
    sha256: sha256(content),
    // Match copyStableRepositoryFile's shebang-based portable output, not host-local permissions.
    mode: content.startsWith("#!") ? 0o755 : 0o644,
  };
}
function packageMigration(base, current, desired, conflicts) {
  const next = structuredClone(current);
  const merge = (owner, before, actual, after) => {
    const result = { ...actual };
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (
        JSON.stringify(actual[key]) === JSON.stringify(after[key]) ||
        JSON.stringify(before[key]) === JSON.stringify(after[key])
      )
        continue;
      if (JSON.stringify(actual[key]) !== JSON.stringify(before[key])) {
        conflicts.push(`${owner}.${key}`);
        continue;
      }
      if (Object.hasOwn(after, key)) result[key] = after[key];
      else delete result[key];
    }
    return result;
  };
  next.scripts = merge(
    "package.json scripts",
    base.scripts ?? {},
    current.scripts ?? {},
    desired.scripts,
  );
  next.devDependencies = merge(
    "package.json devDependencies",
    base.devDependencies ?? {},
    current.devDependencies ?? {},
    desired.devDependencies,
  );
  const fields = merge(
    "package.json",
    { packageManager: base.packageManager, license: base.license },
    { packageManager: current.packageManager, license: current.license },
    { packageManager: desired.packageManager, license: desired.license },
  );
  Object.assign(next, fields);
  return next;
}

/** Baseline is an explicitly supplied pristine generated tree. Old metadata is opaque file content. */
export function buildFrameworkUpgradePlan(options) {
  const { sourceRoot = toolingRoot, targetRoot, baselineRoot } = options;
  if (!baselineRoot) {
    const plan = buildReviewedFrameworkUpgradePlan(
      { ...options, sourceRoot },
      desiredProjectToolFile,
    );
    if (options.regenerate === true) {
      plan.regenerate = true;
      plan.regenerationRuntimeHash = regenerationRuntimeHash(sourceRoot);
      plan.digest = sha256(
        serializeCanonicalJson({
          digest: plan.digest,
          regenerationRuntimeHash: plan.regenerationRuntimeHash,
        }),
      );
    }
    return plan;
  }
  if (options.regenerate || options.projectPaths?.length)
    throw new Error("Regeneration and explicit project owners require current-output review.");
  const source = realUpgradeDirectory(sourceRoot, "source");
  const target = realUpgradeDirectory(targetRoot, "target");
  const baseline = realUpgradeDirectory(baselineRoot, "pristine generated reference");
  const roots = [source, target, baseline];
  for (const left of roots)
    for (const right of roots)
      if (
        left !== right &&
        (right.startsWith(left + path.sep) || left.startsWith(right + path.sep))
      )
        throw new Error("Migration roots must be disjoint.");
  if (new Set(roots).size !== 3) throw new Error("Migration needs three distinct roots.");
  readFrameworkContract(source);
  const selection = readProjectToolSelection(source);
  const baselineFiles = listPortableTransferFiles({
    root: baseline,
    includeUntracked: true,
  }).filter(isProjectToolPath);
  const desiredFiles = selection.files.filter(isProjectToolPath);
  const desiredSet = new Set(desiredFiles);
  const operations = [],
    conflicts = [],
    snapshots = [];
  for (const file of [...new Set([...baselineFiles, ...desiredFiles])].sort()) {
    const before = targetUpgradeFileState(baseline, file);
    const current = targetUpgradeFileState(target, file);
    const desired = desiredSet.has(file)
      ? desiredProjectToolFile(source, file, selection)
      : { exists: false, mode: null, sha256: null };
    snapshots.push({ file, before, current, desired });
    if (same(current, desired) || (desired.exists && same(before, desired))) continue;
    if (!same(before, current)) {
      conflicts.push(file);
      continue;
    }
    operations.push(
      desired.exists
        ? {
            path: file,
            action: "write",
            content: desired.content,
            mode: desired.mode,
            expected: current.sha256,
            expectedMode: current.mode,
          }
        : { path: file, action: "delete", expected: current.sha256, expectedMode: current.mode },
    );
  }
  const before = JSON.parse(readRepositoryFile(baseline, "package.json"));
  const currentContent = readRepositoryFile(target, "package.json");
  const current = JSON.parse(currentContent);
  const desired = selectedProjectPackage(
    JSON.parse(readRepositoryFile(source, "package.json")),
    selection,
  );
  const next = packageMigration(before, current, desired, conflicts);
  if (JSON.stringify(current) !== JSON.stringify(next))
    operations.push({
      path: "package.json",
      action: "write",
      content: JSON.stringify(next, null, 2) + "\n",
      mode: lstatSync(path.join(target, "package.json")).mode & 0o777,
      expected: sha256(currentContent),
    });
  const digest = sha256(
    serializeCanonicalJson({ source, target, baseline, snapshots, operations, conflicts }),
  );
  return {
    sourceRoot: source,
    targetRoot: target,
    baselineRoot: baseline,
    operations,
    conflicts: conflicts.sort(),
    digest,
  };
}

/** The target's installed runtime owner understands its own current state and namespace. */
async function targetLifecycle(root) {
  const relativePath = "scripts/repository/runtime-session-lease.mjs";
  readRepositoryFile(root, relativePath);
  const lifecycle = await import(pathToFileURL(path.join(root, relativePath)).href);
  for (const name of [
    "acquireRuntimeLifecycleLock",
    "releaseRuntimeLifecycleLock",
    "assertRuntimeLifecycleQuiescent",
  ])
    if (typeof lifecycle[name] !== "function")
      throw new Error(
        "Target runtime does not provide the supported migration boundary; regenerate only after all owning sessions exit.",
      );
  return lifecycle;
}
export async function recoverInterruptedFrameworkUpgrade(
  root,
  { regenerate = false, confirmQuiescent = false, sourceRoot = toolingRoot } = {},
) {
  if (regenerate) {
    if (!confirmQuiescent)
      throw new Error("Regeneration requires confirmed quiescence of all target writers.");
    const journal = readFrameworkUpgradeJournal(root);
    if (!journal.regenerationRuntimeHash)
      throw new Error("This is not a regeneration transaction.");
    const staged = await stageRegenerationRuntime(sourceRoot, journal.regenerationRuntimeHash);
    try {
      return recoverFrameworkUpgradeState(root, { lifecycle: staged.lifecycle });
    } finally {
      staged.cleanup();
    }
  }
  if (
    existsSync(path.join(root, ".project-state/framework-upgrade/journal.json")) &&
    readFrameworkUpgradeJournal(root).regenerationRuntimeHash
  )
    throw new Error(
      "Interrupted regeneration requires explicit regeneration recovery and confirmed quiescence.",
    );
  const lifecycle = await targetLifecycle(root);
  return recoverFrameworkUpgradeState(root, { lifecycle });
}

export async function applyFrameworkUpgrade(plan, { afterWrite, confirmQuiescent = false } = {}) {
  if (plan.conflicts.length)
    throw new Error(
      `Migration conflicts require explicit local reconciliation: ${plan.conflicts.join(", ")}`,
    );
  let staged;
  if (plan.regenerate) {
    if (!confirmQuiescent)
      throw new Error("Regeneration requires confirmed quiescence of all target writers.");
    if (existsSync(path.join(plan.targetRoot, "scripts/repository/runtime-session-lease.mjs")))
      throw new Error(
        "Regeneration start requires an absent installed runtime; use ordinary upgrade or interrupted recovery.",
      );
    staged = await stageRegenerationRuntime(plan.sourceRoot, plan.regenerationRuntimeHash);
  }
  try {
    const lifecycle = staged?.lifecycle ?? (await targetLifecycle(plan.targetRoot));
    const refreshed = buildFrameworkUpgradePlan(plan);
    if (refreshed.digest !== plan.digest)
      throw new Error("Migration inputs changed after planning.");
    if (
      serializeCanonicalJson(refreshed.operations) !== serializeCanonicalJson(plan.operations) ||
      refreshed.conflicts.length
    )
      throw new Error("Migration plan was altered after review.");
    plan = refreshed;
    if (!plan.operations.length) return { changed: false };
    if (plan.regenerate) assertRegenerationLifecycleClosure(plan);
    const { paths, lifecycleCapability } = beginFrameworkUpgrade(plan, lifecycle);
    let releaseDestination;
    try {
      if (!plan.regenerate)
        releaseDestination = await holdDestinationUpgradeRuntime(plan, lifecycle);
      lifecycle.assertRuntimeLifecycleQuiescent({
        root: plan.targetRoot,
        owner: lifecycleCapability,
      });
      if (buildFrameworkUpgradePlan(plan).digest !== plan.digest)
        throw new Error("Migration inputs changed while acquiring ownership.");
      for (const operation of plan.operations) {
        const actual = targetUpgradeFileState(plan.targetRoot, operation.path);
        if (
          actual.sha256 !== operation.expected ||
          (operation.expectedMode !== undefined && actual.mode !== operation.expectedMode)
        )
          throw new Error(`Migration target changed: ${operation.path}.`);
        if (operation.action === "delete")
          removeOwnedRegularFile(
            plan.targetRoot,
            path.join(plan.targetRoot, operation.path),
            "retired project tool",
          );
        else
          atomicWriteUpgradeFile(
            plan.targetRoot,
            operation.path,
            operation.content,
            operation.mode,
          );
        afterWrite?.(operation);
      }
      const directories = new Set(
        plan.operations
          .filter((op) => op.action === "delete")
          .flatMap((op) => {
            const parts = op.path.split("/");
            parts.pop();
            const result = [];
            while (parts.length) {
              result.push(parts.join("/"));
              parts.pop();
            }
            return result;
          }),
      );
      for (const directory of [...directories].sort((a, b) => b.length - a.length))
        removeOwnedEmptyDirectory(
          plan.targetRoot,
          path.join(plan.targetRoot, directory),
          "retired tool directory",
        );
      removeFrameworkUpgradeState(paths, lifecycleCapability, lifecycle);
    } catch (error) {
      try {
        restoreFrameworkUpgradeJournal(
          plan.targetRoot,
          readFrameworkUpgradeJournal(plan.targetRoot, plan.digest),
        );
        removeFrameworkUpgradeState(paths, lifecycleCapability, lifecycle);
      } catch (recoveryError) {
        lifecycle.releaseRuntimeLifecycleLock({
          root: plan.targetRoot,
          owner: lifecycleCapability,
        });
        throw new AggregateError(
          [error, recoveryError],
          "Migration recovery needs explicit attention; preserved its journal.",
        );
      }
      throw error;
    } finally {
      releaseDestination?.();
    }
    return { changed: true };
  } finally {
    staged?.cleanup();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2).filter((arg) => arg !== "--");
    const options = {};
    let apply = false,
      recover = false,
      confirmQuiescent = false;
    for (let index = 0; index < args.length; index++) {
      if (args[index] === "--apply") apply = true;
      else if (args[index] === "--recover") recover = true;
      else if (args[index] === "--regenerate") options.regenerate = true;
      else if (args[index] === "--confirm-quiescent") confirmQuiescent = true;
      else if (
        args[index] === "--project-path" &&
        args[index + 1] &&
        !args[index + 1].startsWith("--")
      )
        (options.projectPaths ??= []).push(args[++index]);
      else if (
        ["--target", "--baseline", "--reconcile"].includes(args[index]) &&
        args[index + 1] &&
        !args[index + 1].startsWith("--")
      )
        options[
          {
            "--target": "targetRoot",
            "--baseline": "baselineRoot",
            "--reconcile": "reconcileFile",
          }[args[index]]
        ] = args[++index];
      else
        throw new Error(
          "Usage: pnpm framework:upgrade -- --target <project> [--reconcile <decisions.json> | --baseline <pristine-generated-tree>] [--project-path <public-owner>] [--regenerate --confirm-quiescent] [--apply]; or --target <project> [--regenerate --confirm-quiescent] --recover",
        );
    }
    if (!options.targetRoot) throw new Error("An explicit target is required.");
    if (recover) {
      if (apply || options.baselineRoot || options.reconcileFile || options.projectPaths)
        throw new Error("Recovery accepts only target and explicit regeneration admission.");
      await recoverInterruptedFrameworkUpgrade(realUpgradeDirectory(options.targetRoot, "target"), {
        regenerate: options.regenerate,
        confirmQuiescent,
      });
    } else {
      if (options.reconcileFile) {
        if (options.baselineRoot)
          throw new Error("Reconciliation uses current-output comparison, without a baseline.");
        options.resolutions = JSON.parse(readFileSync(options.reconcileFile, "utf8"));
        delete options.reconcileFile;
      }
      const plan = buildFrameworkUpgradePlan(options);
      console.log(
        JSON.stringify(
          {
            digest: plan.digest,
            conflicts: plan.conflicts,
            differences: plan.differences,
            documentBindings: plan.documentBindings,
            deviations: plan.deviations,
            operations: plan.operations.map(({ path, action }) => ({ path, action })),
          },
          null,
          2,
        ),
      );
      if (apply) await applyFrameworkUpgrade(plan, { confirmQuiescent });
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
