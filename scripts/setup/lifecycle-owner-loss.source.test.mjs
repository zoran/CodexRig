/** Exercises owner loss through source and generated lifecycle code, without product maintenance. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  readProjectToolSelection,
  selectedProjectVerification,
} from "../framework/project-tool-selection.mjs";
import { projectOutputText } from "../framework/project-output-projection.mjs";
import {
  captureProcessIdentity,
  inspectProcessIdentity,
} from "../repository/runtime-process-identity.mjs";

const source = path.resolve(import.meta.dirname, "../..");
test("the local lifecycle regression owners explicitly allow bounded cancellation", () => {
  const configuration = JSON.parse(readFileSync(path.join(source, ".codex/verification.json")));
  for (const key of [
    "setup-regressions",
    "verification-orchestration-regressions",
    "toolchain-admission",
  ])
    assert.equal(
      configuration.commands.find((command) => command.key === key)?.cancellable,
      true,
      key,
    );
  const projected = selectedProjectVerification(configuration, readProjectToolSelection(source));
  assert.equal(
    projected.commands.find((command) => command.key === "toolchain-admission").cancellable,
    true,
  );
});
const subreaper = String.raw`
import ctypes, json, os, subprocess, sys, time
if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
    raise OSError("Cannot establish fixture subreaper")
result = subprocess.run(sys.argv[1:], capture_output=True, text=True, timeout=20)
deadline = time.monotonic() + 3
while time.monotonic() < deadline:
    try:
        pid, status = os.waitpid(-1, os.WNOHANG)
    except ChildProcessError:
        print(json.dumps(dict(status=result.returncode, stdout=result.stdout, stderr=result.stderr)))
        break
    if not pid: time.sleep(0.01)
else:
    raise RuntimeError("Fixture left a running descendant")
`;

for (const generated of [false, true]) {
  for (const cancellable of [false, true]) {
    test(
      `${generated ? "generated" : "source"} owner loss ${cancellable ? "drains cancellable checks" : "preserves other commands and rejects startup waiting"}`,
      {
        skip: process.platform !== "linux",
        timeout: 30_000,
      },
      (t) => {
        const fixture = mkdtempSync(path.join(os.tmpdir(), "lifecycle-owner-loss-"));
        t.after(() => rmSync(fixture, { recursive: true, force: true }));
        const root = path.join(fixture, "repository");
        mkdirSync(root);
        let modules = source;
        if (generated) {
          modules = path.join(fixture, "generated");
          const selection = readProjectToolSelection(source);
          for (const file of selection.files) {
            const target = path.join(modules, file);
            mkdirSync(path.dirname(target), { recursive: true });
            writeFileSync(target, projectOutputText(readFileSync(path.join(source, file), "utf8")));
          }
          writeFileSync(
            path.join(modules, ".codex/verification.json"),
            projectOutputText(
              JSON.stringify(
                selectedProjectVerification(
                  JSON.parse(readFileSync(path.join(source, ".codex/verification.json"))),
                  selection,
                ),
              ),
            ),
          );
        }
        const module = (file) => pathToFileURL(path.join(modules, "scripts", file)).href;
        const ready = path.join(root, "ready.json");
        const target = `
        import {writeFileSync} from 'node:fs';
        process.on('SIGTERM', () => setTimeout(() => process.exit(0), 100));
        writeFileSync(${JSON.stringify(ready)}, JSON.stringify({pid:process.pid}));
        setTimeout(() => process.exit(91), 10000);
      `;
        const coordinator = `
        import {withVerificationSessionLock} from ${JSON.stringify(module("verify/verification-session-lock.mjs"))};
        import {runPlan} from ${JSON.stringify(module("verify/verification-executor.mjs"))};
        const root=${JSON.stringify(root)};
        const command={key:'owner-loss',label:'owner-loss',phase:'broad',executable:process.execPath,
          args:['--input-type=module','--eval',${JSON.stringify(target)}],cancellable:${cancellable}};
        const plan={admission:{mode:'targeted',reason:'fixture'},classifiedPaths:[],
          options:{mode:'repo',printPlan:false},readOnlyCommands:[command],workspaceCommands:[]};
        await withVerificationSessionLock(()=>runPlan(plan,{repositoryRoot:root}),{repositoryRoot:root});
      `;
        const driver = `
        import assert from 'node:assert/strict';
        import {spawn} from 'node:child_process';
        import {once} from 'node:events';
        import {existsSync,readFileSync} from 'node:fs';
        import {setTimeout as delay} from 'node:timers/promises';
        import {inspectProcessIdentity} from ${JSON.stringify(module("repository/runtime-process-identity.mjs"))};
        import {acquireRuntimeLifecycleLock,inspectRuntimeLifecycleLock,releaseRuntimeLifecycleLock} from ${JSON.stringify(module("repository/runtime-session-lease.mjs"))};
        import {maintainToolchain} from ${JSON.stringify(module("deps/maintain-toolchain.mjs"))};
        const root=${JSON.stringify(root)}, ready=${JSON.stringify(ready)};
        const wait=async(test)=>{const until=Date.now()+3000;while(!test()){if(Date.now()>until)throw new Error('Owner-loss cleanup timed out');await delay(20);}};
        const parent=spawn(process.execPath,['--input-type=module','--eval',${JSON.stringify(coordinator)}],{detached:true,stdio:'ignore'});
        const exited=once(parent,'exit');
        let snapshot;
        try {
          await wait(()=>existsSync(ready) && inspectRuntimeLifecycleLock({root}).owner?.descendants.length===2);
          snapshot=inspectRuntimeLifecycleLock({root});
          const supervisor=snapshot.owner.descendants.find(d=>d.role==='verification-supervisor').identity;
          const command=snapshot.owner.descendants.find(d=>d.role==='verification-supervisor-command').identity;
          const stat=readFileSync('/proc/'+supervisor.pid+'/stat','utf8');
          assert.equal(Number(stat.slice(stat.lastIndexOf(')')+1).trim().split(/\\s+/)[2]),supervisor.pid);
          // A terminal/tool timeout can kill the caller's entire group, not just its PID.
          process.kill(-parent.pid,'SIGKILL');
          await exited;
          if (!${cancellable}) {
            assert.equal(inspectProcessIdentity(command),'active');
            await assert.rejects(maintainToolchain({root,startup:true,
              onLifecycleWait:()=>assert.fail('must not wait on a dead coordinator'),
              candidateResolver:()=>assert.fail('must not start installation')}),/coordinator.*stale.*descendants/);
            assert.equal(inspectProcessIdentity(command),'active');
            process.kill(supervisor.pid,'SIGTERM');
          }
          await wait(()=>inspectRuntimeLifecycleLock({root}).status==='stale');
          assert.equal(inspectProcessIdentity(command),'stale');
          const recovered=acquireRuntimeLifecycleLock({root,operation:'toolchain-maintenance'});
          releaseRuntimeLifecycleLock({root,owner:recovered});
          assert.equal(inspectRuntimeLifecycleLock({root}).status,'absent');
        } finally {
          if(parent.exitCode===null && parent.signalCode===null)parent.kill('SIGKILL');
          await exited;
          for(const d of snapshot?.owner.descendants ?? [])
            if(inspectProcessIdentity(d.identity)==='active')process.kill(d.identity.pid,'SIGTERM');
        }
      `;
        const result = spawnSync(
          "python3",
          ["-c", subreaper, process.execPath, "--input-type=module", "--eval", driver],
          {
            cwd: root,
            encoding: "utf8",
            timeout: 25_000,
          },
        );
        assert.equal(result.error, undefined, result.stderr);
        assert.equal(result.status, 0, result.stderr);
        const report = JSON.parse(result.stdout);
        assert.equal(report.status, 0, report.stderr);
      },
    );
  }
}

test(
  "an unreaped Linux zombie cannot keep a lifecycle identity active",
  { skip: process.platform !== "linux" },
  async (t) => {
    const parent = spawn(
      "python3",
      [
        "-c",
        `
import os, signal, sys
pid=os.fork()
if pid==0:
    signal.pause()
    os._exit(0)
print(pid, flush=True)
sys.stdin.readline()
os.waitpid(pid, 0)
`,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const exited = once(parent, "exit");
    const [data] = await once(parent.stdout, "data");
    const pid = Number(data.toString().trim());
    const identity = captureProcessIdentity(pid);
    t.after(async () => {
      parent.stdin.end("reap\n");
      await exited;
    });
    assert.equal(inspectProcessIdentity(identity), "active");
    process.kill(pid, "SIGTERM");
    const until = Date.now() + 3000;
    while (!/\) Z /u.test(readFileSync(`/proc/${pid}/stat`, "utf8"))) {
      assert.ok(Date.now() < until, "fixture child must exit without being reaped");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(captureProcessIdentity(pid), null);
    assert.equal(inspectProcessIdentity(identity), "stale");
  },
);
