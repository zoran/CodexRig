/** Verifies input, command and test-set changes against durable publication evidence. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { publicationFixture } from "./project-publication.fixture.mjs";

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
      config.exactConsumers = {
        "src/product.mjs": ["one"],
        ".codex/verification.json": ["codex-config"],
      };
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
  // These cases own evidence identity. The public wrapper is exercised by the separate entry tests.
  const run = (command) =>
    f.run(process.execPath, [
      "scripts/verify/adaptive.mjs",
      "--mode",
      command === "verify" ? "full" : "repo",
    ]);
  f.write("src/product.mjs", "// Initial explanation\nexport const product = 1;\n");
  run("verify:changed");
  assert.equal(
    f.counter().length,
    0,
    "an initial comment-only delta needs no full basis or product tests",
  );
  f.write("src/product.mjs", "export const product = -1;\n");
  const failed = f.runResult(process.execPath, ["scripts/verify/adaptive.mjs", "--mode", "full"]);
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
