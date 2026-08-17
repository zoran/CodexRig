/** Owns repository-local import resolution for architectural boundary verification. */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { normalizeProductPath } from "./product-roots.mjs";
import {
  importSpecifiersForFile,
  javascriptImportSourceExtensions,
  localImportResolvableExtensions,
} from "./source-import-specifiers.mjs";

export { importSpecifiersForFile } from "./source-import-specifiers.mjs";

const configurationNames = new Set(["jsconfig.json", "tsconfig.json"]);

function pathInside(parent, candidate) {
  return parent === "." || candidate === parent || candidate.startsWith(`${parent}/`);
}

function withoutJsonComments(content) {
  let output = "";
  let quote = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        output += character;
      } else output += " ";
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        output += "  ";
        blockComment = false;
        index += 1;
      } else output += character === "\n" ? "\n" : " ";
      continue;
    }
    if (quote) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quote = false;
      continue;
    }
    if (character === '"') {
      quote = true;
      output += character;
    } else if (character === "/" && next === "/") {
      output += "  ";
      lineComment = true;
      index += 1;
    } else if (character === "/" && next === "*") {
      output += "  ";
      blockComment = true;
      index += 1;
    } else output += character;
  }
  if (quote || blockComment) throw new Error("unterminated JSONC content");
  return output.replace(/,\s*([}\]])/gu, "$1");
}

function safeJsonFile(root, relativePath, label) {
  const target = path.join(root, ...relativePath.split("/"));
  if (!existsSync(target)) throw new Error(`${label} is missing`);
  const stats = lstatSync(target);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) {
    throw new Error(`${label} must be a single-link regular file`);
  }
  try {
    return JSON.parse(withoutJsonComments(readFileSync(target, "utf8")));
  } catch {
    throw new Error(`${label} must contain valid JSON or JSONC`);
  }
}

function aliasMatcher(pattern) {
  const starCount = pattern.split("*").length - 1;
  if (starCount > 1 || !pattern) return null;
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace("\\*", "(.*)");
  return { pattern, regex: new RegExp(`^${escaped}$`, "u"), starCount };
}

function resolvedRepositoryPath(parentPath, candidate) {
  if (typeof candidate !== "string" || !candidate.startsWith(".")) return null;
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(parentPath), candidate));
  return joined === "." ? null : normalizeProductPath(joined);
}

function localExtendsPath(ownerPath, specifier, inventorySet) {
  const candidate = resolvedRepositoryPath(ownerPath, specifier);
  if (!candidate) return null;
  return [candidate, `${candidate}.json`].find((value) => inventorySet.has(value)) ?? null;
}

function extendsSpecifiers(config, relativePath, findings) {
  if (config.extends === undefined) return [];
  const values = Array.isArray(config.extends) ? config.extends : [config.extends];
  if (values.length === 0 || values.some((value) => typeof value !== "string" || !value.trim())) {
    findings.push(`${relativePath}: extends must be a non-empty string or string array`);
    return [];
  }
  return values;
}

