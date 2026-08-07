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
import {
  discoverWorkspaceManifests,
  parsePnpmWorkspaceProjects,
  selectChangedWorkspaceManifests,
  workspaceLifecycleCommands,
} from "./workspace-verification.mjs";

export { printPlan, runPlan } from "./verification-executor.mjs";
export { discoverWorkspaceManifests, parsePnpmWorkspaceProjects, workspaceLifecycleCommands };
const broadRegressionCommandKeys = new Set([
  "context-regressions",
  "dependency-regressions",
  "framework-regressions",
  "setup-regressions",
  "verification-boundary-regressions",
]);
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
function commandSignature(command) {
  return JSON.stringify([
    command.executable,
    command.args,
    command.phase,
    command.artifactOwners ?? [],
    command.coveredTestPaths ?? [],
  ]);
}
export function dedupeCommands(commands) {
  const deduped = new Map();
  for (const command of commands) {
    const existing = deduped.get(command.key);
    if (!existing) {
      deduped.set(command.key, command);
      continue;
    }
    if (commandSignature(existing) !== commandSignature(command)) {
      throw new Error(`Verification command key ${command.key} has conflicting definitions.`);
    }
  }
  return [...deduped.values()];
}
function nodeCommand(key, label, script, reason, args = [], phase = "preflight") {
  return verificationCommand({
    key,
    label,
    executable: process.execPath,
    args: [script, ...args],
    reason,
    phase,
  });
}
function bashCommand(key, label, script, reason, args = []) {
  return verificationCommand({ key, label, executable: "bash", args: [script, ...args], reason });
}

function existingTestFiles(relativePaths) {
  return relativePaths.filter((relativePath) => existsSync(path.join(root, relativePath)));
}

