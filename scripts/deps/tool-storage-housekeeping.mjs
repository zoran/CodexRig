/** Owns tool storage housekeeping through native collectors and quiescent legacy retirement. */
import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { validateMinimalMiseTools } from "../contracts/mise-toolchain-configuration.mjs";
import { readRepositoryFile } from "../filesystem/repository-files.mjs";
import { ensureOwnedPrivateDirectory } from "../filesystem/owned-path-safety.mjs";
import {
  projectToolEnvironment,
  projectToolPaths,
} from "../repository/project-tool-environment.mjs";
import {
  projectManagedToolLayout,
  verifyProjectToolBundle,
} from "../repository/project-tool-executables.mjs";
import {
  userToolPaths,
  assertUserToolParents,
  prepareMiseTracking,
  trackedToolProjects,
  deferredMiseTrackingErrorCode,
} from "../repository/user-tool-storage.mjs";
import { inspectRepositoryWorktrees } from "../repository/worktree-recovery.mjs";
import { inspectLinuxOpenRepositoryPaths } from "../repository/runtime-process-identity.mjs";
import { reconcileProjectTemporaryStorage } from "../repository/project-temporary-storage.mjs";
import {
  acquireRuntimeLifecycleLock,
  currentRuntimeLifecycleCapability,
  releaseRuntimeLifecycleLock,
  retainRuntimeLifecycleLock,
} from "../repository/runtime-session-lease.mjs";
import { spawnRuntimeLifecycleCommandSync } from "../repository/runtime-lifecycle-process.mjs";
import { assertTrustedPnpmConfiguration } from "../repository/pnpm-workspace-manifests.mjs";
import { formatContextError, sanitizeForTerminal } from "../terminal/terminal-output.mjs";
import { assertInstalledProjectTools } from "./project-runtime-admission.mjs";
import {
  retireReplacedProjectTools,
  retireUnreferencedUserBundles,
} from "./project-tool-installation.mjs";

/** Old native tools used permissive modes inside private homes. Repair only these known paths. */
function prepareLegacyDirectory(root, privateParent, segments) {
  ensureOwnedPrivateDirectory(root, privateParent, "private legacy tool parent", {
    repairMode: false,
  });
  let directory = privateParent;
  for (const segment of segments) {
    directory = path.join(directory, segment);
    ensureOwnedPrivateDirectory(root, directory, "legacy native tool directory");
  }
}

