/** Owns tenant isolation behavior for the repository verification boundary. */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  parseTenancyConfiguration,
  tenancyConfigurationFindings,
  tenancyConfigurationPath,
} from "../contracts/tenancy-configuration.mjs";
import { hasProductWorkspace } from "../repository/product-roots.mjs";
import { parseActiveModuleInventory } from "../docs/project-manifest-contract.mjs";
import {
  canonicalArchitectureSegment,
  discoverProductLayout,
  isProductImplementationPath,
} from "../repository/product-roots.mjs";
import {
  createLocalImportResolver,
  importSpecifiersForFile,
} from "../repository/local-import-resolution.mjs";
import {
  architecturalSourceExtensions,
  embeddedScriptSourceExtensions,
} from "../repository/source-import-specifiers.mjs";
import { listActiveFiles, repositoryRoot } from "../repository/source-inventory.mjs";
import {
  discoverWorkspaceManifests,
  workspaceLifecycleCommands,
} from "./workspace-verification.mjs";

const sourceExtensions = new Set([
  ...architecturalSourceExtensions,
  ...embeddedScriptSourceExtensions,
  ".graphql",
  ".prisma",
  ".sql",
]);
const tenancyBoundaryNames = new Set([
  "multi-tenant",
  "multi_tenant",
  "multitenancy",
  "tenant",
  "tenant-context",
  "tenant_context",
  "tenancy",
  "tenants",
]);
const moduleWrapperNames = new Set(["capabilities", "domains", "features", "modules"]);
const publicConcernNames = new Set(["contract", "contracts", "index", "port", "ports", "public"]);
const contextConcernNames = new Set(["context", "contexts", "resolution", "resolver", "resolvers"]);
const policyConcernNames = new Set([
  "authorization",
  "guard",
  "guards",
  "isolation",
  "policies",
  "policy",
]);
const allowedTenancyConcernNames = new Set([
  "adapters",
  "application",
  "audit",
  "composition",
  ...contextConcernNames,
  ...policyConcernNames,
  ...publicConcernNames,
]);
const testFilePattern = /(?:^|\/)(?:[^/]+\.)?(?:source\.)?(?:spec|test)\.[^/]+$/iu;
const directTenancyFilePattern =
  /^(?:multi[-_]tenant|multitenancy|tenant|tenant[-_]context|tenancy|tenants)$/iu;
const tenantMarkerPattern =
  /\b(?:TenantContext|tenantContext|tenantId|tenantKey|tenant_id|tenant_key)\b/u;
const tenantScopedPathPattern =
  /(?:^|\/)(?:cache|events?|files?|jobs?|messages?|migrations?|persistence|queues?|repositories|schemas?|storage)(?:\/|$)/iu;
