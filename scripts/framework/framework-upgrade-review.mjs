/** Owns framework upgrade review, template projection and hash-bound project reconciliation. */
import { existsSync } from "node:fs";
import path from "node:path";
import {
  readRepositoryFile,
  serializeCanonicalJson,
  sha256,
} from "../filesystem/repository-files.mjs";
import { readFrameworkContract } from "../contracts/framework-contract.mjs";
import { initialRequirementsPath } from "../docs/project-document-policy.mjs";
import { validateToolingConfiguration } from "../contracts/tooling-configuration.mjs";
import { validateVerificationConfiguration } from "../verify/verification-configuration.mjs";
import {
  listPortableTransferFiles,
  listRepositoryPathInventory,
} from "../repository/source-inventory.mjs";
import { nonPortableTransferPathReason } from "../repository/source-inventory-policy.mjs";
import { readProjectToolSelection, selectedProjectPackage } from "./project-tool-selection.mjs";
import { renderGeneratedProjectDocuments } from "./generated-project-documents.mjs";
import { projectOutputText } from "./project-output-projection.mjs";
import { isUpgradeDecision } from "./framework-upgrade-documents.mjs";
import { formatProjectedDocuments } from "./generated-project-finalization.mjs";
import {
  absentUpgradeFile,
  compareUpgradeFile,
  sameUpgradeFile,
  upgradeFileContent,
} from "./framework-upgrade-merge.mjs";
import {
  isProjectToolPath,
  reviewedProjectDocuments,
  realUpgradeDirectory,
  targetUpgradeFileState,
  isReviewedProjectPath,
} from "./framework-upgrade-io.mjs";

const policies = new Set(["AGENTS.md", "instructions.md"]);

