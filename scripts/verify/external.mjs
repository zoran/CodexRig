/** Owns external behavior for the repository verification boundary. */
import { spawnSyncWithBoundedIo as spawnSync } from "../repository/runtime-process-io.mjs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { trustedPnpmCommand } from "../deps/trusted-pnpm-command.mjs";
import {
  assertTrustedPnpmConfiguration,
  pnpmHooksDisabledEnvironment,
} from "../repository/pnpm-workspace-manifests.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
assertTrustedPnpmConfiguration({ repositoryRoot: root });
const pnpm = trustedPnpmCommand({ repositoryRoot: root });
const commands = [
  {
    label: "dependency freshness",
    executable: process.execPath,
    args: ["scripts/deps/report.mjs"],
  },
  {
    label: "dependency advisory registry",
    executable: pnpm.executable,
    args: ["audit", "--audit-level", "high"],
  },
  {
    label: "dependency registry signatures",
    executable: pnpm.executable,
    args: ["audit", "signatures"],
  },
];

for (const command of commands) {
  console.log(`Running external ${command.label} check...`);
  const result = spawnSync(command.executable, command.args, {
    cwd: root,
    encoding: "utf8",
    env: pnpmHooksDisabledEnvironment(process.env),
    stdio: "inherit",
    timeout: 180_000,
  });
  if (result.error) {
    console.error(`External verification is indeterminate: ${command.label} failed to start.`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(
      `External verification failed or is indeterminate: ${command.label} exited with status ${result.status}.`,
    );
    process.exit(1);
  }
}
console.log("External dependency freshness, advisory, and registry-signature checks passed.");
