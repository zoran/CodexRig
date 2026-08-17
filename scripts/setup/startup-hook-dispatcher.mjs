#!/usr/bin/env node
/** Verifies an issue-time executable snapshot before dispatching a Codex lifecycle hook. */
import { createHash, timingSafeEqual } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const maximumAttestationBytes = 1024 * 1024;
const maximumHookInputBytes = 262_144;

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function equalDigest(expected, value) {
  if (typeof expected !== "string" || !/^[a-f0-9]{64}$/u.test(expected)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(digest(value), "hex"));
}

function realPrivateFile(target, label, maximumBytes) {
  const stats = lstatSync(target);
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    stats.nlink !== 1 ||
    stats.size > maximumBytes ||
    (stats.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && stats.uid !== process.getuid())
  ) {
    throw new Error(`${label} is unsafe.`);
  }
  const content = readFileSync(target);
  const after = lstatSync(target);
  if (stats.dev !== after.dev || stats.ino !== after.ino || stats.size !== after.size) {
    throw new Error(`${label} changed while it was read.`);
  }
  return content;
}

function repositoryIdentity(root) {
  const canonical = realpathSync.native(root);
  const stats = statSync(canonical);
  if (!stats.isDirectory()) throw new Error("Attested project root is not a directory.");
  return { device: String(stats.dev), inode: String(stats.ino), path: canonical };
}

function attestedRuntime() {
  const rootValue = process.env.CODEXRIG_PROJECT_ROOT;
  const homeValue = process.env.CODEX_HOME;
  if (!rootValue || !homeValue) throw new Error("Canonical lifecycle environment is missing.");
  const root = realpathSync.native(path.resolve(rootValue));
  const expectedHome = path.join(root, ".codex", "runtime");
  if (realpathSync.native(path.resolve(homeValue)) !== expectedHome) {
    throw new Error("Codex runtime home differs from the attested repository.");
  }
  const attestationPath = path.join(expectedHome, "cache", "codexrig", "startup-attestation.json");
  const attestation = JSON.parse(
    realPrivateFile(attestationPath, "Launcher attestation", maximumAttestationBytes).toString(
      "utf8",
    ),
  );
  if (
    attestation?.schemaVersion !== 3 ||
    JSON.stringify(attestation.root) !== JSON.stringify(repositoryIdentity(root)) ||
    !equalDigest(attestation.nonceSha256, process.env.CODEXRIG_STARTUP_NONCE ?? "") ||
    !attestation.inputs ||
    typeof attestation.inputs !== "object" ||
    Array.isArray(attestation.inputs)
  ) {
    throw new Error("Launcher attestation does not authorize this lifecycle process.");
  }
  const self = realPrivateFile(
    fileURLToPath(import.meta.url),
    "Startup hook dispatcher",
    maximumAttestationBytes,
  );
  if (!equalDigest(attestation.dispatcherSha256, self)) {
    throw new Error("Startup hook dispatcher differs from its issue-time snapshot.");
  }
  for (const [relativePath, expected] of Object.entries(attestation.inputs)) {
    const candidate = path.resolve(root, relativePath);
    const relative = path.relative(root, candidate);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Launcher attestation contains an unsafe input path.");
    }
    const stats = lstatSync(candidate);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) {
      throw new Error("A startup-critical input is unsafe.");
    }
    if (!equalDigest(expected, readFileSync(candidate))) {
      throw new Error("A startup-critical input changed after attestation issuance.");
    }
  }
  return { root };
}

function hookInput() {
  const input = readFileSync(0);
  if (input.length > maximumHookInputBytes) throw new Error("Lifecycle hook input is oversized.");
  return input;
}

function childEnvironment() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("CONTEXT_INDEX_")) delete environment[key];
  }
  for (const key of [
    "NPM_CONFIG_IGNORE_PNPMFILE",
    "PNPM_CONFIG_IGNORE_PNPMFILE",
    "npm_config_ignore_pnpmfile",
    "pnpm_config_ignore_pnpmfile",
  ]) {
    environment[key] = "true";
  }
  return environment;
}

function dispatch(mode) {
  const { root } = attestedRuntime();
  const entry =
    mode === "session-start"
      ? "scripts/setup/startup-attestation.mjs"
      : mode === "stop"
        ? "scripts/context/refresh-context-index-on-stop.mjs"
        : null;
  if (!entry) throw new Error("Unsupported lifecycle dispatch mode.");
  const result = spawnSync(
    process.execPath,
    [path.join(root, entry), ...(mode === "session-start" ? ["verify"] : [])],
    {
      cwd: root,
      encoding: null,
      env: childEnvironment(),
      input: hookInput(),
      maxBuffer: 4 * 1024 * 1024,
      stdio: "pipe",
      timeout: mode === "stop" ? 590_000 : 25_000,
    },
  );
  if (result.stdout?.length) process.stdout.write(result.stdout);
  if (result.error || result.signal || result.status !== 0) {
    throw new Error("Attested lifecycle implementation failed.");
  }
  if (result.stderr?.length) process.stderr.write(result.stderr);
}

try {
  dispatch(process.argv[2]);
} catch {
  const stop = process.argv[2] === "stop";
  const reason = stop
    ? "CodexRig Stop lifecycle could not verify its issue-time executable snapshot. Stop completely and restart with bash scripts/setup/start-codex.sh."
    : "CodexRig startup verification could not run. Start with bash scripts/setup/start-codex.sh.";
  process.stdout.write(
    `${JSON.stringify(stop ? { systemMessage: reason } : { continue: false, stopReason: reason, systemMessage: reason })}\n`,
  );
}
