#!/usr/bin/env node
/** Owns compatibility matrix behavior for the framework lifecycle and child upgrade boundary. */
import { spawnSyncWithBoundedIo as spawnSync } from "../repository/runtime-process-io.mjs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseSemver, readCompatibilityMatrix } from "../contracts/framework-contract.mjs";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import { versionMatchesReleaseSelector } from "../contracts/semver-contract.mjs";
import {
  projectManagedToolLayout,
  verifyProjectToolBundle,
} from "../repository/project-tool-executables.mjs";
import { canonicalRuntimeExecutable } from "../setup/startup-runtime-executables.mjs";
import { projectToolEnvironment } from "../repository/project-tool-environment.mjs";

function commandVersion(executable, args, label) {
  const result = spawnSync(executable, args, {
    cwd: toolingRoot,
    encoding: "utf8",
    env: projectToolEnvironment({ root: toolingRoot }),
    input: "",
    maxBuffer: 1024 * 1024,
    stdio: "pipe",
    timeout: 20_000,
  });
  if (result.error || result.status !== 0) throw new Error(`${label} version probe failed.`);
  return `${result.stdout}${result.stderr}`.trim();
}

function extractedVersion(output, label) {
  const match = String(output).match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/u);
  if (!match) throw new Error(`${label} did not report a semantic version.`);
  parseSemver(match[1], label);
  return match[1];
}

export function checkCompatibilityTrack(trackId, matrix = readCompatibilityMatrix()) {
  const track = matrix.canaries.find((entry) => entry.id === trackId);
  if (!track) throw new Error(`Unknown compatibility track: ${trackId}.`);
  const tools = projectManagedToolLayout(toolingRoot, matrix);
  const codex = verifyProjectToolBundle(toolingRoot, tools.codex);
  const pnpm = canonicalRuntimeExecutable(toolingRoot, tools.pnpm.executable, "pnpm");
  const versions = {
    codex: extractedVersion(commandVersion(codex, ["--version"], "Codex"), "Codex"),
    node: process.version.replace(/^v/u, ""),
    pnpm: extractedVersion(commandVersion(pnpm, ["--version"], "pnpm"), "pnpm"),
  };
  parseSemver(versions.node, "Node.js");
  if (!versionMatchesReleaseSelector(versions.node, track.node)) {
    throw new Error(
      `Compatibility track ${track.id} expected Node.js ${track.node}, received ${versions.node}.`,
    );
  }
  if (!versionMatchesReleaseSelector(versions.pnpm, track.pnpm)) {
    throw new Error(
      `Compatibility track ${track.id} expected pnpm ${track.pnpm}, received ${versions.pnpm}.`,
    );
  }
  if (!versionMatchesReleaseSelector(versions.codex, track.codex)) {
    throw new Error(
      `Compatibility track ${track.id} expected Codex ${track.codex}, received ${versions.codex}.`,
    );
  }
  return { id: track.id, versions };
}

function parseArgs(argv) {
  const args = argv.filter((argument) => argument !== "--");
  const parsed = {
    checkTrack: "",
    json: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") parsed.json = true;
    else if (argument === "--check-track" || argument.startsWith("--check-track=")) {
      parsed.checkTrack = argument === "--check-track" ? args[++index] : argument.slice(14);
      if (!parsed.checkTrack || parsed.checkTrack.startsWith("-"))
        throw new Error("Select a declared compatibility track id.");
    } else if (argument === "--help" || argument === "-h") parsed.help = true;
    else throw new Error(`Unknown compatibility matrix option: ${argument}.`);
  }
  if (parsed.json && parsed.checkTrack)
    throw new Error("Select only one compatibility matrix output mode.");
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: pnpm compatibility:matrix [-- --json|--check-track <id>]");
    return;
  }
  const matrix = readCompatibilityMatrix();
  if (args.checkTrack) {
    const result = checkCompatibilityTrack(args.checkTrack, matrix);
    console.log(
      `Compatibility track ${result.id} passed with Node.js ${result.versions.node}, pnpm ${result.versions.pnpm}, and Codex ${result.versions.codex}.`,
    );
    return;
  }
  if (args.json) {
    console.log(JSON.stringify(matrix, null, 2));
    return;
  }
  console.log(
    `Stable: Node.js ${matrix.stable.node.version}, pnpm ${matrix.stable.pnpm.version}, Codex >=${matrix.stable.codex.minimumVersion}, local Codex pin ${matrix.ci.codexVersion}.`,
  );
  for (const track of matrix.canaries) {
    console.log(
      `Canary ${track.id}: Node.js ${track.node}, pnpm ${track.pnpm}, Codex ${track.codex}.`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Compatibility matrix failed: ${error.message}`);
    process.exit(1);
  }
}
