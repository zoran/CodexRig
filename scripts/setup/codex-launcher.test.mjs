/** Verifies update-before-admission and the native-picker launcher's closed shell boundary. */
import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { cleanupTemporaryRoots, root, run, temporaryRoot } from "./setup-regression-fixtures.mjs";

after(cleanupTemporaryRoots);

test("launcher updates first, fails closed, and admits only native picker controls", () => {
  const project = temporaryRoot("codex launcher with spaces ");
  const bin = path.join(project, "bin");
  const setup = path.join(project, "scripts/setup");
  mkdirSync(bin);
  mkdirSync(setup, { recursive: true });
  const launcher = path.join(setup, "start-codex.sh");
  copyFileSync(path.join(root, "scripts/setup/start-codex.sh"), launcher);
  const capture = path.join(project, "calls");
  const ambientHome = path.join(project, "caller-home");
  const sanitizedKeys = [
    "NODE_OPTIONS",
    "NODE_PATH",
    "NPM_CONFIG_NODE_OPTIONS",
    "npm_config_node_options",
    "PNPM_CONFIG_NODE_OPTIONS",
    "pnpm_config_node_options",
    "NPM_CONFIG_SCRIPT_SHELL",
    "npm_config_script_shell",
    "PNPM_CONFIG_SCRIPT_SHELL",
    "pnpm_config_script_shell",
    "CODEXRIG_LAUNCHER_PID",
    "CODEXRIG_SESSION_CONTROL_NODE",
    "CODEXRIG_SESSION_CONTROL_PORT",
    "CODEXRIG_SESSION_CONTROL_TOKEN",
    "CODEXRIG_STARTUP_NONCE",
    "CODEXRIG_STARTUP_RESUME_SESSION_ID",
    "CODEXRIG_STARTUP_SESSION_SOURCE",
  ];
  const captureShell = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `for variable in ${sanitizedKeys.join(" ")}; do`,
    '  [[ -z "${!variable:-}" ]] || exit 85',
    "done",
    '[[ "${NPM_CONFIG_IGNORE_PNPMFILE:-}" == true && "${PNPM_CONFIG_IGNORE_PNPMFILE:-}" == true ]] || exit 86',
    '[[ "${npm_config_ignore_pnpmfile:-}" == true && "${pnpm_config_ignore_pnpmfile:-}" == true ]] || exit 87',
    '{ printf "CALL\\0"; printf "%s\\0" "${0##*/}" "${CODEX_HOME:-<unset>}" "$PWD" "$@"; printf "END\\0"; } >> "$CAPTURE_PATH"',
  ];
  const codex = path.join(bin, "codex");
  writeFileSync(
    codex,
    [
      ...captureShell,
      '[[ "$#" == 1 && "$1" == update ]] || exit 88',
      'exit "${FAKE_UPDATE_STATUS:-0}"',
      "",
    ].join("\n"),
  );
  chmodSync(codex, 0o755);
  const mise = path.join(bin, "mise");
  writeFileSync(
    mise,
    [
      ...captureShell,
      'if [[ "${FAKE_FAIL_COMMAND:-}" == "$*" ]]; then exit 74; fi',
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(mise, 0o755);

  function calls() {
    if (!existsSync(capture)) return [];
    const fields = readFileSync(capture, "utf8").split("\0").slice(0, -1);
    const result = [];
    for (let i = 0; i < fields.length;) {
      assert.equal(fields[i++], "CALL");
      const executable = fields[i++];
      const home = fields[i++];
      const cwd = fields[i++];
      const args = [];
      while (fields[i] !== "END") args.push(fields[i++]);
      i += 1;
      result.push({ executable, home, cwd, args });
    }
    return result;
  }
  function invoke(args = [], extra = {}) {
    writeFileSync(capture, "");
    return run("bash", [launcher, ...args], {
      cwd: project,
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        CAPTURE_PATH: capture,
        CODEX_HOME: ambientHome,
        ...Object.fromEntries(sanitizedKeys.map((key) => [key, "synthetic-stale-control"])),
        ...extra,
      },
    });
  }
  // The shell boundary remains Bash-3.2-compatible on supported macOS hosts.
  assert.doesNotMatch(readFileSync(launcher, "utf8"), /declare\s+-A|\[\[\s+-v\b/u);
  for (const [args, policy] of [
    [[], "interactive-v2:safe-defaults"],
    [["--no-alt-screen"], "interactive-v2:no-alt-screen"],
    [["--yolo"], "dev-yolo-v1:default-screen"],
    [["--yolo", "--no-alt-screen"], "dev-yolo-v1:no-alt-screen"],
  ]) {
    const result = invoke(args);
    assert.equal(result.status, 0, result.stderr);
    const observed = calls();
    assert.deepEqual(observed[0], {
      executable: "codex",
      home: ambientHome,
      cwd: project,
      args: ["update"],
    });
    assert.deepEqual(
      observed.slice(1).map((call) => call.args.slice(3)),
      [
        ["node", "scripts/deps/verify-pnpm-execution-policy.mjs"],
        ["bash", "scripts/setup/check-prereqs.sh", "--codex"],
        ["node", "scripts/setup/validate-codex-model-policy.mjs"],
        ["node", "scripts/verify/licensing.mjs"],
        ["node", "scripts/framework/framework-doctor.mjs"],
        [
          "node",
          "scripts/setup/startup-session-controller.mjs",
          "--control-policy",
          policy,
          "--codex-executable",
          codex,
        ],
      ],
    );
    for (const call of observed.slice(1)) {
      assert.equal(call.cwd, project);
      assert.deepEqual(call.args.slice(0, 3), ["exec", "--locked", "--"]);
      assert.equal(
        call.home,
        call.args.includes("scripts/setup/validate-codex-model-policy.mjs") ? project : "<unset>",
      );
    }
  }
  const updateFailure = invoke([], { FAKE_UPDATE_STATUS: "37" });
  assert.equal(updateFailure.status, 37);
  assert.equal(calls().length, 1);

  for (const command of [
    "node scripts/deps/verify-pnpm-execution-policy.mjs",
    "bash scripts/setup/check-prereqs.sh --codex",
    "node scripts/setup/validate-codex-model-policy.mjs",
    "node scripts/verify/licensing.mjs",
    "node scripts/framework/framework-doctor.mjs",
  ]) {
    const failure = invoke([], { FAKE_FAIL_COMMAND: `exec --locked -- ${command}` });
    assert.equal(failure.status, 74);
    assert.equal(
      calls().some((call) => call.args.includes("scripts/setup/startup-session-controller.mjs")),
      false,
    );
  }

  for (const args of [
    ["--cd", "/tmp/another-project"],
    ["--cd=/tmp/another-project"],
    ["-C/tmp/another-project"],
    ["--add-dir", "/tmp/another-project"],
    ["-c", 'sandbox_mode="danger-full-access"'],
    ["--config=approval_policy=never"],
    ["--sandbox", "danger-full-access"],
    ["-a", "never"],
    ["-p", "profile"],
    ["--model", "untracked-model"],
    ["--enable", "unreviewed"],
    ["--disable=hooks"],
    ["--search"],
    ["--dangerously-bypass-approvals-and-sandbox"],
    ["--dangerously-bypass-hook-trust"],
    ["--remote", "wss://example.invalid"],
    ["--remote-auth-token-env=TOKEN"],
    ["--oss"],
    ["--local-provider", "ollama"],
    ["--image", "/tmp/outside.png"],
    ["exec"],
    ["resume"],
    ["--last"],
    ["--"],
    ["--", "prompt"],
    ["prompt"],
    ["--future-cli-option"],
    ["--no-alt-screen", "--no-alt-screen"],
    ["--yolo", "--yolo"],
  ]) {
    const rejected = invoke(args);
    assert.equal(rejected.status, 64, rejected.stderr);
    assert.deepEqual(calls(), []);
  }
});
