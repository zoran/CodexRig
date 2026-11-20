/** Exercises retained project runtime trust boundaries in owned isolated fixtures. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import { validateCodexConfig, validateRuntimeCodexConfig } from "./validate-codex-config.mjs";
import { startupExecutableClosurePaths } from "./startup-executable-closure.mjs";
import { readToolchainConfiguration } from "../contracts/toolchain-configuration.mjs";
import { prepareProjectToolDirectories } from "../repository/project-tool-environment.mjs";
import {
  projectManagedToolLayout,
  sealProjectToolBundle,
  verifyProjectToolBundle,
} from "../repository/project-tool-executables.mjs";
import { evaluateAutonomousContinuation } from "../context/session-stop-lifecycle.mjs";
import { diagnoseTooling } from "./tooling-doctor.mjs";
import {
  canonicalRuntimeExecutable,
  startupExecutableSearchPath,
} from "./startup-runtime-executables.mjs";
const roots = [];
const installedMiseExecutable = projectManagedToolLayout(toolingRoot).mise.executable;
const inheritedStorage = process.env.PROJECT_TOOL_STORAGE_HOME;
afterEach(() => {
  if (inheritedStorage === undefined) delete process.env.PROJECT_TOOL_STORAGE_HOME;
  else process.env.PROJECT_TOOL_STORAGE_HOME = inheritedStorage;
});

// A permissive host umask must not make newly installed tools writable by another user.
// Exercise a real descendant: setting HOME or protecting only the storage root is insufficient.
test("project tool preparation contains inherited file permissions in descendant installers", (t) => {
  if (process.platform === "win32") return t.skip("POSIX creation permissions");
  for (const mask of [0o002, 0o027, 0o077]) {
    const root = mkdtempSync(path.join(os.tmpdir(), "project-tool-permissions-"));
    roots.push(root);
    const moduleUrl = new URL("../repository/project-tool-environment.mjs", import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { mkdirSync, writeFileSync, statSync } from 'node:fs';
      import { spawnSync } from 'node:child_process';
      import path from 'node:path';
      import { prepareProjectToolDirectories } from ${JSON.stringify(moduleUrl)};
      process.umask(${mask});
      const root = ${JSON.stringify(root)};
      const sentinel = path.join(root, 'existing');
      writeFileSync(sentinel, 'preserve');
      const before = statSync(sentinel).mode;
      const locations = prepareProjectToolDirectories(root);
      const child = spawnSync(process.execPath, ['-e', \`
        const fs = require('node:fs'), path = require('node:path');
        const directory = path.join(process.argv[1], 'installation');
        fs.mkdirSync(directory);
        fs.writeFileSync(path.join(directory, 'package'), 'package');
        fs.writeFileSync(path.join(directory, 'tool'), 'tool', {mode: 0o777});
        console.log(JSON.stringify([directory, path.join(directory, 'package'), path.join(directory, 'tool')].map(p => fs.statSync(p).mode & 0o777)));
      \`, locations.data], {encoding: 'utf8'});
      if (child.status !== 0) throw new Error(child.stderr);
      console.log(JSON.stringify({mask: process.umask(), modes: JSON.parse(child.stdout), preserved: before === statSync(sentinel).mode}));
    `,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    const observed = JSON.parse(result.stdout);
    assert.equal(observed.mask, mask | 0o022, "preserve stricter caller restrictions");
    assert.deepEqual(
      observed.modes,
      [0o777, 0o666, 0o777].map((mode) => mode & ~(mask | 0o022)),
    );
    assert.equal(observed.preserved, true, "existing files are never chmodded by preparation");
  }
});

function fixture() {
  const storage = mkdtempSync(path.join(os.tmpdir(), "runtime-tool-storage-"));
  roots.push(storage);
  process.env.PROJECT_TOOL_STORAGE_HOME = storage;
  const root = mkdtempSync(path.join(os.tmpdir(), "project-runtime-safety-"));
  roots.push(root);
  mkdirSync(path.join(root, ".codex"));
  for (const relativePath of [
    ".codex/config.toml",
    ".codex/hooks.json",
    ".codex/agents",
    ".gitignore",
    "scripts/context/session-stop-lifecycle.mjs",
    "scripts/setup/startup-attestation.mjs",
    "scripts/setup/session-control-hook-command.mjs",
    "scripts/setup/startup-session-controller.mjs",
  ])
    cpSync(path.join(toolingRoot, relativePath), path.join(root, relativePath), {
      recursive: true,
    });
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("native sidebar width survives startup validation without weakening runtime policy", () => {
  const root = fixture();
  const config = path.join(root, "config.toml");
  for (const width of [1, 36, 99]) {
    const content = `[tui]\nscreen_reader_detection_done = true\nsidebar_width_percent = ${width}\n`;
    writeFileSync(config, content, { mode: 0o600 });
    for (let launch = 0; launch < 2; launch += 1) {
      assert.equal(validateRuntimeCodexConfig(root).status, "present");
      assert.equal(readFileSync(config, "utf8"), content, "preserve the saved preference");
    }
  }
  for (const invalid of ["0", "100", "255", '"36"', "true", "[]"]) {
    writeFileSync(config, `[tui]\nsidebar_width_percent = ${invalid}\n`);
    assert.throws(() => validateRuntimeCodexConfig(root), /terminal preference is unsupported/u);
  }
  for (const invalid of ["-1", "36.5", "{ columns = 36 }"]) {
    writeFileSync(config, `[tui]\nsidebar_width_percent = ${invalid}\n`);
    assert.throws(() => validateRuntimeCodexConfig(root), /must contain valid TOML/u);
  }
  for (const unsafe of [
    '[tui]\nsidebar_width_percent = 36\ncommand = "run-project-code"\n',
    '[tui.sidebar_width_percent]\ncommand = "run-project-code"\n',
    'notify = ["sh", "-c", "run-project-code"]\n[tui]\nsidebar_width_percent = 36\n',
  ]) {
    writeFileSync(config, unsafe);
    assert.throws(() => validateRuntimeCodexConfig(root), /unsupported/u);
  }
  const tracked = path.join(root, ".codex/config.toml");
  writeFileSync(
    tracked,
    readFileSync(tracked, "utf8").replace("[tui]", "[tui]\nsidebar_width_percent = 36"),
  );
  assert.throws(() => validateCodexConfig(root), /unknown key tui\.sidebar_width_percent/u);
});

test("native voice preferences cannot introduce execution or transport configuration", () => {
  const root = fixture();
  const config = path.join(root, "config.toml");
  writeFileSync(config, '[realtime]\nvoice = "marin"\n', { mode: 0o600 });
  assert.equal(validateRuntimeCodexConfig(root).status, "present");
  for (const invalid of [
    "false",
    '["marin"]',
    '""',
    '"https://example.invalid"',
    '"voice;command"',
  ]) {
    writeFileSync(config, `[realtime]\nvoice = ${invalid}\n`);
    assert.throws(() => validateRuntimeCodexConfig(root), /voice preference is invalid/u);
  }
  for (const entry of [
    'command = "run-project-code"',
    'transport = "websocket"',
    'api_key = "fixture-unused"',
    'voice = { command = "run-project-code" }',
  ]) {
    writeFileSync(config, `[realtime]\n${entry}\n`);
    assert.throws(() => validateRuntimeCodexConfig(root));
  }
});

test("project roles and ignored runtime config reject broadened execution", () => {
  const root = fixture();
  assert.doesNotThrow(() => validateCodexConfig(root));
  const role = path.join(root, ".codex/agents/explorer.toml");
  const original = readFileSync(role, "utf8");
  writeFileSync(
    role,
    original.replace('sandbox_mode = "read-only"', 'sandbox_mode = "danger-full-access"'),
  );
  assert.throws(() => validateCodexConfig(root));
  writeFileSync(role, original);
  writeFileSync(path.join(root, "config.toml"), 'notify = ["sh", "-c", "exit 0"]\n');
  assert.throws(() => validateRuntimeCodexConfig(root));
});

test("startup closure requires contained regular modules and every actual import", () => {
  const root = fixture();
  assert.throws(() => startupExecutableClosurePaths(root), /missing|required|Missing/iu);
  const scripts = path.join(root, "scripts");
  rmSync(scripts, { recursive: true });
  mkdirSync(scripts);
  symlinkSync(path.join(toolingRoot, "scripts/setup"), path.join(scripts, "setup"), "dir");
  assert.throws(() => startupExecutableClosurePaths(root));
});

test("installed native bundles reject changed bytes and linked executable replacements", () => {
  const root = fixture();
  prepareProjectToolDirectories(root);
  const tool = projectManagedToolLayout(root, readToolchainConfiguration()).mise;
  mkdirSync(path.dirname(tool.executable), { recursive: true, mode: 0o700 });
  writeFileSync(tool.executable, "reviewed executable fixture", { mode: 0o755 });
  sealProjectToolBundle(root, tool.directory, tool);
  assert.equal(verifyProjectToolBundle(root, tool), tool.executable);
  writeFileSync(tool.executable, "substituted executable fixture");
  assert.throws(() => verifyProjectToolBundle(root, tool));
  rmSync(tool.executable);
  symlinkSync(path.join(toolingRoot, "NOTICE"), tool.executable);
  assert.throws(() => verifyProjectToolBundle(root, tool));
});

test(
  "tooling diagnosis ignores product PATH shadows and requires its own native installation",
  { skip: process.platform === "win32" },
  async () => {
    const root = fixture();
    prepareProjectToolDirectories(root);
    for (const file of [
      ".codex/tooling.json",
      ".codex/toolchain.json",
      "package.json",
      ".codex/mise.toml",
      ".codex/mise.lock",
    ])
      cpSync(path.join(toolingRoot, file), path.join(root, file));
    const matrix = readToolchainConfiguration(root);
    const launcher = `#!/bin/sh\nexec '${installedMiseExecutable.replaceAll("'", "'\\''")}' "$@"\n`;
    const initial = projectManagedToolLayout(root);
    matrix.ci.miseBinarySha256[path.basename(initial.mise.directory)] = createHash("sha256")
      .update(launcher)
      .digest("hex");
    writeFileSync(path.join(root, ".codex/toolchain.json"), JSON.stringify(matrix));
    cpSync(path.join(toolingRoot, ".codex/.mise"), path.join(root, ".codex/.mise"), {
      recursive: true,
    });
    const layout = projectManagedToolLayout(root);
    mkdirSync(path.dirname(layout.mise.executable), { recursive: true });
    writeFileSync(layout.mise.executable, launcher, { mode: 0o755 });
    sealProjectToolBundle(root, layout.mise.directory, layout.mise);
    for (const [executable, version] of [
      [layout.codex.executable, matrix.ci.codexVersion],
      [layout.pnpm.executable, matrix.stable.pnpm.version],
    ]) {
      mkdirSync(path.dirname(executable), { recursive: true });
      writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`, { mode: 0o755 });
    }
    sealProjectToolBundle(root, layout.codex.directory, layout.codex);
    const shadow = path.join(root, "node_modules/.bin");
    mkdirSync(shadow, { recursive: true });
    for (const name of ["codex", "pnpm"])
      writeFileSync(path.join(shadow, name), "#!/bin/sh\nprintf '0.1.0\\n'\n", { mode: 0o755 });
    const environment = { ...process.env, PATH: `${shadow}${path.delimiter}${process.env.PATH}` };
    const result = await diagnoseTooling({ root, environment });
    assert.equal(result.versions.codex, matrix.ci.codexVersion);
    assert.equal(result.versions.pnpm, matrix.stable.pnpm.version);
    rmSync(layout.codex.executable);
    const missing = await diagnoseTooling({ root, environment });
    assert.equal(missing.versions.codex, "");
    assert.ok(missing.errors.some(({ code }) => code === "tool.Codex.missing"));
  },
);

test("invalid work state is a diagnostic and cannot manufacture a continuation task", () => {
  const root = fixture();
  mkdirSync(path.join(root, "docs"));
  writeFileSync(
    path.join(root, "docs/project-context.md"),
    '# Project Context\n\n<!-- codexrig-work-state: {"version":999} -->\n',
  );
  const input = {
    hook_event_name: "Stop",
    session_id: "runtime-safety",
    stop_hook_active: false,
    transcript_path: "/unused-transcript",
  };
  const output = evaluateAutonomousContinuation({ root, hookInput: JSON.stringify(input) });
  assert.equal(output.decision, undefined);
  assert.match(output.systemMessage, /invalid|unsupported|missing/iu);
  assert.deepEqual(
    evaluateAutonomousContinuation({
      root,
      hookInput: JSON.stringify({ ...input, transcript_path: null }),
    }),
    {},
  );
});

test("startup excludes unadmitted shared tool directories and their external aliases", () => {
  const root = fixture();
  const storage = process.env.PROJECT_TOOL_STORAGE_HOME;
  const unselected = path.join(storage, "unselected");
  mkdirSync(unselected);
  const executable = path.join(unselected, "node");
  writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const external = path.dirname(process.execPath);
  const alias = path.join(storage, "external-alias");
  symlinkSync(external, alias, "dir");
  assert.equal(
    startupExecutableSearchPath(root, [unselected, alias, external].join(path.delimiter)),
    external,
  );
  assert.throws(() => canonicalRuntimeExecutable(root, executable, "Node"), /unadmitted|writable/u);
});
