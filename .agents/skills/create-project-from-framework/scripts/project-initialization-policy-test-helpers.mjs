/** Owns generated workflow-policy assertions for source-only project initialization tests. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function assertGeneratedAutonomousContinuationContract({
  generated,
  policyDocuments,
  instructions,
  codexReadme,
}) {
  for (const content of policyDocuments) {
    assert.match(content, /codexrig-work-state/i);
    assert.match(content, /failed\s+publication.*current\s+goal.*open/is);
    assert.match(content, /ephemeral\s+side\s+conversations?/i);
    assert.match(content, /transcript_path/i);
  }
  assert.match(
    instructions,
    /<!-- codexrig-work-state\s+\{"version":1,"revision":1,"status":"active"/,
  );
  assert.match(instructions, /stop_hook_active/);
  assert.match(instructions, /untrusted resume metadata/i);
  assert.match(codexReadme, /same\s+(?:durable\s+)?turn\s+was\s+already\s+continued/i);
  assert.match(codexReadme, /resume\s+metadata\s+rather\s+than\s+authority/i);
  assert.match(codexReadme, /ephemeral\s+side\s+conversations?/i);
  assert.match(codexReadme, /transcript_path/i);
  assert.equal(
    existsSync(path.join(generated, "scripts/context/session-stop-lifecycle.mjs")),
    true,
  );
}

export function assertGeneratedWorkflowPolicyContract({
  generated,
  agents,
  readme,
  codexReadme,
  instructions,
  manifest,
}) {
  const generatedText = (relativePath) =>
    readFileSync(path.join(generated, ...relativePath.split("/")), "utf8");
  assert.match(agents, /indexes current technical facts/i);
  assert.match(agents, /docs\/future-modules\.md/i);
  assert.match(agents, /\$architecture-evolution/i);
  assert.match(agents, /Identity and Access/i);
  assert.match(agents, /\$security-review/i);
  assert.match(agents, /at most four live subagents/i);
  assert.match(agents, /exact same configured GPT Astra model/i);
  assert.match(agents, /`ultra` reasoning/i);
  assert.match(agents, /one (?:physical )?host (?:represents|is) one developer/i);
  assert.match(agents, /never permits subagents to commit,\s+merge,\s+push,\s+publish/i);
  assert.match(agents, /`dev` is the default/i);
  assert.match(agents, /already authorized YOLO session/i);
  assert.match(agents, /white-label/i);
  assert.match(agents, /config\/product\.json/i);
  assert.match(agents, /config\/tenancy\.json/i);
  assert.match(readme, /config\/localization\.json/i);
  assert.match(instructions, /mobile, tablet, and desktop/i);
  assert.match(instructions, /Runtime and technology/i);
  assert.match(instructions, /hand-authored textual file/i);
  const patterns = generatedText("scripts/verify/patterns.mjs");
  const housekeeping = generatedText("scripts/goals/repository-housekeeping.mjs");
  assert.match(patterns, /fileHeaderFindings/);
  assert.match(patterns, /declarationDocumentationFindings/);
  assert.match(housekeeping, /scripts\/verify\/patterns\.mjs/);

  assert.match(instructions, /pre-slice\s+coordination\s+check/i);
  const workflowSection = /## Workflow\n\n([\s\S]*?)\n\n## Compact Project Memory/u.exec(
    instructions,
  )?.[1];
  assert.ok(workflowSection, "generated instructions must contain their bounded Workflow section");
  assert.deepEqual(
    [...workflowSection.matchAll(/^(\d+)\.\s/gmu)].map((match) => Number(match[1])),
    Array.from({ length: 20 }, (_, index) => index + 1),
    "generated Workflow steps must be uniquely and consecutively numbered",
  );
  assert.match(instructions, /before\s+(?:every|the)\s+slice\s+begins?/i);
  assert.match(instructions, /observable\s+live-agent\s+assignments,?\s+same-clone\s+worktrees/i);
  assert.match(instructions, /before\s+relying\s+on\s+Git/i);
  assert.match(instructions, /confirmed-disjoint/i);
  assert.match(instructions, /## White-Label Product Configuration/i);
  assert.match(instructions, /Identity and Access is a dedicated trust and\s+domain boundary/i);
  assert.match(instructions, /### Product Surface Selection/i);
  assert.match(instructions, /### Requirement-Driven Technology Selection/i);
  assert.match(instructions, /### Source And Declaration Headers/i);
  assert.match(instructions, /scripts\/verify\/patterns\.mjs/i);
  assert.match(instructions, /### Localization And Language Strategy/i);
  assert.match(instructions, /pnpm localization:check/i);
  assert.match(instructions, /### Multi-Device Experience/i);
  assert.match(instructions, /### Tenant Isolation Boundary/i);
  assert.match(instructions, /deny-by-default/i);
  assert.match(instructions, /scripts\/verify\/path-hygiene\.mjs/i);
  assert.match(instructions, /deep-import one another/i);
  assert.match(instructions, /\$security-review/i);
  assert.match(
    instructions,
    /repository\/package\s+names\s+are\s+never\s+runtime\s+brand\s+fallbacks/i,
  );
  assert.match(instructions, /Ask\s+whether\s+the\s+user\s+wants\s+to\s+refine\s+it\s+further/i);
  assert.match(manifest, /Public product identity and brand: not configured/i);
  assert.match(manifest, /Product surface decision: pending/i);
  assert.match(manifest, /Tenant isolation runtime: no product tenant resolver/i);
  assert.match(manifest, /Product languages and localization: pending/i);
  assert.match(manifest, /technical source documentation use English/i);
  assert.match(codexReadme, /cannot\s+prove\s+that\s+another\s+developer's\s+clone\s+is\s+idle/i);
  for (const content of [codexReadme, instructions]) {
    assert.match(content, /declared\s+integration\s+path/i);
    assert.match(content, /directly\s+on\s+`main`/i);
    assert.match(content, /short-lived\s+task\s+branch\s+or\s+protected\s+path/i);
  }
  for (const content of [instructions]) {
    assert.match(content, /broken\s+Git\s+worktree\s+link.*ownership-confirmation\s+blocker/is);
    assert.match(
      content,
      /current\s+process\s+identity.*outside\s+its\s+bound\s+PID\s+namespace.*ownership-confirmation\s+blocker/is,
    );
    assert.match(
      content,
      /(?:never|instead\s+of)\s+repair(?:ing|s)?.*automatically|native\s+Git\s+repair\s+is\s+explicit/is,
    );
  }
  for (const content of [codexReadme, instructions]) {
    assert.match(content, /gated\s+(?:preloaded|foreground)\s+supervisor/i);
    assert.match(content, /terminal\s+child-exit\s+proof.*private\s+issue-time\s+gate\s+secret/is);
    assert.match(content, /exact\s+(?:spawned\s+)?Codex\s+(?:child\s+)?PID/i);
  }
  for (const content of [agents, instructions]) {
    assert.match(content, /modular monolith/i);
    assert.match(content, /(?:replaceable modules|independently improvable or replaceable)/i);
    assert.match(content, /exactly\s+one\s+current\s+internal\s+contract/i);
    assert.match(content, /preservation\s+is\s+a\s+safety\s+state,?\s+never\s+completion/i);
    assert.match(content, /after\s+every\s+completed\s+slice/i);
    assert.match(content, /worktree:status -- --json/i);
    assert.match(
      content,
      /(?:never\s+dual-read|no\s+runtime,[\s\S]{0,100}interprets\s+a\s+superseded\s+(?:internal\s+)?schema)/i,
    );
  }
  assert.match(instructions, /goal\s+remains\s+open[\s\S]*goal-owned\s+(?:temporary\s+)?worktree/i);
  assert.match(codexReadme, /preservation\s+is\s+a\s+safety\s+state,?\s+never\s+completion/i);
  assert.match(instructions, /assembled\s+system\s+is\s+verified\s+as\s+one\s+functioning\s+unit/i);
  assert.match(instructions, /newest\s+relevant\s+primary\s+or\s+official\s+sources/i);
  assert.match(instructions, /older\s+sources.*comparison\s+or\s+historical\s+context/is);
  assert.match(instructions, /explicit\s+user\s+confirmation/i);
  assert.match(
    instructions,
    /consolidation\s+is\s+conservative,?\s+not\s+a\s+shortening\s+target/i,
  );
  assert.match(instructions, /shared\s+pre-slice\s+coordination\s+channel/i);
  assert.match(instructions, /--source <new-framework-root>/i);
  assert.match(instructions, /--target <child-root>/i);
  assert.match(instructions, /Regenerate\s+a\s+non-current\s+framework\s+installation/i);
  assert.doesNotMatch(instructions, /--allow-same|pre-1\.2|obsolete preview/i);
  assert.match(readme, /## Framework Updates/i);
  assert.match(readme, /instructions\.md#framework-lifecycle-compatibility-and-git-platforms/u);
  assert.match(readme, /\(config\/product\.json\)/u);
  assert.match(readme, /--source <new-codexrig-root>/i);
  assert.match(manifest, /### Active Module Inventory/i);
  assert.match(manifest, /No active product modules\./i);
  assert.match(manifest, /docs\/future-modules\.md/i);
  assert.doesNotMatch(manifest, /pre-slice|fresh audit|marker commit|framework:upgrade/i);
  assert.match(
    instructions,
    /After all mutating work for a completed\s+goal.*repo:housekeeping.*before the goal-wide documentation\s+review,\s+final audit/is,
  );
  assert.match(
    instructions,
    /resulting\s+`main`\s+receives[\s\S]*completed-goal\s+documentation\s+review[\s\S]*critical-document\s+confirmation\s+and\s+preservation\s+review/i,
  );
  assert.match(
    instructions,
    /After protected or parallel integration.*rerun read-only\s+housekeeping/is,
  );
  for (const role of ["default", "explorer", "worker"]) {
    const roleContent = generatedText(`.codex/agents/${role}.toml`);
    assert.match(roleContent, /Before every assigned slice begins/, role);
    assert.match(roleContent, /observable collaboration claims/, role);
    assert.match(roleContent, /token envelope/, role);
    assert.match(roleContent, /never delegate or spawn another\s+agent/i, role);
    assert.match(roleContent, /newest relevant primary or official sources/, role);
    assert.match(roleContent, /Never[\s\S]*commit/, role);
  }
  assertGeneratedAutonomousContinuationContract({
    generated,
    policyDocuments: [instructions],
    instructions,
    codexReadme,
  });
}
