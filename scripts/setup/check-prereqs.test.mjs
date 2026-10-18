/** Verifies Linux lifecycle-test prerequisites through the shipped read-only setup checker. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { toolingRoot } from "../filesystem/repository-files.mjs";

function hostCommand(name) {
  const result = spawnSync("bash", ["-p", "-c", 'command -v "$1"', "prerequisite-fixture", name], {
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(result.status, 0, `Required fixture host command is unavailable: ${name}`);
  return result.stdout.trim();
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// Linux cancellation evidence needs ctypes before it can create/reap its owned process tree.
// Simulate only host-tool availability; execute the actual prerequisite checker and Python import.
test(
  "Linux prerequisites require Python with ctypes and preserve other checker modes",
  {
    skip: process.platform !== "linux",
  },
  (t) => {
    const project = mkdtempSync(path.join(os.tmpdir(), "check-prereqs with spaces "));
    t.after(() => rmSync(project, { recursive: true, force: true }));
    const bin = path.join(project, "bin");
    const setup = path.join(project, "scripts/setup");
    mkdirSync(bin);
    mkdirSync(setup, { recursive: true });
    mkdirSync(path.join(project, ".codex"));
    const checker = path.join(setup, "check-prereqs.sh");
    copyFileSync(path.join(toolingRoot, "scripts/setup/check-prereqs.sh"), checker);
    writeFileSync(
      path.join(project, ".codex/toolchain.json"),
      JSON.stringify({
        stable: { node: { version: process.versions.node }, pnpm: { version: "11.0.0" } },
      }),
    );
    const bash = hostCommand("bash");
    for (const name of ["bash", "dirname", "cat"])
      symlinkSync(hostCommand(name), path.join(bin, name));
    function tool(name, body) {
      writeFileSync(path.join(bin, name), `#!${bash}\nset -eu\n${body}\n`, { mode: 0o755 });
    }
    for (const name of ["git", "rg", "shellcheck", "tar", "mise"]) tool(name, "exit 0");
    tool("pnpm", 'printf "%s\\n" "${PREREQ_PNPM_VERSION:-11.0.0}"');
    tool(
      "node",
      [
        'if [[ "${1:-}" == -p && "${2:-}" == process.platform ]]; then',
        '  printf "%s\\n" "$PREREQ_PLATFORM"',
        "else",
        `  exec ${shellQuote(process.execPath)} "$@"`,
        "fi",
      ].join("\n"),
    );
    function check(args = [], environment = {}) {
      const env = { ...process.env, PATH: bin, PREREQ_PLATFORM: "linux", ...environment };
      delete env.NODE_OPTIONS;
      delete env.NODE_PATH;
      return spawnSync(bash, ["-p", checker, ...args], {
        cwd: project,
        env,
        encoding: "utf8",
        timeout: 5_000,
      });
    }
    const missing = check();
    assert.equal(missing.status, 1, "Missing Python must fail before mandatory lifecycle evidence");
    assert.match(missing.stderr, /python3.*ctypes/u);
    assert.doesNotMatch(missing.stderr, /Runtime issues/u);
    for (const platform of ["darwin", "win32"]) {
      assert.equal(check([], { PREREQ_PLATFORM: platform }).status, 0);
    }
    assert.equal(check(["--help"]).status, 0);
    assert.equal(check(["--unknown"]).status, 2);
    tool("python3", '[[ "$*" != *ctypes* ]] || exit 1\nprintf "Python 3.12.0\\n"');
    const broken = check();
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /python3.*ctypes/u);
    rmSync(path.join(bin, "python3"));
    symlinkSync(hostCommand("python3"), path.join(bin, "python3"));
    const available = check();
    assert.equal(available.status, 0, available.stderr);
    assert.match(available.stdout, /Prerequisite check passed/u);
    const codexMissing = check(["--codex"]);
    assert.equal(codexMissing.status, 1);
    assert.match(codexMissing.stderr, /codex \(verified user installation\)/u);
    tool("codex", "exit 0");
    assert.equal(check(["--codex"]).status, 0);
    const mismatch = check([], { PREREQ_PNPM_VERSION: "0.0.0" });
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /Runtime issues:[\s\S]*pnpm@11\.0\.0/u);
  },
);
