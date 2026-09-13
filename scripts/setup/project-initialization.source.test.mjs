/** Verifies project initialization isolation and independent product verification. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import {
  assertGeneratedTransferParityContract,
  cleanupTemporaryRoots,
  gitState,
  isolatedTrackedFrameworkSource,
  root,
  runProjectGenerator,
  temporaryRoot,
  textFiles,
} from "./project-initialization-test-helpers.mjs";
import { assertIndependentProjectOutput } from "../../scripts/framework/project-output-projection.mjs";

const write = (root, file, content) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
};
function run(root, args, executable = process.execPath) {
  const env = { ...process.env, NODE_OPTIONS: "", CODEX_HOME: root };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    input: "",
    stdio: "pipe",
    timeout: 30_000,
    env,
  });
}
function generate(source, name, extra = []) {
  const parent = temporaryRoot("independent-product-");
  const result = runProjectGenerator([
    "--source",
    source,
    "--output-parent",
    parent,
    "--name",
    name,
    "--directory",
    "product",
    ...extra,
  ]);
  assert.equal(result.status, 0, result.stderr);
  return path.join(parent, "product/code");
}
after(cleanupTemporaryRoots);

test("empty generation excludes source capabilities, private markers and new unselected files", () => {
  const primaryBefore = gitState(root);
  const source = isolatedTrackedFrameworkSource("independent-source-");
  const privateMarker = "PRIVATE_SOURCE_TASK_8b091da8";
  for (const file of [
    "sessions/private.jsonl",
    "memories/private.md",
    "tmp/source-handover.txt",
    ".codex/runtime/source-task.json",
    "docs/project-context.md",
  ])
    write(source, file, privateMarker);
  write(
    source,
    "scripts/framework/new-unselected-module.mjs",
    'export const sourceOnly = "SOURCE_ONLY_CAPABILITY_71af";\n',
  );
  write(source, "drafts/source.md", privateMarker);
  symlinkSync(path.join(source, "memories/private.md"), path.join(source, "drafts/private-link"));
  const sourceAgents = readFileSync(path.join(source, "AGENTS.md"), "utf8");
  write(source, "AGENTS.md", sourceAgents + "\n" + privateMarker + "\n");
  const unsafe = runProjectGenerator([
    "--source",
    source,
    "--name",
    "Unsafe source link",
    "--include-untracked",
  ]);
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /single-link regular file/);
  rmSync(path.join(source, "drafts/private-link"));
  const sourceBefore = gitState(source);
  const generated = generate(source, "Independent Fixture", ["--include-untracked"]);
  assert.deepEqual(gitState(source), sourceBefore);
  assert.deepEqual(gitState(root), primaryBefore);
  assertIndependentProjectOutput(generated);
  for (const file of [
    ".git",
    ".codexrig",
    "LICENSE",
    "NOTICE",
    "scripts/framework",
    "scripts/framework/export-project.sh",
    "scripts/framework/validate-staged-project.mjs",
    "docs/project-context.md",
    ".codex/runtime",
    "node_modules",
  ])
    assert.equal(existsSync(path.join(generated, file)), false, file);
  for (const file of textFiles(generated))
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /PRIVATE_SOURCE_TASK_8b091da8|SOURCE_ONLY_CAPABILITY_71af/,
    );
  const pkg = JSON.parse(readFileSync(path.join(generated, "package.json"), "utf8"));
  assert.equal(pkg.license, "UNLICENSED");
  assert.equal(pkg.name, "product");
  assert.equal(
    Object.keys(pkg.scripts).some((key) =>
      /framework|compatibility|context:test|project:export/.test(key),
    ),
    false,
  );
  const selected = JSON.parse(
    readFileSync(path.join(generated, ".codex/verification.json"), "utf8"),
  );
  assert.deepEqual(selected.prePushChecks, []);
  assert.deepEqual(
    selected.commands.flatMap((command) => command.args).filter((arg) => arg.endsWith(".test.mjs")),
    ["scripts/setup/runtime-safety.test.mjs"],
  );
  for (const file of [".github/workflows/ci.yml", ".gitlab-ci.yml"])
    assert.doesNotMatch(
      readFileSync(path.join(generated, file), "utf8"),
      /canar|next-node|compatibility:|schedule|framework:/iu,
    );
  assertGeneratedTransferParityContract(source, generated);
  write(
    source,
    "scripts/context/session-stop-lifecycle.mjs",
    readFileSync(path.join(source, "scripts/context/session-stop-lifecycle.mjs"), "utf8") +
      '\nimport "../framework/new-unselected-module.mjs";\n',
  );
  const refused = runProjectGenerator([
    "--source",
    source,
    "--name",
    "Unreviewed dependency",
    "--include-untracked",
  ]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /unselected project dependency/);
});

test("generated tools and selected checks operate after the source checkout becomes unreachable", () => {
  const source = isolatedTrackedFrameworkSource("unreachable-source-");
  const generated = generate(source, "Standalone Fixture");
  renameSync(source, source + "-unreachable");
  for (const args of [
    ["--experimental-vm-modules", "scripts/setup/validate-static-module-imports.mjs"],
    ["scripts/verify/repository-smoke.mjs"],
    ["scripts/verify/docs.mjs"],
    ["scripts/setup/tooling-doctor.mjs"],
    ["--test", "scripts/setup/runtime-safety.test.mjs"],
    ["scripts/setup/install-git-hooks.mjs"],
  ]) {
    const result = run(generated, args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  const installed = run(
    generated,
    ["install", "--offline", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile"],
    "pnpm",
  );
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  const verified = run(generated, ["verify"], "pnpm");
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  const plans = run(generated, [
    "--input-type=module",
    "--eval",
    `
    import {buildPlan} from './scripts/verify/adaptive-runner.mjs';
    import {startupExecutableClosurePaths} from './scripts/setup/startup-executable-closure.mjs';
    const plan=buildPlan({mode:'changed',simulatedPaths:[],forceFull:false},{changedPaths:['docs/ui-reference.html'],gitAvailable:true,basis:{trusted:true,reason:'fixture'},workspaceManifests:[]});
    console.log(JSON.stringify({scope:plan.verificationScope,commands:plan.readOnlyCommands.map(c=>c.key),closure:startupExecutableClosurePaths(process.cwd())}));
  `,
  ]);
  assert.equal(plans.status, 0, plans.stderr);
  const plan = JSON.parse(plans.stdout);
  assert.equal(plan.scope, "targeted");
  assert.equal(
    plan.commands.some((name) => /regressions|framework/.test(name)),
    false,
  );
  assert.equal(
    plan.closure.some((file) => /framework|upgrade|receipt/.test(file)),
    false,
  );
});

test("unknown changes and a missing Git basis still execute the actual product test lifecycle", () => {
  const source = isolatedTrackedFrameworkSource("product-check-source-");
  const generated = generate(source, "Product Test Fixture");
  const pkg = JSON.parse(readFileSync(path.join(generated, "package.json"), "utf8"));
  pkg.scripts.test = "node --test src/cloud-foundation.test.mjs";
  write(generated, "package.json", JSON.stringify(pkg, null, 2) + "\n");
  write(
    generated,
    "src/cloud-foundation.test.mjs",
    `/** Exercises the fixture's deny-by-default cloud configuration. */\nimport assert from 'node:assert/strict';\nimport {readFileSync} from 'node:fs';\nimport {test} from 'node:test';\ntest('tenant isolation remains deny by default',()=>assert.equal(JSON.parse(readFileSync('cloud-foundation.input')).defaultAccess,'deny'));\n`,
  );
  write(generated, "cloud-foundation.input", '{"defaultAccess":"deny"}\n');
  const installed = run(
    generated,
    ["install", "--offline", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile"],
    "pnpm",
  );
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  for (const gitAvailable of [true, false]) {
    const planned = run(generated, [
      "--input-type=module",
      "--eval",
      `import {buildPlan} from './scripts/verify/adaptive-runner.mjs'; console.log(JSON.stringify(buildPlan({mode:'changed',simulatedPaths:[],forceFull:false},{changedPaths:['cloud-foundation.input'],gitAvailable:${gitAvailable},basis:{trusted:${gitAvailable},reason:'fixture'}})));`,
    ]);
    assert.equal(planned.status, 0, planned.stderr);
    const plan = JSON.parse(planned.stdout);
    assert.equal(plan.verificationScope, "full");
    const command = plan.workspaceCommands.find((c) => c.key === "workspace:test");
    assert.ok(command);
    const pass = run(generated, command.args, command.executable);
    assert.equal(pass.status, 0, pass.stdout + pass.stderr);
    assert.match(
      pass.stdout + pass.stderr,
      /tenant isolation remains deny by default/,
      JSON.stringify(command) + "\n" + pass.stdout + pass.stderr,
    );
    write(generated, "cloud-foundation.input", '{"defaultAccess":"allow"}\n');
    const rejected = run(generated, command.args, command.executable);
    assert.notEqual(rejected.status, 0, rejected.stdout + rejected.stderr);
    assert.match(rejected.stdout + rejected.stderr, /tenant isolation remains deny by default/);
    write(generated, "cloud-foundation.input", '{"defaultAccess":"deny"}\n');
  }
});
