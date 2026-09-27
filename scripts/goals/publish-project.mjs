#!/usr/bin/env node
/** Owns the explicit project publication CLI; it never resets native sessions or deploys products. */
import process from "node:process";
import { parseJsonFile, toolingRoot } from "../filesystem/repository-files.mjs";
import { createPublicationOutput } from "../terminal/publication-output.mjs";
import { parsePublicationArguments, publishProject } from "./project-publication.mjs";

let output;
try {
  const options = parsePublicationArguments(process.argv.slice(2));
  const displayName = parseJsonFile(toolingRoot, "package.json", "Project package").name;
  output = createPublicationOutput({ root: toolingRoot, verbose: options.verbose, displayName });
  await publishProject({ ...options, output });
} catch (error) {
  (output ?? createPublicationOutput({ root: toolingRoot })).fail(error);
  process.exitCode = 1;
}
