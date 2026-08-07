import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { isFullRelevantPath, root } from "./adaptive-state.mjs";
import {
  selectChangedWorkspaceManifests,
  workspaceLifecycleCommands,
} from "./workspace-verification.mjs";

const broadShellEntryPointPattern =
  /^(?:scripts\/verify\/pre-push\.sh|scripts\/git-hooks\/pre-push)$/u;
const ownedCategoryConsumers = new Map([
  ["active documentation", ["docs"]],
  ["project Codex config", ["codex-config"]],
  ["Codex runtime boundary", ["codex-config"]],
  ["repo-local skill source", ["skills"]],
  ["skill path boundary", ["skills"]],
  ["context workflow", ["context-regressions"]],
  ["dependency workflow", ["dependency-regressions"]],
  ["setup workflow", ["setup-regressions"]],
  ["CodexRig framework workflow", ["framework-regressions"]],
  ["stack workflow", ["surface-quality"]],
  ["web workflow", ["surface-quality"]],
]);
const exactConsumerRegistry = new Map([
  [".gitattributes", ["path-hygiene", "repository-smoke"]],
  [".gitignore", ["codex-config", "context-policy", "path-hygiene", "repository-smoke"]],
  ["package.json", ["verification-entrypoints"]],
  ["scripts/docs/ensure-project-manifest.mjs", ["docs", "repository-smoke"]],
  ["scripts/verify/a11y.mjs", ["surface-quality"]],
  ["scripts/verify/adaptive-surfaces.mjs", ["surface-quality"]],
  ["scripts/verify/responsive.mjs", ["surface-quality"]],
  ["scripts/verify/repository-smoke-content.mjs", ["repository-smoke"]],
  ["scripts/verify/repository-smoke.mjs", ["repository-smoke"]],
  ["scripts/verify/seo.mjs", ["surface-quality"]],
  ["scripts/verify/stack-standards.mjs", ["surface-quality"]],
  ["scripts/verify/web-stack.mjs", ["surface-quality"]],
]);
const explicitTestConsumerRegistry = new Map([
  ["scripts/git-hooks/pre-push", ["scripts/verify/pre-push.test.mjs"]],
  [
    "scripts/goals/goal-publication-precondition.mjs",
    ["scripts/goals/goal-publication-precondition.test.mjs"],
  ],
  [
    "scripts/verify/adaptive.mjs",
    [
      "scripts/verify/adaptive-cli.test.mjs",
      "scripts/verify/adaptive-runner-routing.test.mjs",
      "scripts/verify/adaptive-runner.test.mjs",
    ],
  ],
  ["scripts/verify/adaptive-options.mjs", ["scripts/verify/adaptive-cli.test.mjs"]],
  [
    "scripts/verify/adaptive-state.mjs",
    [
      "scripts/verify/adaptive-cli.test.mjs",
      "scripts/verify/adaptive-runner-routing.test.mjs",
      "scripts/verify/adaptive-runner.test.mjs",
      "scripts/verify/pre-push.test.mjs",
      "scripts/verify/pushed-object-scan.test.mjs",
      "scripts/verify/verification-git-basis.test.mjs",
      "scripts/verify/verification-session-lock.test.mjs",
    ],
  ],
  [
    "scripts/verify/adaptive-runner.mjs",
    ["scripts/verify/adaptive-runner-routing.test.mjs", "scripts/verify/adaptive-runner.test.mjs"],
  ],
  [
    "scripts/verify/adaptive-runner-test-helpers.mjs",
    ["scripts/verify/adaptive-runner-routing.test.mjs", "scripts/verify/adaptive-runner.test.mjs"],
  ],
  ["scripts/verify/git-remote-identity.mjs", ["scripts/verify/git-remote-identity.test.mjs"]],
  ["scripts/verify/package-manifest.mjs", ["scripts/verify/package-manifest.test.mjs"]],
  ["scripts/verify/pre-push.sh", ["scripts/verify/pre-push.test.mjs"]],
  ["scripts/verify/pre-push-steps.sh", ["scripts/verify/pre-push.test.mjs"]],
  ["scripts/verify/pushed-object-scan.mjs", ["scripts/verify/pushed-object-scan.test.mjs"]],
  [
    "scripts/verify/secret-patterns.mjs",
    [
      "scripts/context/terminal-output.test.mjs",
      "scripts/verify/git-remote-identity.test.mjs",
      "scripts/verify/pushed-object-scan.test.mjs",
      "scripts/verify/secrets.test.mjs",
    ],
  ],
  [
    "scripts/verify/secret-content-scan.mjs",
    ["scripts/verify/pushed-object-scan.test.mjs", "scripts/verify/secrets.test.mjs"],
  ],
  [
    "scripts/verify/verification-admission.mjs",
    [
      "scripts/verify/adaptive-cli.test.mjs",
      "scripts/verify/adaptive-runner-routing.test.mjs",
      "scripts/verify/adaptive-runner.test.mjs",
      "scripts/verify/verification-evidence-integrity.test.mjs",
    ],
  ],
  [
    "scripts/verify/verification-evidence-error.mjs",
    [
      "scripts/verify/verification-evidence-integrity.test.mjs",
      "scripts/verify/verification-evidence.test.mjs",
    ],
  ],
  [
    "scripts/verify/verification-evidence-store.mjs",
    [
      "scripts/verify/verification-evidence-integrity.test.mjs",
      "scripts/verify/verification-evidence.test.mjs",
    ],
  ],
  [
    "scripts/verify/verification-evidence.mjs",
    [
      "scripts/verify/verification-evidence-integrity.test.mjs",
      "scripts/verify/verification-evidence.test.mjs",
    ],
  ],
  [
    "scripts/verify/verification-evidence-record.mjs",
    [
      "scripts/verify/verification-evidence-integrity.test.mjs",
      "scripts/verify/verification-evidence.test.mjs",
    ],
  ],
  [
    "scripts/verify/verification-evidence-test-helpers.mjs",
    [
      "scripts/verify/verification-evidence-integrity.test.mjs",
      "scripts/verify/verification-evidence.test.mjs",
    ],
  ],
  [
    "scripts/verify/verification-record-helpers.mjs",
    [
      "scripts/verify/verification-evidence-integrity.test.mjs",
      "scripts/verify/verification-evidence.test.mjs",
    ],
  ],
  ["scripts/verify/verification-executor.mjs", ["scripts/verify/verification-executor.test.mjs"]],
  ["scripts/verify/verification-git-basis.mjs", ["scripts/verify/verification-git-basis.test.mjs"]],
  [
    "scripts/verify/verification-risk-profile.mjs",
    ["scripts/verify/verification-evidence.test.mjs"],
  ],
  [
    "scripts/verify/verification-runtime-identity.mjs",
    [
      "scripts/verify/verification-evidence-integrity.test.mjs",
      "scripts/verify/verification-executor.test.mjs",
    ],
  ],
  [
    "scripts/verify/verification-session-lock.mjs",
    [
      "scripts/verify/verification-evidence-integrity.test.mjs",
      "scripts/verify/verification-evidence.test.mjs",
      "scripts/verify/verification-executor.test.mjs",
      "scripts/verify/verification-session-lock.test.mjs",
    ],
  ],
  [
    "scripts/verify/workspace-verification.mjs",
    ["scripts/verify/adaptive-runner-routing.test.mjs", "scripts/verify/adaptive-runner.test.mjs"],
  ],
  [
    "scripts/repository/git-runtime-isolation.mjs",
    [
      "scripts/goals/goal-publication-precondition.test.mjs",
      "scripts/repository/source-inventory-git-environment.test.mjs",
      "scripts/verify/pre-push.test.mjs",
      "scripts/verify/pushed-object-scan.test.mjs",
      "scripts/verify/verification-git-basis.test.mjs",
    ],
  ],
  ["scripts/repository/product-roots.mjs", ["scripts/repository/product-roots.test.mjs"]],
  [
    "scripts/repository/source-inventory-policy.mjs",
    [
      "scripts/repository/source-inventory-git-environment.test.mjs",
      "scripts/repository/source-inventory.test.mjs",
    ],
  ],
  [
    "scripts/repository/source-inventory.mjs",
    [
      "scripts/repository/source-inventory-git-environment.test.mjs",
      "scripts/repository/source-inventory.test.mjs",
    ],
  ],
  [
    "scripts/repository/stable-file-snapshot.mjs",
    ["scripts/repository/stable-file-snapshot.test.mjs"],
  ],
  [
    "scripts/platform/platform-lifecycle-harness.mjs",
    ["scripts/platform/platform-lifecycle.test.mjs"],
  ],
]);
function commandSignature(command) {
  return JSON.stringify([
    command.executable,
    command.args,
    command.phase,
    command.artifactOwners ?? [],
    command.coveredTestPaths ?? [],
  ]);
}

