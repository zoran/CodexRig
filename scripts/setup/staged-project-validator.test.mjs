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
import { format } from "prettier";
import {
  assertGeneratedProjectQuality,
  cleanupTemporaryRoots,
  isolatedTrackedFrameworkSource,
  temporaryRoot,
} from "./project-initialization-test-helpers.mjs";
import { stageProjectExport } from "../framework/stage-project-export.mjs";
import { projectOutputText } from "../framework/project-output-projection.mjs";
import { validateGeneratedProject } from "../framework/validate-staged-project.mjs";
import { parsePortableToml } from "../contracts/portable-toml.mjs";
import { documentContextSections } from "../docs/document-context.mjs";
import { markdownFileLinks, markdownHeadingContract } from "../docs/document-references.mjs";
import { buildFrameworkUpgradePlan } from "../framework/framework-upgrade.mjs";
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

// Staging formats tables and prose; compare policy after that presentation-only transformation.
const normalizedMarkdown = (content) =>
  format(content, { parser: "markdown", proseWrap: "always" });

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
    return content.split(/\r?\n/u).slice(start, end).join("\n").trim();
  };
  for (const [heading, marker] of [
    ["Task Reading Routes", "<!-- current-task-reading-routes -->"],
    ["Task Scope And Completion", "<!-- current-task-scope-policy -->"],
    ["YOLO Session Approval", null],
    ["Best-Available Engineering, Not Quick Fixes", null],
    ["Critical Handover Receipt", null],
    ["Guarded And Critical Drain", null],
    ["Planning, Goals, Slices, Review Loops, And Audits", "<!-- current-planning-policy -->"],
    ["Documentation Ownership", "<!-- current-documentation-ownership-policy -->"],
    ["Documentation Currency", "<!-- current-documentation-currency-policy -->"],
    ["Maintenance Scope And Verification", "<!-- current-maintenance-scope-policy -->"],
    ["Temporary Data And Storage Housekeeping", "<!-- current-temporary-storage-policy -->"],
    ["Long-Session Course Checks", "<!-- current-course-check-policy -->"],
    ["Verification Selection And Runtime", "<!-- current-verification-runtime-policy -->"],
    ["Delegated Release", "<!-- current-delegated-release-policy -->"],
    ["Coherent Component Updates And Release Batching", null],
    ["Continuous Delivery And Manual Testing", null],
    ["Admission, Intelligence, And Provenance", "<!-- current-agent-admission-policy -->"],
    ["Continuous Quality And Performance", null],
    ["Agent Lifecycle And Idle Cleanup", "<!-- current-agent-lifecycle-policy -->"],
    ["Peer Coordination", "<!-- current-peer-coordination-policy -->"],
    [
      "Intelligence Parity And Integration Authority",
      "<!-- current-integration-authority-policy -->",
    ],
    ["Capacity Admission And Monitoring", "<!-- current-capacity-admission-policy -->"],
    ["Infrastructure As Code", "<!-- current-infrastructure-as-code-policy -->"],
    ["Infrastructure Tool Selection And Ownership", null],
    ["Infrastructure State, Verification And Change Lifecycle", null],
    ["Local Builds And Retention", null],
    ["Test Strategy", "<!-- current-test-strategy-policy -->"],
    ["Deployment And Qualification Failure Recovery", "<!-- current-delivery-failure-policy -->"],
  ]) {
    assert.equal(
      await normalizedMarkdown(policyBody(generatedInstructions, heading)),
      await normalizedMarkdown(projectOutputText(policyBody(sourceInstructions, heading))),
    );
    if (marker) assert.equal(generatedInstructions.includes(marker), false);
  }
  const { anchors } = markdownHeadingContract("instructions.md", generatedInstructions);
  for (const reference of markdownFileLinks(
    policyBody(generatedInstructions, "Task Reading Routes"),
  ))
    assert.ok(anchors.has(reference.slice(1)), `Generated task route must resolve: ${reference}`);
  for (const file of [
    ".codex/config.toml",
    ".codex/agents/default.toml",
    ".codex/agents/explorer.toml",
    ".codex/agents/worker.toml",
  ]) {
    const { developer_instructions: prompt } = parsePortableToml(
      readFileSync(path.join(target, file), "utf8"),
    );
    if (file.startsWith(".codex/agents/"))
      assert.ok(prompt.includes("instructions.md#long-session-course-checks"), file);
    if (file === ".codex/config.toml" || file === ".codex/agents/worker.toml")
      assert.ok(prompt.includes("instructions.md#yolo-session-approval"), file);
    for (const [, anchor] of prompt.matchAll(/instructions\.md#([a-z0-9-]+)/gu))
      assert.ok(anchors.has(anchor), `${file} refers to a missing generated rule: #${anchor}`);
  }
  const scripts = JSON.parse(readFileSync(path.join(target, "package.json"), "utf8")).scripts;
  assert.equal(scripts["build:local"], "node scripts/local-build/local-build.mjs");
  assert.equal(scripts["infra:admin"], "python3 -B scripts/infrastructure/admin.py");
  for (const file of [
    "scripts/infrastructure/ansible/deploy.yml",
    "scripts/infrastructure/ansible/library/deploy_cpu_step.py",
    "scripts/infrastructure/remote-cpu.test.mjs",
    "scripts/infrastructure/fleet_profile.py",
    "scripts/infrastructure/ansible/verify_fleet.yml",
    "scripts/infrastructure/deploy_watch.py",
    "scripts/infrastructure/monitor_operations.py",
    "scripts/context/account-capacity.mjs",
    "scripts/context/account-pause-state.mjs",
  ])
    assert.equal(
      readFileSync(path.join(target, file), "utf8"),
      projectOutputText(readFileSync(path.join(source, file), "utf8")),
      file,
    );
  for (const [tool, args] of [
    ["python3", ["-B", "scripts/infrastructure/admin.py", "list"]],
    [process.execPath, ["scripts/context/account-capacity.mjs", "--help"]],
    [process.execPath, ["scripts/local-build/local-build.mjs", "--help"]],
  ]) {
    const result = spawnSync(tool, args, { cwd: target, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  for (const file of [".github/workflows", ".gitlab-ci.yml", ".project-state/build"])
    assert.equal(existsSync(path.join(target, file)), false, file);
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

test("current-output review carries shared entry and routing changes into existing children", async () => {
  const updatedSource = isolatedTrackedFrameworkSource("stage-reviewed-policy-source-");
  const agentsPath = path.join(updatedSource, "AGENTS.md");
  const instructionsPath = path.join(updatedSource, "instructions.md");
  const agents = readFileSync(agentsPath, "utf8");
  const instructions = readFileSync(instructionsPath, "utf8");
  const dispatchRule = "Carry the reviewed dispatch checkpoint into the next ready task.";
  const routeRule = "Read the reviewed task route before changing portable project tooling.";
  const amendedAgents = agents.replace(
    "<!-- codexrig:portable-agent-entry:end -->",
    `${dispatchRule}\n\n<!-- codexrig:portable-agent-entry:end -->`,
  );
  const amendedInstructions = instructions.replace(
    "## Task Reading Routes\n",
    `## Task Reading Routes\n\n${routeRule}\n`,
  );
  assert.notEqual(amendedAgents, agents);
  assert.notEqual(amendedInstructions, instructions);
  writeFileSync(agentsPath, amendedAgents);
  writeFileSync(instructionsPath, amendedInstructions);
  const generated = path.join(temporaryRoot("stage-current-policy-"), "project");
  await stageProjectExport({
    sourceRoot: updatedSource,
    targetRoot: generated,
    projectName: "stage-fixture",
    includeUntracked: true,
  });

  const target = stage();
  const options = { sourceRoot: updatedSource, targetRoot: target };
  const preview = buildFrameworkUpgradePlan(options);
  const documents = new Set(["AGENTS.md", "instructions.md"]);
  const resolutions = preview.differences.map(({ kind, ...entry }) => ({
    ...entry,
    action: documents.has(entry.path) ? "source" : "keep",
    reason: "Review the changed portable policy while retaining unrelated fixture owners.",
  }));
  const reviewed = buildFrameworkUpgradePlan({ ...options, resolutions });
  assert.deepEqual(reviewed.conflicts, []);
  for (const [file, rule] of [
    ["AGENTS.md", dispatchRule],
    ["instructions.md", routeRule],
  ]) {
    const operation = reviewed.operations.find(({ path: candidate }) => candidate === file);
    assert.equal(operation?.action, "write", `${file} must carry the changed source policy.`);
    const currentOutput = readFileSync(path.join(generated, file), "utf8");
    assert.ok(
      currentOutput.replace(/\s+/gu, " ").includes(rule),
      `${file} generation must include the source revision.`,
    );
    assert.equal(
      operation.content,
      currentOutput,
      `Reviewed ${file} must match the freshly generated bytes.`,
    );
    assert.doesNotMatch(operation.content, /codexrig-work-state|codexrig:portable-agent-entry/u);
  }
  assert.match(
    reviewed.operations.find(({ path: file }) => file === "instructions.md").content,
    /`project-work-state`/u,
  );
  assert.doesNotMatch(readFileSync(path.join(target, "AGENTS.md"), "utf8"), /reviewed dispatch/u);
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

test("generation refuses a missing portable policy boundary without publishing a child", async () => {
  const incompleteSource = isolatedTrackedFrameworkSource("stage-missing-scope-");
  const instructionsPath = path.join(incompleteSource, "instructions.md");
  const current = readFileSync(instructionsPath, "utf8");
  const incomplete = current.replace(
    "<!-- codexrig:portable-policy:start -->",
    "<!-- missing-portable-policy -->",
  );
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
    /Portable policy needs one nonempty block with unique ordered markers/u,
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
  assert.match(
    readFileSync(path.join(target, "scripts/setup/start-codex-session.sh"), "utf8"),
    /exec node scripts\/setup\/startup-session-controller\.mjs /u,
  );
  assert.equal(existsSync(path.join(target, "scripts/framework/framework-session.mjs")), false);
  assert.equal(existsSync(path.join(target, "scripts/framework/framework-reset.mjs")), false);
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

test("export rejects legacy Mise formats and checks the published pnpm graph bytes", async () => {
  const target = stage();
  const lock = path.join(target, ".codex/mise.lock");
  const current = readFileSync(lock, "utf8");
  writeFileSync(lock, current.replace(/^lockfile_version = \d+\r?\n/mu, ""));
  await assert.rejects(validateGeneratedProject(target), /format 2 or later/u);
  writeFileSync(lock, current);
  appendFileSync(path.join(target, ".codex/.mise/locks/pnpm/current/aube-lock.yaml"), "\n");
  await assert.rejects(validateGeneratedProject(target), /graph integrity differs/u);
});

test("source validation accepts the independent output and scans final staged bytes", async () => {
  const target = stage();
  await validateGeneratedProject(target);
  // The independent child runs its shipped checks while the export fixture stays pristine.
  assertGeneratedProjectQuality(stage());
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
