/** Installs reviewed immutable bundles in user storage, with project pins and isolated accounts. */
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  ensureOwnedDirectoryChain,
  removeOwnedArtifact,
  renameOwnedArtifact,
  readOptionalOwnedFile,
} from "../filesystem/owned-file-operations.mjs";
import { prepareUserToolDirectories, userToolPaths } from "../repository/user-tool-storage.mjs";
import { readToolchainConfiguration } from "../contracts/toolchain-configuration.mjs";
import { inspectLinuxOpenRepositoryPaths } from "../repository/runtime-process-identity.mjs";
import {
  prepareProjectToolDirectories,
  projectToolPaths,
} from "../repository/project-tool-environment.mjs";
import { createProjectTemporaryScope } from "../repository/project-temporary-storage.mjs";
import {
  projectManagedToolLayout,
  sealProjectToolBundle,
  verifyProjectToolBundle,
} from "../repository/project-tool-executables.mjs";
import {
  acquireRuntimeLifecycleLock,
  releaseRuntimeLifecycleLock,
  assertRuntimeLifecycleQuiescent,
  currentRuntimeLifecycleCapability,
  retainRuntimeLifecycleLock,
} from "../repository/runtime-session-lease.mjs";
import { inspectRepositoryWorktrees } from "../repository/worktree-recovery.mjs";
import { releaseBytes } from "./toolchain-releases.mjs";

async function archiveBytes(name, version, integrity, fetchImpl) {
  const metadata = JSON.parse(
    (
      await releaseBytes(
        `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`,
        1024 * 1024,
        fetchImpl,
      )
    ).toString("utf8"),
  );
  if (
    metadata.name !== name ||
    metadata.version !== version ||
    metadata.dist?.integrity !== integrity
  )
    throw new Error("Project tool registry metadata differs from the reviewed release.");
  const url = new URL(metadata.dist.tarball);
  if (url.origin !== "https://registry.npmjs.org")
    throw new Error("Project tool archive must come from its reviewed public registry.");
  const bytes = await releaseBytes(url.href, 256 * 1024 * 1024, fetchImpl);
  if (`sha512-${createHash("sha512").update(bytes).digest("base64")}` !== integrity)
    throw new Error("Project tool archive failed its reviewed integrity check.");
  return bytes;
}

