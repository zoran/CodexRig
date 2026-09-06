#!/usr/bin/env node
/** Owns startup attestation behavior for the setup, launch, and portable project boundary. */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawnSyncWithBoundedIo as spawnSync } from "../repository/runtime-process-io.mjs";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  frameworkRoot,
  readFrameworkContract,
  readRegularFrameworkFile,
  resolveFrameworkPath,
  serializeCanonicalJson,
  sha256,
} from "../contracts/framework-contract.mjs";
import {
  repositoryCodexRuntimeCacheDirectory,
  repositoryCodexRuntimeDirectory,
} from "../repository/source-inventory.mjs";
import {
  atomicReplaceOwnedFile,
  closeOwnedDirectoryBinding,
  ensureOwnedPrivateDirectory,
  openPrivateOwnedDirectory,
  ownedDirectoryChildPath,
  readStableOwnedFile,
} from "../filesystem/owned-path-safety.mjs";
import {
  activateRuntimeSessionLease,
  inspectRuntimeSessionLease,
  inspectRuntimeSessionPlan,
  releaseRuntimeSessionLease,
  repositoryRuntimeRootIdentity,
  reserveRuntimeSessionLease,
  transitionRuntimeSessionWriterProcess,
  validCodexSessionId,
} from "../repository/runtime-session-lease.mjs";
import { pnpmHooksDisabledEnvironment } from "../repository/pnpm-workspace-manifests.mjs";
import { startupExecutableClosurePaths } from "./startup-executable-closure.mjs";
import { validateStartupRuntimeExecutables } from "./startup-runtime-executables.mjs";
import { parsePortableCodexConfig } from "./validate-codex-config.mjs";

export const startupAttestationPath = `${repositoryCodexRuntimeCacheDirectory}/codexrig/startup-attestation.json`;
const startupAttestationKeys =
  "controlPolicySha256\nexpiresAt\nframeworkId\nframeworkVersion\ninputs\nissuedAt\nmodel\nnonceSha256\npermissionMode\nroot\nruntimeSessionIdSha256\nschemaVersion\nsessionSelection\nversions";
export const startupControlPolicies = Object.freeze({
  default: "interactive-v2:safe-defaults",
  noAltScreen: "interactive-v2:no-alt-screen",
  yolo: "dev-yolo-v1:default-screen",
  yoloNoAltScreen: "dev-yolo-v1:no-alt-screen",
});
const fixedStartupAttestedInputs = Object.freeze([
  ".codex/config.toml",
  ".codex/hooks.json",
  ".codexrig/compatibility.json",
  ".codexrig/framework.json",
  "mise.lock",
  "mise.toml",
  "package.json",
  "pnpm-lock.yaml",
  "scripts/framework/framework-doctor.mjs",
  "scripts/context/session-stop-lifecycle.mjs",
  "scripts/setup/start-codex.sh",
  "scripts/setup/session-control-hook-command.mjs",
  "scripts/setup/startup-session-controller.mjs",
  "scripts/setup/validate-codex-config.mjs",
  "scripts/setup/validate-codex-model-policy.mjs",
]);

export function startupAttestedInputPaths(root = frameworkRoot) {
  const agentsDirectory = resolveFrameworkPath(root, ".codex/agents");
  if (!existsSync(agentsDirectory)) {
    throw new Error("Startup attestation requires project-scoped agent roles.");
  }
  const directoryStats = lstatSync(agentsDirectory);
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new Error("Startup attestation agent-role path must be a real directory.");
  }
  const agentInputs = readdirSync(agentsDirectory, { withFileTypes: true }).map((entry) => {
    if (
      entry.isSymbolicLink() ||
      !entry.isFile() ||
      !/^[a-z][a-z0-9_-]*\.toml$/u.test(entry.name)
    ) {
      throw new Error(`Startup attestation rejects agent-role entry ${entry.name}.`);
    }
    return `.codex/agents/${entry.name}`;
  });
  return [
    ...new Set([
      ...fixedStartupAttestedInputs,
      ...startupExecutableClosurePaths(root),
      ...agentInputs,
    ]),
  ].sort();
}

