#!/usr/bin/env node
import process from "node:process";
import { fileURLToPath } from "node:url";
import { detectGitProvider } from "./git-provider.mjs";

function main() {
  const args = new Set(process.argv.slice(2).filter((argument) => argument !== "--"));
  const unknown = [...args].filter((argument) => !["--json", "--help", "-h"].includes(argument));
  if (unknown.length > 0) throw new Error(`Unknown platform detection option: ${unknown[0]}.`);
  if (args.has("--help") || args.has("-h")) {
    console.log("Usage: pnpm platform:detect [-- --json]");
    return;
  }
  const detected = detectGitProvider();
  if (args.has("--json")) {
    console.log(JSON.stringify(detected, null, 2));
    return;
  }
  if (!detected.provider) {
    console.log(
      "Git platform: not configured (provider will be detected after a remote is added).",
    );
    return;
  }
  console.log(`Git platform: ${detected.provider} (${detected.source}).`);
  if (detected.slug) console.log(`Repository: ${detected.slug}.`);
  console.log(`Integration branch: ${detected.integrationBranch}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Git platform detection failed: ${error.message}`);
    process.exit(1);
  }
}
