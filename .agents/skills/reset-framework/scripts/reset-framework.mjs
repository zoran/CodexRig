#!/usr/bin/env node
/** Runs the framework reset command with its explicit preview and apply modes. */
import { runFrameworkReset } from "../../../../scripts/framework/framework-reset.mjs";

try {
  runFrameworkReset(process.argv.slice(2));
} catch (error) {
  console.error(`Framework reset failed: ${error.message}`);
  process.exitCode = 1;
}
