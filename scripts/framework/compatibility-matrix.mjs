#!/usr/bin/env node
/** Owns compatibility matrix behavior for the framework lifecycle and child upgrade boundary. */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  frameworkRoot,
  parseSemver,
  readCompatibilityMatrix,
  validateCompatibilityMatrix,
} from "../contracts/framework-contract.mjs";

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

function canonicalSha512Integrity(value, label) {
  if (typeof value !== "string" || !value.startsWith("sha512-")) {
    throw new Error(`${label} must be a SHA-512 Subresource Integrity value.`);
  }
  const encoded = value.slice("sha512-".length);
  if (!/^[A-Za-z0-9+/]{86}==$/u.test(encoded)) {
    throw new Error(`${label} must be a canonical SHA-512 Subresource Integrity value.`);
  }
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== encoded) {
    throw new Error(`${label} must encode exactly one canonical SHA-512 digest.`);
  }
  return value;
}

/** Returns the exact official per-architecture mise package and reviewed archive integrity. */
export function miseNpmPackageRecords(matrix = readCompatibilityMatrix()) {
  const validatedMatrix = validateCompatibilityMatrix(matrix);
  const packages = validatedMatrix.ci.miseNpmPackages;
  const integrities = validatedMatrix.ci.miseNpmPackageIntegrities;
  if (!integrities || typeof integrities !== "object" || Array.isArray(integrities)) {
    throw new Error("compatibility.ci.miseNpmPackageIntegrities must be an object.");
  }
  if (Object.keys(integrities).sort().join("\n") !== "arm64\nx64") {
    throw new Error("compatibility.ci.miseNpmPackageIntegrities must own exactly arm64 and x64.");
  }
  const records = {};
  for (const architecture of ["arm64", "x64"]) {
    records[architecture] = {
      integrity: canonicalSha512Integrity(
        integrities[architecture],
        `compatibility.ci.miseNpmPackageIntegrities.${architecture}`,
      ),
      npmPackage: packages[architecture],
    };
  }
  return records;
}

/** Returns the exact reviewed Codex wrapper and per-architecture platform archives for blocking CI. */
export function codexNpmPackageRecords(matrix = readCompatibilityMatrix()) {
  const validatedMatrix = validateCompatibilityMatrix(matrix);
  const ci = validatedMatrix.ci;
  const version = parseSemver(ci.codexVersion, "compatibility.ci.codexVersion").raw;
  const wrapper = {
    integrity: canonicalSha512Integrity(
      ci.codexNpmPackageIntegrity,
      "compatibility.ci.codexNpmPackageIntegrity",
    ),
    npmPackage: ci.codexNpmPackage,
    specification: `${ci.codexNpmPackage}@${version}`,
    version,
  };
  const platforms = {};
  for (const architecture of ["arm64", "x64"]) {
    platforms[architecture] = {
      aliasPackage: ci.codexNpmPlatformPackages[architecture],
      integrity: canonicalSha512Integrity(
        ci.codexNpmPlatformIntegrities[architecture],
        `compatibility.ci.codexNpmPlatformIntegrities.${architecture}`,
      ),
      targetSpecification: `${ci.codexNpmPackage}@${version}-linux-${architecture}`,
    };
  }
  return { platforms, wrapper };
}

/** Renders the canonical shell body for the reviewed stable Codex install in blocking CI. */
export function stableCodexInstallShell(matrix = readCompatibilityMatrix()) {
  const records = codexNpmPackageRecords(matrix);
  return [
    'case "$(uname -m)" in',
    `  x86_64|amd64) codex_architecture='x64'; codex_platform_package=${yamlSingleQuoted(records.platforms.x64.aliasPackage)}; codex_platform_integrity=${yamlSingleQuoted(records.platforms.x64.integrity)} ;;`,
    `  aarch64|arm64) codex_architecture='arm64'; codex_platform_package=${yamlSingleQuoted(records.platforms.arm64.aliasPackage)}; codex_platform_integrity=${yamlSingleQuoted(records.platforms.arm64.integrity)} ;;`,
    '  *) echo "Unsupported stable Codex CI architecture: $(uname -m)" >&2; exit 1 ;;',
    "esac",
    `codex_package=${yamlSingleQuoted(records.wrapper.npmPackage)}`,
    `codex_version=${yamlSingleQuoted(records.wrapper.version)}`,
    `codex_wrapper_integrity=${yamlSingleQuoted(records.wrapper.integrity)}`,
    'codex_install_root="$(umask 077 && mktemp -d)"',
    'codex_stage="$codex_install_root/stage"',
    'codex_cache="$codex_install_root/cache"',
    'mkdir -m 700 "$codex_stage" "$codex_cache"',
    "trap 'rm -rf -- \"$codex_install_root\"' EXIT",
    'npm_config_cache="$codex_cache" npm_config_ignore_scripts=true npm cache add "${codex_package}@${codex_version}"',
    'npm_config_cache="$codex_cache" npm_config_ignore_scripts=true npm cache add "${codex_platform_package}@npm:${codex_package}@${codex_version}-linux-${codex_architecture}"',
    'npm_config_cache="$codex_cache" npm_config_ignore_scripts=true npm pack --ignore-scripts --pack-destination "$codex_stage" "${codex_package}@${codex_version}" "${codex_package}@${codex_version}-linux-${codex_architecture}" >/dev/null',
    'node scripts/framework/compatibility-matrix.mjs --verify-codex-archives "$codex_stage" "$codex_wrapper_integrity" "$codex_platform_integrity" >/dev/null',
    'npm_config_cache="$codex_cache" npm_config_ignore_scripts=true npm install --global "${codex_package}@${codex_version}" --ignore-scripts --offline',
    'rm -rf -- "$codex_install_root"',
    "trap - EXIT",
  ];
}