function dedupeCommands(commands) {
  const result = new Map();
  for (const command of commands) {
    const existing = result.get(command.key);
    if (existing && commandSignature(existing) !== commandSignature(command)) {
      throw new Error(`Verification command key ${command.key} has conflicting focused owners.`);
    }
    if (!existing) result.set(command.key, command);
  }
  return [...result.values()];
}

function commandsByKey(commands) {
  return new Map(commands.map((command) => [command.key, command]));
}

function selectCommands(available, keys) {
  return keys.map((key) => available.get(key)).filter(Boolean);
}

function directVerifierCommands(available, relativePath) {
  return [...available.values()].filter(
    (command) => command.args?.[0] === relativePath && !isForbiddenFocusedOwner(command),
  );
}

function changedTestPath(relativePath, repositoryRoot) {
  if (!relativePath.endsWith(".test.mjs")) return null;
  return existsSync(path.join(repositoryRoot, ...relativePath.split("/"))) ? relativePath : null;
}

function focusedTestCommand(testPath, ownerPath) {
  const identity = createHash("sha256").update(testPath).digest("hex").slice(0, 16);
  return {
    args: ["--test", "--test-reporter=dot", testPath],
    artifactOwners: [],
    executable: process.execPath,
    key: `focused-test:${identity}`,
    label: `focused regression owner for ${ownerPath}`,
    phase: "preflight",
    reason: `${testPath} is the exact executable verifier owner for ${ownerPath}`,
  };
}