function compilerResolutionConfigurations(root, relativePaths, findings) {
  const inventorySet = new Set(relativePaths);
  const configCache = new Map();
  const resolutionCache = new Map();

  function parsedConfig(relativePath) {
    if (!configCache.has(relativePath)) {
      try {
        configCache.set(relativePath, safeJsonFile(root, relativePath, relativePath));
      } catch (error) {
        findings.push(`${relativePath}: ${error.message}`);
        configCache.set(relativePath, null);
      }
    }
    return configCache.get(relativePath);
  }

  function resolvedConfig(relativePath, ancestry = []) {
    if (resolutionCache.has(relativePath)) return resolutionCache.get(relativePath);
    if (ancestry.includes(relativePath)) {
      findings.push(`${relativePath}: local tsconfig/jsconfig extends chain is cyclic`);
      return { aliases: [], baseUrl: null, ownsAliases: false, ownsBaseUrl: false };
    }
    const config = parsedConfig(relativePath);
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return { aliases: [], baseUrl: null, ownsAliases: false, ownsBaseUrl: false };
    }
    let resolution = { aliases: [], baseUrl: null, ownsAliases: false, ownsBaseUrl: false };
    for (const specifier of extendsSpecifiers(config, relativePath, findings)) {
      if (!specifier.startsWith(".")) continue;
      const parentPath = localExtendsPath(relativePath, specifier, inventorySet);
      if (!parentPath) {
        findings.push(`${relativePath}: local extends target ${specifier} is missing`);
        continue;
      }
      const parent = resolvedConfig(parentPath, [...ancestry, relativePath]);
      resolution = {
        aliases: parent.ownsAliases ? parent.aliases : resolution.aliases,
        baseUrl: parent.ownsBaseUrl ? parent.baseUrl : resolution.baseUrl,
        ownsAliases: resolution.ownsAliases || parent.ownsAliases,
        ownsBaseUrl: resolution.ownsBaseUrl || parent.ownsBaseUrl,
      };
    }

    const compilerOptions = config.compilerOptions;
    if (compilerOptions === undefined) {
      resolutionCache.set(relativePath, resolution);
      return resolution;
    }
    if (!compilerOptions || typeof compilerOptions !== "object" || Array.isArray(compilerOptions)) {
      findings.push(`${relativePath}: compilerOptions must be an object`);
      resolutionCache.set(relativePath, resolution);
      return resolution;
    }
    let baseUrl = resolution.baseUrl;
    let ownsBaseUrl = resolution.ownsBaseUrl;
    if (compilerOptions.baseUrl !== undefined) {
      ownsBaseUrl = true;
      if (typeof compilerOptions.baseUrl !== "string" || !compilerOptions.baseUrl.trim()) {
        baseUrl = null;
        findings.push(`${relativePath}: compilerOptions.baseUrl must be a non-empty string`);
      } else {
        const joined = path.posix.normalize(
          path.posix.join(path.posix.dirname(relativePath), compilerOptions.baseUrl),
        );
        const normalized = joined === "." ? "." : normalizeProductPath(joined);
        if (!normalized || path.posix.isAbsolute(compilerOptions.baseUrl)) {
          findings.push(`${relativePath}: compilerOptions.baseUrl escapes the repository`);
        } else baseUrl = normalized;
      }
    }

    let aliases = resolution.aliases;
    let ownsAliases = resolution.ownsAliases;
    if (compilerOptions.paths !== undefined) {
      ownsAliases = true;
      aliases = [];
      const paths = compilerOptions.paths;
      if (!paths || typeof paths !== "object" || Array.isArray(paths)) {
        findings.push(`${relativePath}: compilerOptions.paths must be an object`);
      } else {
        const targetBase = baseUrl ?? path.posix.dirname(relativePath);
        for (const [key, values] of Object.entries(paths)) {
          const matcher = aliasMatcher(key);
          if (
            !matcher ||
            !Array.isArray(values) ||
            values.length === 0 ||
            values.some((value) => typeof value !== "string" || value.split("*").length - 1 > 1)
          ) {
            findings.push(
              `${relativePath}: compilerOptions.paths entry ${JSON.stringify(key)} is invalid`,
            );
            continue;
          }
          aliases.push({ ...matcher, basePath: targetBase, targets: [...values] });
        }
      }
    }
    const result = { aliases, baseUrl, ownsAliases, ownsBaseUrl };
    resolutionCache.set(relativePath, result);
    return result;
  }

  const aliases = [];
  const baseUrls = [];
  for (const entryPath of relativePaths.filter((candidate) =>
    configurationNames.has(path.posix.basename(candidate)),
  )) {
    const resolution = resolvedConfig(entryPath);
    const configDirectory = path.posix.dirname(entryPath);
    aliases.push(...resolution.aliases.map((alias) => ({ ...alias, configDirectory })));
    if (resolution.baseUrl) baseUrls.push({ basePath: resolution.baseUrl, configDirectory });
  }
  return { aliases, baseUrls };
}

