/** Verifies project creator contract behavior for the setup, launch, and portable project boundary. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  generatedPolicyProjectionLines,
  readPolicyProjection,
} from "../framework/policy-projection.mjs";
import {
  generatedFrameworkAgentPolicy,
  generatedFrameworkReadmePolicy,
} from "../../.agents/skills/create-project-from-framework/scripts/generated-framework-projections.mjs";
import { postProjectCreationGuidance } from "../../.agents/skills/create-project-from-framework/scripts/source-readiness.mjs";
import {
  normalizedProjectDescription,
  parseArgs,
} from "../../.agents/skills/create-project-from-framework/scripts/project-options.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const projectCreatorSkill = ".agents/skills/create-project-from-framework/SKILL.md";
const content = readFileSync(path.join(root, projectCreatorSkill), "utf8");

test("the source-only project creator derives generated policy surfaces from one owner", () => {
  const projection = readPolicyProjection(root);
  assert.equal(projection.policies.length, 33);
  const projectedPolicy = projection.policies.map(({ statement }) => statement).join("\n");
  assert.match(projectedPolicy, /current-state inventory, never a roadmap/);
  assert.match(projectedPolicy, /exact same configured GPT Astra model and `ultra` reasoning/);
  assert.match(projectedPolicy, /account- or host-wide process listings are untrusted discovery/i);
  assert.match(projectedPolicy, /one stable SemVer owner/);
  assert.match(projectedPolicy, /Delivery targets are explicit: `dev` is the default/);
  assert.match(projectedPolicy, /Portable Codex sessions default to on-request approval/);
  assert.match(projectedPolicy, /Every generated product is white-label/);
  assert.match(projectedPolicy, /Identity and Access is a dedicated trust and domain boundary/);
  assert.match(projectedPolicy, /creates a new module in an existing domain/);
  assert.match(projectedPolicy, /Every generated project is tenant-capable from creation/);
  assert.match(projectedPolicy, /root Node\.js\/pnpm\/mise toolchain is Codex harness tooling/);
  assert.match(projectedPolicy, /Every product UI assumes mobile, tablet, and desktop/);
  assert.match(projectedPolicy, /derive whether the product is web\/PWA/);
  assert.match(projectedPolicy, /Source code, identifiers, filenames, tests/);
  assert.match(
    projectedPolicy,
    /Every hand-authored textual file in the framework and every generated project/,
  );
  assert.match(projectedPolicy, /Every completed non-trivial implementation/);
  assert.match(projectedPolicy, /AGENTS\.md` is an always-loaded safe-entry bootstrap capped/);
  assert.match(projectedPolicy, /complete Startup Repository Reconstruction/);
  assert.match(projectedPolicy, /pnpm handover:create -- --critical/);
  assert.match(projectedPolicy, /Success is an absolute stop boundary/);
  assert.deepEqual(generatedFrameworkAgentPolicy, generatedPolicyProjectionLines("agents"));
  assert.throws(() => generatedPolicyProjectionLines("manifest"), /Unsupported generated policy/);
  for (const line of generatedPolicyProjectionLines("readme")) {
    assert.ok(generatedFrameworkReadmePolicy.includes(line));
  }
});

test("the project creator gives post-exit cleanup guidance and only conditional Git guidance", () => {
  const cleanGuidance = postProjectCreationGuidance({ sourceHasChanges: false }).join("\n");
  assert.match(cleanGuidance, /no commit or push was performed/i);
  assert.match(cleanGuidance, /pnpm framework:reset --apply/);
  assert.doesNotMatch(cleanGuidance, /git status|git add|git commit|git push/i);

  const dirtyGuidance = postProjectCreationGuidance({ sourceHasChanges: true }).join("\n");
  assert.match(dirtyGuidance, /Optional Git publication/);
  assert.match(dirtyGuidance, /pnpm framework:publish --message "<message>"/);
  assert.match(dirtyGuidance, /commits all non-ignored changes/);
});

test("the project creator accepts a bounded detailed manifest seed without making it mandatory", () => {
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
