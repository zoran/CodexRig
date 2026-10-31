/** Exercises narrow repair and publication through the normal public command entries. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { publicationFixture } from "./project-publication.fixture.mjs";

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
  const run = (...args) => f.run("bash", ["-p", "scripts/setup/run-project.sh", "pnpm", ...args]);
  // This case starts after the fixture's independent private-context migration is committed.
  f.run("git", ["add", "-A"]);
  f.run("git", ["commit", "--message", "Prepare focused verification fixture"]);
  run("verify");
  const evidencePath = path.join(f.root, ".codex/runtime/cache/project-verification/evidence.json");
  const accepted = readFileSync(evidencePath);
  f.write("src/product.mjs", "export const product = -1;\n");
  const failure = f.runResult("bash", [
    "-p",
    "scripts/setup/run-project.sh",
    "pnpm",
    "verify:changed",
  ]);
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