/** Uses existing lifecycle exclusion, distribution hashes and immutable version directories. */
export async function installProjectBootstrapTools({
  root,
  matrix,
  run,
  fetchImpl = globalThis.fetch,
  installationOwner,
}) {
  if (!currentRuntimeLifecycleCapability({ root, operation: "toolchain-maintenance" }))
    throw new Error("Project tool installation requires the maintenance lifecycle owner.");
  prepareProjectToolDirectories(root);
  const locations = prepareUserToolDirectories();
  const sharedOwner = installationOwner
    ? retainRuntimeLifecycleLock({
        root: locations.lifecycle,
        owner: installationOwner,
        operation: "toolchain-maintenance",
      })
    : acquireRuntimeLifecycleLock({
        root: locations.lifecycle,
        operation: "toolchain-maintenance",
      });
  try {
    const layout = projectManagedToolLayout(root, matrix);
    for (const tool of [layout.mise, layout.codex]) {
      if (existsSync(tool.directory)) {
        verifyProjectToolBundle(root, tool);
        continue;
      }
      const temporary = createProjectTemporaryScope({
        root: locations.root,
        parent: locations.temporary,
      });
      const stage = temporary.directory;
      try {
        const unpacked = path.join(stage, "package");
        const legacy = legacyProjectTool(root, tool);
        if (existsSync(legacy.directory)) {
          verifyProjectToolBundle(root, legacy);
          cpSync(legacy.directory, unpacked, { recursive: true, errorOnExist: true, force: false });
          verifyProjectToolBundle(root, {
            ...tool,
            directory: unpacked,
            executable: path.join(unpacked, path.relative(tool.directory, tool.executable)),
          });
        } else if (tool.source.kind === "binary") {
          const bytes = await releaseBytes(tool.source.url, 256 * 1024 * 1024, fetchImpl);
          if (`sha256-${createHash("sha256").update(bytes).digest("hex")}` !== tool.integrity)
            throw new Error("Project tool binary failed its reviewed integrity check.");
          const executable = path.join(unpacked, path.relative(tool.directory, tool.executable));
          mkdirSync(path.dirname(executable), { recursive: true, mode: 0o700 });
          writeFileSync(executable, bytes, { mode: 0o755 });
        } else {
          const bytes = await archiveBytes(
            tool.source.name,
            tool.source.version,
            tool.integrity,
            fetchImpl,
          );
          const archive = path.join(stage, "release.tgz");
          writeFileSync(archive, bytes, { mode: 0o600 });
          const tar =
            process.platform === "win32"
              ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
              : "/usr/bin/tar";
          const entries = run(tar, ["-tzf", archive]).split(/\r?\n/u).filter(Boolean);
          const types = run(tar, ["-tvzf", archive]).split(/\r?\n/u).filter(Boolean);
          if (
            !entries.length ||
            entries.length > 4096 ||
            types.length !== entries.length ||
            entries.some(
              (entry) =>
                !/^package\/[A-Za-z0-9._/+@-]*$/u.test(entry) ||
                entry.split("/").some((part) => part === ".." || part === "."),
            ) ||
            types.some((entry) => !/^[d-]/u.test(entry))
          )
            throw new Error("Project tool archive contains unsupported paths or link entries.");
          run(tar, [
            "-xzf",
            archive,
            "--directory",
            stage,
            "--no-same-owner",
            "--no-same-permissions",
          ]);
        }
        if (!lstatSync(unpacked).isDirectory())
          throw new Error("Project tool archive has no package root.");
        sealProjectToolBundle(root, unpacked, tool);
        ensureOwnedDirectoryChain(
          locations.root,
          path.relative(locations.root, path.dirname(tool.directory)),
          "project tool versions",
        );
        renameOwnedArtifact(
          locations.root,
          unpacked,
          tool.directory,
          "directory",
          "verified project tool bundle",
        );
        verifyProjectToolBundle(root, tool);
      } finally {
        if (!temporary.release())
          console.warn(
            "Native tool temporary storage retained for remaining consumers; housekeeping will reconcile it.",
          );
      }
    }
    return { mise: layout.mise.executable, codex: layout.codex.executable };
  } finally {
    releaseRuntimeLifecycleLock({ root: locations.lifecycle, owner: sharedOwner });
  }
}

function legacyProjectTool(root, tool) {
  const directory = path.join(
    projectToolPaths(root).state,
    "tools",
    tool.name,
    tool.version,
    path.basename(tool.directory),
  );
  return {
    ...tool,
    storageRoot: root,
    directory,
    executable: path.join(directory, path.relative(tool.directory, tool.executable)),
  };
}

