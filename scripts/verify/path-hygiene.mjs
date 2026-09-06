/** Owns path hygiene behavior for the repository verification boundary. */
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createLocalImportResolver,
  importSpecifiersForFile,
} from "../repository/local-import-resolution.mjs";
import {
  architecturalSourceExtensions,
  embeddedScriptSourceExtensions,
} from "../repository/source-import-specifiers.mjs";
import {
  canonicalArchitectureSegment,
  discoverProductLayout,
} from "../repository/product-roots.mjs";
import { listActiveFiles } from "../repository/source-inventory.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..", "..");
const commonPathSegments = new Set([
  "",
  "app",
  "apps",
  "bin",
  "code",
  "dev",
  "home",
  "media",
  "mnt",
  "opt",
  "private",
  "root",
  "run",
  "src",
  "srv",
  "tmp",
  "users",
  "var",
  "volumes",
]);
const agentOnlyDirectoryNames = new Set([".agents", ".codex", ".project-state"]);
const agentOnlyFileNames = new Set(["AGENTS.md", "AGENTS.override.md"]);
const surfaceWrapperNames = new Set(["interfaces", "surfaces"]);
const surfaceAliases = new Map([
  ["android", "mobile"],
  ["api", "api"],
  ["background", "worker"],
  ["browser", "web"],
  ["cli", "cli"],
  ["command-line", "cli"],
  ["desktop", "desktop"],
  ["embedded", "embedded"],
  ["http", "api"],
  ["ios", "mobile"],
  ["library", "library"],
  ["mobile", "mobile"],
  ["native", "embedded"],
  ["pwa", "web"],
  ["realtime", "realtime"],
  ["sdk", "library"],
  ["tui", "cli"],
  ["web", "web"],
  ["worker", "worker"],
]);
const surfaceSourceExtensions = new Set([
  ...architecturalSourceExtensions,
  ...embeddedScriptSourceExtensions,
]);
const uiSurfaceTypes = new Set(["desktop", "mobile", "web"]);
const uiSurfaceConcerns = new Set([
  "adapters",
  "assets",
  "clients",
  "components",
  "composition",
  "entry",
  "interactions",
  "navigation",
  "public",
  "routes",
  "screens",
  "state",
  "styles",
  "view-models",
  "viewmodels",
  "views",
]);
const surfaceEntryBasenames = new Set(["composition", "entry", "index", "main", "public"]);
const platformDependencies = [
  {
    surfaceType: "desktop",
    pattern: /^(?:@tauri-apps\/api|electron|nw\.gui|wailsjs)(?:\/|$)/iu,
  },
  {
    surfaceType: "mobile",
    pattern: /^(?:@capacitor\/|@ionic\/|expo(?:\/|$)|react-native(?:\/|$))/iu,
  },
  {
    surfaceType: "web",
    pattern:
      /^(?:@angular\/|@astrojs\/|@remix-run\/react|@sveltejs\/|astro(?:\/|$)|next(?:\/|$)|nuxt(?:\/|$)|react-dom(?:\/|$)|react-router-dom(?:\/|$)|solid-js\/web|svelte(?:\/|$)|vue(?:\/|$))/iu,
  },
  {
    surfaceType: "api",
    pattern:
      /^(?:@grpc\/|@nestjs\/|apollo-server(?:\/|$)|express(?:\/|$)|fastify(?:\/|$)|graphql-yoga(?:\/|$)|hono(?:\/|$)|koa(?:\/|$))/iu,
  },
  {
    surfaceType: "cli",
    pattern: /^(?:@clack\/|commander(?:\/|$)|inquirer(?:\/|$)|oclif(?:\/|$)|yargs(?:\/|$))/iu,
  },
];

