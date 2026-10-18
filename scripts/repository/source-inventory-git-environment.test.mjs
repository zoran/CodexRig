/** Verifies bounded synchronous captures and isolated Git behavior for repository inventory. */
import assert from "node:assert/strict";
import childProcess, { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  closeSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { isolatedGitResultCompleted } from "./git-runtime-isolation.mjs";
import { spawnSyncWithBoundedIo } from "./runtime-process-io.mjs";
import { spawnRuntimeLifecycleCommandSync } from "./runtime-lifecycle-process.mjs";
import {
  acquireRuntimeLifecycleLock,
  inspectRuntimeLifecycleLock,
  releaseRuntimeLifecycleLock,
} from "./runtime-session-lease.mjs";
import { listActiveFiles, listPortableTransferFiles } from "./source-inventory.mjs";
import { projectFormatFiles } from "../verify/format-project.mjs";

function write(root, relativePath, content = relativePath) {
  const target = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

const completionArguments = ["--version"];

function completedGitResult(overrides = {}) {
  return {
    error: undefined,
    pid: 42,
    signal: null,
    status: 0,
    stdout: "git version 2.53.0\n",
    ...overrides,
  };
}

function sandboxCompletionError(overrides = {}) {
  return Object.assign(new Error("spawnSync git EPERM"), {
    code: "EPERM",
    errno: -1,
    path: "git",
    spawnargs: completionArguments,
    syscall: "spawnSync git",
    ...overrides,
  });
}

test("isolated Git accepts only ordinary or exact sandbox terminal completion", () => {
  assert.equal(
    isolatedGitResultCompleted(completedGitResult(), { args: completionArguments }),
    true,
  );
  assert.equal(
    isolatedGitResultCompleted(completedGitResult({ error: sandboxCompletionError() }), {
      args: completionArguments,
    }),
    true,
  );
  assert.equal(
    isolatedGitResultCompleted(
      completedGitResult({
        error: sandboxCompletionError(),
        status: 128,
        stdout: Buffer.alloc(0),
      }),
      {
        acceptedStatuses: [0, 128],
        args: completionArguments,
        encoding: null,
        maximumOutputBytes: 0,
      },
    ),
    true,
  );

  for (const result of [
    completedGitResult({ error: sandboxCompletionError({ code: "ETIMEDOUT" }) }),
    completedGitResult({ error: sandboxCompletionError({ path: "other" }) }),
    completedGitResult({ error: sandboxCompletionError({ spawnargs: ["status"] }) }),
    completedGitResult({ pid: 0 }),
    completedGitResult({ signal: "SIGTERM", status: null }),
    completedGitResult({ status: 1 }),
    completedGitResult({ stdout: Buffer.alloc(0) }),
  ]) {
    assert.equal(isolatedGitResultCompleted(result, { args: completionArguments }), false);
  }
  assert.equal(
    isolatedGitResultCompleted(completedGitResult({ stdout: "too large" }), {
      args: completionArguments,
      maximumOutputBytes: 3,
    }),
    false,
  );
});

test("bounded synchronous process I/O preserves EOF and descendant output", () => {
  const descendantSource = [
    'import { spawnSync } from "node:child_process";',
    'import { readFileSync } from "node:fs";',
    'const input = readFileSync(0, "utf8");',
    'const child = spawnSync(process.execPath, ["--eval", "process.stdout.write(\\"descendant\\")"], { stdio: ["ignore", "inherit", "inherit"] });',
    "if (child.status !== 0 || child.signal) process.exit(70);",
    "process.stdout.write(`:${input}`);",
    'process.stderr.write("diagnostic");',
  ].join("\n");
  const completed = spawnSyncWithBoundedIo(
    process.execPath,
    ["--input-type=module", "--eval", descendantSource],
    {
      encoding: "utf8",
      input: "forwarded-input",
      maxBuffer: 1024,
      stdio: "pipe",
      timeout: 5_000,
    },
  );
  assert.equal(completed.error, undefined);
  assert.equal(completed.status, 0);
  assert.equal(completed.signal, null);
  assert.equal(completed.stdout, "descendant:forwarded-input");
  assert.equal(completed.stderr, "diagnostic");

  const oversized = spawnSyncWithBoundedIo(
    process.execPath,
    ["--eval", 'process.stdout.write("four")'],
    { encoding: "utf8", maxBuffer: 3, stdio: "pipe", timeout: 5_000 },
  );
  assert.equal(oversized.error?.code, "CODEXRIG_BOUNDED_PROCESS_IO");
  assert.equal(oversized.stdout, "fou");

  assert.throws(
    () =>
      spawnSyncWithBoundedIo(process.execPath, ["--version"], {
        input: "unexpected",
        stdio: "inherit",
      }),
    /input requires piped stdin/u,
  );
});

test("bounded synchronous process I/O caps live spool files before a 256 KiB producer exits", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "runtime-process-io-live-cap-"));
  const previousTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = fixture;
  try {
    for (const stream of ["stdout", "stderr"]) {
      const observation = path.join(fixture, `${stream}.json`);
      const source = `
        import { readdirSync, statSync, writeFileSync } from "node:fs";
        import path from "node:path";
        process.on("SIGTERM", () => {
          const directory = path.join(process.env.TMPDIR,
            readdirSync(process.env.TMPDIR).find((name) => name.startsWith("codexrig-process-io-")));
          const file = statSync(path.join(directory, ${JSON.stringify(stream)}));
          writeFileSync(${JSON.stringify(observation)}, JSON.stringify({
            pid: process.pid, size: file.size, mode: file.mode & 0o777,
            directoryMode: statSync(directory).mode & 0o777,
          }));
          process.exit(0);
        });
        process.${stream}.write(Buffer.alloc(256 * 1024, 120));
        setTimeout(() => process.exit(80), 4000);
      `;
      const started = performance.now();
      const result = spawnSyncWithBoundedIo(
        process.execPath,
        ["--input-type=module", "--eval", source],
        {
          maxBuffer: 1024,
          timeout: 5000,
        },
      );
      assert.equal(result.error?.code, "CODEXRIG_BOUNDED_PROCESS_IO");
      assert.equal(result[stream].length, 1024);
      assert.deepEqual(JSON.parse(readFileSync(observation, "utf8")), {
        pid: result.pid,
        size: 1024,
        mode: 0o600,
        directoryMode: 0o700,
      });
      assert.ok(
        performance.now() - started < 3000,
        "overflow must cancel before the producer's fallback exit",
      );
      assert.throws(() => process.kill(result.pid, 0), { code: "ESRCH" });
      assert.equal(
        readdirSync(fixture).some((name) => name.startsWith("codexrig-process-io-")),
        false,
      );
    }
  } finally {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("bounded synchronous process I/O preserves target options, descriptors, and terminal results", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "runtime-process-io-options-"));
  const guardPath = path.join(fixture, "guard");
  const guard = openSync(guardPath, "w+");
  const preloadPath = path.join(fixture, "preload.mjs");
  const preloadLog = path.join(fixture, "preload.jsonl");
  const previousNodeOptions = process.env.NODE_OPTIONS;
  writeFileSync(
    preloadPath,
    `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(preloadLog)}, process.pid + "\\n");`,
  );
  process.env.NODE_OPTIONS = `--import=${pathToFileURL(preloadPath).href}`;
  try {
    const source = `
      import { readFileSync, writeSync } from "node:fs";
      writeSync(3, "held-guard");
      process.stdout.write(JSON.stringify({ pid: process.pid, cwd: process.cwd(), argv0: process.argv0,
        argument: process.argv[1], marker: process.env.IO_MARKER, input: [...readFileSync(0)] }));
      process.stderr.write(Buffer.from([0xff, 0x00]));
    `;
    const result = spawnSyncWithBoundedIo(
      process.execPath,
      ["--input-type=module", "--eval", source, "argument with spaces"],
      {
        cwd: pathToFileURL(`${fixture}/`),
        env: { ...process.env, IO_MARKER: "target-env" },
        argv0: "capture-target",
        shell: false,
        stdio: [null, undefined, "pipe", guard],
        input: new Uint8Array([0, 1, 255]),
        maxBuffer: 4096,
        timeout: 5000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.signal, null);
    assert.equal(result.output.length, 4);
    assert.deepEqual(JSON.parse(result.stdout.toString()), {
      pid: result.pid,
      cwd: fixture,
      argv0: "capture-target",
      argument: "argument with spaces",
      marker: "target-env",
      input: [0, 1, 255],
    });
    assert.deepEqual(result.stderr, Buffer.from([0xff, 0x00]));
    assert.equal(readFileSync(guardPath, "utf8"), "held-guard");
    assert.equal(
      readFileSync(preloadLog, "utf8"),
      `${result.pid}\n`,
      "preloads must run in the target only",
    );
    process.env.NODE_OPTIONS = "--codexrig-invalid-node-option";
    const nonNode = spawnSyncWithBoundedIo("git", ["--version"], {
      env: { ...process.env },
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(nonNode.error, undefined);
    assert.equal(nonNode.status, 0);
    assert.match(nonNode.stdout, /^git version /u);
  } finally {
    if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousNodeOptions;
    closeSync(guard);
    rmSync(fixture, { recursive: true, force: true });
  }
  const nonzero = spawnSyncWithBoundedIo(
    process.execPath,
    ["--eval", 'process.stdout.write("café"); process.exitCode = 7'],
    { encoding: "latin1" },
  );
  assert.equal(nonzero.error, undefined);
  assert.equal(nonzero.status, 7);
  assert.equal(nonzero.stdout, Buffer.from("café").toString("latin1"));
  const signaled = spawnSyncWithBoundedIo(process.execPath, [
    "--eval",
    'process.kill(process.pid, "SIGTERM")',
  ]);
  assert.equal(signaled.error, undefined);
  assert.equal(signaled.status, null);
  assert.equal(signaled.signal, "SIGTERM");
  const absentCommand = path.join(fixture, "missing-executable");
  const absent = spawnSyncWithBoundedIo(absentCommand, ["argument"]);
  assert.equal(absent.pid, 0);
  assert.equal(absent.status, null);
  assert.equal(absent.signal, null);
  assert.equal(absent.error?.code, "ENOENT");
  assert.equal(absent.error.path, absentCommand);
  assert.equal(absent.error.syscall, `spawnSync ${absentCommand}`);
  assert.deepEqual(absent.error.spawnargs, ["argument"]);
  assert.throws(
    () => spawnSyncWithBoundedIo(process.execPath, [], { shell: true }),
    /shell option/u,
  );
});

test("bounded synchronous process I/O rejects missing or mismatched pump terminal evidence", () => {
  const original = childProcess.spawnSync;
  try {
    for (const record of [
      null,
      { nonce: "other-call", pid: 42, status: 0, signal: null, error: null },
      {
        nonce: null,
        pid: 42,
        status: 0,
        signal: null,
        error: { code: "EPERM", errno: -1, message: "capture permission failure" },
      },
    ]) {
      childProcess.spawnSync = (command, args, options) => {
        if (record) {
          const nonce =
            record.nonce ?? JSON.parse(readFileSync(options.stdio.at(-3), "utf8")).nonce;
          writeFileSync(options.stdio.at(-2), JSON.stringify({ ...record, nonce }));
        }
        return {
          pid: 42,
          status: 0,
          signal: null,
          output: Array(options.stdio.length).fill(null),
          error: Object.assign(new Error("exact managed sandbox marker"), {
            code: "EPERM",
            path: command,
            syscall: `spawnSync ${command}`,
            spawnargs: args,
          }),
        };
      };
      syncBuiltinESMExports();
      const result = spawnSyncWithBoundedIo("git", ["--version"]);
      assert.equal(result.error?.code, "CODEXRIG_BOUNDED_PROCESS_IO");
      assert.equal(result.pid, record?.error ? 42 : 0);
      assert.equal(result.status, record?.error ? 0 : null);
      assert.equal(isolatedGitResultCompleted(result, { args: ["--version"] }), false);
    }
  } finally {
    childProcess.spawnSync = original;
    syncBuiltinESMExports();
  }
});

test("bounded synchronous process I/O preserves the lifecycle delegation, guard, and release", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "runtime-process-io-lifecycle-"));
  const previousStorage = process.env.PROJECT_TOOL_STORAGE_HOME;
  process.env.PROJECT_TOOL_STORAGE_HOME = path.join(fixture, "tools");
  mkdirSync(process.env.PROJECT_TOOL_STORAGE_HOME, { mode: 0o700 });
  let owner;
  try {
    owner = acquireRuntimeLifecycleLock({ root: fixture, operation: "bounded-capture-test" });
    const result = spawnRuntimeLifecycleCommandSync({
      repositoryRoot: fixture,
      lifecycleCapability: owner,
      role: "bounded-capture-child",
      command: process.execPath,
      args: [
        "--input-type=module",
        "--eval",
        'import { fstatSync } from "node:fs"; process.stdout.write(JSON.stringify({ guard: fstatSync(3).isFile() }));',
      ],
      options: { encoding: "utf8", maxBuffer: 4096, timeout: 3000 },
    });
    assert.equal(result.error, undefined, result.stderr);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { guard: true });
    const snapshot = inspectRuntimeLifecycleLock({ root: fixture });
    assert.deepEqual(snapshot.owner.descendants, []);
    assert.deepEqual(snapshot.owner.delegations, []);
    releaseRuntimeLifecycleLock({ root: fixture, owner });
    owner = null;
    assert.equal(inspectRuntimeLifecycleLock({ root: fixture }).status, "absent");
  } finally {
    if (owner) releaseRuntimeLifecycleLock({ root: fixture, owner });
    if (previousStorage === undefined) delete process.env.PROJECT_TOOL_STORAGE_HOME;
    else process.env.PROJECT_TOOL_STORAGE_HOME = previousStorage;
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("bounded synchronous process I/O times out, escalates, and reaps a stubborn owned child", () => {
  const source =
    'process.on("SIGTERM", () => {}); process.stdout.write(String(process.pid)); setTimeout(() => process.exit(81), 12000);';
  const started = performance.now();
  const result = spawnSyncWithBoundedIo(process.execPath, ["--eval", source], {
    encoding: "utf8",
    timeout: 300,
  });
  const elapsed = performance.now() - started;
  assert.equal(result.error?.code, "ETIMEDOUT");
  assert.equal(result.pid, Number(result.stdout));
  assert.equal(result.status, null);
  assert.equal(result.signal, "SIGKILL");
  assert.ok(elapsed >= 6000 && elapsed < 10000, `bounded graceful shutdown took ${elapsed}ms`);
  assert.throws(() => process.kill(result.pid, 0), { code: "ESRCH" });
  const immediate = spawnSyncWithBoundedIo(
    process.execPath,
    ["--eval", "setInterval(() => {}, 1000)"],
    { timeout: 100, killSignal: "SIGKILL" },
  );
  assert.equal(immediate.error?.code, "ETIMEDOUT");
  assert.equal(immediate.signal, "SIGKILL");
});

test("bounded synchronous process I/O cancels an owned descendant group and waits for reaping", () => {
  const descendant = 'process.stdout.write("ready\\n"); setTimeout(() => process.exit(82), 10000);';
  const source = `
    import { spawn } from "node:child_process";
    const child = spawn(process.execPath, ["--eval", ${JSON.stringify(descendant)}], { stdio: ["ignore", "pipe", "inherit"] });
    process.on("SIGTERM", () => {});
    child.stdout.once("data", () => process.stdout.write(JSON.stringify({ pid: process.pid, descendant: child.pid })));
    child.on("close", () => process.exit(0));
  `;
  const result = spawnSyncWithBoundedIo(
    process.execPath,
    ["--input-type=module", "--eval", source],
    { encoding: "utf8", timeout: 500 },
  );
  assert.equal(result.error?.code, "ETIMEDOUT");
  const owned = JSON.parse(result.stdout);
  assert.equal(owned.pid, result.pid);
  for (const pid of [owned.pid, owned.descendant])
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

for (const cancellation of ["caller exit", "supervisor interruption"]) {
  test(`bounded synchronous process I/O cancels and cleans private files on ${cancellation}`, async () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), "runtime-process-io-caller-loss-"));
    const identityPath = path.join(fixture, "target.json");
    const resultPath = path.join(fixture, "result.json");
    const targetSource = `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(identityPath)}, JSON.stringify({ pid: process.pid, supervisor: process.ppid })); setTimeout(() => process.exit(83), 10000);`;
    const callerSource = `import { writeFileSync } from "node:fs"; import { spawnSyncWithBoundedIo } from ${JSON.stringify(new URL("./runtime-process-io.mjs", import.meta.url).href)}; const result = spawnSyncWithBoundedIo(process.execPath, ["--input-type=module", "--eval", ${JSON.stringify(targetSource)}], { timeout: 10000 }); writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ pid: result.pid, status: result.status, signal: result.signal, error: result.error?.code }));`;
    const caller = spawn(process.execPath, ["--input-type=module", "--eval", callerSource], {
      env: { ...process.env, TMPDIR: fixture },
      stdio: "ignore",
    });
    const closed = new Promise((resolve) => caller.once("close", resolve));
    try {
      const deadline = Date.now() + 5000;
      while (!existsSync(identityPath) && Date.now() < deadline) await delay(20);
      assert.equal(
        existsSync(identityPath),
        true,
        "owned target must announce its identity before cancellation",
      );
      const owned = JSON.parse(readFileSync(identityPath, "utf8"));
      if (cancellation === "caller exit") caller.kill("SIGKILL");
      else process.kill(owned.supervisor, "SIGINT");
      await closed;
      while (
        readdirSync(fixture).some((name) => name.startsWith("codexrig-process-io-")) &&
        Date.now() < deadline
      )
        await delay(20);
      if (cancellation === "caller exit") assert.deepEqual(readdirSync(fixture), ["target.json"]);
      else {
        assert.deepEqual(readdirSync(fixture).sort(), ["result.json", "target.json"]);
        assert.deepEqual(JSON.parse(readFileSync(resultPath, "utf8")), {
          pid: owned.pid,
          status: null,
          signal: "SIGINT",
          error: "EINTR",
        });
      }
      assert.throws(() => process.kill(owned.pid, 0), { code: "ESRCH" });
    } finally {
      if (caller.exitCode === null && caller.signalCode === null) caller.kill("SIGKILL");
      await closed;
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}

test("source inventory ignores ambient and repository-local Git excludes", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "source-inventory-git-environment-"));
  const root = path.join(fixture, "project");
  const xdgConfigHome = path.join(fixture, "xdg");
  mkdirSync(root, { recursive: true });
  write(root, ".gitignore", "src/project-ignored.ts\n");
  write(root, "src/ambient-hidden.ts", "export const ambient = true;\n");
  write(root, "src/local-hidden.ts", "export const local = true;\n");
  write(root, "src/project-ignored.ts", "export const ignored = true;\n");
  write(root, "src/visible.ts", "export const visible = true;\n");
  write(xdgConfigHome, "git/ignore", "src/ambient-hidden.ts\n");
  const initialized = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  write(root, ".git/info/exclude", "src/local-hidden.ts\n");

  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = xdgConfigHome;
  try {
    const ambientGit = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(ambientGit.status, 0, ambientGit.stderr);
    assert.doesNotMatch(ambientGit.stdout, /(?:ambient|local)-hidden\.ts/);

    for (const files of [
      listActiveFiles({ root }),
      listPortableTransferFiles({ root }),
      projectFormatFiles(root),
    ]) {
      assert.equal(files.includes("src/ambient-hidden.ts"), true);
      assert.equal(files.includes("src/local-hidden.ts"), true);
      assert.equal(files.includes("src/project-ignored.ts"), false);
    }
  } finally {
    if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    rmSync(fixture, { force: true, recursive: true });
  }
});

