/** Owns verification runtime identity behavior for the repository verification boundary. */
import { createHash } from "node:crypto";
import { spawnSyncWithBoundedIo as spawnSync } from "../repository/runtime-process-io.mjs";
import { accessSync, constants, lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import { projectToolEnvironment } from "../repository/project-tool-environment.mjs";

const identityKeys = Object.freeze([
  "arch",
  "environment",
  "executables",
  "mise",
  "node",
  "platform",
  "pnpm",
]);
const versionProbeCache = new Map();

/** Normalizes verification within the common repository-bound tool environment. */
export function verificationChildEnvironment(environment = process.env, root = toolingRoot) {
  const child = projectToolEnvironment({ root, inherited: environment });
  // Captured checks use one presentation, so changing terminals cannot discard valid evidence.
  // Normalize executed inputs as well as their identity; semantic controls remain below.
  for (const key of ["COLORTERM", "FORCE_COLOR", "TERM_PROGRAM"]) delete child[key];
  // Deterministic verification never loads mutable user npm options or credentials. Other tools
  // retain the common repository home. Dependency installation owns its explicit registry profile.
  const disabledNpmConfigRoot = process.platform === "win32" ? "NUL" : "/dev/null";
  if (
    process.platform !== "win32" &&
    (!lstatSync(disabledNpmConfigRoot).isCharacterDevice() ||
      realpathSync.native(disabledNpmConfigRoot) !== "/dev/null")
  )
    throw new Error(
      "Verification could not bind npm configuration to the operating-system null device.",
    );
  delete child.NPM_CONFIG_GLOBALCONFIG;
  return {
    ...child,
    NPM_CONFIG_USERCONFIG: disabledNpmConfigRoot,
    NPM_CONFIG_PREFIX: disabledNpmConfigRoot,
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
    PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "error",
    TERM: "dumb",
    TZ: "Etc/UTC",
  };
}

function commandVersionDigest(command, args, cwd, executable, environment, environmentIdentity) {
  const cacheKey = [cwd, command, executable.identity, args.join("\0"), environmentIdentity].join(
    "\0",
  );
  const cached = versionProbeCache.get(cacheKey);
  if (cached) return cached;
  const result = spawnSync(executable.resolved, args, {
    cwd,
    encoding: "utf8",
    env: environment,
    input: "",
    maxBuffer: 4 * 1024,
    timeout: 10_000,
    stdio: "pipe",
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Verification evidence could not identify the ${command} runtime.`);
  }
  const value = `${result.stdout}${result.stderr}`.trim().split(/\r?\n/, 1)[0] ?? "";
  if (!value || value.length > 256 || /[\0\r\n]/.test(value)) {
    throw new Error(`Verification evidence received an invalid ${command} runtime identity.`);
  }
  const versionDigest = createHash("sha256")
    .update("verification-tool-version-v1\0")
    .update(value)
    .digest("hex");
  versionProbeCache.set(cacheKey, versionDigest);
  return versionDigest;
}

function environmentDigest(environment) {
  const hash = createHash("sha256").update("verification-environment-v1\0");
  for (const key of Object.keys(environment)
    .filter((key) => !["PATH", "PATHEXT"].includes(key.toUpperCase()))
    .sort()) {
    hash.update(key).update("\0").update(String(environment[key])).update("\0");
  }
  return hash.digest("hex");
}

function executableCandidates(command, cwd, environment) {
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return [path.resolve(cwd, command)];
  }
  const extensions =
    process.platform === "win32"
      ? (environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  return (environment.PATH ?? "")
    .split(path.delimiter)
    .flatMap((directory) =>
      extensions.map((extension) => path.join(directory || cwd, `${command}${extension}`)),
    );
}

function executableDetails(command, cwd, environment) {
  const candidates =
    command === "node" ? [process.execPath] : executableCandidates(command, cwd, environment);
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      const resolved = realpathSync.native(candidate);
      const stats = statSync(resolved, { bigint: true });
      if (!stats.isFile()) continue;
      const identity = [
        command,
        resolved,
        stats.dev,
        stats.ino,
        stats.mode,
        stats.size,
        stats.mtimeNs,
        stats.ctimeNs,
      ].join("\0");
      return { identity, resolved };
    } catch {
      // Continue through PATH candidates.
    }
  }
  throw new Error(`Verification evidence could not resolve the ${command} executable.`);
}

export function resolveVerificationExecutable(
  command,
  { cwd = process.cwd(), environment = verificationChildEnvironment(process.env, cwd) } = {},
) {
  return executableDetails(command, path.resolve(cwd), environment).resolved;
}

function executableSnapshot(cwd, environment) {
  const hash = createHash("sha256").update("verification-executables-v1\0");
  const details = new Map();
  for (const command of ["node", "pnpm", "mise", "bash", "git", "shellcheck"]) {
    const executable = executableDetails(command, cwd, environment);
    details.set(command, executable);
    hash.update(executable.identity).update("\0");
  }
  return { details, digest: hash.digest("hex") };
}

export function normalizedVerificationRuntimeIdentity(runtimeIdentity, { cwd } = {}) {
  const runtimeCwd = path.resolve(cwd ?? process.cwd());
  const childEnvironment = runtimeIdentity
    ? null
    : verificationChildEnvironment(process.env, runtimeCwd);
  const environment = runtimeIdentity ? null : environmentDigest(childEnvironment);
  const executables = runtimeIdentity ? null : executableSnapshot(runtimeCwd, childEnvironment);
  const value =
    runtimeIdentity ??
    Object.freeze({
      arch: process.arch,
      environment,
      executables: executables.digest,
      mise: commandVersionDigest(
        "mise",
        ["--version"],
        runtimeCwd,
        executables.details.get("mise"),
        childEnvironment,
        environment,
      ),
      node: process.versions.node,
      platform: process.platform,
      pnpm: commandVersionDigest(
        "pnpm",
        ["--version"],
        runtimeCwd,
        executables.details.get("pnpm"),
        childEnvironment,
        environment,
      ),
    });
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !== identityKeys.join("\n")
  ) {
    throw new Error("Verification evidence requires the complete public runtime identity.");
  }
  const normalized = {};
  for (const key of identityKeys) {
    const item = value[key];
    if (typeof item !== "string" || !item || item.length > 256 || /[\0\r\n]/.test(item)) {
      throw new Error(`Verification evidence runtime identity has an invalid ${key} value.`);
    }
    normalized[key] = item;
  }
  for (const key of ["environment", "executables", "mise", "pnpm"]) {
    if (!/^[a-f0-9]{64}$/u.test(normalized[key])) {
      throw new Error(`Verification evidence runtime identity has an invalid ${key} digest.`);
    }
  }
  return Object.freeze(normalized);
}
