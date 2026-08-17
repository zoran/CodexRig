#!/usr/bin/env node
/** Verifies the non-executing pnpm configuration boundary before any trusted pnpm process starts. */
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertTrustedPnpmConfiguration,
  trustedPnpmConfigurationFindings,
} from "../repository/pnpm-workspace-manifests.mjs";
import { repositoryRoot } from "../repository/source-inventory.mjs";
import { formatContextError } from "../terminal/terminal-output.mjs";

export function verifyPnpmExecutionPolicy({ root = repositoryRoot } = {}) {
  const findings = trustedPnpmConfigurationFindings({ repositoryRoot: root });
  if (findings.length > 0) {
    assertTrustedPnpmConfiguration({ repositoryRoot: root });
  }
  return { findings, root };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    verifyPnpmExecutionPolicy();
    console.log("Trusted pnpm execution policy passed.");
  } catch (error) {
    console.error(
      `Trusted pnpm execution policy failed: ${formatContextError(error, repositoryRoot)}`,
    );
    process.exit(1);
  }
}
