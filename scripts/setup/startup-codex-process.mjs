/** Owns the preloaded gated Codex process supervisor and exact child-PID handoff. */
import { spawn } from "node:child_process";
import os from "node:os";
import process from "node:process";
import { inactiveRuntimeSessionWriterErrorCode } from "../repository/runtime-session-lease.mjs";
import {
  beginStartupSessionWriterHandoff,
  bindStartupSessionCodexProcess,
  bindStartupSessionWriter,
  completeStartupSessionWriterHandoff,
} from "./startup-attestation.mjs";
import {
  canonicalExternalExecutable,
  validateStartupRuntimeExecutables,
} from "./startup-runtime-executables.mjs";
import { validateRuntimeCodexConfig } from "./validate-codex-config.mjs";

const protocolMaximumBytes = 128;
const protocolTimeoutMilliseconds = 10_000;
const supervisorProofTokenPattern = /^[A-Za-z0-9_-]{40,128}$/u;

// This source is loaded by the issue-time controller before Codex. The supervisor cannot spawn its
// child until the durable lease enters the handoff phase. A separate parent-liveness pipe makes a
// controller crash terminate the child; an independently killed supervisor remains safe because
// the controller records the exact Codex PID immediately after spawn.
const codexProcessSupervisorSource = [
  'const {spawn}=require("node:child_process");',
  'const fs=require("node:fs");',
  'const net=require("node:net");',
  'const os=require("node:os");',
  "const executable=process.argv[1];const args=process.argv.slice(2);",
  'fs.writeSync(3,"ready\\n");',
  'const token=fs.readFileSync(4,"utf8").trim();fs.closeSync(4);if(!/^[A-Za-z0-9_-]{40,128}$/.test(token))process.exit(126);',
  'const child=spawn(executable,args,{env:process.env,stdio:"inherit"});',
  "const complete=status=>{try{fs.writeSync(6,`done:${token}:${status}\\n`);fs.closeSync(6);}catch{}process.exit(0);};",
  "let announced=false;let childStatus=null;const finish=status=>{childStatus=status;if(announced)complete(status);};",
  "const fail=status=>{if(announced){finish(status);return;}announced=true;try{fs.writeSync(3,`failed:${status}\\n`);fs.closeSync(3);}catch{}complete(status);};",
  'child.once("error",()=>fail(127));',
  'child.once("exit",(code,signal)=>finish(signal?128+(os.constants.signals[signal]??0):code??1));',
  "if(Number.isSafeInteger(child.pid)&&child.pid>0){fs.writeSync(3,`codex:${child.pid}\\n`);fs.closeSync(3);announced=true;if(childStatus!==null)complete(childStatus);}",
  "let stopping=false;const stop=()=>{if(stopping)return;stopping=true;try{child.kill('SIGTERM');}catch{}setTimeout(()=>{try{child.kill('SIGKILL');}catch{}},2000).unref();};",
  'const parent=new net.Socket({fd:5,readable:true,writable:false});parent.once("end",stop);parent.once("error",stop);parent.resume();',
  'for(const signal of ["SIGINT","SIGTERM","SIGHUP"]){process.on(signal,stop);}',
].join("");

function signalStatus(code, signal) {
  if (signal) return 128 + (os.constants.signals[signal] ?? 0);
  return code ?? 1;
}

/** Accepts only a terminal child-exit proof bound to the issue-time secret gate token. */
export function validatedSupervisorTerminalStatus(line, expectedToken) {
  const match = /^done:([A-Za-z0-9_-]{40,128}):(0|[1-9]\d{0,9})$/u.exec(line ?? "");
  const status = Number(match?.[2]);
  if (
    !supervisorProofTokenPattern.test(expectedToken ?? "") ||
    match?.[1] !== expectedToken ||
    !Number.isSafeInteger(status) ||
    status < 0 ||
    status > 2_147_483_647
  ) {
    throw new Error("Codex process supervisor returned an invalid terminal child proof.");
  }
  return status;
}

