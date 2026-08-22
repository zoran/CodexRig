/** Verifies the preloaded startup/session controller and repository-independent hook boundary. */
import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { cleanupTemporaryRoots, root, run, temporaryRoot } from "./setup-regression-fixtures.mjs";
import { startupAttestedInputPaths, startupControlPolicies } from "./startup-attestation.mjs";
import {
  inspectRuntimeSessionLease,
  inspectRuntimeSessionRecovery,
} from "../repository/runtime-session-lease.mjs";
import { invalidRuntimeSessionLeaseErrorCode } from "../repository/runtime-session-lease.mjs";
import {
  sessionControlHookConfigArguments,
  sessionControlHookExpectations,
} from "./session-control-hook-command.mjs";
import {
  resolveStartupHookShell,
  resolveStartupRuntimeExecutables,
} from "./startup-runtime-executables.mjs";
import {
  stopStartupCodexAfterGate,
  validatedSupervisorTerminalStatus,
} from "./startup-codex-process.mjs";
import { startupControllerFailureMessage } from "./startup-session-controller.mjs";

after(cleanupTemporaryRoots);

const projectIntelligenceArguments = Object.freeze([
  "-c",
  'model="gpt-5.6-sol"',
  "-c",
  'model_reasoning_effort="ultra"',
]);

test("non-current private state points only to the bounded post-exit reset", () => {
  const error = new Error("Codex runtime session lease is invalid or uses an unsupported schema.");
  error.code = invalidRuntimeSessionLeaseErrorCode;
  const message = startupControllerFailureMessage(error, root);
  assert.match(message, /mise exec --locked -- pnpm framework:reset -- --apply/u);
  assert.match(message, /Do not delete \.codex\/runtime manually/u);
});

test("supervisor completion proof is bound to its issue-time gate secret", () => {
  const token = "A".repeat(43);
  assert.equal(validatedSupervisorTerminalStatus(`done:${token}:143`, token), 143);
  assert.throws(
    () => validatedSupervisorTerminalStatus(`done:${"B".repeat(43)}:0`, token),
    /invalid terminal child proof/u,
  );
  assert.throws(
    () => validatedSupervisorTerminalStatus("done:0", token),
    /invalid terminal child proof/u,
  );
});

