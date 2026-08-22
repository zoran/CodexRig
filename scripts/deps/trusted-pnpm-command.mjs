/** Resolves the compatibility-owned mise pnpm binary without repository-local PATH shadowing. */
import { spawnSyncWithBoundedIo as spawnSync } from "../repository/runtime-process-io.mjs";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { readOptionalOwnedFile } from "../filesystem/owned-file-operations.mjs";
import { pnpmHooksDisabledEnvironment } from "../repository/pnpm-workspace-manifests.mjs";

const commandCache = new Map();

function strictDescendant(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function expectedToolchain(repositoryRoot) {
  const compatibilityPath = path.join(repositoryRoot, ".codexrig", "compatibility.json");
  const snapshot = readOptionalOwnedFile(
    repositoryRoot,
    compatibilityPath,
    "pnpm compatibility contract",
    { maximumBytes: 128 * 1024 },
  );
  if (!snapshot.exists) throw new Error("Trusted pnpm requires .codexrig/compatibility.json.");
  let compatibility;
  try {
    compatibility = JSON.parse(snapshot.buffer.toString("utf8"));
  } catch {
    throw new Error("Trusted pnpm compatibility contract is invalid.");
  }
  const node = compatibility?.stable?.node?.version;
  const pnpm = compatibility?.stable?.pnpm?.version;
  if (
    typeof node !== "string" ||
    !/^\d+\.\d+\.\d+$/u.test(node) ||
    typeof pnpm !== "string" ||
    !/^\d+\.\d+\.\d+$/u.test(pnpm)
  ) {
    throw new Error("Trusted Node.js/pnpm compatibility versions are invalid.");
  }
  return Object.freeze({ node, pnpm });
}

function lockedMiseInstallsRoot(nodeExecutable, expectedNodeVersion) {
  let current = path.dirname(realpathSync.native(nodeExecutable));
  while (path.dirname(current) !== current) {
    if (
      path.basename(current) === expectedNodeVersion &&
      path.basename(path.dirname(current)).toLowerCase() === "node" &&
      path.basename(path.dirname(path.dirname(current))).toLowerCase() === "installs"
    ) {
      return path.dirname(path.dirname(current));
    }
    current = path.dirname(current);
  }
  throw new Error(
    "Trusted pnpm requires Node.js itself to run from the compatibility-owned mise installation.",
  );
}

/** Returns one absolute, version-verified pnpm command owned by the locked mise installation. */
export function trustedPnpmCommand({
  repositoryRoot,
  environment = process.env,
  spawn = spawnSync,
  nodeExecutable = process.execPath,
} = {}) {
  const root = realpathSync.native(path.resolve(repositoryRoot));
  const expected = expectedToolchain(root);
  if (process.versions.node !== expected.node && nodeExecutable === process.execPath) {
    throw new Error(`Trusted pnpm requires compatibility-owned Node.js ${expected.node}.`);
  }
  const installsRoot = lockedMiseInstallsRoot(nodeExecutable, expected.node);
  const pnpmRoot = path.join(installsRoot, "pnpm", expected.pnpm);
  const cacheKey = `${root}\0${expected.node}\0${expected.pnpm}\0${realpathSync.native(nodeExecutable)}`;
  if (spawn === spawnSync && commandCache.has(cacheKey)) return commandCache.get(cacheKey);

  const names = process.platform === "win32" ? ["pnpm.exe", "pnpm.cmd", "pnpm"] : ["pnpm"];
  for (const name of names) {
    const candidate = path.join(pnpmRoot, name);
    if (!path.isAbsolute(candidate) || !existsSync(candidate)) continue;
    let executable;
    try {
      executable = realpathSync.native(candidate);
      const stats = lstatSync(executable);
      const resolvedPnpmRoot = realpathSync.native(pnpmRoot);
      if (
        !stats.isFile() ||
        !strictDescendant(resolvedPnpmRoot, executable) ||
        strictDescendant(root, executable) ||
        executable === root
      ) {
        continue;
      }
    } catch {
      continue;
    }
    const result = spawn(executable, ["--version"], {
      cwd: root,
      encoding: "utf8",
      env: pnpmHooksDisabledEnvironment(environment),
      input: "",
      stdio: "pipe",
      timeout: 30_000,
    });
    if (result.error || result.status !== 0 || String(result.stdout).trim() !== expected.pnpm) {
      continue;
    }
    const command = Object.freeze({
      executable,
      argsPrefix: Object.freeze([]),
      version: expected.pnpm,
    });
    if (spawn === spawnSync) commandCache.set(cacheKey, command);
    return command;
  }
  throw new Error(
    `Trusted pnpm ${expected.pnpm} was not resolved beside compatibility-owned Node.js ${expected.node}; run through mise exec --locked.`,
  );
}

/** Spawns a trusted pnpm command while preserving injectable test runners. */
export function spawnTrustedPnpm({
  args,
  options,
  repositoryRoot,
  spawnPnpm = spawnSync,
  environment = process.env,
  command,
}) {
  const resolved =
    command ??
    (spawnPnpm === spawnSync
      ? trustedPnpmCommand({ repositoryRoot, environment })
      : { executable: "pnpm", argsPrefix: [] });
  return spawnPnpm(resolved.executable, [...resolved.argsPrefix, ...args], options);
}
