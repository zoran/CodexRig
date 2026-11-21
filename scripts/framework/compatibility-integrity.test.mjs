/** Verifies local compatibility matrix discovery and host toolchain freshness reporting. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { readCompatibilityMatrix } from "../contracts/framework-contract.mjs";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import { compatibilityFreshnessWarnings } from "../setup/tooling-doctor.mjs";

function matrixCommand(...args) {
  return spawnSync(process.execPath, ["scripts/framework/compatibility-matrix.mjs", ...args], {
    cwd: toolingRoot,
    encoding: "utf8",
    timeout: 10000,
  });
}

test("local compatibility discovery exposes declared versions and experiment selectors", () => {
  const reply = matrixCommand("--json");
  assert.equal(reply.status, 0, reply.stderr);
  assert.deepEqual(JSON.parse(reply.stdout), readCompatibilityMatrix());
  const missing = matrixCommand("--check-track");
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /declared compatibility track id/u);
  const unknown = matrixCommand("--check-track", "absent");
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown compatibility track/u);
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
        message: `Codex stable ${newerCodex} is newer than the local toolchain pin ${matrix.ci.codexVersion}. Run startup maintenance to review the official archives and update the shared installation.`,
      },
    ],
  );
});
