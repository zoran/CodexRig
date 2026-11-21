#!/usr/bin/env node
/** Owns the read-only source-publication baseline without deleting the caller's live runtime. */
import { inspectFrameworkPublicationReset } from "../../../../scripts/framework/framework-reset.mjs";
import { toolingRoot } from "../../../../scripts/filesystem/repository-files.mjs";
import { assertCleanFrameworkPublicationSource } from "./publication-source.mjs";

const candidates = inspectFrameworkPublicationReset();
if (candidates.length > 0)
  throw new Error(`Framework publication requires source cleanup: ${candidates.join(", ")}`);
await assertCleanFrameworkPublicationSource({ repositoryRoot: toolingRoot, tree: "HEAD" });
console.log("Framework publication baseline is clean.");
