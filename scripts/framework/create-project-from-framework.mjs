#!/usr/bin/env node
/** Owns create project from framework behavior for the portable clean-project generation boundary. */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { formatContextError } from "../terminal/terminal-output.mjs";
import { prepareProject } from "./prepare-project.mjs";
import {
  defaultDirectoryName,
  directoryName,
  fail,
  normalizedName,
  normalizedProjectDescription,
  parseArgs,
  resolveProjectRoots,
  slugify,
  usage,
} from "./project-options.mjs";
import {
  assertProjectSourceReady,
  assertSourceProductBoundaryClean,
  postProjectCreationGuidance,
} from "./source-readiness.mjs";
import {
  assertSourceGitStateUnchanged,
  captureSourceGitState,
  sourceHasGitChanges,
} from "./source-git-state.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultSourceRoot = path.resolve(scriptDirectory, "..", "..");
async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const projectName = normalizedName(options.name);
  const projectDescription = normalizedProjectDescription(options.description);
  const projectDirectoryName = directoryName(
    options.directory || defaultDirectoryName(projectName),
  );
  const packageName = slugify(projectDirectoryName, "package name");
  const roots = resolveProjectRoots({ defaultSourceRoot, options, projectDirectoryName });
  const sourceGitState = captureSourceGitState(roots.sourceRoot);
  assertProjectSourceReady(roots.sourceRoot);
  assertSourceProductBoundaryClean(roots.sourceRoot);
  const stagingProjectRoot = path.join(
    roots.outputParent,
    `.${projectDirectoryName}.staging-${process.pid}-${randomUUID()}`,
  );
  const stagingRoot = path.join(stagingProjectRoot, "code");
  let staged = false;
  let published = false;
  let sourceHasChanges = false;

  try {
    mkdirSync(stagingProjectRoot, { mode: 0o700 });
    staged = true;
    mkdirSync(stagingRoot, { mode: 0o700 });
    await prepareProject({
      sourceRoot: roots.sourceRoot,
      targetRoot: stagingRoot,
      projectName,
      projectDescription,
      packageName,
      includeUntracked: options.includeUntracked,
      skipVerify: options.skipVerify,
    });
    assertProjectSourceReady(roots.sourceRoot);
    assertSourceProductBoundaryClean(roots.sourceRoot);
    assertSourceGitStateUnchanged(roots.sourceRoot, sourceGitState);
    if (existsSync(roots.projectRoot)) fail("Target project directory appeared during creation.");
    renameSync(stagingProjectRoot, roots.projectRoot);
    staged = false;
    published = true;
    assertProjectSourceReady(roots.sourceRoot);
    assertSourceProductBoundaryClean(roots.sourceRoot);
    assertSourceGitStateUnchanged(roots.sourceRoot, sourceGitState);
    assertProjectSourceReady(roots.sourceRoot);
    assertSourceProductBoundaryClean(roots.sourceRoot);
    assertSourceGitStateUnchanged(roots.sourceRoot, sourceGitState);
    sourceHasChanges = sourceHasGitChanges(roots.sourceRoot);
    published = false;
  } catch (error) {
    if (staged && existsSync(stagingProjectRoot)) {
      rmSync(stagingProjectRoot, { force: true, recursive: true });
    }
    if (published && existsSync(roots.projectRoot)) {
      rmSync(roots.projectRoot, { force: true, recursive: true });
    }
    throw error;
  }
  console.log("Created the project successfully in its requested output workspace.");
  console.log("Source tracked and portable files remained unchanged.");
  console.log("Run pnpm setup in the generated project to validate its policy and tooling.");
  console.log(
    projectDescription
      ? "The supplied detailed description is stored as an intake draft; on first start Codex evaluates it and asks whether to refine it or begin from the confirmed decision-ready scope."
      : "The manifest remains pending; on first start Codex asks for a detailed description and actively guides the definition interview before implementation.",
  );
  for (const line of postProjectCreationGuidance({ sourceHasChanges })) console.log(line);
}
try {
  await main();
} catch (error) {
  console.error("Project creation failed: " + formatContextError(error, defaultSourceRoot));
  console.error(usage());
  process.exit(1);
}
