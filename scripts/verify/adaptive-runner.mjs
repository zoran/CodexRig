/** Owns adaptive runner behavior for the repository verification boundary. */
import { readVerificationConfiguration } from "./verification-configuration.mjs";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { discoverProductLayout } from "../repository/product-roots.mjs";
import { listActiveFiles } from "../repository/source-inventory.mjs";
import { changedPathsFromGit, classifyPath, insideGitWorktree, root } from "./adaptive-state.mjs";
import {
  buildFocusedVerification,
  decideVerificationAdmission,
  isForbiddenFocusedOwner,
} from "./verification-admission.mjs";
import { dedupeCommands } from "./verification-admission-commands.mjs";
import {
  discoverWorkspaceManifests,
  selectChangedWorkspaceManifests,
  workspaceLifecycleCommands,
} from "./workspace-verification.mjs";

export { printPlan, runPlan } from "./verification-executor.mjs";
export { discoverWorkspaceManifests, workspaceLifecycleCommands };
export function verificationCommand({
  key,
  label,
  executable,
  args = [],
  artifactOwners = [],
  coveredTestPaths = [],
  reason,
  phase = "preflight",
}) {
  return {
    key,
    label,
    executable,
    args,
    artifactOwners,
    coveredTestPaths,
    reason,
    phase,
  };
}
export function completeVerificationCommands() {
  return readVerificationConfiguration(root).commands;
}

export function buildPlan(options, dependencies = {}) {
  const gitAvailable = dependencies.gitAvailable ?? insideGitWorktree();
  const injectedPaths = dependencies.changedPaths !== undefined;
  const changed = dependencies.changedScope
    ? dependencies.changedScope
    : injectedPaths
      ? { paths: dependencies.changedPaths, incomplete: false, reason: "injected fixture paths" }
      : options.simulatedPaths.length > 0
        ? { paths: options.simulatedPaths, incomplete: false, reason: "simulated --path input" }
        : options.mode === "pre-push"
          ? {
              paths: [],
              incomplete: false,
              reason: "pre-push mode does not execute verification commands",
            }
          : gitAvailable
            ? changedPathsFromGit()
            : { paths: [], incomplete: true, reason: "no Git worktree detected" };
  const productLayout =
    dependencies.productLayout ??
    discoverProductLayout({ repositoryRoot: root, relativePaths: listActiveFiles({ root }) });
  const classificationOptions = { productLayout };
  const classifiedPaths = changed.paths.map((filePath) => ({
    path: filePath,
    categories: classifyPath(filePath, classificationOptions),
  }));
  const basis =
    dependencies.basis ??
    (injectedPaths || options.simulatedPaths.length > 0
      ? { reason: "injected route fixture", trusted: true }
      : { reason: "successful verification evidence is unavailable", trusted: false });
  const deliveryCommands = dependencies.deliveryBinding?.verificationCommand
    ? [dependencies.deliveryBinding.verificationCommand]
    : [];
  const completeCommands = [...completeVerificationCommands(), ...deliveryCommands];
  // Admission can become full for an unknown path or incomplete Git basis. Discover all real
  // workspace lifecycles before that decision, so conservative admission cannot omit product tests.
  const needsWorkspace = options.mode !== "pre-push";
  const workspaceManifests =
    dependencies.workspaceManifests ?? (needsWorkspace ? discoverWorkspaceManifests() : []);
  const focused = buildFocusedVerification({
    classifiedPaths,
    completeCommands,
    repositoryRoot: dependencies.repositoryRoot ?? root,
    verifyOnlyRootManifest: dependencies.verifyOnlyRootManifest === true,
    workspaceManifests,
  });
  if ([...focused.readOnlyCommands, ...focused.workspaceCommands].some(isForbiddenFocusedOwner)) {
    throw new Error("Focused verification routing selected a recursive broad entry point.");
  }
  const admission =
    options.mode === "pre-push"
      ? {
          canAdvanceSuccessfulBasis: false,
          focusedCommandOwners: [],
          fullRelevantPaths: [],
          mode: "targeted",
          reason: "pre-push validates exact-current successful verification evidence",
          uncoveredFullRelevantPaths: [],
          unknownPaths: [],
          unknownReasons: [],
        }
      : decideVerificationAdmission({
          basis,
          broadOnlyRisks: dependencies.broadOnlyRisks ?? [],
          changed,
          coveredBroadRisks: dependencies.coveredBroadRisks ?? [],
          forceFull: options.forceFull === true,
          forceReason: options.forceReason ?? "",
          ownersByPath: focused.ownersByPath,
          productLayout,
        });
  const readOnlyCommands =
    options.mode === "pre-push"
      ? []
      : admission.mode === "full"
        ? completeCommands
        : [...focused.readOnlyCommands, ...deliveryCommands];
  const workspaceCommands =
    options.mode === "pre-push"
      ? []
      : admission.mode === "full"
        ? workspaceLifecycleCommands(workspaceManifests)
        : focused.workspaceCommands;

  return {
    admission,
    options,
    deliveryBinding: dependencies.deliveryBinding ?? null,
    gitAvailable,
    changed,
    classifiedPaths,
    conservativePaths: admission.fullRelevantPaths,
    verificationScope:
      options.mode === "pre-push"
        ? "evidence validation"
        : admission.mode === "full"
          ? "full"
          : "targeted",
    reason: admission.reason,
    readOnlyCommands: dedupeCommands(readOnlyCommands),
    workspaceCommands: dedupeCommands(workspaceCommands),
  };
}
