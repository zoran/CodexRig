/** Verifies project creator contract behavior for the setup, launch, and portable project boundary. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { documentContextSections } from "../docs/document-context.mjs";
import { currentProjectInstructions } from "../framework/generated-project-documents.mjs";
import { postProjectCreationGuidance } from "../../scripts/framework/source-readiness.mjs";
import {
  normalizedProjectDescription,
  parseArgs,
} from "../../scripts/framework/project-options.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const projectCreatorSkill = ".agents/skills/create-project-from-framework/SKILL.md";
const content = readFileSync(path.join(root, projectCreatorSkill), "utf8");

test("the project creator gives authorized in-session publication guidance only for source changes", () => {
  const cleanGuidance = postProjectCreationGuidance({ sourceHasChanges: false }).join("\n");
  assert.match(cleanGuidance, /did not modify source files, initialize Git, commit or push/i);
  assert.doesNotMatch(cleanGuidance, /framework:publish/i);
  const dirtyGuidance = postProjectCreationGuidance({ sourceHasChanges: true }).join("\n");
  assert.match(dirtyGuidance, /including from the owning Codex session/);
  assert.match(dirtyGuidance, /pnpm framework:publish --message "<message>"/);
  assert.match(dirtyGuidance, /commits all non-ignored changes/);
});

test("the project creator accepts a bounded detailed requirements draft without making it mandatory", () => {
  assert.equal(parseArgs(["--name", "Example"]).description, "");
  assert.equal(
    parseArgs(["--name", "Example", "--description", "Detailed product intent"]).description,
    "Detailed product intent",
  );
  assert.equal(
    normalizedProjectDescription("  First line\r\nSecond line  "),
    "First line\nSecond line",
  );
  assert.throws(() => normalizedProjectDescription("unsafe\u0000input"), /control character/u);
  assert.throws(() => normalizedProjectDescription("x".repeat(24_001)), /24,000-character/u);
});

// Orchestration policy must follow its canonical owner, not drift in a second child-only copy.
test("generated agent policies follow canonical changes and reject missing or ambiguous projections", (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "project-agent-policy-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const templatePath = "scripts/framework/templates/project-instructions.md";
  mkdirSync(path.dirname(path.join(fixture, templatePath)), { recursive: true });
  const source = readFileSync(path.join(root, "instructions.md"), "utf8");
  const template = readFileSync(path.join(root, templatePath), "utf8");
  const save = (candidateSource, candidateTemplate) => {
    writeFileSync(path.join(fixture, "instructions.md"), candidateSource);
    writeFileSync(path.join(fixture, templatePath), candidateTemplate);
  };
  const policyBody = (document, expectedHeading) => {
    const sections = documentContextSections("instructions.md", document).filter(
      ({ heading }) => heading === expectedHeading,
    );
    assert.equal(sections.length, 1, `${expectedHeading} must have one owner.`);
    const { start, end } = sections[0];
    return document.split(/\r?\n/u).slice(start, end).join("\n").trim();
  };

  for (const [heading, marker] of [
    ["Admission, Intelligence, And Provenance", "<!-- current-agent-admission-policy -->"],
    ["Agent Lifecycle And Idle Cleanup", "<!-- current-agent-lifecycle-policy -->"],
  ]) {
    const headingLine = `### ${heading}\n`;
    const amendment = `A revised source-owned ${heading.toLowerCase()} rule.`;
    const amendedSource = source.replace(headingLine, `${headingLine}\n${amendment}\n`);
    assert.notEqual(amendedSource, source, "The fixture must change the canonical owner.");
    save(amendedSource, template);
    const generated = currentProjectInstructions(fixture);
    assert.equal(policyBody(generated, heading), policyBody(amendedSource, heading));
    assert.equal(generated.includes(marker), false, "The projection marker must be consumed.");

    for (const [candidateSource, candidateTemplate] of [
      [amendedSource.replace(headingLine, `### Renamed ${heading}\n`), template],
      [`${amendedSource}\n${headingLine}\nA competing policy owner.\n`, template],
      [amendedSource, template.replace(marker, "")],
      [amendedSource, template.replace(marker, `${marker}\n${marker}`)],
    ]) {
      save(candidateSource, candidateTemplate);
      assert.throws(() => currentProjectInstructions(fixture), {
        message: `Shared policy ${heading} needs one canonical owner and one projection.`,
      });
    }
  }
});
