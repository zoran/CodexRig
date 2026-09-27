/** Verifies source publication from its owning session through the documented command and actual pre-push. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  ownSession,
  publicationFixture,
} from "../../../../scripts/goals/project-publication.fixture.mjs";
import { inspectRuntimeSessionLease } from "../../../../scripts/repository/runtime-session-lease.mjs";

function configure({ root, copyModule, write }) {
  copyModule(".agents/skills/reset-framework/scripts/publish-framework.mjs");
  copyModule(".agents/skills/reset-framework/scripts/publication-baseline.mjs");
  copyModule("scripts/goals/goal-publication-precondition.mjs");
  write(".agents/skills/reset-framework/SKILL.md", "# Reset fixture\n");
  write(".agents/skills/create-project-from-framework/SKILL.md", "# Generation fixture\n");
  write(".codexrig/project-tools.json", "{}\n");
  write("README.md", "# CodexRig Framework\n");
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  pkg.name = "codexrig";
  Object.assign(pkg.scripts, {
    "framework:publish": "node .agents/skills/reset-framework/scripts/publish-framework.mjs",
    "framework:reset": "node .agents/skills/reset-framework/scripts/reset-framework.mjs",
    "goal:new": "node scripts/goals/goal-publication-precondition.mjs",
    // Release-version housekeeping is covered by its owner; this fixture exercises publication.
    "repo:housekeeping": 'node -e "process.exit(0)"',
  });
  write("package.json", JSON.stringify(pkg));
  const checks = JSON.parse(readFileSync(path.join(root, ".codex/verification.json"), "utf8"));
  checks.prePushChecks = [".agents/skills/reset-framework/scripts/publication-baseline.mjs"];
  write(".codex/verification.json", JSON.stringify(checks));
}

test("the framework command preserves its session through real reset, verification and pre-push", (t) => {
  const f = publicationFixture(t, { configure });
  const session = ownSession(f.root);
  f.write("history.jsonl", "retained session history\n");
  try {
    const output = f.run("bash", [
      "scripts/setup/run-project.sh",
      "pnpm",
      "framework:publish",
      "--message",
      "Publish framework in session",
    ]);
    assert.match(output, /All 8 phases completed/u);
    assert.deepEqual(inspectRuntimeSessionLease({ root: f.root }).lease, session.lease);
    assert.equal(
      readFileSync(path.join(f.root, "history.jsonl"), "utf8"),
      "retained session history\n",
    );
    assert.equal(existsSync(path.join(f.root, "docs/project-context.md")), false);
    assert.equal(f.run("git", ["status", "--porcelain"]).trim(), "");
    assert.equal(f.counter().length, 1);
  } finally {
    session.close();
  }
});
