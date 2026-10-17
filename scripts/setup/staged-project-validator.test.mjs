/** Verifies the source-owned validator against independently generated staging trees. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  cleanupTemporaryRoots,
  isolatedTrackedFrameworkSource,
  temporaryRoot,
} from "./project-initialization-test-helpers.mjs";
import { stageProjectExport } from "../framework/stage-project-export.mjs";
import { validateGeneratedProject } from "../framework/validate-staged-project.mjs";
import { documentContextSections } from "../docs/document-context.mjs";
import {
  prepareProjectToolDirectories,
  projectToolEnvironment,
} from "../repository/project-tool-environment.mjs";

let source;
let pristine;
before(async () => {
  source = isolatedTrackedFrameworkSource("stage-source-");
  writeFileSync(path.join(source, "docs/project-context.md"), "# Private source task\n");
  pristine = path.join(temporaryRoot("stage-pristine-"), "project");
  await stageProjectExport({
    sourceRoot: source,
    targetRoot: pristine,
    projectName: "Stage Fixture",
    includeUntracked: true,
  });
  assert.equal(existsSync(path.join(pristine, "docs/project-context.md")), false);
  assert.equal(
    readFileSync(path.join(source, "docs/project-context.md"), "utf8"),
    "# Private source task\n",
  );
  assert.equal(
    existsSync(path.join(pristine, "scripts/framework/validate-staged-project.mjs")),
    false,
  );
});
after(cleanupTemporaryRoots);
function stage() {
  const target = path.join(temporaryRoot("stage-case-"), "project");
  cpSync(pristine, target, { recursive: true });
  return target;
}

test("generated children receive canonical task, planning, documentation, maintenance and safety policies", async () => {
  const target = stage();
  const sourceInstructions = readFileSync(path.join(source, "instructions.md"), "utf8");
  const generatedInstructions = readFileSync(path.join(target, "instructions.md"), "utf8");
  const policyBody = (content, expectedHeading) => {
    const sections = documentContextSections("instructions.md", content).filter(
      ({ heading }) => heading === expectedHeading,
    );
    assert.equal(sections.length, 1, `${expectedHeading} must have exactly one owner.`);
    const { start, end } = sections[0];
    return content.split(/\r?\n/u).slice(start, end).join(" ").replace(/\s+/gu, " ").trim();
  };
  for (const [heading, marker] of [
    ["Task Scope And Completion", "<!-- current-task-scope-policy -->"],
    ["Planning, Goals, Slices, Review Loops, And Audits", "<!-- current-planning-policy -->"],
    ["Documentation Ownership", "<!-- current-documentation-ownership-policy -->"],
    ["Documentation Currency", "<!-- current-documentation-currency-policy -->"],
    ["Maintenance Scope And Verification", "<!-- current-maintenance-scope-policy -->"],
    ["Temporary Data And Storage Housekeeping", "<!-- current-temporary-storage-policy -->"],
    ["Long-Session Course Checks", "<!-- current-course-check-policy -->"],
    ["Verification Selection And Runtime", "<!-- current-verification-runtime-policy -->"],
    ["Delegated Release", "<!-- current-delegated-release-policy -->"],
    ["Admission, Intelligence, And Provenance", "<!-- current-agent-admission-policy -->"],
    ["Agent Lifecycle And Idle Cleanup", "<!-- current-agent-lifecycle-policy -->"],
    ["Capacity Admission And Monitoring", "<!-- current-capacity-admission-policy -->"],
    ["Infrastructure As Code", "<!-- current-infrastructure-as-code-policy -->"],
    ["Test Strategy", "<!-- current-test-strategy-policy -->"],
    ["Deployment And Qualification Failure Recovery", "<!-- current-delivery-failure-policy -->"],
  ]) {
    assert.equal(
      policyBody(generatedInstructions, heading),
      policyBody(sourceInstructions, heading),
    );
    assert.equal(generatedInstructions.includes(marker), false);
  }
  await validateGeneratedProject(target);
  const contextPath = path.join(target, "docs/project-context.md");
  const marker = /`([a-z]+-work-state)`/u.exec(generatedInstructions)?.[1];
  assert.ok(marker, "Generated instructions must name their current work-state marker.");
  const state = {
    version: 1,
    revision: 1,
    status: "complete",
    outcome: "Fixture repair",
    currentGoal: "Fixture",
    currentSlice: null,
    nextAction: null,
    blocker: { kind: "external", reason: "Resolved" },
  };
  const save = () =>
    writeFileSync(contextPath, `<!-- ${marker}\n${JSON.stringify(state)}\n-->\n\n# Work\n`);
  save();
  prepareProjectToolDirectories(target);
  const docs = () =>
    spawnSync(process.execPath, ["scripts/verify/docs.mjs"], {
      cwd: target,
      env: projectToolEnvironment({ root: target }),
      encoding: "utf8",
      timeout: 10000,
    });
  const rejected = docs();
  assert.equal(rejected.status, 1, rejected.stderr);
  assert.match(rejected.stderr, /complete work cannot declare a next action or blocker/u);
  state.blocker = null;
  save();
  const accepted = docs();
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /semantic currency requires source\/evidence review/u);
  const storage = spawnSync(
    process.execPath,
    ["scripts/goals/repository-housekeeping.mjs", "--storage-only"],
    {
      cwd: target,
      env: projectToolEnvironment({ root: target }),
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(storage.status, 0, storage.stderr);
  assert.match(storage.stdout, /Repository storage/u);
  assert.equal(
    existsSync(path.join(target, ".project-state")),
    false,
    "read-only child storage entry creates no maintenance state",
  );
});

test("generated validators reject primary policy without the maintenance scope boundary", async () => {
  const target = stage();
  const { validateCodexConfig } = await import(
    pathToFileURL(path.join(target, "scripts/setup/validate-codex-config.mjs")).href
  );
  validateCodexConfig(target);
  const configPath = path.join(target, ".codex/config.toml");
  const current = readFileSync(configPath, "utf8");
  const obsolete = current.replace(
    /Maintenance\s+Scope\s+And\s+Verification/u,
    "general completion",
  );
  assert.notEqual(obsolete, current);
  writeFileSync(configPath, obsolete);
  const expected = /must include orchestration marker Maintenance Scope And Verification/u;
  assert.throws(() => validateCodexConfig(target), expected);
  await assert.rejects(validateGeneratedProject(target), expected);
});

test("generation refuses a missing canonical maintenance scope policy without publishing a child", async () => {
  const incompleteSource = isolatedTrackedFrameworkSource("stage-missing-scope-");
  const instructionsPath = path.join(incompleteSource, "instructions.md");
  const current = readFileSync(instructionsPath, "utf8");
  const incomplete = current.replace("## Maintenance Scope And Verification", "## Removed Policy");
  assert.notEqual(incomplete, current);
  writeFileSync(instructionsPath, incomplete);
  const target = path.join(temporaryRoot("stage-rejected-scope-"), "project");
  await assert.rejects(
    stageProjectExport({
      sourceRoot: incompleteSource,
      targetRoot: target,
      projectName: "Missing Scope",
      includeUntracked: true,
    }),
    /Shared policy Maintenance Scope And Verification needs one canonical owner and one projection/u,
  );
  assert.equal(existsSync(target), false);
});

test("generated validators reject primary policy that omits recovery before account exhaustion", async () => {
  const target = stage();
  const { validateCodexConfig } = await import(
    pathToFileURL(path.join(target, "scripts/setup/validate-codex-config.mjs")).href
  );
  validateCodexConfig(target);
  const configPath = path.join(target, ".codex/config.toml");
  const current = readFileSync(configPath, "utf8");
  const obsolete = current.replace(
    /before classifying account-window\s+exhaustion/iu,
    "only before the critical threshold",
  );
  assert.notEqual(obsolete, current, "Generated primary policy must declare recovery ordering.");
  writeFileSync(configPath, obsolete);
  const expected =
    /must include orchestration marker before classifying account-window exhaustion/u;
  assert.throws(() => validateCodexConfig(target), expected);
  await assert.rejects(validateGeneratedProject(target), expected);
});

test("generated launcher verification rejects locked maintenance in the normal startup path", () => {
  const target = stage();
  const testPath = "scripts/setup/codex-launcher.test.mjs";
  assert.equal(
    existsSync(path.join(target, testPath)),
    true,
    "Children must receive the executable launcher regression.",
  );
  const verification = JSON.parse(
    readFileSync(path.join(target, ".codex/verification.json"), "utf8"),
  );
  assert.deepEqual(verification.testConsumers["scripts/setup/start-codex.sh"], [testPath]);
  assert.equal(
    verification.commands.flatMap(({ args }) => args).filter((arg) => arg === testPath).length,
    1,
  );
  prepareProjectToolDirectories(target);
  const run = (args) =>
    spawnSync(process.execPath, args, {
      cwd: target,
      env: projectToolEnvironment({ root: target }),
      encoding: "utf8",
      timeout: 30_000,
    });
  const plan = run([
    "scripts/verify/adaptive.mjs",
    "--mode",
    "repo",
    "--print-plan",
    "--path",
    "scripts/setup/start-codex.sh",
  ]);
  assert.equal(plan.status, 0, plan.stdout + plan.stderr);
  assert.equal(
    plan.stdout.split("\n").filter((line) => line.includes("Would run") && line.includes(testPath))
      .length,
    1,
  );
  const accepted = run(["--test", "--test-reporter=tap", testPath]);
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  assert.match(accepted.stdout, /# tests 1\b/u);
  const launcherPath = path.join(target, "scripts/setup/start-codex.sh");
  const before = readFileSync(launcherPath, "utf8");
  const broken = before.replace(
    "maintain-toolchain.mjs --startup",
    "maintain-toolchain.mjs --locked",
  );
  assert.notEqual(broken, before);
  writeFileSync(launcherPath, broken);
  const rejected = run(["--test", "--test-reporter=tap", testPath]);
  assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
  assert.match(rejected.stdout + rejected.stderr, /launcher maintains before admission/u);
  assert.match(
    rejected.stdout + rejected.stderr,
    /89/u,
    "The child regression must reject the observed locked-maintenance invocation.",
  );
  assert.match(rejected.stdout, /# fail 1\b/u);
});

test("source validation accepts the independent output and scans final staged bytes", async (t) => {
  const target = stage();
  await validateGeneratedProject(target);
  // Executing child tests creates private tool state; keep the export/secret-scan fixture pristine.
  const runtimeTarget = stage();
  prepareProjectToolDirectories(runtimeTarget);
  const runtimeContracts = spawnSync(
    process.execPath,
    [
      "--test",
      "--test-reporter=tap",
      "scripts/setup/runtime-safety.test.mjs",
      "scripts/contracts/mise-toolchain-configuration.test.mjs",
      "scripts/deps/toolchain-releases.test.mjs",
      "scripts/deps/toolchain-maintenance.test.mjs",
    ],
    {
      cwd: runtimeTarget,
      env: projectToolEnvironment({ root: runtimeTarget }),
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  assert.equal(runtimeContracts.status, 0, runtimeContracts.stderr || runtimeContracts.stdout);
  assert.match(runtimeContracts.stdout, /# tests [1-9]\d*\b/u);
  t.diagnostic(
    runtimeContracts.stdout
      .split("\n")
      .filter((line) => /^# (?:tests|pass|fail|skipped) /u.test(line))
      .join("; "),
  );
  appendFileSync(path.join(target, "README.md"), `${["sk-", "a".repeat(24)].join("")}\n`);
  await assert.rejects(validateGeneratedProject(target), /potential secret material/i);
  const ignored = stage();
  writeFileSync(path.join(ignored, ".env"), `API_KEY=${["sk-", "b".repeat(24)].join("")}\n`);
  await assert.rejects(
    validateGeneratedProject(ignored),
    /environment credential file|potential secret material/i,
  );
});

test("stage validation rejects unsafe root and file identities", async () => {
  const target = stage();
  const alias = path.join(temporaryRoot("stage-alias-"), "project");
  symlinkSync(target, alias, "dir");
  await assert.rejects(validateGeneratedProject(alias), /stable non-symlink directory/);
  linkSync(path.join(target, "README.md"), path.join(target, "aliased-readme.md"));
  await assert.rejects(validateGeneratedProject(target), /single-link|hardlink/i);
});

test("stage validation rejects missing and escaping module dependencies", async () => {
  for (const [specifier, expected] of [
    ["./missing.mjs", /missing relative module/],
    ["../../../outside.mjs", /outside the project/],
  ]) {
    const target = stage();
    appendFileSync(
      path.join(target, "scripts/setup/tooling-doctor.mjs"),
      `\nimport "${specifier}";\n`,
    );
    await assert.rejects(validateGeneratedProject(target), expected);
  }
});

test("stage validation rejects private runtime, active hooks and product boundary pollution", async () => {
  for (const [relativePath, content, expected] of [
    ["sessions/private.jsonl", "private task", /repository-root Codex runtime/],
    [
      ".codex/hooks.json",
      JSON.stringify({
        ...JSON.parse(readFileSync(path.join(pristine, ".codex/hooks.json"), "utf8")),
        hooks: { Stop: [] },
      }),
      /hook events must remain empty/,
    ],
    [
      "src/feature/.agents/skills/example/SKILL.md",
      "# Invalid product content",
      /agent-only path is forbidden/,
    ],
  ]) {
    const target = stage();
    mkdirSync(path.dirname(path.join(target, relativePath)), { recursive: true });
    writeFileSync(path.join(target, relativePath), content);
    await assert.rejects(validateGeneratedProject(target), expected);
  }
});

test("missing selected contracts prevent publication of an export stage", async () => {
  const missing = stage();
  rmSync(path.join(missing, "scripts/context/critical-budget-handover.mjs"));
  await assert.rejects(validateGeneratedProject(missing), /missing.*critical-budget-handover/);
  rmSync(path.join(source, "pnpm-lock.yaml"));
  const target = path.join(temporaryRoot("stage-rejected-"), "project");
  await assert.rejects(
    stageProjectExport({
      sourceRoot: source,
      targetRoot: target,
      projectName: "Missing Contract",
      includeUntracked: true,
    }),
    /pnpm-lock\.yaml/,
  );
  assert.equal(existsSync(target), false);
});
