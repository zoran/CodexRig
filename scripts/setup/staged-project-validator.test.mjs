/** Verifies the source-owned validator against independently generated staging trees. */
import assert from "node:assert/strict";
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

test("generated children receive the canonical capacity recovery policy", async () => {
  const target = stage();
  const sourceInstructions = readFileSync(path.join(source, "instructions.md"), "utf8");
  const generatedInstructions = readFileSync(path.join(target, "instructions.md"), "utf8");
  const capacityBody = (content) => {
    const sections = documentContextSections("instructions.md", content).filter(
      ({ heading }) => heading === "Capacity Admission And Monitoring",
    );
    assert.equal(sections.length, 1, "Capacity policy must have exactly one owner.");
    const { start, end } = sections[0];
    return content.split(/\r?\n/u).slice(start, end).join(" ").replace(/\s+/gu, " ").trim();
  };
  assert.equal(capacityBody(generatedInstructions), capacityBody(sourceInstructions));
  assert.doesNotMatch(generatedInstructions, /<!-- current-capacity-admission-policy -->/u);
  await validateGeneratedProject(target);
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
    /before classifying account-window\s+exhaustion/u,
    "only before the critical threshold",
  );
  assert.notEqual(obsolete, current, "Generated primary policy must declare recovery ordering.");
  writeFileSync(configPath, obsolete);
  const expected =
    /must include orchestration marker before classifying account-window exhaustion/u;
  assert.throws(() => validateCodexConfig(target), expected);
  await assert.rejects(validateGeneratedProject(target), expected);
});

test("source validation accepts the independent output and scans final staged bytes", async () => {
  const target = stage();
  await validateGeneratedProject(target);
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
