/** Installs reviewed native tool bundles inside the repository without updating host programs. */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  ensureOwnedDirectoryChain,
  removeOwnedArtifact,
  renameOwnedArtifact,
} from "../filesystem/owned-file-operations.mjs";
import { prepareProjectToolDirectories } from "../repository/project-tool-environment.mjs";
import {
  projectManagedToolLayout,
  sealProjectToolBundle,
  verifyProjectToolBundle,
} from "../repository/project-tool-executables.mjs";
import {
  assertRuntimeLifecycleQuiescent,
  currentRuntimeLifecycleCapability,
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
}) {
  if (!currentRuntimeLifecycleCapability({ root, operation: "toolchain-maintenance" }))
    throw new Error("Project tool installation requires the maintenance lifecycle owner.");
  const locations = prepareProjectToolDirectories(root);
  const layout = projectManagedToolLayout(root, matrix);
  for (const tool of [layout.mise, layout.codex]) {
    if (existsSync(tool.directory)) {
      verifyProjectToolBundle(root, tool);
      continue;
    }
    const stage = mkdtempSync(path.join(locations.temporary, "native-tool-"));
    const stageIdentity = lstatSync(stage);
    try {
      const unpacked = path.join(stage, "package");
      if (tool.source.kind === "binary") {
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
        root,
        path.relative(root, path.dirname(tool.directory)),
        "project tool versions",
      );
      renameOwnedArtifact(
        root,
        unpacked,
        tool.directory,
        "directory",
        "verified project tool bundle",
      );
      verifyProjectToolBundle(root, tool);
    } finally {
      const currentStage = lstatSync(stage);
      // Our own extraction changes directory timestamps and link count. Bind the original inode,
      // then let the cleanup owner verify the current stable snapshot before its atomic claim.
      if (
        !currentStage.isDirectory() ||
        currentStage.isSymbolicLink() ||
        currentStage.dev !== stageIdentity.dev ||
        currentStage.ino !== stageIdentity.ino
      )
        throw new Error("Native tool installation stage was replaced; preserving it.");
      removeOwnedArtifact(root, stage, "directory", "native tool installation stage", {
        expectedIdentity: currentStage,
      });
    }
  }
  return { mise: layout.mise.executable, codex: layout.codex.executable };
}

/** Retires only verified replaced pins after publication, with no living session or owned child. */
export function retireReplacedProjectTools({ root, previousMatrix, owner, run }) {
  if (currentRuntimeLifecycleCapability({ root, operation: "toolchain-maintenance" }) !== owner)
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
  const obsolete = ["mise", "codex"]
    .map((name) => previous[name])
    .filter(
      (tool) => tool.directory !== current[tool.name].directory && existsSync(tool.directory),
    );
  // Validate the complete deletion set before retiring any bootstrap version.
  for (const tool of obsolete) verifyProjectToolBundle(root, tool);
  run(current.mise.executable, ["prune", "--configs", "--yes"]);
  run(current.mise.executable, ["prune", "--tools", "--yes"]);
  assertRuntimeLifecycleQuiescent({ root, owner });
  for (const tool of obsolete) {
    verifyProjectToolBundle(root, tool);
    removeOwnedArtifact(root, tool.directory, "directory", "replaced project tool bundle", {
      expectedIdentity: lstatSync(tool.directory),
    });
  }
  return obsolete.map((tool) => tool.directory);
}