const explicitGlobalPathPattern = /(?:^|\/)(?:control-plane|global)(?:\/|$)/iu;
const callerControlledTenantPattern =
  /\b(?:tenantId|tenant_id|tenantKey|tenant_key)\s*(?:=|:)\s*(?:await\s+)?(?:req|request|ctx|context)\s*(?:\.|\[)\s*(?:body|headers?|params|query)\b/iu;
const tenantFallbackPattern =
  /\b(?:tenantId|tenant_id|tenantKey|tenant_key)\b[^\n;]{0,80}(?:\?\?|\|\|)\s*["'](?:default|global|public|shared)["']/iu;
const mutableAmbientTenantPattern =
  /\b(?:let|var)\s+(?:currentTenant|currentTenantId|tenantContext|tenantId)\b|\bglobal\s+(?:current_tenant|tenant_context|tenant_id)\b/iu;
const negativeTestExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".mjs",
  ".mts",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".swift",
  ".ts",
  ".tsx",
]);
const negativeDenialAssertionPatterns = Object.freeze([
  /\bassert(?:\.strictEqual|\.equal|_eq!?)?\s*\([^\n;]{0,400},\s*false\b/iu,
  /\bassert(?:False|_false!?)\s*\(/iu,
  /\bassert\s*!?\s*\(\s*!/iu,
  /\bassert\s+not\b/iu,
  /\b(?:assert|expect|require)(?:\.[A-Za-z_$][\w$]*)*\s*(?:\([^\n]{0,400}\))?\s*\.(?:rejects|throws|toBeForbidden|toBeFalsy|toEqual\s*\(\s*false|toThrow|toThrowError|toReject)/iu,
  /\b(?:assertThrows|assert_raises|expectException|XCTAssertThrowsError)\s*\b/iu,
  /\b(?:assert|expect|require)(?:\.[A-Za-z_$][\w$]*)*\s*\([^\n]{0,400}\b(?:403|Forbidden|PERMISSION_DENIED|access denied|cross[- ]tenant)\b/iu,
  /\b(?:status|statusCode|status_code)\b[^\n;]{0,120}(?:===?|==|toBe|toEqual|assertEqual|assertSame)\s*\(?\s*403\b/iu,
  /\b(?:deny|denied|forbidden|permissionDenied|permission_denied|unauthorized)\b[^\n;]{0,160}\b(?:assert|expect|require|raise|throw|error|false|403)\b/iu,
]);
const tenantEnforcementInvocationPattern =
  /\b(?:(?:allow|authorize|can|check|deny|enforce|guard|isolate|require|verify)\w*Tenant\w*|tenant\w*(?:Allow|Authorize|Check|Deny|Enforce|Guard|Isolate|Require|Verify)\w*|crossTenant\w*)\s*[!(]?\s*\(/iu;
const directTenantTestRunnerPattern =
  /^(?:bun\s+test|cargo\s+test|dotnet\s+test|go\s+test|gradle\s+test|mvn\s+test|node\s+--test|phpunit|python(?:3)?\s+-m\s+pytest|pytest|ruby\s+-I\S+|swift\s+test|(?:pnpm\s+exec|npx\s+--no-install)\s+(?:jest|vitest)|(?:jest|vitest))(?:\s|$)/u;

function stripCommentsPreservingLiterals(source) {
  const text = String(source);
  let output = "";
  let quote = null;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (quote) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (['"', "'", "`"].includes(character)) {
      quote = character;
      output += character;
      continue;
    }
    if (character === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      output += " ";
      index = end < 0 ? text.length : end + 1;
      continue;
    }
    if (character === "<" && text.slice(index, index + 4) === "<!--") {
      const end = text.indexOf("-->", index + 4);
      output += " ";
      index = end < 0 ? text.length : end + 2;
      continue;
    }
    if (character === "/" && next === "/") {
      const end = text.indexOf("\n", index + 2);
      output += "\n";
      index = end < 0 ? text.length : end;
      continue;
    }
    if (character === "-" && next === "-") {
      const end = text.indexOf("\n", index + 2);
      output += "\n";
      index = end < 0 ? text.length : end;
      continue;
    }
    if (character === "#" && (index === 0 || /[\s;{}]/u.test(text[index - 1])) && next !== "[") {
      const end = text.indexOf("\n", index + 1);
      output += "\n";
      index = end < 0 ? text.length : end;
      continue;
    }
    output += character;
  }
  return output;
}

function tenantIdentities(source) {
  const identities = new Set();
  const patterns = [
    /\btenant(?:Id|Key|_id|_key)?\b\s*(?:=|:|=>)\s*["'`]([^"'`\r\n]{1,120})["'`]/giu,
    /["'`]((?:tenant|org|workspace|account)[-_ ][A-Za-z0-9][A-Za-z0-9_-]{0,80})["'`]/giu,
    /\b(?:TenantContext|tenant_context)\s*\(\s*["'`]([^"'`\r\n]{1,120})["'`]/giu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) identities.add(match[1].trim().toLowerCase());
  }
  return identities;
}

function assertionSegments(source) {
  const segments = [];
  const pattern =
    /\b(?:assert|expect|require|assertThrows|assert_raises|expectException|XCTAssert)\b/giu;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    const semicolon = source.indexOf(";", start);
    const newline = source.indexOf("\n", start);
    const candidates = [semicolon, newline, start + 1600].filter((candidate) => candidate >= start);
    const end = Math.min(...candidates, source.length - 1);
    segments.push(source.slice(start, Math.min(source.length, end + 1)));
  }
  return segments;
}

function tenantIdentityBindings(source) {
  const bindings = new Map();
  const pattern =
    /\b(?:const|final|let|val|var)?\s*([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*([^;\n]{0,900}\btenant(?:Id|Key|_id|_key)?\b[^;\n]{0,500})/giu;
  for (const match of source.matchAll(pattern)) {
    const identities = tenantIdentities(match[2]);
    if (identities.size > 0) bindings.set(match[1], identities);
  }
  return bindings;
}

function identitiesReferencedBy(segment, bindings) {
  const identities = tenantIdentities(segment);
  for (const [binding, values] of bindings) {
    if (
      !new RegExp(`\\b${binding.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u").test(segment)
    ) {
      continue;
    }
    for (const value of values) identities.add(value);
  }
  return identities;
}

function tenantCoupledDenialAssertion(source) {
  const bindings = tenantIdentityBindings(source);
  const coupledResults = new Set();
  const assignmentPattern =
    /\b(?:const|final|let|val|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*([^;\n]{1,1500})/giu;
  for (const match of source.matchAll(assignmentPattern)) {
    if (
      tenantEnforcementInvocationPattern.test(match[2]) &&
      identitiesReferencedBy(match[2], bindings).size >= 2
    ) {
      coupledResults.add(match[1]);
    }
  }

  return assertionSegments(source).some((segment) => {
    if (!negativeDenialAssertionPatterns.some((pattern) => pattern.test(segment))) return false;
    if (
      tenantEnforcementInvocationPattern.test(segment) &&
      identitiesReferencedBy(segment, bindings).size >= 2
    ) {
      return true;
    }
    return [...coupledResults].some((result) =>
      new RegExp(`\\b${result.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u").test(segment),
    );
  });
}

function negativeCrossTenantEvidence(file) {
  const source = stripCommentsPreservingLiterals(file.content);
  return (
    tenantIdentities(source).size >= 2 &&
    negativeDenialAssertionPatterns.some((pattern) => pattern.test(source)) &&
    tenantCoupledDenialAssertion(source)
  );
}

function readableNegativeTests(root, relativePaths, productLayout, findings) {
  return relativePaths
    .filter((relativePath) => isProductImplementationPath(relativePath, productLayout))
    .filter((relativePath) => testFilePattern.test(relativePath))
    .filter((relativePath) =>
      negativeTestExtensions.has(path.posix.extname(relativePath).toLowerCase()),
    )
    .flatMap((relativePath) => {
      const target = path.join(root, ...relativePath.split("/"));
      try {
        const stats = lstatSync(target);
        if (stats.isSymbolicLink() || !stats.isFile()) {
          findings.push(
            `${relativePath}: tenant-isolation evidence inspection requires a regular file`,
          );
          return [];
        }
        return [{ content: readFileSync(target, "utf8"), relativePath }];
      } catch {
        findings.push(`${relativePath}: could not be inspected for tenant-isolation evidence`);
        return [];
      }
    });
}

function covers(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function moduleTestAssociation(entry, testFile, importResolver) {
  if (covers(entry.root, testFile.relativePath)) return true;
  if ((entry.fields["Focused verifier"] ?? "").includes(testFile.relativePath)) return true;
  return importSpecifiersForFile(testFile).some((specifier) => {
    const resolution = importResolver.resolve(testFile.relativePath, specifier);
    return resolution.targets.some((target) => covers(entry.root, target));
  });
}

function workspaceOwnerFor(moduleRoot, manifests) {
  return [...manifests]
    .filter((manifest) => manifest.directory === "." || covers(manifest.directory, moduleRoot))
    .sort((left, right) => right.directory.length - left.directory.length)[0];
}

function directLifecycleRunsEvidence(owner, testFile) {
  const command = owner?.scripts?.["test:tenant-isolation"]?.trim() ?? "";
  if (!command || /[;&|`]|\$\(|\r|\n/u.test(command)) return false;
  if (!directTenantTestRunnerPattern.test(command)) return false;
  const ownerRelativePath =
    owner.directory === "."
      ? testFile.relativePath
      : path.posix.relative(owner.directory, testFile.relativePath);
  const basename = path.posix.basename(ownerRelativePath);
  const stem = basename.slice(0, -path.posix.extname(basename).length);
  return [ownerRelativePath, `./${ownerRelativePath}`, basename, stem].some(
    (reference) =>
      reference.length >= 3 &&
      new RegExp(
        `(?:^|\\s)["']?${reference.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}["']?(?:\\s|$)`,
        "u",
      ).test(command),
  );
}

function tenantEvidenceFindings({
  activeFiles,
  findings,
  importResolver,
  productFiles,
  productLayout,
  root,
}) {
  const manifestPath = path.join(root, "docs", "project.md");
  let manifestContent;
  try {
    const stats = lstatSync(manifestPath);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("not a real file");
    manifestContent = readFileSync(manifestPath, "utf8");
  } catch {
    return [
      "tenant-isolation evidence requires the current active module inventory in docs/project.md",
    ];
  }
  const parsed = parseActiveModuleInventory(manifestContent);
  if (parsed.findings.length > 0) {
    return parsed.findings.map(
      (finding) => `tenant-isolation evidence cannot use the active module inventory: ${finding}`,
    );
  }
  const modules = parsed.entries.filter(
    (entry) =>
      entry.root &&
      productLayout.sourceRoots.some((sourceRoot) => covers(sourceRoot, entry.root)) &&
      productFiles.some((file) => covers(entry.root, file.relativePath)),
  );
  if (modules.length === 0) {
    return ["product implementation has no active product module for tenant-isolation evidence"];
  }

  const tests = readableNegativeTests(root, activeFiles, productLayout, findings);
  let manifests;
  let lifecycleCommands;
  try {
    manifests = discoverWorkspaceManifests({ repositoryRoot: root, relativePaths: activeFiles });
    lifecycleCommands = workspaceLifecycleCommands(manifests, { mode: "full" });
  } catch (error) {
    return [`tenant-isolation evidence cannot resolve workspace test lifecycle: ${error.message}`];
  }
  const selectedTestOwners = new Set(
    lifecycleCommands
      .filter(
        (command) =>
          command.phase === "workspace-test" && command.key === "workspace:test:tenant-isolation",
      )
      .flatMap((command) => command.artifactOwners ?? []),
  );
  const evidenceFindings = [];
  for (const entry of modules) {
    const owner = workspaceOwnerFor(entry.root, manifests);
    const ownerKey = owner ? `workspace:${owner.directory}` : null;
    if (!ownerKey || !selectedTestOwners.has(ownerKey)) {
      evidenceFindings.push(
        `active product module ${entry.name} has no owning test:tenant-isolation lifecycle selected by full verification`,
      );
    }
    if (
      !tests.some(
        (testFile) =>
          negativeCrossTenantEvidence(testFile) &&
          moduleTestAssociation(entry, testFile, importResolver) &&
          directLifecycleRunsEvidence(owner, testFile),
      )
    ) {
      evidenceFindings.push(
        `active product module ${entry.name} needs an associated negative cross-tenant test/spec with two distinct tenants and a tenant-coupled denial assertion directly named by its test:tenant-isolation runner`,
      );
    }
  }
  return evidenceFindings;
}

function productRootFor(relativePath, productLayout) {
  return [...productLayout.sourceRoots]
    .sort((left, right) => right.length - left.length)
    .find((sourceRoot) => relativePath === sourceRoot || relativePath.startsWith(`${sourceRoot}/`));
}

function tenancyDescriptor(relativePath, productLayout) {
  const sourceRoot = productRootFor(relativePath, productLayout);
  if (!sourceRoot) return null;
  const tail = relativePath.slice(sourceRoot.length).replace(/^\//u, "").split("/");
  if (tail.length === 0) return null;
  let boundaryIndex = 0;
  if (moduleWrapperNames.has(canonicalArchitectureSegment(tail[0]))) boundaryIndex = 1;
  const boundaryName = canonicalArchitectureSegment(tail[boundaryIndex]);
  if (!tenancyBoundaryNames.has(boundaryName)) return null;
  return {
    boundaryIndex,
    boundaryName,
    remainder: tail.slice(boundaryIndex + 1),
    sourceRoot,
    tail,
  };
}

function descriptorUsesPublicContract(descriptor) {
  if (!descriptor) return true;
  const first = descriptor.remainder[0];
  if (!first) return false;
  const basename = path.posix.basename(first, path.posix.extname(first));
  return (
    publicConcernNames.has(canonicalArchitectureSegment(first)) ||
    publicConcernNames.has(canonicalArchitectureSegment(basename))
  );
}

function configurationContent(root, required, findings) {
  const target = path.join(root, ...tenancyConfigurationPath.split("/"));
  if (!existsSync(target)) {
    if (required)
      findings.push(`missing required tenant-isolation owner: ${tenancyConfigurationPath}`);
    return null;
  }
  try {
    const stats = lstatSync(target);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      findings.push(`${tenancyConfigurationPath} must be a non-symlink regular file`);
      return null;
    }
    return readFileSync(target, "utf8");
  } catch {
    findings.push(`${tenancyConfigurationPath} could not be read`);
    return null;
  }
}

function readableProductFiles(root, relativePaths, productLayout, findings) {
  return relativePaths
    .filter((relativePath) => isProductImplementationPath(relativePath, productLayout))
    .filter((relativePath) => !testFilePattern.test(relativePath))
    .filter((relativePath) => sourceExtensions.has(path.posix.extname(relativePath).toLowerCase()))
    .flatMap((relativePath) => {
      const target = path.join(root, ...relativePath.split("/"));
      try {
        const stats = lstatSync(target);
        if (stats.isSymbolicLink() || !stats.isFile()) {
          findings.push(`${relativePath}: tenant-isolation inspection requires a regular file`);
          return [];
        }
        return [{ content: readFileSync(target, "utf8"), relativePath }];
      } catch {
        findings.push(`${relativePath}: could not be inspected for tenant isolation`);
        return [];
      }
    });
}

function tenancyFileFindings(file, productLayout, importResolver) {
  const findings = [];
  const descriptor = tenancyDescriptor(file.relativePath, productLayout);
  const sourceRoot = productRootFor(file.relativePath, productLayout);
  const relativeToSource = sourceRoot
    ? file.relativePath.slice(sourceRoot.length).replace(/^\//u, "")
    : file.relativePath;
  const relativeSegments = relativeToSource.split("/");
  const basename = canonicalArchitectureSegment(
    path.posix.basename(file.relativePath, path.posix.extname(file.relativePath)),
  );
  if (
    (relativeSegments.length === 1 ||
      (relativeSegments.length === 2 && moduleWrapperNames.has(relativeSegments[0]))) &&
    directTenancyFilePattern.test(basename)
  ) {
    findings.push(
      `${file.relativePath}: tenancy implementation needs a dedicated boundary directory instead of a Product Root-level file`,
    );
  }

  if (descriptor) {
    const directories = descriptor.remainder.slice(0, -1);
    const publicRootFile =
      directories.length === 0 && publicConcernNames.has(path.posix.basename(basename));
    if (
      descriptor.remainder.length > 0 &&
      !publicRootFile &&
      (directories.length === 0 ||
        !allowedTenancyConcernNames.has(canonicalArchitectureSegment(directories[0])))
    ) {
      findings.push(
        `${file.relativePath}: tenancy code must use an explicit context/resolution, policy/isolation, public-contract, adapter, audit, application, or composition concern directory`,
      );
    }
  }

  for (const specifier of importSpecifiersForFile(file)) {
    const resolution = importResolver.resolve(file.relativePath, specifier);
    if (resolution.unresolvedAlias) {
      findings.push(
        `${file.relativePath}: repository-local import alias ${specifier} cannot be resolved; declare its tsconfig/jsconfig path mapping before architectural verification`,
      );
      continue;
    }
    for (const target of resolution.targets) {
      const targetDescriptor = tenancyDescriptor(target, productLayout);
      if (!descriptor && targetDescriptor && !descriptorUsesPublicContract(targetDescriptor)) {
        findings.push(
          `${file.relativePath}: consumers outside tenancy may import only its public contract or port, not ${specifier}`,
        );
        break;
      }
    }
  }

  if (callerControlledTenantPattern.test(file.content)) {
    findings.push(
      `${file.relativePath}: a caller-controlled header, query, path, or body tenant identifier is not trusted tenant context`,
    );
  }
  if (tenantFallbackPattern.test(file.content)) {
    findings.push(
      `${file.relativePath}: tenant context must fail closed without a default/global fallback`,
    );
  }
  if (mutableAmbientTenantPattern.test(file.content)) {
    findings.push(
      `${file.relativePath}: tenant context must be request/job scoped rather than mutable ambient global state`,
    );
  }
  if (
    tenantScopedPathPattern.test(file.relativePath) &&
    !explicitGlobalPathPattern.test(file.relativePath) &&
    !tenantMarkerPattern.test(file.content)
  ) {
    findings.push(
      `${file.relativePath}: persistence, schema/migration, cache/file, event/message, queue, or job code must carry explicit tenant scope; truly global/control-plane state belongs in an explicit global or control-plane boundary`,
    );
  }
  return findings;
}

function requiredTenancyConcernFindings(files, productLayout) {
  const descriptors = files
    .map((file) => ({ descriptor: tenancyDescriptor(file.relativePath, productLayout), file }))
    .filter(({ descriptor }) => descriptor);
  if (descriptors.length === 0) {
    return [
      "product implementation requires a dedicated tenancy boundary with context resolution, isolation policy, and a public contract",
    ];
  }
  const concernPresent = (names) =>
    descriptors.some(({ descriptor, file }) => {
      const parts = descriptor.remainder;
      const basename = path.posix.basename(
        file.relativePath,
        path.posix.extname(file.relativePath),
      );
      return (
        parts.some((part) => names.has(canonicalArchitectureSegment(part))) ||
        names.has(canonicalArchitectureSegment(basename))
      );
    });
  const findings = [];
  if (!concernPresent(contextConcernNames)) {
    findings.push("tenancy boundary is missing an explicit tenant-context resolution concern");
  }
  if (!concernPresent(policyConcernNames)) {
    findings.push(
      "tenancy boundary is missing an explicit deny-by-default isolation policy concern",
    );
  }
  if (!concernPresent(publicConcernNames)) {
    findings.push("tenancy boundary is missing a narrow public contract or port concern");
  }
  return findings;
}

export function tenantIsolationProjectFindings({ root = repositoryRoot, relativePaths } = {}) {
  const requiresProduct = hasProductWorkspace({ root, relativePaths });
  const findings = [];
  const content = configurationContent(root, requiresProduct, findings);

  let configuration = null;
  if (content !== null) {
    const configurationFindings = tenancyConfigurationFindings(content);
    findings.push(...configurationFindings);
    if (configurationFindings.length === 0) configuration = parseTenancyConfiguration(content);
  }

  const activeFiles = relativePaths ?? listActiveFiles({ root });
  const productLayout = discoverProductLayout({ repositoryRoot: root, relativePaths: activeFiles });
  findings.push(...productLayout.findings);
  const importResolver = createLocalImportResolver({
    root,
    relativePaths: activeFiles,
    productLayout,
  });
  findings.push(...importResolver.findings);
  const productFiles = readableProductFiles(root, activeFiles, productLayout, findings);
  if (productFiles.length > 0) {
    if (configuration?.tenantContext.resolutionStrategy === "pending") {
      findings.push(
        `${tenancyConfigurationPath} tenant-context resolution must be configured before product implementation`,
      );
    }
    findings.push(...requiredTenancyConcernFindings(productFiles, productLayout));
    for (const file of productFiles) {
      findings.push(...tenancyFileFindings(file, productLayout, importResolver));
    }
    findings.push(
      ...tenantEvidenceFindings({
        activeFiles,
        findings,
        importResolver,
        productFiles,
        productLayout,
        root,
      }),
    );
  }
  return [...new Set(findings)].sort();
}

function main() {
  const findings = tenantIsolationProjectFindings();
  if (findings.length > 0) {
    console.error("Tenant-isolation verification failed:");
    for (const finding of findings) console.error(`- ${finding}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    "Tenant isolation structural and evidence contracts passed (trusted context, deny-by-default cross-tenant access, scoped data/cache/files/messages/jobs, and full-verification negative scenarios).",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main();