function projectedDocuments(source, baseline) {
  // Retain the original generated label, including its Markdown escaping. Renames then remain
  // ordinary local edits instead of accidental framework changes in the README and manifest.
  const label = baseline
    ? readRepositoryFile(baseline, "README.md").match(/^# ([^\r\n]+)/u)?.[1]
    : "";
  const documents = renderGeneratedProjectDocuments(
    source,
    label ?? "",
    Boolean(baseline && existsSync(path.join(baseline, initialRequirementsPath))),
  );
  const projected = Object.fromEntries(
    Object.entries(documents)
      .filter(([file]) => baseline || policies.has(file))
      .map(([file, value]) => [file, projectOutputText(value)]),
  );
  return new Map(
    Object.entries(formatProjectedDocuments(source, projected)).map(([file, value]) => [
      file,
      upgradeFileContent(value),
    ]),
  );
}

function stateBinding(state) {
  return { hash: state.sha256, mode: state.mode };
}

export function buildReviewedFrameworkUpgradePlan(
  { sourceRoot, targetRoot, baselineRoot, resolutions = [], projectPaths = [] },
  desiredTool,
) {
  const source = realUpgradeDirectory(sourceRoot, "source");
  const target = realUpgradeDirectory(targetRoot, "target");
  const baseline = baselineRoot
    ? realUpgradeDirectory(baselineRoot, "pristine generated reference")
    : undefined;
  const roots = [source, target, ...(baseline ? [baseline] : [])];
  if (
    roots.some((left, i) =>
      roots.some((right, j) => i !== j && (left === right || right.startsWith(left + path.sep))),
    )
  )
    throw new Error("Migration roots must be disjoint.");
  readFrameworkContract(source);
  const selection = readProjectToolSelection(source);
  const selected = new Set(selection.files.filter(isProjectToolPath));
  const baselineTools = baseline
    ? listPortableTransferFiles({ root: baseline, includeUntracked: true }).filter(
        isProjectToolPath,
      )
    : [];
  if (
    !Array.isArray(projectPaths) ||
    projectPaths.length > 64 ||
    new Set(projectPaths).size !== projectPaths.length ||
    projectPaths.some((file) => !isReviewedProjectPath(file))
  )
    throw new Error(
      "Additional migration owners require unique exact public document/config/tool paths.",
    );
  const documents = projectedDocuments(source, baseline);
  const files = new Set([
    ...selected,
    ...baselineTools,
    ...documents.keys(),
    ...reviewedProjectDocuments,
    ...projectPaths,
    "package.json",
    ...listRepositoryPathInventory({ root: target, includeUntracked: true }).paths.filter(
      (file) => isProjectToolPath(file) && !nonPortableTransferPathReason(file),
    ),
  ]);
  if (!Array.isArray(resolutions))
    throw new Error("Reconciliation must be an array of reviewed decisions.");
  const decisions = new Map();
  for (const entry of resolutions) {
    if (!isUpgradeDecision(entry) || !files.has(entry.path) || decisions.has(entry.path))
      throw new Error("Invalid, duplicate or out-of-scope reconciliation decision.");
    decisions.set(entry.path, entry);
  }
  const portablePackage = selectedProjectPackage(
    JSON.parse(readRepositoryFile(source, "package.json")),
    selection,
  );
  const operations = [],
    conflicts = [],
    differences = [],
    deviations = [],
    snapshots = [],
    documentBindings = [];
  const conflictDetails = Object.create(null);
  for (const file of [...files].sort()) {
    const before = baseline ? targetUpgradeFileState(baseline, file) : undefined;
    const productDocument = reviewedProjectDocuments.includes(file) || projectPaths.includes(file);
    const targetOnly =
      !selected.has(file) &&
      !documents.has(file) &&
      !productDocument &&
      file !== "package.json" &&
      !before?.exists;
    const decision = decisions.get(file);
    const current = targetUpgradeFileState(target, file, {
      preserveOpaque: targetOnly && !decision,
    });
    if (!current) continue;
    let desired = absentUpgradeFile;
    if (documents.has(file)) desired = documents.get(file);
    else if (file === "package.json") {
      if (!current.exists || (baseline && !before.exists))
        throw new Error(
          "Migration requires the generated reference and project package manifests.",
        );
      desired = upgradeFileContent(serializeCanonicalJson(portablePackage), current.mode);
    } else if (selected.has(file)) desired = desiredTool(source, file, selection);
    else if (productDocument) desired = current;
    const proposal = compareUpgradeFile({ sourceRoot: source, file, before, current, desired });
    // The reviewed proposal already contains independently merged product fields and text hunks.
    const reviewed =
      (before || ["package.json", ".codex/verification.json"].includes(file)) &&
      current.exists &&
      desired.exists
        ? proposal.next
        : desired;
    const binding = {
      path: file,
      currentHash: current.sha256,
      currentMode: current.mode,
      desiredHash: reviewed.sha256,
      desiredMode: reviewed.mode,
      ...(before ? { baseHash: before.sha256, baseMode: before.mode } : {}),
    };
    snapshots.push([
      file,
      stateBinding(current),
      stateBinding(desired),
      before && stateBinding(before),
    ]);
    if (productDocument || documents.has(file)) documentBindings.push(binding);
    if (
      decision &&
      (Object.entries(binding).some(([key, value]) => decision[key] !== value) ||
        Boolean(before) !== Object.hasOwn(decision, "baseHash"))
    )
      throw new Error(`Stale reconciliation decision: ${file}.`);
    if (sameUpgradeFile(current, reviewed) && !proposal.conflicts.length && !decision) continue;
    differences.push({
      ...binding,
      kind: !desired.exists ? "target-only" : !current.exists ? "missing" : "divergent",
    });
    let next = proposal.next;
    if (decision?.action === "keep") next = current;
    else if (decision?.action === "replace")
      next = upgradeFileContent(decision.content, decision.mode);
    else if (decision?.action === "remove") next = absentUpgradeFile;
    else if (decision?.action === "source") next = reviewed;
    else if (proposal.conflicts.length) {
      conflicts.push(file);
      if (proposal.conflicts.some((key) => key !== "/")) conflictDetails[file] = proposal.conflicts;
      continue;
    }
    if (decision && !sameUpgradeFile(next, reviewed))
      deviations.push({ path: file, action: decision.action, reason: decision.reason });
    if (sameUpgradeFile(current, next)) continue;
    const validate =
      file === ".codex/tooling.json"
        ? validateToolingConfiguration
        : file === ".codex/verification.json"
          ? validateVerificationConfiguration
          : undefined;
    if (validate && next.exists) {
      try {
        validate(JSON.parse(next.content));
      } catch (error) {
        conflicts.push(file);
        conflictDetails[file] = [error.message];
        continue;
      }
    }
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
      baseline,
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
    ...(baseline ? { baselineRoot: baseline } : {}),
    resolutions,
    projectPaths,
    operations,
    conflicts,
    differences,
    deviations,
    digest,
    documentBindings,
    ...(Object.keys(conflictDetails).length ? { conflictDetails } : {}),
  };
}
