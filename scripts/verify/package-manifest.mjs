#!/usr/bin/env node
import { lstatSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { listActiveFiles } from "../repository/source-inventory.mjs";
import {
  captureStableRepositoryFileIdentity,
  readStableRepositoryFile,
} from "../repository/stable-file-snapshot.mjs";
import { normalizePath, root as defaultRoot } from "./adaptive-state.mjs";

const stringMapFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "scripts",
];
const maximumManifestBytes = 1024 * 1024;
const maximumOwnedExportsBytes = 128 * 1024;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stringMapFindings(manifest, field, relativePath) {
  const value = manifest[field];
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [`${relativePath} ${field} must be an object`];
  }
  return Object.entries(value)
    .filter(
      ([name, entry]) =>
        !name ||
        typeof entry !== "string" ||
        !entry ||
        entry.length > 16_384 ||
        /[\0\r\n]/u.test(name) ||
        /[\0\r\n]/u.test(entry),
    )
    .map(([name]) => `${relativePath} ${field} entry ${JSON.stringify(name)} is invalid`);
}

function targetFindings(value, label) {
  if (value === null) return [];
  if (typeof value === "string") {
    return value.startsWith("./") && !value.split("/").includes("..")
      ? []
      : [`${label} target must be a safe package-relative path`];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => targetFindings(entry, `${label}[${index}]`));
  }
  if (!value || typeof value !== "object") return [`${label} target is invalid`];
  const keys = Object.keys(value);
  const subpaths = keys.filter((key) => key.startsWith("."));
  if (subpaths.length > 0 && subpaths.length !== keys.length) {
    return [`${label} cannot mix subpath keys with condition keys`];
  }
  return Object.entries(value).flatMap(([key, entry]) => {
    if (!key || /[\0\r\n]/u.test(key)) return [`${label} has an invalid key`];
    if (subpaths.length > 0 && key !== "." && !key.startsWith("./")) {
      return [`${label} subpath ${JSON.stringify(key)} is invalid`];
    }
    return targetFindings(entry, `${label}.${key}`);
  });
}

function exportTarget(exportsValue, subpath) {
  if (
    subpath === "." &&
    (!exportsValue ||
      typeof exportsValue !== "object" ||
      Array.isArray(exportsValue) ||
      !Object.keys(exportsValue).some((key) => key.startsWith(".")))
  ) {
    return exportsValue;
  }
  if (!exportsValue || typeof exportsValue !== "object" || Array.isArray(exportsValue)) {
    return undefined;
  }
  return exportsValue[subpath];
}

export function ownedPackageExportFindings({
  expectedExports,
  manifest,
  relativePath = "package.json",
}) {
  if (
    !expectedExports ||
    typeof expectedExports !== "object" ||
    Array.isArray(expectedExports) ||
    Object.keys(expectedExports).length > 256
  ) {
    return [`${relativePath} owned exports must be a bounded subpath registry`];
  }
  const findings = [];
  for (const [subpath, expectedTarget] of Object.entries(expectedExports)) {
    if (
      (subpath !== "." && !subpath.startsWith("./")) ||
      subpath.length > 1_024 ||
      /[\0\r\n]/u.test(subpath)
    ) {
      findings.push(`${relativePath} owned export subpath ${JSON.stringify(subpath)} is invalid`);
      continue;
    }
    findings.push(
      ...targetFindings(expectedTarget, `${relativePath} expected owned export ${subpath}`),
    );
    const actualTarget = exportTarget(manifest.exports, subpath);
    if (actualTarget === undefined) {
      findings.push(`${relativePath} owned export ${subpath} is missing`);
    } else if (canonicalJson(actualTarget) !== canonicalJson(expectedTarget)) {
      findings.push(`${relativePath} owned export ${subpath} changed its expected contract`);
    }
  }
  return findings;
}

export function ownedPackageScriptFindings({
  expectedScripts,
  manifest,
  relativePath = "package.json",
}) {
  if (
    !expectedScripts ||
    typeof expectedScripts !== "object" ||
    Array.isArray(expectedScripts) ||
    Object.keys(expectedScripts).length > 64
  ) {
    return [`${relativePath} owned scripts must be a bounded registry`];
  }
  const findings = [];
  for (const [name, expectedCommand] of Object.entries(expectedScripts)) {
    if (
      !name ||
      name.length > 256 ||
      /[\0\r\n]/u.test(name) ||
      typeof expectedCommand !== "string" ||
      !expectedCommand ||
      expectedCommand.length > 16_384 ||
      /[\0\r\n]/u.test(expectedCommand)
    ) {
      findings.push(`${relativePath} expected owned script ${JSON.stringify(name)} is invalid`);
    } else if (manifest.scripts?.[name] !== expectedCommand) {
      findings.push(`${relativePath} owned script ${name} changed its expected entry point`);
    }
  }
  return findings;
}

export function ownedExportsContractPath(manifestPath) {
  const directory = path.posix.dirname(manifestPath);
  return directory === "." ? "package.exports.json" : `${directory}/package.exports.json`;
}

