#!/usr/bin/env node
import process from "node:process";
import { fileURLToPath } from "node:url";
import { packageManifestFindings } from "./package-manifest.mjs";

export const requiredRootVerificationEntrypoints = Object.freeze({
  verify: "node scripts/verify/adaptive.mjs --mode full",
  "verify:changed": "node scripts/verify/adaptive.mjs --mode repo",
  "verify:pre-push": "bash scripts/verify/pre-push.sh",
});

export function verificationEntrypointFindings({ repositoryRoot } = {}) {
  return packageManifestFindings({
    expectedScripts: requiredRootVerificationEntrypoints,
    repositoryRoot,
  });
}

function main() {
  const findings = verificationEntrypointFindings();
  if (findings.length > 0) {
    findings.forEach((finding) => console.error(`- ${finding}`));
    process.exitCode = 1;
    return;
  }
  console.log("Root verification entry points use adaptive admission.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
