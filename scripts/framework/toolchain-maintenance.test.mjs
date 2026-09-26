/** Exercises compatible release selection, atomic maintenance, stable pin isolation, and startup admission. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanGitEnvironment } from "../repository/git-runtime-isolation.mjs";
import {
  projectManagedToolLayout,
  sealProjectToolBundle,
} from "../repository/project-tool-executables.mjs";
import { prepareCompatibilityTrack } from "./prepare-compatibility-track.mjs";
import { frameworkVersionReconciliationPlan } from "./framework-version.mjs";
import { readToolchainConfiguration } from "../contracts/toolchain-configuration.mjs";
import {
  validateMinimalMiseTools,
  miseLockFindings,
} from "../contracts/mise-toolchain-configuration.mjs";
import { toolingRoot, serializeCanonicalJson } from "../filesystem/repository-files.mjs";
import { applyHousekeepingWrites } from "../repository/repository-housekeeping-transaction.mjs";
import { inspectRuntimeLifecycleLock } from "../repository/runtime-session-lease.mjs";
import { assertMaintenanceInventory, maintainToolchain } from "../deps/maintain-toolchain.mjs";
import {
  latestCompatibleVersion,
  releaseBytes,
  refreshGithubActions,
  resolveToolchainReleases,
  resolveCompatibilityToolchain,
  verifiedMiseBinaryDigest,
} from "../deps/toolchain-releases.mjs";
import {
  projectToolchainConfiguration,
  toolchainMaintenanceInputs,
  toolchainConfigurationPaths,
} from "../deps/toolchain-maintenance-inputs.mjs";

const matrix = readToolchainConfiguration();
test("raw mise executables require the official digest and a fixed outer byte bound", async () => {
  const bytes = Buffer.from("verified raw executable fixture");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const asset = {
    digest: `sha256:${digest}`,
    browser_download_url: "https://github.com/jdx/mise/releases/download/fixture/mise",
  };
  const fetchImpl = async () => new Response(bytes);
  assert.equal(await verifiedMiseBinaryDigest(asset, fetchImpl), digest);
  await assert.rejects(
    verifiedMiseBinaryDigest({ ...asset, digest: `sha256:${"0".repeat(64)}` }, fetchImpl),
    /integrity/u,
  );
  await assert.rejects(
    verifiedMiseBinaryDigest({ ...asset, digest: "" }, fetchImpl),
    /no raw executable digest/u,
  );
});
function write(root, name, content) {
  mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  writeFileSync(path.join(root, name), content);
}
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "toolchain-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of toolchainConfigurationPaths)
    write(root, name, readFileSync(path.join(toolingRoot, name), "utf8"));
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
    else if (decoded.startsWith("https://registry.npmjs.org/pnpm/"))
      data = {
        name: "pnpm",
        version: decoded.endsWith("/next-12") ? "12.0.0-beta.1" : decoded.split("/").at(-1),
        dist: {
          tarball: "https://registry.npmjs.org/pnpm.tgz",
          integrity: matrix.ci.codexNpmPlatformIntegrities["linux-x64"],
        },
      };
    else if (decoded.startsWith("https://registry.npmjs.org/@openai/codex/")) {
      const requested = decoded.split("/").at(-1);
      const architecture = requested.match(
        /-(linux-x64|linux-arm64|darwin-arm64|win32-x64)$/u,
      )?.[1];
      data = {
        name: "@openai/codex",
        version: architecture ? requested : matrix.ci.codexVersion,
        dist: {
          tarball: "https://registry.npmjs.org/codex.tgz",
          integrity: architecture
            ? matrix.ci.codexNpmPlatformIntegrities[architecture]
            : matrix.ci.codexNpmPlatformIntegrities["linux-x64"],
        },
      };
      if (tamper && architecture)
        data.dist.integrity = `sha512-${Buffer.alloc(64).toString("base64")}`;
    } else if (decoded === "https://mise.jdx.dev/VERSION") {
      return new Response(matrix.ci.miseVersion + "\n");
    } else if (decoded.endsWith("/SHASUMS256.txt")) {
      return new Response(
        Object.entries(matrix.ci.miseBinarySha256)
          .map(
            ([platform, digest]) =>
              digest +
              "  ./mise-v" +
              matrix.ci.miseVersion +
              "-" +
              platform +
              (platform.startsWith("windows-") ? ".exe" : ""),
          )
          .join("\n") + "\n",
      );
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
test("official checksum lookup survives an exhausted REST quota and rejects corrupt or incomplete metadata", async () => {
  const official = registry(),
    calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith("https://api.github.com/"))
      return new Response("rate limit exceeded", { status: 403 });
    return official(url);
  };
  assert.deepEqual(await resolveToolchainReleases(matrix, { fetchImpl }), matrix);
  assert.equal(
    calls.some((url) => url.startsWith("https://api.github.com/")),
    false,
  );
  for (const corrupt of [
    (text) => text + text.split("\n")[0] + "\n",
    (text) => text.split("\n").slice(1).join("\n"),
    (text) => text.replace(/^[a-f0-9]{64}/u, "0".repeat(64)),
  ]) {
    await assert.rejects(
      resolveToolchainReleases(matrix, {
        fetchImpl: async (url) => {
          const response = await official(url);
          return url.endsWith("SHASUMS256.txt")
            ? new Response(corrupt(await response.text()))
            : response;
        },
      }),
      /ambiguous|missing|different archive digests/u,
    );
  }
  await assert.rejects(
    resolveToolchainReleases(matrix, {
      fetchImpl: async (url) =>
        url.endsWith("SHASUMS256.txt")
          ? new Response("unavailable", { status: 503 })
          : official(url),
    }),
    /HTTP 503/u,
  );
  await assert.rejects(
    releaseBytes("https://example.invalid/release", 16, async () => new Response("x".repeat(17))),
    /byte bound/u,
  );
});
function githubGitFixture(command, args) {
  assert.equal(command, "git");
  assert.equal(args[0], "ls-remote");
  const repository = args
    .at(-1)
    .replace("https://github.com/", "")
    .replace(/\.git$/u, "");
  const source = readFileSync(path.join(toolingRoot, ".github/workflows/ci.yml"), "utf8");
  const records = [...source.matchAll(/uses: ([^@ ]+)@([a-f0-9]{40}) # v(\d+\.\d+\.\d+)/gu)].filter(
    (record) => record[1] === repository,
  );
  return {
    pid: 123,
    signal: null,
    status: 0,
    stdout:
      [...new Set(records.map((record) => record[2] + "\trefs/tags/v" + record[3]))].join("\n") +
      "\n",
    stderr: "",
  };
}
test("public Git resolves lightweight and annotated releases once per repository and verifies new commits", async (t) => {
  const root = fixture(t),
    oldSha = "a".repeat(40),
    nextSha = "b".repeat(40),
    tagSha = "c".repeat(40);
  const content = `uses: actions/checkout@${oldSha} # v4.0.0\n`;
  assert.equal(
    spawnSync("git", ["init", "--template=", "--quiet"], {
      cwd: root,
      env: cleanGitEnvironment(process.env, root),
    }).status,
    0,
  );
  write(root, ".git/config", "[releaseprobe]\nmarker = inherited-project-config\n");
  const calls = [],
    directories = [];
  const spawnGit = (command, args, options) => {
    calls.push(args);
    directories.push(options.cwd);
    assert.equal(command, "git");
    assert.equal(options.env.GIT_CONFIG_NOSYSTEM, "1");
    assert.equal(options.env.GIT_CONFIG_COUNT, "0");
    assert.equal(options.env.GIT_ALLOW_PROTOCOL, "https");
    assert.equal(options.env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(options.env.GITHUB_TOKEN, undefined);
    assert.equal(options.env.HOME, options.cwd);
    assert.equal(options.env.USERPROFILE, options.cwd);
    assert.ok(options.cwd.startsWith(path.join(root, ".auth/project-tools/tmp/")));
    assert.equal(spawnSync("git", ["config", "--get", "releaseprobe.marker"], options).status, 1);
    if (args[0] === "init") return spawnSync(command, args, options);
    const stdout =
      args[0] === "ls-remote"
        ? `${oldSha}\trefs/tags/v4.0.0\n${tagSha}\trefs/tags/v4.1.0\n${nextSha}\trefs/tags/v4.1.0^{}\n${nextSha}\trefs/tags/v5.0.0\n`
        : args[0] === "rev-parse"
          ? nextSha + "\n"
          : "";
    return { pid: 123, signal: null, status: 0, stdout, stderr: "" };
  };
  assert.equal(
    await refreshGithubActions(content + content, { root, spawnGit }),
    `uses: actions/checkout@${nextSha} # v4.1.0\n`.repeat(2),
  );
  assert.equal(calls.filter((args) => args[0] === "ls-remote").length, 1);
  assert.ok(calls.some((args) => args.includes("FETCH_HEAD^{commit}")));
  assert.ok(directories.every((directory) => !existsSync(directory)));
  for (const response of [
    { status: 0, stdout: `${nextSha}\trefs/tags/v4.0.0\n` },
    { status: 0, stdout: `${oldSha}\trefs/tags/v4.0.0\n${oldSha}\trefs/tags/v4.0.0\n` },
    { status: 0, stdout: "invalid" },
    { status: 128, stdout: "" },
    { status: null, signal: "SIGTERM", stdout: "" },
  ])
    await assert.rejects(
      refreshGithubActions(content, {
        root,
        spawnGit: () => ({ pid: 123, signal: null, stderr: "", ...response }),
      }),
      /moved|invalid|indeterminate/u,
    );
  await assert.rejects(
    refreshGithubActions(content, {
      root,
      spawnGit: (command, args, options) =>
        args[0] === "rev-parse"
          ? { pid: 123, signal: null, status: 0, stdout: oldSha, stderr: "" }
          : spawnGit(command, args, options),
    }),
    /changed during lookup/u,
  );
});
test("configuration projection retains CI behavior and updates all stable pins", () => {
  const contents = Object.fromEntries(
    toolchainConfigurationPaths.map((name) => [
      name,
      readFileSync(path.join(toolingRoot, name), "utf8"),
    ]),
  );
  const candidate = structuredClone(matrix);
  candidate.stable.node.version = "24.99.0";
  candidate.stable.pnpm.version = "11.99.0";
  const result = projectToolchainConfiguration(contents, matrix, candidate);
  assert.match(result[".codex/mise.toml"], /node = "24\.99\.0"/u);
  assert.match(result[".github/workflows/ci.yml"], /container: node:24\.99\.0-bookworm/u);
  assert.match(result[".codex/toolchain.json"], /11\.99\.0/u);
  assert.match(result[".gitlab-ci.yml"], /pnpm verify/u);
});

test("multi-runtime product pins survive primary maintenance and require every locked artifact", (t) => {
  const root = fixture(t);
  const configuration = `[tools]\nnode = ["${matrix.stable.node.version}", "22.23.2"]\npnpm = "${matrix.stable.pnpm.version}"\njava = "temurin-21.0.12+101.0.LTS"\nterraform = "1.16.0"\n`;
  write(root, ".codex/mise.toml", configuration);
  const { contents } = toolchainMaintenanceInputs(root);
  const next = structuredClone(matrix);
  next.stable.node.version = "24.99.0";
  const updated = projectToolchainConfiguration(contents, matrix, next);
  const parsed = validateMinimalMiseTools(updated[".codex/mise.toml"]);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.versionLists.node, ["24.99.0", "22.23.2"]);
  assert.equal(parsed.versions.java, "temurin-21.0.12+101.0.LTS");
  const block = (tool, version) =>
    `[[tools.${tool}]]\nversion = "${version}"\nbackend = "core:${tool}"\n[tools.${tool}."platforms.linux-x64"]\nchecksum = "sha256:${"1".repeat(64)}"\nurl = "https://example.test/artifact"\n`;
  const locked = Object.entries(parsed.versionLists)
    .flatMap(([tool, pins]) => pins.map((pin) => block(tool, pin)))
    .join("\n");
  assert.deepEqual(miseLockFindings(locked, parsed.versionLists), []);
  assert.match(
    miseLockFindings(locked.replace(block("node", "22.23.2"), ""), parsed.versionLists).join(),
    /exactly one/,
  );
  assert.match(
    miseLockFindings(locked + block("node", "22.23.2"), parsed.versionLists).join(),
    /exactly one/,
  );
  next.stable.node.version = "22.23.2";
  assert.throws(() => projectToolchainConfiguration(contents, matrix, next), /collides/);
  for (const value of [
    "[]",
    '["24.1.0", "24.1.0"]',
    '["24.1.0", "lts"]',
    '"temurin-21.0.12"',
    '{"version":"24.1.0"}',
    "true",
  ])
    assert.ok(
      validateMinimalMiseTools(`[tools]\nnode = ${value}\npnpm = "11.28.0"\n`).errors.length,
      value,
    );
  assert.ok(
    validateMinimalMiseTools(configuration + '\n[tasks]\nrun = "unreviewed"\n').errors.length,
  );
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
    const beforeMatrix = readFileSync(path.join(root, ".codex/toolchain.json"), "utf8");
    if (failure === "pending") write(root, ".project-state/dependency-update/plan.json", "{}");
    const calls = [];
    const runCommand = (command, args, options = {}) => {
      calls.push([command, ...args]);
      if (args[0] === "--version") return matrix.ci.miseVersion;
      if (args.includes("--stage-toolchain")) {
        assert.equal(args.at(-1), root);
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
      spawnGit: githubGitFixture,
      installBootstrapTools: async () => ({ mise: "mise", codex: "codex" }),
      admitProjectTools: () => {},
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
      assert.equal(readFileSync(path.join(root, ".codex/toolchain.json"), "utf8"), beforeMatrix);
      if (failure === "concurrent")
        assert.match(readFileSync(path.join(root, "package.json"), "utf8"), /concurrent-owner/u);
      if (["network", "pending"].includes(failure)) assert.equal(calls.length, 0);
    }
    assert.equal(
      calls.some(
        (call) => call.includes("self-update") || (call[0] === "codex" && call.includes("update")),
      ),
      false,
    );
    assert.equal(inspectRuntimeLifecycleLock({ root }).status, "absent");
  });
}

test("locked maintenance neither resolves newer releases nor refreshes the dependency graph", async (t) => {
  const root = fixture(t);
  const before = new Map(
    [...toolchainConfigurationPaths, "package.json", "pnpm-lock.yaml"].map((file) => [
      file,
      readFileSync(path.join(root, file), "utf8"),
    ]),
  );
  const calls = [];
  const result = await maintainToolchain({
    root,
    locked: true,
    fetchImpl: async () => {
      throw new Error("Locked mode must not resolve release metadata");
    },
    runCommand: (command, args) => {
      calls.push(args);
      return "";
    },
    installBootstrapTools: async () => ({ mise: "mise", codex: "codex" }),
    admitProjectTools: () => {},
  });
  assert.deepEqual(result.changedPaths, []);
  assert.ok(calls.some((args) => args.includes("--stage-locked")));
  assert.ok(calls.some((args) => args.includes("--reproduce-toolchain")));
  assert.equal(
    calls.some((args) => args[0] === "lock" || args.includes("--stage-toolchain")),
    false,
  );
  for (const [file, bytes] of before)
    assert.equal(readFileSync(path.join(root, file), "utf8"), bytes);
});

test("compatibility selectors resolve before installation and reject a wrong registry channel", async () => {
  const track = { node: "26", pnpm: "next-12", codex: "latest" };
  const candidate = await resolveCompatibilityToolchain(matrix, track, { fetchImpl: registry() });
  assert.equal(candidate.stable.node.version, "26.1.0");
  assert.equal(candidate.stable.pnpm.version, "12.0.0-beta.1");
  const projected = projectToolchainConfiguration(
    Object.fromEntries(
      toolchainConfigurationPaths.map((file) => [
        file,
        readFileSync(path.join(toolingRoot, file), "utf8"),
      ]),
    ),
    matrix,
    candidate,
  );
  assert.deepEqual(validateMinimalMiseTools(projected[".codex/mise.toml"]).errors, []);
  await assert.rejects(
    resolveCompatibilityToolchain(matrix, track, {
      fetchImpl: async (url) => {
        const response = await registry()(url);
        if (!url.endsWith("/next-12")) return response;
        const data = await response.json();
        data.version = "13.0.0";
        return new Response(JSON.stringify(data));
      },
    }),
    /declared selector/u,
  );
  await assert.rejects(
    resolveCompatibilityToolchain(
      matrix,
      { ...track, codex: "alpha" },
      {
        fetchImpl: registry(),
      },
    ),
    /declared selector/u,
  );
});

test("disposable compatibility preparation preserves dependencies and passes the real release gate", async (t) => {
  const root = fixture(t);
  const remote = mkdtempSync(path.join(os.tmpdir(), "toolchain-remote-"));
  t.after(() => rmSync(remote, { recursive: true, force: true }));
  for (const file of [
    ".codexrig/framework.json",
    ".codexrig/compatibility.json",
    ".codexrig/project-tools.json",
    ".codex/tooling.json",
    "docs/project.md",
    ".gitignore",
    ".agents/skills/create-project-from-framework/SKILL.md",
  ])
    write(root, file, readFileSync(path.join(toolingRoot, file), "utf8"));
  const sourcePackage = JSON.parse(readFileSync(path.join(toolingRoot, "package.json"), "utf8"));
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  packageJson.version = sourcePackage.version;
  write(root, "package.json", serializeCanonicalJson(packageJson));
  const git = (cwd, ...args) => {
    const result = spawnSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd, env: cleanGitEnvironment(process.env, root), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(remote, "init", "--bare", "--quiet");
  git(root, "init", "--quiet", "--initial-branch=main");
  git(root, "add", "--all");
  git(root, "commit", "--quiet", "-m", "published fixture");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "--quiet", "--set-upstream", "origin", "main");
  git(root, "checkout", "--detach", "--quiet");
  git(root, "config", "--remove-section", "branch.main");
  const head = git(root, "rev-parse", "HEAD"),
    lockfile = readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
  const calls = [];
  const options = {
    root,
    trackId: "next-node-lts",
    fetchImpl: registry(),
    installBootstrapTools: async ({ matrix: candidate }) => {
      const layout = projectManagedToolLayout(root, candidate);
      for (const tool of [layout.mise, layout.codex]) {
        mkdirSync(path.dirname(tool.executable), { recursive: true, mode: 0o700 });
        writeFileSync(tool.executable, "fixture executable", { mode: 0o755 });
        sealProjectToolBundle(root, tool.directory, tool);
      }
      return { mise: layout.mise.executable, codex: layout.codex.executable };
    },
    admitProjectTools: () => {},
    runCommand: (command, args) => {
      calls.push(args);
      return "";
    },
  };
  await assert.rejects(
    prepareCompatibilityTrack({ ...options, trackId: "undeclared" }),
    /Unknown declared/u,
  );
  assert.deepEqual(calls, []);
  const result = await prepareCompatibilityTrack(options);
  assert.equal(result.matrix.stable.node.version, "26.1.0");
  assert.equal(readToolchainConfiguration(root).stable.node.version, "26.1.0");
  assert.equal(
    JSON.parse(readFileSync(path.join(root, "package.json"))).packageManager,
    "pnpm@11.27.0",
  );
  assert.equal(readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"), lockfile);
  assert.equal(git(root, "rev-parse", "HEAD"), head);
  const checked = frameworkVersionReconciliationPlan({ root, review: true });
  assert.deepEqual(checked.blockingFindings, []);
  assert.deepEqual(checked.driftFindings, []);
  assert.deepEqual(checked.writes, []);
  assert.equal(calls.filter((args) => args.includes("--stage-locked")).length, 2);
  assert.equal(
    calls.some((args) => args.includes("--stage-toolchain")),
    false,
  );
  assert.equal(inspectRuntimeLifecycleLock({ root }).status, "absent");
  assert.deepEqual(readToolchainConfiguration(), matrix);
});
