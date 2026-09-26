/** Verifies complete private native installations, archive admission and executable trust together. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readToolchainConfiguration } from "../contracts/toolchain-configuration.mjs";
import {
  prepareProjectToolDirectories,
  projectToolEnvironment,
} from "../repository/project-tool-environment.mjs";
import {
  projectManagedToolLayout,
  sealProjectToolBundle,
  verifyProjectToolBundle,
} from "../repository/project-tool-executables.mjs";
import {
  acquireRuntimeLifecycleLock,
  releaseRuntimeLifecycleLock,
} from "../repository/runtime-session-lease.mjs";
import { canonicalRuntimeExecutable } from "../setup/startup-runtime-executables.mjs";
import {
  installProjectBootstrapTools,
  retireReplacedProjectTools,
} from "./project-tool-installation.mjs";

function fixture(t, { link = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "project-tool-install-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const p = prepareProjectToolDirectories(root);
  const matrix = structuredClone(readToolchainConfiguration());
  const layout = projectManagedToolLayout(root, matrix);
  const archives = new Map();
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    const result = spawnSync(command, args, {
      cwd: root,
      env: projectToolEnvironment({ root }),
      encoding: "utf8",
      timeout: 20_000,
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  for (const tool of [layout.mise, layout.codex]) {
    if (tool.name === "mise") {
      const bytes = Buffer.from(`#!/bin/sh\nprintf '%s\\n' '${tool.version}'\n`);
      const target = path.basename(tool.directory);
      matrix.ci.miseBinarySha256[target] = createHash("sha256").update(bytes).digest("hex");
      archives.set(tool.source.url, bytes);
      continue;
    }
    const parent = path.join(p.temporary, `fixture-${tool.name}`);
    const payload = path.join(parent, "package");
    const executable = path.join(payload, path.relative(tool.directory, tool.executable));
    mkdirSync(path.dirname(executable), { recursive: true });
    writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' '${tool.version}'\n`, { mode: 0o755 });
    writeFileSync(path.join(payload, "LICENSE"), "preserved distribution notice\n");
    if (link) symlinkSync(root, path.join(payload, "external-link"));
    const archive = path.join(parent, "release.tgz");
    run("/usr/bin/tar", ["-czf", archive, "-C", parent, "package"]);
    const bytes = readFileSync(archive);
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    const name = tool.source.name;
    const version = tool.source.version;
    matrix.ci.codexNpmPlatformIntegrities[`${process.platform}-${process.arch}`] = integrity;
    archives.set(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`, {
      name,
      version,
      dist: { integrity, tarball: `https://registry.npmjs.org/${tool.name}.tgz` },
    });
    archives.set(`https://registry.npmjs.org/${tool.name}.tgz`, bytes);
  }
  mkdirSync(path.join(root, ".codex"));
  writeFileSync(path.join(root, ".codex/toolchain.json"), JSON.stringify(matrix));
  calls.length = 0;
  const fetchImpl = async (url) => {
    assert.ok(archives.has(url), url);
    const value = archives.get(url);
    return new Response(Buffer.isBuffer(value) ? value : JSON.stringify(value));
  };
  return { root, matrix, run, fetchImpl, archives, calls };
}

async function install(f) {
  const owner = acquireRuntimeLifecycleLock({ root: f.root, operation: "toolchain-maintenance" });
  try {
    return await installProjectBootstrapTools(f);
  } finally {
    releaseRuntimeLifecycleLock({ root: f.root, owner });
  }
}

test("native bundles retain resources, reuse verified versions and reject changed executable trees", async (t) => {
  const f = fixture(t);
  await assert.rejects(installProjectBootstrapTools(f), /lifecycle owner/u);
  const result = await install(f);
  const layout = projectManagedToolLayout(f.root);
  for (const [name, executable] of Object.entries(result)) {
    assert.equal(canonicalRuntimeExecutable(f.root, executable, name), executable);
    if (name === "codex")
      assert.equal(
        readFileSync(path.join(layout[name].directory, "LICENSE"), "utf8"),
        "preserved distribution notice\n",
      );
    assert.equal(f.run(executable, []).trim(), layout[name].version);
  }
  const before = f.calls.length;
  assert.deepEqual(
    await install({
      ...f,
      fetchImpl: () => {
        throw new Error("unexpected download");
      },
    }),
    result,
  );
  assert.equal(f.calls.length, before);
  const unmanaged = path.join(f.root, "project-binary");
  writeFileSync(unmanaged, "#!/bin/sh\nexit 0\n");
  chmodSync(unmanaged, 0o755);
  assert.throws(() => canonicalRuntimeExecutable(f.root, unmanaged, "unmanaged"), /outside/u);
  writeFileSync(path.join(layout.codex.directory, "LICENSE"), "changed resource\n");
  assert.throws(() => verifyProjectToolBundle(f.root, layout.codex), /installation changed/u);
  await assert.rejects(install(f), /installation changed/u);
  assert.ok(existsSync(result.codex));
});

test("corrupt bytes and linked archives fail before an executable is published", async (t) => {
  const corrupt = fixture(t);
  corrupt.archives.set(
    projectManagedToolLayout(corrupt.root).mise.source.url,
    Buffer.from("corrupt release"),
  );
  await assert.rejects(install(corrupt), /integrity/u);
  assert.equal(corrupt.calls.length, 0);
  assert.equal(existsSync(projectManagedToolLayout(corrupt.root).mise.directory), false);
  const linked = fixture(t, { link: true });
  await assert.rejects(install(linked), /link entries/u);
  assert.equal(existsSync(projectManagedToolLayout(linked.root).codex.directory), false);
  assert.ok(linked.calls.every(([, option]) => option !== "-xzf"));
});

test("quiescent retirement removes verified replaced tools and preserves account state", async (t) => {
  const f = fixture(t);
  await install(f);
  const previousMatrix = structuredClone(f.matrix);
  previousMatrix.ci.miseVersion = "2026.9.12";
  const oldTool = projectManagedToolLayout(f.root, previousMatrix).mise;
  const current = projectManagedToolLayout(f.root).mise;
  cpSync(current.directory, oldTool.directory, { recursive: true });
  sealProjectToolBundle(f.root, oldTool.directory, oldTool);
  const account = path.join(f.root, ".auth", "preserved-account");
  writeFileSync(account, "account sentinel", { mode: 0o600 });
  assert.throws(() => retireReplacedProjectTools({ ...f, previousMatrix }), /lifecycle owner/u);
  const owner = acquireRuntimeLifecycleLock({ root: f.root, operation: "toolchain-maintenance" });
  try {
    const retired = retireReplacedProjectTools({ ...f, previousMatrix, owner });
    assert.deepEqual(retired, [oldTool.directory]);
    assert.equal(existsSync(oldTool.directory), false);
    assert.equal(verifyProjectToolBundle(f.root, current), current.executable);
    assert.equal(readFileSync(account, "utf8"), "account sentinel");
    assert.ok(f.calls.some((call) => call.includes("--tools") && call.includes("--yes")));
  } finally {
    releaseRuntimeLifecycleLock({ root: f.root, owner });
  }
});

test("current distributions cover Linux libc variants, Apple Silicon and Windows without host fallbacks", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "project-tool-platform-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const matrix = readToolchainConfiguration();
  for (const [platform, arch, libc, miseTarget, triple] of [
    ["linux", "x64", "glibc", "linux-x64", "x86_64-unknown-linux-musl"],
    ["linux", "arm64", "glibc", "linux-arm64", "aarch64-unknown-linux-musl"],
    ["linux", "x64", "musl", "linux-x64-musl", "x86_64-unknown-linux-musl"],
    ["linux", "arm64", "musl", "linux-arm64-musl", "aarch64-unknown-linux-musl"],
    ["darwin", "arm64", null, "macos-arm64", "aarch64-apple-darwin"],
    ["win32", "x64", null, "windows-x64", "x86_64-pc-windows-msvc"],
  ]) {
    const layout = projectManagedToolLayout(root, matrix, { platform, arch, libc });
    assert.equal(layout.mise.integrity, `sha256-${matrix.ci.miseBinarySha256[miseTarget]}`);
    assert.equal(
      layout.codex.integrity,
      matrix.ci.codexNpmPlatformIntegrities[`${platform}-${arch}`],
    );
    assert.ok(layout.codex.executable.includes(`${path.sep}${triple}${path.sep}`));
    assert.equal(layout.codex.executable.endsWith(".exe"), platform === "win32");
    assert.equal(path.relative(root, layout.mise.directory).startsWith(".auth"), true);
  }
  assert.throws(
    () => projectManagedToolLayout(root, matrix, { platform: "darwin", arch: "x64" }),
    /No reviewed/u,
  );
});
