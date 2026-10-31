/** Verifies reuse across failed publication, repair and independent workspace changes. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { publicationFixture } from "./project-publication.fixture.mjs";

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
            "test:e2e": "node check.mjs e2e",
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
  // Workspace lifecycles need the canonical pnpm admission supplied by the public entry.
  const run = (...args) => f.run("bash", ["-p", "scripts/setup/run-project.sh", "pnpm", ...args]);
  const counts = () =>
    Object.fromEntries(
      ["shared", "product", "consumer", "workspace", "independent", "e2e"].map((key) => [
        key,
        f.counter().filter((row) => row.case === key).length,
      ]),
    );
  run("verify:changed");
  assert.deepEqual(
    counts(),
    { shared: 0, product: 1, consumer: 1, workspace: 1, independent: 0, e2e: 0 },
    "development must not bootstrap full coverage",
  );
  run("verify:changed");
  assert.deepEqual(
    counts(),
    { shared: 0, product: 1, consumer: 1, workspace: 1, independent: 0, e2e: 0 },
    "a checkpoint is not a new test trigger",
  );
  run("verify");
  assert.deepEqual(
    counts(),
    { shared: 1, product: 1, consumer: 1, workspace: 1, independent: 1, e2e: 1 },
    "publication fills only missing coverage",
  );
  const publish = ["project:publish", "--message", "Publish once verified inputs", "--verbose"];
  writeFileSync(path.join(f.remote, "hooks/pre-receive"), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
  const rejected = f.runResult("bash", ["-p", "scripts/setup/run-project.sh", "pnpm", ...publish]);
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
    { shared: 1, product: 1, consumer: 1, workspace: 1, independent: 1, e2e: 1 },
    "manual verifier, publisher and pre-push share evidence",
  );
  f.write("src/product.mjs", "export const product = -1;\n");
  const failed = f.runResult("bash", ["-p", "scripts/setup/run-project.sh", "pnpm", "verify"]);
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
    { ...beforePackageChange, independent: 2, e2e: 2 },
    "publication-only workspace consumers bind their package source without replaying unit checks",
  );
});
