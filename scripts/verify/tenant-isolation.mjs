/** Owns typed tenancy ownership and existing-verifier bindings; semantic isolation needs executed evidence. */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  parseTenancyConfiguration,
  tenancyConfigurationPath,
} from "../contracts/tenancy-configuration.mjs";
import { parseActiveModuleInventory } from "../docs/project-manifest-contract.mjs";
import { readRepositoryFile } from "../filesystem/repository-files.mjs";
import {
  discoverProductLayout,
  hasProductWorkspace,
  isProductImplementationPath,
} from "../repository/product-roots.mjs";
import {
  createLocalImportResolver,
  importSpecifiersForFile,
} from "../repository/local-import-resolution.mjs";
import {
  architecturalSourceExtensions,
  embeddedScriptSourceExtensions,
  localImportResolvableExtensions,
} from "../repository/source-import-specifiers.mjs";
import { listActiveFiles, repositoryRoot } from "../repository/source-inventory.mjs";
import { readVerificationConfiguration } from "./verification-configuration.mjs";
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
  ".rules",
]);
const covers = (root, file) => file === root || file.startsWith(root + "/");
const testPath = /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|(?:\.test|\.spec|Test)\.[^/]+$/u;

function moduleInventory(root, layout, files) {
  const parsed = parseActiveModuleInventory(readRepositoryFile(root, "docs/project.md"));
  if (parsed.findings.length) throw new Error(parsed.findings.join("; "));
  return parsed.entries.filter(
    (entry) =>
      entry.root &&
      layout.sourceRoots.some((sourceRoot) => covers(sourceRoot, entry.root)) &&
      files.some((file) => covers(entry.root, file.relativePath)),
  );
}

function requirePublicSource(root, file, activeFiles, label, findings) {
  if (!activeFiles.has(file) || !sourceExtensions.has(path.posix.extname(file).toLowerCase())) {
    findings.push(label + ": " + file + " must resolve to an active source file");
    return;
  }
  try {
    if (!readRepositoryFile(root, file).trim()) throw new Error("empty source");
  } catch {
    findings.push(label + ": " + file + " must be a nonempty owned regular source file");
  }
}

// The architectural resolver returns lexical relative/alias targets. A typed public source can
// legitimately be imported through its emitted extension or a bundler's extensionless spelling.
// Resolve only unambiguous active source; another real file never inherits the public exemption.
function isPublicContextTarget(target, publicContract, activeFiles) {
  if (target === publicContract) return true;
  if (activeFiles.has(target)) return false;
  const extension = path.posix.extname(target);
  const substitutions = {
    ".js": [".ts", ".tsx", ".d.ts"],
    ".mjs": [".mts", ".d.mts"],
    ".cjs": [".cts", ".d.cts"],
    ".jsx": [".tsx"],
  };
  const candidates = extension
    ? (substitutions[extension] ?? []).map((suffix) => target.slice(0, -extension.length) + suffix)
    : localImportResolvableExtensions.flatMap((suffix) => [
        target + suffix,
        target + "/index" + suffix,
      ]);
  const matches = candidates.filter((file) => activeFiles.has(file));
  return matches.length === 1 && matches[0] === publicContract;
}

function contextBoundaryFindings(
  boundary,
  policies,
  modules,
  files,
  layout,
  resolver,
  activeFiles,
  root,
) {
  const findings = [];
  const owner = modules
    .filter((entry) => covers(entry.root, boundary.root))
    .sort((a, b) => b.root.length - a.root.length)[0];
  if (!owner || layout.sourceRoots.includes(boundary.root)) {
    findings.push(
      "context boundary must occupy a dedicated directory inside an inventoried product module",
    );
  }
  if (
    owner &&
    policies.find((entry) => entry.module === owner.root)?.scope === "tenant-independent"
  )
    findings.push(
      "context boundary " + boundary.root + " cannot belong to a tenant-independent module",
    );
  for (const concern of ["resolver", "policy", "publicContract"]) {
    requirePublicSource(root, boundary[concern], activeFiles, "tenant " + concern, findings);
  }
  for (const file of files) {
    if (covers(boundary.root, file.relativePath)) continue;
    for (const specifier of importSpecifiersForFile(file)) {
      const resolution = resolver.resolve(file.relativePath, specifier);
      if (resolution.unresolvedAlias)
        findings.push(
          file.relativePath +
            ": declare the unresolved local import alias " +
            specifier +
            " before tenancy review",
        );
      if (
        resolution.targets.some(
          (target) =>
            covers(boundary.root, target) &&
            !isPublicContextTarget(target, boundary.publicContract, activeFiles),
        )
      ) {
        findings.push(
          file.relativePath +
            ": consumers outside the context boundary may import only its configured public contract or port, not " +
            specifier,
        );
      }
    }
  }
  return findings;
}

function verificationOwners(root, activeFiles) {
  const manifests = discoverWorkspaceManifests({
    repositoryRoot: root,
    relativePaths: [...activeFiles],
  });
  const commands = [
    ...readVerificationConfiguration(root).commands,
    ...workspaceLifecycleCommands(manifests, { mode: "full" }),
  ];
  return { commands: new Map(commands.map((command) => [command.key, command])), manifests };
}

