/** Verifies global Git credential fallback for both providers with real Git and isolated host accounts. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createGitCredentialRecovery, globalGitCredential } from "./global-git-credential.mjs";
import {
  prepareProjectToolDirectories,
  projectToolEnvironment,
} from "./project-tool-environment.mjs";

const request = "protocol=https\nhost=github.com\npath=team/product.git\n\n";
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function fixture(
  t,
  {
    cli = false,
    includeCli = cli,
    globalPassword = "global-fixture-account",
    provider = "github",
    host = provider === "github" ? "github.com" : "gitlab.com",
    requestHost = host,
  } = {},
) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "github fallback's "));
  const cleanups = [];
  t.after(() => {
    try {
      for (const cleanup of cleanups) cleanup();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  const root = path.join(directory, "project");
  const hostHome = path.join(directory, "host");
  const bin = path.join(hostHome, "bin");
  mkdirSync(root);
  mkdirSync(bin, { recursive: true });
  prepareProjectToolDirectories(root);
  mkdirSync(path.join(root, ".codex"));
  const tooling = JSON.parse(
    readFileSync(new URL("../../.codex/tooling.json", import.meta.url), "utf8"),
  );
  if (!tooling.platform.hosts[provider].includes(host)) {
    tooling.platform.hosts[provider].push(host);
    tooling.platform.apiBaseUrls[provider][host] =
      `https://${host}${provider === "gitlab" ? "/api/v4" : "/api/v3"}`;
  }
  writeFileSync(path.join(root, ".codex/tooling.json"), JSON.stringify(tooling));
  const calls = path.join(hostHome, "calls.jsonl");
  const helper = path.join(bin, "account.mjs");
  for (const isCli of [...(!cli ? [false] : []), ...(includeCli ? [true] : [])]) {
    const executable = isCli ? path.join(bin, provider === "github" ? "gh" : "glab") : helper;
    writeFileSync(
      executable,
      `#!${process.execPath}
import {appendFileSync} from 'node:fs';
import path from 'node:path';
const expected=${JSON.stringify(isCli ? ["auth", "git-credential", "get"] : ["get"])};
if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(expected))process.exit(2);
let input='';for await(const chunk of process.stdin)input+=chunk;
if(!input.includes(${JSON.stringify(`host=${requestHost}\n`)}))process.exit(3);
if(${JSON.stringify(isCli)}) {
  const key=${JSON.stringify(provider === "github" ? "GH_CONFIG_DIR" : "GLAB_CONFIG_DIR")};
  if(process.env[key])process.exit(4);
  process.env[key]=path.join(process.env.HOME,'.local/state/dev-cloud-tools/user',${JSON.stringify(provider)},'config');
}
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({args:process.argv.slice(2),home:process.env.HOME,ambient:process.env.GITHUB_TOKEN,ambientGitLab:process.env.GITLAB_TOKEN,gitConfig:process.env.GIT_CONFIG_COUNT,cliConfig:process.env.GH_CONFIG_DIR??process.env.GLAB_CONFIG_DIR})+'\\n');
process.stdout.write(${JSON.stringify(`${isCli && provider === "gitlab" ? "capability[]=authtype\n" : ""}username=global-user\npassword=${isCli && !cli ? "cli-fixture-account" : globalPassword}\n${isCli && provider === "gitlab" ? "oauth_refresh_token=unused-fixture-refresh\n" : ""}\n`)});
`,
      { mode: 0o700 },
    );
  }
  if (!cli)
    writeFileSync(
      path.join(hostHome, ".gitconfig"),
      `[credential]\n\thelper = ${JSON.stringify(`!${quote(process.execPath)} ${quote(helper)}`)}\n`,
    );
  // The in-process test seam binds a fake host without adding a public CLI/environment override.
  const bridge = path.join(directory, "bridge.mjs");
  writeFileSync(
    bridge,
    `import {globalGitCredential} from ${JSON.stringify(new URL("./global-git-credential.mjs", import.meta.url).href)};
let input='';for await(const chunk of process.stdin)input+=chunk;process.stdout.write(globalGitCredential({root:${JSON.stringify(root)},hostHome:${JSON.stringify(hostHome)},operation:process.argv[2],input}));`,
  );
  const env = {
    ...projectToolEnvironment({ root }),
    PATH: bin + path.delimiter + process.env.PATH,
    GIT_CONFIG_VALUE_4: `!${quote(process.execPath)} ${quote(bridge)}`,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ALLOW_PROTOCOL: "file",
    GITHUB_TOKEN: ["ambient", "fixture", "unused"].join("-"),
    GITLAB_TOKEN: ["ambient", "fixture", "unused"].join("-"),
  };
  const git = (operation, input = request.replace("github.com", host), environment = {}) =>
    spawnSync("git", ["credential", operation], {
      cwd: root,
      env: { ...env, ...environment },
      input,
      encoding: "utf8",
      timeout: 30000,
    });
  return {
    defer: (cleanup) => cleanups.push(cleanup),
    root,
    hostHome,
    env,
    git,
    calls: () =>
      existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse) : [],
  };
}

for (const provider of ["github", "gitlab"]) {
  test(`${provider}: rejected project and global credentials advance to the CLI account`, (t) => {
    const f = fixture(t, { provider, includeCli: true });
    const input = request.replace(
      "github.com",
      provider === "github" ? "github.com" : "gitlab.com",
    );
    const host = provider === "github" ? "github.com" : "gitlab.com";
    const recovery = createGitCredentialRecovery({
      root: f.root,
      url: `https://${host}/team/product.git`,
    });
    f.defer(recovery.close);
    const git = (operation, value) => f.git(operation, value, recovery.environment);
    assert.equal(recovery.canRetry(), false);
    assert.equal(
      git("approve", input.trim() + "\nusername=local-user\npassword=wrong-project-account\n\n")
        .status,
      0,
    );
    const first = git("fill");
    assert.match(first.stdout, /password=wrong-project-account/);
    assert.equal(git("reject", first.stdout).status, 0);
    assert.equal(recovery.canRetry(), true);
    assert.equal(recovery.canRetry(), false);
    const second = git("fill");
    assert.match(second.stdout, /password=global-fixture-account/);
    assert.equal(git("reject", second.stdout).status, 0);
    assert.equal(recovery.canRetry(), true);
    const third = git("fill");
    assert.match(third.stdout, /password=cli-fixture-account/);
    assert.equal(git("reject", third.stdout).status, 0);
    assert.equal(recovery.canRetry(), false);
    assert.deepEqual(
      f.calls().map((call) => call.args),
      [["get"], ["get"], ["auth", "git-credential", "get"]],
    );
  });

  test(`${provider}: project credentials take priority over global login`, (t) => {
    const f = fixture(t, { provider });
    const credential =
      request.replace("github.com", provider === "github" ? "github.com" : "gitlab.com").trim() +
      "\nusername=local-user\npassword=local-fixture-account\n\n";
    assert.equal(f.git("approve", credential).status, 0);
    const result = f.git("fill");
    assert.equal(result.status, 0);
    assert.match(result.stdout, /password=local-fixture-account/);
    assert.deepEqual(f.calls(), []);
  });

  test(`${provider}: missing credentials reuse global Git without global store/erase`, (t) => {
    const f = fixture(t, { provider });
    const result = f.git("fill");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /password=global-fixture-account/);
    assert.deepEqual(
      f.calls().map((c) => c.args),
      [["get"]],
    );
    assert.equal(f.calls()[0].home, f.hostHome);
    assert.equal(f.calls()[0].ambient, undefined);
    assert.equal(f.calls()[0].ambientGitLab, undefined);
    // Git may approve the successful account into its project store, never back into host helpers.
    assert.equal(f.git("approve", result.stdout).status, 0);
    assert.equal(f.git("fill").status, 0);
    assert.equal(f.git("reject", result.stdout).status, 0);
    assert.equal(f.calls().length, 1);
  });

  test(`${provider}: existing CLI login works without global Git configuration`, (t) => {
    const f = fixture(t, { cli: true, provider });
    const result = f.git("fill");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /password=global-fixture-account/);
    assert.deepEqual(
      f.calls().map((c) => c.args),
      [["auth", "git-credential", "get"]],
    );
    assert.equal(f.calls()[0].ambient, undefined);
    assert.equal(f.calls()[0].ambientGitLab, undefined);
    assert.equal(
      f.calls()[0].cliConfig,
      path.join(f.hostHome, ".local/state/dev-cloud-tools/user", provider, "config"),
    );
    assert.doesNotMatch(result.stdout, /refresh/);
  });
}

test("GitHub username matching follows the CLI's case-insensitive account contract", (t) => {
  const f = fixture(t, { cli: true });
  const result = f.git("fill", request.trim() + "\nusername=GLOBAL-USER\n\n");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /password=global-fixture-account/);
});

test("recovery binds Git's actual credential context for explicit ports and unnormalized URL paths", (t) => {
  const f = fixture(t, { requestHost: "github.com:443" });
  const url = "https://github.com:443//team/../product.git/";
  const recovery = createGitCredentialRecovery({ root: f.root, url });
  f.defer(recovery.close);
  const result = f.git("fill", `url=${url}\n\n`, recovery.environment);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /host=github.com:443\n/);
  assert.match(result.stdout, /path=team\/\.\.\/product.git\n/);
  assert.equal(f.git("reject", result.stdout, recovery.environment).status, 0);
  assert.equal(recovery.canRetry(), true);
});

test("configured self-hosted GitLab recovers from rejection through both global candidates", (t) => {
  const f = fixture(t, { provider: "gitlab", host: "git.example.test", includeCli: true });
  const recovery = createGitCredentialRecovery({
    root: f.root,
    url: "https://git.example.test/team/product.git",
  });
  f.defer(recovery.close);
  const git = (operation, value) => f.git(operation, value, recovery.environment);
  const input = request.replace("github.com", "git.example.test");
  git("approve", input.trim() + "\nusername=local-user\npassword=wrong-project-account\n\n");
  for (const password of ["wrong-project-account", "global-fixture-account"]) {
    const result = git("fill");
    assert.ok(result.stdout.includes(`password=${password}`));
    assert.equal(git("reject", result.stdout).status, 0);
    assert.equal(recovery.canRetry(), true);
  }
  const result = git("fill");
  assert.match(result.stdout, /password=cli-fixture-account/);
  assert.doesNotMatch(result.stdout, /refresh/);
});

test("rejection evidence is private, request-bound, distinct and removed at operation end", (t) => {
  const f = fixture(t);
  const recovery = createGitCredentialRecovery({
    root: f.root,
    url: "https://github.com/team/product.git",
  });
  f.defer(recovery.close);
  const invoke = (input) =>
    globalGitCredential({
      root: f.root,
      hostHome: f.hostHome,
      operation: "erase",
      input,
      inherited: { ...f.env, ...recovery.environment },
    });
  const rejected = request.trim() + "\nusername=user\npassword=deliberately-invalid-fixture\n\n";
  for (const input of [
    rejected.replace("github.com", "gitlab.com"),
    rejected.replace("team/product.git", "other/private.git"),
    rejected.replace("https", "http"),
  ]) {
    assert.equal(invoke(input), "");
    assert.equal(recovery.canRetry(), false);
  }
  assert.equal(invoke(rejected), "");
  assert.equal(recovery.canRetry(), true);
  assert.equal(invoke(rejected), "");
  assert.equal(recovery.canRetry(), false);
  const temporary = prepareProjectToolDirectories(f.root).temporary;
  const entries = readdirSync(temporary);
  assert.equal(entries.length, 1);
  const state = readFileSync(path.join(temporary, entries[0], "state.json"), "utf8");
  assert.doesNotMatch(state, /deliberately-invalid|password|username=user/);
  assert.equal(JSON.parse(state).rejected.length, 1);
  assert.deepEqual(f.calls(), []);
  recovery.close();
  assert.deepEqual(readdirSync(temporary), []);
  assert.equal(recovery.canRetry(), false);
});

test("unconfigured destinations and malformed recovery state cannot grant retries or global access", (t) => {
  const f = fixture(t);
  for (const url of [
    "http://github.com/team/product.git",
    "https://unconfigured.invalid/repo",
    "ssh://git@github.com/repo",
    "https://user:secret@github.com/repo",
    "https://github.com/%bad",
    "https://github.com/repo?other=1",
    "https://github.com/repo%0Ausername=injected",
    "https://github.com/repo%00suffix",
    "https://github.com/repo%0Dsuffix",
  ]) {
    const recovery = createGitCredentialRecovery({ root: f.root, url });
    assert.deepEqual(recovery.environment, {});
    assert.equal(recovery.canRetry(), false);
    recovery.close();
  }
  assert.throws(
    () =>
      globalGitCredential({
        root: f.root,
        hostHome: f.hostHome,
        operation: "get",
        input: request,
        inherited: { ...f.env, CODEXRIG_GIT_CREDENTIAL_RECOVERY: "../../foreign" },
      }),
    /Invalid credential recovery/,
  );
  assert.deepEqual(f.calls(), []);
});

test("recovery refuses a linked marker and never changes its target", (t) => {
  const f = fixture(t);
  const recovery = createGitCredentialRecovery({
    root: f.root,
    url: "https://github.com/team/product.git",
  });
  const temporary = prepareProjectToolDirectories(f.root).temporary;
  const stateFile = path.join(temporary, readdirSync(temporary)[0], "state.json");
  const sentinel = path.join(f.hostHome, "sentinel");
  writeFileSync(sentinel, "untouched");
  const original = readFileSync(stateFile);
  unlinkSync(stateFile);
  symlinkSync(sentinel, stateFile);
  try {
    assert.throws(() => recovery.canRetry());
    assert.throws(() =>
      globalGitCredential({
        root: f.root,
        hostHome: f.hostHome,
        operation: "erase",
        input: request.trim() + "\npassword=invalid-fixture\n\n",
        inherited: { ...f.env, ...recovery.environment },
      }),
    );
    assert.equal(readFileSync(sentinel, "utf8"), "untouched");
  } finally {
    unlinkSync(stateFile);
    writeFileSync(stateFile, original, { mode: 0o600 });
    recovery.close();
  }
});

test("recovery pins its original request, salt, schema and directory identity", (t) => {
  const f = fixture(t);
  const recovery = createGitCredentialRecovery({
    root: f.root,
    url: "https://github.com/team/product.git",
  });
  f.defer(recovery.close);
  const temporary = prepareProjectToolDirectories(f.root).temporary;
  const directory = path.join(temporary, readdirSync(temporary)[0]);
  const stateFile = path.join(directory, "state.json");
  const original = readFileSync(stateFile);
  const erase = () =>
    globalGitCredential({
      root: f.root,
      hostHome: f.hostHome,
      operation: "erase",
      input: request.trim() + "\npassword=invalid-fixture\n\n",
      inherited: { ...f.env, ...recovery.environment },
    });
  for (const mutate of [
    (state) => {
      state.request.host = "gitlab.com";
    },
    (state) => {
      state.request.path = "other/private.git";
    },
    (state) => {
      state.salt = "0".repeat(64);
    },
    (state) => {
      state.schemaVersion = 2;
    },
    (state) => {
      state.extra = true;
    },
    (state) => {
      state.request.extra = true;
    },
  ]) {
    const state = JSON.parse(original);
    mutate(state);
    writeFileSync(stateFile, JSON.stringify(state));
    try {
      assert.throws(() => recovery.canRetry(), /Invalid credential recovery state/);
      assert.throws(erase, /Invalid credential recovery state/);
    } finally {
      writeFileSync(stateFile, original);
    }
  }
  const retained = `${directory}.original`;
  renameSync(directory, retained);
  mkdirSync(directory, { mode: 0o700 });
  writeFileSync(stateFile, original, { mode: 0o600 });
  try {
    assert.throws(() => recovery.canRetry(), /directory binding changed/);
    assert.throws(erase, /directory binding changed/);
    assert.throws(() => recovery.close(), /directory binding changed/);
    assert.deepEqual(readFileSync(stateFile), original);
  } finally {
    rmSync(directory, { recursive: true });
    renameSync(retained, directory);
  }
  assert.deepEqual(f.calls(), []);
});

test("other hosts, insecure transport, malformed requests and writes never consult global accounts", (t) => {
  const f = fixture(t);
  for (const input of [
    request.replace("github.com", "unconfigured.invalid"),
    request.replace("github.com", "github.com.attacker.invalid"),
    request.replace("https", "http"),
    request.replace("path=", "host="),
  ]) {
    assert.equal(
      globalGitCredential({
        root: f.root,
        hostHome: f.hostHome,
        operation: "get",
        input,
        inherited: f.env,
      }),
      "",
    );
  }
  for (const operation of ["store", "erase"])
    assert.equal(
      globalGitCredential({
        root: f.root,
        hostHome: f.hostHome,
        operation,
        input: request,
        inherited: f.env,
      }),
      "",
    );
  assert.deepEqual(f.calls(), []);
});

test("configured self-hosted GitLab uses its existing CLI account", (t) => {
  const f = fixture(t, { cli: true, provider: "gitlab", host: "git.example.test" });
  assert.equal(f.git("fill").status, 0);
  assert.equal(f.calls().length, 1);
});
