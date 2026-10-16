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
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readToolchainConfiguration } from "../contracts/toolchain-configuration.mjs";
import { miseLockBlocks } from "../contracts/mise-toolchain-configuration.mjs";
import { toolingRoot, serializeCanonicalJson } from "../filesystem/repository-files.mjs";
import {
  projectManagedToolLayout,
  sealProjectToolBundle,
} from "../repository/project-tool-executables.mjs";
import {
  prepareProjectToolDirectories,
  projectToolEnvironment,
} from "../repository/project-tool-environment.mjs";
import {
  prepareUserToolDirectories,
  prepareMiseTracking,
  trackedToolProjects,
  deferredMiseTrackingErrorCode,
} from "../repository/user-tool-storage.mjs";
import { runRepositoryHousekeeping } from "../goals/repository-housekeeping.mjs";
import { runProjectCommand } from "../setup/project-command.mjs";
import { inspectLinuxOpenRepositoryPaths } from "../repository/runtime-process-identity.mjs";
import { acquireVerificationSessionLock } from "../verify/verification-session-lock.mjs";
import { reconcileToolStorage } from "./tool-storage-housekeeping.mjs";
import { maintainToolchain } from "./maintain-toolchain.mjs";
import { toolchainConfigurationPaths } from "./toolchain-maintenance-inputs.mjs";

const installed = projectManagedToolLayout(toolingRoot);