test("source inventory binds its worktree and disables repository-local FSMonitor execution", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "source-inventory-local-git-config-"));
  const root = path.join(fixture, "project");
  const redirectedWorktree = path.join(fixture, "redirected-worktree");
  const sentinel = path.join(fixture, "fsmonitor-was-invoked");
  const fsmonitor = path.join(fixture, "fsmonitor-hook.mjs");
  mkdirSync(root, { recursive: true });
  mkdirSync(redirectedWorktree, { recursive: true });
  write(root, ".gitignore", "src/project-ignored.ts\n");
  write(root, "src/project.ts", "export const project = true;\n");
  write(redirectedWorktree, "src/foreign.ts", "export const foreign = true;\n");
  writeFileSync(
    fsmonitor,
    '#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nif (process.env.FSMONITOR_SENTINEL) writeFileSync(process.env.FSMONITOR_SENTINEL, "called\\n");\nprocess.exitCode = 1;\n',
    "utf8",
  );
  chmodSync(fsmonitor, 0o755);
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["config", "core.fsmonitor", fsmonitor], { cwd: root }).status, 0);

  const naiveStatus = spawnSync("git", ["status", "--porcelain=v1"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, FSMONITOR_SENTINEL: sentinel },
  });
  assert.equal(naiveStatus.status, 0, naiveStatus.stderr);
  assert.equal(existsSync(sentinel), true);
  rmSync(sentinel);
  assert.equal(
    spawnSync("git", ["config", "core.worktree", redirectedWorktree], { cwd: root }).status,
    0,
  );
  const naiveRoot = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(naiveRoot.status, 0, naiveRoot.stderr);
  assert.equal(path.resolve(naiveRoot.stdout.trim()), redirectedWorktree);

  const previousSentinel = process.env.FSMONITOR_SENTINEL;
  process.env.FSMONITOR_SENTINEL = sentinel;
  try {
    for (const files of [
      listActiveFiles({ root }),
      listPortableTransferFiles({ root }),
      projectFormatFiles(root),
    ]) {
      assert.equal(files.includes("src/project.ts"), true);
      assert.equal(files.includes("src/foreign.ts"), false);
    }
    assert.equal(existsSync(sentinel), false);
  } finally {
    if (previousSentinel === undefined) delete process.env.FSMONITOR_SENTINEL;
    else process.env.FSMONITOR_SENTINEL = previousSentinel;
    rmSync(fixture, { force: true, recursive: true });
  }
});

