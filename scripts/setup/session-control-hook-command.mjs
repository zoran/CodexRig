/** Owns the repository-independent lifecycle hooks injected by the issue-time controller. */
import { createHash } from "node:crypto";

export const sessionControlHookInputMaximumBytes = 262_144;
export const sessionControlHookResponseMaximumBytes = 1_048_576;
export const sessionControlHookModes = Object.freeze({
  sessionStart: "session-start",
  stop: "stop",
});

const sessionControlHookSourcePath =
  process.platform === "win32"
    ? String.raw`C:\<session-flags>\config.toml`
    : "/<session-flags>/config.toml";
const defaultHookShellName = process.platform === "win32" ? "powershell" : "sh";
const supportedHookShellNames = new Set(["bash", "cmd", "powershell", "sh", "zsh"]);

// Codex retains this exact command in its in-memory hook registry. The command deliberately uses
// only Node built-ins and inherited issue-time endpoint values: it never resolves or executes a
// repository path after the session has begun.
export const sessionControlHookClientSource = [
  'const http=require("node:http");',
  "const mode=process.argv[1];",
  `const inputMaximum=${sessionControlHookInputMaximumBytes};`,
  `const responseMaximum=${sessionControlHookResponseMaximumBytes};`,
  "let finished=false;",
  'const fail=()=>{if(finished)return;finished=true;const reason=mode==="stop"?"CodexRig Stop lifecycle could not reach its issue-time controller. Stop completely and restart with bash scripts/setup/start-codex.sh.":"CodexRig startup verification could not reach its issue-time controller. Start with bash scripts/setup/start-codex.sh.";const output=mode==="stop"?{systemMessage:reason}:{continue:false,stopReason:reason,systemMessage:reason};process.stdout.write(JSON.stringify(output)+"\\n");};',
  'if(mode!=="session-start"&&mode!=="stop")fail();',
  "const chunks=[];let size=0;",
  'process.stdin.on("data",chunk=>{size+=chunk.length;if(size>inputMaximum){fail();process.stdin.destroy();return;}chunks.push(chunk);});',
  'process.stdin.on("error",fail);',
  'process.stdin.on("end",()=>{if(finished)return;const port=process.env.CODEXRIG_SESSION_CONTROL_PORT??"";const token=process.env.CODEXRIG_SESSION_CONTROL_TOKEN??"";if(!/^[1-9][0-9]{0,4}$/.test(port)||Number(port)>65535||!/^[A-Za-z0-9_-]{40,128}$/.test(token)){fail();return;}const body=Buffer.concat(chunks);const request=http.request({agent:false,host:"127.0.0.1",method:"POST",path:"/"+mode,port:Number(port),headers:{"content-length":String(body.length),"content-type":"application/json","x-codexrig-session-control":token}},response=>{const output=[];let outputSize=0;response.on("data",chunk=>{outputSize+=chunk.length;if(outputSize>responseMaximum){fail();response.destroy();return;}output.push(chunk);});response.on("error",fail);response.on("end",()=>{if(finished)return;const content=Buffer.concat(output).toString("utf8");if(response.statusCode!==200||(mode==="session-start"&&content.length===0)){fail();return;}if(content.length>0){try{const parsed=JSON.parse(content);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("invalid");}catch{fail();return;}}finished=true;if(content.length>0)process.stdout.write(content.endsWith("\\n")?content:content+"\\n");});});request.setTimeout(25000,()=>request.destroy());request.on("error",fail);request.end(body);});',
].join("");

if (sessionControlHookClientSource.includes("'")) {
  throw new Error("Session control hook client must remain safe for one single-quoted shell word.");
}

export function sessionControlHookCommand(mode, shellName = defaultHookShellName) {
  if (!Object.values(sessionControlHookModes).includes(mode)) {
    throw new Error("Unsupported session control hook mode.");
  }
  if (!supportedHookShellNames.has(shellName)) {
    throw new Error("Unsupported session control hook shell.");
  }
  if (shellName === "powershell") {
    const encoded = Buffer.from(sessionControlHookClientSource, "utf8").toString("base64url");
    return `& "$env:CODEXRIG_SESSION_CONTROL_NODE" --input-type=commonjs --eval 'eval(Buffer.from("${encoded}","base64url").toString())' ${mode}`;
  }
  if (shellName === "cmd") {
    const encoded = Buffer.from(sessionControlHookClientSource, "utf8").toString("base64url");
    return `"%CODEXRIG_SESSION_CONTROL_NODE%" --input-type=commonjs --eval "eval(Buffer.from('${encoded}','base64url').toString())" ${mode}`;
  }
  return `"$CODEXRIG_SESSION_CONTROL_NODE" --input-type=commonjs --eval '${sessionControlHookClientSource}' ${mode}`;
}

