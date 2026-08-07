#!/usr/bin/env node
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SourceTextModule } from "node:vm";
import { listStagedTransferFiles } from "../repository/source-inventory.mjs";

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
    module = new SourceTextModule(readFileSync(absolutePath, "utf8"), {
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
      findings.push(
        `${relativePath} imports a module outside the staged project: ${displayedSpecifier}`,
      );
      continue;
    }
    try {
      const stats = lstatSync(importedPath);
      if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("not a regular file");
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
  const findings = listStagedTransferFiles({ root: repositoryRoot })
    .filter((relativePath) => relativePath.endsWith(".mjs"))
    .flatMap((relativePath) => relativeImportFindings(repositoryRoot, relativePath))
    .sort();
  if (findings.length > 0) {
    throw new Error(
      ["Staged project static module imports failed:", ...findings.map((item) => `- ${item}`)].join(
        "\n",
      ),
    );
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
