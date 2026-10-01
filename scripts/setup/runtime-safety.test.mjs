/** Exercises retained project runtime trust boundaries in owned isolated fixtures. */
import assert from "node:assert/strict";
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
const roots = [];

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
    ])
      cpSync(path.join(toolingRoot, file), path.join(root, file));
    const layout = projectManagedToolLayout(root);
    const matrix = readToolchainConfiguration(root);
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
