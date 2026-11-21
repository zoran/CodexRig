/** Checks framework publication source for child-maintenance material in immutable Git objects. */
import path from "node:path";
import { markdownFileLinks } from "../../../../scripts/docs/document-references.mjs";
import {
  isRepositoryProcessArtifactPath,
  projectContextPath,
} from "../../../../scripts/docs/document-scope.mjs";
import { isChildMaintenanceDocument } from "../../../../scripts/framework/framework-upgrade-documents.mjs";
import { nonPortableTransferPathReason } from "../../../../scripts/repository/source-inventory-policy.mjs";
import { inspectPublicationTree } from "../../../../scripts/verify/pushed-object-scan.mjs";

function publicationPathReason({ mode, relativePath }) {
  if (mode !== "100644" && mode !== "100755")
    return "linked files and embedded repositories cannot be published in the source framework";
  if (relativePath.split("/").includes(".auth")) return "private project account or tool state";
  if (relativePath === projectContextPath || isRepositoryProcessArtifactPath(relativePath))
    return "project work notes belong in private maintenance scratch";
  if (
    /(?:^|\/)(?:\.DS_Store|Thumbs\.db)$|\.(?:rej|orig)$|^[^/]+\.(?:patch|diff)$/iu.test(
      relativePath,
    )
  )
    return "loose maintenance or merge artifact; keep reviewed product work in its owning project";
  return nonPortableTransferPathReason(relativePath);
}

function escapesSource(from, reference) {
  let target;
  try {
    target = decodeURIComponent(reference.split(/[?#]/u)[0]).replaceAll("\\", "/");
  } catch {
    return false;
  }
  if (/^file:|^[a-z]:\/|^~\/|^\/(?:home|Users|private|tmp|var\/folders)\//iu.test(target))
    return true;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(target)) return false;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), target));
  return resolved === ".." || resolved.startsWith("../");
}

function publicationContentReason(file, content) {
  if (isChildMaintenanceDocument(content))
    return "child upgrade preview or reconciliation decisions; move the document to maintenance scratch";
  if (
    /(?:\/(?:home|Users)\/|[A-Z]:[\\/]Users[\\/])[\w.-]+[\\/](?:[\w. -]+[\\/]){0,4}(?:dev|projects?|repos|repositories|workspaces?)[\\/][\w.-]+/iu.test(
      content,
    )
  )
    return "literal workstation checkout path; use a repository-relative path or a placeholder";
  if (
    /\.mdx?$/iu.test(file) &&
    markdownFileLinks(content).some((link) => escapesSource(file, link))
  )
    return "documentation links outside this checkout; use a portable reference";
  if (/\.(?:json|ya?ml|toml)$/iu.test(file)) {
    for (const match of content.matchAll(/(?:^|[\s:"'=])(?:file|link):([^\s"',}]+)/gimu)) {
      const target = match[1];
      if (/^[/\\]|^~[/\\]|^[A-Z]:[/\\]/iu.test(target) || escapesSource(file, target))
        return "local dependency points outside this checkout";
    }
  }
  for (const match of content.matchAll(
    /(?:^|\s)--(?:target|baseline|reconcile)(?:\s+|=)(?:"([^"]+)"|'([^']+)'|([^\s"'<>]+))/gmu,
  )) {
    const target = match[1] ?? match[2] ?? match[3];
    if (
      !/[$<>]/u.test(target) &&
      (/^[/\\]|^~[/\\]|^[A-Z]:[/\\]/iu.test(target) || escapesSource("README.md", target))
    )
      return "literal external maintenance target; use a project path placeholder";
  }
  return null;
}

export async function assertCleanFrameworkPublicationSource(options) {
  const findings = await inspectPublicationTree({
    ...options,
    inspectPath: publicationPathReason,
    wantsContent: (file) =>
      !path.posix.extname(file) ||
      /\.(?:mdx?|txt|log|out|json|ya?ml|toml|[cm]?[jt]sx?|sh|patch|diff)$/iu.test(file),
    inspectContent: publicationContentReason,
  });
  if (findings.length)
    throw new Error(
      ["Framework publication contains child-maintenance or nonportable source:", ...findings].join(
        "\n",
      ),
    );
}
