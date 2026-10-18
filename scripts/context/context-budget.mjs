/** Owns context budget measurement; byte bounds do not certify agent effectiveness. */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { readRepositoryFile, toolingRoot } from "../filesystem/repository-files.mjs";
import { parsePortableToml } from "../contracts/portable-toml.mjs";
import { documentContextSections } from "../docs/document-context.mjs";

export const contextBudgets = Object.freeze({
  bootstrap: 4096,
  developer: 3072,
  role: 4096,
  skill: 16384,
  metadata: 8192,
  automatic: 32768,
  directSection: 8192,
});
const bytes = (text) => Buffer.byteLength(text, "utf8");

/** Measures original source bytes in disjoint direct bodies, including unheaded content. */
export function inspectContextReference(file, content) {
  const lines = content.split("\n");
  const bodies = documentContextSections(file, content);
  const preambleEnd = (bodies[0]?.start ?? lines.length + 1) - 1;
  if (preambleEnd > 0 && content.length > 0)
    bodies.unshift({ heading: "(unheaded content)", start: 1, directEnd: preambleEnd });
  const sections = bodies
    .map(({ heading, start, directEnd }) => ({
      heading,
      start,
      end: directEnd,
      bytes: bytes(
        lines.slice(start - 1, directEnd).join("\n") + (directEnd < lines.length ? "\n" : ""),
      ),
    }))
    .sort((a, b) => b.bytes - a.bytes || a.start - b.start);
  const oversized =
    file === "instructions.md"
      ? sections.filter((section) => section.bytes > contextBudgets.directSection)
      : [];
  const findings = [];
  if (oversized.length) {
    const largest = oversized[0];
    findings.push(
      `${file}: direct-section context exceeds ${contextBudgets.directSection} bytes in ${oversized.length} section(s); largest is "${largest.heading}" at lines ${largest.start}-${largest.end} (${largest.bytes} bytes). Retain essential boundaries and consolidate at the canonical owner.`,
    );
  }
  return {
    reference: {
      file,
      bytes: bytes(content),
      directSectionCount: sections.length,
      largestDirectSectionBytes: sections[0]?.bytes ?? 0,
      largestDirectSections: sections.slice(0, 3),
      access: "outline and relevant direct sections; never unconditional full text",
    },
    findings,
  };
}

export function inspectContextBudget(root = toolingRoot) {
  const findings = [],
    entries = [];
  const record = (file, kind, content) => {
    const size = bytes(content);
    entries.push({ file, kind, bytes: size });
    if (contextBudgets[kind] && size > contextBudgets[kind])
      findings.push(
        `${file}: ${kind} context is ${size} bytes, limit ${contextBudgets[kind]}; retain essential boundaries and route conditional detail to its canonical owner.`,
      );
    return size;
  };
  const bootstrap = record("AGENTS.md", "bootstrap", readRepositoryFile(root, "AGENTS.md"));
  const config = parsePortableToml(
    readRepositoryFile(root, ".codex/config.toml"),
    "context policy",
  );
  const developer = record(".codex/config.toml", "developer", config.developer_instructions ?? "");
  let largestRole = 0;
  for (const role of ["default", "explorer", "worker"]) {
    const file = `.codex/agents/${role}.toml`;
    const policy = parsePortableToml(readRepositoryFile(root, file), file);
    largestRole = Math.max(largestRole, record(file, "role", policy.developer_instructions ?? ""));
  }
  let metadata = 0;
  const skills = path.join(root, ".agents/skills");
  if (existsSync(skills))
    for (const directory of readdirSync(skills, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!directory.isDirectory()) continue;
      const file = `.agents/skills/${directory.name}/SKILL.md`;
      const content = readRepositoryFile(root, file);
      const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
      if (!match) {
        findings.push(`${file}: skill discovery metadata is missing.`);
        continue;
      }
      metadata += bytes(match[1]) + bytes(file);
      record(file, "skill", content);
    }
  if (metadata > contextBudgets.metadata)
    findings.push(
      `Skill discovery metadata exceeds ${contextBudgets.metadata} bytes; narrow descriptions before adding skills.`,
    );
  // CODEX_HOME and the repository root coincide. Account conservatively for both native instruction scopes.
  const automatic = bootstrap * 2 + developer + metadata + 1024;
  const delegated = automatic + largestRole;
  if (automatic > contextBudgets.automatic)
    findings.push(
      `Automatic repository context exceeds ${contextBudgets.automatic} bytes (${automatic}); repeated bootstrap and hook allowance are included.`,
    );
  if (delegated > contextBudgets.automatic)
    findings.push(
      `Delegated repository context exceeds ${contextBudgets.automatic} bytes (${delegated}); inherited automatic context and the largest single role are included.`,
    );
  const references = [
    "instructions.md",
    "README.md",
    "docs/project.md",
    "docs/project-context.md",
  ].flatMap((file) => {
    const content = readRepositoryFile(root, file, { optional: true });
    if (content === null) return [];
    const inspected = inspectContextReference(file, content);
    findings.push(...inspected.findings);
    return [inspected.reference];
  });
  return {
    automaticBytes: automatic,
    delegatedBytes: delegated,
    skillMetadataBytes: metadata,
    entries,
    references,
    findings,
    evidence:
      "Static repository bytes only. Automatic and delegated estimates exclude references and task-specific reads. Direct-section measurements count original source bytes, excluding reader framing; they do not measure a complete task context. Host tools, conversation, native memory and source-code reads are excluded. Semantic audit and representative task evidence remain required.",
  };
}
