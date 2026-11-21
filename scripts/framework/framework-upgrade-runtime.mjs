/** Owns destination runtime exclusion during an atomic framework upgrade namespace cutover. */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isBuiltin } from "node:module";
import { pathToFileURL } from "node:url";
import {
  readRepositoryFile,
  serializeCanonicalJson,
  sha256,
} from "../filesystem/repository-files.mjs";
import { removeOwnedArtifact } from "../filesystem/owned-file-operations.mjs";
import { readProjectToolSelection } from "./project-tool-selection.mjs";
import { projectOutputText } from "./project-output-projection.mjs";
import { importSpecifiersForFile } from "../repository/source-import-specifiers.mjs";
import { targetUpgradeFileState } from "./framework-upgrade-io.mjs";
import { inspectRepositoryWorktrees } from "../repository/worktree-recovery.mjs";

/** Read the target runtime's own lease namespace, including its linked worktrees. */
export function assertUpgradeTargetIdle(root, runtime) {
  const inventory = inspectRepositoryWorktrees({ root });
  if (!inventory.complete || typeof runtime.inspectRuntimeSessionLease !== "function")
    throw new Error("Framework upgrade cannot establish target session ownership.");
  for (const worktree of inventory.worktrees) {
    if (
      !worktree.available ||
      !["absent", "stale"].includes(worktree.session.status) ||
      !["absent", "stale"].includes(
        runtime.inspectRuntimeSessionLease({ root: worktree.path }).status,
      )
    )
      throw new Error(
        "Framework upgrade requires inactive Codex sessions in every target worktree.",
      );
  }
}

function currentRuntimeSources(sourceRoot) {
  return readProjectToolSelection(sourceRoot)
    .files.filter((file) => file.endsWith(".mjs"))
    .sort()
    .map((file) => [file, projectOutputText(readRepositoryFile(sourceRoot, file))]);
}

/** Bind recovery to the same projected source fingerprint recorded in existing journals. */
export function regenerationRuntimeHash(sourceRoot) {
  return sha256(serializeCanonicalJson(currentRuntimeSources(sourceRoot)));
}

/** Recovery must understand the exact lifecycle contract installed by regeneration. */
export function assertRegenerationLifecycleClosure(plan) {
  const sources = projectedLifecycleSources(currentRuntimeSources(plan.sourceRoot));
  const operations = new Map(plan.operations.map((operation) => [operation.path, operation]));
  for (const [file, expected] of sources) {
    const operation = operations.get(file);
    const actual = operation
      ? operation.action === "write"
        ? operation.content
        : undefined
      : targetUpgradeFileState(plan.targetRoot, file).content;
    if (actual !== expected)
      throw new Error(`Regeneration requires the current lifecycle contract: ${file}.`);
  }
}

function lifecycleSources(readSource) {
  const sources = new Map();
  const pending = ["scripts/repository/runtime-session-lease.mjs"];
  while (pending.length) {
    const file = pending.pop();
    if (sources.has(file)) continue;
    const content = readSource(file);
    sources.set(file, content);
    for (const specifier of importSpecifiersForFile({ relativePath: file, content })) {
      if (isBuiltin(specifier)) continue;
      if (!specifier.startsWith("."))
        throw new Error(
          `Destination lifecycle requires a local reviewed dependency: ${specifier}.`,
        );
      pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)));
    }
  }
  return sources;
}

function projectedLifecycleSources(allSources) {
  const selected = new Map(allSources);
  return lifecycleSources((file) => {
    if (!selected.has(file))
      throw new Error(`Regeneration lifecycle dependency is not selected: ${file}.`);
    return selected.get(file);
  });
}

/** Never imports a missing, superseded or partially installed target runtime. */
export async function stageRegenerationRuntime(sourceRoot, expectedHash) {
  const sources = currentRuntimeSources(sourceRoot);
  if (sha256(serializeCanonicalJson(sources)) !== expectedHash)
    throw new Error("Regeneration recovery requires the exact admitted source runtime closure.");
  const temporary = mkdtempSync(path.join(os.tmpdir(), "framework-regeneration-runtime-"));
  const cleanup = () =>
    removeOwnedArtifact(
      path.dirname(temporary),
      temporary,
      "directory",
      "owned regeneration runtime stage",
    );
  try {
    for (const [file, content] of projectedLifecycleSources(sources)) {
      const destination = path.join(temporary, file);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, content);
    }
    const lifecycle = await import(
      pathToFileURL(path.join(temporary, "scripts/repository/runtime-session-lease.mjs")).href
    );
    return { lifecycle, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** Ordinary updates admit child runtime extensions only through explicit file reconciliation. */
function destinationRuntimeSources(plan) {
  const admitted = new Set(readProjectToolSelection(plan.sourceRoot).files);
  for (const decision of plan.resolutions ?? [])
    if (["keep", "replace"].includes(decision.action)) admitted.add(decision.path);
  const operations = new Map(plan.operations.map((operation) => [operation.path, operation]));
  return lifecycleSources((file) => {
    if (!admitted.has(file) || !file.endsWith(".mjs"))
      throw new Error(`Destination lifecycle dependency requires explicit tool review: ${file}.`);
    const operation = operations.get(file);
    const content = operation
      ? operation.action === "write"
        ? operation.content
        : undefined
      : targetUpgradeFileState(plan.targetRoot, file).content;
    if (content === undefined)
      throw new Error(`Destination lifecycle dependency is absent or retired: ${file}.`);
    return content;
  });
}

/** Both installed and destination owners exclude writers until the journal and files settle. */
export async function holdDestinationUpgradeRuntime(plan, installed) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "framework-upgrade-runtime-"));
  const cleanup = () =>
    removeOwnedArtifact(
      path.dirname(temporary),
      temporary,
      "directory",
      "owned migration runtime stage",
    );
  let lifecycle, owner;
  try {
    // Traverse the reconciled lifecycle only, including reviewed child extensions. Never stage
    // unrelated product code or interpret an old private schema. Both locks bind the actual target.
    for (const [file, content] of destinationRuntimeSources(plan)) {
      const destination = path.join(temporary, file);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, content);
    }
    lifecycle = await import(
      pathToFileURL(path.join(temporary, "scripts/repository/runtime-session-lease.mjs")).href
    );
    if (lifecycle.runtimeLifecycleLockName !== installed.runtimeLifecycleLockName) {
      owner = lifecycle.acquireRuntimeLifecycleLock({
        root: plan.targetRoot,
        operation: "framework-upgrade",
      });
      lifecycle.assertRuntimeLifecycleQuiescent({ root: plan.targetRoot, owner });
    }
    return {
      lifecycle,
      release() {
        try {
          if (owner) lifecycle.releaseRuntimeLifecycleLock({ root: plan.targetRoot, owner });
        } finally {
          cleanup();
        }
      },
    };
  } catch (error) {
    try {
      if (owner) lifecycle.releaseRuntimeLifecycleLock({ root: plan.targetRoot, owner });
    } finally {
      cleanup();
    }
    throw error;
  }
}
