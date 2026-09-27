/** Exercises real publication, adaptive evidence and pre-push across isolated project process boundaries. */
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { inspectRuntimeSessionLease } from "../repository/runtime-session-lease.mjs";
import { ownSession, publicationFixture } from "./project-publication.fixture.mjs";

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

test("the public command publishes inside its owning session without clearing runtime", (t) => {
  const f = publicationFixture(t);
  const session = ownSession(f.root);
  try {
    writeFileSync(path.join(f.root, "src/product.mjs"), "export const product = 2;\n");
    const output = f.run("bash", [
      "scripts/setup/run-project.sh",
      "pnpm",
      "project:publish",
      "--message",
      "Publish in session",
    ]);
    assert.match(output, /All 8 phases completed/u);
    assert.deepEqual(inspectRuntimeSessionLease({ root: f.root }).lease, session.lease);
    assert.equal(f.run("git", ["status", "--porcelain"]).trim(), "");
    assert.equal(
      f.run("git", ["rev-parse", "HEAD"]).trim(),
      f.run("git", ["--git-dir", f.remote, "rev-parse", "refs/heads/main"]).trim(),
    );
    assert.equal(f.counter().length, 1, "pre-push reuses exact verified evidence");
  } finally {
    session.close();
  }
});
