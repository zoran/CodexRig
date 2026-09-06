#!/usr/bin/env node
/** Owns the preloaded Codex process, native resume selection, SessionStart, and Stop control boundary. */
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runStopLifecycle } from "../context/session-stop-lifecycle.mjs";
import { frameworkRoot } from "../contracts/framework-contract.mjs";
import {
  inspectRuntimeSessionLease,
  invalidRuntimeSessionLeaseErrorCode,
  releaseRuntimeSessionLease,
} from "../repository/runtime-session-lease.mjs";
import { formatContextError } from "../terminal/terminal-output.mjs";
import {
  reserveStartupAttestation,
  runtimeSessionLaunchState,
  startupAttestationBasis,
  startupControlPolicies,
  verifyStartupAttestation,
} from "./startup-attestation.mjs";
import { runStartupCodexProcess } from "./startup-codex-process.mjs";
import {
  sessionControlHookConfigArguments,
  sessionControlHookExpectations,
  sessionControlHookInputMaximumBytes,
} from "./session-control-hook-command.mjs";
import {
  canonicalExternalExecutable,
  resolveStartupRuntimeExecutables,
} from "./startup-runtime-executables.mjs";
import { validateRuntimeCodexConfig } from "./validate-codex-config.mjs";
import { sessionStartSuccess } from "./startup-session-context.mjs";

const modulePath = fileURLToPath(import.meta.url);
const sessionControlTokenPattern = /^[A-Za-z0-9_-]{40,128}$/u;
const hookPreflightMaximumBytes = 1_048_576;
const hookPreflightTimeoutMilliseconds = 20_000;
const inheritedExecutionControlKeys = new Set([
  "BASH_ENV",
  "COMSPEC",
  "CODEXRIG_LAUNCHER_PID",
  "CODEXRIG_SESSION_CONTROL_NODE",
  "CODEXRIG_SESSION_CONTROL_PORT",
  "CODEXRIG_SESSION_CONTROL_TOKEN",
  "CODEXRIG_STARTUP_CONTROL_POLICY",
  "CODEXRIG_STARTUP_NONCE",
  "CODEXRIG_STARTUP_RESUME_SESSION_ID",
  "CODEXRIG_STARTUP_SESSION_SOURCE",
  "ENV",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NPM_CONFIG_NODE_OPTIONS",
  "NPM_CONFIG_SCRIPT_SHELL",
  "PNPM_CONFIG_NODE_OPTIONS",
  "PNPM_CONFIG_SCRIPT_SHELL",
  "SHELL",
]);

function controllerUsage() {
  return (
    "Usage: startup-session-controller.mjs --control-policy <policy> " +
    "--codex-executable <absolute-path>"
  );
}

/** Parses only the closed argument shape emitted by the canonical Bash launcher. */
export function parseSessionControllerArguments(argv, root = frameworkRoot) {
  if (argv.length !== 6 || argv[2] !== "--control-policy" || argv[4] !== "--codex-executable") {
    throw new Error(controllerUsage());
  }
  const controlPolicy = argv[3];
  if (!Object.values(startupControlPolicies).includes(controlPolicy)) {
    throw new Error("Canonical launcher control policy is unsupported.");
  }
  const codexExecutable = canonicalExternalExecutable(root, argv[5], "Canonical Codex");
  return Object.freeze({
    codexExecutable,
    controlPolicy,
  });
}

function codexControlArguments(controlPolicy) {
  const noAltScreen =
    controlPolicy === startupControlPolicies.noAltScreen ||
    controlPolicy === startupControlPolicies.yoloNoAltScreen;
  const yolo =
    controlPolicy === startupControlPolicies.yolo ||
    controlPolicy === startupControlPolicies.yoloNoAltScreen;
  return [
    ...(noAltScreen ? ["--no-alt-screen"] : []),
    ...(yolo
      ? ["--dangerously-bypass-approvals-and-sandbox"]
      : [
          "--ask-for-approval",
          "on-request",
          "--sandbox",
          "workspace-write",
          "-c",
          "sandbox_workspace_write.network_access=false",
        ]),
  ];
}

function codexIntelligenceArguments(model, reasoningEffort) {
  if (
    typeof model !== "string" ||
    model.length === 0 ||
    typeof reasoningEffort !== "string" ||
    reasoningEffort.length === 0
  ) {
    throw new Error("Canonical Codex intelligence policy is missing.");
  }
  return [
    "-c",
    `model=${JSON.stringify(model)}`,
    "-c",
    `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`,
  ];
}

