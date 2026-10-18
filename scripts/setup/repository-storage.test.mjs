/** Exercises storage-pressure recovery without touching the host Docker daemon or user data. */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs, {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runStorageHousekeeping } from "../repository/repository-storage.mjs";
import { maintainToolchain } from "../deps/maintain-toolchain.mjs";
import { toolchainMaintenanceInputs } from "../deps/toolchain-maintenance-inputs.mjs";
import { inspectRuntimeLifecycleLock } from "../repository/runtime-session-lease.mjs";
import { spawnSyncWithBoundedIo } from "../repository/runtime-process-io.mjs";

import { toolingRoot } from "../filesystem/repository-files.mjs";
import { importSpecifiersForFile } from "../repository/source-import-specifiers.mjs";

const gib = 1024n ** 3n;
function capacity(available, { device = 1n, reserved = 5n } = {}) {
  return {
    device,
    totalBytes: 100n * gib,
    availableBytes: BigInt(available) * gib,
    freeBytes: (BigInt(available) + reserved) * gib,
  };
}
function scenario({ initial = 1, after = 4, dockerDevice = 1n, failPrune = false } = {}) {
  const calls = [],
    messages = [];
  let pruned = false;
  return {
    calls,
    messages,
    dependencies: {
      log: (message) => messages.push(message),
      readCapacity: (root) =>
        capacity(pruned ? after : initial, {
          device: root === "/docker-data" ? dockerDevice : 1n,
        }),
      docker: (root, args) => {
        calls.push({ root, args });
        if (args[0] === "info") return '"/docker-data"';
        if (failPrune) throw new Error("Docker prune timed out");
        pruned = true;
        return "Total: 999GB"; // Success is determined from the filesystem, never this claim.
      },
    },
  };
}