test("post-gate failure stops the child before awaiting its terminal proof", async () => {
  let resolveCompletion;
  let resolveTerminalProof;
  const completion = new Promise((resolve) => {
    resolveCompletion = resolve;
  });
  const terminalProof = new Promise((resolve) => {
    resolveTerminalProof = resolve;
  });
  const wrapper = { stdio: Array.from({ length: 6 }) };
  wrapper.stdio[5] = {
    end() {
      resolveCompletion({ code: 143, signal: null, status: 143 });
      resolveTerminalProof(143);
    },
  };

  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("post-gate child stop did not precede proof wait")),
      250,
    );
  });
  let outcome;
  try {
    outcome = await Promise.race([
      stopStartupCodexAfterGate(wrapper, completion, terminalProof),
      timeout,
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
  assert.deepEqual(outcome, {
    code: 143,
    safeToRelease: true,
    signal: null,
    status: 143,
  });
});

test("startup executable binding rejects a project-local Node interpreter", () => {
  const project = temporaryRoot("session-controller-local-node-");
  const localNode = path.join(project, "node");
  writeFileSync(localNode, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(localNode, 0o755);
  assert.throws(
    () =>
      resolveStartupRuntimeExecutables({
        root: project,
        codexExecutable: process.execPath,
        nodeExecutable: localNode,
        searchPath: process.env.PATH ?? "",
      }),
    /Canonical Node executable path must remain outside the writable project root/u,
  );
});

function controllerFixture() {
  const project = temporaryRoot("session-controller-project-");
  for (const relativePath of startupAttestedInputPaths(root)) {
    const source = path.join(root, ...relativePath.split("/"));
    const target = path.join(project, ...relativePath.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }

  const externalBin = temporaryRoot("session-controller-external-bin-");
  const capturePath = path.join(project, "codex-calls.jsonl");
  const localPathMarker = path.join(project, "project-path-executed");
  const markerPath = path.join(project, "post-session-code-executed");
  const codexExecutable = path.join(externalBin, "codex");
  const hookConfigArguments = sessionControlHookConfigArguments();
  const hookExpectations = sessionControlHookExpectations();
  writeFileSync(
    codexExecutable,
    [
      "#!/usr/bin/env node",
      'const {spawnSync}=require("node:child_process");',
      'const {appendFileSync,closeSync,existsSync,mkdirSync,readFileSync,writeFileSync}=require("node:fs");',
      'const path=require("node:path");',
      "const args=process.argv.slice(2);",
      'if(args.length===1&&args[0]==="--version"){if(process.env.FAKE_CODEX_BEHAVIOR==="preflight-spawn-error"){const counter=process.argv[1]+".version-count";const count=(existsSync(counter)?Number(readFileSync(counter,"utf8")):0)+1;writeFileSync(counter,String(count));if(count===2)writeFileSync(process.argv[1],"#!/codexrig-missing-interpreter\\n");}process.stdout.write("codex-cli 0.147.0\\n");process.exit(0);}',
      `const expectedHookArgs=${JSON.stringify(hookConfigArguments)};`,
      `const expectedHooks=${JSON.stringify(hookExpectations)};`,
      "const hookStart=args.indexOf(expectedHookArgs[1])-1;",
      "if(hookStart===-1||JSON.stringify(args.slice(hookStart,hookStart+expectedHookArgs.length))!==JSON.stringify(expectedHookArgs))process.exit(88);",
      "const root=process.cwd();",
      'const behavior=process.env.FAKE_CODEX_BEHAVIOR??"";',
      'if(args.includes("app-server")){',
      "  if(process.env.CODEXRIG_SESSION_CONTROL_TOKEN!==undefined||process.env.CODEXRIG_STARTUP_NONCE!==undefined)process.exit(87);",
      '  if(behavior==="preflight-mutate")writeFileSync(path.join(root,"scripts/setup/startup-attestation.mjs"),"export const changedDuringPreflight=true;\\n");',
      '  if(behavior==="preflight-runtime-config-mutate"){const runtime=path.join(root,".codex/runtime");mkdirSync(runtime,{recursive:true,mode:0o700});writeFileSync(path.join(runtime,"config.toml"),"notify=[\\"sh\\",\\"-c\\",\\"run-project-code\\"]\\n",{encoding:"utf8",mode:0o600});}',
      '  let input="";',
      '  process.stdin.setEncoding("utf8");',
      '  process.stdin.on("data",chunk=>{input+=chunk;for(;;){const newline=input.indexOf("\\n");if(newline===-1)break;const line=input.slice(0,newline);input=input.slice(newline+1);if(!line.trim())continue;const message=JSON.parse(line);if(message.method==="initialize"){if(message.params?.capabilities?.experimentalApi)process.exit(94);process.stdout.write(JSON.stringify({id:message.id,result:{}})+"\\n");}if(message.method==="hooks/list"){const hooks=behavior==="preflight-missing"?[]:expectedHooks.map(hook=>({...hook,enabled:true,handlerType:"command",isManaged:false,source:"sessionFlags",trustStatus:behavior==="preflight-untrusted"?"modified":"trusted"}));if(behavior==="preflight-extra")hooks.push({...hooks[0],key:"/mutable/project-hook:session_start:0:0",source:"project"});const warnings=behavior==="preflight-warning"?["mutable hook skipped"]:[];process.stdout.write(JSON.stringify({id:message.id,result:{data:[{cwd:message.params.cwds[0],hooks,warnings,errors:[]}]}})+"\\n");}}});',
      "} else {",
      'if(process.env.CODEXRIG_SESSION_CONTROL_TOKEN==="stale-session-token"||!/^[A-Za-z0-9_-]{40,128}$/.test(process.env.CODEXRIG_SESSION_CONTROL_TOKEN??""))process.exit(86);',
      'const resumeIndex=args.indexOf("resume");',
      "const resume=resumeIndex!==-1;",
      'const sessionId=resume?args[resumeIndex+1]:"01a09999-5678-7abc-8def-0123456789ab";',
      'for(const key of ["CODEXRIG_STARTUP_CONTROL_POLICY","CODEXRIG_STARTUP_NONCE","CODEXRIG_STARTUP_RESUME_SESSION_ID","CODEXRIG_STARTUP_SESSION_SOURCE"]){if(process.env[key]!==undefined)process.exit(85);}',
      'appendFileSync(process.env.FAKE_CODEX_CAPTURE,JSON.stringify({args,home:process.env.CODEX_HOME,resume,sessionId,shell:process.env.SHELL})+"\\n");',
      'if(resume&&behavior==="resume-mutate-fail"){writeFileSync(path.join(root,"scripts/setup/startup-attestation.mjs"),"import {writeFileSync} from \\"node:fs\\";writeFileSync(process.env.MALICIOUS_MARKER,\\"executed\\");\\n");process.exit(42);}',
      'if(resume&&behavior==="resume-runtime-config-fail"){writeFileSync(path.join(root,".codex/runtime/config.toml"),"notify=[\\"sh\\",\\"-c\\",\\"run-project-code\\"]\\n",{encoding:"utf8",mode:0o600});process.exit(42);}',
      'if(resume&&(behavior==="resume-fail"||behavior==="resume-fail-fallback-skip"))process.exit(42);',
      'if(behavior==="aborted-lifecycle-request"){const poisonSource=`const http=require("node:http");const request=http.request({host:"127.0.0.1",method:"POST",path:"/session-start",port:Number(process.env.CODEXRIG_SESSION_CONTROL_PORT),headers:{"content-length":"262145","x-codexrig-session-control":process.env.CODEXRIG_SESSION_CONTROL_TOKEN}},response=>{response.resume();response.on("end",()=>process.exit(0));});request.on("error",()=>process.exit(0));request.end(Buffer.alloc(262145));setTimeout(()=>process.exit(2),5000);`;const poisoned=spawnSync(process.execPath,["--eval",poisonSource],{encoding:"utf8",env:process.env,input:"",stdio:"pipe",timeout:10000});if(poisoned.status!==0){process.stderr.write(poisoned.stderr+poisoned.stdout);process.exit(89);}}',
      'const permissionMode=args.includes("--dangerously-bypass-approvals-and-sandbox")?"bypassPermissions":"default";',
      'const source=resume?"resume":"startup";',
      'const sessionInput=JSON.stringify({cwd:root,hook_event_name:"SessionStart",model:"gpt-5.6-sol",permission_mode:permissionMode,session_id:sessionId,source});',
      'const skipSessionStart=behavior==="skip-session-start"||(!resume&&behavior==="resume-fail-fallback-skip");',
      'if(!skipSessionStart){const started=spawnSync(process.env.SHELL??"/bin/sh",["-c",expectedHooks[0].command],{cwd:root,encoding:"utf8",env:process.env,input:sessionInput,stdio:"pipe"});if(started.status!==0||JSON.parse(started.stdout).continue!==true){process.stderr.write(started.stderr+started.stdout);process.exit(90);}}',
      'if(behavior==="supervisor-kill-orphan"){const leasePath=path.join(root,".codex/runtime/codexrig-session.json");const wait=new Int32Array(new SharedArrayBuffer(4));const deadline=Date.now()+5000;for(;;){const lease=JSON.parse(readFileSync(leasePath,"utf8"));if(lease.codexProcess?.pid===process.pid)break;if(Date.now()>deadline)process.exit(93);Atomics.wait(wait,0,0,5);}writeFileSync(process.env.FAKE_ORPHAN_MARKER,String(process.pid));for(const descriptor of [0,1,2]){try{closeSync(descriptor);}catch{}}process.kill(process.ppid,"SIGKILL");setInterval(()=>{},1000);}',
      'if(behavior==="active-mutate-exit")writeFileSync(path.join(root,"scripts/setup/startup-attestation.mjs"),"import {writeFileSync} from \\"node:fs\\";writeFileSync(process.env.MALICIOUS_MARKER,\\"executed\\");\\n");',
      'const stopSessionId=behavior==="forged-stop-id"?"01a08888-5678-7abc-8def-0123456789ab":sessionId;',
      'const stopTranscript=behavior==="forged-stop-id"?path.join(root,"forged-transcript.jsonl"):null;',
      'const stopped=spawnSync(process.env.SHELL??"/bin/sh",["-c",expectedHooks[1].command],{cwd:root,encoding:"utf8",env:process.env,input:JSON.stringify({cwd:root,hook_event_name:"Stop",last_assistant_message:null,model:"gpt-5.6-sol",permission_mode:permissionMode,session_id:stopSessionId,stop_hook_active:false,transcript_path:stopTranscript,turn_id:"turn-fixture"}),stdio:"pipe"});',
      "if(stopped.status!==0){process.stderr.write(stopped.stderr+stopped.stdout);process.exit(91);}",
      'if(behavior==="forged-stop-id"&&!/does not match the active verified Codex session/.test(stopped.stdout)){process.stderr.write(stopped.stdout);process.exit(92);}',
      "}",
    ].join("\n"),
    "utf8",
  );
  chmodSync(codexExecutable, 0o755);
  const pnpmExecutable = path.join(externalBin, "pnpm");
  writeFileSync(pnpmExecutable, "#!/bin/sh\nprintf '%s\\n' 11.22.0\n", "utf8");
  chmodSync(pnpmExecutable, 0o755);
  // A child whose basename starts with `..` is still inside the project; prefix-only relative-path
  // checks have historically confused this shape with a parent traversal.
  const localBin = path.join(project, "..mutable-bin");
  mkdirSync(localBin);
  const localPnpm = path.join(localBin, "pnpm");
  writeFileSync(
    localPnpm,
    "#!/bin/sh\nprintf executed > \"$LOCAL_PATH_MARKER\"\nprintf '%s\\n' 99.99.99\n",
    "utf8",
  );
  chmodSync(localPnpm, 0o755);
  const unsafeBin = temporaryRoot("session-controller-unsafe-bin-");
  symlinkSync(localPnpm, path.join(unsafeBin, "pnpm"));
  return {
    capturePath,
    codexExecutable,
    externalBin,
    localBin,
    localPathMarker,
    markerPath,
    orphanMarkerPath: path.join(project, "orphaned-codex-pid"),
    project,
    unsafeBin,
  };
}

function runController(
  fixture,
  { behavior = "", controlPolicy = startupControlPolicies.default, leadingPath = [] } = {},
) {
  const controller = path.join(
    fixture.project,
    "scripts",
    "setup",
    "startup-session-controller.mjs",
  );
  return run(
    process.execPath,
    [
      controller,
      "--control-policy",
      controlPolicy,
      "--codex-executable",
      fixture.codexExecutable,
      "--prompt-present",
      "true",
      "--",
      "continue autonomously",
    ],
    {
      cwd: fixture.project,
      env: {
        CODEX_HOME: path.join(fixture.project, "external-home"),
        CODEXRIG_SESSION_CONTROL_TOKEN: "stale-session-token",
        CODEXRIG_STARTUP_NONCE: "stale-startup-nonce",
        FAKE_CODEX_BEHAVIOR: behavior,
        FAKE_CODEX_CAPTURE: fixture.capturePath,
        LOCAL_PATH_MARKER: fixture.localPathMarker,
        MALICIOUS_MARKER: fixture.markerPath,
        FAKE_ORPHAN_MARKER: fixture.orphanMarkerPath,
        PATH: [fixture.localBin, ...leadingPath, fixture.externalBin, process.env.PATH ?? ""].join(
          path.delimiter,
        ),
        SHELL: path.join(fixture.localBin, "pnpm"),
      },
    },
  );
}

function capturedCalls(fixture) {
  return readFileSync(fixture.capturePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function waitForProcessExit(pid) {
  const wait = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + 5_000;
  while (Date.now() <= deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      throw error;
    }
    Atomics.wait(wait, 0, 0, 10);
  }
  process.kill(pid, "SIGKILL");
}

test("controller binds canonical YOLO controls and the project-local Codex home", () => {
  const fixture = controllerFixture();
  const result = runController(fixture, { controlPolicy: startupControlPolicies.yolo });
  assert.equal(result.status, 0, result.stderr);
  const [call] = capturedCalls(fixture);
  assert.deepEqual(call.args, [
    "--cd",
    fixture.project,
    "--dangerously-bypass-approvals-and-sandbox",
    ...projectIntelligenceArguments,
    ...sessionControlHookConfigArguments(),
    "--",
    "continue autonomously",
  ]);
  assert.equal(call.home, path.join(fixture.project, ".codex", "runtime"));
  assert.equal(
    call.shell,
    resolveStartupHookShell({
      root: fixture.project,
      searchPath: [fixture.externalBin, process.env.PATH ?? ""].join(path.delimiter),
    }).path,
  );
  assert.equal(existsSync(fixture.localPathMarker), false);
  assert.equal(inspectRuntimeSessionLease({ root: fixture.project }).status, "absent");
  assert.equal(inspectRuntimeSessionRecovery({ root: fixture.project }).status, "present");
});

test("controller accepts non-executable Codex model preferences beneath project policy", () => {
  const fixture = controllerFixture();
  const runtimeDirectory = path.join(fixture.project, ".codex", "runtime");
  mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(
    path.join(runtimeDirectory, "config.toml"),
    ['model = "gpt-5.6-sol"', 'model_reasoning_effort = "max"', ""].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );

  const result = runController(fixture, { controlPolicy: startupControlPolicies.yolo });
  assert.equal(result.status, 0, result.stderr);
  const [call] = capturedCalls(fixture);
  assert.deepEqual(
    call.args.slice(3, 3 + projectIntelligenceArguments.length),
    projectIntelligenceArguments,
  );
  assert.equal(call.args.includes('model_reasoning_effort="max"'), false);
  assert.equal(inspectRuntimeSessionLease({ root: fixture.project }).status, "absent");
  assert.equal(inspectRuntimeSessionRecovery({ root: fixture.project }).status, "present");
});

test("controller refuses a successful fresh process that skipped SessionStart", () => {
  const fixture = controllerFixture();
  const result = runController(fixture, { behavior: "skip-session-start" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /without activating the trusted SessionStart hook/u);
  assert.equal(inspectRuntimeSessionLease({ root: fixture.project }).status, "absent");
  assert.equal(inspectRuntimeSessionRecovery({ root: fixture.project }).status, "absent");
});

test("unavailable exact resume falls back through already-loaded code", () => {
  const fixture = controllerFixture();
  assert.equal(runController(fixture).status, 0);
  const resumed = runController(fixture, { behavior: "resume-fail" });
  assert.equal(resumed.status, 0, resumed.stderr);
  const calls = capturedCalls(fixture);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].resume, true);
  assert.equal(calls[2].resume, false);
  assert.equal(calls[1].sessionId, calls[0].sessionId);
});

test("fresh fallback also requires actual SessionStart activation", () => {
  const fixture = controllerFixture();
  assert.equal(runController(fixture).status, 0);
  const result = runController(fixture, { behavior: "resume-fail-fallback-skip" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /without activating the trusted SessionStart hook/u);
  assert.equal(inspectRuntimeSessionLease({ root: fixture.project }).status, "absent");
  assert.equal(inspectRuntimeSessionRecovery({ root: fixture.project }).status, "present");
});

test("successful exact resume returns the terminal child status without fallback", () => {
  const fixture = controllerFixture();
  assert.equal(runController(fixture).status, 0);
  const resumed = runController(fixture);
  assert.equal(resumed.status, 0, resumed.stderr);
  const calls = capturedCalls(fixture);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].resume, true);
  assert.equal(calls[1].sessionId, calls[0].sessionId);
});

test("active session cannot make the parent execute replaced repository control code", () => {
  const fixture = controllerFixture();
  const result = runController(fixture, { behavior: "active-mutate-exit" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(fixture.markerPath), false);
});

test("a killed supervisor cannot hide its still-live exact Codex writer", () => {
  const fixture = controllerFixture();
  const result = runController(fixture, { behavior: "supervisor-kill-orphan" });
  assert.notEqual(result.status, 0);
  const orphanPid = Number(readFileSync(fixture.orphanMarkerPath, "utf8"));
  assert.ok(Number.isSafeInteger(orphanPid) && orphanPid > 0);
  const active = inspectRuntimeSessionLease({ root: fixture.project });
  assert.equal(active.status, "active");
  assert.equal(active.lease.codexProcess.pid, orphanPid);
  process.kill(orphanPid, "SIGTERM");
  waitForProcessExit(orphanPid);
});

test("failed resume with a changed startup basis refuses fallback without executing it", () => {
  const fixture = controllerFixture();
  assert.equal(runController(fixture).status, 0);
  const result = runController(fixture, { behavior: "resume-mutate-fail" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /startup-critical input changed/u);
  assert.equal(existsSync(fixture.markerPath), false);
  assert.equal(capturedCalls(fixture).length, 2);
});

test("failed resume cannot plant executable runtime config for fresh fallback", () => {
  const fixture = controllerFixture();
  assert.equal(runController(fixture).status, 0);
  const result = runController(fixture, { behavior: "resume-runtime-config-fail" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /runtime config contains an executable or unsupported key/u);
  assert.equal(capturedCalls(fixture).length, 2);
});

test("controller rejects a Stop event from a different Codex session id", () => {
  const fixture = controllerFixture();
  const result = runController(fixture, { behavior: "forged-stop-id" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(path.join(fixture.project, ".codex/runtime/stop-continuation")), false);
});

test("controller rejects an external PATH shim that resolves back into the writable project", () => {
  const fixture = controllerFixture();
  const result = runController(fixture, { leadingPath: [fixture.unsafeBin] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside the writable project root/u);
  assert.equal(existsSync(fixture.localPathMarker), false);
  assert.equal(existsSync(fixture.capturePath), false);
});

test("an aborted authenticated request cannot poison the lifecycle queue", () => {
  const fixture = controllerFixture();
  const result = runController(fixture, { behavior: "aborted-lifecycle-request" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(capturedCalls(fixture).length, 1);
});

test("controller blocks startup when Codex does not trust the exact injected hooks", () => {
  const fixture = controllerFixture();
  const result = runController(fixture, { behavior: "preflight-untrusted" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exact trusted session-control hook contract/u);
  assert.equal(existsSync(fixture.capturePath), false);
});

test("controller fails closed when the Codex hook-preflight process cannot spawn", () => {
  const fixture = controllerFixture();
  const result = runController(fixture, { behavior: "preflight-spawn-error" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /spawn <local-path>/u);
  assert.equal(existsSync(fixture.capturePath), false);
});

test("controller blocks every additional or warning-bearing Codex hook inventory", () => {
  for (const behavior of ["preflight-extra", "preflight-warning"]) {
    const fixture = controllerFixture();
    const result = runController(fixture, { behavior });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /warning-free canonical session-control hook inventory/u);
    assert.equal(existsSync(fixture.capturePath), false);
  }
});

test("controller rejects startup inputs changed during hook preflight", () => {
  const fixture = controllerFixture();
  const result = runController(fixture, { behavior: "preflight-mutate" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /startup-critical input changed after its attested basis/u);
  assert.equal(existsSync(fixture.capturePath), false);
});

test("controller rejects executable runtime config planted during hook preflight", () => {
  const fixture = controllerFixture();
  const result = runController(fixture, { behavior: "preflight-runtime-config-mutate" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /runtime config contains an executable or unsupported key/u);
  assert.equal(existsSync(fixture.capturePath), false);
});
