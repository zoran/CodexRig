import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { hasContradictoryStopHookIndexContract } from "../context/portable-context-contract.mjs";
import {
  generatedPolicyProjectionLines,
  readPolicyProjection,
} from "../framework/policy-projection.mjs";
import {
  generatedFrameworkAgentPolicy,
  generatedFrameworkManifestPolicy,
  generatedFrameworkReadmePolicy,
} from "../../.agents/skills/create-project-from-framework/scripts/generated-framework-policy.mjs";
import { postProjectCreationGuidance } from "../../.agents/skills/create-project-from-framework/scripts/source-readiness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const projectCreatorSkill = ".agents/skills/create-project-from-framework/SKILL.md";
const content = readFileSync(path.join(root, projectCreatorSkill), "utf8");

test("the source-only project creator keeps the Stop-hook mutation contract", () => {
  assert.equal(hasContradictoryStopHookIndexContract(content), false);
  assert.equal(
    hasContradictoryStopHookIndexContract(
      `${content}\nProject hooks never update the context index.\n`,
    ),
    true,
  );
});

test("the source-only project creator derives generated policy surfaces from one owner", () => {
  const projection = readPolicyProjection(root);
  assert.equal(projection.invariants.length, 8);
  assert.deepEqual(generatedFrameworkAgentPolicy, generatedPolicyProjectionLines("agents"));
  assert.deepEqual(generatedFrameworkManifestPolicy, generatedPolicyProjectionLines("manifest"));
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
  assert.match(dirtyGuidance, /pnpm verify/);
  for (const command of ["git status --short", "git add --", "git commit -m", "git push"]) {
    assert.match(dirtyGuidance, new RegExp(command.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  }
});
