/** Owns Markdown headings and local documentation fragment evidence for documentation contracts. */
import path from "node:path";
import { readRegularFrameworkFile } from "../contracts/framework-contract.mjs";
import { markdownBodyForHeadingValidation } from "./document-scope.mjs";

const maximumSectionSpanLines = 200;

/** Extracts inline Markdown destinations outside examples and comments; no document code executes. */
export function markdownFileLinks(content) {
  const lines = [];
  let fenced = false;
  for (const line of String(content)
    .replace(/<!--[\s\S]*?-->/gu, "")
    .split(/\r?\n/u)) {
    if (/^\s*(?:```|~~~)/u.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) lines.push(line.replace(/(`+).*?\1/gu, ""));
  }
  const prose = lines.join("\n");
  const destination = (raw) => /^<([^>]+)>|^([^\s]+)(?:\s+["'].*["'])?$/u.exec(raw.trim());
  const references = [...prose.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)].map((match) => {
    const target = destination(match[1]);
    return target ? (target[1] ?? target[2]) : match[1].trim();
  });
  const normalizeLabel = (label) => label.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
  const definitions = new Map(
    [...prose.matchAll(/^ {0,3}\[([^\]]+)\]:\s*(<[^>]+>|\S+).*$/gmu)].map((match) => [
      normalizeLabel(match[1]),
      match[2].replace(/^<|>$/gu, ""),
    ]),
  );
  const body = prose.replace(/^ {0,3}\[[^\]]+\]:.*$/gmu, "");
  for (const match of body.matchAll(/\[([^\]]+)\](?:\[([^\]]*)\])?(?!\()/gu)) {
    const target = definitions.get(normalizeLabel(match[2] || match[1]));
    if (target) references.push(target);
  }
  return references;
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

export function markdownHeadingContract(relativePath, content) {
  const findings = [];
  const headings = [];
  const lines = markdownLinesAfterFrontmatter(
    markdownBodyForHeadingValidation(relativePath, content),
  );
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

/** Checks static anchors only; it never executes HTML or proves the meaning of a linked passage. */
export function documentFragmentFindings(relativePath, content, fragment) {
  if (!fragment) return [];
  let anchors;
  if (/\.mdx?$/iu.test(relativePath)) {
    anchors = markdownHeadingContract(relativePath, content).anchors;
  } else if (/\.html?$/iu.test(relativePath)) {
    const markup = content.replace(
      /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu,
      "",
    );
    anchors = new Set();
    for (const tag of markup.matchAll(/<([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/giu)) {
      for (const attribute of tag[2].matchAll(
        /(?:^|\s)(id|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/giu,
      )) {
        if (attribute[1].toLowerCase() === "id" || tag[1].toLowerCase() === "a") {
          anchors.add(attribute[2] ?? attribute[3] ?? attribute[4]);
        }
      }
    }
  } else {
    return [`cannot verify a static fragment in ${relativePath}`];
  }
  return anchors.has(fragment) ? [] : [`broken heading reference ${relativePath}#${fragment}`];
}

/** Resolves a project-owned local file link; unsafe paths and symlinks fail before content reads. */
export function resolveDocumentReference({ root, from, reference, fromContent }) {
  const raw = reference.replace(/^<|>$/gu, "");
  if (/^[a-z][a-z0-9+.-]*:|^[/\\]|[?\\\x00-\x1f]/iu.test(raw)) {
    throw new Error("owner reference must name a repository-local file");
  }
  const [encodedPath, ...fragments] = raw.split("#");
  if (fragments.length > 1) throw new Error("owner reference has multiple fragments");
  const target = decodeURIComponent(encodedPath);
  const fragment = decodeURIComponent(fragments[0] ?? "");
  if (/^[a-z][a-z0-9+.-]*:|^[/\\]|[?\\\x00-\x1f]/iu.test(target)) {
    throw new Error("owner reference has an invalid path");
  }
  const relativePath = target
    ? path.posix.normalize(path.posix.join(path.posix.dirname(from), target))
    : from;
  if (relativePath === ".." || relativePath.startsWith("../"))
    throw new Error("owner reference escapes repository");
  const content =
    relativePath === from && fromContent !== undefined
      ? fromContent
      : readRegularFrameworkFile(root, relativePath);
  const findings = documentFragmentFindings(relativePath, content, fragment);
  if (findings.length) throw new Error(findings.join("; "));
  return { path: relativePath, fragment };
}
