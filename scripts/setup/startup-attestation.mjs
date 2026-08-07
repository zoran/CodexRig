#!/usr/bin/env node
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  frameworkRoot,
  readFrameworkContract,
  readRegularFrameworkFile,
  resolveFrameworkPath,
  serializeCanonicalJson,
  sha256,
} from "../framework/framework-contract.mjs";
import {
  repositoryCodexRuntimeCacheDirectory,
  repositoryCodexRuntimeDirectory,
} from "../repository/source-inventory.mjs";

export const startupAttestationPath = `${repositoryCodexRuntimeCacheDirectory}/codexrig/startup-attestation.json`;
export const runtimeSessionLeasePath = `${repositoryCodexRuntimeDirectory}/codexrig-session.json`;
export const startupControlPolicies = Object.freeze({
  default: "interactive-v1:none",
  noAltScreen: "interactive-v1:no-alt-screen",
});
export const startupAttestedInputs = Object.freeze([
  ".codex/hooks.json",
  ".codexrig/compatibility.json",
  ".codexrig/framework.json",
  "mise.lock",
  "mise.toml",
  "package.json",
  "pnpm-lock.yaml",
  "scripts/deps/install-compatible.mjs",
  "scripts/framework/framework-doctor.mjs",
  "scripts/setup/start-codex.sh",
  "scripts/setup/startup-attestation.mjs",
  "scripts/setup/validate-codex-bootstrap.sh",
  "scripts/setup/verify-startup-attestation-on-session-start.sh",
]);

function commandVersion(root, executable, args, label) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    input: "",
    stdio: "pipe",
  });
  if (result.error || result.status !== 0) throw new Error(`${label} version probe failed.`);
  const match = `${result.stdout}${result.stderr}`.match(
    /\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/u,
  );
  if (!match) throw new Error(`${label} did not report a semantic version.`);
  return match[1];
}

function runtimeVersions(root) {
  return {
    codex: commandVersion(root, "codex", ["--version"], "Codex"),
    node: process.version.replace(/^v/u, ""),
    pnpm: commandVersion(root, "pnpm", ["--version"], "pnpm"),
  };
}

function rootIdentity(root) {
  const canonical = realpathSync.native(root);
  const stats = statSync(canonical);
  if (!stats.isDirectory()) throw new Error("Startup root must be a directory.");
  return { device: String(stats.dev), inode: String(stats.ino), path: canonical };
}

function processStatus(pid) {
  try {
    process.kill(pid, 0);
    return "active";
  } catch (error) {
    return error?.code === "ESRCH" ? "stale" : "unknown";
  }
}

function readRuntimeSessionLease(root) {
  const target = resolveFrameworkPath(root, runtimeSessionLeasePath);
  if (!existsSync(target)) return { path: target, status: "absent" };
  const initial = lstatSync(target, { bigint: true });
  if (
    initial.isSymbolicLink() ||
    !initial.isFile() ||
    initial.nlink !== 1n ||
    initial.size > 8_192n ||
    (initial.mode & 0o077n) !== 0n ||
    (typeof process.getuid === "function" && initial.uid !== BigInt(process.getuid()))
  ) {
    throw new Error("Codex runtime session lease is unsafe.");
  }
  const descriptor = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let content;
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (
      opened.dev !== initial.dev ||
      opened.ino !== initial.ino ||
      opened.size !== initial.size ||
      opened.nlink !== 1n
    ) {
      throw new Error("Codex runtime session lease changed while opening.");
    }
    content = readFileSync(descriptor, "utf8");
    const after = fstatSync(descriptor, { bigint: true });
    const rebound = lstatSync(target, { bigint: true });
    if (
      after.dev !== initial.dev ||
      after.ino !== initial.ino ||
      after.size !== initial.size ||
      rebound.dev !== initial.dev ||
      rebound.ino !== initial.ino ||
      rebound.nlink !== 1n
    ) {
      throw new Error("Codex runtime session lease changed while reading.");
    }
  } finally {
    closeSync(descriptor);
  }
  let lease;
  try {
    lease = JSON.parse(content);
  } catch {
    throw new Error("Codex runtime session lease is invalid.");
  }
  const identity = rootIdentity(root);
  if (
    !lease ||
    typeof lease !== "object" ||
    Array.isArray(lease) ||
    Object.keys(lease).sort().join("\n") !== "pid\nroot\nschemaVersion\nstartedAt" ||
    lease.schemaVersion !== 1 ||
    !Number.isSafeInteger(lease.pid) ||
    lease.pid <= 0 ||
    typeof lease.startedAt !== "string" ||
    !Number.isFinite(Date.parse(lease.startedAt)) ||
    JSON.stringify(lease.root) !== JSON.stringify(identity)
  ) {
    throw new Error("Codex runtime session lease does not match this framework root.");
  }
  return {
    fileIdentity: `${initial.dev}:${initial.ino}`,
    lease,
    path: target,
    status: processStatus(lease.pid),
  };
}

export function inspectRuntimeSessionLease({ root = frameworkRoot } = {}) {
  return readRuntimeSessionLease(root);
}

