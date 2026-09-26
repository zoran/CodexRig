/** Owns current-output drift review when no pristine generated ancestor is available. */
import path from "node:path";
import {
  readRepositoryFile,
  serializeCanonicalJson,
  sha256,
} from "../filesystem/repository-files.mjs";
import { readFrameworkContract } from "../contracts/framework-contract.mjs";
import { listRepositoryPathInventory } from "../repository/source-inventory.mjs";
import { nonPortableTransferPathReason } from "../repository/source-inventory-policy.mjs";
import { readProjectToolSelection, selectedProjectPackage } from "./project-tool-selection.mjs";
import {
  initialProjectAgents,
  currentProjectInstructions,
} from "./generated-project-documents.mjs";
import { projectOutputText } from "./project-output-projection.mjs";
import {
  isProjectToolPath,
  reviewedProjectDocuments,
  realUpgradeDirectory,
  targetUpgradeFileState,
  isReviewedProjectPath,
} from "./framework-upgrade-io.mjs";

const absent = { exists: false, mode: null, sha256: null };
const state = (content, mode = 0o644) => ({ content, exists: true, mode, sha256: sha256(content) });
const same = (a, b) => a.sha256 === b.sha256 && a.mode === b.mode;

/** Every divergent existing file needs a reasoned, hash-and-mode-bound decision, including policy. */
export function buildReviewedFrameworkUpgradePlan(
  { sourceRoot, targetRoot, resolutions = [], projectPaths = [] },
  desiredTool,
) {
  const source = realUpgradeDirectory(sourceRoot, "source");
  const target = realUpgradeDirectory(targetRoot, "target");
  if (
    source === target ||
    source.startsWith(target + path.sep) ||
    target.startsWith(source + path.sep)
  )
    throw new Error("Migration roots must be disjoint.");
  readFrameworkContract(source);
  const selection = readProjectToolSelection(source);
  const selected = new Set(selection.files.filter(isProjectToolPath));
  if (
    !Array.isArray(projectPaths) ||
    projectPaths.length > 64 ||
    new Set(projectPaths).size !== projectPaths.length ||
    projectPaths.some((file) => !isReviewedProjectPath(file))
  )
    throw new Error(
      "Additional migration owners require unique exact public document/config/tool paths.",
    );
  const files = new Set([
    ...selected,
    ...listRepositoryPathInventory({ root: target, includeUntracked: true }).paths.filter(
      (file) => isProjectToolPath(file) && !nonPortableTransferPathReason(file),
    ),
    ...reviewedProjectDocuments,
    ...projectPaths,
    "package.json",
  ]);
  if (!Array.isArray(resolutions))
    throw new Error("Reconciliation must be an array of reviewed decisions.");
  const decisions = new Map();
  for (const entry of resolutions) {
    if (
      !entry ||
      !files.has(entry.path) ||
      decisions.has(entry.path) ||
      !["source", "keep", "replace", "remove"].includes(entry.action) ||
      typeof entry.reason !== "string" ||
      !entry.reason.trim()
    )
      throw new Error("Invalid, duplicate or out-of-scope reconciliation decision.");
    const keys = [
      "path",
      "action",
      "reason",
      "currentHash",
      "currentMode",
      "desiredHash",
      "desiredMode",
      ...(entry.action === "replace" ? ["content", "mode"] : []),
    ].sort();
    if (
      Object.keys(entry).sort().join() !== keys.join() ||
      (entry.action === "replace" &&
        (typeof entry.content !== "string" ||
          !Number.isInteger(entry.mode) ||
          entry.mode < 0 ||
          entry.mode > 0o777))
    )
      throw new Error("Invalid reconciliation content or fields.");
    decisions.set(entry.path, entry);
  }
  const packageContent = readRepositoryFile(target, "package.json");
  const currentPackage = JSON.parse(packageContent);
  const portablePackage = selectedProjectPackage(
    JSON.parse(readRepositoryFile(source, "package.json")),
    selection,
  );
  // Product identity, runtime dependencies and unrelated scripts stay project-owned. Retired commands
  // require an explicit replacement decision; an unknown old private schema is never interpreted.
  const packageCandidate = {
    ...currentPackage,
    packageManager: portablePackage.packageManager,
    scripts: { ...currentPackage.scripts, ...portablePackage.scripts },
    devDependencies: { ...currentPackage.devDependencies, ...portablePackage.devDependencies },
  };
  const operations = [],
    conflicts = [],
    differences = [],
    deviations = [],
    snapshots = [];
  for (const file of [...files].sort()) {
    const current = targetUpgradeFileState(target, file);
    const desired =
      file === "AGENTS.md"
        ? state(projectOutputText(initialProjectAgents(currentPackage.name || "this project")))
        : file === "instructions.md"
          ? state(currentProjectInstructions(source))
          : file === "package.json"
            ? state(JSON.stringify(packageCandidate, null, 2) + "\n", current.mode)
            : reviewedProjectDocuments.includes(file) || projectPaths.includes(file)
              ? current
              : selected.has(file)
                ? desiredTool(source, file, selection)
                : absent;
    snapshots.push({ file, current, desired });
    const decision = decisions.get(file);
    if (
      decision &&
      (decision.currentHash !== current.sha256 ||
        decision.currentMode !== current.mode ||
        decision.desiredHash !== desired.sha256 ||
        decision.desiredMode !== desired.mode)
    )
      throw new Error(`Stale reconciliation decision: ${file}.`);
    if (same(current, desired) && !decision) continue;
    differences.push({
      path: file,
      currentHash: current.sha256,
      currentMode: current.mode,
      desiredHash: desired.sha256,
      desiredMode: desired.mode,
      kind: !desired.exists ? "target-only" : !current.exists ? "missing" : "divergent",
    });
    let next = desired;
    if (decision?.action === "keep") next = current;
    else if (decision?.action === "replace") next = state(decision.content, decision.mode);
    else if (decision?.action === "remove") next = absent;
    else if (!decision && current.exists) {
      conflicts.push(file);
      continue;
    }
    if (decision && !same(next, desired))
      deviations.push({ path: file, action: decision.action, reason: decision.reason });
    if (same(current, next)) continue;
    operations.push(
      next.exists
        ? {
            path: file,
            action: "write",
            content: next.content,
            mode: next.mode,
            expected: current.sha256,
            expectedMode: current.mode,
          }
        : { path: file, action: "delete", expected: current.sha256, expectedMode: current.mode },
    );
  }
  const digest = sha256(
    serializeCanonicalJson({
      source,
      target,
      snapshots,
      operations,
      conflicts,
      resolutions,
      projectPaths,
    }),
  );
  return {
    sourceRoot: source,
    targetRoot: target,
    resolutions,
    projectPaths,
    operations,
    conflicts,
    differences,
    deviations,
    digest,
    documentBindings: snapshots
      .filter(
        (item) => reviewedProjectDocuments.includes(item.file) || projectPaths.includes(item.file),
      )
      .map(({ file, current, desired }) => ({
        path: file,
        currentHash: current.sha256,
        currentMode: current.mode,
        desiredHash: desired.sha256,
        desiredMode: desired.mode,
      })),
  };
}
