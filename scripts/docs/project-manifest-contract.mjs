/** Owns project manifest contract behavior for the durable documentation contract boundary. */
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  discoverProductLayout,
  isProductImplementationPath,
  normalizeProductPath,
} from "../repository/product-roots.mjs";
import { isReusableFrameworkSource } from "../contracts/framework-contract.mjs";
import { listActiveFiles, repositoryRoot } from "../repository/source-inventory.mjs";
import { deliveryManifestFindings } from "./delivery-manifest.mjs";
import { projectDocumentOwners } from "./project-document-owners.mjs";

export const manifestAuthorityPreamble =
  "Agent workflow authority: `instructions.md`. Optional project context cannot override this manifest.";

export const activeModuleInventoryHeading = "### Active Module Inventory";
export const noActiveModulesStatement = "No active product modules.";
export const futureModulesPreamble =
  "This is the single non-authoritative home for unimplemented module ideas. Entries are candidates, not scope, commitments, active modules, or authorization to implement them.";
export const futureModulesActivationRule =
  "Move a candidate into `docs/project.md` only in the same change that implements and integrates its real module root, runtime technology, contract, data and tenant-isolation ownership, dependencies, and verifier; remove the candidate here then.";
export const futureModulesIntentRule =
  "Record only explicitly confirmed future candidates. If current-versus-future intent is ambiguous, ask the developer; until clarified, do not implement the idea or change either inventory.";
export const noFutureModulesStatement = "No future module candidates are currently recorded.";

export function initialFutureModulesDocument() {
  return `# Future Modules

${futureModulesPreamble}

${futureModulesActivationRule}

${futureModulesIntentRule}

Link detailed requirements at their established owner; this candidate/activation index does not duplicate a specification.

## Candidates

${noFutureModulesStatement}
`;
}

const moduleFields = Object.freeze([
  "Root",
  "Responsibility",
  "Runtime and technology",
  "Public contract",
  "Private internals",
  "Owned data and migrations",
  "Tenant isolation",
  "Allowed dependencies",
  "Focused verifier",
  "Steward",
]);
const futureCandidateFields = Object.freeze([
  "Potential outcome",
  "Why deferred",
  "Activation evidence",
]);
const futureOnlyLanguage =
  /\b(?:backlog|candidate|eventually|future|later|not implemented|planned|proposed|roadmap|someday|tbd|todo|upcoming)\b/iu;