function unlinkStableRuntimeSessionLease(root, expected) {
  const current = readRuntimeSessionLease(root);
  if (
    current.status === "absent" ||
    current.fileIdentity !== expected.fileIdentity ||
    current.lease.pid !== expected.lease.pid ||
    current.lease.startedAt !== expected.lease.startedAt
  ) {
    throw new Error("Codex runtime session lease changed before removal.");
  }
  unlinkSync(current.path);
}

export function clearStaleRuntimeSessionLease({ root = frameworkRoot } = {}) {
  const current = readRuntimeSessionLease(root);
  if (current.status === "absent") return false;
  if (current.status !== "stale") {
    throw new Error("Codex runtime session is still active or cannot be verified as stopped.");
  }
  unlinkStableRuntimeSessionLease(root, current);
  return true;
}

export function issueRuntimeSessionLease({ root = frameworkRoot, pid } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("Codex runtime session lease requires a positive process id.");
  }
  ensurePrivateStateDirectory(root);
  const current = readRuntimeSessionLease(root);
  if (current.status === "active" || current.status === "unknown") {
    throw new Error("Another Codex session already owns this repository runtime.");
  }
  if (current.status === "stale") unlinkStableRuntimeSessionLease(root, current);
  const target = resolveFrameworkPath(root, runtimeSessionLeasePath);
  const lease = {
    schemaVersion: 1,
    pid,
    startedAt: new Date().toISOString(),
    root: rootIdentity(root),
  };
  let descriptor;
  try {
    descriptor = openSync(
      target,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    writeFileSync(descriptor, serializeCanonicalJson(lease), "utf8");
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return lease;
}

export function releaseRuntimeSessionLease({ root = frameworkRoot, pid } = {}) {
  const current = readRuntimeSessionLease(root);
  if (current.status === "absent") return false;
  if (!Number.isSafeInteger(pid) || current.lease.pid !== pid) {
    throw new Error("Codex runtime session lease is owned by a different process.");
  }
  unlinkStableRuntimeSessionLease(root, current);
  return true;
}

function inputHashes(root) {
  return Object.fromEntries(
    startupAttestedInputs.map((relativePath) => [
      relativePath,
      sha256(readRegularFrameworkFile(root, relativePath)),
    ]),
  );
}

function ensurePrivateStateDirectory(root) {
  const runtimeRoot = resolveFrameworkPath(root, repositoryCodexRuntimeDirectory);
  const cacheRoot = resolveFrameworkPath(root, repositoryCodexRuntimeCacheDirectory);
  const stateRoot = resolveFrameworkPath(root, `${repositoryCodexRuntimeCacheDirectory}/codexrig`);
  for (const directory of [runtimeRoot, cacheRoot, stateRoot]) {
    if (existsSync(directory)) {
      const stats = lstatSync(directory);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error("Startup attestation state path must be a real directory.");
      }
    } else {
      mkdirSync(directory, { mode: 0o700 });
    }
    chmodSync(directory, 0o700);
  }
}

