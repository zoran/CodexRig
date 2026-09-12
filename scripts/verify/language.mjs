/** Owns language behavior for the repository verification boundary. */
import { closeSync, openSync, readSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { listActiveFiles, repositoryRoot } from "../repository/source-inventory.mjs";

const policyTextExtensions = new Set([".md", ".txt", ".toml", ".yaml", ".yml"]);
const germanMarkers = [
  "aktuell",
  "bitte",
  "deutsch",
  "dokumentation",
  "frage",
  "inhalt",
  "keine",
  "nicht",
  "oder",
  "quelltext",
  "schritt",
  "skript",
  "soll",
  "verwende",
  "werden",
  "wird",
  "ziel",
];
const markerPattern = new RegExp("\\b(" + germanMarkers.join("|") + ")\\b", "i");
const germanCharacterPattern = /[\u00c4\u00d6\u00dc\u00e4\u00f6\u00fc\u00df]/;

function isPolicyText(relativePath) {
  const extension = path.extname(relativePath);
  return (
    ["AGENTS.md", "README.md", "instructions.md", "scripts/README.md"].includes(relativePath) ||
    relativePath.startsWith("docs/") ||
    (relativePath.startsWith(".agents/skills/") && policyTextExtensions.has(extension))
  );
}

function inspectLine(relativePath, line, lineNumber, failures) {
  // Reference addresses are identifiers, not prose; translating them would break source links.
  line = line.replace(/https?:\/\/[^\s<>"'`]+/gu, "");
  if (germanCharacterPattern.test(line)) {
    failures.push(`${relativePath}:${lineNumber}: contains a German-specific character`);
    return;
  }
  const marker = line.match(markerPattern)?.[0];
  if (marker) {
    failures.push(`${relativePath}:${lineNumber}: contains German marker '${marker}'`);
  }
}

function scanPolicyText(root, relativePath, failures) {
  const descriptor = openSync(path.join(root, relativePath), "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const decoder = new TextDecoder("utf-8");
  let pending = "";
  let lineNumber = 0;
  try {
    for (;;) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      const content = pending + decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
      const lines = content.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) inspectLine(relativePath, line, ++lineNumber, failures);
    }
    pending += decoder.decode();
    if (pending) inspectLine(relativePath, pending, ++lineNumber, failures);
  } finally {
    closeSync(descriptor);
  }
}

/** Returns policy-prose findings for one repository, preserving original file and line locations. */
export function languageVerificationFindings({ root = repositoryRoot } = {}) {
  const failures = [];
  for (const relativePath of listActiveFiles({ root }).filter(isPolicyText)) {
    scanPolicyText(root, relativePath, failures);
  }
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const failures = languageVerificationFindings();
  if (failures.length > 0) {
    console.error("Language verification failed for framework policy and documentation:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("Framework policy and documentation language verification passed.");
  }
}
