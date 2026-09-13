/** Owns workspace verification behavior for the repository verification boundary. */
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { discoverPnpmWorkspaceManifestPaths } from "../repository/pnpm-workspace-manifests.mjs";
import { normalizePath, root } from "./adaptive-state.mjs";

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const fullLifecycleOrder = [
  "lint",
  "typecheck",
  "verify:preflight",
  "build",
  "test",
  "test:unit",
  "test:integration",
  "test:e2e",
  "test:tenant-isolation",
];
const changedLifecycleOrder = ["lint", "typecheck", "verify:preflight", "test:unit"];
const lifecycleRoutingCategories = new Set([
  "app/package/service/runtime source",
  "dependency/package manager files",
  "infrastructure/runtime config",
  "unknown or incomplete change scope",
]);

function manifestRelativePath(repositoryRoot, packagePath) {
  return normalizePath(path.relative(repositoryRoot, packagePath));
}

function readStringMap(pkg, field, packageLabel) {
  const value = pkg[field];
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${packageLabel} ${field} must be an object.`);
  }
  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      throw new Error(`${packageLabel} ${field} entry ${JSON.stringify(name)} must be a string.`);
    }
  }
  return value;
}

function loadWorkspaceManifest(repositoryRoot, packageDirectory) {
  const packagePath = path.join(packageDirectory, "package.json");
  const packageLabel = manifestRelativePath(repositoryRoot, packagePath);
  if (!existsSync(packagePath) || lstatSync(packagePath).isSymbolicLink()) {
    throw new Error(`${packageLabel} must be a real package manifest.`);
  }

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch {
    throw new Error(`${packageLabel} contains invalid JSON.`);
  }

  const scripts = readStringMap(pkg, "scripts", packageLabel);
  const declaredDependencyNames = Object.fromEntries(
    dependencyFields.map((field) => [
      field,
      Object.keys(readStringMap(pkg, field, packageLabel)).sort(),
    ]),
  );
  return {
    directory: normalizePath(path.relative(repositoryRoot, packageDirectory)) || ".",
    name: typeof pkg.name === "string" ? pkg.name : "",
    scripts,
    declaredDependencyNames,
  };
}

function retainInternalDependencyNames(manifests) {
  const manifestsByName = new Map();
  for (const manifest of manifests) {
    if (!manifest.name) continue;
    const existing = manifestsByName.get(manifest.name);
    if (existing) {
      throw new Error(
        `pnpm workspace packages ${existing.directory} and ${manifest.directory} share package name ${JSON.stringify(manifest.name)}.`,
      );
    }
    manifestsByName.set(manifest.name, manifest);
  }

  return manifests.map(({ declaredDependencyNames, ...manifest }) => ({
    ...manifest,
    internalDependencyNames: Object.fromEntries(
      dependencyFields.map((field) => [
        field,
        declaredDependencyNames[field].filter(
          (name) => name !== manifest.name && manifestsByName.has(name),
        ),
      ]),
    ),
  }));
}

export function discoverWorkspaceManifests({ repositoryRoot = root, relativePaths } = {}) {
  const realRoot = realpathSync(repositoryRoot);
  const manifests = discoverPnpmWorkspaceManifestPaths({ repositoryRoot: realRoot, relativePaths })
    .map((relativePath) =>
      loadWorkspaceManifest(realRoot, path.dirname(path.join(realRoot, relativePath))),
    )
    .sort((left, right) => left.directory.localeCompare(right.directory));
  return retainInternalDependencyNames(manifests);
}

function recursivelyDelegatesLifecycle(command, scriptName) {
  if (typeof command !== "string") return false;
  const escapedScript = scriptName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    /\bpnpm\b[^\n]*(?:\s-r(?:\s|$)|--recursive\b)/.test(command) &&
    new RegExp(`(?:\\brun\\s+)?${escapedScript}(?:\\s|$)`).test(command)
  );
}

function delegatesToManagedRootVerification(manifest, scriptName) {
  if (manifest.directory !== ".") return false;
  const command = manifest.scripts?.[scriptName];
  if (typeof command !== "string") return false;
  if (
    /(?:^|[\s;&|])(?:(?:corepack|npx)(?:\s+--?[a-z0-9_-]+(?:=[^\s;&|]+)?)*\s+)?(?:pnpm|npm|yarn|bun)(?:\.cmd)?(?:\s+--?[a-z0-9_-]+(?:=[^\s;&|]+)?)*\s+(?:run(?:-script)?\s+)?(?:goal:new|verify(?::[a-z0-9_-]+)?)(?=$|[\s;&|])/iu.test(
      command,
    )
  ) {
    return true;
  }
  if (
    /(?:^|[\s;&|])(?:bash\s+|node\s+|sh\s+)?(?:\.\/)?scripts\/verify\/(?:adaptive\.mjs|pre-push\.sh)(?:\s|$)/u.test(
      command,
    )
  ) {
    return true;
  }
  if (
    /(?:^|[\s;&|])(?:node\s+)?(?:\.\/)?scripts\/goals\/goal-publication-precondition\.mjs(?:\s|$)/u.test(
      command,
    )
  ) {
    return true;
  }
  return (
    scriptName === "lint" &&
    /(?:^|[\s;&|])(?:bash|sh)\s+(?:\.\/)?scripts\/verify\/lint\.sh(?:\s|$)/u.test(command)
  );
}

function pureReexportBarrel(relativePath, repositoryRoot) {
  if (!/(?:^|\/)index\.(?:[cm]?[jt]sx?)$/u.test(relativePath)) return false;
  const absolutePath = path.join(repositoryRoot, ...relativePath.split("/"));
  let stats;
  try {
    stats = lstatSync(absolutePath, { bigint: true });
  } catch {
    return false;
  }
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    stats.nlink !== 1n ||
    stats.size > 256n * 1024n
  ) {
    return false;
  }
  let source;
  try {
    source = readFileSync(absolutePath, "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/(^|[^:])\/\/[^\r\n]*/gu, "$1")
      .trim();
  } catch {
    return false;
  }
  if (!source) return false;
  return /^(?:export\s+(?:type\s+)?(?:\*\s*(?:as\s+[A-Za-z_$][A-Za-z0-9_$]*\s+)?|\{[^{}]*\})\s+from\s+["'][^"'\\\r\n]+["']\s*;?\s*)+$/su.test(
    source,
  );
}

function lifecyclePhase(scriptName, mode) {
  if (mode === "changed" || ["lint", "typecheck", "verify:preflight"].includes(scriptName)) {
    return "preflight";
  }
  return scriptName === "build" ? "workspace-build" : "workspace-test";
}

export function workspaceLifecycleCommands(
  manifests = discoverWorkspaceManifests(),
  { mode = "full" } = {},
) {
  if (!["full", "changed"].includes(mode)) {
    throw new Error(`Unsupported workspace verification mode: ${mode}`);
  }
  const commands = [];
  const lifecycleOrder = mode === "changed" ? changedLifecycleOrder : fullLifecycleOrder;
  for (const scriptName of lifecycleOrder) {
    const owners = manifests.filter(
      (manifest) =>
        manifest.scripts?.[scriptName] &&
        !recursivelyDelegatesLifecycle(manifest.scripts[scriptName], scriptName) &&
        !delegatesToManagedRootVerification(manifest, scriptName),
    );
    if (owners.length === 0) continue;
    const filters = owners.flatMap((manifest) => {
      const selector = manifest.directory === "." ? "." : `./${manifest.directory}`;
      if (/[*?[\]{}!]/.test(selector)) {
        throw new Error(
          `Workspace path ${JSON.stringify(manifest.directory)} contains pnpm filter metacharacters and cannot be selected exactly.`,
        );
      }
      return ["--filter", selector];
    });
    commands.push({
      key: `workspace:${scriptName}`,
      label: `project lifecycle ${scriptName}`,
      executable: "pnpm",
      args: [
        "--recursive",
        ...(owners.some((manifest) => manifest.directory === ".")
          ? ["--include-workspace-root"]
          : []),
        ...filters,
        "--if-present",
        "run",
        scriptName,
      ],
      artifactOwners: owners.map((manifest) => `workspace:${manifest.directory}`).sort(),
      reason: `${owners.length} selected project(s) expose ${scriptName}; exact workspace filters avoid non-owners and recursive aggregators`,
      phase: lifecyclePhase(scriptName, mode),
    });
  }
  return commands;
}

function internalDependencyNames(manifest) {
  return new Set(
    dependencyFields.flatMap((field) => manifest.internalDependencyNames?.[field] ?? []),
  );
}

function directChangedOwners(manifests, classifiedPaths) {
  const selectedDirectories = new Set();
  const rootManifest = manifests.find((manifest) => manifest.directory === ".");
  for (const entry of classifiedPaths) {
    if (!entry.categories.some((category) => lifecycleRoutingCategories.has(category))) continue;
    const nestedOwner = manifests
      .filter(
        (manifest) =>
          manifest.directory !== "." &&
          (entry.path === manifest.directory || entry.path.startsWith(`${manifest.directory}/`)),
      )
      .sort((left, right) => right.directory.length - left.directory.length)[0];
    if (nestedOwner) {
      selectedDirectories.add(nestedOwner.directory);
      continue;
    }
    if (
      rootManifest &&
      (entry.path === "package.json" ||
        entry.path.startsWith("src/") ||
        (entry.categories.includes("infrastructure/runtime config") && !entry.path.includes("/")))
    ) {
      selectedDirectories.add(rootManifest.directory);
    }
  }
  return manifests.filter((manifest) => selectedDirectories.has(manifest.directory));
}

export function selectChangedWorkspaceManifests(
  manifests,
  classifiedPaths,
  { repositoryRoot = root } = {},
) {
  const directOwners = directChangedOwners(manifests, classifiedPaths);
  if (directOwners.length === 0) return [];

  const manifestsByName = new Map();
  for (const manifest of manifests) {
    if (!manifest.name) continue;
    const existing = manifestsByName.get(manifest.name);
    if (existing) {
      throw new Error(
        `Workspace packages ${existing.directory} and ${manifest.directory} share package name ${JSON.stringify(manifest.name)}.`,
      );
    }
    manifestsByName.set(manifest.name, manifest);
  }

  const selectedDirectories = new Set(directOwners.map((manifest) => manifest.directory));
  const directOwnerNames = new Set(directOwners.map((manifest) => manifest.name).filter(Boolean));
  for (const owner of directOwners) {
    const ownerPrefix = owner.directory === "." ? "" : `${owner.directory}/`;
    const ownerEntries = classifiedPaths.filter(
      (entry) =>
        (owner.directory === "."
          ? !manifests.some(
              (candidate) =>
                candidate.directory !== "." &&
                (entry.path === candidate.directory ||
                  entry.path.startsWith(`${candidate.directory}/`)),
            )
          : entry.path === owner.directory || entry.path.startsWith(ownerPrefix)) &&
        entry.categories.some((category) => lifecycleRoutingCategories.has(category)),
    );
    const barrelOnly =
      ownerEntries.length > 0 &&
      ownerEntries.every((entry) => pureReexportBarrel(entry.path, repositoryRoot));
    if (barrelOnly) continue;
    for (const dependencyName of internalDependencyNames(owner)) {
      const upstream = manifestsByName.get(dependencyName);
      if (upstream) selectedDirectories.add(upstream.directory);
    }
  }
  for (const candidate of manifests) {
    const dependencies = internalDependencyNames(candidate);
    if ([...directOwnerNames].some((name) => dependencies.has(name))) {
      selectedDirectories.add(candidate.directory);
    }
  }
  return manifests.filter((manifest) => selectedDirectories.has(manifest.directory));
}
