/** Verifies project creator contract behavior for the setup, launch, and portable project boundary. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
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

// One source block carries every portable policy; source-only policy never leaks into a child.
test("generated routing and agent policies follow canonical changes and reject ambiguous projections", (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "project-agent-policy-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const source = readFileSync(path.join(root, "instructions.md"), "utf8");
  const start = "<!-- codexrig:portable-policy:start -->";
  const end = "<!-- codexrig:portable-policy:end -->";
  const amendment = "A revised source-owned policy with its descendant detail.\n";
  const amended = source.replace(end, `${amendment}\n${end}`);
  const save = (candidate) => writeFileSync(path.join(fixture, "instructions.md"), candidate);
  save(`Framework-only introduction.\n${amended}\nFramework-only appendix.\n`);
  const generated = currentProjectInstructions(fixture);
  assert.equal(
    generated,
    `# Project Instructions\n\n${amended.split(start)[1].split(end)[0].trim()}\n`,
  );
  assert.match(generated, /A revised source-owned policy with its descendant detail/u);
  assert.doesNotMatch(generated, /Framework-only|codexrig:portable-policy/u);
  for (const candidate of [
    source.replace(start, ""),
    source.replace(end, ""),
    `${source}\n${start}\n`,
    `${source}\n${end}\n`,
    `${end}\nMisordered body.\n${start}\n`,
    `${start}\n \n${end}\n`,
  ]) {
    save(candidate);
    assert.throws(() => currentProjectInstructions(fixture), {
      message: "Portable policy needs one nonempty block with unique ordered markers.",
    });
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
