/** Exercises compatible release selection, atomic maintenance, receipt isolation, and startup admission. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  frameworkRoot,
  readCompatibilityMatrix,
  readFrameworkContract,
  serializeCanonicalJson,
} from "../contracts/framework-contract.mjs";
import { applyHousekeepingWrites } from "../repository/repository-housekeeping-transaction.mjs";
import { inspectRuntimeLifecycleLock } from "../repository/runtime-session-lease.mjs";
import { assertMaintenanceInventory, maintainToolchain } from "./maintain-toolchain.mjs";
import {
  latestCompatibleVersion,
  refreshGithubActions,
  resolveToolchainReleases,
  verifiedMiseBinaryDigest,
} from "./toolchain-releases.mjs";
import {
  projectToolchainConfiguration,
  receiptWithMaintainedPackageManager,
  toolchainConfigurationPaths,
} from "./toolchain-maintenance-inputs.mjs";
import { packageUpdatePlan } from "./framework-upgrade-package.mjs";

const matrix = readCompatibilityMatrix();
test("raw mise executables use the declared asset size and digest with a fixed outer bound", async () => {
  const bytes = Buffer.from("verified raw executable fixture");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const asset = {
    size: bytes.length,
    digest: `sha256:${digest}`,
    browser_download_url: "https://github.com/jdx/mise/releases/download/fixture/mise",
  };
  const fetchImpl = async () => new Response(bytes);
  assert.equal(await verifiedMiseBinaryDigest(asset, fetchImpl), digest);
  await assert.rejects(
    verifiedMiseBinaryDigest({ ...asset, size: bytes.length - 1 }, fetchImpl),
    /byte bound/u,
  );
  await assert.rejects(
    verifiedMiseBinaryDigest({ ...asset, size: bytes.length + 1 }, fetchImpl),
    /size or integrity/u,
  );
  await assert.rejects(
    verifiedMiseBinaryDigest({ ...asset, digest: `sha256:${"0".repeat(64)}` }, fetchImpl),
    /integrity/u,
  );
  await assert.rejects(
    verifiedMiseBinaryDigest({ ...asset, size: 257 * 1024 * 1024 }, fetchImpl),
    /bounded raw executable/u,
  );
});
function write(root, name, content) {
  mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  writeFileSync(path.join(root, name), content);
}
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "toolchain-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const contract = readFrameworkContract();
  contract.upgrade.managedRoots = [".codexrig/framework.json"];
  contract.upgrade.managedPackageScripts = ["verify"];
  contract.upgrade.managedDevDependencies = ["prettier"];
  write(root, ".codexrig/framework.json", serializeCanonicalJson(contract));
  write(root, ".agents/skills/create-project-from-framework/SKILL.md", "# Source Fixture\n");
  for (const name of toolchainConfigurationPaths)
    write(root, name, readFileSync(path.join(frameworkRoot, name), "utf8"));
  write(
    root,
    "package.json",
    serializeCanonicalJson({
      name: "fixture",
      version: "1.0.0",
      private: true,
      license: "PolyForm-Noncommercial-1.0.0",
      packageManager: `pnpm@${matrix.stable.pnpm.version}`,
      scripts: { verify: "node --version" },
      devDependencies: { prettier: "^3.9.6" },
    }),
  );
  write(
    root,
    "pnpm-workspace.yaml",
    "packages: []\nstrictPeerDependencies: true\nengineStrict: true\n",
  );
  write(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  return root;
}
function registry({ tamper = false, newerNode = false } = {}) {
  return async (url) => {
    let data;
    const decoded = decodeURIComponent(url);
    if (decoded === "https://nodejs.org/dist/index.json")
      data = [
        { version: `v${matrix.stable.node.version}`, lts: "Krypton" },
        ...(newerNode ? [{ version: "v24.99.0", lts: "Krypton" }] : []),
        { version: "v26.1.0", lts: false },
      ];
    else if (decoded === "https://registry.npmjs.org/pnpm")
      data = { versions: { [matrix.stable.pnpm.version]: {}, "12.0.0": {} } };
    else if (decoded.startsWith("https://registry.npmjs.org/@openai/codex/")) {
      const requested = decoded.split("/").at(-1);
      const architecture = requested.match(/-linux-(x64|arm64)$/u)?.[1];
      data = {
        name: "@openai/codex",
        version: architecture ? requested : matrix.ci.codexVersion,
        dist: {
          tarball: "https://registry.npmjs.org/codex.tgz",
          integrity: architecture
            ? matrix.ci.codexNpmPlatformIntegrities[architecture]
            : matrix.ci.codexNpmPackageIntegrity,
        },
      };
      if (tamper && !architecture)
        data.dist.integrity = `sha512-${Buffer.alloc(64).toString("base64")}`;
    } else if (decoded.startsWith("https://registry.npmjs.org/@jdxcode/mise-linux-")) {
      const architecture = decoded.includes("linux-arm64") ? "arm64" : "x64";
      data = {
        name: `@jdxcode/mise-linux-${architecture}`,
        version: matrix.ci.miseVersion,
        dist: {
          tarball: "https://registry.npmjs.org/mise.tgz",
          integrity: matrix.ci.miseNpmPackageIntegrities[architecture],
        },
      };
    } else if (decoded.startsWith("https://api.github.com/repos/")) {
      const [, repository, major] = decoded.match(
        /repos\/(.+)\/git\/matching-refs\/tags\/v(\d+)\./u,
      );
      const source = readFileSync(path.join(frameworkRoot, ".github/workflows/ci.yml"), "utf8");
      const record = [
        ...source.matchAll(/uses: ([^@ ]+)@([a-f0-9]{40}) # v(\d+\.\d+\.\d+)/gu),
      ].find((entry) => entry[1] === repository && entry[3].startsWith(`${major}.`));
      data = [{ ref: `refs/tags/v${record[3]}`, object: { type: "commit", sha: record[2] } }];
    } else throw new Error(`Unexpected test fetch: ${decoded}`);
    return new Response(JSON.stringify(data));
  };
}

test("selection preserves explicit ranges and rejects stale, prerelease and incompatible candidates", () => {
  assert.equal(
    latestCompatibleVersion(
      ["11.1.0", "11.2.0", "11.3.0-beta.1", "12.0.0"],
      ">=11.0.0 <12.0.0",
      "11.1.0",
    ),
    "11.2.0",
  );
  assert.throws(
    () => latestCompatibleVersion(["11.0.0"], ">=11.0.0 <12.0.0", "11.1.0"),
    /downgrade/u,
  );
});
test("unchanged official releases preserve review metadata and reject republished digests", async () => {
  assert.deepEqual(await resolveToolchainReleases(matrix, { fetchImpl: registry() }), matrix);
  await assert.rejects(
    resolveToolchainReleases(matrix, { fetchImpl: registry({ tamper: true }) }),
    /different archive digests/u,
  );
  await assert.rejects(
    resolveToolchainReleases(matrix, {
      fetchImpl: async () => {
        throw new Error("offline");
      },
    }),
    /offline/u,
  );
});
test("CI action tags advance within the selected major and moving existing tags are rejected", async () => {
  const oldSha = "a".repeat(40),
    nextSha = "b".repeat(40);
  const content = `uses: actions/checkout@${oldSha} # v4.0.0\n`;
  const fetchImpl = async () =>
    new Response(
      JSON.stringify([
        { ref: "refs/tags/v4.0.0", object: { type: "commit", sha: oldSha } },
        { ref: "refs/tags/v4.1.0", object: { type: "commit", sha: nextSha } },
        { ref: "refs/tags/v5.0.0", object: { type: "commit", sha: nextSha } },
      ]),
    );
  assert.equal(
    await refreshGithubActions(content, { fetchImpl }),
    `uses: actions/checkout@${nextSha} # v4.1.0\n`,
  );
  await assert.rejects(
    refreshGithubActions(content, {
      fetchImpl: async () =>
        new Response(
          JSON.stringify([{ ref: "refs/tags/v4.0.0", object: { type: "commit", sha: nextSha } }]),
        ),
    }),
    /moved its existing release tag/u,
  );
});
test("configuration projection retains CI behavior and updates all stable pins", () => {
  const contents = Object.fromEntries(
    toolchainConfigurationPaths.map((name) => [
      name,
      readFileSync(path.join(frameworkRoot, name), "utf8"),
    ]),
  );
  const candidate = structuredClone(matrix);
  candidate.stable.node.version = "24.99.0";
  candidate.stable.pnpm.version = "11.99.0";
  const result = projectToolchainConfiguration(contents, matrix, candidate);
  assert.match(result["mise.toml"], /node = "24\.99\.0"/u);
  assert.match(result[".github/workflows/ci.yml"], /node-version: 24\.99\.0/u);
  assert.match(result[".gitlab-ci.yml"], /pnpm@11\.99\.0/u);
  assert.match(result[".gitlab-ci.yml"], /pnpm verify/u);
});
test("receipt maintenance changes only its two package-manager fields", () => {
  const original = {
    managedFiles: { code: { sha256: "proof" } },
    installedFiles: { code: { sha256: "other proof" } },
    managedPackage: { packageManager: "pnpm@11.0.0", scripts: { verify: "owned" } },
    installedPackage: { packageManager: "pnpm@11.0.0", devDependencies: { prettier: "pinned" } },
    pendingReconciliation: null,
  };
  const result = JSON.parse(receiptWithMaintainedPackageManager(original, "pnpm@11.99.0"));
  result.managedPackage.packageManager = original.managedPackage.packageManager;
  result.installedPackage.packageManager = original.installedPackage.packageManager;
  assert.deepEqual(result, original);
});
test("framework package upgrades preserve independently maintained project tools", (t) => {
  const root = fixture(t);
  const target = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const sourceManaged = {
    license: target.license,
    packageManager: "pnpm@11.0.0",
    scripts: target.scripts,
    devDependencies: target.devDependencies,
  };
  const plan = packageUpdatePlan({
    sourceManaged,
    targetRoot: root,
    receipt: { managedPackage: sourceManaged },
    preservePackageManager: true,
  });
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.operation, null);
});
test("canonical startup blocks active roots while explicit maintenance can own its current slice", () => {
  const current = { current: true, path: "/project", problem: null, session: { status: "active" } };
  assertMaintenanceInventory({ worktrees: [current] });
  assert.throws(
    () => assertMaintenanceInventory({ worktrees: [current] }, { startup: true }),
    /active worktrees/u,
  );
  assert.throws(
    () => assertMaintenanceInventory({ worktrees: [{ ...current, current: false }] }),
    /active worktrees/u,
  );
  assert.throws(
    () =>
      assertMaintenanceInventory({ worktrees: [{ ...current, session: { status: "unknown" } }] }),
    /unsafe/u,
  );
});
test("shared finalization failure restores the complete current batch", (t) => {
  const root = fixture(t);
  write(root, "one.txt", "before one");
  write(root, "two.txt", "before two");
  assert.throws(
    () =>
      applyHousekeepingWrites({
        root,
        writes: [
          { relativePath: "one.txt", before: "before one", after: "after one" },
          { relativePath: "two.txt", before: "before two", after: "after two" },
        ],
        afterApply: () => {
          throw new Error("install rejected");
        },
      }),
    /install rejected/u,
  );
  assert.equal(readFileSync(path.join(root, "one.txt"), "utf8"), "before one");
  assert.equal(readFileSync(path.join(root, "two.txt"), "utf8"), "before two");
  assert.equal(existsSync(path.join(root, ".project-state/repository-housekeeping")), false);
});
for (const failure of ["network", "peer", "reproduce", "concurrent", "pending", "none"]) {
  test(`complete maintenance ${failure} preserves input and ownership invariants`, async (t) => {
    const root = fixture(t);
    const before = readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
    const beforeMatrix = readFileSync(path.join(root, ".codexrig/compatibility.json"), "utf8");
    if (failure === "pending") write(root, ".project-state/dependency-update/plan.json", "{}");
    const calls = [];
    const runCommand = (command, args, options = {}) => {
      calls.push([command, ...args]);
      if (args[0] === "--version") return matrix.ci.miseVersion;
      if (args.includes("--stage-toolchain")) {
        if (failure === "peer") throw new Error("peer dependency conflict");
        write(options.cwd, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n# refreshed fixture\n");
        if (failure === "concurrent") write(root, "package.json", '{"name":"concurrent-owner"}\n');
      }
      if (args.includes("--reproduce-toolchain") && failure === "reproduce")
        throw new Error("frozen reproduction failed");
      return "";
    };
    const operation = maintainToolchain({
      root,
      fetchImpl:
        failure === "network"
          ? async () => {
              throw new Error("registry unavailable");
            }
          : registry({ newerNode: failure === "reproduce" }),
      runCommand,
    });
    if (failure === "none") {
      const result = await operation;
      assert.ok(result.changedPaths.includes("pnpm-lock.yaml"));
      assert.ok(calls.some((args) => args.includes("--reproduce-toolchain")));
    } else {
      await assert.rejects(
        operation,
        failure === "network"
          ? /registry unavailable/u
          : failure === "peer"
            ? /peer dependency/u
            : failure === "reproduce"
              ? /frozen reproduction/u
              : failure === "pending"
                ? /reviewed dependency transaction/u
                : /changed/u,
      );
      assert.equal(readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"), before);
      assert.equal(
        readFileSync(path.join(root, ".codexrig/compatibility.json"), "utf8"),
        beforeMatrix,
      );
      if (failure === "concurrent")
        assert.match(readFileSync(path.join(root, "package.json"), "utf8"), /concurrent-owner/u);
      if (["network", "pending"].includes(failure)) assert.equal(calls.length, 0);
    }
    assert.equal(inspectRuntimeLifecycleLock({ root }).status, "absent");
  });
}
