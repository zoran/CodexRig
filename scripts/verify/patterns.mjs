/** Owns patterns behavior for the repository verification boundary. */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { listActiveFiles, repositoryRoot } from "../repository/source-inventory.mjs";

export const maxExecutableLines = 700;

const executableExtensions = new Set([
  ".c",
  ".cc",
  ".cjs",
  ".cpp",
  ".cs",
  ".cts",
  ".go",
  ".h",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".mjs",
  ".mts",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".swift",
  ".ts",
  ".tsx",
]);
const genericNames = new Set(["common", "helper", "helpers", "misc", "stuff", "utils"]);
const nonMaintainedCodePattern =
  /(?:^|\/)(?:fixtures?|generated|snapshots?)(?:\/|$)|\.(?:fixture|generated|snapshot)\.[^.]+$/i;
const testCorpusPattern = /(?:^|\/)(?:[^/]+\.)?(?:source\.)?(?:spec|test)\.[^/]+$/iu;
const weakHeaderPattern = /\b(?:todo|tbd|fixme|file description|describe this file)\b/iu;
const javascriptExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const javaFamilyExtensions = new Set([".cs", ".java", ".kt", ".kts"]);
const cFamilyExtensions = new Set([".c", ".cc", ".cpp", ".h"]);

export function physicalLineCount(content) {
  if (content === "") return 0;
  return content.split(/\r?\n/).length - (content.endsWith("\n") ? 1 : 0);
}

function isExecutablePath(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  return executableExtensions.has(extension) || relativePath.startsWith("scripts/git-hooks/");
}

export function isMaintainedExecutablePath(relativePath) {
  return isExecutablePath(relativePath) && !nonMaintainedCodePattern.test(relativePath);
}

function headerStartIndex(lines, relativePath) {
  let index = 0;
  if (lines[0]?.startsWith("#!")) index += 1;
  if (path.extname(relativePath).toLowerCase() === ".php" && lines[index]?.trim() === "<?php") {
    index += 1;
  }
  while (lines[index]?.trim() === "") index += 1;
  return index;
}

function isPreambleComment(comment) {
  return /\b(?:spdx-license-identifier|copyright|licensed under|shellcheck|coding[:=]|@ts-check)\b/iu.test(
    comment,
  );
}

function sourceHeader(lines, relativePath) {
  let index = headerStartIndex(lines, relativePath);
  const limit = Math.min(lines.length, index + 20);
  while (index < limit) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      index += 1;
      continue;
    }
    if (line.startsWith("/**") || line.startsWith("/*")) {
      const block = [];
      for (; index < limit; index += 1) {
        block.push(lines[index]);
        if (lines[index].includes("*/")) break;
      }
      if (!block.at(-1)?.includes("*/")) return null;
      const comment = block.join(" ");
      if (!isPreambleComment(comment)) return { endIndex: index, text: comment };
      index += 1;
      continue;
    }
    if (line.startsWith("///") || line.startsWith("//") || line.startsWith("#")) {
      if (!isPreambleComment(line)) return { endIndex: index, text: line };
      index += 1;
      continue;
    }
    if (/^(?:[rubf]*"""|[rubf]*''')/iu.test(line)) {
      return { endIndex: index, text: line };
    }
    return null;
  }
  return null;
}

function headerWords(header) {
  return String(header ?? "")
    .replace(/^\s*(?:\/\*+|\*|\/\/\/?|#|"""|''')\s*/gu, "")
    .replace(/(?:\*\/|"""|''')\s*$/gu, "")
    .trim();
}

function filenameTokens(relativePath) {
  const extension = path.extname(relativePath);
  return path
    .basename(relativePath, extension)
    .replace(/\.(?:source\.)?(?:spec|test)$/iu, "")
    .split(/[^A-Za-z0-9]+/u)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 4 && !genericNames.has(token));
}

function fileHeaderFindings(relativePath, content) {
  const lines = content.split(/\r?\n/u);
  const headerRecord = sourceHeader(lines, relativePath);
  if (!headerRecord) {
    return [
      `${relativePath}: maintained executable file needs a format-native purpose/owner header at the top`,
    ];
  }
  const header = headerWords(headerRecord.text);
  const wordCount = header.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  if (header.length < 36 || wordCount < 6 || weakHeaderPattern.test(header)) {
    return [
      `${relativePath}: file header must meaningfully explain the file purpose and owning boundary`,
    ];
  }
  const tokens = filenameTokens(relativePath);
  if (tokens.length > 0 && !tokens.some((token) => header.toLowerCase().includes(token))) {
    return [
      `${relativePath}: file header no longer names the file's responsibility; update it after the rename or ownership change`,
    ];
  }
  return [];
}

function previousNonemptyIndex(lines, start) {
  for (let index = start - 1; index >= 0; index -= 1) {
    if (lines[index].trim()) return index;
  }
  return -1;
}

function nextNonemptyLine(lines, start) {
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim()) return lines[index].trim();
  }
  return "";
}

