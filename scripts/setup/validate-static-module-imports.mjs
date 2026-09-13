#!/usr/bin/env node
/** Owns validate static module imports behavior for the setup, launch, and portable project boundary. */
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SourceTextModule } from "node:vm";
import { listActiveFiles } from "../repository/source-inventory.mjs";
import { readRepositoryFile } from "../filesystem/repository-files.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");

function isInsideRoot(root, candidate) {
  const relativePath = path.relative(root, candidate);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath))
  );
}

function relativeImportFindings(root, relativePath) {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  let module;
  try {
    module = new SourceTextModule(readRepositoryFile(root, relativePath), {
      identifier: relativePath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.split(/\r?\n/u, 1)[0] : String(error);
    return [`${relativePath} is not a valid ECMAScript module: ${message}`];
  }

  const findings = [];
  for (const request of module.moduleRequests) {
    const specifier = request.specifier;
    if (!specifier.startsWith(".")) continue;
    const displayedSpecifier = JSON.stringify(specifier);
    let importedPath;
    try {
      importedPath = fileURLToPath(new URL(specifier, pathToFileURL(absolutePath)));
    } catch {
      findings.push(`${relativePath} has an invalid relative module import: ${displayedSpecifier}`);
      continue;
    }
    if (!isInsideRoot(root, importedPath)) {
      findings.push(`${relativePath} imports a module outside the project: ${displayedSpecifier}`);
      continue;
    }
    try {
      readRepositoryFile(root, path.relative(root, importedPath).split(path.sep).join("/"));
    } catch {
      findings.push(`${relativePath} imports a missing relative module: ${displayedSpecifier}`);
    }
  }
  return findings;
}

function main() {
  if (typeof SourceTextModule !== "function") {
    throw new Error("Static module validation requires Node.js --experimental-vm-modules.");
  }
  const findings = listActiveFiles({ root: repositoryRoot })
    .filter((relativePath) => relativePath.endsWith(".mjs"))
    .flatMap((relativePath) => relativeImportFindings(repositoryRoot, relativePath))
    .sort();
  if (findings.length > 0) {
    throw new Error(
      ["Project static module imports failed:", ...findings.map((item) => `- ${item}`)].join("\n"),
    );
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
