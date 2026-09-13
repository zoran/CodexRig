/** Exercises retained project runtime trust boundaries in owned isolated fixtures. */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createHash } from "node:crypto";
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
import { verifyMiseArchive, verifyCodexArchives } from "../deps/toolchain-archives.mjs";
import { evaluateAutonomousContinuation } from "../context/session-stop-lifecycle.mjs";
const roots = [];
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

test("reviewed installer archives reject corrupt bytes, symlinks and incomplete pairs", () => {
  const root = fixture();
  const archive = path.join(root, "reviewed.tgz");
  const bytes = Buffer.from("reviewed isolated archive bytes");
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  writeFileSync(archive, bytes);
  assert.equal(verifyMiseArchive(root, integrity), archive);
  writeFileSync(archive, "corrupt");
  assert.throws(() => verifyMiseArchive(root, integrity), /integrity/iu);
  assert.throws(() => verifyCodexArchives(root, integrity, integrity), /exactly two/iu);
  rmSync(archive);
  symlinkSync(path.join(toolingRoot, "NOTICE"), archive);
  assert.throws(() => verifyMiseArchive(root, integrity), /regular/iu);
});

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
