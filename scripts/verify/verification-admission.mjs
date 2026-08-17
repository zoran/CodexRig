/** Owns verification admission behavior for the repository verification boundary. */
import { existsSync } from "node:fs";
import path from "node:path";
import { root } from "./adaptive-state.mjs";
import {
  changedTestPath,
  commandsByKey,
  dedupeCommands,
  directVerifierCommands,
  focusedManifestCommand,
  focusedTestCommand,
  isForbiddenFocusedOwner,
  manifestPathForPackageContract,
  selectCommands,
} from "./verification-admission-commands.mjs";
import {
  selectChangedWorkspaceManifests,
  workspaceLifecycleCommands,
} from "./workspace-verification.mjs";
import {
  exactConsumerRegistry,
  ownedCategoryConsumers,
} from "./verification-admission-registry.mjs";
const explicitTestConsumerRegistry = new Map([
  [
    "scripts/contracts/compatibility-contract.mjs",
    [
      "scripts/framework/compatibility-integrity.test.mjs",
      "scripts/framework/framework-lifecycle.test.mjs",
    ],
  ],
  [
    "scripts/contracts/framework-contract.mjs",
    [
      "scripts/framework/framework-version.test.mjs",
      "scripts/framework/framework-lifecycle.test.mjs",
    ],
  ],
  ["LICENSE", ["scripts/verify/licensing.test.mjs"]],
  ["NOTICE", ["scripts/verify/licensing.test.mjs"]],
  [
    "scripts/contracts/semver-contract.mjs",
    [
      "scripts/framework/framework-version.test.mjs",
      "scripts/framework/framework-lifecycle.test.mjs",
    ],
  ],
  [
    "scripts/contracts/delivery-configuration.mjs",
    ["scripts/goals/repository-housekeeping.test.mjs"],
  ],
  ["scripts/contracts/portable-toml-bootstrap.mjs", ["scripts/setup/setup-regression.test.mjs"]],
  ["scripts/contracts/product-configuration.mjs", ["scripts/verify/white-label.test.mjs"]],
  ["scripts/contracts/localization-configuration.mjs", ["scripts/verify/localization.test.mjs"]],
  ["scripts/contracts/tenancy-configuration.mjs", ["scripts/verify/api-security.test.mjs"]],
  [
    "scripts/filesystem/owned-file-operations.mjs",
    [
      ".agents/skills/reset-framework/scripts/reset-framework.test.mjs",
      "scripts/deps/dependency-policy.test.mjs",
      "scripts/framework/framework-lifecycle.test.mjs",
      "scripts/goals/repository-housekeeping.test.mjs",
    ],
  ],
  [
    "scripts/filesystem/owned-path-safety.mjs",
    [
      ".agents/skills/reset-framework/scripts/reset-framework.test.mjs",
      "scripts/context/context-maintenance.test.mjs",
      "scripts/deps/dependency-policy.test.mjs",
      "scripts/framework/framework-lifecycle.test.mjs",
      "scripts/verify/verification-session-lock.test.mjs",
    ],
  ],
  ["scripts/deps/dependency-plan.mjs", ["scripts/deps/dependency-policy.test.mjs"]],
  [
    "scripts/repository/runtime-lifecycle-mutex.mjs",
    [
      ".agents/skills/reset-framework/scripts/reset-framework.test.mjs",
      "scripts/deps/dependency-policy.test.mjs",
      "scripts/framework/framework-lifecycle.test.mjs",
      "scripts/verify/verification-session-lock.test.mjs",
    ],
  ],
  [
    "scripts/repository/runtime-lifecycle-process.mjs",
    [
      "scripts/deps/dependency-policy.test.mjs",
      "scripts/framework/framework-lifecycle.test.mjs",
      "scripts/verify/verification-session-lock.test.mjs",
    ],
  ],
  [
    "scripts/repository/runtime-lifecycle-schema.mjs",
    [
      ".agents/skills/reset-framework/scripts/reset-framework.test.mjs",
      "scripts/deps/dependency-policy.test.mjs",
      "scripts/framework/framework-lifecycle.test.mjs",
      "scripts/verify/verification-session-lock.test.mjs",
    ],
  ],
  [
    "scripts/repository/runtime-owned-state.mjs",
    [
      ".agents/skills/reset-framework/scripts/reset-framework.test.mjs",
      "scripts/context/context-lifecycle.test.mjs",
      "scripts/framework/framework-lifecycle.test.mjs",
    ],
  ],
  [
    "scripts/repository/runtime-process-identity.mjs",
    [
      "scripts/deps/dependency-policy.test.mjs",
      "scripts/framework/framework-lifecycle.test.mjs",
      "scripts/verify/verification-session-lock.test.mjs",
    ],
  ],
  [
    "scripts/repository/runtime-session-state.mjs",
    [
      "scripts/context/context-lifecycle.test.mjs",
      "scripts/framework/framework-lifecycle.test.mjs",
    ],
  ],
  [
    "scripts/repository/pnpm-workspace-manifests.mjs",
    [
      "scripts/deps/dependency-policy.test.mjs",
      "scripts/deps/dependency-owner-normalization.test.mjs",
    ],
  ],
  ["scripts/docs/delivery-manifest.mjs", ["scripts/goals/repository-housekeeping.test.mjs"]],
  ["scripts/docs/document-scope.mjs", ["scripts/docs/document-scope.test.mjs"]],
  [
    "scripts/docs/project-document-policy.mjs",
    [
      "scripts/context/portable-context-contract.test.mjs",
      "scripts/framework/framework-lifecycle.test.mjs",
    ],
  ],
  [
    "scripts/docs/project-manifest-contract.mjs",
    ["scripts/docs/project-manifest-contract.test.mjs"],
  ],
  ["scripts/git-hooks/pre-push", ["scripts/verify/pre-push.test.mjs"]],
  ["scripts/verify/delivery-artifact.mjs", ["scripts/verify/verification-evidence.test.mjs"]],
  ["scripts/verify/licensing.mjs", ["scripts/verify/licensing.test.mjs"]],
  [
    "scripts/verify/verification-admission-commands.mjs",
    ["scripts/verify/adaptive-runner-routing.test.mjs"],
  ],
  [
    "scripts/verify/verification-admission-registry.mjs",
    ["scripts/verify/adaptive-runner-routing.test.mjs"],
  ],
  ["scripts/goals/repository-housekeeping.mjs", ["scripts/goals/repository-housekeeping.test.mjs"]],
  [
    "scripts/goals/repository-housekeeping-files.mjs",
    ["scripts/goals/repository-housekeeping.test.mjs"],
  ],
  [
    "scripts/goals/repository-housekeeping-transaction.mjs",
    ["scripts/goals/repository-housekeeping.test.mjs"],
  ],
  ["scripts/framework/framework-version.mjs", ["scripts/framework/framework-version.test.mjs"]],
  [
    "scripts/framework/framework-installation-receipt.mjs",
    ["scripts/framework/framework-lifecycle.test.mjs"],
  ],
  [
    "scripts/framework/compatibility-matrix.mjs",
    [
      "scripts/framework/compatibility-integrity.test.mjs",
      "scripts/framework/framework-lifecycle.test.mjs",
    ],
  ],
  [
    "scripts/framework/framework-doctor.mjs",
    ["scripts/framework/compatibility-integrity.test.mjs"],
  ],
  [
    "scripts/repository/delivery-environment-discovery.mjs",
    ["scripts/goals/repository-housekeeping.test.mjs"],
  ],
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
  ["scripts/verify/white-label.mjs", ["scripts/verify/white-label.test.mjs"]],
  ["scripts/verify/identity-access.mjs", ["scripts/verify/api-security.test.mjs"]],
  ["scripts/verify/source-evidence.mjs", ["scripts/verify/api-security.test.mjs"]],
  ["scripts/verify/localization.mjs", ["scripts/verify/localization.test.mjs"]],
  ["scripts/verify/tenant-isolation.mjs", ["scripts/verify/api-security.test.mjs"]],
  ["scripts/verify/package-manifest.mjs", ["scripts/verify/package-manifest.test.mjs"]],
  ["scripts/verify/pre-push.sh", ["scripts/verify/pre-push.test.mjs"]],
  ["scripts/verify/pre-push-steps.sh", ["scripts/verify/pre-push.test.mjs"]],
  ["scripts/verify/pushed-object-scan.mjs", ["scripts/verify/pushed-object-scan.test.mjs"]],
  [
    "scripts/security/secret-patterns.mjs",
    [
      "scripts/terminal/terminal-output.test.mjs",
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
    "scripts/verify/verification-admission-decision.mjs",
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
      "scripts/framework/framework-version.test.mjs",
      "scripts/goals/goal-publication-precondition.test.mjs",
      "scripts/repository/source-inventory-git-environment.test.mjs",
      "scripts/verify/pre-push.test.mjs",
      "scripts/verify/pushed-object-scan.test.mjs",
      "scripts/verify/verification-git-basis.test.mjs",
    ],
  ],
  [
    "scripts/repository/local-import-resolution.mjs",
    ["scripts/verify/api-security.test.mjs", "scripts/verify/path-hygiene.test.mjs"],
  ],
  [
    "scripts/repository/source-import-specifiers.mjs",
    ["scripts/verify/api-security.test.mjs", "scripts/verify/path-hygiene.test.mjs"],
  ],
  [
    "scripts/repository/product-roots.mjs",
    [
      "scripts/repository/product-roots.test.mjs",
      "scripts/verify/api-security.test.mjs",
      "scripts/verify/path-hygiene.test.mjs",
    ],
  ],
  [
    "scripts/repository/runtime-session-lease.mjs",
    [
      "scripts/context/context-lifecycle.test.mjs",
      "scripts/framework/framework-lifecycle.test.mjs",
      ".agents/skills/reset-framework/scripts/reset-framework.test.mjs",
    ],
  ],
  [
    "scripts/repository/sensitive-paths.mjs",
    [
      "scripts/repository/source-inventory.test.mjs",
      "scripts/verify/pushed-object-scan.test.mjs",
      "scripts/verify/secrets.test.mjs",
    ],
  ],
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
      "scripts/framework/framework-version.test.mjs",
      "scripts/repository/source-inventory-git-environment.test.mjs",
      "scripts/repository/source-inventory.test.mjs",
    ],
  ],
  [
    "scripts/repository/stable-file-snapshot.mjs",
    ["scripts/repository/stable-file-snapshot.test.mjs"],
  ],
  [
    "scripts/repository/validate-transfer-source.mjs",
    ["scripts/repository/source-inventory.test.mjs"],
  ],
  ["scripts/terminal/terminal-output.mjs", ["scripts/terminal/terminal-output.test.mjs"]],
  ["scripts/verify/image-assets.mjs", ["scripts/verify/image-assets.test.mjs"]],
  [
    "scripts/platform/platform-lifecycle-harness.mjs",
    ["scripts/platform/platform-lifecycle.test.mjs"],
  ],
]);
function effectiveCategories(entry, { verifyOnlyRootManifest }) {
  if (entry.path !== "package.json" || !verifyOnlyRootManifest) return entry.categories;
  return ["framework scripts", "verification orchestration", "verify-only root manifest"];
}

