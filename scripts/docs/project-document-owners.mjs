/** Owns project document owner declarations and their requirements/UI-reference discovery links. */
import { readRegularFrameworkFile } from "../contracts/framework-contract.mjs";
import { projectManifestPath } from "./document-scope.mjs";
import { resolveDocumentReference } from "./document-references.mjs";

const concerns = ["Requirements owner", "UI reference"];
const nonProductOwners = new Set([
  "README.md",
  "AGENTS.md",
  "instructions.md",
  "docs/future-modules.md",
  "docs/project-context.md",
]);

/**
 * Explicit links are discovery evidence, never product approval or a prose migration instruction.
 * Absence is valid for pending/minimal projects; existing ordinary links still require human discovery.
 */
export function projectDocumentOwners({ root, content } = {}) {
  const manifest =
    content ?? readRegularFrameworkFile(root, projectManifestPath, { optional: true }) ?? "";
  const entries = [];
  const findings = [];
  const declarations = new Map();
  let fenced = false;
  for (const line of manifest.split(/\r?\n/u)) {
    if (/^\s*(?:```|~~~)/u.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^- (Requirements owner|UI reference):\s*(.*?)\s*$/u.exec(line);
    if (!match) continue;
    const [, concern, value] = match;
    if (declarations.has(concern)) {
      findings.push(`docs/project.md has ambiguous duplicate ${concern} declarations`);
      continue;
    }
    declarations.set(concern, value);
    const link = /^\[([^\]]+)\]\((<[^>]+>|[^\s)]+)\)\.?$/u.exec(value);
    if (!link) {
      findings.push(`docs/project.md ${concern} must contain exactly one local Markdown file link`);
      continue;
    }
    try {
      const resolved = resolveDocumentReference({
        root,
        from: projectManifestPath,
        reference: link[2],
        fromContent: manifest,
      });
      if (
        nonProductOwners.has(resolved.path) ||
        resolved.path.startsWith(".codex/") ||
        resolved.path.startsWith(".agents/")
      ) {
        throw new Error(
          "workflow, setup and temporary state cannot own product requirements or UI references",
        );
      }
      if (
        resolved.path === projectManifestPath &&
        (concern !== "Requirements owner" || resolved.fragment !== "definition")
      ) {
        throw new Error("only a minimal Requirements owner may point to the manifest #definition");
      }
      entries.push({ concern, ...resolved });
    } catch (error) {
      findings.push(`docs/project.md ${concern}: ${error.message}`);
    }
  }
  if (entries.length === concerns.length && entries[0].path === entries[1].path) {
    findings.push("Requirements owner and UI reference must name distinct artifacts");
  }
  return { entries, findings };
}