/** Builds one canonical Codex CLI shape from the attested control and session selection. */
export function codexArgumentsFor({ controlPolicy, hookShellName, model, reasoningEffort, root }) {
  const args = [
    "resume",
    "--cd",
    root,
    ...codexControlArguments(controlPolicy),
    ...codexIntelligenceArguments(model, reasoningEffort),
    ...sessionControlHookConfigArguments(hookShellName),
  ];
  return args;
}

function timingSafeToken(expected, actual) {
  if (!sessionControlTokenPattern.test(actual ?? "")) return false;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");
  return (
    expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function boundedRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > sessionControlHookInputMaximumBytes) {
        reject(new Error("Lifecycle hook input exceeds its bounded size."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once("error", reject);
    request.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function sessionStartFailure(error, root) {
  const reason = `CodexRig startup verification failed: ${formatContextError(error, root)}. Start with bash scripts/setup/start-codex.sh.`;
  return { continue: false, stopReason: reason, systemMessage: reason };
}

function stopFailure(error, root) {
  return {
    systemMessage:
      `CodexRig Stop lifecycle failed inside its issue-time controller: ${formatContextError(error, root)}. ` +
      "Stop completely and restart with bash scripts/setup/start-codex.sh.",
  };
}

function writeControllerResponse(response, status, output) {
  const content = output === null ? "" : `${JSON.stringify(output)}\n`;
  response.writeHead(status, {
    "cache-control": "no-store",
    connection: "close",
    "content-length": Buffer.byteLength(content, "utf8"),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(content);
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ exclusive: true, host: "127.0.0.1", port: 0 }, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Session controller did not bind a private loopback endpoint.");
  }
  return address.port;
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

function createLifecycleServer({ controlToken, launch, root }) {
  let lifecycleQueue = Promise.resolve();
  const server = http.createServer((request, response) => {
    const handleRequest = async () => {
      const mode =
        request.url === "/session-start"
          ? "session-start"
          : request.url === "/stop"
            ? "stop"
            : null;
      const suppliedToken = request.headers["x-codexrig-session-control"];
      if (
        request.method !== "POST" ||
        mode === null ||
        request.socket.remoteAddress !== "127.0.0.1" ||
        typeof suppliedToken !== "string" ||
        !timingSafeToken(controlToken, suppliedToken)
      ) {
        request.resume();
        writeControllerResponse(response, 403, null);
        return;
      }
      let hookInput;
      try {
        hookInput = await boundedRequestBody(request);
        if (mode === "session-start") {
          const attestation = verifyStartupAttestation({
            controlPolicy: launch.controlPolicy,
            expectedAttestation: launch.attestation,
            hookInput,
            nonce: launch.nonce,
            root,
            runtimeExecutables: launch.runtimeExecutables,
          });
          launch.sessionStartFailure = null;
          writeControllerResponse(response, 200, sessionStartSuccess(attestation, { root }));
          return;
        }
        if (runtimeSessionLaunchState(root, process.pid) !== "active") {
          throw new Error("Stop lifecycle requires an active verified Codex session.");
        }
        const session = inspectRuntimeSessionLease({ root });
        if (session.status !== "active") {
          throw new Error("Stop lifecycle requires an active verified Codex session lease.");
        }
        const output = await runStopLifecycle({
          expectedSessionId: session.lease.codexSessionId,
          hookInput,
          root,
        });
        writeControllerResponse(response, 200, Object.keys(output).length === 0 ? null : output);
      } catch (error) {
        if (mode === "session-start") launch.sessionStartFailure = error;
        writeControllerResponse(
          response,
          200,
          mode === "session-start" ? sessionStartFailure(error, root) : stopFailure(error, root),
        );
      }
    };
    // A client that disconnects while its response is being written must not poison the serialized
    // lifecycle queue and prevent the real SessionStart or Stop hook from reaching the controller.
    lifecycleQueue = lifecycleQueue.then(handleRequest, handleRequest).catch(() => {
      if (!response.destroyed) response.destroy();
    });
  });
  server.maxConnections = 8;
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  return server;
}

function baseCodexEnvironment(root, hookShell) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (inheritedExecutionControlKeys.has(key.toUpperCase())) delete environment[key];
  }
  Object.assign(environment, {
    CODEX_HOME: root,
    CODEXRIG_PROJECT_ROOT: root,
    NPM_CONFIG_IGNORE_PNPMFILE: "true",
    PNPM_CONFIG_IGNORE_PNPMFILE: "true",
    npm_config_ignore_pnpmfile: "true",
    pnpm_config_ignore_pnpmfile: "true",
  });
  if (hookShell.name === "cmd") environment.COMSPEC = hookShell.path;
  else environment.SHELL = hookShell.path;
  return environment;
}

function codexEnvironment({ baseEnvironment, controlToken, nodeExecutable, port }) {
  return {
    ...baseEnvironment,
    CODEXRIG_SESSION_CONTROL_NODE: nodeExecutable,
    CODEXRIG_SESSION_CONTROL_PORT: String(port),
    CODEXRIG_SESSION_CONTROL_TOKEN: controlToken,
  };
}

function validateSessionControlHookListing(message, root, hookShellName) {
  if (message?.error) {
    throw new Error("Codex rejected the session-control hook preflight request.");
  }
  const data = message?.result?.data;
  if (!Array.isArray(data) || data.length !== 1 || path.resolve(data[0]?.cwd ?? "") !== root) {
    throw new Error("Codex returned an invalid session-control hook inventory.");
  }
  const inventory = data[0];
  if (
    !Array.isArray(inventory.errors) ||
    inventory.errors.length > 0 ||
    !Array.isArray(inventory.warnings) ||
    inventory.warnings.length > 0 ||
    !Array.isArray(inventory.hooks) ||
    inventory.hooks.length !== sessionControlHookExpectations(hookShellName).length
  ) {
    throw new Error(
      "Codex did not load exactly the warning-free canonical session-control hook inventory.",
    );
  }
  for (const expected of sessionControlHookExpectations(hookShellName)) {
    const matches = inventory.hooks.filter((hook) => hook?.key === expected.key);
    if (matches.length !== 1) {
      throw new Error("Codex did not load exactly one expected session-control hook.");
    }
    const hook = matches[0];
    const valid =
      hook.additionalContextLimit === expected.additionalContextLimit &&
      hook.command === expected.command &&
      hook.currentHash === expected.currentHash &&
      hook.enabled === true &&
      hook.eventName === expected.eventName &&
      hook.handlerType === "command" &&
      hook.isManaged === false &&
      hook.matcher === expected.matcher &&
      hook.source === "sessionFlags" &&
      hook.sourcePath === expected.sourcePath &&
      hook.statusMessage === expected.statusMessage &&
      hook.timeoutSec === expected.timeoutSec &&
      hook.trustStatus === "trusted";
    if (!valid) {
      throw new Error(
        "Codex did not attest the exact trusted session-control hook contract; startup is blocked.",
      );
    }
  }
}

async function verifyTrustedSessionControlHooks({ codexExecutable, environment, hookShell, root }) {
  const child = spawn(
    codexExecutable,
    ["--cd", root, ...sessionControlHookConfigArguments(hookShell.name), "app-server", "--stdio"],
    { cwd: root, env: environment, stdio: ["pipe", "pipe", "pipe"] },
  );
  await new Promise((resolve, reject) => {
    let error = null;
    let initialized = false;
    let outcome = "pending";
    let stderrBytes = 0;
    let stdoutBuffer = "";
    let stdoutBytes = 0;
    let killTimer;
    const timeout = setTimeout(() => {
      finish(new Error("Codex session-control hook preflight timed out."));
    }, hookPreflightTimeoutMilliseconds);

    const settle = () => {
      clearTimeout(timeout);
      if (killTimer !== undefined) clearTimeout(killTimer);
      if (outcome === "success") resolve();
      else reject(error ?? new Error("Codex session-control hook preflight exited early."));
    };
    const finish = (failure = null) => {
      if (outcome !== "pending") return;
      outcome = failure === null ? "success" : "failure";
      error = failure;
      child.stdin.end();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      } else {
        settle();
      }
    };
    const send = (message) => {
      if (outcome === "pending") child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    child.once("error", (childError) => finish(childError));
    child.once("close", () => {
      if (outcome === "pending") {
        outcome = "failure";
        error = new Error("Codex session-control hook preflight exited without an inventory.");
      }
      settle();
    });
    child.stdin.on("error", (streamError) => {
      if (outcome === "pending") finish(streamError);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > hookPreflightMaximumBytes) {
        finish(new Error("Codex session-control hook preflight exceeded its stderr bound."));
      }
    });
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > hookPreflightMaximumBytes) {
        finish(new Error("Codex session-control hook preflight exceeded its stdout bound."));
        return;
      }
      stdoutBuffer += chunk.toString("utf8");
      for (;;) {
        const newline = stdoutBuffer.indexOf("\n");
        if (newline === -1) break;
        const line = stdoutBuffer.slice(0, newline);
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (line.trim() === "") continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          finish(new Error("Codex session-control hook preflight returned invalid JSON."));
          return;
        }
        if (message.id === 1) {
          if (message.error || initialized) {
            finish(new Error("Codex rejected the session-control hook preflight initialization."));
            return;
          }
          initialized = true;
          send({ method: "initialized", params: {} });
          send({ id: 2, method: "hooks/list", params: { cwds: [root] } });
        } else if (message.id === 2) {
          try {
            validateSessionControlHookListing(message, root, hookShell.name);
            finish();
          } catch (validationError) {
            finish(validationError);
          }
          return;
        }
      }
    });
    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "codexrig_startup",
          title: "CodexRig Startup",
          version: "1.0.0",
        },
      },
    });
  });
}

