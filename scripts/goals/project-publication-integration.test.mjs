/** Exercises real publication, adaptive evidence and pre-push across isolated project process boundaries. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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

test("development and publication retain independent check successes across retries and repairs", (t) => {
  const f = publicationFixture(t, {
    configure({ root, write }) {
      const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
      pkg.scripts["verify:changed"] = "node scripts/verify/adaptive.mjs --mode repo";
      pkg.scripts["test:unit"] = "node fixture-workspace.mjs";
      write("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\npnpmfile: []\n");
      write(
        "packages/independent/package.json",
        JSON.stringify({
          name: "independent",
          private: true,
          scripts: {
            "test:unit": "node check.mjs independent",
            "test:integration": "node check.mjs integration",
          },
        }),
      );
      write("packages/independent/src/index.mjs", "export const independent = 1;\n");
      write(
        "packages/independent/check.mjs",
        "import {appendFileSync} from 'node:fs';\nimport assert from 'node:assert/strict';\n" +
          `import {independent} from ${JSON.stringify("./src/index.mjs")};\n` +
          "appendFileSync('../../.auth/product-checks.jsonl', JSON.stringify({case: process.argv[2]}) + '\\n');\nassert.ok(independent > 0);\n",
      );
      write(
        "fixture-workspace.mjs",
        "import {appendFileSync} from 'node:fs';\nappendFileSync('.auth/product-checks.jsonl', '{\"case\":\"workspace\"}\\n');\n",
      );
      write("package.json", JSON.stringify(pkg));
      const config = JSON.parse(readFileSync(path.join(root, ".codex/verification.json"), "utf8"));
      config.commands = ["shared", "product", "consumer"].map((key) => ({
        key,
        label: key,
        reason: "fixture contract",
        executable: "$node",
        args: ["--test", `src/${key}.test.mjs`],
        phase: "broad",
      }));
      config.exactConsumers = { "src/product.mjs": ["product", "consumer"] };
      write(".codex/verification.json", JSON.stringify(config));
      for (const key of ["shared", "product", "consumer"])
        write(
          `src/${key}.test.mjs`,
          `import {appendFileSync} from 'node:fs';\n` +
            `import assert from 'node:assert/strict';\n` +
            (key === "shared"
              ? ""
              : `import {product} from ${JSON.stringify("./product.mjs")};\n`) +
            `appendFileSync('.auth/product-checks.jsonl', '${JSON.stringify({ case: key })}\\n');\n` +
            (key === "product" ? "assert.ok(product >= 0);\n" : "assert.ok(true);\n"),
        );
    },
  });
  const run = (...args) => f.run("bash", ["scripts/setup/run-project.sh", "pnpm", ...args]);
  const counts = () =>
    Object.fromEntries(
      ["shared", "product", "consumer", "workspace", "independent", "integration"].map((key) => [
        key,
        f.counter().filter((row) => row.case === key).length,
      ]),
    );
  run("verify:changed");
  assert.deepEqual(
    counts(),
    { shared: 0, product: 1, consumer: 1, workspace: 1, independent: 0, integration: 0 },
    "development must not bootstrap full coverage",
  );
  run("verify:changed");
  assert.deepEqual(
    counts(),
    { shared: 0, product: 1, consumer: 1, workspace: 1, independent: 0, integration: 0 },
    "a checkpoint is not a new test trigger",
  );
  run("verify");
  assert.deepEqual(
    counts(),
    { shared: 1, product: 1, consumer: 1, workspace: 1, independent: 1, integration: 1 },
    "publication fills only missing coverage",
  );
  const publish = ["project:publish", "--message", "Publish once verified inputs", "--verbose"];
  writeFileSync(path.join(f.remote, "hooks/pre-receive"), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
  const rejected = f.runResult("bash", ["scripts/setup/run-project.sh", "pnpm", ...publish]);
  assert.equal(rejected.status, 1);
  const rejectedCommit = f.run("git", ["rev-parse", "HEAD"]);
  writeFileSync(path.join(f.remote, "hooks/pre-receive"), "#!/bin/sh\nexit 0\n");
  run(...publish);
  assert.equal(
    f.run("git", ["rev-parse", "HEAD"]),
    rejectedCommit,
    "retry preserves the verified commit",
  );
  assert.deepEqual(
    counts(),
    { shared: 1, product: 1, consumer: 1, workspace: 1, independent: 1, integration: 1 },
    "manual verifier, publisher and pre-push share evidence",
  );
  f.write("src/product.mjs", "export const product = -1;\n");
  const failed = f.runResult("bash", ["scripts/setup/run-project.sh", "pnpm", "verify"]);
  assert.equal(failed.status, 1);
  const afterFailure = counts();
  assert.equal(afterFailure.shared, 1, "an unrelated success survives a failed publication check");
  f.write("src/product.mjs", "export const product = 3;\n");
  run(...publish);
  assert.equal(counts().shared, 1);
  assert.equal(counts().product, afterFailure.product + 1);
  assert.equal(counts().workspace, afterFailure.workspace + 1);
  assert.equal(
    counts().consumer,
    afterFailure.consumer + 1,
    "changed consumers are invalidated too",
  );
  const beforePackageChange = counts();
  f.write("packages/independent/src/index.mjs", "export const independent = 2;\n");
  run("verify:changed");
  assert.deepEqual(
    counts(),
    { ...beforePackageChange, independent: 2 },
    "development selects only the affected package's unit check",
  );
  run(...publish);
  assert.deepEqual(
    counts(),
    { ...beforePackageChange, independent: 2, integration: 2 },
    "publication-only workspace consumers bind their package source without replaying unit checks",
  );
});

test("new tests, plan edits and editorial changes never bootstrap or replay the product suite", (t) => {
  const f = publicationFixture(t, {
    configure({ root, write }) {
      const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
      pkg.scripts["verify:changed"] = "node scripts/verify/adaptive.mjs --mode repo";
      write("package.json", JSON.stringify(pkg));
      const config = JSON.parse(readFileSync(path.join(root, ".codex/verification.json"), "utf8"));
      config.commands = ["one", "two"].map((key) => ({
        key,
        label: key,
        reason: "fixture test",
        executable: "$node",
        args: ["--test", `src/${key}.test.mjs`],
        phase: "broad",
      }));
      config.exactConsumers = { "src/product.mjs": ["one"] };
      config.commands.push({
        key: "codex-config",
        label: "configuration",
        reason: "light fixture check",
        executable: "$node",
        args: ["fixture-light.mjs"],
        phase: "preflight",
      });
      write(
        "fixture-light.mjs",
        "import {appendFileSync} from 'node:fs';\nappendFileSync('.auth/light-checks', 'checked\\n');\n",
      );
      write(".codex/verification.json", JSON.stringify(config));
      for (const key of ["one", "two"])
        write(
          `src/${key}.test.mjs`,
          `import {appendFileSync} from 'node:fs';\nimport assert from 'node:assert/strict';\n` +
            (key === "one" ? `import {product} from ${JSON.stringify("./product.mjs")};\n` : "") +
            `appendFileSync('.auth/product-checks.jsonl', '${JSON.stringify({ case: key })}\\n');\n` +
            (key === "one" ? "assert.ok(product >= 0);\n" : "assert.ok(true);\n"),
        );
    },
  });
  mkdirSync(path.join(f.root, "node_modules"), { recursive: true });
  symlinkSync(
    path.resolve("node_modules/prettier"),
    path.join(f.root, "node_modules/prettier"),
    "dir",
  );
  const run = (...args) => f.run("bash", ["scripts/setup/run-project.sh", "pnpm", ...args]);
  f.write("src/product.mjs", "// Initial explanation\nexport const product = 1;\n");
  run("verify:changed");
  assert.equal(
    f.counter().length,
    0,
    "an initial comment-only delta needs no full basis or product tests",
  );
  f.write("src/product.mjs", "export const product = -1;\n");
  const failed = f.runResult("bash", ["scripts/setup/run-project.sh", "pnpm", "verify"]);
  assert.equal(failed.status, 1);
  const good = f.counter().filter((row) => row.case === "two").length;
  assert.equal(good, 1, "independent success must be observed before the retry");
  f.write("src/product.mjs", "export const product = 3;\n");
  run("verify");
  assert.equal(
    f.counter().filter((row) => row.case === "two").length,
    good,
    "an initial failure retains successful checks without a complete basis",
  );
  let count = f.counter().length;
  f.write("src/product.mjs", "// Ordinary explanatory comment\nexport const product=3\n");
  f.write("README.md", "# Editorial fixture\n");
  run("verify:changed");
  run("verify");
  assert.equal(
    f.counter().length,
    count,
    "comments, formatting and documentation need no product test replay",
  );
  f.write("src/product.mjs", "// @ts-check\nexport const product = 3;\n");
  run("verify:changed");
  assert.equal(f.counter().length, count + 1, "tool directives remain relevant source inputs");
  count = f.counter().length;
  const config = JSON.parse(readFileSync(path.join(f.root, ".codex/verification.json"), "utf8"));
  config.commands.push({
    key: "new",
    label: "new",
    reason: "new case",
    executable: "$node",
    args: ["--test", "src/new.test.mjs"],
    phase: "broad",
  });
  f.write(".codex/verification.json", JSON.stringify(config));
  f.write(
    "src/new.test.mjs",
    "import {appendFileSync} from 'node:fs';\nappendFileSync('.auth/product-checks.jsonl', '{\"case\":\"new\"}\\n');\n",
  );
  run("verify:changed");
  assert.equal(
    f.counter().length,
    count + 1,
    "only the newly added case executes during development",
  );
  run("project:publish", "--message", "Publish expanded plan");
  assert.equal(
    f.counter().length,
    count + 1,
    "the expanded publication plan reuses all current case results",
  );
  config.commands.find((command) => command.key === "one").args.unshift("--conditions=fixture");
  const lightCount = readFileSync(path.join(f.root, ".auth/light-checks"), "utf8").length;
  f.write(".codex/verification.json", JSON.stringify(config));
  run("verify");
  assert.equal(
    f.counter().length,
    count + 2,
    "changed execution flags invalidate only their check",
  );
  assert.ok(
    readFileSync(path.join(f.root, ".auth/light-checks"), "utf8").length > lightCount,
    "registry-only edits still run the lightweight configuration check",
  );
});

test("normal entries reproduce a failure, verify its narrow repair and publish without replay", (t) => {
  const transportTest = "src/transport.test.mjs";
  const sharedTest = "src/shared.test.mjs";
  const f = publicationFixture(t, {
    configure({ root, write }) {
      const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
      pkg.scripts["verify:changed"] = "node scripts/verify/adaptive.mjs --mode repo";
      write("package.json", JSON.stringify(pkg));
      const config = JSON.parse(readFileSync(path.join(root, ".codex/verification.json"), "utf8"));
      config.commands = [
        {
          key: "product",
          label: "complete product",
          executable: "$node",
          args: ["--test", transportTest, sharedTest],
          phase: "broad",
          reason: "all product contracts",
        },
        {
          key: "transport",
          label: "transport contract",
          executable: "$node",
          args: ["--test", transportTest],
          phase: "preflight",
          reason: "exact transport consumer",
          coveredBy: "product",
        },
      ];
      config.exactConsumers = { "src/product.mjs": ["transport"], [transportTest]: ["transport"] };
      write(".codex/verification.json", JSON.stringify(config));
      const preamble = `import {appendFileSync} from 'node:fs';\nimport test from 'node:test';\nimport assert from 'node:assert/strict';\n`;
      const productImport = JSON.stringify("./product.mjs");
      write(
        transportTest,
        preamble +
          `import {product} from ${productImport};
test('transport valid', () => { appendFileSync('.auth/product-checks.jsonl', '{"case":"transport"}\\n'); assert.ok(product >= 0); });\n`,
      );
      write(
        sharedTest,
        preamble +
          `test('shared boundary', () => { appendFileSync('.auth/product-checks.jsonl', '{"case":"shared"}\\n'); assert.equal(2 + 2, 4); });\n`,
      );
    },
  });
  const run = (...args) => f.run("bash", ["scripts/setup/run-project.sh", "pnpm", ...args]);
  // This case starts after the fixture's independent private-context migration is committed.
  f.run("git", ["add", "-A"]);
  f.run("git", ["commit", "--message", "Prepare focused verification fixture"]);
  run("verify");
  const evidencePath = path.join(f.root, ".codex/runtime/cache/project-verification/evidence.json");
  const accepted = readFileSync(evidencePath);
  f.write("src/product.mjs", "export const product = -1;\n");
  const failure = f.runResult("bash", ["scripts/setup/run-project.sh", "pnpm", "verify:changed"]);
  assert.equal(failure.status, 1);
  assert.match(failure.stdout, /Admission mode: targeted/u);
  assert.deepEqual(
    JSON.parse(readFileSync(evidencePath)).current,
    JSON.parse(accepted).current,
    "a failed delta preserves the previous complete acceptance basis",
  );
  f.write("src/product.mjs", "export const product = 3;\n");
  const reproduction = run(
    "verify:changed",
    "--",
    "--check",
    "transport",
    "--test-name-pattern",
    "transport valid",
  );
  assert.match(reproduction, /Reproduction completed/u);
  assert.deepEqual(
    JSON.parse(readFileSync(evidencePath)).current,
    JSON.parse(accepted).current,
    "reproduction is not acceptance",
  );
  const repaired = run("verify:changed");
  assert.match(repaired, /Development results retained/u);
  assert.deepEqual(
    JSON.parse(readFileSync(evidencePath)).current,
    JSON.parse(accepted).current,
    "development cannot promote partial results into complete acceptance",
  );
  const count = f.counter().length;
  run("verify:changed");
  assert.equal(f.counter().length, count, "unchanged relevant inputs reuse successful coverage");
  assert.equal(f.counter().filter((row) => row.case === "shared").length, 1);
  const output = run("project:publish", "--message", "Publish narrow verified repair", "--verbose");
  assert.match(output, /Pre-push verification passed/u);
  assert.equal(f.counter().length, count, "publisher and downstream hook reuse the same evidence");
  f.write(
    transportTest,
    readFileSync(path.join(f.root, transportTest), "utf8") +
      "test('additional contract', () => assert.equal(3, 3));\n",
  );
  run("verify:changed");
  assert.equal(f.counter().length, count + 1, "test logic invalidates its owner's evidence");
  const wide = run("verify:changed", "--", "--print-plan", "--path", "unknown-shared-contract");
  assert.match(wide, /Admission mode: targeted/u);
  assert.match(wide, /publication coverage pending/u);
  assert.doesNotMatch(wide, /Would run.*shared\.test\.mjs/u);
});
