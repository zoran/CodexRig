/** Owns context budget measurement; byte bounds do not certify agent effectiveness. */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { readRepositoryFile, toolingRoot } from "../filesystem/repository-files.mjs";
import { parsePortableToml } from "../contracts/portable-toml.mjs";

export const contextBudgets = Object.freeze({
  bootstrap: 8192,
  developer: 4096,
  role: 6144,
  skill: 16384,
  metadata: 8192,
  automatic: 32768,
});
const bytes = (text) => Buffer.byteLength(text, "utf8");

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
    return content === null
      ? []
      : [
          {
            file,
            bytes: bytes(content),
            access: "outline and relevant excerpts; never unconditional full text",
          },
        ];
  });
  return {
    automaticBytes: automatic,
    delegatedBytes: delegated,
    skillMetadataBytes: metadata,
    entries,
    references,
    findings,
    evidence:
      "Static repository bytes only; excludes host tools, conversation, native memory and task-specific reads. Semantic audit and representative task evidence remain required.",
  };
}
