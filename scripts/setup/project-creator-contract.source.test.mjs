/** Verifies project creator contract behavior for the setup, launch, and portable project boundary. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { documentContextSections } from "../docs/document-context.mjs";
import {
  currentProjectInstructions,
  initialProjectAgents,
  writeIdentityDocs,
} from "../framework/generated-project-documents.mjs";
import { postProjectCreationGuidance } from "../../scripts/framework/source-readiness.mjs";
import {
  normalizedName,
  normalizedProjectDescription,
  parseArgs,
  slugify,
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

// Navigation and orchestration must retain their full canonical policy subtrees in child output.
test("generated routing and agent policies follow canonical changes and reject ambiguous projections", (t) => {
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

  for (const [heading, marker, level] of [
    ["Task Reading Routes", "<!-- current-task-reading-routes -->", 2],
    ["Admission, Intelligence, And Provenance", "<!-- current-agent-admission-policy -->", 3],
    ["Agent Lifecycle And Idle Cleanup", "<!-- current-agent-lifecycle-policy -->", 3],
    ["Peer Coordination", "<!-- current-peer-coordination-policy -->", 3],
    [
      "Intelligence Parity And Integration Authority",
      "<!-- current-integration-authority-policy -->",
      3,
    ],
  ]) {
    const prefix = "#".repeat(level);
    const headingLine = `${prefix} ${heading}\n`;
    const amendment = `A revised source-owned ${heading.toLowerCase()} rule.\n\n${prefix}# Projected ${heading} Detail\n\nPreserve this descendant rule.`;
    const amendedSource = source.replace(headingLine, `${headingLine}\n${amendment}\n`);
    assert.notEqual(amendedSource, source, "The fixture must change the canonical owner.");
    save(amendedSource, template);
    const generated = currentProjectInstructions(fixture);
    assert.equal(policyBody(generated, heading), policyBody(amendedSource, heading));
    assert.equal(generated.includes(marker), false, "The projection marker must be consumed.");

    for (const [candidateSource, candidateTemplate] of [
      [amendedSource.replace(headingLine, `${prefix} Renamed ${heading}\n`), template],
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

test("generated agent entry follows the shared source block and rejects ambiguous boundaries", (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "project-shared-agent-entry-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const source = readFileSync(path.join(root, "AGENTS.md"), "utf8");
  const start = "<!-- codexrig:portable-agent-entry:start -->";
  const end = "<!-- codexrig:portable-agent-entry:end -->";
  const amendment = "A revised source-owned dispatch checkpoint.\n";
  const amended = source.replace(end, `${amendment}\n${end}`);
  assert.notEqual(amended, source);
  const save = (candidate) => writeFileSync(path.join(fixture, "AGENTS.md"), candidate);
  save(`Framework-only introduction.\n${amended}\nFramework-only attribution.\n`);
  const generated = initialProjectAgents(fixture);
  assert.match(generated, /safe-entry guide for this project/u);
  assert.ok(generated.includes(amended.split(start)[1].split(end)[0].trim()));
  assert.match(generated, /Project licensing decisions belong to the project owner/u);
  assert.doesNotMatch(generated, /Framework-only|codexrig:portable-agent-entry/u);
  assert.ok(Buffer.byteLength(initialProjectAgents(root), "utf8") <= 4096);

  for (const candidate of [
    source.replace(start, ""),
    source.replace(end, ""),
    `${source}\n${start}\n`,
    `${source}\n${end}\n`,
    `${end}\nMisordered body.\n${start}\n`,
    `${start}\n \n${end}\n`,
  ]) {
    save(candidate);
    assert.throws(() => initialProjectAgents(fixture), {
      message: "Portable agent entry needs one nonempty block with unique ordered markers.",
    });
  }
});

test("generated bootstrap stays bounded for accepted Unicode display names", (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "project-bootstrap-identity-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const longName = normalizedName("Atlas " + "市民".repeat(40));
  assert.equal(slugify(longName, "package name"), "atlas");
  const bootstraps = [];
  for (const [name, escaped] of [
    ["Example [Project]", "Example \\[Project\\]"],
    [longName, longName],
  ]) {
    const target = path.join(fixture, slugify(name, "fixture directory"));
    writeIdentityDocs(root, target, name, "");
    const agents = readFileSync(path.join(target, "AGENTS.md"), "utf8");
    bootstraps.push(agents);
    assert.ok(
      Buffer.byteLength(agents, "utf8") <= 4096,
      `Accepted display names must retain the 4096-byte bootstrap limit; got ${Buffer.byteLength(agents, "utf8")}.`,
    );
    assert.ok(readFileSync(path.join(target, "README.md"), "utf8").startsWith(`# ${escaped}\n`));
    assert.ok(
      readFileSync(path.join(target, "docs/project.md"), "utf8").includes(
        `Project name: ${escaped}\n`,
      ),
    );
  }
  assert.equal(bootstraps[0], bootstraps[1], "Display names belong to the identity documents.");
});