function focusedManifestCommand(relativePath) {
  const identity = createHash("sha256").update(relativePath).digest("hex").slice(0, 16);
  return {
    args: ["scripts/verify/package-manifest.mjs", "--path", relativePath],
    artifactOwners: [],
    executable: process.execPath,
    key: `focused-manifest:${identity}`,
    label: `whole package manifest owner for ${relativePath}`,
    phase: "preflight",
    reason: `${relativePath} owns its complete identity, scripts, dependencies, and export registry`,
  };
}

function manifestPathForPackageContract(relativePath) {
  if (path.posix.basename(relativePath) === "package.json") return relativePath;
  if (path.posix.basename(relativePath) !== "package.exports.json") return null;
  const directory = path.posix.dirname(relativePath);
  return directory === "." ? "package.json" : `${directory}/package.json`;
}

function effectiveCategories(entry, { verifyOnlyRootManifest }) {
  if (entry.path !== "package.json" || !verifyOnlyRootManifest) return entry.categories;
  return ["framework scripts", "verification orchestration", "verify-only root manifest"];
}

function categoryConsumerKeys(categories) {
  const keys = new Set();
  const has = (category) => categories.includes(category);
  const add = (...values) => values.forEach((value) => keys.add(value));

  if (has("active documentation")) add("docs", "secrets", "language", "path-hygiene");
  if (has("script catalog")) add("scripts");
  if (has("context source-policy surface") || has("context workflow")) {
    add("syntax-lint", "scripts", "context-policy", "context-regressions", "patterns");
  }
  if (has("dependency workflow")) {
    add("syntax-lint", "scripts", "dependencies", "patterns");
  }
  if (has("setup workflow")) {
    add("syntax-lint", "scripts", "codex-config", "secrets", "path-hygiene", "patterns");
  }
  if (has("CodexRig framework workflow")) {
    add("syntax-lint", "scripts", "repository-smoke", "codex-config", "patterns");
  }
  if (has("stack workflow") || has("web workflow")) {
    add("syntax-lint", "scripts", "surface-quality", "patterns");
  }
  if (has("image quality surface") || has("image asset surface")) add("surface-quality");
  if (has("project Codex config") || has("Codex runtime boundary")) {
    add("codex-config", "secrets", "path-hygiene");
  }
  if (has("repo-local skill source") || has("skill path boundary")) {
    add("skills", "secrets", "language", "path-hygiene");
  }
  if (has("repo-local skill executable source")) add("syntax-lint");
  if (has("verification orchestration")) add("syntax-lint", "scripts", "patterns");
  if (has("app/package/service/runtime source")) {
    add(
      "syntax-lint",
      "repository-smoke",
      "secrets",
      "language",
      "patterns",
      "path-hygiene",
      "surface-quality",
      "api-security",
    );
  }
  if (has("dependency/package manager files")) {
    add("syntax-lint", "scripts", "repository-smoke", "dependencies", "secrets", "patterns");
  }
  if (has("infrastructure/runtime config")) {
    add("syntax-lint", "secrets", "patterns", "surface-quality", "api-security");
  }
  if (has("repository source-policy surface")) {
    add("codex-config", "context-policy", "path-hygiene", "repository-smoke", "secrets");
  }
  return [...keys];
}