export const startupAttestedInputs = Object.freeze(startupAttestedInputPaths(frameworkRoot));

function commandVersion(root, executable, args, label) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    env: label === "pnpm" ? pnpmHooksDisabledEnvironment(process.env) : process.env,
    input: "",
    maxBuffer: 1024 * 1024,
    stdio: "pipe",
    timeout: 20_000,
  });
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`${label} version probe failed.`);
  }
  const match = `${result.stdout}${result.stderr}`.match(
    /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/u,
  );
  if (!match) throw new Error(`${label} did not report a semantic version.`);
  return match[1];
}

function runtimeVersions(root, runtimeExecutables) {
  const executables = validateStartupRuntimeExecutables(root, runtimeExecutables);
  return {
    codex: commandVersion(root, executables.codex, ["--version"], "Codex"),
    node: commandVersion(root, executables.node, ["--version"], "Node"),
    pnpm: commandVersion(root, executables.pnpm, ["--version"], "pnpm"),
  };
}

function inputHashes(root) {
  return Object.fromEntries(
    startupAttestedInputPaths(root).map((relativePath) => [
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
    ensureOwnedPrivateDirectory(root, directory, "startup attestation state directory");
  }
}

function atomicWriteAttestation(root, content, { testHooks } = {}) {
  ensurePrivateStateDirectory(root);
  const stateRoot = resolveFrameworkPath(root, `${repositoryCodexRuntimeCacheDirectory}/codexrig`);
  const directory = openPrivateOwnedDirectory(root, stateRoot, "startup attestation state");
  try {
    atomicReplaceOwnedFile(
      directory,
      path.basename(startupAttestationPath),
      content,
      "startup attestation",
      { testHooks },
    );
  } finally {
    closeOwnedDirectoryBinding(directory);
  }
}

function readAttestation(root) {
  const stateRoot = resolveFrameworkPath(root, `${repositoryCodexRuntimeCacheDirectory}/codexrig`);
  if (!existsSync(stateRoot)) throw new Error("No launcher attestation exists.");
  const directory = openPrivateOwnedDirectory(root, stateRoot, "startup attestation state");
  let value;
  try {
    const basename = path.basename(startupAttestationPath);
    const target = ownedDirectoryChildPath(directory, basename, "startup attestation");
    if (!existsSync(target)) throw new Error("No launcher attestation exists.");
    const snapshot = readStableOwnedFile(directory, basename, "startup attestation", {
      maximumBytes: 1024 * 1024,
    });
    if (
      (snapshot.stats.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && snapshot.stats.uid !== process.getuid())
    ) {
      throw new Error("Launcher attestation state is unsafe.");
    }
    value = JSON.parse(snapshot.buffer.toString("utf8"));
  } catch {
    throw new Error("Launcher attestation is invalid.");
  } finally {
    closeOwnedDirectoryBinding(directory);
  }
  if (
    value?.schemaVersion !== 7 ||
    Object.keys(value).sort().join("\n") !== startupAttestationKeys
  ) {
    throw new Error("Launcher attestation schema is unsupported.");
  }
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

function startupRuntimePolicy(root, controlPolicy) {
  const portablePolicy = parsePortableCodexConfig(
    readRegularFrameworkFile(root, ".codex/config.toml"),
  );
  return Object.freeze({
    model: portablePolicy.model,
    reasoningEffort: portablePolicy.model_reasoning_effort,
    permissionMode:
      controlPolicy === startupControlPolicies.yolo ||
      controlPolicy === startupControlPolicies.yoloNoAltScreen
        ? "bypassPermissions"
        : "default",
  });
}

/** Captures the exact read-only startup basis that must survive preflight and every launch. */
export function startupAttestationBasis({
  root = frameworkRoot,
  controlPolicy = process.env.CODEXRIG_STARTUP_CONTROL_POLICY ?? "",
  runtimeExecutables,
} = {}) {
  const runtimePolicy = startupRuntimePolicy(root, startupControlPolicy(controlPolicy));
  return Object.freeze({
    inputs: Object.freeze(inputHashes(root)),
    model: runtimePolicy.model,
    permissionMode: runtimePolicy.permissionMode,
    reasoningEffort: runtimePolicy.reasoningEffort,
    versions: Object.freeze(runtimeVersions(root, runtimeExecutables)),
  });
}

/** Inspects whether native session selection can reserve this repository. */
export function startupSessionPlan({ root = frameworkRoot } = {}) {
  return inspectRuntimeSessionPlan({ root });
}

export function startupSessionPlanToken(plan) {
  if (plan?.mode === "resume-picker") return "resume-picker";
  throw new Error("Canonical launcher session plan is invalid.");
}

/** Atomically reserves native session selection before attesting its launcher inputs. */
export function reserveStartupAttestation(
  root,
  pid,
  {
    controlPolicy = process.env.CODEXRIG_STARTUP_CONTROL_POLICY ?? "",
    expectedBasis,
    runtimeExecutables,
  } = {},
) {
  const reservation = reserveRuntimeSessionLease({ root, pid });
  try {
    const issued = issueStartupAttestation({
      root,
      controlPolicy,
      expectedBasis,
      runtimeExecutables,
    });
    return Object.freeze({ ...issued, lease: reservation.lease, plan: reservation.plan });
  } catch (error) {
    releaseRuntimeSessionLease({ root, pid });
    throw error;
  }
}

export function runtimeSessionLaunchState(root, pid) {
  const current = inspectRuntimeSessionLease({ root });
  if (current.status !== "active" || current.lease.process.pid !== pid) {
    throw new Error("Launcher process does not own the current runtime session lease.");
  }
  return current.lease.phase;
}

function verifiedSessionTransition(
  root,
  pid,
  { controlPolicy, expectedAttestation, nonce, now, runtimeExecutables },
  allowedPhases = ["launching"],
) {
  const current = inspectRuntimeSessionLease({ root });
  if (
    current.status !== "active" ||
    current.lease.process.pid !== pid ||
    !allowedPhases.includes(current.lease.phase)
  ) {
    throw new Error("Session transition does not match the owned launcher lease phase.");
  }
  const effectiveControlPolicy = startupControlPolicy(controlPolicy);
  const expectedBasis = validateCurrentAttestationBasis({
    root,
    runtimeLease: current,
    effectiveControlPolicy,
    expectedAttestation,
    nonce,
    now,
    runtimeExecutables,
  });
  return { current, expectedBasis };
}

function transitionStartupSessionWriter(
  root,
  pid,
  writerPid,
  transition,
  {
    controlPolicy = process.env.CODEXRIG_STARTUP_CONTROL_POLICY ?? "",
    expectedAttestation,
    nonce = process.env.CODEXRIG_STARTUP_NONCE ?? "",
    now = Date.now,
    runtimeExecutables,
  } = {},
) {
  const { current } = verifiedSessionTransition(
    root,
    pid,
    { controlPolicy, expectedAttestation, nonce, now, runtimeExecutables },
    transition === "codex" ? ["launching", "active"] : ["launching"],
  );
  return transitionRuntimeSessionWriterProcess({
    root,
    pid,
    runtimeSessionId: current.lease.sessionId,
    transition,
    writerPid,
  });
}

/** Binds the already-loaded foreground supervisor while Codex is still behind its closed gate. */
export function bindStartupSessionWriter(root, pid, writerPid, options = {}) {
  return transitionStartupSessionWriter(root, pid, writerPid, "supervisor", options);
}

/** Persists the only crash-indeterminate window immediately before the supervisor may spawn. */
export function beginStartupSessionWriterHandoff(root, pid, options = {}) {
  return transitionStartupSessionWriter(root, pid, undefined, "handoff", options);
}

/** Records a normal supervisor completion when Codex exited before its PID could be captured. */
export function completeStartupSessionWriterHandoff(
  root,
  pid,
  { expectedAttestation, nonce = process.env.CODEXRIG_STARTUP_NONCE ?? "" } = {},
) {
  if (expectedAttestation === undefined) {
    throw new Error("Terminal writer completion requires its issue-time attestation.");
  }
  const current = inspectRuntimeSessionLease({ root });
  const persistedAttestation = readAttestation(root);
  if (
    current.status !== "active" ||
    current.lease.process.pid !== pid ||
    !["launching", "active"].includes(current.lease.phase) ||
    !["handoff", "bound"].includes(current.lease.writerPhase) ||
    JSON.stringify(expectedAttestation) !== JSON.stringify(persistedAttestation) ||
    !equalHash(expectedAttestation.nonceSha256, nonce) ||
    !equalHash(expectedAttestation.runtimeSessionIdSha256, current.lease.sessionId)
  ) {
    throw new Error("Terminal writer completion does not match the issue-time launcher state.");
  }
  return transitionRuntimeSessionWriterProcess({
    root,
    pid,
    runtimeSessionId: current.lease.sessionId,
    transition: "complete",
  });
}

/** Binds the exact spawned Codex PID before its foreground supervisor may be treated as sufficient. */
export function bindStartupSessionCodexProcess(root, pid, codexPid, options = {}) {
  return transitionStartupSessionWriter(root, pid, codexPid, "codex", options);
}

export function issueStartupAttestation({
  root = frameworkRoot,
  now = Date.now,
  controlPolicy = process.env.CODEXRIG_STARTUP_CONTROL_POLICY ?? "",
  expectedBasis,
  runtimeExecutables,
  testHooks,
} = {}) {
  const contract = readFrameworkContract(root);
  const effectiveControlPolicy = startupControlPolicy(controlPolicy);
  const runtimeLease = inspectRuntimeSessionLease({ root });
  if (runtimeLease.status !== "active") {
    throw new Error("Startup attestation requires an active current-schema runtime session lease.");
  }
  const currentBasis = startupAttestationBasis({
    root,
    controlPolicy: effectiveControlPolicy,
    runtimeExecutables,
  });
  const { inputs, model, permissionMode, reasoningEffort, versions } = currentBasis;
  if (
    expectedBasis !== undefined &&
    (JSON.stringify(expectedBasis.inputs) !== JSON.stringify(inputs) ||
      JSON.stringify(expectedBasis.versions) !== JSON.stringify(versions) ||
      expectedBasis.model !== model ||
      expectedBasis.permissionMode !== permissionMode ||
      expectedBasis.reasoningEffort !== reasoningEffort)
  ) {
    throw new Error("Startup inputs changed after their issue-time basis was captured.");
  }
  const nonce = randomBytes(32).toString("base64url");
  const issuedAt = now();
  const attestation = {
    schemaVersion: 7,
    frameworkId: contract.frameworkId,
    frameworkVersion: contract.frameworkVersion,
    issuedAt,
    expiresAt: issuedAt + contract.startup.attestationMaxAgeSeconds * 1000,
    controlPolicySha256: sha256(effectiveControlPolicy),
    model,
    nonceSha256: sha256(nonce),
    permissionMode,
    root: repositoryRuntimeRootIdentity(root),
    runtimeSessionIdSha256: sha256(runtimeLease.lease.sessionId),
    sessionSelection: "resume-picker",
    inputs,
    versions,
  };
  atomicWriteAttestation(root, serializeCanonicalJson(attestation), { testHooks });
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
  if (!validCodexSessionId(input.session_id)) {
    throw new Error("SessionStart hook input has an invalid session identifier.");
  }
  return input;
}

function validateCurrentAttestationBasis({
  root,
  runtimeLease,
  effectiveControlPolicy,
  expectedAttestation,
  nonce,
  now,
  runtimeExecutables,
}) {
  const contract = readFrameworkContract(root);
  const identity = repositoryRuntimeRootIdentity(root);
  const persistedAttestation = readAttestation(root);
  if (
    expectedAttestation !== undefined &&
    JSON.stringify(expectedAttestation) !== JSON.stringify(persistedAttestation)
  ) {
    throw new Error("Launcher attestation changed after the resume attempt began.");
  }
  const attestation = expectedAttestation ?? persistedAttestation;
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
  if (nonce !== undefined && !equalHash(attestation.nonceSha256, nonce)) {
    throw new Error("Canonical launcher nonce does not match the attestation.");
  }
  const runtimePolicy = startupRuntimePolicy(root, effectiveControlPolicy);
  if (
    !equalHash(attestation.controlPolicySha256, effectiveControlPolicy) ||
    attestation.permissionMode !== runtimePolicy.permissionMode
  ) {
    throw new Error("Codex control arguments differ from the launcher attestation.");
  }
  if (attestation.model !== runtimePolicy.model) {
    throw new Error("Codex model policy differs from the launcher attestation.");
  }
  if (attestation.sessionSelection !== "resume-picker") {
    throw new Error("Codex session selection differs from the launcher attestation.");
  }
  if (!equalHash(attestation.runtimeSessionIdSha256, runtimeLease.lease.sessionId)) {
    throw new Error("Codex runtime session lease differs from the launcher attestation.");
  }
  if (
    attestation.frameworkId !== contract.frameworkId ||
    attestation.frameworkVersion !== contract.frameworkVersion ||
    JSON.stringify(attestation.root) !== JSON.stringify(identity)
  ) {
    throw new Error("Launcher attestation does not match this framework root.");
  }
  const inputs = inputHashes(root);
  if (JSON.stringify(attestation.inputs) !== JSON.stringify(inputs)) {
    throw new Error("A startup-critical input changed after its attested basis was captured.");
  }
  const versions = runtimeVersions(root, runtimeExecutables);
  if (JSON.stringify(attestation.versions) !== JSON.stringify(versions)) {
    throw new Error("The runtime toolchain changed after its attested basis was captured.");
  }
  return Object.freeze({
    attestation,
    inputs,
    model: runtimePolicy.model,
    permissionMode: runtimePolicy.permissionMode,
    reasoningEffort: runtimePolicy.reasoningEffort,
    versions,
  });
}

export function verifyStartupAttestation({
  root = frameworkRoot,
  hookInput,
  expectedAttestation,
  nonce = process.env.CODEXRIG_STARTUP_NONCE ?? "",
  controlPolicy = process.env.CODEXRIG_STARTUP_CONTROL_POLICY ?? "",
  runtimeExecutables,
  now = Date.now,
} = {}) {
  const input =
    typeof hookInput === "string"
      ? parseHookInput(hookInput)
      : parseHookInput(JSON.stringify(hookInput));
  const runtimeLease = inspectRuntimeSessionLease({ root });
  if (runtimeLease.status !== "active") {
    throw new Error("Canonical launcher runtime session lease is missing or inactive.");
  }
  const identity = repositoryRuntimeRootIdentity(root);
  let inputRoot;
  try {
    if (typeof input.cwd !== "string" || input.cwd.length === 0) throw new Error("missing cwd");
    inputRoot = realpathSync.native(path.resolve(input.cwd));
  } catch {
    throw new Error("Codex session root is missing or invalid.");
  }
  if (inputRoot !== identity.path) {
    throw new Error("Codex session root differs from the attested project root.");
  }
  if (!/^[A-Za-z0-9_-]{40,128}$/u.test(nonce)) {
    throw new Error("Canonical launcher nonce is missing.");
  }
  const effectiveControlPolicy = startupControlPolicy(controlPolicy);
  const basis = validateCurrentAttestationBasis({
    root,
    runtimeLease,
    effectiveControlPolicy,
    expectedAttestation,
    nonce,
    now,
    runtimeExecutables,
  });
  if (input.permission_mode !== basis.permissionMode) {
    throw new Error("Codex effective permission mode differs from the launcher attestation.");
  }
  if (input.model !== basis.model) {
    throw new Error("Codex effective model differs from the launcher attestation.");
  }
  activateRuntimeSessionLease({
    root,
    pid: runtimeLease.lease.process.pid,
    runtimeSessionId: runtimeLease.lease.sessionId,
    codexSessionId: input.session_id,
  });
  return { ...basis.attestation, sessionSource: input.source };
}
