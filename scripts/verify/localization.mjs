/** Owns localization behavior for the repository verification boundary. */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  localizationConfigurationFindings,
  localizationConfigurationPath,
  parseLocalizationConfiguration,
} from "../contracts/localization-configuration.mjs";
import { hasProductWorkspace } from "../repository/product-roots.mjs";
import {
  discoverProductLayout,
  isProductImplementationPath,
} from "../repository/product-roots.mjs";
import { listActiveFiles, repositoryRoot } from "../repository/source-inventory.mjs";

const manifestPath = "docs/project.md";
const disposableProductPathPattern = /(?:^|\/)(?:\.gitkeep|\.keep)$/u;

function readRegular(root, relativePath, findings, requiredMessage) {
  const target = path.join(root, ...relativePath.split("/"));
  if (!existsSync(target)) {
    if (requiredMessage) findings.push(requiredMessage);
    return null;
  }
  try {
    const stats = lstatSync(target);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      findings.push(`${relativePath} must be a non-symlink regular file`);
      return null;
    }
    return readFileSync(target, "utf8");
  } catch {
    findings.push(`${relativePath} could not be read`);
    return null;
  }
}

function manifestLocalizationFindings(manifest, configuration) {
  const findings = [];
  const languageLine = manifest
    .split(/\r?\n/u)
    .find((line) => line.includes("Product languages and localization:"));
  if (!languageLine) {
    return [`${manifestPath} must record Product languages and localization`];
  }
  if (
    !/source code, identifiers, filenames, and technical source documentation use English/iu.test(
      manifest,
    )
  ) {
    findings.push(`${manifestPath} must preserve the English source-language contract`);
  }
  if (configuration.userFacing.strategy === "pending") {
    if (!/Product languages and localization:\s*pending/iu.test(languageLine)) {
      findings.push(
        `${manifestPath} must keep pending localization truth aligned with configuration`,
      );
    }
    return findings;
  }
  for (const expected of [
    configuration.userFacing.strategy,
    configuration.userFacing.defaultLocale,
    ...configuration.userFacing.supportedLocales,
  ]) {
    if (!languageLine.includes(expected)) {
      findings.push(`${manifestPath} localization line must include ${expected}`);
    }
  }
  if (
    configuration.userFacing.fallbackLocale &&
    !languageLine.includes(configuration.userFacing.fallbackLocale)
  ) {
    findings.push(
      `${manifestPath} localization line must include fallback ${configuration.userFacing.fallbackLocale}`,
    );
  }
  return findings;
}

export function localizationProjectFindings({
  root = repositoryRoot,
  relativePaths = listActiveFiles({ root }),
} = {}) {
  const findings = [];
  const requiresProduct = hasProductWorkspace({ root, relativePaths });
  const content = readRegular(
    root,
    localizationConfigurationPath,
    findings,
    !requiresProduct ? "" : `missing required localization owner: ${localizationConfigurationPath}`,
  );
  if (content === null) return [...new Set(findings)].sort();

  const configurationFindings = localizationConfigurationFindings(content);
  findings.push(...configurationFindings);
  if (configurationFindings.length > 0) return [...new Set(findings)].sort();
  const configuration = parseLocalizationConfiguration(content);
  const productLayout = discoverProductLayout({ repositoryRoot: root, relativePaths });
  const hasProductImplementation = relativePaths.some(
    (relativePath) =>
      isProductImplementationPath(relativePath, productLayout) &&
      !disposableProductPathPattern.test(relativePath),
  );
  if (hasProductImplementation && configuration.userFacing.strategy === "pending") {
    findings.push(
      "user-facing language and localization strategy must be configured before product implementation",
    );
  }
  const manifest = readRegular(
    root,
    manifestPath,
    findings,
    `missing localization truth owner: ${manifestPath}`,
  );
  if (manifest !== null) findings.push(...manifestLocalizationFindings(manifest, configuration));
  return [...new Set(findings)].sort();
}

function main() {
  const findings = localizationProjectFindings();
  if (findings.length > 0) {
    console.error("Localization verification failed:");
    for (const finding of findings) console.error(`- ${finding}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    "Localization passed (English source language and explicit user-facing locale strategy).",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main();