test("Git-less roots nested below another repository keep their own inventory boundary", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "source-inventory-parent-repository-"));
  const outer = path.join(fixture, "outer");
  const root = path.join(outer, "nested-project");
  mkdirSync(root, { recursive: true });
  write(outer, ".gitignore", "nested-project/src/hidden-by-parent.ts\n");
  write(root, "src/hidden-by-parent.ts", "export const local = true;\n");
  write(root, "src/project.ts", "export const project = true;\n");
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: outer }).status, 0);

  const naiveRoot = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(path.resolve(naiveRoot.stdout.trim()), outer);
  for (const files of [
    listActiveFiles({ root }),
    listPortableTransferFiles({ root, includeUntracked: true }),
    projectFormatFiles(root),
  ]) {
    assert.equal(files.includes("src/hidden-by-parent.ts"), true);
    assert.equal(files.includes("src/project.ts"), true);
  }
  assert.throws(
    () => listPortableTransferFiles({ root, includeUntracked: false }),
    /Tracked portable transfer requires the source root to be a Git worktree/,
  );
  rmSync(fixture, { force: true, recursive: true });
});

test("owned Git worktree gitfiles are supported while symlinked metadata is rejected", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "source-inventory-owned-gitfile-"));
  const main = path.join(fixture, "main");
  const linked = path.join(fixture, "linked");
  mkdirSync(main);
  write(main, "README.md", "main\n");
  for (const args of [
    ["init", "-q"],
    ["config", "user.name", "Source Inventory Test"],
    ["config", "user.email", "source-inventory@example.invalid"],
    ["add", "README.md"],
    ["commit", "-q", "-m", "fixture"],
  ]) {
    const result = spawnSync("git", args, { cwd: main, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const addedWorktree = spawnSync("git", ["worktree", "add", "-q", "-b", "linked", linked], {
    cwd: main,
    encoding: "utf8",
  });
  assert.equal(addedWorktree.status, 0, addedWorktree.stderr);
  write(linked, "src/linked.ts", "export const linked = true;\n");
  assert.equal(listActiveFiles({ root: linked }).includes("src/linked.ts"), true);

  const unsafe = path.join(fixture, "unsafe");
  mkdirSync(unsafe);
  write(unsafe, "src/unsafe.ts", "export const unsafe = true;\n");
  symlinkSync(path.join(main, ".git"), path.join(unsafe, ".git"), "dir");
  assert.throws(() => listActiveFiles({ root: unsafe }), /Local Git metadata is unreadable/);
  rmSync(fixture, { force: true, recursive: true });
});