/** Retires verified legacy repository copies only. Shared versions may serve other projects. */
export function retireReplacedProjectTools({ root, previousMatrix, owner }) {
  if (!owner || currentRuntimeLifecycleCapability({ root }) !== owner)
    throw new Error("Project tool retirement requires its maintenance lifecycle owner.");
  assertRuntimeLifecycleQuiescent({ root, owner });
  const inventory = inspectRepositoryWorktrees({ root });
  if (
    !inventory.complete ||
    inventory.worktrees.some(
      (worktree) => worktree.session.status !== "absent" || worktree.problem || !worktree.available,
    )
  )
    throw new Error("Project tool retirement requires settled, quiescent worktrees.");
  const current = projectManagedToolLayout(root);
  const previous = projectManagedToolLayout(root, previousMatrix);
  for (const name of ["mise", "codex"]) verifyProjectToolBundle(root, current[name]);
  const obsolete = [
    ...new Map(
      [current.mise, current.codex, previous.mise, previous.codex]
        .map((tool) => legacyProjectTool(root, tool))
        .map((tool) => [tool.directory, tool]),
    ).values(),
  ].filter((tool) => existsSync(tool.directory));
  for (const name of ["mise", "codex"]) {
    const parent = path.join(root, ".auth/project-tools/tools", name);
    if (!existsSync(parent)) continue;
    for (const version of readdirSync(parent)) {
      if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(version)) continue;
      const directory = path.join(parent, version, path.basename(current[name].directory));
      if (!existsSync(directory) || obsolete.some((tool) => tool.directory === directory)) continue;
      const receipt = readOptionalOwnedFile(
        root,
        path.join(directory, ".project-installation.json"),
        "legacy native installation",
        { maximumBytes: 1024 * 1024 },
      );
      if (!receipt.exists)
        throw new Error("Legacy native installation needs its verified receipt before retirement.");
      const record = JSON.parse(receipt.buffer.toString("utf8"));
      obsolete.push({
        ...current[name],
        storageRoot: root,
        directory,
        version,
        integrity: record.integrity,
        executable: path.join(
          directory,
          path.relative(current[name].directory, current[name].executable),
        ),
      });
    }
  }
  // Project quiescence grants no authority over shared tool versions or another project's graph.
  for (const tool of obsolete) verifyProjectToolBundle(root, tool);
  assertRuntimeLifecycleQuiescent({ root, owner });
  for (const tool of obsolete) {
    verifyProjectToolBundle(root, tool);
    removeOwnedArtifact(root, tool.directory, "directory", "replaced project tool bundle", {
      expectedIdentity: lstatSync(tool.directory),
    });
  }
  return obsolete.map((tool) => tool.directory);
}

/** Reuses Mise's native project registry for bundle pins; live binaries/libraries also retain a version. */
export function retireUnreferencedUserBundles({ root, projects, owner }) {
  const shared = userToolPaths();
  if (
    !owner ||
    !currentRuntimeLifecycleCapability({
      root: shared.lifecycle,
      operation: "toolchain-maintenance",
    })
  )
    throw new Error("Shared bundle retirement requires its installation lifecycle owner.");
  assertRuntimeLifecycleQuiescent({ root: shared.lifecycle, owner });
  const layout = projectManagedToolLayout(root);
  const matrices = [...new Set([root, ...projects])].map((project) =>
    readToolchainConfiguration(project),
  );
  const removed = [],
    retained = [];
  for (const name of ["mise", "codex"]) {
    const keep = new Set(
      matrices.map((matrix) => matrix.ci[name === "mise" ? "miseVersion" : "codexVersion"]),
    );
    const parent = path.dirname(path.dirname(layout[name].directory));
    for (const version of readdirSync(parent)) {
      if (keep.has(version) || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(version)) continue;
      const directory = path.join(parent, version, path.basename(layout[name].directory));
      if (!existsSync(directory)) continue;
      const active = inspectLinuxOpenRepositoryPaths({
        root: shared.root,
        excludePids: [],
        includeRuntimePaths: true,
        matchesPath: (relative) =>
          path.join(shared.root, relative).startsWith(`${directory}${path.sep}`),
      });
      if (active.status !== "inactive") {
        retained.push(`${name}@${version}: active or unobservable runtime`);
        continue;
      }
      const receipt = readOptionalOwnedFile(
        shared.root,
        path.join(directory, ".project-installation.json"),
        "native installation receipt",
        { maximumBytes: 1024 * 1024 },
      );
      if (!receipt.exists)
        throw new Error("Unreferenced native bundle has no installation receipt.");
      const recorded = JSON.parse(receipt.buffer.toString("utf8"));
      const tool = {
        ...layout[name],
        version,
        directory,
        integrity: recorded.integrity,
        executable: path.join(
          directory,
          path.relative(layout[name].directory, layout[name].executable),
        ),
      };
      verifyProjectToolBundle(root, tool);
      removeOwnedArtifact(shared.root, directory, "directory", "unreferenced native bundle", {
        expectedIdentity: lstatSync(directory),
      });
      removed.push(`${name}@${version}`);
    }
  }
  return { removed, retained };
}