function evidenceIsSelected(command, file, manifests) {
  if (
    (Array.isArray(command.coveredTestPaths) && command.coveredTestPaths.includes(file)) ||
    command.args.includes(file)
  )
    return true;
  if (command.phase !== "workspace-test") return false;
  const owner = manifests
    .filter((entry) => entry.directory === "." || covers(entry.directory, file))
    .sort((a, b) => b.directory.length - a.directory.length)[0];
  return owner && command.artifactOwners?.includes("workspace:" + owner.directory);
}

function modulePolicyFindings(configuration, modules, activeFiles, root) {
  const findings = [];
  const policies = new Map(configuration.modulePolicies.map((entry) => [entry.module, entry]));
  const actualModules = new Set(modules.map((entry) => entry.root));
  for (const module of policies.keys()) {
    if (!actualModules.has(module))
      findings.push("tenancy policy references missing or non-product module " + module);
  }
  let owners;
  if (configuration.modulePolicies.some((entry) => entry.evidence.length > 0)) {
    try {
      owners = verificationOwners(root, activeFiles);
    } catch (error) {
      findings.push("tenant verification ownership is unavailable: " + error.message);
    }
  }
  for (const entry of modules) {
    const policy = policies.get(entry.root);
    if (!policy) {
      findings.push(
        "active product module " + entry.name + " requires a reviewed tenancy module policy",
      );
      continue;
    }
    for (const file of policy.enforcement)
      requirePublicSource(
        root,
        file,
        activeFiles,
        "tenant enforcement for " + entry.name,
        findings,
      );
    for (const evidence of policy.evidence) {
      const command = owners?.commands.get(evidence.command);
      if (!command)
        findings.push(
          "tenant evidence for " +
            entry.name +
            " references an unselected full-verification command " +
            evidence.command,
        );
      for (const file of evidence.tests) {
        requirePublicSource(
          root,
          file,
          activeFiles,
          "negative tenant evidence for " + entry.name,
          findings,
        );
        if (command && !evidenceIsSelected(command, file, owners.manifests))
          findings.push(
            "tenant evidence " +
              file +
              " is not covered by its existing verifier " +
              evidence.command,
          );
      }
    }
  }
  return findings;
}

/** Validates ownership and selection, never assertion vocabulary or model/security effectiveness. */
export function tenantIsolationProjectFindings({ root = repositoryRoot, relativePaths } = {}) {
  const findings = [];
  const content = readRepositoryFile(root, tenancyConfigurationPath, { optional: true });
  if (content === null)
    return hasProductWorkspace({ root, relativePaths })
      ? ["product implementation requires " + tenancyConfigurationPath]
      : [];
  let configuration;
  try {
    configuration = parseTenancyConfiguration(content);
  } catch (error) {
    return [error.message];
  }
  const paths = relativePaths ?? listActiveFiles({ root });
  const activeFiles = new Set(paths);
  const layout = discoverProductLayout({ repositoryRoot: root, relativePaths: paths });
  findings.push(...layout.findings);
  const files = paths
    .filter(
      (file) =>
        isProductImplementationPath(file, layout) &&
        !testPath.test(file) &&
        sourceExtensions.has(path.posix.extname(file).toLowerCase()),
    )
    .flatMap((relativePath) => {
      try {
        return [{ relativePath, content: readRepositoryFile(root, relativePath) }];
      } catch {
        findings.push(relativePath + ": tenant review requires owned regular source");
        return [];
      }
    });
  if (!files.length) {
    if (configuration.modulePolicies.length || configuration.contextBoundaries.length)
      findings.push("tenancy ownership cannot refer to absent product implementation");
    return findings;
  }
  if (configuration.tenantContext.resolutionStrategy === "pending")
    findings.push("tenant-context resolution must be configured before product implementation");
  const resolver = createLocalImportResolver({ root, relativePaths: paths, productLayout: layout });
  findings.push(...resolver.findings);
  let modules;
  try {
    modules = moduleInventory(root, layout, files);
  } catch (error) {
    return [
      ...findings,
      "tenant ownership requires the current manifest inventory: " + error.message,
    ];
  }
  if (!modules.length)
    findings.push("product implementation has no inventoried module for tenancy ownership");
  for (const file of files) {
    if (!modules.some((entry) => covers(entry.root, file.relativePath)))
      findings.push(
        file.relativePath + ": product source has no inventoried module for tenancy ownership",
      );
  }
  if (!configuration.contextBoundaries.length)
    findings.push(
      "product implementation requires explicit contextBoundaries with resolver, policy and publicContract owners",
    );
  for (const boundary of configuration.contextBoundaries)
    findings.push(
      ...contextBoundaryFindings(
        boundary,
        configuration.modulePolicies,
        modules,
        files,
        layout,
        resolver,
        activeFiles,
        root,
      ),
    );
  findings.push(...modulePolicyFindings(configuration, modules, activeFiles, root));
  return [...new Set(findings)].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const findings = tenantIsolationProjectFindings();
    if (findings.length) {
      console.error(
        "Tenant ownership verification failed:\n" +
          findings.map((finding) => "- " + finding).join("\n"),
      );
      process.exitCode = 1;
    } else
      console.log(
        "Tenancy configuration, ownership and verification bindings passed; execute negative scenarios and review the actual boundary flow for isolation evidence.",
      );
  } catch (error) {
    console.error("Tenant ownership verification failed: " + error.message);
    process.exitCode = 1;
  }
}