test("startup admits 7.6 GiB on a large filesystem without running Docker", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "storage-startup-admission-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(
    toolchainMaintenanceInputs(toolingRoot).contents,
  )) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), content);
  }
  const matrix = JSON.parse(readFileSync(path.join(root, ".codex/toolchain.json"), "utf8"));
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "storage-startup-fixture",
      private: true,
      packageManager: `pnpm@${matrix.stable.pnpm.version}`,
      devDependencies: {},
    }),
  );
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: []\n");
  writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  const bin = path.join(root, "bin");
  const record = path.join(root, "docker-calls");
  mkdirSync(bin);
  writeFileSync(
    path.join(bin, "docker"),
    `#!${process.execPath}
import {appendFileSync} from "node:fs";
appendFileSync(${JSON.stringify(record)}, "call\\n");
process.exitCode = 97;
`,
    { mode: 0o700 },
  );
  // Exercise the shipped default composition; only the filesystem and Docker boundaries are fake.
  const filesystem = t.mock.method(fs, "statfsSync", () => ({
    bsize: 1n,
    blocks: 467n * gib,
    bavail: (76n * gib) / 10n,
    bfree: (126n * gib) / 10n,
  }));
  syncBuiltinESMExports();
  const inheritedPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${inheritedPath ?? ""}`;
  const reachedReleaseBoundary = new Error("release discovery reached");
  let resolverCalls = 0,
    installerCalls = 0;
  try {
    await assert.rejects(
      maintainToolchain({
        root,
        startup: true,
        candidateResolver() {
          resolverCalls++;
          throw reachedReleaseBoundary;
        },
        installBootstrapTools() {
          installerCalls++;
          throw new Error("unexpected installation");
        },
      }),
      (error) => error === reachedReleaseBoundary,
    );
  } finally {
    filesystem.mock.restore();
    syncBuiltinESMExports();
    if (inheritedPath === undefined) delete process.env.PATH;
    else process.env.PATH = inheritedPath;
  }
  const dockerCalls = existsSync(record)
    ? readFileSync(record, "utf8").trim().split("\n").length
    : 0;
  assert.equal(dockerCalls, 0);
  assert.equal(resolverCalls, 1);
  assert.equal(installerCalls, 0);
  assert.equal(inspectRuntimeLifecycleLock({ root }).status, "absent");
});

test("healthy storage, including the boundary, never invokes Docker in either mode", () => {
  for (const apply of [false, true]) {
    for (const initial of [2, 7, 72]) {
      const fixture = scenario({ initial });
      const result = runStorageHousekeeping({ root: "/repository", apply }, fixture.dependencies);
      assert.equal(result.cleaned, false);
      assert.equal(fixture.calls.length, 0);
      assert.match(fixture.messages.join("\n"), /available/u);
    }
  }
});

test("low-space check fails before any Docker operation", () => {
  const fixture = scenario();
  assert.throws(
    () => runStorageHousekeeping({ root: "/repository", apply: false }, fixture.dependencies),
    /below the required 2\.0 GiB.*--apply/u,
  );
  assert.deepEqual(fixture.calls, []);
});

test("apply targets build cache only and accounts for filesystem-reserved blocks", () => {
  const fixture = scenario();
  const result = runStorageHousekeeping({ root: "/repository", apply: true }, fixture.dependencies);
  assert.equal(result.cleaned, true);
  assert.equal(result.after.availableBytes, 4n * gib);
  assert.deepEqual(fixture.calls, [
    { root: "/repository", args: ["info", "--format", "{{json .DockerRootDir}}"] },
    {
      root: "/repository",
      args: [
        "buildx",
        "prune",
        "--builder",
        "default",
        "--force",
        "--min-free-space",
        String(8n * gib),
      ],
    },
  ]);
  assert.match(fixture.messages.join("\n"), /3\.0 GiB/u);
  assert.doesNotMatch(fixture.messages.join("\n"), /999/u);
});

test("a different Docker filesystem is preserved", () => {
  const fixture = scenario({ dockerDevice: 2n });
  assert.throws(
    () => runStorageHousekeeping({ root: "/repository", apply: true }, fixture.dependencies),
    /different filesystem/u,
  );
  assert.equal(fixture.calls.length, 1);
});

test("unsuccessful native cleanup and insufficient recovery never report success or retry", () => {
  for (const options of [{ failPrune: true }, { after: 0 }, { after: 1 }]) {
    const fixture = scenario(options);
    assert.throws(
      () => runStorageHousekeeping({ root: "/repository", apply: true }, fixture.dependencies),
      /timed out|required 2\.0 GiB/u,
    );
    assert.equal(fixture.calls.length, 2);
  }
});

test("restoring the required minimum admits work even below the additional cleanup target", () => {
  const fixture = scenario({ after: 2 });
  const result = runStorageHousekeeping({ root: "/repository", apply: true }, fixture.dependencies);
  assert.equal(result.after.availableBytes, 2n * gib);
  assert.equal(fixture.calls.length, 2, "one recovery only, without a retry to reach the target");
  assert.match(fixture.messages.join("\n"), /Required storage reserve restored/u);
});

test("separate installation storage cannot borrow free space from a healthy repository", () => {
  const fixture = scenario();
  fixture.dependencies.readCapacity = (location) =>
    capacity(location === "/repository" ? 20 : 1, {
      device: location === "/shared-tools" ? 2n : 1n,
    });
  assert.throws(
    () =>
      runStorageHousekeeping(
        {
          root: "/repository",
          storagePaths: ["/shared-tools"],
          apply: true,
        },
        fixture.dependencies,
      ),
    /different filesystem/u,
  );
  assert.equal(fixture.calls.length, 1, "do not prune the healthy unrelated Docker filesystem");
});

test("one collector recovers the actual deficient storage filesystem without duplicate pruning", () => {
  const fixture = scenario();
  fixture.dependencies.readCapacity = (location) =>
    capacity(location === "/repository" ? 20 : fixture.calls.length > 1 ? 2 : 1, {
      device: location === "/repository" ? 1n : 2n,
    });
  const result = runStorageHousekeeping(
    {
      root: "/repository",
      storagePaths: ["/shared-tools", "/shared-cache"],
      apply: true,
    },
    fixture.dependencies,
  );
  assert.equal(fixture.calls.length, 2);
  assert.equal(result.filesystems.length, 2);
  assert.equal(result.filesystems[1].after.availableBytes, 2n * gib);
});

test("unavailable Docker and invalid data roots fail without a prune", () => {
  for (const output of ["not json", '"relative/path"', "null"]) {
    const fixture = scenario();
    fixture.dependencies.docker = (root, args) => {
      assert.equal(args[0], "info");
      return output;
    };
    assert.throws(() =>
      runStorageHousekeeping({ root: "/repository", apply: true }, fixture.dependencies),
    );
  }
  const fixture = scenario();
  fixture.dependencies.docker = () => {
    throw new Error("Docker unavailable");
  };
  assert.throws(
    () => runStorageHousekeeping({ root: "/repository", apply: true }, fixture.dependencies),
    /Docker unavailable/u,
  );
});

test("the real housekeeping check entry rejects storage pressure before repository mutations", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "project-storage-entry-"));
  const preload = path.join(root, "capacity.mjs");
  try {
    writeFileSync(
      preload,
      `import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
