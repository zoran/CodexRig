/** Verifies release candidate isolation and continuing development through the existing CLI/Git gates. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { inspectRuntimeSessionLease } from "../repository/runtime-session-lease.mjs";
import { ownSession, publicationFixture } from "./project-publication.fixture.mjs";
import { parsePublicationArguments } from "./project-publication.mjs";

function freeze(f) {
  f.run("git", ["add", "--all"]);
  return `${f.run("git", ["rev-parse", "HEAD"]).trim()}:${f.run("git", ["write-tree"]).trim()}`;
}

function publish(f, candidate) {
  return f.runResult("bash", [
    "-p",
    "scripts/setup/run-project.sh",
    "pnpm",
    "project:publish",
    "--message",
    "Frozen release",
    "--candidate",
    candidate,
  ]);
}

test("candidate arguments require literal full object identities without bypass flags", () => {
  for (const width of [40, 64]) {
    const candidate = `${"a".repeat(width)}:${"b".repeat(width)}`;
    assert.deepEqual(
      parsePublicationArguments(["--message", "release", "--candidate", candidate, "--verbose"]),
      {
        message: "release",
        candidate,
        verbose: true,
      },
    );
  }
  for (const suffix of [
    ["--candidate"],
    ["--candidate", "HEAD:tree"],
    ["--candidate", "a:b"],
    ["--candidate", `${"a".repeat(40)}:${"b".repeat(64)}`],
    ["--skip-hooks"],
    ["--verbose", "--verbose"],
  ])
    assert.throws(() => parsePublicationArguments(["--message", "release", ...suffix]), /Usage/u);
});

test("an active independent writer continues while the frozen clone publishes and reuses evidence", async (t) => {
  const f = publicationFixture(t);
  const development = path.join(path.dirname(f.root), "development");
  f.run("git", ["clone", "--no-local", "--no-hardlinks", f.root, development]);
  const releaseSession = ownSession(f.root);
  const developmentSession = ownSession(development);
  const writer = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import {writeFileSync} from 'node:fs';
    let count = 0;
    const write = () => writeFileSync('src/product.mjs', 'export const product = ' + (++count) + ';\\n');
    write(); process.send('ready'); setInterval(write, 5);
  `,
    ],
    { cwd: development, stdio: ["ignore", "ignore", "pipe", "ipc"] },
  );
  // This fixture owns the exact child handle, checkout and active leases; stop only that handle.
  try {
    await once(writer, "message");
    const before = readFileSync(path.join(development, "src/product.mjs"), "utf8");
    const candidate = freeze(f);
    const first = publish(f, candidate);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.notEqual(readFileSync(path.join(development, "src/product.mjs"), "utf8"), before);
    assert.equal(writer.exitCode, null);
    assert.deepEqual(
      inspectRuntimeSessionLease({ root: development }).lease,
      developmentSession.lease,
    );
    const commit = f.run("git", ["rev-parse", "HEAD"]).trim();
    assert.equal(
      f.run("git", ["ls-remote", "origin", "refs/heads/main"]).trim(),
      `${commit}\trefs/heads/main`,
    );
    assert.equal(
      f.run("git", ["show", `${commit}:src/product.mjs`]).trim(),
      "export const product = 2;",
    );
    assert.equal(f.counter().length, 1);
    // A completed commit is explicitly reconciled, then rebound; handoff alone never replays tests.
    const retry = publish(f, freeze(f));
    assert.equal(retry.status, 0, retry.stdout + retry.stderr);
    assert.equal(f.counter().length, 1);
    assert.equal(f.run("git", ["rev-parse", "HEAD"]).trim(), commit);
  } finally {
    const stopped = once(writer, "exit");
    writer.kill();
    await stopped;
    developmentSession.close();
    releaseSession.close();
  }
});

test("candidate source, index and HEAD mutations are rejected before verification or push", async (t) => {
  for (const mutation of ["source", "index", "head"])
    await t.test(mutation, (t) => {
      const f = publicationFixture(t);
      const candidate = freeze(f);
      const remote = f.run("git", ["ls-remote", "origin", "refs/heads/main"]);
      if (mutation === "source") f.write("src/product.mjs", "export const product = 3;\n");
      else if (mutation === "index") f.run("git", ["reset", "HEAD", "--", "src/product.mjs"]);
      else f.run("git", ["commit", "--allow-empty", "--message", "Changed HEAD"]);
      const result = publish(f, candidate);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /Source changed.*candidate handoff/u);
      assert.equal(f.counter().length, 0);
      assert.equal(f.run("git", ["ls-remote", "origin", "refs/heads/main"]), remote);
    });
});

test("an index-only change during verification cannot silently redefine the accepted candidate", (t) => {
  const f = publicationFixture(t, {
    configure({ write }) {
      write(
        "fixture-product.mjs",
        `import {spawnSync} from 'node:child_process';
const result = spawnSync('git', ['reset', 'HEAD', '--', 'src/product.mjs']);
process.exitCode = result.status;\n`,
      );
    },
  });
  const candidate = freeze(f);
  const remote = f.run("git", ["ls-remote", "origin", "refs/heads/main"]);
  const result = publish(f, candidate);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /changed|drift/iu);
  assert.equal(f.run("git", ["ls-remote", "origin", "refs/heads/main"]), remote);
});
