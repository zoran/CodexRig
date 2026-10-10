/** Owns framework upgrade io behavior for the framework lifecycle and child upgrade boundary. */
import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { resolveRepositoryPath, sha256 } from "../filesystem/repository-files.mjs";
import { nonPortableTransferPathReason } from "../repository/source-inventory-policy.mjs";
import {
  atomicWriteOwnedFile,
  ensureOwnedDirectoryChain,
  readOptionalOwnedFile,
} from "../filesystem/owned-file-operations.mjs";

export function realUpgradeDirectory(value, label) {
  const resolved = path.resolve(value);
  if (!existsSync(resolved)) throw new Error(`Missing ${label}.`);
  const stats = lstatSync(resolved);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a real directory.`);
  }
  return realpathSync.native(resolved);
}

export function targetUpgradeFileState(root, relativePath) {
  const absolutePath = resolveRepositoryPath(root, relativePath);
  const snapshot = readOptionalOwnedFile(
    root,
    absolutePath,
    `framework upgrade target ${relativePath}`,
  );
  if (!snapshot.exists) return { exists: false, mode: null, sha256: null };
  const content = snapshot.buffer.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(snapshot.buffer)) {
    throw new Error(`Migration requires unchanged valid UTF-8 tool content: ${relativePath}.`);
  }
  return {
    content,
    exists: true,
    mode: snapshot.stats.mode & 0o777,
    sha256: sha256(content),
  };
}

export function ensureUpgradeDirectoryChain(root, relativeDirectory) {
  const ownedRoot = realUpgradeDirectory(root, "framework upgrade target");
  return ensureOwnedDirectoryChain(
    ownedRoot,
    relativeDirectory,
    "framework upgrade output directory",
  );
}

export function atomicWriteUpgradeFile(root, relativePath, content, mode, { testHooks } = {}) {
  ensureUpgradeDirectoryChain(root, path.posix.dirname(relativePath));
  const target = resolveRepositoryPath(root, relativePath);
  return atomicWriteOwnedFile(root, target, content, mode, {
    label: `framework upgrade output ${relativePath}`,
    exactMode: true,
    testHooks,
  });
}

const projectDocuments = new Set(["AGENTS.md", "README.md", "instructions.md", ".codex/README.md"]);
export function isProjectToolPath(file) {
  return (
    !projectDocuments.has(file) &&
    !file.startsWith("docs/") &&
    !file.startsWith("config/") &&
    /^(?:scripts\/|\.agents\/skills\/|\.codex\/|\.codexrig\/|\.github\/workflows\/ci\.yml$|\.gitlab-ci\.yml$|\.gitignore$|\.prettierignore$|\.prettierrc|dependency-policy\.json$|pnpm-(?:lock|workspace)\.yaml$|mise\.(?:lock|toml)$|LICENSE$|NOTICE$)/u.test(
      file,
    )
  );
}

export const reviewedProjectDocuments = Object.freeze([
  "AGENTS.md",
  "instructions.md",
  "README.md",
  ".codex/README.md",
  "docs/project.md",
  "docs/project-context.md",
]);
/** Reviewed migration may reconcile workflow entry documents, never arbitrary product data. */
export function isFrameworkUpgradePath(file) {
  return (
    !nonPortableTransferPathReason(file) &&
    (isProjectToolPath(file) ||
      file === "package.json" ||
      reviewedProjectDocuments.includes(file) ||
      isReviewedProjectPath(file))
  );
}

/** Additional product owners are admitted only by exact, explicitly reviewed public paths. */
export function isReviewedProjectPath(file) {
  if (file === "src/.gitkeep") return true;
  return (
    typeof file === "string" &&
    !nonPortableTransferPathReason(file) &&
    /^(?:docs\/[A-Za-z0-9_./-]+\.(?:md|html)|config\/[A-Za-z0-9_./-]+\.json|scripts\/[A-Za-z0-9_./-]+\.(?:mjs|sh))$/u.test(
      file,
    ) &&
    !file.split("/").some((part) => part === "." || part === ".." || !part)
  );
}
