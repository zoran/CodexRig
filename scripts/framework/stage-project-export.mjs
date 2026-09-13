/** Owns named product export staging through the same preparation boundary as sibling creation. */
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { repositoryRoot } from "../repository/source-inventory.mjs";
import { prepareProject } from "./prepare-project.mjs";
import { assertProjectSourceReady, assertSourceProductBoundaryClean } from "./source-readiness.mjs";
import { captureSourceGitState, assertSourceGitStateUnchanged } from "./source-git-state.mjs";
import { formatContextError } from "../terminal/terminal-output.mjs";

function contained(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

export async function stageProjectExport({
  sourceRoot = repositoryRoot,
  targetRoot,
  projectName,
  projectDescription = "",
  includeUntracked = false,
} = {}) {
  if (!targetRoot || !projectName)
    throw new Error("Export requires a new staging target and a project name.");
  const source = realpathSync(sourceRoot);
  const parent = realpathSync(path.dirname(targetRoot));
  const target = path.resolve(targetRoot);
  if (path.dirname(target) !== parent || contained(target, source) || contained(source, target))
    throw new Error(
      "Export staging must be directly below its real parent, outside the source repository.",
    );
  try {
    lstatSync(target);
    throw new Error("Export staging target already exists.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const sourceGitState = captureSourceGitState(source);
  assertProjectSourceReady(source);
  assertSourceProductBoundaryClean(source);
  mkdirSync(target, { mode: 0o700 });
  const identity = lstatSync(target);
  try {
    await prepareProject({
      sourceRoot: source,
      targetRoot: target,
      projectName,
      projectDescription,
      includeUntracked,
    });
    assertSourceGitStateUnchanged(source, sourceGitState);
  } catch (error) {
    if (existsSync(target)) {
      const current = lstatSync(target);
      if (!current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino)
        rmSync(target, { force: true, recursive: true });
    }
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [targetRoot, projectName, projectDescription] = process.argv.slice(2);
    if (process.argv.length < 4 || process.argv.length > 5)
      throw new Error(
        'Usage: node scripts/framework/stage-project-export.mjs <new-directory> "<project-name>" ["<description>"]',
      );
    await stageProjectExport({ targetRoot, projectName, projectDescription });
  } catch (error) {
    console.error(`Project export staging failed: ${formatContextError(error, repositoryRoot)}`);
    process.exitCode = 1;
  }
}
