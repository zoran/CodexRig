import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  compatibleInstallArgs,
  compatibleUpdateArgs,
  installLatestCompatibleDependencies,
} from "./install-compatible.mjs";

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
      if (args[0] === "update") {
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
        return { status: options.installStatus ?? 0, stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected pnpm command: ${args.join(" ")}`);
    },
  };
}

export function registerCompatibleInstallationTests(transactionFixture) {
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
          ignorePnpmfile: undefined,
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
