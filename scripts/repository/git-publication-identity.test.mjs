/** Native Git proves publication identity precedence without importing host account configuration. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolvePublicationIdentity } from "./git-publication-identity.mjs";
import {
  prepareProjectToolDirectories,
  projectToolEnvironment,
} from "./project-tool-environment.mjs";

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "publication-identity-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "project");
  const userHome = path.join(directory, "synthetic-user");
  mkdirSync(root);
  mkdirSync(userHome);
  prepareProjectToolDirectories(root);
  const environment = projectToolEnvironment({ root });
  const git = (args, overrides = {}) =>
    spawnSync("git", args, {
      cwd: root,
      env: { ...environment, ...overrides },
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 64 * 1024,
    });
  const initialized = git(["-c", "init.templateDir=", "init", "--quiet"]);
  assert.equal(initialized.status, 0, initialized.stderr);
  const config = (key, value, file) => {
    if (file) mkdirSync(path.dirname(file), { recursive: true });
    const result = git(["config", ...(file ? ["--file", file] : ["--local"]), key, value]);
    assert.equal(result.status, 0, result.stderr);
  };
  const globalFile = path.join(userHome, ".gitconfig");
  return {
    directory,
    root,
    userHome,
    git,
    config,
    globalFile,
    projectGlobalFile: environment.GIT_CONFIG_GLOBAL,
    global(key, value) {
      config(key, value, globalFile);
    },
    resolve(options = {}) {
      return resolvePublicationIdentity({ root, userHome, ...options });
    },
  };
}

function expected(name, email, committerName = name, committerEmail = email) {
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: committerName,
    GIT_COMMITTER_EMAIL: committerEmail,
  };
}

function assertNativeIdentity(f, identity) {
  assert.deepEqual(Object.keys(identity).sort(), Object.keys(expected("", "")).sort());
  for (const role of ["AUTHOR", "COMMITTER"]) {
    const result = f.git(["-c", "user.useConfigOnly=true", "var", `GIT_${role}_IDENT`], identity);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout.replace(/ \d+ [+-]\d{4}\n$/u, ""),
      `${identity[`GIT_${role}_NAME`]} <${identity[`GIT_${role}_EMAIL`]}>`,
    );
  }
}

test("missing project metadata reuses Unicode global identity as four native Git pins", (t) => {
  const f = fixture(t);
  f.global("user.name", "Zoë Živković 東京");
  f.global("user.email", "zoe@example.test");
  const identity = f.resolve();
  assert.deepEqual(identity, expected("Zoë Živković 東京", "zoe@example.test"));
  assertNativeIdentity(f, identity);
});

for (const field of ["both", "name", "email"])
  test(`project identity wins ${field}; global fills only absent fields`, (t) => {
    const f = fixture(t);
    f.global("user.name", "Global Name");
    f.global("user.email", "global@example.test");
    if (field !== "email") f.config("user.name", "Project Name");
    if (field !== "name") f.config("user.email", "project@example.test");
    const identity = f.resolve();
    assert.deepEqual(
      identity,
      expected(
        field === "email" ? "Global Name" : "Project Name",
        field === "name" ? "global@example.test" : "project@example.test",
      ),
    );
    assertNativeIdentity(f, identity);
  });

test("repository-private global metadata participates before host fallback", (t) => {
  const f = fixture(t);
  f.global("user.name", "Host Name");
  f.global("user.email", "host@example.test");
  f.config("user.name", "Private Project Name", f.projectGlobalFile);
  f.config("user.email", "private-project@example.test", f.projectGlobalFile);
  f.config("user.email", "repository@example.test");
  assert.deepEqual(f.resolve(), expected("Private Project Name", "repository@example.test"));
});

test("explicit author and committer configuration retains native precedence without global reads", (t) => {
  const f = fixture(t);
  f.config("author.name", "Original Author");
  f.config("author.email", "author@example.test");
  f.config("committer.name", "Publishing Committer");
  f.config("committer.email", "committer@example.test");
  // A malformed host config must remain irrelevant when both project identities are complete.
  writeFileSync(f.globalFile, "[invalid host configuration\n");
  const identity = f.resolve();
  assert.deepEqual(
    identity,
    expected(
      "Original Author",
      "author@example.test",
      "Publishing Committer",
      "committer@example.test",
    ),
  );
  assertNativeIdentity(f, identity);
});

test("role-specific project fields survive filling missing common user metadata", (t) => {
  const f = fixture(t);
  f.config("author.name", "Original Author");
  f.config("committer.email", "committer@example.test");
  f.global("user.name", "Global Name");
  f.global("user.email", "global@example.test");
  const identity = f.resolve();
  assert.deepEqual(
    identity,
    expected("Original Author", "global@example.test", "Global Name", "committer@example.test"),
  );
  assertNativeIdentity(f, identity);
});

test("missing identity fails with project-bound configuration commands instead of host guesses", (t) => {
  const f = fixture(t);
  assert.throws(f.resolve, (error) => {
    assert.match(error.message, /run-project\.sh.*git config --local user\.name/u);
    assert.match(error.message, /run-project\.sh.*git config --local user\.email/u);
    return true;
  });
});

for (const [key, value] of [
  ["user.name", ""],
  ["user.email", ""],
  ["user.name", "invalid\nprivate-native-detail"],
  ["user.email", "invalid\rprivate-native-detail"],
  ["author.name", ""],
  ["committer.email", "invalid\nprivate-native-detail"],
])
  test(`present invalid ${key} is rejected, never repaired using global metadata (${JSON.stringify(value).slice(0, 12)})`, (t) => {
    const f = fixture(t);
    f.config("user.name", "Project Name");
    f.config("user.email", "project@example.test");
    f.config(key, value);
    f.global("user.name", "Global Name");
    f.global("user.email", "global@example.test");
    assert.throws(f.resolve, (error) => {
      assert.match(error.message, /git config --local/u);
      assert.doesNotMatch(error.message, /private-native-detail/u);
      return true;
    });
  });

test("global includes, hooks, signing and credential helpers neither affect identity nor execute", (t) => {
  const f = fixture(t);
  const included = path.join(f.userHome, "included.config");
  const executable = path.join(f.userHome, "pre-commit");
  const sentinel = path.join(f.userHome, "executed");
  writeFileSync(
    executable,
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)},'executed');\n`,
    { mode: 0o700 },
  );
  f.config("user.name", "Included Name", included);
  f.config("user.email", "included@example.test", included);
  f.global("user.name", "Allowed Global Name");
  f.global("user.email", "allowed@example.test");
  f.global("include.path", included);
  f.global("core.hooksPath", path.dirname(executable));
  f.global("credential.helper", `!${executable}`);
  f.global("gpg.program", executable);
  f.global("commit.gpgSign", "true");
  const files = [f.globalFile, included, path.join(f.root, ".git/config"), executable];
  const before = files.map((file) => readFileSync(file));
  const globalReads = [];
  const identity = f.resolve({
    runGit(command, args, options) {
      if (args.includes("--global")) {
        assert(args.includes("--no-includes"));
        assert(args.includes("--get"));
        assert.equal(options.env.HOME, f.userHome);
        assert(["user.name", "user.email"].includes(args.at(-1)));
        globalReads.push(args.at(-1));
      }
      return spawnSync(command, args, options);
    },
  });
  assert.deepEqual(globalReads.sort(), ["user.email", "user.name"]);
  assert.deepEqual(identity, expected("Allowed Global Name", "allowed@example.test"));
  assertNativeIdentity(f, identity);
  assert.equal(existsSync(sentinel), false);
  assert.deepEqual(
    files.map((file) => readFileSync(file)),
    before,
  );
  assert.equal(
    existsSync(f.projectGlobalFile),
    false,
    "Global fallback must not persist copied metadata",
  );
});

test("an included global email cannot complete otherwise missing metadata", (t) => {
  const f = fixture(t);
  const included = path.join(f.userHome, "included.config");
  f.config("user.email", "included@example.test", included);
  f.global("user.name", "Global Name");
  f.global("include.path", included);
  assert.throws(f.resolve, /git config --local user\.email/u);
});
