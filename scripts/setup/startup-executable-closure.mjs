/** Derives the repository-local module closure that must load before Codex starts. */
import { existsSync } from "node:fs";
import path from "node:path";
import {
  normalizeRepositoryPath,
  readRepositoryFile,
  resolveRepositoryPath,
} from "../filesystem/repository-files.mjs";
import { importSpecifiersForFile } from "../repository/source-import-specifiers.mjs";

const maximumClosureFiles = 256;
const moduleCandidates = Object.freeze(["", ".mjs", ".js", ".json"]);
export const startupExecutableEntryPoints = Object.freeze([
  "scripts/context/session-stop-lifecycle.mjs",
  "scripts/setup/session-control-hook-command.mjs",
  "scripts/setup/startup-attestation.mjs",
  "scripts/setup/startup-executable-closure.mjs",
  "scripts/setup/startup-session-controller.mjs",
]);

function resolvedRelativeModule(root, importer, specifier) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  const candidates = [
    ...moduleCandidates.map((extension) => `${base}${extension}`),
    ...moduleCandidates.slice(1).map((extension) => `${base}/index${extension}`),
  ];
  for (const candidate of candidates) {
    let normalized;
    try {
      normalized = normalizeRepositoryPath(candidate, `module imported by ${importer}`);
    } catch {
      continue;
    }
    if (existsSync(resolveRepositoryPath(root, normalized))) return normalized;
  }
  throw new Error(`${importer} imports missing repository module ${specifier}.`);
}

/** Returns the exact repository module graph loaded by the issue-time session controller. */
export function startupExecutableClosurePaths(root) {
  const pending = [...startupExecutableEntryPoints];
  const closure = new Set();
  while (pending.length > 0) {
    const relativePath = normalizeRepositoryPath(pending.pop(), "startup executable path");
    if (closure.has(relativePath)) continue;
    closure.add(relativePath);
    if (closure.size > maximumClosureFiles) {
      throw new Error("Startup executable closure exceeds its reviewed size bound.");
    }
    const content = readRepositoryFile(root, relativePath);
    if (path.posix.extname(relativePath) === ".json") continue;
    for (const specifier of importSpecifiersForFile({ content, relativePath })) {
      if (!specifier.startsWith(".")) continue;
      pending.push(resolvedRelativeModule(root, relativePath, specifier));
    }
  }
  return [...closure].sort();
}
