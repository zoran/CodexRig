/** Verifies scoped inputs for static checks and packages without unrelated policy suites. */
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { discoverProductLayout } from "../repository/product-roots.mjs";
import { focusedManifestCommand } from "./verification-admission-commands.mjs";
import { readVerificationConfiguration } from "./verification-configuration.mjs";
import {
  pendingVerificationPlan,
  verificationCheckFingerprints,
} from "./verification-check-inputs.mjs";
import { digest } from "./verification-record-helpers.mjs";
import { runPlan } from "./verification-executor.mjs";
import { withVerificationSessionLock } from "./verification-session-lock.mjs";

import { receipt, policyFixture } from "./verification-policy-test-helpers.mjs";

test("scoped static checks reuse unrelated test edits but bind data, imports and inventory", async (t) => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "scoped-verification-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  mkdirSync(path.join(repositoryRoot, "checks"));
  const sources = {
    "checks/scoped.mjs": `import {value} from './helper.mjs';
import {appendFileSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
assert.ok(value > 0 && JSON.parse(readFileSync('policy.json','utf8')).valid);
appendFileSync('dispatch.log','scoped\\n');\n`,
    "checks/helper.mjs": "export const value = 1;\n",
    "checks/global.mjs":
      "import {appendFileSync} from 'node:fs'; appendFileSync('dispatch.log','global\\n');\n",
    "policy.json": '{"valid":true}\n',
    "unrelated.test.mjs": "// independent test content\n",
  };
  for (const [file, content] of Object.entries(sources))
    writeFileSync(path.join(repositoryRoot, file), content);
  const commands = ["scoped", "global"].map((key) => ({
    key,
    label: key,
    reason: "fixture input coverage",
    phase: "preflight",
    executable: process.execPath,
    args: [`checks/${key}.mjs`],
    ...(key === "scoped" ? { inputScope: "owners" } : {}),
  }));
  const configuration = {
    commands,
    exactConsumers: { "policy.json": ["scoped"] },
    testConsumers: {},
    ownedCategories: {},
  };
  const snapshot = () =>
    Object.keys(sources)
      .sort()
      .filter((file) => existsSync(path.join(repositoryRoot, file)))
      .map((file) => {
        const content = readFileSync(path.join(repositoryRoot, file));
        const fingerprint = digest(
          `${lstatSync(path.join(repositoryRoot, file)).mode & 0o7777}\0${digest(content)}`,
        );
        return { path: file, fingerprint, semanticFingerprint: fingerprint };
      });
  const fingerprints = (sourceFiles = snapshot()) =>
    verificationCheckFingerprints({
      commands,
      configuration,
      repositoryRoot,
      workspaceManifests: [],
      inputs: { sourceFiles, runtimeDigest: "fixture-runtime" },
      productLayout: discoverProductLayout({ repositoryRoot, relativePaths: Object.keys(sources) }),
    });
  let checks = [];
  const execute = async (expected) => {
    const current = fingerprints();
    const pending = pendingVerificationPlan(
      {
        options: { mode: "full" },
        admission: { mode: "full", reason: "fixture" },
        classifiedPaths: [],
        readOnlyCommands: commands,
        workspaceCommands: [],
      },
      current,
      checks,
    );
    assert.deepEqual(
      pending.readOnlyCommands.map((command) => command.key),
      expected,
    );
    const observed = new Map(checks.map((check) => [check.key, check]));
    await withVerificationSessionLock(
      () =>
        runPlan(pending, {
          repositoryRoot,
          onResult(result) {
            assert.equal(result.status, 0);
            observed.set(result.command.key, {
              ...receipt([result.command.key, current.get(result.command.key)]),
              elapsedMs: result.elapsedMs,
            });
          },
        }),
      { repositoryRoot },
    );
    checks = [...observed.values()];
  };
  await execute(["scoped", "global"]);
  writeFileSync(path.join(repositoryRoot, "unrelated.test.mjs"), "// independent changed test\n");
  await execute(["global"]);
  const stale = snapshot();
  writeFileSync(path.join(repositoryRoot, "checks/helper.mjs"), "export const value = 2;\n");
  assert.throws(() => fingerprints(stale), /input changed during planning/u);
  await execute(["scoped", "global"]);
  writeFileSync(path.join(repositoryRoot, "policy.json"), '{"valid":true,"revision":2}\n');
  await execute(["scoped", "global"]);
  sources["linked.txt"] = "new linked input";
  writeFileSync(path.join(repositoryRoot, "linked.txt"), sources["linked.txt"]);
  await execute(["scoped", "global"]);
  const dispatched = readFileSync(path.join(repositoryRoot, "dispatch.log"), "utf8")
    .trim()
    .split("\n");
  assert.equal(dispatched.filter((key) => key === "scoped").length, 4);
  assert.equal(dispatched.filter((key) => key === "global").length, 5);
  rmSync(path.join(repositoryRoot, "checks/helper.mjs"));
  assert.throws(() => fingerprints(), /unbound executable input/u);
});

test("package inputs invalidate their focused owner and complete coverage, not another package", (t) => {
  const { repositoryRoot, snapshot, sourceFiles, productLayout } = policyFixture(t);
  const configuration = readVerificationConfiguration(repositoryRoot);
  const manifests = ["packages/alpha/package.json", "packages/beta/package.json"];
  for (const file of manifests) {
    mkdirSync(path.dirname(path.join(repositoryRoot, file)), { recursive: true });
    const content = Buffer.from('{"name":"fixture","private":true}\n');
    writeFileSync(path.join(repositoryRoot, file), content);
    sourceFiles.push(snapshot(file, content));
  }
  const commands = [
    configuration.commands.find((command) => command.key === "package-manifests"),
    ...manifests.map(focusedManifestCommand),
  ];
  const capture = (files) =>
    verificationCheckFingerprints({
      commands,
      configuration,
      repositoryRoot,
      workspaceManifests: [],
      productLayout,
      inputs: { sourceFiles: files, runtimeDigest: "unchanged-runtime" },
    });
  const before = capture(sourceFiles);
  const content = Buffer.from('{"name":"changed","private":true}\n');
  writeFileSync(path.join(repositoryRoot, manifests[0]), content);
  const after = capture(
    sourceFiles.map((file) => (file.path === manifests[0] ? snapshot(file.path, content) : file)),
  );
  assert.notEqual(before.get(commands[0].key), after.get(commands[0].key));
  assert.notEqual(before.get(commands[1].key), after.get(commands[1].key));
  assert.equal(before.get(commands[2].key), after.get(commands[2].key));
});
