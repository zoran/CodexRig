/** Owns verification admission behavior for the repository verification boundary. */
import { readVerificationConfiguration } from "./verification-configuration.mjs";
import { existsSync } from "node:fs";
import path from "node:path";
import { root } from "./adaptive-state.mjs";
import {
  changedTestPath,
  commandsByKey,
  consolidateFocusedTestOwners,
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
  categoryConsumerKeys,
  effectiveCategories,
  exactConsumerRegistry,
  ownedCategoryConsumers,
  removedFrameworkSourceConsumers,
} from "./verification-admission-registry.mjs";
const explicitTestConsumerRegistry = new Map(
  Object.entries(readVerificationConfiguration().testConsumers),
);
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

  const removedFrameworkSource =
    categories.includes("framework scripts") &&
    !existsSync(path.join(repositoryRoot, ...entry.path.split("/")));
  if (removedFrameworkSource) {
    const removalCommands = selectCommands(available, removedFrameworkSourceConsumers);
    commands.push(...removalCommands);
    removalCommands.forEach((command) => ownerKeys.add(command.key));
    hasExactOwner = true;
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
    for (const key of ["codex-config", "path-hygiene", "repository-smoke"]) {
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
      // Native-home entries remain excluded data. Their policy owner verifies that exclusion
      // without reading or executing a changed runtime file, including an old basis-only path.
      const isolationCommands = entry.categories.includes("Codex runtime boundary")
        ? selectCommands(available, ownedCategoryConsumers.get("Codex runtime boundary") ?? [])
        : [];
      readOnlyCommands.push(...isolationCommands);
      ownersByPath.push({
        categories: entry.categories,
        ownerKeys: isolationCommands.map((command) => command.key),
        path: entry.path,
      });
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
    ...consolidateFocusedTestOwners({
      ownersByPath,
      commands: readOnlyCommands.map((command) => ({
        ...command,
        phase: "preflight",
        reason: command.reason.startsWith("targeted")
          ? command.reason
          : `targeted current-state coverage: ${command.reason}`,
      })),
    }),
    workspaceCommands: dedupeCommands(workspaceCommands),
  };
}

export {
  decideVerificationAdmission,
  omitAlreadyCoveredPaths,
} from "./verification-admission-decision.mjs";

export { isForbiddenFocusedOwner };