/** Runs the entire post-bootstrap session from already-loaded code. */
export async function runStartupSessionController({
  argv = process.argv,
  root = frameworkRoot,
} = {}) {
  const options = parseSessionControllerArguments(argv, root);
  const runtimeBinding = resolveStartupRuntimeExecutables({
    root,
    codexExecutable: options.codexExecutable,
    searchPath: process.env.PATH,
  });
  process.env.PATH = runtimeBinding.searchPath;
  const runtimeExecutables = runtimeBinding.executables;
  const baseEnvironment = baseCodexEnvironment(root, runtimeBinding.hookShell);
  const expectedBasis = startupAttestationBasis({
    root,
    controlPolicy: options.controlPolicy,
    runtimeExecutables,
  });
  const reservation = reserveStartupAttestation(root, process.pid, {
    controlPolicy: options.controlPolicy,
    expectedBasis,
    runtimeExecutables,
  });
  let server = null;
  let releaseLease = true;
  try {
    validateRuntimeCodexConfig(root);
    await verifyTrustedSessionControlHooks({
      codexExecutable: options.codexExecutable,
      environment: baseEnvironment,
      hookShell: runtimeBinding.hookShell,
      root,
    });
    const launch = {
      attestation: reservation.attestation,
      controlPolicy: options.controlPolicy,
      hookShell: runtimeBinding.hookShell,
      model: expectedBasis.model,
      nonce: reservation.nonce,
      reasoningEffort: expectedBasis.reasoningEffort,
      runtimeExecutables,
      sessionStartFailure: null,
    };
    const controlToken = randomBytes(32).toString("base64url");
    server = createLifecycleServer({ controlToken, launch, root });
    const port = await listen(server);
    const firstArguments = codexArgumentsFor({
      ...options,
      hookShellName: launch.hookShell.name,
      model: launch.model,
      reasoningEffort: launch.reasoningEffort,
      root,
    });
    const first = await runStartupCodexProcess({
      args: firstArguments,
      codexExecutable: options.codexExecutable,
      environment: codexEnvironment({
        baseEnvironment,
        controlToken,
        nodeExecutable: runtimeExecutables.node,
        port,
      }),
      launch,
      root,
    });
    if (!first.safeToRelease) releaseLease = false;
    if (launch.sessionStartFailure !== null) throw launch.sessionStartFailure;
    // A picker exit before SessionStart is cancellation, not a completed Codex session.
    // Its exact terminal proof permits release, but creates no activation or recovery record.
    return first.status;
  } catch (error) {
    if (error?.safeToReleaseRuntimeLease === false) releaseLease = false;
    throw error;
  } finally {
    if (server) await closeServer(server);
    if (releaseLease) releaseRuntimeSessionLease({ root, pid: process.pid });
  }
}

/** Formats a bounded operator action without adding an alternate runtime-state reader. */
export function startupControllerFailureMessage(error, root = frameworkRoot) {
  const failure = `Codex session controller failed: ${formatContextError(error, root)}`;
  if (error?.code !== invalidRuntimeSessionLeaseErrorCode) return failure;
  return (
    `${failure}\n` +
    "The private writer lease is not on the current runtime contract. Exit every Codex session " +
    "using this framework, then preview and apply the bounded framework reset:\n" +
    "  mise exec --locked -- pnpm framework:reset\n" +
    "  mise exec --locked -- pnpm framework:reset --apply\n" +
    "  mise exec --locked -- pnpm framework:reset\n" +
    "Do not delete .codex/runtime manually; the full reset discards incompatible disposable " +
    "runtime state only after repository-wide runtime quiescence is proven. Then retry " +
    "bash scripts/setup/start-codex.sh."
  );
}

if (path.resolve(process.argv[1] ?? "") === modulePath) {
  try {
    process.exitCode = await runStartupSessionController();
  } catch (error) {
    console.error(startupControllerFailureMessage(error));
    process.exitCode = 1;
  }
}
