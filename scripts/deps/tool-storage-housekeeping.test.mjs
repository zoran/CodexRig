/** Exercises native housekeeping with real package/runtime tools and disposable isolated storage. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readToolchainConfiguration } from "../contracts/toolchain-configuration.mjs";
import { pnpmMiseAlias, miseLockBlocks } from "../contracts/mise-toolchain-configuration.mjs";
import { toolingRoot, serializeCanonicalJson } from "../filesystem/repository-files.mjs";
import {
  projectManagedToolLayout,
  sealProjectToolBundle,
} from "../repository/project-tool-executables.mjs";
import {
  prepareProjectToolDirectories,
  projectToolEnvironment,
} from "../repository/project-tool-environment.mjs";
import { prepareUserToolDirectories } from "../repository/user-tool-storage.mjs";
import { runRepositoryHousekeeping } from "../goals/repository-housekeeping.mjs";
import { runProjectCommand } from "../setup/project-command.mjs";
import { inspectLinuxOpenRepositoryPaths } from "../repository/runtime-process-identity.mjs";
import { maintainToolchain } from "./maintain-toolchain.mjs";
import { toolchainConfigurationPaths } from "./toolchain-maintenance-inputs.mjs";

const installed = projectManagedToolLayout(toolingRoot);
const installedPnpm = installed.pnpm.executable;

function write(file, text, mode = 0o600) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, text, { mode });
}
function launcher(executable) {
  return `#!/bin/sh\nexec '${executable.replaceAll("'", "'\\''")}' "$@"\n`;
}
function fixture(t) {
  const parent = mkdtempSync(path.join(os.tmpdir(), "native-tool-housekeeping-"));
  const previous = process.env.PROJECT_TOOL_STORAGE_HOME;
  const previousCi = process.env.CI;
  process.env.CI = "false";
  process.env.PROJECT_TOOL_STORAGE_HOME = parent;
  t.after(() => {
    if (previous === undefined) delete process.env.PROJECT_TOOL_STORAGE_HOME;
    else process.env.PROJECT_TOOL_STORAGE_HOME = previous;
    if (previousCi === undefined) delete process.env.CI;
    else process.env.CI = previousCi;
    rmSync(parent, { recursive: true, force: true });
  });
  const shared = prepareUserToolDirectories();
  const matrix = structuredClone(readToolchainConfiguration());
  const roots = ["first", "second", "obsolete"].map((name) => path.join(parent, name));
  for (const root of roots) mkdirSync(root);
  let layout = projectManagedToolLayout(roots[0], matrix);
  matrix.ci.miseBinarySha256[path.basename(layout.mise.directory)] = createHash("sha256")
    .update(launcher(installed.mise.executable))
    .digest("hex");
  // This fixture supplies the actual primary Node/pnpm runtimes; keep their original archive locks.
  const pins = { node: matrix.stable.node.version, pnpm: matrix.stable.pnpm.version };
  const lock = miseLockBlocks(readFileSync(path.join(toolingRoot, ".codex/mise.lock"), "utf8"))
    .filter(({ tool, version }) => pins[tool] === version)
    .map(({ block }) => block)
    .join("\n");
  for (const root of roots) {
    write(path.join(root, ".codex/toolchain.json"), serializeCanonicalJson(matrix));
    write(
      path.join(root, ".codex/mise.toml"),
      `${pnpmMiseAlias}\n[tools]\nnode = "${pins.node}"\npnpm = "${pins.pnpm}"\n`,
    );
    write(path.join(root, ".codex/mise.lock"), "lockfile_version = 4\n" + lock);
    for (const name of ["package.json", "aube-lock.yaml"]) {
      const relative = `.codex/.mise/locks/pnpm/current/${name}`;
      write(path.join(root, relative), readFileSync(path.join(toolingRoot, relative), "utf8"));
    }
    write(
      path.join(root, "pnpm-workspace.yaml"),
      "packages: []\nvirtualStoreType: global\nignorePnpmfile: true\npnpmfile: []\n",
    );
    write(
      path.join(root, "package.json"),
      JSON.stringify({ name: path.basename(root), private: true }),
    );
    prepareProjectToolDirectories(root);
  }
  for (const name of ["mise", "codex"]) {
    const tool = projectManagedToolLayout(roots[0])[name];
    write(
      tool.executable,
      name === "mise" ? launcher(installed.mise.executable) : "#!/bin/sh\nexit 0\n",
      0o755,
    );
    sealProjectToolBundle(roots[0], tool.directory, tool);
  }
  // These tiny launchers invoke the actual shipped runtimes. No Node/Python installation is
  // copied for any fixture or run, and native Mise resolves the project’s actual pins.
  layout = projectManagedToolLayout(roots[0], matrix);
  write(layout.node.executable, launcher(installed.node.executable), 0o755);
  write(layout.pnpm.executable, launcher(installedPnpm), 0o755);
  return { parent, roots, shared, layout: projectManagedToolLayout(roots[0]) };
}
function native(root, executable, args) {
  const result = spawnSync(executable, args, {
    cwd: root,
    env: projectToolEnvironment({ root }),
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test("real housekeeping collects unused shared packages, retires legacy runtimes and preserves offline siblings and accounts", async (t) => {
  const f = fixture(t);
  for (const [index, root] of f.roots.entries()) {
    const name = index === 2 ? "obsolete-fixture" : "shared-fixture";
    const payload = path.join(f.parent, name, "package");
    write(
      path.join(payload, "package.json"),
      JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
    );
    write(path.join(payload, "index.js"), `module.exports = ${JSON.stringify(name)};`);
    const archive = path.join(f.parent, `${name}.tgz`);
    if (!existsSync(archive))
      native(root, "/usr/bin/tar", ["-czf", archive, "-C", path.dirname(payload), "package"]);
    write(
      path.join(root, "package.json"),
      JSON.stringify({
        name: path.basename(root),
        private: true,
        dependencies: { [name]: `file:${archive}` },
      }),
    );
    native(root, f.layout.pnpm.executable, [
      "install",
      "--offline",
      "--ignore-scripts",
      "--store-dir",
      f.shared.pnpmStore,
    ]);
  }
  const [first, second, obsolete] = f.roots;
  const primaryNode = readToolchainConfiguration().stable.node.version;
  const retainedRuntime = path.join(f.shared.miseData, "installs/node/22.21.0");
  const unusedRuntime = path.join(f.shared.miseData, "installs/node/18.19.0");
  for (const directory of [retainedRuntime, unusedRuntime])
    write(path.join(directory, "bin/node"), launcher(installed.node.executable), 0o755);
  write(
    path.join(second, ".codex/mise.toml"),
    `[tools]\nnode = ["${primaryNode}", "22.21.0"]\npnpm = "${readToolchainConfiguration().stable.pnpm.version}"\n`,
  );
  // Native Mise resolves the second project’s additional pin in its own environment.
  native(second, f.layout.mise.executable, ["ls", "--current", "--json"]);
  const unusedMatrix = structuredClone(readToolchainConfiguration(first));
  unusedMatrix.ci.miseVersion = "2026.8.1";
  const unusedBundle = projectManagedToolLayout(first, unusedMatrix).mise;
  write(unusedBundle.executable, "#!/bin/sh\nexit 0\n", 0o755);
  sealProjectToolBundle(first, unusedBundle.directory, unusedBundle);
  const sharedPackage = realpathSync(path.join(first, "node_modules/shared-fixture"));
  assert.equal(realpathSync(path.join(second, "node_modules/shared-fixture")), sharedPackage);
  const obsoletePackage = realpathSync(path.join(obsolete, "node_modules/obsolete-fixture"));
  rmSync(obsolete, { recursive: true });
  const legacy = path.join(
    first,
    ".auth/project-tools/data/mise/installs/node",
    readToolchainConfiguration().stable.node.version,
  );
  write(path.join(legacy, "bin/node"), launcher(installed.node.executable), 0o755);
  const legacyBundle = path.join(
    first,
    ".auth/project-tools/tools/mise",
    f.layout.mise.version,
    path.basename(f.layout.mise.directory),
  );
  cpSync(f.layout.mise.directory, legacyBundle, { recursive: true });
  const credential = path.join(first, ".auth/project-tools/home/account-sentinel");
  write(credential, "private-account");
  const legacyCache = path.join(first, ".auth/project-tools/cache/mise");
  mkdirSync(legacyCache);
  chmodSync(legacyCache, 0o775);
  const inputs = readFileSync(path.join(first, "pnpm-lock.yaml"));
  await runRepositoryHousekeeping({ storageOnly: true, apply: false }, { root: first });
  assert.ok(existsSync(legacy) && existsSync(obsoletePackage), "read-only check must not collect");
  assert.equal(lstatSync(legacyCache).mode & 0o777, 0o775, "read-only check must not repair modes");
  const result = await runRepositoryHousekeeping(
    { storageOnly: true, apply: true },
    { root: first },
  );
  assert.ok(result.tools.actions.some((action) => action.startsWith("pnpm:")));
  assert.equal(
    lstatSync(legacyCache).mode & 0o777,
    0o700,
    "legacy cache stays private after collection",
  );
  assert.equal(existsSync(legacy), false, "native Mise uninstalls the replaced repository runtime");
  assert.equal(existsSync(legacyBundle), false);
  assert.equal(existsSync(unusedRuntime), true, "a single project cannot retire a shared runtime");
  assert.equal(
    existsSync(retainedRuntime),
    true,
    "another project's secondary runtime pin remains installed",
  );
  assert.equal(
    existsSync(unusedBundle.directory),
    true,
    "a single project cannot retire a shared bootstrap bundle",
  );
  assert.equal(
    existsSync(obsoletePackage),
    false,
    "native pnpm removes an unreferenced package graph",
  );
  assert.ok(existsSync(sharedPackage));
  assert.equal(readFileSync(credential, "utf8"), "private-account");
  rmSync(path.join(second, "node_modules"), { recursive: true });
  for (const root of [first, second]) {
    native(root, f.layout.pnpm.executable, [
      "install",
      "--offline",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--store-dir",
      f.shared.pnpmStore,
    ]);
    assert.equal(realpathSync(path.join(root, "node_modules/shared-fixture")), sharedPackage);
  }
  assert.deepEqual(readFileSync(path.join(first, "pnpm-lock.yaml")), inputs);
  for (let index = 0; index < 2; index++) {
    assert.equal(
      await runProjectCommand({
        root: first,
        command: "node",
        args: [
          "-e",
          "require('node:fs').writeFileSync(require('node:path').join(require('node:os').tmpdir(),'load-output'),'scratch')",
        ],
      }),
      0,
    );
  }
  assert.ok(
    lstatSync(f.layout.node.executable).size < 1024,
    "runs retain only the shared runtime reference",
  );
  const externalCache = path.join(f.parent, "external-cache");
  mkdirSync(externalCache);
  chmodSync(externalCache, 0o775);
  rmSync(legacyCache, { recursive: true });
  symlinkSync(externalCache, legacyCache);
  await assert.rejects(
    runRepositoryHousekeeping({ storageOnly: true, apply: true }, { root: first }),
    /unsafe legacy native tool directory/u,
  );
  assert.equal(
    lstatSync(externalCache).mode & 0o777,
    0o775,
    "migration must never repair a symlink target",
  );
});

test("runtime storage inspection detects the actual executable without an open file descriptor", () => {
  const executable = realpathSync(process.execPath);
  const observation = inspectLinuxOpenRepositoryPaths({
    root: path.dirname(executable),
    excludePids: [],
    includeRuntimePaths: true,
    matchesPath: (relative) => relative === path.basename(executable),
  });
  assert.equal(observation.status, "active");
  const unobservable = inspectLinuxOpenRepositoryPaths({
    root: path.dirname(executable),
    excludePids: [],
    includeRuntimePaths: true,
    matchesPath: () => false,
    testHooks: {
      readDirectory: () => ["123"],
      readStats: () => ({ uid: process.getuid() }),
      readLink: (file) => {
        if (file.endsWith("/cwd")) return path.dirname(executable);
        throw Object.assign(new Error("unobservable executable"), { code: "EACCES" });
      },
    },
  });
  assert.equal(
    unobservable.status,
    "unknown",
    "unobservable consumers cannot authorize retirement",
  );
});

test("process inspection tolerates proc entries disappearing during observation", (t) => {
  if (process.platform !== "linux") return t.skip("Linux procfs observation");
  const root = path.resolve("process-inspection-fixture");
  for (const code of ["ENOENT", "ESRCH"]) {
    for (const missing of ["stat", "cwd", "exe", "maps", "fd", "descriptor"]) {
      const observe = (step, value) => {
        if (step === missing) throw Object.assign(new Error("Process exited"), { code });
        return value;
      };
      const result = inspectLinuxOpenRepositoryPaths({
        root,
        includeRuntimePaths: true,
        matchesPath: () => false,
        testHooks: {
          readDirectory: (file) => (file === "/proc" ? ["123"] : observe("fd", ["1"])),
          readStats: () => observe("stat", { uid: process.getuid() }),
          readText: () => observe("maps", ""),
          readLink: (file) =>
            file.endsWith("/cwd")
              ? observe("cwd", root)
              : file.endsWith("/exe")
                ? observe("exe", process.execPath)
                : observe("descriptor", "pipe:[1]"),
        },
      });
      assert.deepEqual(
        result,
        { observationComplete: true, status: "inactive" },
        `${code}: ${missing}`,
      );
    }
  }
});

test("startup reuses shared tools with fresh or unrelated Mise tracking and preserves private project settings", async (t) => {
  const f = fixture(t);
  const root = f.roots[0];
  for (const relative of toolchainConfigurationPaths) {
    if (relative === ".codex/toolchain.json") continue;
    write(path.join(root, relative), readFileSync(path.join(toolingRoot, relative)));
  }
  const matrix = readToolchainConfiguration(root);
  write(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "startup-storage",
      version: "1.0.0",
      private: true,
      packageManager: `pnpm@${matrix.stable.pnpm.version}`,
      devDependencies: {},
    }),
  );
  const registry = path.join(f.shared.lifecycle, "mise-tracked-configs");
  const privateConfig = path.join(root, ".auth/project-tools/config/mise/config.toml");
  const setting = '[env]\nPROJECT_STORAGE_SETTING = "local"\n';
  write(privateConfig, setting);
  native(root, f.layout.pnpm.executable, ["install", "--offline", "--ignore-scripts"]);
  const lockfile = readFileSync(path.join(root, "pnpm-lock.yaml"));
  const notices = [];
  const start = () =>
    maintainToolchain({
      root,
      startup: true,
      locked: true,
      prepareStorage: () => {},
      fetchImpl: () => {
        throw new Error("startup storage regression must not download");
      },
      onReleaseNotice: (message) => notices.push(message),
    });

  assert.equal(existsSync(registry), false);
  assert.deepEqual((await start()).changedPaths, []);
  assert.equal(
    existsSync(registry),
    false,
    "a fresh project publishes no cross-project references",
  );

  const sibling = f.roots[1];
  const foreignPins = path.join(sibling, ".codex/mise.toml");
  const foreignSettings = path.join(sibling, ".auth/project-tools/config/mise/config.toml");
  write(foreignPins, '[tools]\nnode = "24"\n[env]\nSIBLING_SETTING = "local"\n');
  write(foreignSettings, '[env]\nPROJECT_STORAGE_SETTING = "sibling"\n');
  mkdirSync(registry);
  const references = {
    "foreign-pins": foreignPins,
    "foreign-private": foreignSettings,
    "removed-project": path.join(f.parent, "removed-project/.codex/mise.toml"),
  };
  for (const [name, target] of Object.entries(references))
    symlinkSync(target, path.join(registry, name));
  const formerState = path.join(root, ".auth/project-tools/mise");
  mkdirSync(formerState, { recursive: true });
  symlinkSync(registry, path.join(formerState, "tracked-configs"), "dir");
  const retainedRuntime = path.join(f.shared.miseData, "installs/node/18.19.0/bin/node");
  write(retainedRuntime, launcher(installed.node.executable), 0o755);

  assert.deepEqual((await start()).changedPaths, []);
  assert.equal(
    native(root, f.layout.mise.executable, [
      "exec",
      "--locked",
      "--",
      "node",
      "-p",
      "process.env.PROJECT_STORAGE_SETTING",
    ]).trim(),
    "local",
  );
  assert.deepEqual(readdirSync(registry).sort(), Object.keys(references).sort());
  for (const [name, target] of Object.entries(references))
    assert.equal(readlinkSync(path.join(registry, name)), target);
  const tracker = path.join(projectToolEnvironment({ root }).MISE_STATE_DIR, "tracked-configs");
  assert.ok(lstatSync(tracker).isDirectory());
  const trackedPaths = readdirSync(tracker).map((name) => readlinkSync(path.join(tracker, name)));
  assert.ok(trackedPaths.includes(path.join(root, ".codex/mise.toml")));
  assert.ok(trackedPaths.every((target) => target.startsWith(root + path.sep)));
  assert.deepEqual(
    notices.filter(
      (message) => message.includes(sibling) || /shared runtime|shared tool cleanup/i.test(message),
    ),
    [],
  );
  assert.equal(readFileSync(privateConfig, "utf8"), setting);
  assert.equal(
    readFileSync(foreignSettings, "utf8"),
    '[env]\nPROJECT_STORAGE_SETTING = "sibling"\n',
  );
  assert.ok(existsSync(retainedRuntime));
  assert.deepEqual(readFileSync(path.join(root, "pnpm-lock.yaml")), lockfile);
});