export const sessionControlHookPolicies = Object.freeze({
  sessionStart: Object.freeze({
    additionalContextLimit: 768,
    eventKey: "session_start",
    eventName: "SessionStart",
    listedEventName: "sessionStart",
    matcher: "^(startup|resume)$",
    mode: sessionControlHookModes.sessionStart,
    statusMessage: "Verifying CodexRig startup",
    timeout: 30,
  }),
  stop: Object.freeze({
    eventKey: "stop",
    eventName: "Stop",
    listedEventName: "stop",
    mode: sessionControlHookModes.stop,
    statusMessage: "Finalizing CodexRig Stop lifecycle",
    timeout: 30,
  }),
});

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson(value[key])]),
  );
}

// Codex 0.147 normalizes each command hook to TOML, converts that value to canonical-key JSON,
// and SHA-256 hashes the serialized bytes. The startup preflight below fails closed if the installed
// compatible Codex line ever changes that contract, so a stale local reproduction cannot run.
function trustedHookHash(policy, command) {
  const handler = {
    async: false,
    command,
    statusMessage: policy.statusMessage,
    timeout: policy.timeout,
    type: "command",
  };
  if (policy.additionalContextLimit !== undefined) {
    handler.additionalContextLimit = policy.additionalContextLimit;
  }
  const identity = {
    event_name: policy.eventKey,
    hooks: [handler],
  };
  if (policy.matcher !== undefined) identity.matcher = policy.matcher;
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalJson(identity)))
    .digest("hex")}`;
}

function tomlString(value) {
  return JSON.stringify(value);
}

function hookToml(policy, command) {
  const handler = [
    'type="command"',
    `command=${tomlString(command)}`,
    `timeout=${policy.timeout}`,
    "async=false",
    `statusMessage=${tomlString(policy.statusMessage)}`,
  ];
  if (policy.additionalContextLimit !== undefined) {
    handler.push(`additionalContextLimit=${policy.additionalContextLimit}`);
  }
  const group = [
    ...(policy.matcher === undefined ? [] : [`matcher=${tomlString(policy.matcher)}`]),
    `hooks=[{${handler.join(",")}}]`,
  ];
  return `[{${group.join(",")}}]`;
}

function hookExpectation(policy, shellName) {
  const command = sessionControlHookCommand(policy.mode, shellName);
  return Object.freeze({
    additionalContextLimit: policy.additionalContextLimit ?? null,
    command,
    currentHash: trustedHookHash(policy, command),
    eventName: policy.listedEventName,
    key: `${sessionControlHookSourcePath}:${policy.eventKey}:0:0`,
    matcher: policy.matcher ?? null,
    sourcePath: sessionControlHookSourcePath,
    statusMessage: policy.statusMessage,
    timeoutSec: policy.timeout,
  });
}

/** Returns the exact two trusted session-flag hook declarations expected from Codex hooks/list. */
export function sessionControlHookExpectations(shellName = defaultHookShellName) {
  return Object.freeze([
    hookExpectation(sessionControlHookPolicies.sessionStart, shellName),
    hookExpectation(sessionControlHookPolicies.stop, shellName),
  ]);
}

/** Builds the closed CLI override that makes the preloaded controller the only lifecycle owner. */
export function sessionControlHookConfigArguments(shellName = defaultHookShellName) {
  const hookExpectations = sessionControlHookExpectations(shellName);
  const state = `{${hookExpectations
    .map(
      (hook) =>
        `${tomlString(hook.key)}={enabled=true,trusted_hash=${tomlString(hook.currentHash)}}`,
    )
    .join(",")}}`;
  return [
    "-c",
    `hooks.${sessionControlHookPolicies.sessionStart.eventName}=${hookToml(
      sessionControlHookPolicies.sessionStart,
      hookExpectations[0].command,
    )}`,
    "-c",
    `hooks.${sessionControlHookPolicies.stop.eventName}=${hookToml(
      sessionControlHookPolicies.stop,
      hookExpectations[1].command,
    )}`,
    "-c",
    `hooks.state=${state}`,
  ];
}
