/** Owns compatible installation test cases behavior for the dependency and toolchain maintenance boundary. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { test } from "node:test";
import {
  compatibleInstallArgs,
  compatibleUpdateArgs,
  installLatestCompatibleDependencies,
  reproduceLockedDependencies,
  stageDependencyInstallationInputs,
} from "./install-compatible.mjs";
import { trustedPnpmCommand } from "./trusted-pnpm-command.mjs";

function compatibleInstallFixture(transactionFixture) {
  const root = transactionFixture();
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
  const manifestPath = path.join(root, "package.json");
  return {
    root,
    manifestPath,
    lockfilePath: path.join(root, "pnpm-lock.yaml"),
    manifests: [
      {
        relativePath: "package.json",
        workspacePath: ".",
        name: "transaction-fixture",
        data: JSON.parse(readFileSync(manifestPath, "utf8")),
      },
    ],
  };
}

function compatiblePnpmFixture(fixture, options = {}) {
  const calls = [];
  return {
    calls,
    spawnPnpm(executable, args, spawnOptions) {
      calls.push({
        executable,
        args,
        cwd: spawnOptions.cwd,
        ignorePnpmfile: spawnOptions.env?.pnpm_config_ignore_pnpmfile,
      });
      if (args[0] === "store") {
        return {
          status: options.storeStatus ?? 0,
          stdout: options.storeDirectory ?? "",
          stderr: "",
        };
      }
      if (args[0] === "update") {
        if (options.mutateStage) {
          const stagePath = path.join(spawnOptions.cwd, options.mutateStage);
          writeFileSync(stagePath, `${readFileSync(stagePath, "utf8")}\n`, "utf8");
        }
        if (options.mutateSource) {
          const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8"));
          manifest.description = "concurrent edit";
          writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        }
        if (options.createPnpmHook) {
          writeFileSync(path.join(fixture.root, ".pnpmfile.cjs"), "module.exports = {};\n", "utf8");
        }
        if (options.updateStatus) return { status: options.updateStatus, stdout: "", stderr: "" };
        writeFileSync(
          path.join(spawnOptions.cwd, "pnpm-lock.yaml"),
          "lockfileVersion: '9.0'\nfixture: refreshed\n",
          "utf8",
        );
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "install") {
        if (options.mutateSourceOnInstall) {
          const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8"));
          manifest.description = "edit during frozen install";
          writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        }
        return {
          status: options.installStatus ?? 0,
          stdout: options.installStdout ?? "",
          stderr: options.installStderr ?? "",
        };
      }
      throw new Error(`Unexpected pnpm command: ${args.join(" ")}`);
    },
  };
}

export function registerCompatibleInstallationTests(transactionFixture) {
  for (const stagedInput of ["package.json", "pnpm-workspace.yaml"]) {
    test(`compatible resolution refuses staged ${stagedInput} edits before publishing or installing`, () => {
      const fixture = compatibleInstallFixture(transactionFixture);
      const original = readFileSync(fixture.lockfilePath, "utf8");
      const pnpm = compatiblePnpmFixture(fixture, { mutateStage: stagedInput });
      assert.throws(
        () =>
          installLatestCompatibleDependencies({
            projectRoot: fixture.root,
            spawnPnpm: pnpm.spawnPnpm,
          }),
        /changed/u,
      );
      assert.equal(pnpm.calls.length, 1);
      assert.equal(readFileSync(fixture.lockfilePath, "utf8"), original);
    });
  }

  test("native pnpm stages strict-policy packages into the final root's store for offline use", async (t) => {
    const target = transactionFixture();
    const packageDirectory = path.join(target, "archive", "package");
    mkdirSync(packageDirectory, { recursive: true });
    const archives = {};
    for (const version of ["1.0.0", "1.1.0"]) {
      writeFileSync(
        path.join(packageDirectory, "package.json"),
        JSON.stringify({
          name: "store-fixture",
          version,
          main: "index.js",
          scripts: { postinstall: "node -e 'process.exit(99)'" },
        }),
      );
      writeFileSync(
        path.join(packageDirectory, "index.js"),
        'module.exports = "offline fixture";\n',
      );
      const tarball = path.join(target, `${version}.tgz`);
      const packed = spawnSync("tar", [
        "-czf",
        tarball,
        "-C",
        path.dirname(packageDirectory),
        "package",
      ]);
      assert.equal(packed.status, 0, String(packed.stderr));
      const bytes = readFileSync(tarball);
      archives[version] = {
        bytes,
        integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
      };
    }
    const registry = new Worker(
      `
      const { parentPort, workerData } = require("node:worker_threads");
      const { createServer } = require("node:http");
      let latest = "1.0.0";
      parentPort.on("message", (version) => { latest = version; parentPort.postMessage("advanced"); });
      const server = createServer((request, response) => {
        const archive = workerData.archives[request.url.slice(1).replace(/\\.tgz$/, "")];
        if (archive) return response.end(Buffer.from(archive.bytes));
        const versions = Object.fromEntries(Object.entries(workerData.archives)
          .filter(([version]) => version <= latest).map(([version, archive]) => [version, {
            name: "store-fixture", version, dist: {
              tarball: "http://127.0.0.1:" + server.address().port + "/" + version + ".tgz",
              integrity: archive.integrity,
            },
          }]));
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ name: "store-fixture", "dist-tags": { latest }, versions,
          time: { "1.0.0": "2020-01-01T00:00:00.000Z", "1.1.0": "2020-02-01T00:00:00.000Z" } }));
      });
      server.listen(0, "127.0.0.1", () => parentPort.postMessage(server.address().port));
    `,
      {
        eval: true,
        workerData: { archives },
      },
    );
    t.after(() => registry.terminate());
    const [port] = await once(registry, "message");
    const packageJson = JSON.stringify({
      name: "store-consumer",
      private: true,
      dependencies: { "store-fixture": "^1.0.0" },
    });
    writeFileSync(path.join(target, "package.json"), packageJson);
    writeFileSync(
      path.join(target, "pnpm-workspace.yaml"),
      [
        "packages: []",
        "storeDir: './package store'",
        `cacheDir: ${JSON.stringify(path.join(target, "metadata cache"))}`,
        `registry: 'http://127.0.0.1:${port}'`,
        "minimumReleaseAge: 1440",
        "minimumReleaseAgeStrict: true",
        "ignorePnpmfile: true",
        "pnpmfile: []",
        "",
      ].join("\n"),
    );
    rmSync(path.join(target, "pnpm-lock.yaml"));
    const pnpm = trustedPnpmCommand({ repositoryRoot: target });
    const initial = spawnSync(
      pnpm.executable,
      ["install", "--lockfile-only", "--ignore-scripts", "--ignore-pnpmfile"],
      {
        cwd: target,
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    assert.equal(initial.status, 0, initial.stderr || initial.stdout);
    registry.postMessage("1.1.0");
    await once(registry, "message");
    rmSync(path.join(target, "metadata cache"), { recursive: true, force: true });
    const unbound = transactionFixture();
    stageDependencyInstallationInputs({ projectRoot: target, stageRoot: unbound });
    installLatestCompatibleDependencies({ projectRoot: unbound });
    writeFileSync(
      path.join(target, "pnpm-lock.yaml"),
      readFileSync(path.join(unbound, "pnpm-lock.yaml")),
    );
    assert.throws(
      () => reproduceLockedDependencies({ projectRoot: target }),
      /ERR_PNPM_NO_OFFLINE_TARBALL/u,
    );

    const bound = transactionFixture();
    stageDependencyInstallationInputs({ projectRoot: target, stageRoot: bound });
    installLatestCompatibleDependencies({ projectRoot: bound, installationRoot: target });
    writeFileSync(
      path.join(target, "pnpm-lock.yaml"),
      readFileSync(path.join(bound, "pnpm-lock.yaml")),
    );
    await registry.terminate();
    const lockfile = readFileSync(path.join(target, "pnpm-lock.yaml"), "utf8");
    assert.deepEqual(reproduceLockedDependencies({ projectRoot: target }), {
      lockfileUpdated: false,
      manifestCount: 1,
    });
    assert.equal(readFileSync(path.join(target, "pnpm-lock.yaml"), "utf8"), lockfile);
    assert.equal(
      JSON.parse(readFileSync(path.join(target, "node_modules/store-fixture/package.json"), "utf8"))
        .version,
      "1.1.0",
    );
    assert.equal(readFileSync(path.join(target, "package.json"), "utf8"), packageJson);
    assert.match(
      readFileSync(path.join(target, "node_modules/store-fixture/index.js"), "utf8"),
      /offline fixture/u,
    );
  });

  test("toolchain staging fills the target installation store across filesystem boundaries", () => {
    const fixture = compatibleInstallFixture(transactionFixture);
    const target = compatibleInstallFixture(transactionFixture);
    const storeDirectory = path.join(target.root, "target store", "v11");
    const pnpm = compatiblePnpmFixture(fixture, { storeDirectory });
    installLatestCompatibleDependencies({
      projectRoot: fixture.root,
      installationRoot: target.root,
      spawnPnpm: pnpm.spawnPnpm,
    });
    assert.deepEqual(pnpm.calls[0].args, ["store", "path"]);
    assert.equal(pnpm.calls[0].cwd, target.root);
    for (const call of pnpm.calls.slice(1)) {
      assert.deepEqual(call.args.slice(-2), ["--store-dir", storeDirectory]);
    }
    assert.equal(pnpm.calls.length, 3);
  });

  for (const storeDirectory of ["", "relative/store", "/one\n/two"]) {
    test(`toolchain staging rejects an invalid target store: ${JSON.stringify(storeDirectory)}`, () => {
      const fixture = compatibleInstallFixture(transactionFixture);
      const pnpm = compatiblePnpmFixture(fixture, { storeDirectory });
      assert.throws(
        () =>
          installLatestCompatibleDependencies({
            projectRoot: fixture.root,
            installationRoot: fixture.root,
            spawnPnpm: pnpm.spawnPnpm,
          }),
        /store path/u,
      );
      assert.equal(pnpm.calls.length, 1);
      assert.match(readFileSync(fixture.lockfilePath, "utf8"), /fixture: old/u);
    });
  }

  test("failed reproduction retains sanitized package-manager diagnostics", () => {
    const fixture = compatibleInstallFixture(transactionFixture);
    const pnpm = compatiblePnpmFixture(fixture, {
      installStatus: 1,
      installStdout: `${"Progress output. ".repeat(100)}\nERR_PNPM_OFFLINE_META_MISSING Required package metadata is absent.`,
      installStderr: "token=private-fixture-value\n\u001b[31mRegistry request failed\u001b[0m",
    });
    assert.throws(
      () => reproduceLockedDependencies({ projectRoot: fixture.root, spawnPnpm: pnpm.spawnPnpm }),
      (error) => {
        assert.match(error.message, /ERR_PNPM_OFFLINE_META_MISSING/u);
        assert.match(error.message, /Registry request failed/u);
        assert.doesNotMatch(error.message, /private-fixture-value|\u001b/u);
        return true;
      },
    );
  });

  test("locked reproduction is offline, preserves inputs, and releases dependency ownership", () => {
    const fixture = compatibleInstallFixture(transactionFixture);
    const originalManifest = readFileSync(fixture.manifestPath, "utf8");
    const originalLockfile = readFileSync(fixture.lockfilePath, "utf8");
    const pnpm = compatiblePnpmFixture(fixture);
    assert.deepEqual(
      reproduceLockedDependencies({ projectRoot: fixture.root, spawnPnpm: pnpm.spawnPnpm }),
      { lockfileUpdated: false, manifestCount: 1 },
    );
    assert.equal(pnpm.calls.length, 1);
    assert.deepEqual(pnpm.calls[0].args, [...compatibleInstallArgs, "--offline"]);
    assert.equal(pnpm.calls[0].ignorePnpmfile, "true");
    assert.equal(pnpm.calls[0].cwd, fixture.root);
    assert.equal(readFileSync(fixture.manifestPath, "utf8"), originalManifest);
    assert.equal(readFileSync(fixture.lockfilePath, "utf8"), originalLockfile);
    assert.equal(existsSync(path.join(fixture.root, ".project-state")), false);
  });

  test("locked reproduction reports failure without changing the lockfile or resolving versions", () => {
    const fixture = compatibleInstallFixture(transactionFixture);
    const originalLockfile = readFileSync(fixture.lockfilePath, "utf8");
    const pnpm = compatiblePnpmFixture(fixture, { installStatus: 1 });
    assert.throws(
      () => reproduceLockedDependencies({ projectRoot: fixture.root, spawnPnpm: pnpm.spawnPnpm }),
      /reproduction.*failed.*Installation is incomplete/u,
    );
    assert.equal(pnpm.calls.length, 1);
    assert.equal(readFileSync(fixture.lockfilePath, "utf8"), originalLockfile);
    assert.equal(existsSync(path.join(fixture.root, ".project-state")), false);
  });

  test("locked reproduction rejects concurrent manifest changes without overwriting them", () => {
    const fixture = compatibleInstallFixture(transactionFixture);
    const pnpm = compatiblePnpmFixture(fixture, { mutateSourceOnInstall: true });
    assert.throws(
      () => reproduceLockedDependencies({ projectRoot: fixture.root, spawnPnpm: pnpm.spawnPnpm }),
      /plan is stale because package\.json changed/u,
    );
    assert.equal(
      JSON.parse(readFileSync(fixture.manifestPath, "utf8")).description,
      "edit during frozen install",
    );
    assert.equal(existsSync(path.join(fixture.root, ".project-state")), false);
  });

  test("compatible installation stages registry freshness before a frozen install", () => {
    const fixture = compatibleInstallFixture(transactionFixture);
    const originalManifest = readFileSync(fixture.manifestPath, "utf8");
    const pnpm = compatiblePnpmFixture(fixture);
    const result = installLatestCompatibleDependencies({
      projectRoot: fixture.root,
      manifests: fixture.manifests,
      spawnPnpm: pnpm.spawnPnpm,
    });

    assert.deepEqual(result, { lockfileUpdated: true, manifestCount: 1 });
    assert.deepEqual(
      pnpm.calls.map(({ executable, args, cwd, ignorePnpmfile }) => ({
        executable,
        args,
        ignorePnpmfile,
        scope: cwd === fixture.root ? "project" : "stage",
      })),
      [
        {
          executable: "pnpm",
          args: compatibleUpdateArgs,
          ignorePnpmfile: "true",
          scope: "stage",
        },
        {
          executable: "pnpm",
          args: compatibleInstallArgs,
          ignorePnpmfile: "true",
          scope: "project",
        },
      ],
    );
    assert.equal(readFileSync(fixture.manifestPath, "utf8"), originalManifest);
    assert.match(readFileSync(fixture.lockfilePath, "utf8"), /fixture: refreshed/);
    assert.equal(existsSync(path.join(fixture.root, ".project-state")), false);
  });

  test("compatible installation leaves durable inputs unchanged when registry freshness is unknown", () => {
    const fixture = compatibleInstallFixture(transactionFixture);
    const originalManifest = readFileSync(fixture.manifestPath, "utf8");
    const originalLockfile = readFileSync(fixture.lockfilePath, "utf8");
    const pnpm = compatiblePnpmFixture(fixture, { updateStatus: 1 });

    assert.throws(
      () =>
        installLatestCompatibleDependencies({
          projectRoot: fixture.root,
          manifests: fixture.manifests,
          spawnPnpm: pnpm.spawnPnpm,
        }),
      /freshness is indeterminate.*durable project inputs were left unchanged/i,
    );
    assert.equal(readFileSync(fixture.manifestPath, "utf8"), originalManifest);
    assert.equal(readFileSync(fixture.lockfilePath, "utf8"), originalLockfile);
    assert.equal(pnpm.calls.length, 1);
    assert.equal(existsSync(path.join(fixture.root, ".project-state")), false);
  });

  test("compatible installation rolls the lockfile back when frozen installation fails", () => {
    const fixture = compatibleInstallFixture(transactionFixture);
    const originalLockfile = readFileSync(fixture.lockfilePath, "utf8");
    const pnpm = compatiblePnpmFixture(fixture, { installStatus: 1 });

    assert.throws(
      () =>
        installLatestCompatibleDependencies({
          projectRoot: fixture.root,
          manifests: fixture.manifests,
          spawnPnpm: pnpm.spawnPnpm,
        }),
      /lockfile was restored.*installation is incomplete/i,
    );
    assert.equal(readFileSync(fixture.lockfilePath, "utf8"), originalLockfile);
    assert.equal(pnpm.calls.length, 2);
    assert.equal(existsSync(path.join(fixture.root, ".project-state")), false);
  });

  test("compatible installation rejects concurrent source changes before lockfile publication", () => {
    const fixture = compatibleInstallFixture(transactionFixture);
    const originalLockfile = readFileSync(fixture.lockfilePath, "utf8");
    const pnpm = compatiblePnpmFixture(fixture, { mutateSource: true });

    assert.throws(
      () =>
        installLatestCompatibleDependencies({
          projectRoot: fixture.root,
          manifests: fixture.manifests,
          spawnPnpm: pnpm.spawnPnpm,
        }),
      /plan is stale because package\.json changed/i,
    );
    assert.equal(readFileSync(fixture.lockfilePath, "utf8"), originalLockfile);
    assert.equal(pnpm.calls.length, 1);
    assert.equal(existsSync(path.join(fixture.root, ".project-state")), false);
  });

  test("compatible installation restores its lockfile after a source change during install", () => {
    const fixture = compatibleInstallFixture(transactionFixture);
    const originalLockfile = readFileSync(fixture.lockfilePath, "utf8");
    const pnpm = compatiblePnpmFixture(fixture, { mutateSourceOnInstall: true });

    assert.throws(
      () =>
        installLatestCompatibleDependencies({
          projectRoot: fixture.root,
          manifests: fixture.manifests,
          spawnPnpm: pnpm.spawnPnpm,
        }),
      /prior lockfile was restored.*installation is incomplete/i,
    );
    assert.equal(readFileSync(fixture.lockfilePath, "utf8"), originalLockfile);
    assert.equal(pnpm.calls.length, 2);
    assert.equal(existsSync(path.join(fixture.root, ".project-state")), false);
  });

  test("compatible installation disables and snapshots executable pnpm hooks", () => {
    const fixture = compatibleInstallFixture(transactionFixture);
    const originalLockfile = readFileSync(fixture.lockfilePath, "utf8");
    const pnpm = compatiblePnpmFixture(fixture, { createPnpmHook: true });

    assert.throws(
      () =>
        installLatestCompatibleDependencies({
          projectRoot: fixture.root,
          manifests: fixture.manifests,
          spawnPnpm: pnpm.spawnPnpm,
        }),
      /plan is stale because \.pnpmfile\.cjs changed/i,
    );
    assert.equal(readFileSync(fixture.lockfilePath, "utf8"), originalLockfile);
    assert.equal(pnpm.calls.length, 1);
    assert.equal(pnpm.calls[0].ignorePnpmfile, "true");
    assert.equal(existsSync(path.join(fixture.root, ".project-state")), false);
  });
}
