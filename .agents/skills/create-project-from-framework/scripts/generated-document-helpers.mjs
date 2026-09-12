/** Owns generated Markdown and file-writing primitives for clean-project identity documents. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const markdownFence = String.fromCharCode(96).repeat(3);

export function markdown(lines) {
  return `${lines.join("\n")}\n`;
}

/** Projects one required level-two source-policy section without rewriting its directives. */
export function requiredInstructionSection(content, heading) {
  const sections = content
    .split(/(?=^## )/mu)
    .filter((section) => section.startsWith(`## ${heading}\n`));
  if (sections.length !== 1) throw new Error(`Source instructions require one ${heading} section.`);
  return sections[0].trimEnd().split("\n");
}

export function escapeMarkdownText(value) {
  return String(value).replace(/[\\`*_{}\[\]<>()#+!|]/gu, "\\$&");
}

export function initialRequirementsDocument(description) {
  if (!description) throw new Error("A requirements draft requires a supplied description.");
  return markdown([
    "# Product Requirements",
    "",
    "This user-provided creation brief is input to the first-start Project Definition Intake. Codex",
    "evaluates it with the user and refines requirements here, preserving this owner; it does",
    "not activate a module or authorize implementation by itself.",
    "",
    ...description.split("\n").map((line) => `> ${escapeMarkdownText(line)}`),
  ]);
}

export function writeRelative(targetRoot, relativePath, content) {
  const targetPath = path.join(targetRoot, ...relativePath.split("/"));
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, "utf8");
}