function sectionLines(content, heading) {
  const lines = String(content).split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return null;
  const headingLevel = /^(#{1,6})\s/u.exec(heading)?.[1].length;
  if (!headingLevel) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const nextHeading = /^(#{1,6})\s+/u.exec(lines[index]);
    if (nextHeading && nextHeading[1].length <= headingLevel) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

function parsedFieldBlock(lines, label, expectedFields = moduleFields) {
  const values = new Map();
  let current = null;
  for (const line of lines) {
    const field = /^- ([^:]+):\s*(.*)$/u.exec(line);
    if (field) {
      current = field[1].trim();
      if (values.has(current)) return { duplicate: current, values };
      values.set(current, field[2].trim());
      continue;
    }
    if (/^\s{2,}\S/u.test(line) && current) {
      values.set(current, `${values.get(current)} ${line.trim()}`.trim());
      continue;
    }
    if (line.trim()) return { unexpected: line.trim(), values };
  }
  const missing = expectedFields.filter((field) => !values.get(field)?.trim());
  const unknown = [...values.keys()].filter((field) => !expectedFields.includes(field));
  return { label, missing, unknown, values };
}

export function parseActiveModuleInventory(content) {
  const lines = sectionLines(content, activeModuleInventoryHeading);
  const findings = [];
  if (!lines) {
    return {
      entries: [],
      findings: [`docs/project.md must contain ${activeModuleInventoryHeading}`],
    };
  }
  const section = lines.join("\n").trim();
  if (futureOnlyLanguage.test(section)) {
    findings.push(
      "docs/project.md active module inventory contains future-only language; move the candidate to docs/future-modules.md",
    );
  }
  const headingIndexes = [];
  for (const [index, line] of lines.entries()) {
    if (/^####\s+\S/u.test(line)) headingIndexes.push(index);
  }
  if (headingIndexes.length === 0) {
    if (section !== noActiveModulesStatement) {
      findings.push(
        `docs/project.md active module inventory must contain module entries or exactly "${noActiveModulesStatement}"`,
      );
    }
    return { entries: [], findings };
  }
  if (section.includes(noActiveModulesStatement)) {
    findings.push(
      "docs/project.md cannot declare both no active modules and active module entries",
    );
  }
  if (lines.slice(0, headingIndexes[0]).some((line) => line.trim())) {
    findings.push(
      "docs/project.md active module inventory has unexpected text before its first module",
    );
  }

  const entries = [];
  for (const [position, start] of headingIndexes.entries()) {
    const end = headingIndexes[position + 1] ?? lines.length;
    const name = lines[start]
      .replace(/^####\s+/u, "")
      .trim()
      .replace(/^`|`$/gu, "");
    const parsed = parsedFieldBlock(lines.slice(start + 1, end), name);
    if (parsed.duplicate) {
      findings.push(`module ${name} duplicates field ${parsed.duplicate}`);
      continue;
    }
    if (parsed.unexpected) {
      findings.push(`module ${name} contains unexpected inventory text: ${parsed.unexpected}`);
      continue;
    }
    if (parsed.missing.length > 0) {
      findings.push(`module ${name} is missing fields: ${parsed.missing.join(", ")}`);
    }
    if (parsed.unknown.length > 0) {
      findings.push(`module ${name} has unknown fields: ${parsed.unknown.join(", ")}`);
    }
    const rootValue = parsed.values.get("Root") ?? "";
    const rootMatch = /^`([^`]+)`$/u.exec(rootValue);
    const moduleRoot = normalizeProductPath(rootMatch?.[1]);
    if (!rootMatch || !moduleRoot) {
      findings.push(`module ${name} Root must be one repository-relative directory in backticks`);
    }
    const verifier = parsed.values.get("Focused verifier") ?? "";
    if (!/`[^`]+`/u.test(verifier)) {
      findings.push(`module ${name} Focused verifier must name an executable command in backticks`);
    }
    entries.push({
      fields: Object.fromEntries(parsed.values),
      name,
      root: moduleRoot,
    });
  }
  const duplicateNames = entries
    .map((entry) => entry.name)
    .filter((name, index, names) => names.indexOf(name) !== index);
  const duplicateRoots = entries
    .map((entry) => entry.root)
    .filter(Boolean)
    .filter((root, index, roots) => roots.indexOf(root) !== index);
  if (duplicateNames.length > 0) {
    findings.push(`active module names must be unique: ${[...new Set(duplicateNames)].join(", ")}`);
  }
  if (duplicateRoots.length > 0) {
    findings.push(`active module roots must be unique: ${[...new Set(duplicateRoots)].join(", ")}`);
  }
  return { entries, findings };
}

function realModuleDirectory(root, relativePath) {
  if (!relativePath) return false;
  const absoluteRoot = realpathSync.native(root);
  let cursor = absoluteRoot;
  for (const segment of relativePath.split("/")) {
    cursor = path.join(cursor, segment);
    if (!existsSync(cursor) || lstatSync(cursor).isSymbolicLink()) return false;
  }
  if (!lstatSync(cursor).isDirectory()) return false;
  const relative = path.relative(absoluteRoot, realpathSync.native(cursor));
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function covers(moduleRoot, filePath) {
  return filePath === moduleRoot || filePath.startsWith(`${moduleRoot}/`);
}

const runtimeTechnologySignals = Object.freeze([
  { extensions: [".c"], label: "C", pattern: /(?:^|\W)C(?:\W|$)/u },
  { extensions: [".cc", ".cpp", ".cxx"], label: "C++", pattern: /C\+\+/u },
  { extensions: [".cs"], label: "C#", pattern: /C#|\.NET/iu },
  { extensions: [".go"], label: "Go", pattern: /\bGo\b/u },
  { extensions: [".java"], label: "Java", pattern: /\bJava\b/u },
  {
    extensions: [".cjs", ".js", ".jsx", ".mjs"],
    label: "JavaScript/Node.js",
    pattern: /\b(?:JavaScript|Node\.js|Node)\b/iu,
  },
  { extensions: [".kt", ".kts"], label: "Kotlin", pattern: /\bKotlin\b/iu },
  { extensions: [".php"], label: "PHP", pattern: /\bPHP\b/iu },
  { extensions: [".py"], label: "Python", pattern: /\bPython\b/iu },
  { extensions: [".rb"], label: "Ruby", pattern: /\bRuby\b/iu },
  { extensions: [".rs"], label: "Rust", pattern: /\bRust\b/iu },
  {
    extensions: [".cts", ".mts", ".ts", ".tsx"],
    label: "TypeScript",
    pattern: /\bTypeScript\b/iu,
  },
]);

function runtimeTechnologyFindings(entry, implementationFiles) {
  const value = entry.fields["Runtime and technology"] ?? "";
  const findings = [];
  if (/\b(?:pending|tbd|todo|unknown|undecided)\b/iu.test(value)) {
    findings.push(`active product module ${entry.name} cannot have pending runtime technology`);
  }
  const extensions = new Set(
    implementationFiles
      .filter((filePath) => covers(entry.root, filePath))
      .map((filePath) => path.posix.extname(filePath).toLowerCase()),
  );
  for (const signal of runtimeTechnologySignals) {
    if (
      signal.extensions.some((extension) => extensions.has(extension)) &&
      !signal.pattern.test(value)
    ) {
      findings.push(
        `active product module ${entry.name} Runtime and technology does not name detected ${signal.label}`,
      );
    }
  }
  return findings;
}

function architectureSourcePath(relativePath) {
  return (
    /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/u.test(relativePath) &&
    !/(?:^|\/)(?:[^/]+\.)?(?:source\.)?test\.[^/]+$/u.test(relativePath) &&
    !/(?:test-(?:cases|helpers)|-harness)\.[^/]+$/u.test(relativePath)
  );
}

function relativeImportSpecifiers(content) {
  const specifiers = new Set();
  const patterns = [
    /\b(?:export|import)\s+(?:[^;"']*?\s+from\s+)?["'](\.[^"']+)["']/gu,
    /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/gu,
    /\brequire\s*\(\s*["'](\.[^"']+)["']\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of String(content).matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

function declaredModuleDependencies(entry, entries, findings) {
  const value = entry.fields["Allowed dependencies"]?.trim() ?? "";
  const roots = [...value.matchAll(/`([^`]+)`/gu)]
    .map((match) => normalizeProductPath(match[1]))
    .filter(Boolean);
  if (roots.length === 0 && !/^none[.!]?$/iu.test(value)) {
    findings.push(
      `module ${entry.name} Allowed dependencies must be exactly None or list module roots in backticks`,
    );
  }
  for (const dependencyRoot of roots) {
    if (dependencyRoot === entry.root) {
      findings.push(`module ${entry.name} cannot declare itself as a dependency`);
    } else if (!entries.some((candidate) => candidate.root === dependencyRoot)) {
      findings.push(
        `module ${entry.name} declares an unknown module dependency: ${dependencyRoot}`,
      );
    }
  }
  return new Set(roots);
}

function moduleDependencyFindings({ entries, implementationFiles, root }) {
  const findings = [];
  const entriesByRoot = new Map(
    entries.filter((entry) => entry.root).map((entry) => [entry.root, entry]),
  );
  const orderedEntries = [...entriesByRoot.values()].sort(
    (left, right) => right.root.length - left.root.length,
  );
  const actualDependencies = new Map(orderedEntries.map((entry) => [entry.root, new Set()]));
  const declaredDependencies = new Map();

  for (const relativePath of implementationFiles.filter(architectureSourcePath)) {
    const sourceOwner = orderedEntries.find((entry) => covers(entry.root, relativePath));
    if (!sourceOwner) continue;
    const absolutePath = path.join(root, ...relativePath.split("/"));
    if (!existsSync(absolutePath) || !lstatSync(absolutePath).isFile()) continue;
    for (const specifier of relativeImportSpecifiers(readFileSync(absolutePath, "utf8"))) {
      const targetPath = normalizeProductPath(
        path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), specifier)),
      );
      const targetOwner = orderedEntries.find((entry) => covers(entry.root, targetPath));
      if (targetOwner && targetOwner.root !== sourceOwner.root) {
        actualDependencies.get(sourceOwner.root).add(targetOwner.root);
      }
    }
  }

  for (const entry of orderedEntries) {
    const declared = declaredModuleDependencies(entry, orderedEntries, findings);
    declaredDependencies.set(entry.root, declared);
    const actual = actualDependencies.get(entry.root) ?? new Set();
    for (const dependencyRoot of actual) {
      if (!declared.has(dependencyRoot)) {
        findings.push(
          `module ${entry.name} imports undeclared module dependency ${dependencyRoot}`,
        );
      }
    }
  }

  function dependencyCycleFindings(dependencies, label) {
    const cycles = [];
    const active = [];
    const completed = new Set();
    function visit(moduleRoot) {
      if (completed.has(moduleRoot)) return;
      const cycleStart = active.indexOf(moduleRoot);
      if (cycleStart >= 0) {
        cycles.push(`${label}: ${[...active.slice(cycleStart), moduleRoot].join(" -> ")}`);
        return;
      }
      active.push(moduleRoot);
      for (const dependencyRoot of dependencies.get(moduleRoot) ?? []) visit(dependencyRoot);
      active.pop();
      completed.add(moduleRoot);
    }
    for (const moduleRoot of dependencies.keys()) visit(moduleRoot);
    return cycles;
  }
  findings.push(
    ...dependencyCycleFindings(declaredDependencies, "declared module dependency cycle"),
    ...dependencyCycleFindings(actualDependencies, "active module dependency cycle"),
  );
  return findings;
}

function sourceFrameworkCapabilityRoots(activeFiles, root) {
  if (!isReusableFrameworkSource(root)) return [];

  const roots = new Set();
  for (const filePath of activeFiles) {
    const segments = filePath.split("/");
    if (segments[0] === "scripts" && segments.length >= 3) {
      roots.add(`scripts/${segments[1]}`);
    } else if (filePath.startsWith(".agents/skills/")) {
      roots.add(".agents/skills");
    } else if (filePath.startsWith(".codex/") && !filePath.startsWith(".codex/runtime/")) {
      roots.add(".codex");
    }
  }
  return [...roots].sort();
}

export function projectManifestFindings({ content, root = repositoryRoot, relativePaths } = {}) {
  const parsed = parseActiveModuleInventory(content);
  const findings = [...parsed.findings, ...projectDocumentOwners({ root, content }).findings];
  const activeFiles = relativePaths ?? listActiveFiles({ root });
  findings.push(...deliveryManifestFindings({ content, relativePaths: activeFiles, root }));
  const layout = discoverProductLayout({ repositoryRoot: root, relativePaths: activeFiles });
  findings.push(...layout.findings);
  const productImplementationFiles = activeFiles
    .map((filePath) => normalizeProductPath(filePath))
    .filter(Boolean)
    .filter((filePath) => isProductImplementationPath(filePath, layout))
    .filter((filePath) => !/[\/](?:\.gitkeep|\.keep)$/u.test(filePath));
  const frameworkCapabilityRoots = sourceFrameworkCapabilityRoots(activeFiles, root);
  const frameworkImplementationFiles = activeFiles.filter((filePath) =>
    frameworkCapabilityRoots.some((capabilityRoot) => covers(capabilityRoot, filePath)),
  );
  const implementationFiles = [...productImplementationFiles, ...frameworkImplementationFiles];

  for (const entry of parsed.entries) {
    if (!entry.root) continue;
    if (!realModuleDirectory(root, entry.root)) {
      findings.push(
        `active module ${entry.name} root does not exist as a real directory: ${entry.root}`,
      );
      continue;
    }
    const productModule = layout.sourceRoots.some((sourceRoot) => covers(sourceRoot, entry.root));
    const frameworkCapability = frameworkCapabilityRoots.includes(entry.root);
    if (!productModule && !frameworkCapability) {
      findings.push(
        `active module ${entry.name} root is neither inside an active Product Root nor an exact source-framework capability root: ${entry.root}`,
      );
    }
    const tenantIsolation = entry.fields["Tenant isolation"] ?? "";
    if (
      productModule &&
      (!/\btenant(?:s|ed|[-_ ]isolation)?\b/iu.test(tenantIsolation) ||
        /\b(?:n\/a|none|not applicable|pending|tbd|todo|unknown)\b/iu.test(tenantIsolation))
    ) {
      findings.push(
        `active product module ${entry.name} must record its implemented tenant isolation and any explicit global/control-plane exception`,
      );
    }
    if (productModule) findings.push(...runtimeTechnologyFindings(entry, implementationFiles));
    if (!implementationFiles.some((filePath) => covers(entry.root, filePath))) {
      findings.push(
        `active module ${entry.name} has no current implementation files: ${entry.root}`,
      );
    }
  }
  for (const capabilityRoot of frameworkCapabilityRoots) {
    const owners = parsed.entries.filter((entry) => entry.root === capabilityRoot);
    if (owners.length === 0) {
      findings.push(
        `active source-framework capability is missing from the manifest: ${capabilityRoot}`,
      );
    }
  }
  for (const filePath of implementationFiles) {
    const owners = parsed.entries.filter((entry) => entry.root && covers(entry.root, filePath));
    if (owners.length === 0) {
      findings.push(
        `active implementation file is missing from the manifest module inventory: ${filePath}`,
      );
    } else if (owners.length > 1) {
      findings.push(
        `active implementation file has overlapping manifest module owners (${owners.map((entry) => entry.name).join(", ")}): ${filePath}`,
      );
    }
  }
  findings.push(
    ...moduleDependencyFindings({ entries: parsed.entries, implementationFiles, root }),
  );
  return [...new Set(findings)].sort();
}

export function futureModulesDocumentFindings(content) {
  const text = String(content);
  const normalizedText = text.replace(/\s+/gu, " ");
  const findings = [];
  if (!text.startsWith("# Future Modules\n")) {
    findings.push("docs/future-modules.md must start with # Future Modules");
  }
  if (!normalizedText.includes(futureModulesPreamble.replace(/\s+/gu, " "))) {
    findings.push("docs/future-modules.md must preserve its non-authoritative candidate boundary");
  }
  if (!normalizedText.includes(futureModulesActivationRule.replace(/\s+/gu, " "))) {
    findings.push(
      "docs/future-modules.md must preserve its implementation-to-manifest activation rule",
    );
  }
  if (!normalizedText.includes(futureModulesIntentRule.replace(/\s+/gu, " "))) {
    findings.push("docs/future-modules.md must preserve its idea-intent clarification rule");
  }
  if (!/^## Candidates\s*$/mu.test(text)) {
    findings.push("docs/future-modules.md must contain ## Candidates");
  }
  const parsed = parseFutureModuleCandidates(text);
  return [...new Set([...findings, ...parsed.findings])].sort();
}

export function parseFutureModuleCandidates(content) {
  const lines = sectionLines(content, "## Candidates");
  const findings = [];
  if (!lines) return { candidates: [], findings };
  const section = lines.join("\n").trim();
  const headingIndexes = [];
  for (const [index, line] of lines.entries()) {
    if (/^###\s+\S/u.test(line)) headingIndexes.push(index);
  }
  if (headingIndexes.length === 0) {
    if (section !== noFutureModulesStatement) {
      findings.push(
        `docs/future-modules.md Candidates must contain structured entries or exactly "${noFutureModulesStatement}"`,
      );
    }
    return { candidates: [], findings };
  }
  if (section.includes(noFutureModulesStatement)) {
    findings.push("docs/future-modules.md cannot declare both no candidates and candidate entries");
  }
  if (lines.slice(0, headingIndexes[0]).some((line) => line.trim())) {
    findings.push("docs/future-modules.md has unexpected candidate text before its first entry");
  }
  const candidates = [];
  for (const [position, start] of headingIndexes.entries()) {
    const end = headingIndexes[position + 1] ?? lines.length;
    const name = lines[start]
      .replace(/^###\s+/u, "")
      .trim()
      .replace(/^`|`$/gu, "");
    const parsed = parsedFieldBlock(lines.slice(start + 1, end), name, futureCandidateFields);
    if (parsed.duplicate) {
      findings.push(`future module ${name} duplicates field ${parsed.duplicate}`);
      continue;
    }
    if (parsed.unexpected) {
      findings.push(`future module ${name} contains unexpected text: ${parsed.unexpected}`);
      continue;
    }
    if (parsed.missing.length > 0) {
      findings.push(`future module ${name} is missing fields: ${parsed.missing.join(", ")}`);
    }
    if (parsed.unknown.length > 0) {
      findings.push(`future module ${name} has unknown fields: ${parsed.unknown.join(", ")}`);
    }
    candidates.push({ fields: Object.fromEntries(parsed.values), name });
  }
  const duplicateNames = candidates
    .map((candidate) => candidate.name.toLocaleLowerCase("en-US"))
    .filter((name, index, names) => names.indexOf(name) !== index);
  if (duplicateNames.length > 0) {
    findings.push(`future module names must be unique: ${[...new Set(duplicateNames)].join(", ")}`);
  }
  return { candidates, findings };
}

export function activeFutureModuleOverlapFindings(manifestContent, futureModulesContent) {
  const active = parseActiveModuleInventory(manifestContent).entries;
  const future = parseFutureModuleCandidates(futureModulesContent).candidates;
  const activeNames = new Set(active.map((entry) => entry.name.toLocaleLowerCase("en-US")));
  return future
    .filter((candidate) => activeNames.has(candidate.name.toLocaleLowerCase("en-US")))
    .map(
      (candidate) =>
        `module ${candidate.name} cannot be both active in docs/project.md and future-only in docs/future-modules.md`,
    );
}

export function futureModuleBacklogHeading(relativePath, content) {
  if (relativePath === "docs/future-modules.md") return null;
  return String(content)
    .split(/\r?\n/u)
    .find((line) =>
      /^#{1,6}\s+(?:(?:future|planned|proposed|candidate|upcoming)\s+modules?|module\s+(?:backlog|roadmap))\b/iu.test(
        line,
      ),
    );
}
