/** Owns preparation and validation shared by new project directories and source-owned archives. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  projectOutputProjection,
  assertIndependentProjectOutput,
} from "./project-output-projection.mjs";
import { copyPortableProjectTree } from "./project-copy.mjs";
import { enableGeneratedProjectMemories } from "./generated-codex-config.mjs";
import { writeIdentityDocs } from "./generated-project-documents.mjs";
import { writeSelectedProjectTooling } from "./generated-project-tooling.mjs";
import {
  assertGeneratedProjectClean,
  assertGeneratedProjectParity,
  formatGeneratedMarkdown,
  runGeneratedNode,
  updateGeneratedPackage,
} from "./generated-project-finalization.mjs";
import { normalizedName, normalizedProjectDescription, slugify } from "./project-options.mjs";
import { validateGeneratedProject } from "./validate-staged-project.mjs";

/** The caller owns a new empty staging directory and its failure cleanup. Never updates a project. */
export async function prepareProject({
  sourceRoot,
  targetRoot,
  projectName,
  projectDescription = "",
  packageName,
  includeUntracked = false,
  skipVerify = false,
}) {
  const name = normalizedName(projectName);
  const description = normalizedProjectDescription(projectDescription);
  const identity = packageName ?? slugify(name, "package name");
  const transferManifest = copyPortableProjectTree(sourceRoot, targetRoot, { includeUntracked });
  mkdirSync(path.join(targetRoot, "src"));
  writeFileSync(path.join(targetRoot, "src/.gitkeep"), "", { mode: 0o644 });
  writeIdentityDocs(sourceRoot, targetRoot, name, description);
  updateGeneratedPackage(sourceRoot, targetRoot, identity);
  enableGeneratedProjectMemories(targetRoot);
  writeSelectedProjectTooling(sourceRoot, targetRoot);
  projectOutputProjection(targetRoot);
  formatGeneratedMarkdown(sourceRoot, targetRoot);
  assertIndependentProjectOutput(targetRoot);
  await validateGeneratedProject(targetRoot);
  if (!skipVerify) runGeneratedNode(targetRoot, "scripts/verify/repository-smoke.mjs");
  assertGeneratedProjectClean(targetRoot, identity, { projectDescription: description });
  assertGeneratedProjectParity({
    sourceRoot,
    targetRoot,
    transferManifest,
    projectDescription: description,
  });
}
