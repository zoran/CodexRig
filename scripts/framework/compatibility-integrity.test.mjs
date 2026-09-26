/** Verifies compatibility CI uses the single private installer and preserves experimental selection. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { readCompatibilityMatrix } from "../contracts/framework-contract.mjs";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import { ciAdapterContractViolations } from "../deps/ci-toolchain-contract.mjs";
import { projectCiProjection } from "./generated-project-tooling.mjs";
import { gitlabChildPipeline } from "./compatibility-matrix.mjs";
import { compatibilityFreshnessWarnings } from "../setup/tooling-doctor.mjs";

for (const [provider, file] of [
  ["github", ".github/workflows/ci.yml"],
  ["gitlab", ".gitlab-ci.yml"],
]) {
  test(`${provider} source and generated CI enter the common isolated locked execution flow`, () => {
    const source = readFileSync(path.join(toolingRoot, file), "utf8");
    const generated = projectCiProjection(file, source);
    for (const content of [source, generated]) {
      assert.deepEqual(ciAdapterContractViolations(provider, content), []);
      assert.ok(
        ciAdapterContractViolations(
          provider,
          content.replace("maintain-toolchain.mjs --locked", "maintain-toolchain.mjs"),
        ).includes("reviewed-local-install"),
      );
      assert.ok(
        ciAdapterContractViolations(
          provider,
          content.replace("run-project.sh pnpm verify", "run-project.sh node --version"),
        ).includes("isolated-verification"),
      );
      assert.ok(
        ciAdapterContractViolations(
          provider,
          content + "\n# forbidden installer: npm install --global candidate\n",
        ).includes("global-tool-install"),
      );
    }
    assert.doesNotMatch(
      generated,
      /prepare-compatibility-track|compatibility-canary|framework:doctor|repo:housekeeping/u,
    );
  });
}

test("GitLab experiments select declared tracks through the same owned maintenance transaction", () => {
  const matrix = readCompatibilityMatrix();
  const source = gitlabChildPipeline(matrix);
  assert.doesNotMatch(source, /npm install --global|mise_stage|codex_install_root/u);
  assert.equal(
    source.split("prepare-compatibility-track.mjs --disposable-checkout").length - 1,
    matrix.canaries.length,
  );
  assert.equal(source.split("run-project.sh pnpm verify").length - 1, matrix.canaries.length);
  for (const track of matrix.canaries)
    assert.ok(source.includes(`CODEXRIG_COMPATIBILITY_TRACK: '${track.id}'`));
});

test("online freshness names the distinct stable and reviewed Codex versions", () => {
  const matrix = readCompatibilityMatrix();
  const [major, minor, patch] = matrix.ci.codexVersion.split(".").map(Number);
  const newerCodex = `${major}.${minor}.${patch + 1}`;
  assert.deepEqual(
    compatibilityFreshnessWarnings(matrix, {
      codex: newerCodex,
      pnpm: matrix.stable.pnpm.version,
    }),
    [
      {
        code: "online.codex.newer",
        message: `Codex stable ${newerCodex} is newer than the reviewed blocking-CI version ${matrix.ci.codexVersion}; run canonical startup maintenance to review the official archives and update project installations and CI pins together.`,
      },
    ],
  );
});
