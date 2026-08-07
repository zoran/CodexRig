#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { frameworkRoot, parseSemver, readCompatibilityMatrix } from "./framework-contract.mjs";

function commandVersion(executable, args, label) {
  const result = spawnSync(executable, args, {
    cwd: frameworkRoot,
    encoding: "utf8",
    env: process.env,
    input: "",
    stdio: "pipe",
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

function nodeMatchesSpec(version, specification) {
  const parsed = parseSemver(version);
  if (/^\d+$/u.test(specification)) return parsed.major === Number(specification);
  return version === specification;
}

function packageMatchesSpec(version, specification, label) {
  const parsed = parseSemver(version, label);
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(specification)) {
    return version === specification;
  }
  const nextMajor = specification.match(/^next-(\d+)$/u);
  if (nextMajor) return parsed.major === Number(nextMajor[1]);
  if (specification === "latest") return parsed.prerelease === "";
  if (specification === "alpha") return /(?:^|[.-])alpha(?:[.-]|$)/u.test(parsed.prerelease);
  throw new Error(`Unsupported ${label} compatibility specification: ${specification}.`);
}

export function ciCompatibilityTracks(matrix = readCompatibilityMatrix()) {
  return matrix.canaries.map((entry) => ({
    codex: entry.codex,
    description: entry.description,
    experimental: !entry.required,
    id: entry.id,
    node: entry.node,
    pnpm: entry.pnpm,
  }));
}

function yamlSingleQuoted(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function gitlabChildPipeline(matrix = readCompatibilityMatrix()) {
  const lines = ["stages:", "  - compatibility", ""];
  for (const track of ciCompatibilityTracks(matrix)) {
    lines.push(
      `compatibility:${track.id}:`,
      "  stage: compatibility",
      `  image: ${yamlSingleQuoted(`node:${track.node}-bookworm`)}`,
      `  allow_failure: ${track.experimental ? "true" : "false"}`,
      "  variables:",
      `    CODEXRIG_COMPATIBILITY_TRACK: ${yamlSingleQuoted(track.id)}`,
      "  before_script:",
      `    - npm install --global ${yamlSingleQuoted(`pnpm@${track.pnpm}`)} ${yamlSingleQuoted(`@openai/codex@${track.codex}`)} --ignore-scripts`,
      "    - pnpm install --frozen-lockfile --ignore-scripts",
      "  script:",
      '    - node scripts/framework/compatibility-matrix.mjs --check-track "$CODEXRIG_COMPATIBILITY_TRACK"',
      "    - pnpm verify",
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

export function checkCompatibilityTrack(trackId, matrix = readCompatibilityMatrix()) {
  const track = matrix.canaries.find((entry) => entry.id === trackId);
  if (!track) throw new Error(`Unknown compatibility track: ${trackId}.`);
  const versions = {
    codex: extractedVersion(commandVersion("codex", ["--version"], "Codex"), "Codex"),
    node: process.version.replace(/^v/u, ""),
    pnpm: extractedVersion(commandVersion("pnpm", ["--version"], "pnpm"), "pnpm"),
  };
  parseSemver(versions.node, "Node.js");
  if (!nodeMatchesSpec(versions.node, track.node)) {
    throw new Error(
      `Compatibility track ${track.id} expected Node.js ${track.node}, received ${versions.node}.`,
    );
  }
  if (!packageMatchesSpec(versions.pnpm, track.pnpm, "pnpm")) {
    throw new Error(
      `Compatibility track ${track.id} expected pnpm ${track.pnpm}, received ${versions.pnpm}.`,
    );
  }
  if (!packageMatchesSpec(versions.codex, track.codex, "Codex")) {
    throw new Error(
      `Compatibility track ${track.id} expected Codex ${track.codex}, received ${versions.codex}.`,
    );
  }
  return { id: track.id, versions };
}

function parseArgs(argv) {
  const args = argv.filter((argument) => argument !== "--");
  const parsed = { checkTrack: "", githubMatrix: false, gitlabChild: false, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--github-matrix") parsed.githubMatrix = true;
    else if (argument === "--gitlab-child") parsed.gitlabChild = true;
    else if (argument === "--json") parsed.json = true;
    else if (argument === "--check-track") parsed.checkTrack = args[++index] ?? "";
    else if (argument.startsWith("--check-track=")) parsed.checkTrack = argument.slice(14);
    else if (argument === "--help" || argument === "-h") parsed.help = true;
    else throw new Error(`Unknown compatibility matrix option: ${argument}.`);
  }
  const modes = [parsed.githubMatrix, parsed.gitlabChild, Boolean(parsed.checkTrack)].filter(
    Boolean,
  );
  if (modes.length > 1) throw new Error("Select only one compatibility matrix output mode.");
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: pnpm compatibility:matrix [-- --json|--github-matrix|--gitlab-child|--check-track <id>]",
    );
    return;
  }
  const matrix = readCompatibilityMatrix();
  if (args.githubMatrix) {
    console.log(JSON.stringify({ include: ciCompatibilityTracks(matrix) }));
    return;
  }
  if (args.gitlabChild) {
    process.stdout.write(gitlabChildPipeline(matrix));
    return;
  }
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
    `Stable: Node.js ${matrix.stable.node.version}, pnpm ${matrix.stable.pnpm.version}, Codex >=${matrix.stable.codex.minimumVersion}.`,
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