function atomicWriteAttestation(root, content) {
  ensurePrivateStateDirectory(root);
  const target = resolveFrameworkPath(root, startupAttestationPath);
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error("Startup attestation must not be a symlink.");
  }
  const temporary = `${target}.${process.pid}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, content, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, target);
    chmodSync(target, 0o600);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function readAttestation(root) {
  const target = resolveFrameworkPath(root, startupAttestationPath);
  if (!existsSync(target)) throw new Error("No launcher attestation exists.");
  const stats = lstatSync(target);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1 || stats.size > 1024 * 1024) {
    throw new Error("Launcher attestation state is unsafe.");
  }
  let value;
  try {
    value = JSON.parse(readFileSync(target, "utf8"));
  } catch {
    throw new Error("Launcher attestation is invalid.");
  }
  if (value?.schemaVersion !== 2) throw new Error("Launcher attestation schema is unsupported.");
  return value;
}

function equalHash(expected, value) {
  if (typeof expected !== "string" || !/^[0-9a-f]{64}$/u.test(expected)) return false;
  const actualBuffer = Buffer.from(sha256(value), "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function startupControlPolicy(value) {
  if (!Object.values(startupControlPolicies).includes(value)) {
    throw new Error("Canonical launcher control policy is missing or unsupported.");
  }
  return value;
}

export function issueStartupAttestation({
  root = frameworkRoot,
  now = Date.now,
  controlPolicy = process.env.CODEXRIG_STARTUP_CONTROL_POLICY ?? "",
} = {}) {
  const contract = readFrameworkContract(root);
  const effectiveControlPolicy = startupControlPolicy(controlPolicy);
  const nonce = randomBytes(32).toString("base64url");
  const issuedAt = now();
  const attestation = {
    schemaVersion: 2,
    frameworkId: contract.frameworkId,
    frameworkVersion: contract.frameworkVersion,
    issuedAt,
    expiresAt: issuedAt + contract.startup.attestationMaxAgeSeconds * 1000,
    controlPolicySha256: sha256(effectiveControlPolicy),
    nonceSha256: sha256(nonce),
    root: rootIdentity(root),
    inputs: inputHashes(root),
    versions: runtimeVersions(root),
  };
  atomicWriteAttestation(root, serializeCanonicalJson(attestation));
  return { attestation, nonce };
}

function parseHookInput(content) {
  let input;
  try {
    input = JSON.parse(content);
  } catch {
    throw new Error("SessionStart hook input is invalid.");
  }
  if (input?.hook_event_name !== "SessionStart") {
    throw new Error("Startup verifier only accepts SessionStart events.");
  }
  if (!["startup", "resume"].includes(input.source)) {
    throw new Error("Startup verifier received an unsupported session source.");
  }
  return input;
}

export function verifyStartupAttestation({
  root = frameworkRoot,
  hookInput,
  nonce = process.env.CODEXRIG_STARTUP_NONCE ?? "",
  controlPolicy = process.env.CODEXRIG_STARTUP_CONTROL_POLICY ?? "",
  now = Date.now,
} = {}) {
  const input = typeof hookInput === "string" ? parseHookInput(hookInput) : hookInput;
  if (!input || input.hook_event_name !== "SessionStart") {
    throw new Error("Startup verifier requires a SessionStart event.");
  }
  if (!["startup", "resume"].includes(input.source)) {
    throw new Error("Startup verifier requires a startup or resume source.");
  }
  const runtimeLease = inspectRuntimeSessionLease({ root });
  if (runtimeLease.status !== "active") {
    throw new Error("Canonical launcher runtime session lease is missing or inactive.");
  }
  const identity = rootIdentity(root);
  if (input.cwd && realpathSync.native(path.resolve(input.cwd)) !== identity.path) {
    throw new Error("Codex session root differs from the attested project root.");
  }
  if (!/^[A-Za-z0-9_-]{40,128}$/u.test(nonce)) {
    throw new Error("Canonical launcher nonce is missing.");
  }
  const effectiveControlPolicy = startupControlPolicy(controlPolicy);
  const contract = readFrameworkContract(root);
  const attestation = readAttestation(root);
  const currentTime = now();
  if (
    !Number.isSafeInteger(attestation.issuedAt) ||
    !Number.isSafeInteger(attestation.expiresAt) ||
    attestation.issuedAt > currentTime + 60_000 ||
    currentTime > attestation.expiresAt ||
    attestation.expiresAt - attestation.issuedAt !==
      contract.startup.attestationMaxAgeSeconds * 1000
  ) {
    throw new Error("Launcher attestation is stale or has an invalid lifetime.");
  }
  if (!equalHash(attestation.nonceSha256, nonce)) {
    throw new Error("Canonical launcher nonce does not match the attestation.");
  }
  if (!equalHash(attestation.controlPolicySha256, effectiveControlPolicy)) {
    throw new Error("Codex control arguments differ from the launcher attestation.");
  }
  if (
    attestation.frameworkId !== contract.frameworkId ||
    attestation.frameworkVersion !== contract.frameworkVersion ||
    JSON.stringify(attestation.root) !== JSON.stringify(identity)
  ) {
    throw new Error("Launcher attestation does not match this framework root.");
  }
  if (JSON.stringify(attestation.inputs) !== JSON.stringify(inputHashes(root))) {
    throw new Error("A startup-critical input changed after dependency refresh.");
  }
  if (JSON.stringify(attestation.versions) !== JSON.stringify(runtimeVersions(root))) {
    throw new Error("The runtime toolchain changed after dependency refresh.");
  }
  return attestation;
}

function sessionStartSuccess(attestation) {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `CodexRig startup ${attestation.frameworkVersion} was verified after compatible dependency refresh.`,
    },
  };
}

function sessionStartFailure(error) {
  const reason = `CodexRig startup verification failed: ${error.message} Start with bash scripts/setup/start-codex.sh.`;
  return { continue: false, stopReason: reason, systemMessage: reason };
}

function stdin() {
  return readFileSync(0, "utf8");
}

function main() {
  const command = process.argv[2];
  if (command === "issue") {
    const pidFlag = process.argv[3];
    const pidValue = process.argv[4];
    if (pidFlag !== "--session-pid" || !/^[1-9]\d*$/u.test(pidValue ?? "")) {
      throw new Error("Usage: startup-attestation.mjs issue --session-pid <pid>");
    }
    const sessionPid = Number(pidValue);
    issueRuntimeSessionLease({ pid: sessionPid });
    try {
      process.stdout.write(`${issueStartupAttestation().nonce}\n`);
    } catch (error) {
      releaseRuntimeSessionLease({ pid: sessionPid });
      throw error;
    }
    return;
  }
  if (command === "verify") {
    try {
      console.log(
        JSON.stringify(sessionStartSuccess(verifyStartupAttestation({ hookInput: stdin() }))),
      );
    } catch (error) {
      console.log(JSON.stringify(sessionStartFailure(error)));
    }
    return;
  }
  throw new Error("Usage: startup-attestation.mjs issue --session-pid <pid>|verify");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Startup attestation failed: ${error.message}`);
    process.exit(1);
  }
}
