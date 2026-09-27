#!/usr/bin/env node
/** Owns the read-only source-publication baseline without deleting the caller's live runtime. */
import { inspectFrameworkPublicationReset } from "./reset-framework.mjs";

const candidates = inspectFrameworkPublicationReset();
if (candidates.length > 0)
  throw new Error(`Framework publication requires source cleanup: ${candidates.join(", ")}`);
console.log("Framework publication baseline is clean.");
