/** Owns verification command identity, focused construction, and executed test-owner selection. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const broadShellEntryPointPattern =
  /^(?:scripts\/verify\/pre-push\.sh|scripts\/git-hooks\/pre-push)$/u;

function commandSignature(command) {
  return JSON.stringify([
    command.executable,
    command.args,
    command.phase,
    command.artifactOwners ?? [],
    command.coveredTestPaths ?? [],
  ]);
}

export function dedupeCommands(commands) {
  const result = new Map();
  for (const command of commands) {
    const existing = result.get(command.key);
    if (existing && commandSignature(existing) !== commandSignature(command)) {
      throw new Error(`Verification command key ${command.key} has conflicting definitions.`);
    }
    if (!existing) result.set(command.key, command);
  }
  return [...result.values()];
}

function unfilteredTestPaths(command) {
  if (
    command.executable !== process.execPath ||
    !command.args.includes("--test") ||
    (command.artifactOwners?.length ?? 0) > 0
  ) {
    return new Set();
  }
  const files = [];
  // These existing runner options change reporting/scheduling, not test selection or isolation.
  // Unknown flags (filters, loaders, conditions, isolation overrides) retain the separate run.
  for (const argument of command.args) {
    if (["--test", "--test-reporter=dot", "--test-concurrency=1"].includes(argument)) continue;
    if (argument.startsWith("-") || !argument.endsWith(".test.mjs")) return new Set();
    files.push(argument);
  }
  return new Set(files.length > 0 ? [...files, ...(command.coveredTestPaths ?? [])] : []);
}

/** Removes only redundant generated single-file checks and rebinds their admission owners.
 * A covering suite must already be selected, run in the same phase, and declare unfiltered
 * coverage through CLI files or coveredTestPaths. This never introduces a broader suite.
 */
export function consolidateFocusedTestOwners({ commands, ownersByPath }) {
  const selected = dedupeCommands(commands);
  const suites = selected
    .filter((command) => !command.key.startsWith("focused-test:"))
    .map((command) => ({ command, paths: unfilteredTestPaths(command) }));
  const replacements = new Map();
  for (const command of selected) {
    if (
      !command.key.startsWith("focused-test:") ||
      command.args.length !== 3 ||
      command.args[0] !== "--test" ||
      command.args[1] !== "--test-reporter=dot" ||
      (command.coveredTestPaths?.length ?? 0) > 0 ||
      unfilteredTestPaths(command).size !== 1
    ) {
      continue;
    }
    const owner = suites.find(
      (suite) => suite.command.phase === command.phase && suite.paths.has(command.args[2]),
    );
    if (owner) replacements.set(command.key, owner.command.key);
  }
  return {
    readOnlyCommands: selected.filter((command) => !replacements.has(command.key)),
    ownersByPath: ownersByPath.map((entry) => ({
      ...entry,
      ownerKeys: [...new Set(entry.ownerKeys.map((key) => replacements.get(key) ?? key))].sort(),
    })),
  };
}

export function commandsByKey(commands) {
  return new Map(commands.map((command) => [command.key, command]));
}

export function selectCommands(available, keys) {
  return keys.map((key) => available.get(key)).filter(Boolean);
}

export function directVerifierCommands(available, relativePath) {
  return [...available.values()].filter(
    (command) => command.args?.[0] === relativePath && !isForbiddenFocusedOwner(command),
  );
}

export function changedTestPath(relativePath, repositoryRoot) {
  if (!relativePath.endsWith(".test.mjs")) return null;
  return existsSync(path.join(repositoryRoot, ...relativePath.split("/"))) ? relativePath : null;
}

export function focusedTestCommand(testPath, ownerPath) {
  const identity = createHash("sha256").update(testPath).digest("hex").slice(0, 16);
  return {
    args: ["--test", "--test-reporter=dot", testPath],
    artifactOwners: [],
    executable: process.execPath,
    key: `focused-test:${identity}`,
    label: `focused regression owner for ${ownerPath}`,
    phase: "preflight",
    reason: `${testPath} is the exact executable verifier owner for ${ownerPath}`,
  };
}

export function focusedManifestCommand(relativePath) {
  const identity = createHash("sha256").update(relativePath).digest("hex").slice(0, 16);
  return {
    args: ["scripts/verify/package-manifest.mjs", "--path", relativePath],
    artifactOwners: [],
    executable: process.execPath,
    key: `focused-manifest:${identity}`,
    label: `whole package manifest owner for ${relativePath}`,
    phase: "preflight",
    reason: `${relativePath} owns its complete identity, scripts, dependencies, and export registry`,
  };
}

export function manifestPathForPackageContract(relativePath) {
  if (path.posix.basename(relativePath) === "package.json") return relativePath;
  if (path.posix.basename(relativePath) !== "package.exports.json") return null;
  const directory = path.posix.dirname(relativePath);
  return directory === "." ? "package.json" : `${directory}/package.json`;
}

export function isForbiddenFocusedOwner(command) {
  if (!command) return false;
  if (command.key === "verify:repo" || command.key === "verify:full") return true;
  if (command.args?.some((argument) => broadShellEntryPointPattern.test(argument))) return true;
  const adaptiveIndex = command.args?.indexOf("scripts/verify/adaptive.mjs") ?? -1;
  return (
    adaptiveIndex >= 0 &&
    command.args
      .slice(adaptiveIndex + 1)
      .some((argument) => argument === "--mode" || argument.startsWith("--mode="))
  );
}