function categoryConsumerKeys(categories) {
  const keys = new Set();
  const has = (category) => categories.includes(category);
  const add = (...values) => values.forEach((value) => keys.add(value));

  if (has("active documentation"))
    add("docs", "delivery-environments", "secrets", "language", "path-hygiene");
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
      "localization",
      "patterns",
      "path-hygiene",
      "surface-quality",
      "api-security",
      "identity-access",
      "tenant-isolation",
      "white-label",
    );
  }
  if (has("dependency/package manager files")) {
    add("syntax-lint", "scripts", "repository-smoke", "dependencies", "secrets", "patterns");
  }
  if (has("infrastructure/runtime config")) {
    add(
      "syntax-lint",
      "delivery-environments",
      "secrets",
      "patterns",
      "surface-quality",
      "api-security",
      "identity-access",
      "tenant-isolation",
    );
  }
  if (has("identity/access trust boundary")) {
    add("identity-access", "api-security", "secrets", "patterns");
  }
  if (has("tenant-isolation trust boundary")) {
    add("tenant-isolation", "identity-access", "api-security", "secrets", "patterns");
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

export {
  decideVerificationAdmission,
  omitAlreadyCoveredPaths,
} from "./verification-admission-decision.mjs";

export { isForbiddenFocusedOwner };