fs.statfsSync = () => ({bsize: 1n, blocks: 100n, bfree: 6n, bavail: 1n});
syncBuiltinESMExports();
`,
    );
    for (const args of [[], ["--check"]]) {
      const result = spawnSyncWithBoundedIo(
        process.execPath,
        [
          "--import",
          preload,
          fileURLToPath(new URL("../goals/repository-housekeeping.mjs", import.meta.url)),
          ...args,
        ],
        { cwd: root, encoding: "utf8", input: "", timeout: 10_000 },
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Repository storage.*below the required 2\.0 GiB/u);
      assert.match(result.stdout, /Repository storage.*available/u);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "native adapter pins the local daemon and strips ambient account and builder controls",
  {
    skip: process.platform === "win32",
  },
  () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "project-storage-safety-"));
    const bin = path.join(root, "bin"),
      record = path.join(root, "calls.jsonl");
    const inherited = {
      PATH: process.env.PATH,
      DOCKER_HOST: process.env.DOCKER_HOST,
      DOCKER_CONTEXT: process.env.DOCKER_CONTEXT,
      BUILDX_BUILDER: process.env.BUILDX_BUILDER,
      DOCKER_CONFIG: process.env.DOCKER_CONFIG,
    };
    try {
      mkdirSync(bin);
      writeFileSync(
        path.join(bin, "docker"),
        `#!${process.execPath}