/** No installs, downloads, version refresh, project tests or guessed filesystem eviction. */
export function reconcileToolStorage({
  root,
  apply = false,
  owner,
  installationOwner,
  runNative,
} = {}) {
  const report = { actions: [], deferred: [] };
  if (!existsSync(path.join(root, ".codex/toolchain.json"))) return report;
  const local = projectToolPaths(root);
  const shared = userToolPaths();
  const legacy = [path.join(local.state, "tools"), path.join(local.data, "mise", "installs")];
  if (!apply) {
    report.deferred.push(...legacy.filter(existsSync).map((p) => path.relative(root, p)));
    return report;
  }
  if (!owner || currentRuntimeLifecycleCapability({ root }) !== owner)
    throw new Error("Tool storage housekeeping requires the existing repository lifecycle owner.");
  const environment = projectToolEnvironment({ root });
  const layout = projectManagedToolLayout(root);
  verifyProjectToolBundle(root, layout.mise);
  verifyProjectToolBundle(root, layout.codex);
  assertTrustedPnpmConfiguration({ repositoryRoot: root });
  assertInstalledProjectTools({ root, miseExecutable: layout.mise.executable, environment });
  const inventory = inspectRepositoryWorktrees({ root });
  const quiescent =
    inventory.complete &&
    inventory.worktrees.every((w) => w.available && !w.problem && w.session.status === "absent");
  const sharedOwner = installationOwner
    ? retainRuntimeLifecycleLock({
        root: shared.lifecycle,
        owner: installationOwner,
        operation: "toolchain-maintenance",
      })
    : acquireRuntimeLifecycleLock({ root: shared.lifecycle, operation: "toolchain-maintenance" });
  const run = (command, args, overrides = {}) => {
    const options = {
      cwd: root,
      env: { ...environment, ...overrides },
      encoding: "utf8",
      input: "",
      stdio: "pipe",
    };
    const result = runNative
      ? runNative(command, args, options)
      : spawnRuntimeLifecycleCommandSync({
          repositoryRoot: root,
          lifecycleCapability: owner,
          command,
          args,
          options,
          role: "storage-housekeeping",
        });
    if (result.error || result.status !== 0)
      throw new Error(
        `Native storage cleanup failed (${path.basename(command)} ${args[0]}): ${formatContextError(result.error?.message || result.stderr || result.stdout || `exit ${result.status}`, root)}`,
      );
    return String(result.stdout ?? "");
  };
  try {
    for (const scope of reconcileProjectTemporaryStorage({
      root: shared.root,
      parent: shared.temporary,
      apply: true,
    })) {
      if (scope.status === "removed")
        report.actions.push("reclaimed abandoned shared installer staging");
      else if (scope.reason !== "active owner" && scope.reason !== "active consumers")
        throw new Error(
          "Shared installer staging has unresolved ownership; retained for owner reconciliation.",
        );
    }
    const tracked = prepareMiseTracking(root, { migrate: quiescent });
    if (tracked) {
      // Native tracking is the sole cross-project reference source, not a second installation ledger.
      let projects;
      try {
        projects = trackedToolProjects();
      } catch (error) {
        if (error.code !== deferredMiseTrackingErrorCode) throw error;
        // This typed diagnostic contains only public project paths and fixed admission reasons,
        // not native output or configuration contents. Keep the actionable path visible.
        report.deferred.push(
          `${sanitizeForTerminal(error.message)}; shared runtime versions, tool bundles and account state are retained`,
        );
      }
      if (projects) {
        if (!projects.includes(root))
          throw new Error("Shared cleanup requires the current native Mise project reference.");
        run(layout.mise.executable, ["prune", "--yes"]);
        report.actions.push("mise: unreferenced shared runtime versions");
        const bundles = retireUnreferencedUserBundles({ root, projects, owner: sharedOwner });
        report.actions.push(...bundles.removed.map((value) => `retired shared ${value}`));
        report.deferred.push(...bundles.retained);
      }
    } else
      report.deferred.push(
        "shared runtime versions: waiting for quiescent native reference migration",
      );
    // Explicit paths defeat workspace store/cache overrides. Native pnpm owns reference tracking
    // across projects; never --force, remove links/ ourselves, or clear the whole shared store.
    if (existsSync(shared.pnpmStore)) {
      assertUserToolParents(shared.root, path.join(shared.pnpmStore, "entry"));
      run(layout.pnpm.executable, [
        "store",
        "prune",
        "--store-dir",
        shared.pnpmStore,
        `--config.cache-dir=${shared.pnpmCache}`,
        "--config.ignore-pnpmfile=true",
      ]);
      report.actions.push("pnpm: unreferenced shared packages");
    }
    for (const cache of [shared.miseCache, path.join(local.cache, "mise")]) {
      if (!existsSync(cache)) continue;
      if (cache !== shared.miseCache) prepareLegacyDirectory(root, local.cache, ["mise"]);
      assertUserToolParents(
        cache === shared.miseCache ? shared.root : root,
        path.join(cache, "entry"),
      );
      run(layout.mise.executable, ["cache", "prune"], { MISE_CACHE_DIR: cache });
      report.actions.push("mise: expired cache entries");
    }
    // npm's own collector retains referenced content and rotates its logs; no blanket cache purge.
    for (const cache of [shared.npmCache, path.join(local.cache, "npm")]) {
      if (!existsSync(path.join(cache, "_cacache"))) continue;
      if (cache !== shared.npmCache) prepareLegacyDirectory(root, local.cache, ["npm"]);
      assertUserToolParents(
        cache === shared.npmCache ? shared.root : root,
        path.join(cache, "entry"),
      );
      run(layout.mise.executable, ["exec", "--locked", "--", "npm", "cache", "verify"], {
        NPM_CONFIG_CACHE: cache,
      });
      report.actions.push("npm: unreferenced cache content");
    }
    if (!quiescent) {
      report.deferred.push(
        ...legacy
          .filter(existsSync)
          .map((p) => `${path.relative(root, p)}: waiting for repository sessions to exit`),
      );
      return report;
    }
    const open = inspectLinuxOpenRepositoryPaths({
      root,
      excludePids: [],
      includeRuntimePaths: true,
      matchesPath: (relative) =>
        legacy.some(
          (p) =>
            path.join(root, relative) === p ||
            path.join(root, relative).startsWith(`${p}${path.sep}`),
        ),
    });
    if (open.status !== "inactive") {
      report.deferred.push("legacy installations: active or unobservable runtime consumers");
      return report;
    }
    report.actions.push(
      ...retireReplacedProjectTools({ root, owner }).map(
        (p) => `retired ${path.relative(root, p)}`,
      ),
    );
    const legacyData = path.join(local.data, "mise");
    if (existsSync(path.join(legacyData, "installs"))) {
      prepareLegacyDirectory(root, local.data, ["mise", "installs"]);
      assertUserToolParents(root, path.join(legacyData, "installs", "entry"));
      const configured = validateMinimalMiseTools(readRepositoryFile(root, ".codex/mise.toml"));
      if (configured.errors.length)
        throw new Error("Legacy retirement requires valid exact tool pins.");
      const installed = JSON.parse(
        run(layout.mise.executable, ["ls", "--installed", "--json"], { MISE_DATA_DIR: legacyData }),
      );
      for (const [name, entries] of Object.entries(installed)) {
        if (!Object.hasOwn(configured.versionLists, name)) {
          report.deferred.push(`legacy ${name}: no current declared replacement`);
          continue;
        }
        if (!Array.isArray(entries)) throw new Error("Legacy tool inventory is invalid.");
        for (const entry of entries) {
          if (!entry.installed) continue;
          if (!/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/u.test(entry.version ?? ""))
            throw new Error("Legacy tool version is invalid.");
          const directory = path.join(legacyData, "installs", name, entry.version);
          if (
            entry.install_path !== directory ||
            realpathSync.native(directory) !== directory ||
            !lstatSync(directory).isDirectory()
          )
            throw new Error("Legacy tool inventory escaped its installation root.");
          run(
            layout.mise.executable,
            ["uninstall", "--yes", `${name}@${path.basename(directory)}`],
            {
              MISE_DATA_DIR: legacyData,
              MISE_CACHE_DIR: path.join(local.cache, "mise"),
            },
          );
          if (existsSync(directory))
            throw new Error("Native legacy tool retirement did not remove the installation.");
          report.actions.push(`retired legacy ${name}@${entry.version}`);
        }
      }
    }
    const legacyStore = path.join(local.data, "pnpm", "store");
    if (existsSync(legacyStore)) {
      prepareLegacyDirectory(root, local.data, ["pnpm", "store"]);
      assertUserToolParents(root, path.join(legacyStore, "entry"));
      run(layout.pnpm.executable, [
        "store",
        "prune",
        "--store-dir",
        legacyStore,
        `--config.cache-dir=${shared.pnpmCache}`,
        "--config.ignore-pnpmfile=true",
      ]);
      report.actions.push("pnpm: unreferenced legacy packages");
    }
    return report;
  } finally {
    releaseRuntimeLifecycleLock({ root: shared.lifecycle, owner: sharedOwner });
  }
}