function packageExportEntries(exportsValue, manifestPath, unit, findings) {
  if (exportsValue === undefined) return null;
  let entries;
  if (typeof exportsValue === "string" || Array.isArray(exportsValue) || exportsValue === null) {
    entries = [[".", exportsValue]];
  } else if (typeof exportsValue === "object") {
    const keys = Object.keys(exportsValue);
    const subpathKeys = keys.filter((key) => key.startsWith("."));
    if (subpathKeys.length === 0) entries = [[".", exportsValue]];
    else if (subpathKeys.length === keys.length) entries = Object.entries(exportsValue);
    else {
      findings.push(`${manifestPath}: exports cannot mix condition and subpath keys`);
      return [];
    }
  } else {
    findings.push(`${manifestPath}: exports must be a string, array, object, or null`);
    return [];
  }

  return entries.flatMap(([key, value]) => {
    const matcher = aliasMatcher(key);
    const targets = conditionalImportTargets(value);
    if (!matcher || (key !== "." && !key.startsWith("./"))) {
      findings.push(`${manifestPath}: exports entry ${JSON.stringify(key)} is invalid`);
      return [];
    }
    if (
      targets.some(
        (target) =>
          !target.startsWith("./") ||
          target.split("*").length - 1 > 1 ||
          target.split("*").length !== key.split("*").length,
      )
    ) {
      findings.push(`${manifestPath}: exports entry ${JSON.stringify(key)} has an invalid target`);
      return [];
    }
    return [
      {
        ...matcher,
        targets: targets.map((target) => (unit.root === "." ? target : `${unit.root}/${target}`)),
      },
    ];
  });
}

function workspacePackages(root, relativePaths, productLayout, findings) {
  const packages = [];
  for (const unit of productLayout.units) {
    const manifestPath = unit.root === "." ? "package.json" : `${unit.root}/package.json`;
    if (!relativePaths.includes(manifestPath)) continue;
    let manifest;
    try {
      manifest = safeJsonFile(root, manifestPath, manifestPath);
    } catch (error) {
      findings.push(`${manifestPath}: ${error.message}`);
      continue;
    }
    if (typeof manifest.name !== "string" || !manifest.name.trim()) {
      findings.push(
        `${manifestPath}: workspace package needs a non-empty name for import resolution`,
      );
      continue;
    }
    packages.push({
      exportEntries: packageExportEntries(manifest.exports, manifestPath, unit, findings),
      name: manifest.name,
      sourceRoot: unit.sourceRoots[0],
    });
  }
  return packages.sort((left, right) => right.name.length - left.name.length);
}

function conditionalImportTargets(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(conditionalImportTargets);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(conditionalImportTargets);
  }
  return [];
}

function conditionalPackageImportMappings(value) {
  if (typeof value === "string" || value === null) return { valid: true, values: [value] };
  if (Array.isArray(value)) {
    const children = value.map(conditionalPackageImportMappings);
    return {
      valid: children.every((child) => child.valid),
      values: children.flatMap((child) => child.values),
    };
  }
  if (value && typeof value === "object") {
    return conditionalPackageImportMappings(Object.values(value));
  }
  return { valid: false, values: [] };
}

function packageImportAliases(root, relativePaths, productLayout, findings) {
  const aliases = [];
  for (const unit of productLayout.units) {
    const manifestPath = unit.root === "." ? "package.json" : `${unit.root}/package.json`;
    if (!relativePaths.includes(manifestPath)) continue;
    let manifest;
    try {
      manifest = safeJsonFile(root, manifestPath, manifestPath);
    } catch (error) {
      findings.push(`${manifestPath}: ${error.message}`);
      continue;
    }
    if (manifest.imports === undefined) continue;
    if (
      !manifest.imports ||
      typeof manifest.imports !== "object" ||
      Array.isArray(manifest.imports)
    ) {
      findings.push(`${manifestPath}: imports must be an object`);
      continue;
    }
    for (const [key, value] of Object.entries(manifest.imports)) {
      const matcher = aliasMatcher(key);
      const mappings = conditionalPackageImportMappings(value);
      const invalidMapping = mappings.values.some(
        (target) =>
          typeof target === "string" &&
          (target.startsWith("../") || target.startsWith("/") || target === "."),
      );
      if (
        !matcher ||
        !key.startsWith("#") ||
        key === "#" ||
        key.startsWith("#/") ||
        !mappings.valid ||
        invalidMapping
      ) {
        findings.push(`${manifestPath}: imports entry ${JSON.stringify(key)} is invalid`);
        continue;
      }
      aliases.push({
        ...matcher,
        configDirectory: unit.root,
        mappings: mappings.values.map((target) => {
          if (target === null) return { kind: "blocked", value: null };
          if (!target.startsWith("./")) return { kind: "external", value: target };
          return {
            kind: "local",
            value: unit.root === "." ? target : `${unit.root}/${target}`,
          };
        }),
      });
    }
  }
  return aliases;
}