function entryRouting({
  entry,
  available,
  repositoryRoot,
  verifyOnlyRootManifest,
  workspaceManifests,
}) {
  const categories = effectiveCategories(entry, { verifyOnlyRootManifest });
  const commands = [];
  const ownerKeys = new Set();
  const testPath = changedTestPath(entry.path, repositoryRoot);
  let hasExactOwner = testPath === entry.path;

  const directOwners = directVerifierCommands(available, entry.path);
  if (directOwners.length > 0) {
    commands.push(...directOwners);
    directOwners.forEach((command) => ownerKeys.add(command.key));
    hasExactOwner = true;
  }
  const exactKeys = exactConsumerRegistry.get(entry.path) ?? [];
  const exactCommands = selectCommands(available, exactKeys);
  if (exactCommands.length > 0) {
    commands.push(...exactCommands);
    exactCommands.forEach((command) => ownerKeys.add(command.key));
    hasExactOwner = true;
  }
  if (testPath) {
    const command = focusedTestCommand(testPath, entry.path);
    commands.push(command);
    ownerKeys.add(command.key);
  }
  for (const consumerTest of explicitTestConsumerRegistry.get(entry.path) ?? []) {
    if (!existsSync(path.join(repositoryRoot, ...consumerTest.split("/")))) continue;
    const command = focusedTestCommand(consumerTest, entry.path);
    commands.push(command);
    ownerKeys.add(command.key);
    hasExactOwner = true;
  }
  const orchestrationFallback = available.get("verification-orchestration-regressions");
  const removedVerificationTest =
    entry.path.startsWith("scripts/verify/") &&
    entry.path.endsWith(".test.mjs") &&
    !existsSync(path.join(repositoryRoot, ...entry.path.split("/")));
  if (
    orchestrationFallback &&
    ((verifyOnlyRootManifest && entry.path === "package.json") || removedVerificationTest)
  ) {
    commands.push(orchestrationFallback);
    ownerKeys.add(orchestrationFallback.key);
    hasExactOwner = true;
  }

  const consumerKeys = categoryConsumerKeys(categories).filter(
    (key) =>
      !hasExactOwner ||
      !categories.some((category) => (ownedCategoryConsumers.get(category) ?? []).includes(key)),
  );
  commands.push(...selectCommands(available, consumerKeys));
  if (!hasExactOwner) {
    for (const category of categories) {
      for (const key of ownedCategoryConsumers.get(category) ?? []) {
        const command = available.get(key);
        if (command) {
          commands.push(command);
          ownerKeys.add(key);
        }
      }
    }
  }
  if (categories.includes("dependency/package manager files")) {
    const manifestPath = manifestPathForPackageContract(entry.path);
    if (manifestPath && existsSync(path.join(repositoryRoot, ...manifestPath.split("/")))) {
      const manifestCommand = focusedManifestCommand(manifestPath);
      commands.push(manifestCommand);
      ownerKeys.add(manifestCommand.key);
    }
    for (const key of ["dependencies", "repository-smoke"]) {
      if (available.has(key)) ownerKeys.add(key);
    }
  }
  if (categories.includes("infrastructure/runtime config") && available.has("surface-quality")) {
    ownerKeys.add("surface-quality");
  }
  if (categories.includes("repository source-policy surface")) {
    for (const key of ["codex-config", "context-policy", "path-hygiene", "repository-smoke"]) {
      if (available.has(key)) ownerKeys.add(key);
    }
  }

  const selectedWorkspaceManifests = selectChangedWorkspaceManifests(
    workspaceManifests,
    [{ ...entry, categories }],
    { repositoryRoot },
  );
  const ownerWorkspaceCommands = workspaceLifecycleCommands(selectedWorkspaceManifests, {
    mode: "changed",
  });
  if (
    categories.some((category) =>
      [
        "app/package/service/runtime source",
        "dependency/package manager files",
        "infrastructure/runtime config",
      ].includes(category),
    )
  ) {
    ownerWorkspaceCommands.forEach((command) => ownerKeys.add(command.key));
  }

  return {
    categories,
    ownerKeys: [...ownerKeys].sort(),
    readOnlyCommands: commands,
  };
}