import {appendFileSync} from "node:fs";
appendFileSync(${JSON.stringify(record)}, JSON.stringify({
  args: process.argv.slice(2), home: process.env.HOME, config: process.env.DOCKER_CONFIG,
  host: process.env.DOCKER_HOST, context: process.env.DOCKER_CONTEXT, builder: process.env.BUILDX_BUILDER,
}) + "\\n");
console.log(JSON.stringify("/docker-data"));
`,
        { mode: 0o700 },
      );
      process.env.PATH = `${bin}${path.delimiter}${inherited.PATH ?? ""}`;
      process.env.DOCKER_HOST = "tcp://foreign.invalid:2375";
      process.env.DOCKER_CONTEXT = "production";
      process.env.BUILDX_BUILDER = "foreign-builder";
      process.env.DOCKER_CONFIG = "/foreign-account";
      let reads = 0;
      runStorageHousekeeping(
        { root, apply: true },
        {
          log: () => {},
          readCapacity: () => capacity(++reads <= 2 ? 1 : 4),
        },
      );
      const calls = readFileSync(record, "utf8").trim().split("\n").map(JSON.parse);
      assert.equal(calls.length, 2);
      for (const call of calls) {
        assert.deepEqual(call.args.slice(0, 2), ["--host", "unix:///var/run/docker.sock"]);
        assert.equal(call.host, undefined);
        assert.equal(call.context, undefined);
        assert.equal(call.builder, undefined);
        assert.ok(call.home.startsWith(root + path.sep));
        assert.ok(call.config.startsWith(root + path.sep));
      }
      assert.deepEqual(calls[1].args.slice(2, 7), [
        "buildx",
        "prune",
        "--builder",
        "default",
        "--force",
      ]);
    } finally {
      for (const [key, value] of Object.entries(inherited)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("toolchain admission performs one capacity recovery and stops before downloads when reserve remains insufficient", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "storage-before-install-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fixture = scenario({ initial: 0, after: 1 });
  let resolverCalls = 0,
    installerCalls = 0;
  await assert.rejects(
    maintainToolchain({
      root,
      locked: true,
      prepareStorage: (options) => runStorageHousekeeping(options, fixture.dependencies),
      candidateResolver: () => {
        resolverCalls++;
        throw new Error("unexpected release lookup");
      },
      installBootstrapTools: () => {
        installerCalls++;
        throw new Error("unexpected download");
      },
    }),
    /required 2\.0 GiB/u,
  );
  assert.equal(fixture.calls.length, 2, "one native info and one collector call");
  assert.equal(resolverCalls, 0);
  assert.equal(installerCalls, 0);
  assert.equal(inspectRuntimeLifecycleLock({ root }).status, "absent");
});

test("full apply reclaims dead execution scratch before unresolved capacity stops later work", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "storage-apply-entry-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const entry = "scripts/goals/repository-housekeeping.mjs";
  const pending = [entry],
    copied = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (copied.has(file)) continue;
    copied.add(file);
    assert.ok(copied.size < 256, "Fixture copies only the bounded actual entry closure");
    assert.ok(!file.startsWith("../") && !path.isAbsolute(file));
    const content = readFileSync(path.join(toolingRoot, file), "utf8");
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    for (const specifier of importSpecifiersForFile({ content, relativePath: file }))
      if (specifier.startsWith("."))
        pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)));
  }
  symlinkSync(path.join(toolingRoot, "node_modules"), path.join(root, "node_modules"), "dir");
  const producer = spawnSyncWithBoundedIo(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import {prepareProjectToolDirectories} from ${JSON.stringify(pathToFileURL(path.join(root, "scripts/repository/project-tool-environment.mjs")).href)};
    import {createProjectTemporaryScope} from ${JSON.stringify(pathToFileURL(path.join(root, "scripts/repository/project-temporary-storage.mjs")).href)};
    import {writeFileSync} from "node:fs";
    const root=process.cwd(), locations=prepareProjectToolDirectories(root);
    const scope=createProjectTemporaryScope({root,parent:locations.temporary});
    writeFileSync(scope.directory+"/scratch","disposable");
    process.stdout.write(scope.directory);
  `,
    ],
    { cwd: root, encoding: "utf8", input: "", timeout: 10_000 },
  );
  assert.equal(producer.status, 0, producer.stderr);
  assert.ok(existsSync(producer.stdout));
  // The bounded-I/O supervisor starts Docker in another process, beyond an in-process spawn mock.
  // Bind the executable boundary itself so this low-space fixture cannot reach the host daemon.
  const bin = path.join(root, "bin");
  const dockerCalls = path.join(root, "docker-calls.jsonl");
  mkdirSync(bin);
  writeFileSync(
    path.join(bin, "docker"),
    `#!${process.execPath}
import {appendFileSync} from "node:fs";
appendFileSync(${JSON.stringify(dockerCalls)}, JSON.stringify(process.argv.slice(2)) + "\\n");
process.stderr.write("fixture Docker unavailable\\n");
process.exitCode = 1;
`,
    { mode: 0o700 },
  );
  const preload = path.join(root, "external-boundaries.mjs");
  writeFileSync(
    preload,
    `
    import fs from "node:fs";
    import {syncBuiltinESMExports} from "node:module";
    fs.statfsSync=()=>({bsize:1n,blocks:100n,bfree:6n,bavail:1n});
    syncBuiltinESMExports();
  `,
  );
  const result = spawnSyncWithBoundedIo(process.execPath, ["--import", preload, entry, "--apply"], {
    cwd: root,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` },
    encoding: "utf8",
    input: "",
    timeout: 20_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /fixture Docker unavailable/u);
  assert.deepEqual(readFileSync(dockerCalls, "utf8").trim().split("\n").map(JSON.parse), [
    ["--host", "unix:///var/run/docker.sock", "info", "--format", "{{json .DockerRootDir}}"],
  ]);
  assert.equal(
    existsSync(producer.stdout),
    false,
    "Pressure must not prevent safe scratch cleanup",
  );
  assert.match(result.stdout, /"removed":1/u);
  assert.doesNotMatch(result.stdout, /housekeeping passed/u);
});