/** Renders the exact GitHub Actions step for the reviewed stable Codex install. */
export function githubStableCodexInstallStep(matrix = readCompatibilityMatrix()) {
  return [
    "      - name: Install the reviewed stable Codex CLI",
    "        shell: bash",
    "        run: |",
    ...stableCodexInstallShell(matrix).map((line) => `          ${line}`),
  ];
}

/** Renders the exact GitLab before_script item for the reviewed stable Codex install. */
export function gitlabStableCodexInstallBeforeScript(matrix = readCompatibilityMatrix()) {
  return ["    - |", ...stableCodexInstallShell(matrix).map((line) => `      ${line}`)];
}

/** Renders the one canonical GitLab before_script item that verifies mise before installation. */
export function gitlabMiseInstallBeforeScript(matrix = readCompatibilityMatrix()) {
  const records = miseNpmPackageRecords(matrix);
  const version = parseSemver(matrix.ci.miseVersion, "compatibility.ci.miseVersion").raw;
  return [
    "    - |",
    '      case "$(uname -m)" in',
    `        x86_64|amd64) mise_package=${yamlSingleQuoted(records.x64.npmPackage)}; mise_integrity=${yamlSingleQuoted(records.x64.integrity)} ;;`,
    `        aarch64|arm64) mise_package=${yamlSingleQuoted(records.arm64.npmPackage)}; mise_integrity=${yamlSingleQuoted(records.arm64.integrity)} ;;`,
    '        *) echo "Unsupported GitLab runner architecture: $(uname -m)" >&2; exit 1 ;;',
    "      esac",
    '      mise_stage="$(umask 077 && mktemp -d)"',
    `      npm pack --ignore-scripts --pack-destination "$mise_stage" "\${mise_package}@${version}" >/dev/null`,
    '      mise_archive="$(node scripts/framework/compatibility-matrix.mjs --verify-mise-archive "$mise_stage" "$mise_integrity")"',
    '      npm install --global "$mise_archive" --ignore-scripts --offline',
  ];
}