export function buildFocusedVerification({
  classifiedPaths,
  completeCommands,
  repositoryRoot = root,
  verifyOnlyRootManifest = false,
  workspaceManifests = [],
}) {
  const available = commandsByKey(completeCommands);
  const ownersByPath = [];
  const readOnlyCommands = [];
  const effectiveEntries = classifiedPaths.map((entry) => ({
    ...entry,
    categories: effectiveCategories(entry, { verifyOnlyRootManifest }),
  }));
  const workspaceCommands = workspaceLifecycleCommands(
    selectChangedWorkspaceManifests(workspaceManifests, effectiveEntries, { repositoryRoot }),
    { mode: "changed" },
  );
  let hasRoutablePath = false;

  for (const entry of classifiedPaths) {
    if (entry.categories.includes("generated/cache/local-only files")) {
      ownersByPath.push({ categories: entry.categories, ownerKeys: [], path: entry.path });
      continue;
    }
    hasRoutablePath = true;
    const route = entryRouting({
      entry,
      available,
      repositoryRoot,
      verifyOnlyRootManifest,
      workspaceManifests,
    });
    readOnlyCommands.push(...route.readOnlyCommands);
    ownersByPath.push({
      categories: route.categories,
      ownerKeys: route.ownerKeys,
      path: entry.path,
    });
  }
  if (hasRoutablePath && available.has("format")) {
    readOnlyCommands.push(available.get("format"));
  }

  return {
    ownersByPath,
    readOnlyCommands: dedupeCommands(
      readOnlyCommands.map((command) => ({
        ...command,
        phase: "preflight",
        reason: command.reason.startsWith("targeted")
          ? command.reason
          : `targeted current-state coverage: ${command.reason}`,
      })),
    ),
    workspaceCommands: dedupeCommands(workspaceCommands),
  };
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

export function omitAlreadyCoveredPaths({
  basis,
  changedScope,
  expectedInputs,
  simulated = false,
}) {
  const inputsUnchanged =
    basis?.current?.broadFingerprint === expectedInputs?.broadFingerprint &&
    basis?.current?.fingerprint === expectedInputs?.exactFingerprint &&
    basis?.current?.planDigest === expectedInputs?.planDigest &&
    basis?.current?.runtimeDigest === expectedInputs?.runtimeDigest &&
    JSON.stringify(basis?.current?.riskFingerprints ?? []) ===
      JSON.stringify(expectedInputs?.riskFingerprints ?? []);
  const basisRelationKnown =
    changedScope.basisChanged === true || changedScope.basisChanged === false;
  const contentIdenticalCommit =
    changedScope.basisChanged === true &&
    changedScope.basis?.complete === true &&
    changedScope.basis.dirtyPaths.length === 0 &&
    basis?.current?.gitBasis?.complete === true &&
    JSON.stringify(changedScope.paths) === JSON.stringify(basis.current.gitBasis.dirtyPaths);
  if (
    !simulated &&
    basis?.trusted &&
    basis.current &&
    !changedScope.incomplete &&
    basisRelationKnown &&
    inputsUnchanged &&
    (changedScope.basisChanged === false || contentIdenticalCommit)
  ) {
    return {
      ...changedScope,
      paths: [],
      reason:
        changedScope.basisChanged === true
          ? "successful evidence already covers the content; only the Git basis changed"
          : "exact-current successful evidence already covers this Git basis",
    };
  }
  if (
    !simulated &&
    basis?.trusted &&
    basis.current?.fingerprint !== expectedInputs?.exactFingerprint &&
    changedScope.basisChanged === false &&
    !changedScope.incomplete &&
    changedScope.paths.length === 0
  ) {
    return {
      ...changedScope,
      incomplete: true,
      reason: "exact source fingerprint changed without a classified Git delta",
    };
  }
  return changedScope;
}

export function decideVerificationAdmission({
  basis,
  changed,
  forceFull = false,
  forceReason = "",
  ownersByPath,
  productLayout,
  broadOnlyRisks = [],
  coveredBroadRisks = [],
}) {
  const routeByPath = new Map(ownersByPath.map((entry) => [entry.path, entry]));
  const fullRelevantPaths = uniqueSorted(
    ownersByPath
      .filter((entry) => isFullRelevantPath(entry.path, { productLayout }))
      .map((entry) => entry.path),
  );
  const unknownPaths = uniqueSorted(
    ownersByPath
      .filter((entry) => entry.categories.includes("unknown or incomplete change scope"))
      .map((entry) => entry.path),
  );
  const uncoveredFullRelevantPaths = fullRelevantPaths.filter(
    (relativePath) => (routeByPath.get(relativePath)?.ownerKeys.length ?? 0) === 0,
  );
  const focusedCommandOwners = ownersByPath
    .filter((entry) => entry.ownerKeys.length > 0)
    .map((entry) => ({ ownerKeys: entry.ownerKeys, path: entry.path }));

  let mode = "targeted";
  let reason = "all full-relevant delta paths have focused verifier owners";
  if (forceFull) {
    const structuredForceReason =
      /^(owner-request|uncovered-risk): ([a-z0-9][a-z0-9._/-]{1,63}) - /iu.exec(forceReason);
    if (
      structuredForceReason?.[1].toLowerCase() === "uncovered-risk" &&
      !broadOnlyRisks.some((risk) => risk.riskId === structuredForceReason[2])
    ) {
      throw new Error(
        `Forced uncovered risk ${structuredForceReason[2]} is not present in the current uncovered risk registry.`,
      );
    }
    mode = "full";
    reason = `owner forced full coverage: ${forceReason}`;
  } else if (!basis.trusted) {
    mode = "full";
    reason = `no trusted successful basis${basis.reason ? `: ${basis.reason}` : ""}`;
  } else if (changed.incomplete) {
    mode = "full";
    reason = `changed-path classification is incomplete: ${changed.reason}`;
  } else if (unknownPaths.length > 0) {
    mode = "full";
    reason = `unknown changed paths require fail-closed coverage: ${unknownPaths.join(", ")}`;
  } else if (uncoveredFullRelevantPaths.length > 0) {
    mode = "full";
    reason = `full-relevant paths have no focused verifier owner: ${uncoveredFullRelevantPaths.join(", ")}`;
  } else if (broadOnlyRisks.length > 0) {
    mode = "full";
    reason = `broad-only global invariants are uncovered: ${broadOnlyRisks
      .map((risk) => `${risk.riskId} at ${risk.path}: ${risk.reason}`)
      .join("; ")}`;
  }
  if (mode === "full" && !reason) {
    throw new Error("Full verification admission requires a concrete uncovered reason.");
  }

  return {
    canAdvanceSuccessfulBasis:
      mode === "targeted" &&
      !changed.incomplete &&
      (changed.paths.length > 0 || changed.basisChanged === true) &&
      unknownPaths.length === 0 &&
      uncoveredFullRelevantPaths.length === 0,
    coveredBroadRisks,
    focusedCommandOwners,
    fullRelevantPaths,
    mode,
    reason,
    uncoveredBroadRisks: broadOnlyRisks,
    uncoveredFullRelevantPaths,
    unknownPaths,
    unknownReasons: unknownPaths.map((relativePath) => ({
      path: relativePath,
      reason: "no safe exact path classification",
    })),
  };
}

export function isForbiddenFocusedOwner(command) {
  if (!command) return false;
  if (command.key === "verify:repo" || command.key === "verify:full") return true;
  if (command.args?.some((argument) => broadShellEntryPointPattern.test(argument))) return true;
  const adaptiveIndex = command.args?.indexOf("scripts/verify/adaptive.mjs") ?? -1;
  return (
    adaptiveIndex >= 0 &&
    command.args
      .slice(adaptiveIndex + 1)
      .some((argument) => argument === "--mode" || argument.startsWith("--mode="))
  );
}
