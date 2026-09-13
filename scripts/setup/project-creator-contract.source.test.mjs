/** Verifies project creator contract behavior for the setup, launch, and portable project boundary. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { postProjectCreationGuidance } from "../../scripts/framework/source-readiness.mjs";
import {
  normalizedProjectDescription,
  parseArgs,
} from "../../scripts/framework/project-options.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const projectCreatorSkill = ".agents/skills/create-project-from-framework/SKILL.md";
const content = readFileSync(path.join(root, projectCreatorSkill), "utf8");

test("the project creator gives post-exit cleanup guidance and only conditional Git guidance", () => {
  const cleanGuidance = postProjectCreationGuidance({ sourceHasChanges: false }).join("\n");
  assert.match(cleanGuidance, /did not modify source files, initialize Git, commit or push/i);
  assert.doesNotMatch(cleanGuidance, /framework:publish/i);
  const dirtyGuidance = postProjectCreationGuidance({ sourceHasChanges: true }).join("\n");
  assert.match(dirtyGuidance, /every owning Codex session exits/);
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