export function completeVerificationCommands() {
  const commands = [
    bashCommand(
      "syntax-lint",
      "repository syntax and lint",
      "scripts/verify/lint.sh",
      "complete verification always checks repository-owned shell, JavaScript, and JSON syntax",
    ),
    nodeCommand(
      "docs",
      "documentation",
      "scripts/verify/docs.mjs",
      "complete verification always checks documentation structure, map, and links",
    ),
    bashCommand(
      "scripts",
      "script inventory",
      "scripts/verify/scripts.sh",
      "complete verification always checks script inventory and executable entry points",
    ),
    nodeCommand(
      "repository-smoke",
      "repository baseline",
      "scripts/verify/repository-smoke.mjs",
      "complete verification always checks the repository's minimum operational shape",
    ),
    nodeCommand(
      "skills",
      "skill boundaries",
      "scripts/verify/skill-paths.mjs",
      "complete verification always checks repository-owned skill boundaries and metadata",
    ),
    nodeCommand(
      "codex-config",
      "project Codex config",
      "scripts/setup/validate-codex-config.mjs",
      "complete verification always validates the tracked project policy layer",
    ),
    nodeCommand(
      "dependencies",
      "dependency policy and lockfile",
      "scripts/verify/dependencies.mjs",
      "complete verification always checks deterministic dependency policy and offline lockfile consistency",
    ),
    nodeCommand(
      "package-manifests",
      "whole package manifests",
      "scripts/verify/package-manifest.mjs",
      "complete verification checks package identity, scripts, dependencies, and every export registry entry",
    ),
    nodeCommand(
      "verification-entrypoints",
      "root verification entry points",
      "scripts/verify/verification-entrypoints.mjs",
      "complete verification keeps root verify commands on adaptive admission and pre-push evidence validation",
    ),
    verificationCommand({
      key: "dependency-regressions",
      label: "dependency workflow regressions",
      executable: process.execPath,
      args: [
        "--test",
        "--test-reporter=dot",
        ...existingTestFiles([
          "scripts/deps/dependency-policy.test.mjs",
          "scripts/deps/dependency-owner-normalization.test.mjs",
        ]),
      ],
      reason:
        "complete verification checks workspace ownership, ambiguity, scoped pins, stable selections, transactions, and version classification",
    }),
    nodeCommand(
      "secrets",
      "secret scan",
      "scripts/verify/secrets.mjs",
      "complete verification always checks committable content for secret material",
    ),
    nodeCommand(
      "language",
      "language hygiene",
      "scripts/verify/language.mjs",
      "complete verification always checks active repository language policy",
    ),
    nodeCommand(
      "patterns",
      "code-pattern policy",
      "scripts/verify/patterns.mjs",
      "complete verification always checks maintainability and source-role policy",
    ),
    nodeCommand(
      "context-policy",
      "context source policy",
      "scripts/verify/context-source-policy.mjs",
      "complete verification checks retrieval source boundaries without loading the model or index",
    ),
    verificationCommand({
      key: "context-regressions",
      label: "context retrieval regressions",
      executable: process.execPath,
      args: ["--test", "--test-reporter=dot", "scripts/context/context-regression.test.mjs"],
      coveredTestPaths: [
        "scripts/context/context-source-paths.test.mjs",
        "scripts/context/context-chunks-build.test.mjs",
        "scripts/context/context-storage.test.mjs",
        "scripts/context/context-publication-policy.test.mjs",
        "scripts/context/context-maintenance.test.mjs",
        "scripts/context/context-lifecycle.test.mjs",
        "scripts/context/context-lock-query.test.mjs",
        "scripts/context/context-integration.test.mjs",
        "scripts/context/terminal-output.test.mjs",
      ],
      reason:
        "complete verification exercises retrieval behavior in isolated temporary index roots",
    }),
    verificationCommand({
      key: "framework-regressions",
      label: "CodexRig lifecycle and Git platform regressions",
      executable: process.execPath,
      args: [
        "--test",
        "--test-reporter=dot",
        "scripts/framework/framework-lifecycle.test.mjs",
        "scripts/platform/platform-lifecycle.test.mjs",
      ],
      reason:
        "complete verification checks versioned upgrades, startup attestation, compatibility tracks, provider detection, and GitHub/GitLab policy adapters",
    }),
    verificationCommand({
      key: "setup-regressions",
      label: "setup and project isolation regressions",
      executable: process.execPath,
      args: [
        "--test",
        "--test-reporter=dot",
        ...existingTestFiles([
          "scripts/setup/codex-launcher.test.mjs",
          "scripts/setup/setup-regression.test.mjs",
          "scripts/setup/project-initialization-boundaries.source.test.mjs",
          "scripts/setup/project-initialization.source.test.mjs",
          "scripts/setup/project-initialization-transfer.source.test.mjs",
          "scripts/setup/project-creator-contract.source.test.mjs",
          "scripts/setup/project-generator-state.test.mjs",
          "scripts/setup/staged-project-validator.test.mjs",
        ]),
      ],
      reason:
        "complete verification exercises runtime isolation, non-destructive hook installation, and clean project initialization",
    }),
    verificationCommand({
      key: "verification-boundary-regressions",
      label: "verification boundary regressions",
      executable: process.execPath,
      args: [
        "--test",
        "--test-reporter=dot",
        "scripts/docs/document-scope.test.mjs",
        "scripts/context/portable-context-contract.test.mjs",
        "scripts/context/terminal-output.test.mjs",
        "scripts/repository/product-roots.test.mjs",
        "scripts/repository/source-inventory-git-environment.test.mjs",
        "scripts/repository/source-inventory.test.mjs",
        "scripts/repository/stable-file-snapshot.test.mjs",
        "scripts/stack/stack-detector.test.mjs",
        "scripts/verify/adaptive-surfaces.test.mjs",
        "scripts/verify/api-security.test.mjs",
        "scripts/verify/path-hygiene.test.mjs",
        "scripts/verify/patterns.test.mjs",
        "scripts/verify/secrets.test.mjs",
        "scripts/verify/image-assets.test.mjs",
        "scripts/verify/surface-quality.test.mjs",
        "scripts/web/update-sitemap-lastmod.test.mjs",
        "scripts/web/web-quality-scan.test.mjs",
      ],
      reason:
        "complete verification exercises pushed history, remote, API, stable source snapshots, active-source, documentation-scope, and layout-neutral surface boundaries",
    }),
    nodeCommand(
      "path-hygiene",
      "active-source path hygiene",
      "scripts/verify/path-hygiene.mjs",
      "complete verification checks active source paths without replaying unrelated commands",
    ),
    nodeCommand(
      "surface-quality",
      "stack and product surfaces",
      "scripts/verify/surface-quality.mjs",
      "one repository snapshot owns stack, web, accessibility, search, responsive, and image checks",
    ),
  ];

  const sourceBaselineScript = "scripts/verify/source-baseline.mjs";
  if (existsSync(path.join(root, sourceBaselineScript))) {
    commands.push(
      nodeCommand(
        "source-baseline",
        "clean reusable source baseline",
        sourceBaselineScript,
        "source-framework verification refuses goals, slices, process history, generated exports, project transactions, and context-index state",
      ),
    );
  }

  commands.push(
    nodeCommand(
      "api-security",
      "API static boundary heuristic",
      "scripts/verify/api-security.mjs",
      "complete verification includes a static API boundary heuristic when API-like source exists",
    ),
    verificationCommand({
      key: "verification-orchestration-regressions",
      label: "focused verification orchestration regressions",
      executable: process.execPath,
      args: [
        "--test",
        "--test-reporter=dot",
        "scripts/verify/adaptive-cli.test.mjs",
        "scripts/verify/adaptive-runner-routing.test.mjs",
        "scripts/verify/adaptive-runner.test.mjs",
        "scripts/verify/format-project.test.mjs",
        "scripts/verify/git-remote-identity.test.mjs",
        "scripts/goals/goal-publication-precondition.test.mjs",
        "scripts/verify/package-manifest.test.mjs",
        "scripts/verify/pre-push.test.mjs",
        "scripts/verify/pushed-object-scan.test.mjs",
        "scripts/verify/verification-evidence-integrity.test.mjs",
        "scripts/verify/verification-evidence.test.mjs",
        "scripts/verify/verification-executor.test.mjs",
        "scripts/verify/verification-git-basis.test.mjs",
        "scripts/verify/verification-session-lock.test.mjs",
      ],
      reason:
        "complete verification checks routing and phase short-circuit behavior before broad regression suites",
    }),
    verificationCommand({
      key: "format",
      label: "formatting",
      executable: process.execPath,
      args: ["scripts/verify/format-project.mjs", "--check"],
      reason:
        "complete verification checks project formatting without traversing private Codex runtime state",
    }),
  );

  return dedupeCommands(
    commands.map((command) => ({
      ...command,
      phase: broadRegressionCommandKeys.has(command.key) ? "broad" : "preflight",
    })),
  );
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
  const completeCommands = completeVerificationCommands();
  const needsWorkspace =
    options.mode !== "pre-push" &&
    (!basis.trusted ||
      options.forceFull ||
      classifiedPaths.some((entry) =>
        entry.categories.some((category) =>
          [
            "app/package/service/runtime source",
            "dependency/package manager files",
            "infrastructure/runtime config",
          ].includes(category),
        ),
      ));
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
        : focused.readOnlyCommands;
  const workspaceCommands =
    options.mode === "pre-push"
      ? []
      : admission.mode === "full"
        ? workspaceLifecycleCommands(workspaceManifests)
        : focused.workspaceCommands;

  return {
    admission,
    options,
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
