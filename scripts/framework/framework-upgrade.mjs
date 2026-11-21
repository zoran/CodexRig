#!/usr/bin/env node
/** Owns explicit framework upgrade planning, conflict detection and atomic project-tool migration. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  toolingRoot,
  readRepositoryFile,
  serializeCanonicalJson,
  sha256,
} from "../filesystem/repository-files.mjs";
import { validateToolingConfiguration } from "../contracts/tooling-configuration.mjs";
import { selectedProjectVerification } from "./project-tool-selection.mjs";
import { projectToolingConfiguration } from "./generated-project-tooling.mjs";
import { projectOutputText } from "./project-output-projection.mjs";
import { frameworkUpgradePreview } from "./framework-upgrade-documents.mjs";
import {
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
  regenerationRuntimeHash,
  stageRegenerationRuntime,
} from "./framework-upgrade-runtime.mjs";
import { buildReviewedFrameworkUpgradePlan } from "./framework-upgrade-review.mjs";
import { applyWithPostUpdateReset } from "./framework-reset.mjs";
import {
  removeOwnedRegularFile,
  removeOwnedEmptyDirectory,
} from "../filesystem/owned-file-operations.mjs";

export function desiredProjectToolFile(source, file, selection, displayName) {
  let content = readRepositoryFile(source, file);
  if (file === ".codex/config.toml") {
    if ((content.match(/^memories = false$/gmu)?.length ?? 0) !== 1)
      throw new Error("Source memory configuration is not the current template.");
    content = content.replace(/^memories = false$/mu, "memories = true");
  } else if (file === ".codex/verification.json") {
    content =
      JSON.stringify(selectedProjectVerification(JSON.parse(content), selection), null, 2) + "\n";
  }
  content = projectOutputText(content);
  // The launcher label is target-owned and must not pass through source-brand projection.
  if (file === ".codex/tooling.json") content = projectToolingConfiguration(content, displayName);
  return {
    exists: true,
    content,
    sha256: sha256(content),
    // Match copyStableRepositoryFile's shebang-based portable output, not host-local permissions.
    mode: content.startsWith("#!") ? 0o755 : 0o644,
  };
}
/** One planner owns both the current-output and pristine-ancestor comparison. */
export function buildFrameworkUpgradePlan(options) {
  const { sourceRoot = toolingRoot, targetRoot } = options;
  if (options.baselineRoot && options.regenerate)
    throw new Error("Regeneration requires current-output review.");
  const target = realUpgradeDirectory(targetRoot, "target");
  const targetTooling = targetUpgradeFileState(target, ".codex/tooling.json");
  let displayName;
  if (targetTooling.exists) {
    // Validate the existing project identity independently of retired provider build settings.
    const configuration = JSON.parse(targetTooling.content);
    if (configuration.platform) delete configuration.platform.ci;
    if (configuration.platform?.protection)
      delete configuration.platform.protection.mergeSerialization;
    displayName = validateToolingConfiguration(configuration).startup.displayName;
  }
  const plan = buildReviewedFrameworkUpgradePlan(
    { ...options, sourceRoot },
    (source, file, selection) => desiredProjectToolFile(source, file, selection, displayName),
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
    const { paths, lifecycleCapability, destination } = await beginFrameworkUpgrade(
      plan,
      lifecycle,
    );
    try {
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
      destination?.release();
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
          "Usage: pnpm framework:upgrade -- --target <project> [--baseline <pristine-generated-tree>] [--reconcile <decisions.json>] [--project-path <public-owner>] [--regenerate --confirm-quiescent] [--apply]; or --target <project> [--regenerate --confirm-quiescent] --recover",
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
        options.resolutions = JSON.parse(readFileSync(options.reconcileFile, "utf8"));
        delete options.reconcileFile;
      }
      const plan = buildFrameworkUpgradePlan(options);
      console.log(JSON.stringify(frameworkUpgradePreview(plan), null, 2));
      if (apply) {
        const reset = await applyWithPostUpdateReset(plan.sourceRoot, () =>
          applyFrameworkUpgrade(plan, { confirmQuiescent }),
        );
        if (reset !== "none")
          console.error(
            reset === "complete"
              ? "Framework post-update session reset complete."
              : "Framework post-update session reset scheduled for session exit.",
          );
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