test("shared tracking accepts current native and npm package pins without admitting executable configuration", (t) => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "shared-tool-pins-"));
  const previous = process.env.PROJECT_TOOL_STORAGE_HOME;
  process.env.PROJECT_TOOL_STORAGE_HOME = parent;
  t.after(() => {
    if (previous === undefined) delete process.env.PROJECT_TOOL_STORAGE_HOME;
    else process.env.PROJECT_TOOL_STORAGE_HOME = previous;
    rmSync(parent, { recursive: true, force: true });
  });
  const shared = prepareUserToolDirectories();
  const roots = ["native", "npm"].map((name) => path.join(parent, name));
  for (const [index, root] of roots.entries()) {
    mkdirSync(root, { mode: 0o700 });
    write(
      path.join(root, ".codex/mise.toml"),
      `[tools]\nnode = "24.21.0"\n${index ? '"npm:pnpm"' : "pnpm"} = "11.28.0"\n`,
    );
    prepareProjectToolDirectories(root);
    assert.equal(prepareMiseTracking(root), true);
    symlinkSync(
      path.join(root, ".codex/mise.toml"),
      path.join(shared.miseTrackedConfigs, String(index)),
    );
  }
  assert.deepEqual(trackedToolProjects().sort(), roots.sort());
  for (const mode of [0o775, 0o777]) {
    chmodSync(roots[0], mode);
    assert.throws(
      () => trackedToolProjects(),
      (error) =>
        error.code === deferredMiseTrackingErrorCode &&
        error.message.includes(roots[0]) &&
        /group\/other-writable/u.test(error.message),
    );
    assert.equal(lstatSync(roots[0]).mode & 0o777, mode, "inventory never repairs a project");
  }
  chmodSync(roots[0], 0o700);
  const alias = path.join(parent, "linked-project");
  symlinkSync(roots[0], alias, "dir");
  const linkedReference = path.join(shared.miseTrackedConfigs, "linked-project");
  symlinkSync(path.join(alias, ".codex/mise.toml"), linkedReference);
  assert.throws(
    () => trackedToolProjects(),
    (error) => error.code === deferredMiseTrackingErrorCode && /noncanonical/u.test(error.message),
  );
  rmSync(linkedReference);
  assert.deepEqual(trackedToolProjects().sort(), roots.sort());
  write(
    path.join(roots[0], ".codex/mise.toml"),
    '[tools]\nnode = "24.21.0"\n"npm:pnpm" = "11.28.0"\n[env]\nUNSAFE = "exec:payload"\n',
  );
  assert.throws(() => trackedToolProjects(), /non-executing exact project pins/u);
});
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
  const layout = projectManagedToolLayout(roots[0], matrix);
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
      `[tools]\nnode = "${pins.node}"\npnpm = "${pins.pnpm}"\n`,
    );
    write(path.join(root, ".codex/mise.lock"), lock);
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
  // copied for any fixture or run, and the native Mise resolver/uninstaller remains real.
  write(layout.node.executable, launcher(installed.node.executable), 0o755);
  write(layout.pnpm.executable, launcher(installed.pnpm.executable), 0o755);
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
  // Native mise records the second project's exact config in the one shared tracker.
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
  assert.equal(
    existsSync(unusedRuntime),
    false,
    "native Mise removes unused shared runtime versions",
  );
  assert.equal(
    existsSync(retainedRuntime),
    true,
    "another project's secondary runtime pin remains installed",
  );
  assert.equal(
    existsSync(unusedBundle.directory),
    false,
    "the existing native bundle owner collects unused versions",
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

test("private Mise configuration retains shared runtimes while independent native collectors still run", (t) => {
  const f = fixture(t);
  const [first, second] = f.roots;
  const privateConfig = path.join(second, ".auth/project-tools/config/mise/config.toml");
  const content = '[env]\nADAPTER_SENTINEL = "isolated"\n';
  write(privateConfig, content);
  native(second, f.layout.mise.executable, ["ls", "--current", "--json"]);
  const retainedRuntime = path.join(f.shared.miseData, "installs/node/18.19.0");
  write(path.join(retainedRuntime, "bin/node"), launcher(installed.node.executable), 0o755);
  const calls = [];
  const lock = acquireVerificationSessionLock({ repositoryRoot: first });
  let result;
  try {
    result = reconcileToolStorage({
      root: first,
      apply: true,
      owner: lock.lifecycleCapability,
      runNative(command, args, options) {
        calls.push({ command, args });
        return spawnSync(command, args, options);
      },
    });
  } finally {
    lock.release();
  }
  assert.equal(calls.filter(({ args }) => args[0] === "prune").length, 0);
  assert.equal(calls.filter(({ args }) => args[0] === "store" && args[1] === "prune").length, 1);
  assert.ok(result.deferred.some((reason) => /private Mise configuration/u.test(reason)));
  assert.ok(existsSync(retainedRuntime));
  assert.equal(readFileSync(privateConfig, "utf8"), content);
});

test("shared cleanup rejects executable tracked configuration before deleting any tool version", async (t) => {
  const f = fixture(t);
  const root = f.roots[0];
  const privateConfig = path.join(f.roots[2], ".auth/project-tools/config/mise/config.toml");
  write(privateConfig, '[env]\nADAPTER_SENTINEL = "isolated"\n');
  symlinkSync(privateConfig, path.join(f.shared.miseTrackedConfigs, "000-private-reference"));
  chmodSync(f.roots[2], 0o775);
  symlinkSync(
    path.join(f.roots[2], ".codex/mise.toml"),
    path.join(f.shared.miseTrackedConfigs, "000-unadmitted-project"),
  );
  const unsafe = path.join(f.roots[1], ".codex/mise.toml");
  write(unsafe, '[tools]\nnode = "24.21.0"\npnpm = "11.28.0"\n[env]\nUNSAFE = "retained"\n');
  symlinkSync(unsafe, path.join(f.shared.miseTrackedConfigs, "unsafe-reference"));
  const unused = path.join(f.shared.miseData, "installs/node/18.19.0/bin/node");
  write(unused, launcher(installed.node.executable), 0o755);
  await assert.rejects(
    runRepositoryHousekeeping({ storageOnly: true, apply: true }, { root }),
    /non-executing exact project pins/u,
  );
  assert.ok(existsSync(unused), "a rejected inventory cannot authorize collection");
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

test("startup composes native cleanup and migrates private pin tracking without downloads or runtime copies", async (t) => {
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
  const tracked = path.join(root, ".auth/project-tools/mise/tracked-configs");
  rmSync(tracked);
  mkdirSync(tracked, { mode: 0o700 });
  chmodSync(path.dirname(tracked), 0o775);
  chmodSync(tracked, 0o775);
  symlinkSync(
    path.join(f.parent, "removed-project/.codex/mise.toml"),
    path.join(tracked, "dead-reference"),
  );
  const privateState = path.join(root, ".auth/project-tools/mise/private-account-sentinel");
  write(privateState, "preserved private state");
  native(root, f.layout.mise.executable, ["ls", "--current", "--json"]);
  native(root, f.layout.pnpm.executable, [
    "install",
    "--offline",
    "--ignore-scripts",
    "--store-dir",
    f.shared.pnpmStore,
  ]);
  const before = readFileSync(path.join(root, "pnpm-lock.yaml"));
  const legacy = path.join(
    root,
    ".auth/project-tools/data/mise/installs/node",
    matrix.stable.node.version,
  );
  write(path.join(legacy, "bin/node"), launcher(installed.node.executable), 0o755);
  // Freeze external release discovery; execute the real startup installation/finalization/GC path.
  const result = await maintainToolchain({
    prepareStorage: () => {},
    root,
    startup: true,
    locked: true,
    fetchImpl: () => {
      throw new Error("startup storage regression must not download");
    },
  });
  assert.deepEqual(result.changedPaths, []);
  assert.equal(existsSync(legacy), false);
  assert.ok(lstatSync(tracked).isSymbolicLink());
  assert.equal(lstatSync(path.dirname(tracked)).mode & 0o777, 0o700);
  assert.equal(
    lstatSync(path.join(tracked, "dead-reference"), { throwIfNoEntry: false }),
    undefined,
  );
  assert.equal(readFileSync(privateState, "utf8"), "preserved private state");
  assert.deepEqual(readFileSync(path.join(root, "pnpm-lock.yaml")), before);

  // A registered sibling with permissive root modes must retain shared tools, not abort an
  // otherwise verified startup or have its permissions silently rewritten by this project.
  const sibling = f.roots[1];
  native(sibling, f.layout.mise.executable, ["ls", "--current", "--json"]);
  chmodSync(sibling, 0o775);
  const retainedRuntime = path.join(f.shared.miseData, "installs/node/18.19.0");
  write(path.join(retainedRuntime, "bin/node"), launcher(installed.node.executable), 0o755);
  const oldMatrix = structuredClone(matrix);
  oldMatrix.ci.miseVersion = "2026.8.1";
  const retainedBundle = projectManagedToolLayout(root, oldMatrix).mise;
  write(retainedBundle.executable, "#!/bin/sh\nexit 0\n", 0o755);
  sealProjectToolBundle(root, retainedBundle.directory, retainedBundle);
  const progress = [];
  const retained = await maintainToolchain({
    prepareStorage: () => {},
    root,
    startup: true,
    locked: true,
    fetchImpl: () => {
      throw new Error("startup storage regression must not download");
    },
    onProgress: (message) => progress.push(message),
  });
  assert.deepEqual(retained.changedPaths, []);
  assert.ok(progress.some((message) => message.includes(sibling) && /writable/u.test(message)));
  assert.ok(existsSync(retainedRuntime), "unadmitted project references retain all runtimes");
  assert.ok(existsSync(retainedBundle.directory), "unadmitted references also retain bundles");
  assert.equal(lstatSync(sibling).mode & 0o777, 0o775, "sibling permissions stay unchanged");
  assert.equal(readFileSync(privateState, "utf8"), "preserved private state");
  assert.deepEqual(readFileSync(path.join(root, "pnpm-lock.yaml")), before);
});