function protocolLine(stream, label, { timeoutMilliseconds = protocolTimeoutMilliseconds } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let value = "";
    const timeout =
      timeoutMilliseconds === null
        ? null
        : setTimeout(
            () => finish(new Error(`Codex process supervisor ${label} timed out.`)),
            timeoutMilliseconds,
          );
    const cleanup = () => {
      if (timeout !== null) clearTimeout(timeout);
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", finish);
    };
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(result);
    };
    const onData = (chunk) => {
      value += chunk.toString("utf8");
      if (value.length > protocolMaximumBytes) {
        finish(new Error(`Codex process supervisor ${label} exceeded its protocol bound.`));
        return;
      }
      const newline = value.indexOf("\n");
      if (newline !== -1) finish(null, value.slice(0, newline));
    };
    const onEnd = () => finish(new Error(`Codex process supervisor ${label} ended early.`));
    stream.on("data", onData);
    stream.once("end", onEnd);
    stream.once("error", finish);
  });
}

async function stopBeforeGate(wrapper, completion) {
  wrapper.stdio[4].destroy();
  wrapper.stdio[5].destroy();
  wrapper.kill("SIGTERM");
  await completion;
}

async function supervisorOutcome(completion, terminalProof) {
  const [outcome, terminalStatus] = await Promise.all([completion, terminalProof]);
  return Object.freeze({
    ...outcome,
    safeToRelease: terminalStatus !== null,
    status: terminalStatus ?? outcome.status,
  });
}

/** Stops and reaps a post-gate child before waiting for its terminal proof. */
export async function stopStartupCodexAfterGate(wrapper, completion, terminalProof) {
  // Closing the private liveness pipe asks the already-loaded supervisor to terminate and reap its
  // exact child. If the supervisor itself was killed, the persisted child PID or handoff blocker
  // remains authoritative instead of being guessed away here.
  wrapper.stdio[5].end();
  return supervisorOutcome(completion, terminalProof);
}

function processFailure(error, safeToRelease) {
  if (error && typeof error === "object") error.safeToReleaseRuntimeLease = safeToRelease;
  return error;
}