/** Verifies the sole staged npm tarball and returns its path without exposing it first. */
export function verifyMiseArchive(directory, expectedIntegrity) {
  const integrity = canonicalSha512Integrity(expectedIntegrity, "Expected mise archive integrity");
  const stage = path.resolve(directory);
  const stageStats = lstatSync(stage);
  if (stageStats.isSymbolicLink() || !stageStats.isDirectory()) {
    throw new Error("Mise archive stage must be a real directory.");
  }
  const candidates = readdirSync(stage).filter((entry) => entry.endsWith(".tgz"));
  if (candidates.length !== 1) {
    throw new Error("Mise archive stage must contain exactly one .tgz archive.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/u.test(candidates[0])) {
    throw new Error("Staged mise archive must use one safe npm tarball name.");
  }
  const archive = path.join(stage, candidates[0]);
  const archiveStats = lstatSync(archive);
  if (
    archiveStats.isSymbolicLink() ||
    !archiveStats.isFile() ||
    archiveStats.nlink !== 1 ||
    archiveStats.size === 0 ||
    archiveStats.size > 100 * 1024 * 1024
  ) {
    throw new Error("Staged mise archive must be one bounded regular single-link file.");
  }
  const receivedIntegrity = `sha512-${createHash("sha512")
    .update(readFileSync(archive))
    .digest("base64")}`;
  if (receivedIntegrity !== integrity) {
    throw new Error("Staged mise archive does not match the reviewed integrity.");
  }
  return archive;
}

/** Verifies that a private stage contains exactly the reviewed Codex wrapper and platform bytes. */
export function verifyCodexArchives(directory, wrapperIntegrity, platformIntegrity) {
  const expected = [
    canonicalSha512Integrity(wrapperIntegrity, "Expected Codex wrapper integrity"),
    canonicalSha512Integrity(platformIntegrity, "Expected Codex platform integrity"),
  ].sort();
  const stage = path.resolve(directory);
  const stageStats = lstatSync(stage);
  if (stageStats.isSymbolicLink() || !stageStats.isDirectory()) {
    throw new Error("Codex archive stage must be a real directory.");
  }
  const candidates = readdirSync(stage)
    .filter((entry) => entry.endsWith(".tgz"))
    .sort();
  if (candidates.length !== 2) {
    throw new Error("Codex archive stage must contain exactly two .tgz archives.");
  }
  const received = candidates.map((candidate) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/u.test(candidate)) {
      throw new Error("Staged Codex archives must use safe npm tarball names.");
    }
    const archive = path.join(stage, candidate);
    const stats = lstatSync(archive);
    if (
      stats.isSymbolicLink() ||
      !stats.isFile() ||
      stats.nlink !== 1 ||
      stats.size === 0 ||
      stats.size > 150 * 1024 * 1024
    ) {
      throw new Error("Each staged Codex archive must be one bounded regular single-link file.");
    }
    return `sha512-${createHash("sha512").update(readFileSync(archive)).digest("base64")}`;
  });
  if (JSON.stringify(received.sort()) !== JSON.stringify(expected)) {
    throw new Error("Staged Codex archives do not match the reviewed wrapper and platform bytes.");
  }
  return candidates.map((candidate) => path.join(stage, candidate));
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
      "    NPM_CONFIG_IGNORE_PNPMFILE: 'true'",
      "    PNPM_CONFIG_IGNORE_PNPMFILE: 'true'",
      "    npm_config_ignore_pnpmfile: 'true'",
      "    pnpm_config_ignore_pnpmfile: 'true'",
      "  before_script:",
      "    - apt-get update && apt-get install -y --no-install-recommends ripgrep shellcheck && rm -rf /var/lib/apt/lists/*",
      ...gitlabMiseInstallBeforeScript(matrix),
      `    - npm install --global ${yamlSingleQuoted(`pnpm@${track.pnpm}`)} ${yamlSingleQuoted(`@openai/codex@${track.codex}`)} --ignore-scripts`,
      "    - node scripts/deps/verify-pnpm-execution-policy.mjs",
      "    - pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile",
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
  const parsed = {
    checkTrack: "",
    githubMatrix: false,
    gitlabChild: false,
    json: false,
    verifyCodexArchives: [],
    verifyMiseArchive: [],
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--github-matrix") parsed.githubMatrix = true;
    else if (argument === "--gitlab-child") parsed.gitlabChild = true;
    else if (argument === "--json") parsed.json = true;
    else if (argument === "--check-track") parsed.checkTrack = args[++index] ?? "";
    else if (argument.startsWith("--check-track=")) parsed.checkTrack = argument.slice(14);
    else if (argument === "--verify-mise-archive") {
      parsed.verifyMiseArchive = [args[++index] ?? "", args[++index] ?? ""];
    } else if (argument === "--verify-codex-archives") {
      parsed.verifyCodexArchives = [args[++index] ?? "", args[++index] ?? "", args[++index] ?? ""];
    } else if (argument === "--help" || argument === "-h") parsed.help = true;
    else throw new Error(`Unknown compatibility matrix option: ${argument}.`);
  }
  const modes = [
    parsed.githubMatrix,
    parsed.gitlabChild,
    parsed.json,
    Boolean(parsed.checkTrack),
    parsed.verifyCodexArchives.length > 0,
    parsed.verifyMiseArchive.length > 0,
  ].filter(Boolean);
  if (modes.length > 1) throw new Error("Select only one compatibility matrix output mode.");
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: pnpm compatibility:matrix [-- --json|--github-matrix|--gitlab-child|--check-track <id>|--verify-mise-archive <directory> <sha512-sri>|--verify-codex-archives <directory> <wrapper-sha512-sri> <platform-sha512-sri>]",
    );
    return;
  }
  if (args.verifyMiseArchive.length > 0) {
    const [directory, integrity] = args.verifyMiseArchive;
    if (!directory || !integrity) {
      throw new Error("--verify-mise-archive requires a stage directory and reviewed integrity.");
    }
    console.log(verifyMiseArchive(directory, integrity));
    return;
  }
  if (args.verifyCodexArchives.length > 0) {
    const [directory, wrapperIntegrity, platformIntegrity] = args.verifyCodexArchives;
    if (!directory || !wrapperIntegrity || !platformIntegrity) {
      throw new Error(
        "--verify-codex-archives requires a stage directory plus reviewed wrapper and platform integrities.",
      );
    }
    console.log(verifyCodexArchives(directory, wrapperIntegrity, platformIntegrity).join("\n"));
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
    `Stable: Node.js ${matrix.stable.node.version}, pnpm ${matrix.stable.pnpm.version}, Codex >=${matrix.stable.codex.minimumVersion}; blocking CI uses reviewed Codex ${matrix.ci.codexVersion}.`,
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
