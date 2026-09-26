/** Verifies generic tool-home isolation, private storage admission and credential preservation. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  prepareProjectToolDirectories,
  projectToolEnvironment,
  projectToolPaths,
} from "./project-tool-environment.mjs";
import { runProjectCommand } from "../setup/project-command.mjs";
import { listActiveFiles } from "./source-inventory.mjs";
import {
  isPrivateRepositoryStatePath,
  nonPortableTransferPathReason,
} from "./source-inventory-policy.mjs";
import { scanRepositorySecrets } from "../verify/secrets.mjs";
import { inspectFrameworkReset } from "../../.agents/skills/reset-framework/scripts/reset-framework.mjs";

function fixture(t) {
  const parent = mkdtempSync(path.join(os.tmpdir(), "project-tool-environment-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const roots = ["host", "first", "second"].map((name) => path.join(parent, name));
  for (const root of roots) {
    mkdirSync(path.join(root, ".codex"), { recursive: true });
    writeFileSync(path.join(root, ".codex/mise.toml"), "[tools]\n");
  }
  return roots;
}

test("outer-shell Mise discovery ignores project pins before and after a project command", async (t) => {
  const [host, root] = fixture(t);
  const config = '[tools]\n[env]\nEXPECTED_PROJECT_CONFIG = "local"\n';
  writeFileSync(path.join(root, ".codex/mise.toml"), config);
  const outer = {
    PATH: process.env.PATH,
    HOME: host,
    MISE_CONFIG_DIR: host,
    MISE_GLOBAL_CONFIG_FILE: path.join(host, "absent.toml"),
    MISE_SYSTEM_CONFIG_DIR: host,
    MISE_SYSTEM_CONFIG_FILE: path.join(host, "absent.toml"),
    MISE_DATA_DIR: host,
    MISE_CACHE_DIR: host,
    MISE_STATE_DIR: host,
    MISE_CEILING_PATHS: path.dirname(root),
    MISE_AUTO_INSTALL: "false",
    MISE_OFFLINE: "true",
  };
  const nested = path.join(root, "product");
  mkdirSync(nested);
  const assertOuter = () => {
    for (const cwd of [root, nested]) {
      const result = spawnSync("mise", ["ls", "--current", "--json", "--locked"], {
        cwd,
        env: outer,
        encoding: "utf8",
        timeout: 20_000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {});
      assert.doesNotMatch(result.stderr, /missing:/u);
    }
  };
  assertOuter();
  assert.equal(
    await runProjectCommand({
      root,
      inherited: outer,
      miseExecutable: "mise",
      command: process.execPath,
      args: ["-e", 'process.exit(process.env.EXPECTED_PROJECT_CONFIG === "local" ? 0 : 1)'],
    }),
    0,
  );
  assertOuter();
  assert.equal(readFileSync(path.join(root, ".codex/mise.toml"), "utf8"), config);
});

test("an unnamed tool and its child receive only their own home and no ambient account", async (t) => {
  const [host, first, second] = fixture(t);
  writeFileSync(
    path.join(path.dirname(first), "mise.toml"),
    '[env]\nOUTSIDE_PROJECT_CONFIG = "host"\n',
  );
  for (const root of [first, second])
    writeFileSync(
      path.join(root, ".codex/mise.toml"),
      '[tools]\n[env]\nEXPECTED_PROJECT_CONFIG = "local"\n',
    );
  writeFileSync(path.join(host, "account"), "host-account-sentinel");
  const inherited = {
    ...process.env,
    HOME: host,
    XDG_CONFIG_HOME: host,
    USERPROFILE: host,
    PROVIDER_NOT_IN_ANY_CATALOG_AUTH: "host-account-sentinel",
    AWS_ACCESS_KEY_ID: "ambient-identity",
    GOOGLE_APPLICATION_CREDENTIALS: path.join(host, "account"),
    SSH_AUTH_SOCK: path.join(host, "agent"),
    BASH_ENV: path.join(host, "profile"),
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "host-helper",
  };
  const program = `
    const fs = require('node:fs'); const os = require('node:os');
    const path = require('node:path'); const {spawnSync} = require('node:child_process');
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("node:os").homedir())'], {encoding:'utf8'});
    fs.writeFileSync(path.join(os.homedir(), 'account'), 'project-account');
    fs.writeFileSync(path.join(os.homedir(), 'observed.json'), JSON.stringify({home:os.homedir(),child:child.stdout,keys:Object.keys(process.env),config:process.env.EXPECTED_PROJECT_CONFIG,gitConfig:[process.env.GIT_CONFIG_COUNT,process.env.GIT_CONFIG_KEY_0,process.env.GIT_CONFIG_VALUE_0]}));
  `;
  for (const root of [first, second]) {
    const locations = projectToolPaths(root);
    const status = await runProjectCommand({
      root,
      command: process.execPath,
      miseExecutable: "mise",
      args: ["-e", program],
      inherited,
    });
    assert.equal(status, 0);
    const observed = JSON.parse(readFileSync(path.join(locations.home, "observed.json"), "utf8"));
    assert.equal(observed.home, locations.home);
    assert.equal(observed.child, locations.home);
    assert.equal(observed.config, "local", "Mise must actually load the repository configuration");
    assert.deepEqual(observed.gitConfig, ["1", "user.useConfigOnly", "true"]);
    for (const name of [
      "PROVIDER_NOT_IN_ANY_CATALOG_AUTH",
      "AWS_ACCESS_KEY_ID",
      "SSH_AUTH_SOCK",
      "BASH_ENV",
      "OUTSIDE_PROJECT_CONFIG",
    ])
      assert.ok(!observed.keys.includes(name), name);
    assert.equal(readFileSync(path.join(locations.home, "account"), "utf8"), "project-account");
  }
  assert.equal(readFileSync(path.join(host, "account"), "utf8"), "host-account-sentinel");
  assert.notEqual(projectToolPaths(first).home, projectToolPaths(second).home);
});

test("private state cannot follow a host symlink or reuse publicly accessible storage", (t) => {
  const [host, first, second] = fixture(t);
  symlinkSync(host, path.join(first, ".auth"), "dir");
  assert.throws(() => prepareProjectToolDirectories(first));
  mkdirSync(path.join(second, ".auth", "project-tools"), { recursive: true });
  chmodSync(path.join(second, ".auth", "project-tools"), 0o755);
  assert.throws(() => prepareProjectToolDirectories(second), /private/iu);
  assert.equal(existsSync(path.join(host, "project-tools")), false);
});

test("Git SSH resolves only local identity and known-host paths without the host agent or config", (t) => {
  const [, root] = fixture(t);
  prepareProjectToolDirectories(root);
  const env = projectToolEnvironment({ root });
  const result = spawnSync("sh", ["-c", `${env.GIT_SSH_COMMAND} -G example.invalid`], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const records = result.stdout.trim().split("\n");
  assert.ok(records.includes("identityagent none"));
  assert.ok(records.includes("identitiesonly yes"));
  // ssh -G reports IdentityFile before environment expansion at file-open time. HOME is bound
  // to the private project directory, and no default OS-account identity remains in the list.
  assert.equal(env.HOME, projectToolPaths(root).home);
  assert.deepEqual(
    records.filter((line) => line.startsWith("identityfile ")),
    ["identityfile ${HOME}/.ssh/id_ed25519"],
  );
  assert.ok(records.includes(`userknownhostsfile ${projectToolPaths(root).home}/.ssh/known_hosts`));
  assert.ok(records.includes(`globalknownhostsfile ${os.devNull}`));
});

test("account state is excluded before discovery and remains outside ephemeral reset", async (t) => {
  const [, root] = fixture(t);
  const location = prepareProjectToolDirectories(root);
  writeFileSync(path.join(root, "owned.mjs"), "export const product = true;\n");
  writeFileSync(path.join(location.home, "account"), "project-account-sentinel");
  assert.deepEqual(listActiveFiles({ root }), [".codex/mise.toml", "owned.mjs"]);
  assert.ok(isPrivateRepositoryStatePath(".auth/project-tools/home/account"));
  assert.ok(nonPortableTransferPathReason(".auth/project-tools/home/account"));
  // Even a manually tracked private path is reported by name without reading its payload.
  const nonexistent = ".auth/project-tools/home/nonexistent-account";
  assert.deepEqual(await scanRepositorySecrets({ root, files: [nonexistent] }), [
    `${nonexistent}: sensitive credential directory`,
  ]);
  writeFileSync(path.join(root, "package.json"), '{"name":"codexrig"}\n');
  writeFileSync(path.join(root, "README.md"), "# CodexRig Framework\n");
  mkdirSync(path.join(root, ".codex"), { recursive: true });
  const skill = path.join(root, ".agents", "skills", "reset-framework");
  mkdirSync(skill, { recursive: true });
  writeFileSync(path.join(skill, "SKILL.md"), "# Reset Framework\n");
  const reset = inspectFrameworkReset(root);
  assert.ok(!JSON.stringify(reset).includes(".auth/project-tools"));
  assert.equal(
    readFileSync(path.join(location.home, "account"), "utf8"),
    "project-account-sentinel",
  );
});

test("missing locked tools stop before a host runtime can execute the requested command", async (t) => {
  const [, root] = fixture(t);
  mkdirSync(path.join(root, ".codex"), { recursive: true });
  writeFileSync(path.join(root, ".codex/toolchain.json"), "{}\n");
  writeFileSync(
    path.join(root, ".codex/mise.toml"),
    '[tools]\nnode = "999.0.0"\npnpm = "999.0.0"\n',
  );
  await assert.rejects(
    runProjectCommand({
      root,
      miseExecutable: "mise",
      command: "node",
      args: ["-e", 'require("node:fs").writeFileSync("wrong-runtime", "executed")'],
    }),
    /Host fallback is forbidden/u,
  );
  assert.equal(existsSync(path.join(root, "wrong-runtime")), false);
});

test("an independent temporary directory does not invalidate the held tool-storage parent", (t) => {
  const [, root] = fixture(t);
  const locations = prepareProjectToolDirectories(root);
  const open = fs.openSync;
  let created = false;
  fs.openSync = (target, ...args) => {
    if (!created && target === locations.temporary) {
      mkdirSync(path.join(locations.temporary, "independent-operation"), { mode: 0o700 });
      created = true;
    }
    return open(target, ...args);
  };
  syncBuiltinESMExports();
  try {
    assert.deepEqual(prepareProjectToolDirectories(root), locations);
    assert.equal(created, true, "exercise the exact directory stat/open boundary");
  } finally {
    fs.openSync = open;
    syncBuiltinESMExports();
  }
});