/** Runs one Codex foreground process and reports whether its lease can be safely released. */
export async function runStartupCodexProcess({ args, codexExecutable, environment, launch, root }) {
  validateRuntimeCodexConfig(root);
  const runtimeExecutables = validateStartupRuntimeExecutables(root, launch.runtimeExecutables);
  const controllerNode = canonicalExternalExecutable(root, process.execPath, "Controller Node");
  if (runtimeExecutables.node !== controllerNode || runtimeExecutables.codex !== codexExecutable) {
    throw new Error("Codex process launch differs from its issue-time executable binding.");
  }
  const supervisorToken = launch.nonce;
  if (!supervisorProofTokenPattern.test(supervisorToken ?? "")) {
    throw new Error("Codex process supervisor requires the issue-time launch secret.");
  }
  const wrapper = spawn(
    runtimeExecutables.node,
    ["--input-type=commonjs", "--eval", codexProcessSupervisorSource, codexExecutable, ...args],
    {
      env: environment,
      stdio: ["inherit", "inherit", "inherit", "pipe", "pipe", "pipe", "pipe"],
    },
  );
  wrapper.stdio[4].on("error", () => {});
  wrapper.stdio[5].on("error", () => {});
  const terminalProof = protocolLine(wrapper.stdio[6], "terminal child proof", {
    timeoutMilliseconds: null,
  })
    .then((line) => validatedSupervisorTerminalStatus(line, supervisorToken))
    .catch(() => null);
  let spawnError = null;
  const completion = new Promise((resolve) => {
    wrapper.once("error", (error) => {
      spawnError = error;
      resolve({ code: null, signal: null, status: 127 });
    });
    wrapper.once("close", (code, signal) => {
      resolve({
        code,
        signal,
        status: signalStatus(code, signal),
      });
    });
  });
  let gateOpened = false;
  try {
    const ready = await protocolLine(wrapper.stdio[3], "readiness");
    if (ready !== "ready" || !Number.isSafeInteger(wrapper.pid) || wrapper.pid < 1) {
      throw new Error("Codex process supervisor did not reach its issue-time gate.");
    }
    bindStartupSessionWriter(root, process.pid, wrapper.pid, {
      controlPolicy: launch.controlPolicy,
      expectedAttestation: launch.attestation,
      nonce: launch.nonce,
      runtimeExecutables: launch.runtimeExecutables,
    });
    beginStartupSessionWriterHandoff(root, process.pid, {
      controlPolicy: launch.controlPolicy,
      expectedAttestation: launch.attestation,
      nonce: launch.nonce,
      runtimeExecutables: launch.runtimeExecutables,
    });
    gateOpened = true;
    const childLine = protocolLine(wrapper.stdio[3], "child identity");
    wrapper.stdio[4].end(`${supervisorToken}\n`);
    const childIdentity = await childLine;
    const failed = /^failed:([1-9]\d{0,9})$/u.exec(childIdentity);
    if (failed) {
      wrapper.stdio[5].end();
      const outcome = await supervisorOutcome(completion, terminalProof);
      const reportedStatus = Number(failed[1]);
      if (!outcome.safeToRelease || outcome.status !== reportedStatus) {
        throw processFailure(
          new Error("Codex process supervisor did not prove its failed child spawn."),
          false,
        );
      }
      completeStartupSessionWriterHandoff(root, process.pid, {
        controlPolicy: launch.controlPolicy,
        expectedAttestation: launch.attestation,
        nonce: launch.nonce,
        runtimeExecutables: launch.runtimeExecutables,
      });
      return Object.freeze({ handoffBound: false, safeToRelease: true, status: outcome.status });
    }
    const match = /^codex:([1-9]\d*)$/u.exec(childIdentity);
    const codexPid = Number(match?.[1]);
    if (!Number.isSafeInteger(codexPid)) {
      throw new Error("Codex process supervisor returned an invalid child identity.");
    }
    try {
      bindStartupSessionCodexProcess(root, process.pid, codexPid, {
        controlPolicy: launch.controlPolicy,
        expectedAttestation: launch.attestation,
        nonce: launch.nonce,
        runtimeExecutables: launch.runtimeExecutables,
      });
    } catch (error) {
      if (error?.code !== inactiveRuntimeSessionWriterErrorCode) throw error;
      const outcome = await stopStartupCodexAfterGate(wrapper, completion, terminalProof);
      if (!outcome.safeToRelease) throw processFailure(error, false);
      completeStartupSessionWriterHandoff(root, process.pid, {
        controlPolicy: launch.controlPolicy,
        expectedAttestation: launch.attestation,
        nonce: launch.nonce,
        runtimeExecutables: launch.runtimeExecutables,
      });
      return Object.freeze({ handoffBound: false, safeToRelease: true, status: outcome.status });
    }
    const outcome = await supervisorOutcome(completion, terminalProof);
    wrapper.stdio[5].end();
    if (outcome.safeToRelease) {
      completeStartupSessionWriterHandoff(root, process.pid, {
        controlPolicy: launch.controlPolicy,
        expectedAttestation: launch.attestation,
        nonce: launch.nonce,
        runtimeExecutables: launch.runtimeExecutables,
      });
    }
    return Object.freeze({
      handoffBound: true,
      safeToRelease: outcome.safeToRelease,
      status: outcome.status,
    });
  } catch (error) {
    if (!gateOpened) {
      await stopBeforeGate(wrapper, completion);
      throw processFailure(spawnError ?? error, true);
    }
    const outcome = await stopStartupCodexAfterGate(wrapper, completion, terminalProof);
    const safeToRelease = outcome.safeToRelease && spawnError === null;
    if (safeToRelease) {
      try {
        completeStartupSessionWriterHandoff(root, process.pid, {
          controlPolicy: launch.controlPolicy,
          expectedAttestation: launch.attestation,
          nonce: launch.nonce,
          runtimeExecutables: launch.runtimeExecutables,
        });
      } catch (completionError) {
        throw processFailure(completionError, false);
      }
    }
    throw processFailure(spawnError ?? error, safeToRelease);
  }
}
