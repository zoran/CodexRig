/** Executes the current repository's explicitly selected pre-push prerequisites. */
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readVerificationConfiguration } from "./verification-configuration.mjs";
import { toolingRoot, readRepositoryFile } from "../filesystem/repository-files.mjs";
import { spawnSyncWithBoundedIo } from "../repository/runtime-process-io.mjs";
export function runSelectedPrePushPolicy(root = toolingRoot) {
  for (const file of readVerificationConfiguration(root).prePushChecks) {
    readRepositoryFile(root, file);
    const result = spawnSyncWithBoundedIo(process.execPath, [file], {
      cwd: root,
      env: process.env,
      input: "",
      stdio: ["pipe", "inherit", "inherit"],
      timeout: 120_000,
    });
    if (result.error || result.signal || result.status !== 0)
      throw new Error(`Selected pre-push check failed: ${file}.`);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) runSelectedPrePushPolicy();