function relativeResolution(importer, cleanSpecifier) {
  if (!cleanSpecifier.startsWith(".")) return null;
  return normalizeProductPath(path.posix.join(path.posix.dirname(importer), cleanSpecifier));
}

function aliasTargets(importer, cleanSpecifier, aliases) {
  const applicable = aliases
    .filter((alias) => pathInside(alias.configDirectory, importer))
    .sort(
      (left, right) =>
        right.configDirectory.length - left.configDirectory.length ||
        right.pattern.length - left.pattern.length,
    );
  const deepestConfiguration = applicable[0]?.configDirectory;
  const candidates = applicable.filter((alias) => alias.configDirectory === deepestConfiguration);
  for (const alias of candidates) {
    const match = alias.regex.exec(cleanSpecifier);
    if (!match) continue;
    const replacement = match[1] ?? "";
    return {
      matched: true,
      targets: alias.targets
        .map((target) => target.replace("*", replacement))
        .map((target) => normalizeProductPath(path.posix.join(alias.basePath, target)))
        .filter(Boolean),
    };
  }
  return { matched: false, targets: [] };
}

function workspaceTargets(cleanSpecifier, packages) {
  const owner = packages.find(
    (candidate) =>
      cleanSpecifier === candidate.name || cleanSpecifier.startsWith(`${candidate.name}/`),
  );
  if (!owner) return null;
  const subpath = cleanSpecifier.slice(owner.name.length).replace(/^\//u, "");
  if (owner.exportEntries) {
    const exportKey = subpath ? `./${subpath}` : ".";
    for (const entry of owner.exportEntries) {
      const match = entry.regex.exec(exportKey);
      if (!match) continue;
      const replacement = match[1] ?? "";
      return {
        targets: entry.targets
          .map((target) => target.replace("*", replacement))
          .map((target) => normalizeProductPath(target))
          .filter(Boolean),
        unresolved: entry.targets.length === 0,
      };
    }
    return { targets: [], unresolved: true };
  }
  const target = normalizeProductPath(
    subpath ? `${owner.sourceRoot}/${subpath}` : `${owner.sourceRoot}/index`,
  );
  return { targets: target ? [target] : [], unresolved: !target };
}

function packageImportResolution(importer, cleanSpecifier, aliases, packages) {
  const applicable = aliases
    .filter((alias) => pathInside(alias.configDirectory, importer))
    .sort(
      (left, right) =>
        right.configDirectory.length - left.configDirectory.length ||
        right.pattern.length - left.pattern.length,
    );
  const deepestConfiguration = applicable[0]?.configDirectory;
  for (const alias of applicable.filter(
    (candidate) => candidate.configDirectory === deepestConfiguration,
  )) {
    const match = alias.regex.exec(cleanSpecifier);
    if (!match) continue;
    const replacement = match[1] ?? "";
    const targets = [];
    let unresolved = false;
    for (const mapping of alias.mappings) {
      if (mapping.kind === "blocked") continue;
      const resolvedMapping = mapping.value.replace("*", replacement);
      if (mapping.kind === "local") {
        const target = normalizeProductPath(resolvedMapping);
        if (target) targets.push(target);
        else unresolved = true;
        continue;
      }
      const workspace = workspaceTargets(resolvedMapping, packages);
      if (workspace) {
        targets.push(...workspace.targets);
        unresolved ||= workspace.unresolved;
      }
      // Ordinary external package targets are valid and outside repository architecture ownership.
    }
    return { matched: true, targets: [...new Set(targets)].sort(), unresolved };
  }
  return { matched: false, targets: [], unresolved: false };
}

function inventoryResolutionTarget(candidate, inventorySet) {
  const candidates = [
    candidate,
    ...localImportResolvableExtensions.map((extension) => `${candidate}${extension}`),
    ...localImportResolvableExtensions.map((extension) => `${candidate}/index${extension}`),
  ];
  const exact = candidates.find((target) => inventorySet.has(target));
  if (exact) return exact;
  const directoryPrefix = `${candidate}/`;
  return [...inventorySet].some(
    (target) =>
      target.startsWith(directoryPrefix) &&
      localImportResolvableExtensions.includes(path.posix.extname(target).toLowerCase()),
  )
    ? candidate
    : null;
}

function baseUrlTargets(importer, cleanSpecifier, baseUrls, inventorySet) {
  if (
    cleanSpecifier.startsWith(".") ||
    cleanSpecifier.startsWith("/") ||
    cleanSpecifier.startsWith("node:")
  ) {
    return null;
  }
  const applicable = baseUrls
    .filter((configuration) => pathInside(configuration.configDirectory, importer))
    .sort((left, right) => right.configDirectory.length - left.configDirectory.length);
  const deepestConfiguration = applicable[0]?.configDirectory;
  for (const configuration of applicable.filter(
    (candidate) => candidate.configDirectory === deepestConfiguration,
  )) {
    const candidate = normalizeProductPath(path.posix.join(configuration.basePath, cleanSpecifier));
    if (!candidate) continue;
    const target = inventoryResolutionTarget(candidate, inventorySet);
    if (target) return [target];
  }
  return null;
}

function sourceRootTargets(cleanSpecifier, productLayout, inventorySet) {
  if (
    cleanSpecifier.startsWith(".") ||
    cleanSpecifier.startsWith("/") ||
    cleanSpecifier.startsWith("node:")
  ) {
    return null;
  }
  const segments = cleanSpecifier.split("/").filter(Boolean);
  for (let offset = 0; offset < segments.length; offset += 1) {
    const suffix = segments.slice(offset).join("/");
    for (const sourceRoot of productLayout.sourceRoots) {
      const candidate = normalizeProductPath(path.posix.join(sourceRoot, suffix));
      if (!candidate) continue;
      const target = inventoryResolutionTarget(candidate, inventorySet);
      if (target) return [target];
    }
  }
  return null;
}

function cleanImportSpecifier(value) {
  const source = String(value);
  const suffixes = [source.indexOf("?"), source.indexOf("#", 1)].filter((index) => index >= 0);
  return suffixes.length > 0 ? source.slice(0, Math.min(...suffixes)) : source;
}

export function createLocalImportResolver({ root, relativePaths, productLayout }) {
  const inventory = [...new Set(relativePaths)].sort();
  const inventorySet = new Set(inventory);
  const findings = [];
  const typescriptResolution = compilerResolutionConfigurations(root, inventory, findings);
  const packages = workspacePackages(root, inventory, productLayout, findings);
  const packageImports = packageImportAliases(root, inventory, productLayout, findings);
  return Object.freeze({
    findings: Object.freeze([...new Set(findings)].sort()),
    resolve(importer, specifier) {
      const cleanSpecifier = cleanImportSpecifier(specifier);
      const relative = relativeResolution(importer, cleanSpecifier);
      if (relative) return { kind: "relative", targets: [relative], unresolvedAlias: false };
      const alias = aliasTargets(importer, cleanSpecifier, typescriptResolution.aliases);
      if (alias.matched) {
        return {
          kind: "configured-alias",
          targets: [...new Set(alias.targets)].sort(),
          unresolvedAlias: alias.targets.length === 0,
        };
      }
      const packageImport = packageImportResolution(
        importer,
        cleanSpecifier,
        packageImports,
        packages,
      );
      if (packageImport.matched) {
        return {
          kind: "package-import",
          targets: [...new Set(packageImport.targets)].sort(),
          unresolvedAlias: packageImport.unresolved,
        };
      }
      const baseUrl = baseUrlTargets(
        importer,
        cleanSpecifier,
        typescriptResolution.baseUrls,
        inventorySet,
      );
      if (baseUrl) {
        return { kind: "base-url", targets: baseUrl, unresolvedAlias: false };
      }
      const workspace = workspaceTargets(cleanSpecifier, packages);
      if (workspace) {
        return {
          kind: "workspace-package",
          targets: workspace.targets,
          unresolvedAlias: workspace.unresolved,
        };
      }
      if (!javascriptImportSourceExtensions.includes(path.posix.extname(importer).toLowerCase())) {
        const sourceRoot = sourceRootTargets(cleanSpecifier, productLayout, inventorySet);
        if (sourceRoot) {
          return { kind: "product-source-root", targets: sourceRoot, unresolvedAlias: false };
        }
      }
      return {
        kind: "external-or-unresolved",
        targets: [],
        unresolvedAlias: /^(?:@\/|~\/|#)/u.test(cleanSpecifier),
      };
    },
  });
}
