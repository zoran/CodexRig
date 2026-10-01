/** Verifies toolchain maintenance candidate admission before installation and publication. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import { inspectRuntimeLifecycleLock } from "../repository/runtime-session-lease.mjs";
import { maintainToolchain } from "./maintain-toolchain.mjs";
import { toolchainConfigurationPaths } from "./toolchain-maintenance-inputs.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "candidate-toolchain-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const relative of toolchainConfigurationPaths) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), readFileSync(path.join(toolingRoot, relative)));
  }
  const matrix = JSON.parse(readFileSync(path.join(root, ".codex/toolchain.json"), "utf8"));
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "candidate-fixture",
      version: "1.0.0",
      private: true,
      packageManager: `pnpm@${matrix.stable.pnpm.version}`,
      devDependencies: {},
    }) + "\n",
  );
  writeFileSync(
    path.join(root, "pnpm-workspace.yaml"),
    "packages: []\nstrictPeerDependencies: true\nengineStrict: true\n",
  );
  writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  return root;
}

function omitForeignArtifact(lock) {
  const altered = lock.replace(
    /^\[tools\.pnpm\."platforms\.linux-arm64-musl"\]\r?\n[^[]*/mu,
    '[tools.pnpm."platforms.linux-arm64-musl"]\nprovenance = "github-attestations"\n\n',
  );
  assert.notEqual(altered, lock, "fixture must contain the foreign-platform artifact");
  return altered;
}

for (const mutationAt of ["before-install", "after-dependencies"]) {
  test(`maintenance rejects an incomplete foreign platform ${mutationAt} without publishing`, async (t) => {
    const root = fixture(t);
    if (mutationAt === "before-install") {
      const file = path.join(root, ".codex/mise.lock");
      writeFileSync(file, omitForeignArtifact(readFileSync(file, "utf8")));
    }
    const before = new Map(
      [...toolchainConfigurationPaths, "package.json", "pnpm-lock.yaml"].map((relative) => [
        relative,
        readFileSync(path.join(root, relative), "utf8"),
      ]),
    );
    const calls = [];
    await assert.rejects(
      maintainToolchain({
        root,
        locked: true,
        fetchImpl: async () => {
          throw new Error("locked candidate must not use network");
        },
        installBootstrapTools: async () => ({ mise: "fixture-mise", codex: "fixture-codex" }),
        admitProjectTools: () => {},
        runCommand: (command, args, options = {}) => {
          calls.push(args);
          if (args.includes("--stage-locked")) {
            const file = path.join(options.cwd, ".codex/mise.lock");
            writeFileSync(file, omitForeignArtifact(readFileSync(file, "utf8")));
            writeFileSync(
              path.join(options.cwd, "pnpm-lock.yaml"),
              "lockfileVersion: '9.0'\n# candidate\n",
            );
          }
          return "";
        },
      }),
      /Candidate toolchain lock is invalid:.*linux-arm64-musl/u,
    );
    assert.equal(
      calls.some((args) => args.includes("--reproduce-toolchain")),
      false,
    );
    if (mutationAt === "before-install") assert.deepEqual(calls, []);
    else assert.ok(calls.some((args) => args.includes("--stage-locked")));
    for (const [relative, bytes] of before)
      assert.equal(readFileSync(path.join(root, relative), "utf8"), bytes);
    assert.equal(inspectRuntimeLifecycleLock({ root }).status, "absent");
    assert.equal(existsSync(path.join(root, ".project-state/repository-housekeeping")), false);
  });
}
