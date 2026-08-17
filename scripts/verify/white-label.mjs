/** Owns white label behavior for the repository verification boundary. */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  configuredProductFacingValues,
  parseProductConfiguration,
  productConfigurationFindings,
  productConfigurationPath,
} from "../contracts/product-configuration.mjs";
import { isReusableFrameworkSource } from "../contracts/framework-contract.mjs";
import { discoverProductLayout } from "../repository/product-roots.mjs";
import { listActiveFiles } from "../repository/source-inventory.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const maximumInspectedBytes = 2 * 1024 * 1024;
const productFacingFilenamePattern =
  /(?:^|\/)(?:AndroidManifest\.xml|Info\.plist|app\.config\.[^/]+|app\.json|manifest\.json|site\.webmanifest)$/u;
const productFacingDirectoryPattern = /(?:^|\/)(?:assets|public|static)(?:\/|$)/u;
const frameworkBoundaryReferencePattern =
  /(?:\.agents|\.codexrig|\.codex)(?:[\\/]|$)|(?:\.\.[\\/])+scripts[\\/]/iu;

function pathInside(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function productFacingPath(relativePath, sourceRoots) {
  if (
    relativePath.startsWith(".agents/") ||
    relativePath.startsWith(".codex/") ||
    relativePath.startsWith(".codexrig/") ||
    relativePath.startsWith("docs/") ||
    relativePath.startsWith("scripts/")
  ) {
    return false;
  }
  return (
    sourceRoots.some((sourceRoot) => pathInside(relativePath, sourceRoot)) ||
    productFacingDirectoryPattern.test(relativePath) ||
    productFacingFilenamePattern.test(relativePath)
  );
}

function readableSurface(root, relativePath, findings) {
  const target = path.join(root, ...relativePath.split("/"));
  try {
    const stats = lstatSync(target);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      findings.push(`${relativePath} must be a regular file for white-label inspection`);
      return null;
    }
    if (stats.size > maximumInspectedBytes) {
      findings.push(`${relativePath} is too large for deterministic white-label inspection`);
      return null;
    }
    const bytes = readFileSync(target);
    if (bytes.includes(0)) return null;
    return bytes.toString("utf8");
  } catch {
    findings.push(`${relativePath} could not be inspected for white-label leakage`);
    return null;
  }
}

function configurationContent(root, required, findings) {
  const target = path.join(root, ...productConfigurationPath.split("/"));
  if (!existsSync(target)) {
    if (required) findings.push(`missing required white-label owner: ${productConfigurationPath}`);
    return null;
  }
  try {
    const stats = lstatSync(target);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      findings.push(`${productConfigurationPath} must be a non-symlink regular file`);
      return null;
    }
    return readFileSync(target, "utf8");
  } catch {
    findings.push(`${productConfigurationPath} could not be read`);
    return null;
  }
}

export function whiteLabelProjectFindings({ root = repositoryRoot, relativePaths } = {}) {
  const sourceFramework = isReusableFrameworkSource(root);
  const findings = [];
  const content = configurationContent(root, !sourceFramework, findings);
  if (sourceFramework && content !== null) {
    findings.push("the neutral source framework must not own a child product configuration");
  }

  let configuredValues = [];
  if (content !== null) {
    const configurationFindings = productConfigurationFindings(content);
    findings.push(...configurationFindings);
    if (configurationFindings.length === 0) {
      configuredValues = configuredProductFacingValues(parseProductConfiguration(content));
    }
  }

  const activeFiles = relativePaths ?? listActiveFiles({ root });
  const layout = discoverProductLayout({ repositoryRoot: root, relativePaths: activeFiles });
  for (const relativePath of activeFiles) {
    if (!productFacingPath(relativePath, layout.sourceRoots)) continue;
    if (/codexrig/iu.test(relativePath)) {
      findings.push(`${relativePath} leaks CodexRig branding through a product-facing path`);
    }
    const surface = readableSurface(root, relativePath, findings);
    if (surface === null) continue;
    if (/codexrig/iu.test(surface)) {
      findings.push(`${relativePath} leaks CodexRig branding into a product-facing surface`);
    }
    if (frameworkBoundaryReferencePattern.test(surface)) {
      findings.push(`${relativePath} crosses from product code into a framework-owned boundary`);
    }
    const normalizedSurface = surface.toLocaleLowerCase("en-US");
    for (const value of configuredValues) {
      if (normalizedSurface.includes(value.toLocaleLowerCase("en-US"))) {
        findings.push(
          `${relativePath} repeats configured public identity ${JSON.stringify(value)} instead of deriving it from ${productConfigurationPath}`,
        );
      }
    }
  }
  return [...new Set(findings)].sort();
}

function main() {
  const findings = whiteLabelProjectFindings();
  if (findings.length > 0) {
    console.error("White-label product verification failed:");
    for (const finding of findings) console.error(`- ${finding}`);
    process.exitCode = 1;
    return;
  }
  console.log("White-label product configuration and public surfaces passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main();