const failures = [];

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function pathInside(parent, candidate) {
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

function productSourceOwner(relativePath, productLayout) {
  const candidates = productLayout.units.flatMap((unit) =>
    unit.sourceRoots
      .filter((sourceRoot) => pathInside(sourceRoot, relativePath))
      .map((sourceRoot) => ({ sourceRoot, unit })),
  );
  return (
    candidates.sort(
      (left, right) =>
        right.sourceRoot.length - left.sourceRoot.length ||
        left.unit.root.localeCompare(right.unit.root),
    )[0] ?? null
  );
}

function surfaceTypeForUnit(unit) {
  if (unit.kind === "android") return "mobile";
  const basename = canonicalArchitectureSegment(path.posix.basename(unit.root));
  return surfaceAliases.get(basename) ?? null;
}

function surfaceDescriptor(relativePath, productLayout) {
  const owner = productSourceOwner(relativePath, productLayout);
  if (!owner) return null;
  const tail = relativePath.slice(owner.sourceRoot.length).replace(/^\//u, "").split("/");
  const unitSurfaceType = surfaceTypeForUnit(owner.unit);
  if (unitSurfaceType) {
    return {
      boundaryRoot: owner.sourceRoot,
      remainder: tail,
      sourceRoot: owner.sourceRoot,
      surfaceType: unitSurfaceType,
      unit: owner.unit,
    };
  }
  let boundaryIndex = 0;
  if (surfaceWrapperNames.has(canonicalArchitectureSegment(tail[0]))) boundaryIndex = 1;
  const surfaceType = surfaceAliases.get(canonicalArchitectureSegment(tail[boundaryIndex]));
  if (!surfaceType) return null;
  return {
    boundaryRoot: [owner.sourceRoot, ...tail.slice(0, boundaryIndex + 1)].join("/"),
    remainder: tail.slice(boundaryIndex + 1),
    sourceRoot: owner.sourceRoot,
    surfaceType,
    unit: owner.unit,
  };
}

function surfaceFileFindings(file, productLayout, importResolver) {
  const findings = [];
  const descriptor = surfaceDescriptor(file.relativePath, productLayout);
  const owner = productSourceOwner(file.relativePath, productLayout);
  const relativeToSource = owner
    ? file.relativePath.slice(owner.sourceRoot.length).replace(/^\//u, "")
    : file.relativePath;
  const relativeSegments = relativeToSource.split("/");
  const basename = path.posix.basename(file.relativePath, path.posix.extname(file.relativePath));

  if (
    relativeSegments.length === 1 &&
    surfaceAliases.has(canonicalArchitectureSegment(basename)) &&
    !surfaceEntryBasenames.has(canonicalArchitectureSegment(basename))
  ) {
    findings.push(
      `${file.relativePath}: a product surface needs a dedicated directory or declared product package instead of a Product Root-level file`,
    );
  }

  if (
    descriptor &&
    uiSurfaceTypes.has(descriptor.surfaceType) &&
    descriptor.unit.kind !== "android"
  ) {
    const concern = canonicalArchitectureSegment(descriptor.remainder[0]);
    const rootEntry =
      descriptor.remainder.length === 1 &&
      surfaceEntryBasenames.has(canonicalArchitectureSegment(basename));
    if (descriptor.remainder.length > 0 && !rootEntry && !uiSurfaceConcerns.has(concern)) {
      findings.push(
        `${file.relativePath}: ${descriptor.surfaceType} UI implementation must live in an explicit views/screens, components, state, navigation, client/adapter, assets/styles, composition/entry, or public concern directory`,
      );
    }
  }

  for (const specifier of importSpecifiersForFile(file)) {
    const dependency = platformDependencies.find(({ pattern }) => pattern.test(specifier));
    if (dependency && descriptor?.surfaceType !== dependency.surfaceType) {
      findings.push(
        `${file.relativePath}: platform dependency ${specifier} belongs only inside an explicit ${dependency.surfaceType} surface root`,
      );
    }

    const resolution = importResolver.resolve(file.relativePath, specifier);
    if (resolution.unresolvedAlias) {
      findings.push(
        `${file.relativePath}: repository-local import alias ${specifier} cannot be resolved; declare its tsconfig/jsconfig path mapping before surface verification`,
      );
      continue;
    }
    for (const target of resolution.targets) {
      const targetDescriptor = surfaceDescriptor(target, productLayout);
      if (!targetDescriptor) continue;
      if (!descriptor) {
        findings.push(
          `${file.relativePath}: domain, application, and shared code must not import the ${targetDescriptor.surfaceType} surface ${specifier}`,
        );
        break;
      }
      if (descriptor.boundaryRoot !== targetDescriptor.boundaryRoot) {
        findings.push(
          `${file.relativePath}: the ${descriptor.surfaceType} surface must not import the separately owned ${targetDescriptor.surfaceType} surface ${specifier}; move shared behavior behind an application/domain contract or explicit shared presentation boundary`,
        );
        break;
      }
    }
  }
  return findings;
}

export function surfaceIsolationFindings({
  repositoryRoot = root,
  relativePaths,
  productLayout,
} = {}) {
  const inventory = relativePaths ?? listActiveFiles({ root: repositoryRoot });
  const layout =
    productLayout ?? discoverProductLayout({ repositoryRoot, relativePaths: inventory });
  const importResolver = createLocalImportResolver({
    root: repositoryRoot,
    relativePaths: inventory,
    productLayout: layout,
  });
  const findings = [...importResolver.findings];
  for (const relativePath of inventory) {
    if (!productSourceOwner(relativePath, layout)) continue;
    if (!surfaceSourceExtensions.has(path.posix.extname(relativePath).toLowerCase())) continue;
    const absolutePath = path.join(repositoryRoot, ...relativePath.split("/"));
    if (!existsSync(absolutePath)) continue;
    const stats = lstatSync(absolutePath);
    if (stats.isSymbolicLink() || !stats.isFile()) continue;
    const file = { content: readFileSync(absolutePath, "utf8"), relativePath };
    findings.push(...surfaceFileFindings(file, layout, importResolver));
  }
  return [...new Set(findings)].sort((left, right) => left.localeCompare(right));
}

function activePathMarkers() {
  const markers = new Set();
  let cursor = root;

  for (let depth = 0; depth < 3; depth += 1) {
    if (!cursor || cursor === path.dirname(cursor)) break;
    const marker = toPosix(cursor);
    if (marker.length >= 12) markers.add(marker);
    cursor = path.dirname(cursor);
  }

  const segments = toPosix(root).split("/").filter(Boolean);
  for (let start = 0; start < segments.length - 1; start += 1) {
    const firstSegment = segments[start].toLowerCase();
    if (commonPathSegments.has(firstSegment)) continue;
    const marker = segments.slice(start).join("/");
    if (marker.includes("/") && marker.length >= 12) {
      markers.add(marker);
    }
  }

  return [...markers].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function createPathMarkerScanner(markers) {
  const encodedMarkers = markers.map((marker) => ({ marker, value: Buffer.from(marker, "utf8") }));
  const overlap = Math.max(0, ...encodedMarkers.map(({ value }) => value.length - 1));
  const matches = new Set();
  let tail = Buffer.alloc(0);
  return {
    write(chunk) {
      const content = Buffer.concat([tail, Buffer.from(chunk)]);
      for (const { marker, value } of encodedMarkers) {
        if (!matches.has(marker) && content.indexOf(value) >= 0) matches.add(marker);
      }
      tail =
        overlap > 0 ? content.subarray(Math.max(0, content.length - overlap)) : Buffer.alloc(0);
    },
    matches() {
      return [...matches].sort((left, right) => left.localeCompare(right));
    },
  };
}

function scanFile(label, filePath, markers) {
  const scanner = createPathMarkerScanner(markers);
  const descriptor = openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    for (;;) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      scanner.write(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
  return scanner
    .matches()
    .map((marker) => `${label}: contains local path marker ${JSON.stringify(marker)}`);
}

export function activePathMarkerFindings({ markers, repositoryRoot = root }) {
  const findings = [];
  for (const relativePathValue of listActiveFiles({ root: repositoryRoot })) {
    findings.push(
      ...scanFile(relativePathValue, path.join(repositoryRoot, relativePathValue), markers),
    );
  }
  return findings;
}

export function productSourceBoundaryFindings({ repositoryRoot = root } = {}) {
  const activeFiles = listActiveFiles({ root: repositoryRoot });
  const layout = discoverProductLayout({
    repositoryRoot,
    relativePaths: activeFiles,
  });
  const findings = [...layout.findings];
  const boundaries = layout.units.flatMap((productUnit) =>
    productUnit.root === "." ? productUnit.sourceRoots : [productUnit.root],
  );

  for (const boundary of boundaries) {
    const boundaryRoot = path.join(repositoryRoot, ...boundary.split("/"));
    if (!existsSync(boundaryRoot)) continue;
    const pending = [boundaryRoot];
    while (pending.length > 0) {
      const directory = pending.pop();
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name);
        const relativePath = toPosix(path.relative(repositoryRoot, absolutePath));
        if (entry.isSymbolicLink()) {
          findings.push(`${relativePath}: symlinks are forbidden inside product unit ${boundary}`);
          continue;
        }
        if (agentOnlyDirectoryNames.has(entry.name)) {
          findings.push(
            `${relativePath}: agent-only path is forbidden inside product unit ${boundary}`,
          );
          continue;
        }
        if (agentOnlyFileNames.has(entry.name)) {
          findings.push(
            `${relativePath}: agent instruction path is forbidden inside product unit ${boundary}`,
          );
          continue;
        }
        if (entry.isDirectory()) pending.push(absolutePath);
      }
    }
  }

  findings.push(
    ...surfaceIsolationFindings({
      repositoryRoot,
      relativePaths: activeFiles,
      productLayout: layout,
    }),
  );

  return [...new Set(findings)].sort((left, right) => left.localeCompare(right));
}

export function neutralProductSourceFindings({ repositoryRoot = root } = {}) {
  const boundaryFindings = productSourceBoundaryFindings({ repositoryRoot });
  if (boundaryFindings.length > 0) return boundaryFindings;

  const layout = discoverProductLayout({
    repositoryRoot,
    relativePaths: listActiveFiles({ root: repositoryRoot }),
  });
  if (layout.units.length !== 1 || layout.units[0].root !== ".") {
    return ["product roots: neutral framework must contain only the default src root"];
  }

  const productSourceRoot = path.join(repositoryRoot, "src");
  const entries = readdirSync(productSourceRoot).sort();
  if (entries.join("\n") !== ".gitkeep") {
    return ["src: neutral framework must contain only the .gitkeep placeholder"];
  }
  const placeholderPath = path.join(productSourceRoot, ".gitkeep");
  const placeholderStats = lstatSync(placeholderPath);
  if (
    placeholderStats.isSymbolicLink() ||
    !placeholderStats.isFile() ||
    readFileSync(placeholderPath, "utf8").trim() !== ""
  ) {
    return ["src/.gitkeep: neutral framework placeholder must be a real empty file"];
  }
  return [];
}

function main() {
  const markers = activePathMarkers();
  const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--");
  if (unknownArguments.length > 0) {
    console.error(`Unknown path hygiene argument: ${unknownArguments[0]}`);
    process.exit(1);
  }
  failures.push(...activePathMarkerFindings({ markers }));
  failures.push(...productSourceBoundaryFindings());

  if (failures.length > 0) {
    console.error("Path hygiene verification failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log("Path hygiene verification passed.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
