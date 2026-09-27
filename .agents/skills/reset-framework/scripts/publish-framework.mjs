#!/usr/bin/env node
/** Owns framework reset and goal-closure hooks around the shared verified publication flow. */
import { realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isReusableFrameworkSource } from "../../../../scripts/contracts/framework-contract.mjs";
import { toolingRoot } from "../../../../scripts/filesystem/repository-files.mjs";
import {
  parsePublicationArguments,
  publishProject,
} from "../../../../scripts/goals/project-publication.mjs";
import { createPublicationOutput } from "../../../../scripts/terminal/publication-output.mjs";
import { inspectFrameworkReset } from "./reset-framework.mjs";

export function parseFrameworkPublicationArguments(args) {
  return parsePublicationArguments(args, "framework:publish");
}

/** Source composition cannot omit reset, central-main admission, or the completed-goal gate. */
export async function publishFramework({ root = toolingRoot, ...options } = {}) {
  if (!isReusableFrameworkSource(root) || realpathSync(root) !== root)
    throw new Error("Publication is available only in the reusable source framework.");
  const reset = async ({ gate, output }) => {
    const candidates = inspectFrameworkReset(root);
    output.detail(
      `Framework reset preview: ${candidates.length} candidate(s).\n${candidates.join("\n")}`,
    );
    if (candidates.length > 0)
      await gate("framework:reset", ["--apply"], "Clear disposable session state");
    await gate("framework:reset", [], "Confirm clean framework baseline");
  };
  return publishProject({
    ...options,
    root,
    requiredBranch: "main",
    displayName: "CodexRig",
    lifecycle: {
      inspect: () => inspectFrameworkReset(root),
      async prepare(context) {
        await reset(context);
        await context.gate(
          "repo:housekeeping",
          ["--", "--apply"],
          "Reconcile source and release version",
        );
      },
      afterVerify: reset,
      beforeCommit() {
        if (inspectFrameworkReset(root).length > 0)
          throw new Error("Reset state reappeared before commit.");
      },
      beforePush: ({ gate }) => gate("framework:reset", [], "Confirm publication baseline"),
      finish: ({ gate }) => gate("goal:new", [], "Check completed publication evidence"),
    },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let output;
  try {
    const options = parseFrameworkPublicationArguments(process.argv.slice(2));
    output = createPublicationOutput({
      root: toolingRoot,
      verbose: options.verbose,
      displayName: "CodexRig",
    });
    await publishFramework({ ...options, output });
  } catch (error) {
    (output ?? createPublicationOutput({ root: toolingRoot })).fail(error);
    process.exitCode = 1;
  }
}