function readOwnedExportsContract({ manifestPath, repositoryRoot }) {
  const relativePath = ownedExportsContractPath(manifestPath);
  try {
    lstatSync(path.join(repositoryRoot, ...relativePath.split("/")));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { expectedExports: undefined, findings: [] };
    }
    return {
      expectedExports: undefined,
      findings: [`${relativePath} cannot be inspected safely`],
    };
  }
  let captured;
  try {
    captured = captureStableRepositoryFileIdentity({ repositoryRoot, relativePath });
  } catch {
    return {
      expectedExports: undefined,
      findings: [`${relativePath} is missing or unsafe`],
    };
  }
  if (captured.bytes > maximumOwnedExportsBytes) {
    return { expectedExports: undefined, findings: [`${relativePath} is oversized`] };
  }
  let contract;
  try {
    contract = JSON.parse(
      readStableRepositoryFile({
        repositoryRoot,
        relativePath,
        expectedIdentity: captured.identity,
      }).buffer.toString("utf8"),
    );
  } catch {
    return {
      expectedExports: undefined,
      findings: [`${relativePath} is not stable valid JSON`],
    };
  }
  if (
    !contract ||
    typeof contract !== "object" ||
    Array.isArray(contract) ||
    Object.keys(contract).sort().join("\n") !== "ownedExports\nschemaVersion" ||
    contract.schemaVersion !== 1
  ) {
    return {
      expectedExports: undefined,
      findings: [`${relativePath} must contain schemaVersion 1 and ownedExports`],
    };
  }
  return { expectedExports: contract.ownedExports, findings: [] };
}

export function packageManifestFindings({
  expectedExports,
  expectedScripts,
  repositoryRoot = defaultRoot,
  relativePath = "package.json",
} = {}) {
  const normalized = normalizePath(relativePath);
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    normalized.split("/").some((segment) => segment === "..") ||
    path.posix.basename(normalized) !== "package.json"
  ) {
    return ["package manifest path is unsafe"];
  }
  let captured;
  try {
    captured = captureStableRepositoryFileIdentity({
      repositoryRoot,
      relativePath: normalized,
    });
  } catch {
    return [`${normalized} is missing or unsafe`];
  }
  if (captured.bytes > maximumManifestBytes) return [`${normalized} is oversized`];
  let manifest;
  try {
    manifest = JSON.parse(
      readStableRepositoryFile({
        repositoryRoot,
        relativePath: normalized,
        expectedIdentity: captured.identity,
      }).buffer.toString("utf8"),
    );
  } catch {
    return [`${normalized} is not stable valid JSON`];
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return [`${normalized} must contain one JSON object`];
  }
  const findings = stringMapFields.flatMap((field) =>
    stringMapFindings(manifest, field, normalized),
  );
  for (const field of ["name", "packageManager", "type", "version"]) {
    if (
      manifest[field] !== undefined &&
      (typeof manifest[field] !== "string" ||
        !manifest[field] ||
        manifest[field].length > 1_024 ||
        /[\0\r\n]/u.test(manifest[field]))
    ) {
      findings.push(`${normalized} ${field} must be a bounded nonempty string`);
    }
  }
  if (manifest.private !== undefined && typeof manifest.private !== "boolean") {
    findings.push(`${normalized} private must be a boolean`);
  }
  if (manifest.exports !== undefined) {
    findings.push(...targetFindings(manifest.exports, `${normalized} exports`));
  }
  const ownedExports =
    expectedExports === undefined
      ? readOwnedExportsContract({ manifestPath: normalized, repositoryRoot })
      : { expectedExports, findings: [] };
  findings.push(...ownedExports.findings);
  if (ownedExports.expectedExports !== undefined) {
    findings.push(
      ...ownedPackageExportFindings({
        expectedExports: ownedExports.expectedExports,
        manifest,
        relativePath: normalized,
      }),
    );
  }
  if (expectedScripts !== undefined) {
    findings.push(
      ...ownedPackageScriptFindings({ expectedScripts, manifest, relativePath: normalized }),
    );
  }
  return findings;
}

function parseArgs(argv) {
  const paths = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--path") paths.push(argv[++index] ?? "");
    else if (argument.startsWith("--path=")) paths.push(argument.slice("--path=".length));
    else throw new Error(`Unknown package-manifest argument: ${argument}`);
  }
  return paths;
}

function main() {
  const requested = parseArgs(process.argv.slice(2));
  const manifestPaths =
    requested.length > 0
      ? requested
      : listActiveFiles({ root: defaultRoot }).filter(
          (relativePath) => path.posix.basename(relativePath) === "package.json",
        );
  const findings = [
    ...new Set(
      manifestPaths.flatMap((relativePath) =>
        packageManifestFindings({ relativePath, repositoryRoot: defaultRoot }),
      ),
    ),
  ];
  if (findings.length > 0) {
    findings.forEach((finding) => console.error(`- ${finding}`));
    process.exitCode = 1;
    return;
  }
  console.log(`Package manifest verification passed for ${manifestPaths.length} manifest(s).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
