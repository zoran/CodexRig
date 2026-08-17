/** Owns docs behavior for the repository verification boundary. */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  readFrameworkContract,
  readInstallationReceipt,
} from "../contracts/framework-contract.mjs";
import {
  isRepositoryProcessMarkdownPath,
  listDocumentationMarkdownFiles,
} from "../docs/document-scope.mjs";
import { futureModuleBacklogHeading } from "../docs/project-manifest-contract.mjs";
import { repositoryRoot } from "../repository/source-inventory.mjs";

const root = repositoryRoot;
const manifestCheck = spawnSync(
  process.execPath,
  ["scripts/docs/ensure-project-manifest.mjs", "--check"],
  { cwd: root, stdio: "inherit" },
);
if (manifestCheck.status !== 0) process.exit(manifestCheck.status ?? 1);

const failures = [];
const agentsBootstrapByteLimit = 24 * 1024;
const maximumSectionSpanLines = 200;
const frameworkContract = readFrameworkContract(root);
const installationReceipt = readInstallationReceipt(root, frameworkContract, { optional: true });
if (installationReceipt?.pendingReconciliation) {
  failures.push(
    `framework policy reconciliation ${installationReceipt.pendingReconciliation.planDigest} is pending; reconcile its listed concepts into project-owned truth, then acknowledge that exact digest`,
  );
}

function markdownLinesAfterFrontmatter(content) {
  const lines = String(content).split(/\r?\n/u);
  if (lines[0] !== "---") return lines;
  const end = lines.indexOf("---", 1);
  if (end < 0) return lines;
  return lines.slice(end + 1);
}

function headingLabel(raw) {
  return raw
    .replace(/\s+#+\s*$/u, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/<[^>]+>/gu, "")
    .replace(/[`*_~]/gu, "")
    .trim();
}

function headingSlug(label) {
  return label
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-");
}

function markdownHeadingContract(relativePath, content) {
  const findings = [];
  const headings = [];
  const lines = markdownLinesAfterFrontmatter(content);
  let fenced = false;
  for (const [index, line] of lines.entries()) {
    if (/^\s*(?:```|~~~)/u.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
    if (!match) continue;
    const label = headingLabel(match[2]);
    headings.push({ label, level: match[1].length, line: index + 1 });
  }
  if (headings.length === 0) {
    findings.push(`${relativePath}: missing top-level title`);
    return { anchors: new Set(), findings };
  }
  const firstContentLine = lines.find((line) => line.trim());
  if (headings[0].level !== 1 || firstContentLine !== lines[headings[0].line - 1]) {
    findings.push(`${relativePath}: the first document content must be one level-one title`);
  }
  const topLevel = headings.filter((heading) => heading.level === 1);
  if (topLevel.length !== 1) {
    findings.push(
      `${relativePath}: expected exactly one level-one title, found ${topLevel.length}`,
    );
  }
  let previousLevel = 0;
  const anchors = new Set();
  for (const heading of headings) {
    if (!heading.label || /^(?:section|title|todo|tbd|untitled)$/iu.test(heading.label)) {
      findings.push(`${relativePath}:${heading.line}: heading is empty or non-descriptive`);
    }
    if (previousLevel > 0 && heading.level > previousLevel + 1) {
      findings.push(
        `${relativePath}:${heading.line}: heading level jumps from ${previousLevel} to ${heading.level}`,
      );
    }
    previousLevel = heading.level;
    const slug = headingSlug(heading.label);
    if (!slug) {
      findings.push(`${relativePath}:${heading.line}: heading has no referenceable anchor`);
    } else if (anchors.has(slug)) {
      findings.push(`${relativePath}:${heading.line}: duplicate heading anchor #${slug}`);
    } else {
      anchors.add(slug);
    }
  }
  for (const [index, heading] of headings.entries()) {
    const nextHeadingLine = headings[index + 1]?.line ?? lines.length + 1;
    const span = nextHeadingLine - heading.line;
    if (span > maximumSectionSpanLines) {
      findings.push(
        `${relativePath}:${heading.line}: section #${headingSlug(heading.label)} spans ${span} lines; split it into meaningful referenceable subsections`,
      );
    }
  }
  return { anchors, findings };
}

const documentationPaths = listDocumentationMarkdownFiles();
const headingContracts = new Map();
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
  headingContracts.set(relativePath, headingContract);
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
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/gu, "");
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
    } else if (fragment && /\.mdx?$/iu.test(target)) {
      const normalizedTarget = relativeTarget.split(path.sep).join("/");
      const targetContract = headingContracts.get(normalizedTarget);
      if (!targetContract?.anchors.has(fragment)) {
        failures.push(`${relativePath}: broken heading reference ${raw}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Documentation verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Documentation verification passed without generating project files.");
