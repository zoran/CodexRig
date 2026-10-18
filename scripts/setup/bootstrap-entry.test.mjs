/** Verifies portable host-entry isolation before wrapper or initial-maintenance execution. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const toolingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fixture(t) {
  const host = mkdtempSync(path.join(os.tmpdir(), "bootstrap-entry-"));
  t.after(() => rmSync(host, { recursive: true, force: true }));
  return host;
}

test("project wrapper blocks shell startup controls before its usage-only command boundary", (t) => {
  const host = fixture(t);
  const sentinel = path.join(host, "shell-startup-sentinel");
  const preload = path.join(host, "shell-preload");
  writeFileSync(preload, 'printf "preload\\n" >> "$BOOTSTRAP_SENTINEL"\n');
  const scripts = JSON.parse(readFileSync(path.join(toolingRoot, "package.json"), "utf8")).scripts;
  const invocation = scripts["project:run"].split(/\s+/u);
  assert.deepEqual(invocation, ["bash", "-p", "scripts/setup/run-project.sh"]);
  const attacks = [
    ["BASH_ENV", { BASH_ENV: preload }, true],
    [
      "exported unset function",
      {
        "BASH_FUNC_unset%%":
          '() { printf "function\\n" >> "$BOOTSTRAP_SENTINEL"; builtin unset "$@"; }',
      },
      true,
    ],
    ["SHELLOPTS", { SHELLOPTS: "xtrace" }, false],
    ["ENV alone", { ENV: preload }, false],
  ];
  for (const [name, inherited, writesSentinel] of attacks) {
    for (const privileged of [false, true]) {
      rmSync(sentinel, { force: true });
      const args = privileged ? invocation.slice(1) : invocation.slice(2);
      const result = spawnSync(invocation[0], args, {
        cwd: toolingRoot,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          PATH: `${path.dirname(process.execPath)}${path.delimiter}/usr/bin:/bin`,
          HOME: host,
          TMPDIR: os.tmpdir(),
          BOOTSTRAP_SENTINEL: sentinel,
          ...inherited,
        },
      });
      const label = `${name}, privileged=${privileged}`;
      assert.equal(result.status, 64, `${label}: ${result.stderr}`);
      assert.match(result.stderr, /Usage: node scripts\/setup\/project-command\.mjs/u, label);
      assert.equal(existsSync(sentinel), !privileged && writesSentinel, label);
      assert.equal(
        /^\+ (?:set|unset) /mu.test(result.stderr),
        !privileged && name === "SHELLOPTS",
        label,
      );
    }
  }
});

// Initial installation cannot depend on Mise. Exercise the documented host entry before the
// real maintainer rejects an invalid argument; explicit fixture observers grant no ambient preload.
test("initial maintenance removes Node preloads and module lookup before the actual entry", (t) => {
  const host = fixture(t);
  const preloadSentinel = path.join(host, "node-preload-sentinel");
  const moduleSentinel = path.join(host, "node-path-sentinel");
  const observedPath = path.join(host, "observed-node-environment.json");
  const preload = path.join(host, "ambient-preload.cjs");
  const observer = path.join(host, "observer.cjs");
  const modules = path.join(host, "modules");
  mkdirSync(modules);
  writeFileSync(
    preload,
    'require("node:fs").writeFileSync(process.env.PRELOAD_SENTINEL, "ambient preload");\n',
  );
  writeFileSync(
    path.join(modules, "codexrig-bootstrap-audit-only.cjs"),
    'require("node:fs").writeFileSync(process.env.MODULE_SENTINEL, "ambient resolution");\n',
  );
  writeFileSync(
    observer,
    `let resolved = false;
try { require("codexrig-bootstrap-audit-only.cjs"); resolved = true; }
catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
require("node:fs").writeFileSync(process.env.OBSERVED_ENV, JSON.stringify({
  options: process.env.NODE_OPTIONS ?? null, modulePath: process.env.NODE_PATH ?? null, resolved,
}));\n`,
  );
  const command = readFileSync(path.join(toolingRoot, "README.md"), "utf8")
    .split("\n")
    .find((line) => /^(?:env .* )?node scripts\/deps\/maintain-toolchain\.mjs$/u.test(line));
  assert.ok(command, "README must expose the initial maintenance command");
  const documented = command.split(/\s+/u);
  for (const [isolated, invocation] of [
    [false, ["node", "scripts/deps/maintain-toolchain.mjs"]],
    [true, [...documented]],
  ]) {
    for (const sentinel of [preloadSentinel, moduleSentinel, observedPath])
      rmSync(sentinel, { force: true });
    invocation.splice(invocation.indexOf("node") + 1, 0, "--require", observer);
    const result = spawnSync(invocation[0], [...invocation.slice(1), "--audit-invalid-argument"], {
      cwd: toolingRoot,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        PATH: `${path.dirname(process.execPath)}${path.delimiter}/usr/bin:/bin`,
        HOME: host,
        TMPDIR: os.tmpdir(),
        NODE_OPTIONS: `--require ${JSON.stringify(preload)}`,
        NODE_PATH: modules,
        PRELOAD_SENTINEL: preloadSentinel,
        MODULE_SENTINEL: moduleSentinel,
        OBSERVED_ENV: observedPath,
      },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Usage: node scripts\/deps\/maintain-toolchain\.mjs/u);
    assert.equal(existsSync(preloadSentinel), !isolated, "ambient Node preload must be excluded");
    assert.equal(existsSync(moduleSentinel), !isolated, "ambient module lookup must be excluded");
    const observed = JSON.parse(readFileSync(observedPath, "utf8"));
    assert.equal(observed.resolved, !isolated);
    assert.equal(observed.options, isolated ? null : `--require ${JSON.stringify(preload)}`);
    assert.equal(observed.modulePath, isolated ? null : modules);
  }
});
