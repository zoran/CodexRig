/** Exercises the production local build flow with disposable Git projects and a shared host executable. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { localBuild } from "./local-build.mjs";
import { runProjectCommand } from "../setup/project-command.mjs";
import { cleanGitEnvironment } from "../repository/git-runtime-isolation.mjs";
import {
  prepareProjectToolDirectories,
  projectToolEnvironment,
} from "../repository/project-tool-environment.mjs";

function fixture(t) {
  const parent = mkdtempSync(path.join(os.tmpdir(), "local-build-test-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, "project");
  mkdirSync(root);
  const git = (...args) => {
    const result = spawnSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "-c",
        "commit.gpgSign=false",
        ...args,
      ],
      { cwd: root, env: cleanGitEnvironment(process.env, root), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "--initial-branch=main");
  writeFileSync(path.join(root, ".gitignore"), ".project-state/\n.codex/runtime/\n.auth/\n.env\n");
  writeFileSync(path.join(root, "source.txt"), "committed");
  git("add", ".");
  git("commit", "-m", "fixture");
  const buildState = path.join(root, ".project-state/build");
  const newConfig = (data) =>
    writeFileSync(path.join(buildState, "pipeline.json"), JSON.stringify(data));
  const runCommand = ({ command, args, inherited }) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: root, env: inherited, stdio: "ignore" });
      child.once("error", reject);
      child.once("close", resolve);
    });
  const run = (args, options) =>
    localBuild(args, { root, environment: {}, runCommand, ...options });
  return { parent, root, buildState, git, newConfig, run, runCommand };
}

const nodeStep = (code) => [process.execPath, "-e", code];
const build = nodeStep(
  "const fs = require('fs'); fs.mkdirSync('dist'); fs.writeFileSync('dist/result.json', JSON.stringify({source: fs.readFileSync('source.txt','utf8'), private: fs.existsSync('.env'), git: require('node:child_process').spawnSync('git',['rev-parse','--show-toplevel']).status === 0, jobs: process.env.BUILD_JOBS, make: process.env.MAKEFLAGS, cmake: process.env.CMAKE_BUILD_PARALLEL_LEVEL, cargo: process.env.CARGO_BUILD_JOBS, binary:process.execPath}));",
);

test("the locked shared host environment builds a committed local snapshot and isolates all outputs", async (t) => {
  const f = fixture(t);
  assert.deepEqual(await f.run(["list"]), []);
  assert.equal(existsSync(path.join(f.root, ".project-state")), false);
  assert.deepEqual(await f.run(["init"]), { pipeline: ".project-state/build/pipeline.json" });
  writeFileSync(
    path.join(f.root, ".gitattributes"),
    "source.txt export-ignore\nliteral.txt export-subst\n",
  );
  writeFileSync(path.join(f.root, "literal.txt"), "$Format:%H$");
  f.git("add", ".gitattributes", "literal.txt");
  f.git("commit", "-m", "package exports differ from build inputs");
  const initial = readFileSync(path.join(f.buildState, "pipeline.json"));
  await assert.rejects(f.run(["init"]), /exist/iu);
  assert.deepEqual(readFileSync(path.join(f.buildState, "pipeline.json")), initial);
  const sharedMise = path.join(f.parent, "fixture-mise");
  writeFileSync(
    sharedMise,
    '#!/bin/sh\n[ "$1 $2 $3" = "exec --locked --" ] || exit 66\nshift 3\nexec "$@"\n',
    { mode: 0o700 },
  );
  writeFileSync(path.join(f.root, "source.txt"), "uncommitted");
  writeFileSync(path.join(f.root, ".env"), "private-fixture");
  f.newConfig({
    steps: [
      build,
      nodeStep(
        "if(require('fs').readFileSync('literal.txt','utf8') !== '$Format:%H$') process.exit(31);",
      ),
    ],
    artifacts: ["dist"],
    jobs: 2,
    memoryMiBPerJob: 1,
  });
  const result = await f.run(["run", "--jobs", "1"], {
    runCommand: (options) => runProjectCommand({ ...options, miseExecutable: sharedMise }),
  });
  assert.equal(result.commit, f.git("rev-parse", "HEAD"));
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(f.root, result.artifacts, "dist/result.json"))),
    {
      source: "committed",
      private: false,
      git: false,
      jobs: "1",
      make: "-j1",
      cmake: "1",
      cargo: "1",
      binary: process.execPath,
    },
  );
  assert.equal(existsSync(path.join(f.root, "dist")), false);
  assert.equal(readFileSync(path.join(f.root, "source.txt"), "utf8"), "uncommitted");
  assert.equal(f.git("check-ignore", result.artifacts), result.artifacts);
  assert.deepEqual(await f.run(["list"]), [{ id: result.id, commit: result.commit, jobs: 1 }]);
  if (process.platform === "linux")
    assert.deepEqual(readdirSync(path.join(f.buildState, "work")), []);
});

test("the initialized pnpm pipeline restores a frozen workspace offline and builds its actual dependency", async (t) => {
  const f = fixture(t);
  const sharedMise = path.join(f.parent, "locked-host-mise");
  writeFileSync(
    sharedMise,
    '#!/bin/sh\n[ "$1 $2 $3" = "exec --locked --" ] || exit 66\nshift 3\nexec "$@"\n',
    { mode: 0o700 },
  );
  mkdirSync(path.join(f.root, "lib"));
  writeFileSync(path.join(f.root, "pnpm-workspace.yaml"), "packages:\n  - lib\n");
  writeFileSync(
    path.join(f.root, "package.json"),
    JSON.stringify({
      name: "local-product",
      version: "1.0.0",
      private: true,
      dependencies: { "local-library": "workspace:*" },
      scripts: { build: "node build.cjs" },
    }),
  );
  writeFileSync(
    path.join(f.root, "lib/package.json"),
    JSON.stringify({ name: "local-library", version: "1.0.0", main: "index.cjs" }),
  );
  writeFileSync(
    path.join(f.root, "lib/index.cjs"),
    "module.exports='built offline using the local dependency';",
  );
  writeFileSync(
    path.join(f.root, "build.cjs"),
    "const fs = require('fs'); fs.mkdirSync('dist'); fs.writeFileSync('dist/output', require('local-library')); fs.writeFileSync('dist/store', process.env.PNPM_CONFIG_STORE_DIR);",
  );
  const inherited = { ...process.env, PROJECT_TOOL_STORAGE_HOME: f.parent };
  prepareProjectToolDirectories(f.root, { inherited });
  const isolatedEnv = projectToolEnvironment({ root: f.root, inherited });
  const prepared = spawnSync(
    "pnpm",
    ["install", "--lockfile-only", "--offline", "--ignore-scripts"],
    { cwd: f.root, env: isolatedEnv, encoding: "utf8" },
  );
  assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
  f.git("add", "package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "build.cjs", "lib");
  f.git("commit", "-m", "local offline product");
  await f.run(["init"]);
  const result = await f.run(["run"], {
    runCommand: (options) =>
      runProjectCommand({
        ...options,
        inherited: { ...options.inherited, PROJECT_TOOL_STORAGE_HOME: f.parent },
        miseExecutable: sharedMise,
      }),
  });
  assert.equal(
    readFileSync(path.join(f.root, result.artifacts, "dist/output"), "utf8"),
    "built offline using the local dependency",
  );
  assert.equal(
    readFileSync(path.join(f.root, result.artifacts, "dist/store"), "utf8"),
    isolatedEnv.PNPM_CONFIG_STORE_DIR,
  );
  assert.equal(existsSync(path.join(f.root, "dist")), false);
});

test("a CPU-bound build consumes the effective job budget with real worker threads", async (t) => {
  const f = fixture(t);
  await f.run(["init"]);
  const step = nodeStep(`
    const fs = require('node:fs');
    const {Worker} = require('node:worker_threads');
    const count = Number(process.env.BUILD_JOBS);
    const code = "const {parentPort,threadId}=require('node:worker_threads'); let total=0; for(let i=0;i<100000;i++) total+=Math.sqrt(i); parentPort.postMessage([threadId,total]);";
    Promise.all(Array.from({length: count}, () => new Promise((resolve, reject) => {
      const worker = new Worker(code, {eval:true}); worker.once('message', resolve); worker.once('error', reject);
    }))).then(workers => {fs.mkdirSync('dist'); fs.writeFileSync('dist/workers.json', JSON.stringify(workers));});
  `);
  f.newConfig({ steps: [step], artifacts: ["dist"], jobs: 3 });
  const built = await f.run(["run", "--jobs", "2"]);
  const workers = JSON.parse(readFileSync(path.join(f.root, built.artifacts, "dist/workers.json")));
  assert.ok(built.jobs >= 1 && built.jobs <= 2);
  assert.equal(new Set(workers.map(([id]) => id)).size, built.jobs);
  assert.ok(workers.every(([, result]) => result > 0));
  t.diagnostic(`The local workload ran ${workers.length} CPU worker threads.`);
});

test("the fourth release automatically retires the oldest, and failed work preserves the last successes", async (t) => {
  const f = fixture(t);
  await f.run(["init"]);
  f.newConfig({ steps: [build], artifacts: ["dist"] });
  const built = [];
  for (let i = 0; i < 4; i++) built.push(await f.run(["run"]));
  assert.deepEqual(
    (await f.run(["list"])).map((record) => record.id),
    built
      .slice(1)
      .reverse()
      .map((record) => record.id),
  );
  assert.equal(existsSync(path.join(f.root, built[0].artifacts)), false);
  f.newConfig({ steps: [nodeStep("process.exit(17)")], artifacts: ["dist"] });
  await assert.rejects(f.run(["run"]), (error) => error.exitCode === 17);
  f.newConfig({ steps: [nodeStep("process.exit(0)")], artifacts: ["missing"] });
  await assert.rejects(f.run(["run"]), /missing|ENOENT/u);
  assert.equal((await f.run(["list"])).length, 3);
  await f.run(["clean"]);
  if (process.platform === "linux")
    assert.deepEqual(readdirSync(path.join(f.buildState, "work")), []);
});

test("concurrent builds and housekeeping keep live work and exactly three completed releases", async (t) => {
  const f = fixture(t);
  await f.run(["init"]);
  f.newConfig({ steps: [build], artifacts: ["dist"] });
  let ready, resume;
  const started = new Promise((resolve) => {
    ready = resolve;
  });
  const paused = new Promise((resolve) => {
    resume = resolve;
  });
  const inFlight = f.run(["run"], {
    runCommand: async (options) => {
      ready();
      await paused;
      return f.runCommand(options);
    },
  });
  try {
    await started;
    const current = readdirSync(path.join(f.buildState, "work"));
    assert.equal(current.length, 1);
    await f.run(["clean"]);
    assert.ok(existsSync(path.join(f.buildState, "work", current[0], "files/source/source.txt")));
    const runner = new URL("./local-build.mjs", import.meta.url).href;
    const projectCommand = new URL("../setup/project-command.mjs", import.meta.url).href;
    const mise = path.join(f.parent, "shared-fixture-mise");
    writeFileSync(
      mise,
      '#!/bin/sh\n[ "$1 $2 $3" = "exec --locked --" ] || exit 66\nshift 3\nexec "$@"\n',
      { mode: 0o700 },
    );
    const anotherProcess = new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import {localBuild} from ${JSON.stringify(runner)}; import {runProjectCommand} from ${JSON.stringify(projectCommand)}; await localBuild(['run'],{root:process.argv[1],environment:{},runCommand:options=>runProjectCommand({...options,miseExecutable:process.argv[2]})});`,
          f.root,
          mise,
        ],
        { cwd: f.root, stdio: ["ignore", "ignore", "inherit"] },
      );
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`Concurrent build exited ${code}.`)),
      );
    });
    await Promise.all([anotherProcess, f.run(["run"]), f.run(["run"])]);
  } finally {
    resume();
    await inFlight;
  }
  const latest = await inFlight;
  const listed = await f.run(["list"]);
  assert.equal(listed.length, 3);
  assert.equal(listed[0].id, latest.id);
  assert.equal(new Set(listed.map(({ id }) => id)).size, 3);
});

test(
  "a later build automatically collects proven abandoned scratch and leaves unrelated files alone",
  { skip: process.platform !== "linux" },
  async (t) => {
    const f = fixture(t);
    await f.run(["init"]);
    const work = path.join(f.buildState, "work");
    mkdirSync(work, { mode: 0o700 });
    const ownerModule = new URL("../repository/project-temporary-storage.mjs", import.meta.url)
      .href;
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { createProjectTemporaryScope } from ${JSON.stringify(ownerModule)}; import {writeFileSync} from 'node:fs'; import path from 'node:path'; const scope = createProjectTemporaryScope({root:process.argv[1],parent:process.argv[2]}); writeFileSync(path.join(scope.directory, 'unfinished'), 'partial'); console.log(scope.directory);`,
        f.root,
        work,
      ],
      { encoding: "utf8", cwd: f.root },
    );
    assert.equal(child.status, 0, child.stderr);
    const orphan = child.stdout.trim();
    assert.ok(existsSync(path.join(orphan, "unfinished")));
    const unmanaged = path.join(work, "operator-file");
    writeFileSync(unmanaged, "preserve");
    f.newConfig({ steps: [build], artifacts: ["dist"] });
    await f.run(["run"]);
    assert.equal(existsSync(orphan), false);
    assert.equal(readFileSync(unmanaged, "utf8"), "preserve");
  },
);

test("provider execution, path escapes, unowned releases and dirty tool pins fail before reuse or deletion", async (t) => {
  const f = fixture(t);
  for (const environment of [
    { GITHUB_ACTIONS: "true" },
    { GITLAB_CI: "true" },
    { BITBUCKET_PIPELINE_UUID: "fixture" },
  ])
    await assert.rejects(f.run(["init"], { environment }), /provider CI/u);
  assert.equal(existsSync(f.buildState), false);
  // A noninteractive local scheduler can set CI without belonging to a hosted build service.
  await f.run(["init"], { environment: { CI: "true" } });
  for (const artifact of ["../outside", "/absolute", "a\\b", "a/.git", ".auth/account", ".env"]) {
    f.newConfig({ steps: [build], artifacts: [artifact] });
    await assert.rejects(f.run(["run"]), /relative|public/u);
  }
  f.newConfig({
    steps: [
      nodeStep("require('fs').mkdirSync('dist');require('fs').symlinkSync('/tmp','dist/foreign')"),
    ],
    artifacts: ["dist"],
  });
  await assert.rejects(f.run(["run"]), /outside/u);
  symlinkSync(f.parent, path.join(f.root, "escaped"));
  f.git("add", "escaped");
  f.git("commit", "-m", "unsafe source");
  await assert.rejects(f.run(["run"]), /outside/u);
  f.git("rm", "escaped");
  f.git("commit", "-m", "safe source");
  mkdirSync(path.join(f.root, "infra"));
  const privateState = "infra/terraform.tfstate.backup";
  writeFileSync(path.join(f.root, privateState), "private fixture");
  f.git("add", "-f", privateState);
  f.git("commit", "-m", "forced private state");
  await assert.rejects(f.run(["run"]), /private build input/u);
  f.git("rm", privateState);
  f.git("commit", "-m", "public source");
  writeFileSync(path.join(f.root, ".codex/mise.toml"), "fixture");
  f.newConfig({ steps: [build], artifacts: ["dist"] });
  await assert.rejects(f.run(["run"]), /Commit the current toolchain pin/u);
  const outside = path.join(f.parent, "keep");
  mkdirSync(outside);
  writeFileSync(path.join(outside, "sentinel"), "preserve");
  symlinkSync(outside, path.join(f.buildState, "releases/r-00000000000001-deadbeefdead"));
  await assert.rejects(f.run(["clean"]), /unsafe|malformed/iu);
  assert.equal(readFileSync(path.join(outside, "sentinel"), "utf8"), "preserve");
});