function hasLeadingDeclarationDoc(lines, index, sourceHeaderEndIndex) {
  let previousIndex = previousNonemptyIndex(lines, index);
  while (previousIndex >= 0 && /^(?:@|#\[)/u.test(lines[previousIndex].trim())) {
    previousIndex = previousNonemptyIndex(lines, previousIndex);
  }
  if (previousIndex <= sourceHeaderEndIndex) return false;
  const previous = previousIndex >= 0 ? lines[previousIndex].trim() : "";
  return /(?:\*\/|^\/\/\/|^\/\/\s|^#\s)/u.test(previous);
}

function declarationPatterns(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  if (javascriptExtensions.has(extension)) {
    return [
      /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/u,
      /^\s*export\s+(?:declare\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/u,
    ].map((pattern) => ({ pattern, style: "leading" }));
  }
  if (extension === ".py") {
    return [{ pattern: /^\s*class\s+([A-Za-z_][\w]*)\s*(?:\([^)]*\))?\s*:/u, style: "python" }];
  }
  if (extension === ".rs") {
    return [
      {
        pattern: /^\s*pub(?:\([^)]*\))?\s+(?:struct|enum|trait|type)\s+([A-Za-z_][\w]*)/u,
        style: "leading",
      },
    ];
  }
  if (extension === ".go") {
    return [{ pattern: /^\s*type\s+([A-Z][\w]*)\s+/u, style: "leading" }];
  }
  if (javaFamilyExtensions.has(extension)) {
    return [
      {
        pattern:
          /^\s*(?:(?:public|protected|internal|private|abstract|final|sealed|open|data|static|partial)\s+)*(?:class|interface|record|enum)\s+([A-Za-z_][\w]*)/u,
        style: "leading",
      },
    ];
  }
  if (cFamilyExtensions.has(extension)) {
    return [
      {
        pattern: /^\s*(?:typedef\s+)?(?:class|struct|enum)\s+([A-Za-z_][\w]*)/u,
        style: "leading",
      },
    ];
  }
  if (extension === ".swift") {
    return [
      {
        pattern:
          /^\s*(?:(?:public|private|fileprivate|internal|open|final|indirect)\s+)*(?:class|struct|enum|protocol)\s+([A-Za-z_][\w]*)/u,
        style: "leading",
      },
    ];
  }
  if (extension === ".php") {
    return [
      {
        pattern:
          /^\s*(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+([A-Za-z_][\w]*)/u,
        style: "leading",
      },
    ];
  }
  if (extension === ".rb") {
    return [{ pattern: /^\s*class\s+([A-Z][\w:]*)/u, style: "leading" }];
  }
  return [];
}

function declarationDocumentationFindings(relativePath, content) {
  const findings = [];
  const lines = content.split(/\r?\n/u);
  const sourceHeaderEndIndex = sourceHeader(lines, relativePath)?.endIndex ?? -1;
  for (const [index, line] of lines.entries()) {
    for (const { pattern, style } of declarationPatterns(relativePath)) {
      const match = pattern.exec(line);
      if (!match) continue;
      const documented =
        style === "python"
          ? /^(?:[rubf]*"""|[rubf]*''')/iu.test(nextNonemptyLine(lines, index))
          : hasLeadingDeclarationDoc(lines, index, sourceHeaderEndIndex);
      if (!documented) {
        findings.push(
          `${relativePath}:${index + 1}: ${match[1]} needs a declaration-adjacent responsibility/contract description`,
        );
      }
      break;
    }
  }
  return findings;
}

export function analyzeCodePatterns({
  activeFiles = listActiveFiles(),
  readText = (relativePath) =>
    readFileSync(path.join(repositoryRoot, ...relativePath.split("/")), "utf8"),
} = {}) {
  const failures = [];
  const advice = [];
  const caseFoldedPaths = new Map();

  for (const relativePath of activeFiles) {
    if (/[\u0000-\u001f\u007f]/u.test(relativePath)) {
      failures.push(`path contains a control character: ${JSON.stringify(relativePath)}`);
    }
    const folded = relativePath.toLocaleLowerCase("en-US");
    const existing = caseFoldedPaths.get(folded);
    if (existing && existing !== relativePath) {
      failures.push(`case-insensitive path collision: ${existing} and ${relativePath}`);
    } else {
      caseFoldedPaths.set(folded, relativePath);
    }

    if (!isExecutablePath(relativePath)) continue;

    const extension = path.extname(relativePath).toLowerCase();
    const basename = path.basename(relativePath, extension).toLowerCase();
    if (genericNames.has(basename)) {
      advice.push(`${relativePath}: generic module name; confirm the owner is clear`);
    }
    if (!isMaintainedExecutablePath(relativePath)) continue;

    const content = readText(relativePath);
    failures.push(...fileHeaderFindings(relativePath, content));
    failures.push(...declarationDocumentationFindings(relativePath, content));
    const lines = physicalLineCount(content);
    if (!testCorpusPattern.test(relativePath) && lines > maxExecutableLines) {
      failures.push(
        `${relativePath}: ${lines} physical lines; maximum for maintained executable code is ${maxExecutableLines}`,
      );
    }
  }

  return { advice, failures };
}

function main() {
  const { advice, failures } = analyzeCodePatterns();
  if (advice.length > 0) {
    console.log("Code pattern advice:");
    for (const finding of advice) console.log(`- ${finding}`);
  }
  if (failures.length > 0) {
    console.error("Code pattern verification failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("Code pattern verification passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
