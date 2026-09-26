#!/usr/bin/env node
/** Exposes bounded context reads, repository navigation and deterministic instruction-budget checks. */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readRepositoryFile, toolingRoot } from "../filesystem/repository-files.mjs";
import {
  boundedContextOutput,
  documentContextExcerpt,
  readContextDocument,
} from "../docs/document-context.mjs";
import { contextBudgets, inspectContextBudget } from "./context-budget.mjs";

export function repositoryContextMap(root = toolingRoot) {
  const manifest = readRepositoryFile(root, "docs/project.md");
  const modules = [];
  let heading = "";
  for (const line of manifest.split(/\r?\n/u)) {
    if (/^#### /u.test(line)) heading = line.slice(5);
    if (/^- Root: /u.test(line)) modules.push(`${heading}: ${line.slice(8)}`);
  }
  const links = manifest
    .split(/\r?\n/u)
    .filter((line) => /^- (?:Requirements owner|Architecture owner|UI reference): /u.test(line));
  return boundedContextOutput(
    [
      "Repository context map (navigation only; read relevant owners before decisions).",
      ...links,
      `Active module roots (${modules.length}):`,
      ...modules,
      "Workflow: instructions.md; inspect its outline, then the sections applicable to this task.",
      "Product facts: docs/project.md; use an outline and relevant sections, not a full specification dump.",
      "Recovery: inspect only the current bounded docs/project-context.md when resuming authorized work.",
      "Run pnpm worktree:status -- --json separately for actual worktrees, leases and recovery.",
      "At every audit assess repository-wide effectiveness, efficiency and quality; a map or byte check proves none of them.",
    ].join("\n") + "\n",
  );
}

export function contextCommand(args, root = toolingRoot) {
  const argv = args.filter((arg) => arg !== "--");
  const mode = argv.shift();
  if (mode === "check") {
    if (argv.some((arg) => arg !== "--json") || argv.length > 1)
      throw new Error("Usage: context:check [--json]");
    const report = inspectContextBudget(root);
    return {
      failed: report.findings.length > 0,
      output: argv.length
        ? JSON.stringify(report, null, 2) + "\n"
        : [
            `Repository automatic context: ${report.automaticBytes}/${contextBudgets.automatic} bytes (conservative estimate).`,
            `Largest delegated context: ${report.delegatedBytes}/${contextBudgets.automatic} bytes (inherited context plus one role).`,
            ...report.findings,
            report.evidence,
          ].join("\n") + "\n",
    };
  }
  if (mode === "map" && !argv.length) return { output: repositoryContextMap(root) };
  if (mode !== "read" || !argv.length)
    throw new Error(
      "Usage: context:read <document> [--outline [--offset N] | --section <heading> | --lines first:last]",
    );
  const file = argv.shift(),
    options = {};
  while (argv.length) {
    const flag = argv.shift();
    if (flag === "--outline" && !options.outline) options.outline = true;
    else if (
      ["--section", "--lines", "--offset"].includes(flag) &&
      argv.length &&
      !Object.hasOwn(options, flag.slice(2))
    )
      options[flag.slice(2)] = flag === "--offset" ? Number(argv.shift()) : argv.shift();
    else throw new Error("Unknown or repeated context read option.");
  }
  if (options.outline && (options.lines || options.section))
    throw new Error("Outline cannot be combined with an excerpt.");
  return { output: documentContextExcerpt(readContextDocument(root, file), options) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = contextCommand(process.argv.slice(2));
    process.stdout.write(result.output);
    if (result.failed) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
