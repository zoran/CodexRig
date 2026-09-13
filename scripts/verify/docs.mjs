/** Owns docs behavior for the repository verification boundary. */
import { spawnSyncWithBoundedIo as spawnSync } from "../repository/runtime-process-io.mjs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  isRepositoryProcessMarkdownPath,
  listDocumentationMarkdownFiles,
} from "../docs/document-scope.mjs";
import {
  documentFragmentFindings,
  markdownFileLinks,
  markdownHeadingContract,
} from "../docs/document-references.mjs";
import { futureModuleBacklogHeading } from "../docs/project-manifest-contract.mjs";
import { listActiveFiles, repositoryRoot } from "../repository/source-inventory.mjs";
import { readmeDocumentationFindings } from "../docs/project-document-policy.mjs";

const root = repositoryRoot;
const manifestCheck = spawnSync(
  process.execPath,
  ["scripts/docs/ensure-project-manifest.mjs", "--check"],
  { cwd: root, stdio: "inherit" },
);
if (manifestCheck.status !== 0) process.exit(manifestCheck.status ?? 1);

const failures = [];
failures.push(
  ...readmeDocumentationFindings({
    readme: readFileSync(path.join(root, "README.md"), "utf8"),
    relativePaths: listActiveFiles({ root }),
  }),
);
const agentsBootstrapByteLimit = 24 * 1024;
const documentationPaths = listDocumentationMarkdownFiles();
for (const relativePath of documentationPaths) {
  const content = readFileSync(path.join(root, relativePath), "utf8");
  if (
    relativePath === "AGENTS.md" &&
    Buffer.byteLength(content, "utf8") > agentsBootstrapByteLimit
  ) {
    failures.push(
      `${relativePath}: always-loaded bootstrap exceeds ${agentsBootstrapByteLimit} bytes; move full workflow detail to instructions.md and retain a linked safe-entry summary`,
    );
  }
  const headingContract = markdownHeadingContract(relativePath, content);
  failures.push(...headingContract.findings);
}
for (const relativePath of documentationPaths) {
  const filePath = path.join(root, relativePath);
  const content = readFileSync(filePath, "utf8");
  if (isRepositoryProcessMarkdownPath(relativePath)) {
    failures.push(
      `${relativePath}: repository process documents are not allowed; keep plans, status, reviews, and handoffs in the conversation`,
    );
  }
  const futureHeading = futureModuleBacklogHeading(relativePath, content);
  if (futureHeading) {
    failures.push(
      `${relativePath}: future module candidates belong only in docs/future-modules.md (${futureHeading.trim()})`,
    );
  }
  for (const raw of markdownFileLinks(content)) {
    if (/^(?:https?:|mailto:)/u.test(raw)) continue;
    const [encodedTarget, encodedFragment = ""] = raw.split("#", 2);
    let targetPart;
    let fragment;
    try {
      targetPart = decodeURIComponent(encodedTarget);
      fragment = decodeURIComponent(encodedFragment);
    } catch {
      failures.push(`${relativePath}: link has invalid URL encoding: ${raw}`);
      continue;
    }
    const target = targetPart
      ? path.resolve(path.dirname(filePath), targetPart)
      : path.resolve(filePath);
    const relativeTarget = path.relative(root, target);
    if (
      relativeTarget === ".." ||
      relativeTarget.startsWith(".." + path.sep) ||
      path.isAbsolute(relativeTarget)
    ) {
      failures.push(`${relativePath}: link escapes repository: ${raw}`);
    } else if (!existsSync(target)) {
      failures.push(`${relativePath}: broken link ${raw}`);
    } else if (fragment && /\.(?:mdx?|html?)$/iu.test(target)) {
      const normalizedTarget = relativeTarget.split(path.sep).join("/");
      failures.push(
        ...documentFragmentFindings(normalizedTarget, readFileSync(target, "utf8"), fragment).map(
          (finding) => `${relativePath}: ${finding}`,
        ),
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Documentation verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Documentation verification passed without generating project files.");
