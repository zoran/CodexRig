/** Exercises real publication, adaptive evidence and pre-push across isolated project process boundaries. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  prepareProjectToolDirectories,
  projectToolEnvironment,
} from "../repository/project-tool-environment.mjs";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function publicationFixture(t, { globalIdentity = false } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "publication-verification-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "product");
  const bin = path.join(directory, "bin");
  const remote = path.join(directory, "upstream.git");
  let identity = null;
  mkdirSync(root);
  mkdirSync(bin);
  prepareProjectToolDirectories(root);
  const write = (relative, content, mode = 0o600) => {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, content, { mode });
  };
  const nativeGit = process.env.PATH.split(path.delimiter)
    .map((item) => path.resolve(item, "git"))
    .find((candidate) => {
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  assert.ok(nativeGit);
  // The public wrapper intentionally reconstructs its environment. Bind Git itself to file-only
  // transport so nested publisher, installer, scanner and pre-push processes cannot use a network.
  writeFileSync(
    path.join(bin, "git"),
    `#!/bin/sh\nexport GIT_ALLOW_PROTOCOL=file\nexec ${quote(nativeGit)} "$@"\n`,
    { mode: 0o700 },
  );
  const environment = {
    ...projectToolEnvironment({ root, inherited: process.env }),
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    GIT_ALLOW_PROTOCOL: "file",
    NODE_ENV: "production",
    VERIFY_MAX_CAPTURE_BYTES: "1048576",
    VERIFY_MAX_PARALLEL: "2",
    IMAGE_ASSET_MAX_BYTES: "12345",
  };
  const runResult = (command, args, extraEnvironment = {}) =>
    spawnSync(command, args, {
      cwd: root,
      env: { ...environment, ...extraEnvironment, GIT_ALLOW_PROTOCOL: "file" },
      encoding: "utf8",
      input: "",
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
    });
  const run = (command, args, extraEnvironment = {}) => {
    const result = runResult(command, args, extraEnvironment);
    assert.equal(
      result.status,
      0,
      `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
    );
    return `${result.stdout}${result.stderr}`;
  };
  const copied = new Set();
  const copyModule = (relative) => {
    if (copied.has(relative)) return;
    assert.equal(relative.startsWith("scripts/"), true, relative);
    copied.add(relative);
    const text = readFileSync(path.join(sourceRoot, relative), "utf8");
    write(relative, text);
    for (const match of text.matchAll(/(?:from\s*|import\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/gu))
      copyModule(path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1])));
  };
  for (const file of [
    "scripts/goals/publish-project.mjs",
    "scripts/setup/install-git-hooks.mjs",
    "scripts/setup/project-command.mjs",
    "scripts/repository/worktree-recovery-cli.mjs",
    "scripts/deps/verify-pnpm-execution-policy.mjs",
    "scripts/verify/adaptive.mjs",
    "scripts/verify/pre-push-policy.mjs",
    "scripts/verify/pushed-object-scan.mjs",
  ])
    copyModule(file);
  for (const file of [
    "scripts/git-hooks/pre-push",
    "scripts/verify/pre-push.sh",
    "scripts/verify/pre-push-steps.sh",
  ])
    write(file, readFileSync(path.join(sourceRoot, file), "utf8"), 0o700);
  // Installed-tool admission and the optional OS-home location are fixture seams; project-command,
  // publication gates, identity resolution, adaptive evidence, hooks and local Git all execute.
  write(
    ".auth/fixture-mise",
    '#!/bin/sh\nexport GIT_ALLOW_PROTOCOL=file\nshift 3\nexec "$@"\n',
    0o700,
  );
  write(
    "scripts/setup/run-project.sh",
    '#!/bin/sh\nexec node fixture-project-command.mjs "$@"\n',
    0o700,
  );
  write(
    "fixture-project-command.mjs",
    `import {runProjectCommand} from ${JSON.stringify(pathToFileURL(path.join(root, "scripts/setup/project-command.mjs")).href)};
import path from 'node:path';
const [command,...args]=process.argv.slice(2);
process.exitCode=await runProjectCommand({root:process.cwd(),command,args,miseExecutable:path.join(process.cwd(),'.auth/fixture-mise')});\n`,
  );
  if (globalIdentity) {
    const home = path.join(directory, "global-home");
    const hooks = path.join(home, "hooks");
    mkdirSync(hooks, { recursive: true, mode: 0o700 });
    const marker = path.join(home, "unexpected-global-program");
    const trap = path.join(home, "forbidden-program");
    const trapSource = `#!/bin/sh\nprintf '%s\\n' forbidden >> ${quote(marker)}\nexit 97\n`;
    writeFileSync(trap, trapSource, { mode: 0o700 });
    for (const hook of ["pre-commit", "commit-msg", "post-commit", "pre-push"])
      writeFileSync(path.join(hooks, hook), trapSource, { mode: 0o700 });
    const included = path.join(home, "excluded-identity.gitconfig");
    writeFileSync(included, "[user]\nname = Excluded Identity\nemail = excluded@example.invalid\n");
    const withoutIdentity = [
      "[include]",
      `path = ${JSON.stringify(included)}`,
      "[core]",
      `hooksPath = ${JSON.stringify(hooks)}`,
      "[credential]",
      `helper = ${JSON.stringify(`!${quote(trap)}`)}`,
      "[commit]",
      "gpgsign = true",
      "[gpg]",
      `program = ${JSON.stringify(trap)}`,
      "",
    ].join("\n");
    const name = "Global Publication Fixture";
    const email = "global-publication@example.invalid";
    const content = `[user]\nname = ${name}\nemail = ${email}\n${withoutIdentity}`;
    const config = path.join(home, ".gitconfig");
    writeFileSync(config, content, { mode: 0o600 });
    write(
      "fixture-publication-entry.mjs",
      `import os from 'node:os';
const originalUserInfo=os.userInfo;
os.userInfo=(...args)=>({...originalUserInfo(...args),homedir:${JSON.stringify(home)}});
await import(${JSON.stringify(pathToFileURL(path.join(root, "scripts/goals/publish-project.mjs")).href)});\n`,
    );
    identity = { config, content, withoutIdentity, marker, name, email };
  }
  // An isolated local bare repository deliberately has no hosted-provider identity to validate.
  write("scripts/verify/git-remote-identity.mjs", "process.exitCode=0;\n");
  write(".gitignore", "/.auth/\n/.codex/runtime/\n/node_modules/\n/docs/project-context.md\n");
  write("docs/project-context.md", "Private fixture working context.\n");
  write(".codex/tooling.json", readFileSync(path.join(sourceRoot, ".codex/tooling.json"), "utf8"));
  write(".codex/mise.toml", "[tools]\n");
  write(".codex/mise.lock", "# Fixture has no provisioned tool dependencies.\n");
  write("pnpm-workspace.yaml", "packages: []\n");
  write(
    "package.json",
    JSON.stringify({
      name: "publication-verification-fixture",
      private: true,
      packageManager: JSON.parse(readFileSync(path.join(sourceRoot, "package.json"), "utf8"))
        .packageManager,
      scripts: {
        verify: "node scripts/verify/adaptive.mjs --mode full",
        "project:publish": globalIdentity
          ? "node fixture-publication-entry.mjs"
          : "node scripts/goals/publish-project.mjs",
        "worktree:status": "node scripts/repository/worktree-recovery-cli.mjs",
        "hooks:install": "node scripts/setup/install-git-hooks.mjs",
      },
    }),
  );
  write(
    ".codex/verification.json",
    JSON.stringify({
      schemaVersion: 1,
      commands: [
        {
          key: "product",
          executable: "$node",
          args: ["fixture-product.mjs"],
          phase: "broad",
        },
      ],
      prePushChecks: [],
      risks: [],
      testConsumers: {},
      exactConsumers: {},
      ownedCategories: {},
    }),
  );
  write(
    "fixture-product.mjs",
    `import {appendFileSync} from 'node:fs';
appendFileSync('.auth/product-checks.jsonl',JSON.stringify(Object.fromEntries(['NODE_ENV','VERIFY_MAX_CAPTURE_BYTES','VERIFY_MAX_PARALLEL','IMAGE_ASSET_MAX_BYTES'].map(key=>[key,process.env[key]])))+'\\n');\n`,
  );
  write("src/product.mjs", "export const product = 1;\n");
  // Real projects have a committed lockfile before publication; first-use pnpm preparation must
  // not create unrelated source while the failure scenario checks preservation of dirty state.
  run("pnpm", ["install", "--lockfile-only", "--offline", "--ignore-scripts"]);
  run("git", ["init", "--initial-branch=main"]);
  run("git", ["config", "user.name", "Publication Verification Fixture"]);
  run("git", ["config", "user.email", "publication@example.invalid"]);
  run("git", ["config", "commit.gpgsign", "false"]);
  run("git", ["init", "--bare", "--initial-branch=main", remote]);
  run("git", ["add", "."]);
  // Existing children may have tracked this file before its portable privacy rule existed.
  run("git", ["add", "--force", "--", "docs/project-context.md"]);
  run("git", ["commit", "--message", "Fixture basis"]);
  run("git", ["remote", "add", "origin", remote]);
  run("git", ["push", "--set-upstream", "origin", "main"]);
  if (globalIdentity)
    for (const key of ["user.name", "user.email", "commit.gpgsign"])
      run("git", ["config", "--local", "--unset", key]);
  run("git", ["rm", "--cached", "--", "docs/project-context.md"]);
  write("src/product.mjs", "export const product = 2;\n");
  const counter = () =>
    existsSync(path.join(root, ".auth/product-checks.jsonl"))
      ? readFileSync(path.join(root, ".auth/product-checks.jsonl"), "utf8")
          .trim()
          .split("\n")
          .map(JSON.parse)
      : [];
  return { root, remote, run, runResult, counter, write, identity };
}

// Fetch must reveal independent upstream commits without modifying dirty or staged local source.
test("real publication preserves local changes when fetch reveals six upstream commits", (t) => {
  const f = publicationFixture(t);
  const snapshot = () => ({
    head: f.run("git", ["rev-parse", "HEAD"]).trim(),
    index: f.run("git", ["write-tree"]).trim(),
    staged: f.run("git", ["diff", "--cached", "--binary"]),
    unstaged: f.run("git", ["diff", "--binary"]),
    status: f.run("git", ["status", "--porcelain=v1", "--untracked-files=all"]),
    product: readFileSync(path.join(f.root, "src/product.mjs"), "utf8"),
    context: readFileSync(path.join(f.root, "docs/project-context.md"), "utf8"),
  });
  const before = snapshot();
  assert.match(before.status, /^D  docs\/project-context\.md$/mu);
  assert.match(before.status, /^ M src\/product\.mjs$/mu);
  const tree = f.run("git", ["rev-parse", "HEAD^{tree}"]).trim();
  let upstream = before.head;
  for (let index = 1; index <= 6; index += 1) {
    upstream = f
      .run("git", [
        "--git-dir",
        f.remote,
        "-c",
        "user.name=Remote Fixture",
        "-c",
        "user.email=remote@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit-tree",
        tree,
        "-p",
        upstream,
        "-m",
        `Independent upstream change ${index}`,
      ])
      .trim();
  }
  f.run("git", ["--git-dir", f.remote, "update-ref", "refs/heads/main", upstream, before.head]);
  assert.equal(f.run("git", ["rev-parse", "origin/main"]).trim(), before.head);

  const result = f.runResult("bash", [
    "scripts/setup/run-project.sh",
    "pnpm",
    "project:publish",
    "--message",
    "Preserve unpublished local changes",
  ]);
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1);
  const output = `${result.stdout}${result.stderr}`;
  assert.match(output, /6 commit\(s\) behind "origin\/main"/u);
  assert.match(output, /local changes.*preserved.*reconciled/iu);
  assert.match(output, /bash scripts\/setup\/run-project\.sh git merge --ff-only/u);
  assert.doesNotMatch(output, /Prepare source|Verify source|Publish to upstream/u);
  assert.deepEqual(snapshot(), before);
  assert.equal(f.run("git", ["rev-parse", "origin/main"]).trim(), upstream);
  assert.equal(
    f.run("git", ["rev-list", "--left-right", "--count", "HEAD...origin/main"]).trim(),
    "0\t6",
  );
  assert.equal(
    f.run("git", ["--git-dir", f.remote, "rev-parse", "refs/heads/main"]).trim(),
    upstream,
  );
  assert.equal(f.counter().length, 0, "upstream reconciliation must precede product verification");
  assert.equal(existsSync(path.join(f.root, ".git/hooks/pre-push")), false);
});

test("real publication isolates global author metadata, reuses evidence and refuses missing identity early", (t) => {
  const f = publicationFixture(t, { globalIdentity: true });
  for (const key of ["user.name", "user.email"])
    assert.equal(f.runResult("git", ["config", "--local", "--get", key]).status, 1);
  f.run("bash", ["scripts/setup/run-project.sh", "pnpm", "verify"]);
  assert.equal(f.counter().length, 1);
  const publishArgs = [
    "scripts/setup/run-project.sh",
    "pnpm",
    "project:publish",
    "--message",
    "Verified fixture",
    "--verbose",
  ];
  const first = f.run("bash", publishArgs);
  assert.match(first, /Pre-push verification passed/);
  assert.equal(
    f.run("git", ["log", "-1", "--format=%an%n%ae%n%cn%n%ce"]).trim(),
    [f.identity.name, f.identity.email, f.identity.name, f.identity.email].join("\n"),
    "the actual commit must pin global public metadata as both author and committer",
  );
  assert.equal(
    f.counter().length,
    1,
    "publication and pre-push must reuse successful product coverage",
  );
  assert.equal(
    f.run("git", ["ls-remote", f.remote, "refs/heads/main"]).trim(),
    `${f.run("git", ["rev-parse", "HEAD"]).trim()}\trefs/heads/main`,
  );
  assert.equal(
    readFileSync(path.join(f.root, "docs/project-context.md"), "utf8"),
    "Private fixture working context.\n",
  );
  assert.equal(
    f.run("git", ["ls-tree", "--name-only", "HEAD", "docs/project-context.md"]),
    "",
    "private working context must survive locally without entering publication",
  );
  f.run("bash", publishArgs);
  assert.equal(
    f.counter().length,
    1,
    "an unchanged publication must keep the same product evidence",
  );
  f.run("bash", publishArgs, { NODE_ENV: "test" });
  assert.equal(f.counter().length, 2, "a semantic runtime change must still invalidate coverage");
  assert.deepEqual(
    f.counter().map((record) => record.NODE_ENV),
    ["production", "test"],
  );
  assert.equal(
    f
      .counter()
      .every(
        (record) =>
          record.VERIFY_MAX_CAPTURE_BYTES === "1048576" &&
          record.VERIFY_MAX_PARALLEL === "2" &&
          record.IMAGE_ASSET_MAX_BYTES === "12345",
      ),
    true,
  );
  assert.equal(readFileSync(f.identity.config, "utf8"), f.identity.content);
  assert.equal(existsSync(f.identity.marker), false, "global programs must never execute");

  // An included identity is deliberately insufficient: only the two explicit global user keys
  // may fill the project's missing fields, and refusal must precede another product verification.
  writeFileSync(f.identity.config, f.identity.withoutIdentity);
  f.write("src/product.mjs", "export const product = 3;\n");
  const head = f.run("git", ["rev-parse", "HEAD"]);
  const index = f.run("git", ["write-tree"]);
  const status = f.run("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  const missing = f.runResult("bash", publishArgs);
  assert.equal(missing.error, undefined);
  assert.equal(missing.signal, null);
  assert.equal(missing.status, 1);
  const failure = `${missing.stdout}${missing.stderr}`;
  assert.match(failure, /Publication needs valid Git author and committer metadata/u);
  assert.match(failure, /bash scripts\/setup\/run-project\.sh git config --local user\.name/u);
  assert.match(failure, /bash scripts\/setup\/run-project\.sh git config --local user\.email/u);
  assert.doesNotMatch(failure, /Verify source|Create commit|Publish to upstream/u);
  assert.equal(f.counter().length, 2, "missing identity must fail before expensive verification");
  assert.equal(f.run("git", ["rev-parse", "HEAD"]), head);
  assert.equal(f.run("git", ["write-tree"]), index);
  assert.equal(f.run("git", ["status", "--porcelain=v1", "--untracked-files=all"]), status);
  assert.equal(
    readFileSync(path.join(f.root, "src/product.mjs"), "utf8"),
    "export const product = 3;\n",
  );
  assert.equal(readFileSync(f.identity.config, "utf8"), f.identity.withoutIdentity);
  assert.equal(existsSync(f.identity.marker), false);
});
