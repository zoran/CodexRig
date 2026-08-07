import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import {
  portableCodexGitignorePatterns,
  portableCodexGitignoreProbePaths,
  repositoryCodexHomeGitignorePatterns,
  repositoryCodexHomeProtectedGitignoreProbePaths,
} from "../repository/source-inventory.mjs";
import {
  bashSingleQuotedArray,
  cleanupTemporaryRoots,
  root,
  run,
  temporaryRoot,
  validPortableConfig,
  writeProjectAgents,
  writeProjectHookFiles,
} from "./setup-regression-fixtures.mjs";

after(cleanupTemporaryRoots);

test("Codex launcher refreshes the CLI and compatible dependencies before isolated startup", () => {
  const fixture = temporaryRoot("codex launcher with spaces ");
  const setupDirectory = path.join(fixture, "scripts", "setup");
  const dependencyDirectory = path.join(fixture, "scripts", "deps");
  const frameworkDirectory = path.join(fixture, "scripts", "framework");
  const binDirectory = path.join(fixture, "bin");
  mkdirSync(setupDirectory, { recursive: true });
  mkdirSync(dependencyDirectory, { recursive: true });
  mkdirSync(frameworkDirectory, { recursive: true });
  mkdirSync(path.join(fixture, ".codex"), { recursive: true });
  writeFileSync(path.join(fixture, ".codex", "config.toml"), validPortableConfig, "utf8");
  writeProjectHookFiles(fixture);
  writeProjectAgents(fixture);
  mkdirSync(binDirectory);
  const launcher = path.join(setupDirectory, "start-codex.sh");
  copyFileSync(path.join(root, "scripts/setup/start-codex.sh"), launcher);
  copyFileSync(
    path.join(root, "scripts/setup/validate-codex-bootstrap.sh"),
    path.join(setupDirectory, "validate-codex-bootstrap.sh"),
  );
  copyFileSync(
    path.join(root, "scripts/setup/check-prereqs.sh"),
    path.join(setupDirectory, "check-prereqs.sh"),
  );
  copyFileSync(
    path.join(root, "scripts/deps/install-compatible.mjs"),
    path.join(dependencyDirectory, "install-compatible.mjs"),
  );
  copyFileSync(
    path.join(root, "scripts/framework/framework-doctor.mjs"),
    path.join(frameworkDirectory, "framework-doctor.mjs"),
  );
  for (const name of [
    "startup-attestation.mjs",
    "verify-startup-attestation-on-session-start.sh",
  ]) {
    copyFileSync(path.join(root, "scripts/setup", name), path.join(setupDirectory, name));
  }
  chmodSync(launcher, 0o755);

  const capturePath = path.join(fixture, "capture.txt");
  const miseCapturePath = path.join(fixture, "mise-capture.txt");
  const externalCodexHome = path.join(fixture, "external-home-must-not-be-used");
  const runtimeCodexHome = path.join(fixture, ".codex", "runtime");
  const syntheticSecret = "synthetic-launch-secret";
  const fakeCodex = path.join(binDirectory, "codex");
  writeFileSync(
    fakeCodex,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "{",
      "  printf 'CALL\\0'",
      "  printf '%s\\0' \"${CODEX_HOME:-<unset>}\"",
      "  printf '%s\\0' \"$@\"",
      "  printf 'END\\0'",
      '} >> "$CAPTURE_PATH"',
      'if [[ "${1-}" == "update" ]]; then',
      '  update_status="${FAKE_CODEX_UPDATE_STATUS:-0}"',
      '  if [[ "$update_status" != "0" ]]; then',
      "    printf 'synthetic update failure\\n' >&2",
      '    exit "$update_status"',
      "  fi",
      "  exit 0",
      "fi",
      'if [[ "${CODEXRIG_STARTUP_NONCE:-}" != "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" ]]; then',
      "  printf 'missing startup nonce\\n' >&2",
      "  exit 91",
      "fi",
      'case "${CODEXRIG_STARTUP_CONTROL_POLICY:-}" in',
      "  interactive-v1:none | interactive-v1:no-alt-screen) ;;",
      "  *) printf 'missing startup control policy\\n' >&2; exit 92 ;;",
      "esac",
      'exit "${FAKE_CODEX_START_STATUS:-0}"',
    ].join("\n"),
    "utf8",
  );
  chmodSync(fakeCodex, 0o755);

  const fakeMise = path.join(binDirectory, "mise");
  writeFileSync(
    fakeMise,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if [[ -n "${MISE_CAPTURE_PATH:-}" ]]; then',
      "  {",
      "    printf 'CALL\\0'",
      "    printf '%s\\0' \"${CODEX_HOME:-<unset>}\"",
      "    printf '%s\\0' \"$PWD\"",
      "    printf '%s\\0' \"$@\"",
      "    printf 'END\\0'",
      '  } >> "$MISE_CAPTURE_PATH"',
      "fi",
      'if [[ "${FAKE_MISE_FAIL_COMMAND:-}" == "$*" ]]; then',
      '  exit "${FAKE_MISE_STATUS:-1}"',
      "fi",
      'if [[ "$*" == "exec --locked -- node scripts/setup/startup-attestation.mjs issue --session-pid "* ]]; then',
      "  printf '%s\\n' 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'",
      "fi",
      "exit 0",
    ].join("\n"),
    "utf8",
  );
  chmodSync(fakeMise, 0o755);

  function capturedCalls() {
    const fields = readFileSync(capturePath, "utf8").split("\0");
    if (fields.at(-1) === "") fields.pop();
    const calls = [];
    for (let index = 0; index < fields.length;) {
      assert.equal(fields[index], "CALL");
      const home = fields[index + 1];
      index += 2;
      const args = [];
      while (fields[index] !== "END") args.push(fields[index++]);
      index += 1;
      calls.push({ home, args });
    }
    return calls;
  }

  function capturedMiseCalls() {
    const fields = readFileSync(miseCapturePath, "utf8").split("\0");
    if (fields.at(-1) === "") fields.pop();
    const calls = [];
    for (let index = 0; index < fields.length;) {
      assert.equal(fields[index], "CALL");
      const home = fields[index + 1];
      const cwd = fields[index + 2];
      index += 3;
      const args = [];
      while (fields[index] !== "END") args.push(fields[index++]);
      index += 1;
      calls.push({ home, cwd, args });
    }
    return calls;
  }

  const bootstrapSource = readFileSync(
    path.join(setupDirectory, "validate-codex-bootstrap.sh"),
    "utf8",
  );
  // Keep the pre-runtime bootstrap validator Bash-3.2-compatible for the supported macOS host.
  for (const shellSource of [readFileSync(launcher, "utf8"), bootstrapSource]) {
    assert.doesNotMatch(shellSource, /declare\s+-A|\[\[\s+-v\b/);
  }
  assert.match(bootstrapSource, /contains_value\(\)/);
  assert.deepEqual(bashSingleQuotedArray(bootstrapSource, "required_codex_ignore_patterns"), [
    ...repositoryCodexHomeGitignorePatterns,
    ...portableCodexGitignorePatterns,
  ]);
  assert.deepEqual(
    bashSingleQuotedArray(bootstrapSource, "runtime_probe_paths"),
    repositoryCodexHomeProtectedGitignoreProbePaths,
  );
  assert.deepEqual(
    bashSingleQuotedArray(bootstrapSource, "portable_probe_paths"),
    portableCodexGitignoreProbePaths,
  );

  const result = run("bash", [launcher, "--no-alt-screen", "--", "--fixture"], {
    cwd: fixture,
    env: {
      CAPTURE_PATH: capturePath,
      CODEX_HOME: externalCodexHome,
      MISE_CAPTURE_PATH: miseCapturePath,
      PATH: `${binDirectory}:/usr/bin:/bin`,
      SYNTHETIC_LAUNCH_SECRET: syntheticSecret,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(capturedCalls(), [
    { home: "<unset>", args: ["update"] },
    {
      home: runtimeCodexHome,
      args: ["--cd", fixture, "--no-alt-screen", "--", "--fixture"],
    },
  ]);
  const successfulMiseCalls = capturedMiseCalls();
  assert.deepEqual(successfulMiseCalls.slice(0, 4), [
    { home: "<unset>", cwd: fixture, args: ["install", "--locked"] },
    {
      home: "<unset>",
      cwd: fixture,
      args: ["exec", "--locked", "--", "bash", "scripts/setup/check-prereqs.sh"],
    },
    {
      home: "<unset>",
      cwd: fixture,
      args: ["exec", "--locked", "--", "node", "scripts/deps/install-compatible.mjs"],
    },
    {
      home: "<unset>",
      cwd: fixture,
      args: [
        "exec",
        "--locked",
        "--",
        "node",
        "scripts/framework/framework-doctor.mjs",
        "--online",
      ],
    },
  ]);
  assert.equal(successfulMiseCalls.length, 5);
  assert.deepEqual(successfulMiseCalls[4].home, "<unset>");
  assert.deepEqual(successfulMiseCalls[4].cwd, fixture);
  assert.deepEqual(successfulMiseCalls[4].args.slice(0, -1), [
    "exec",
    "--locked",
    "--",
    "node",
    "scripts/setup/startup-attestation.mjs",
    "issue",
    "--session-pid",
  ]);
  assert.match(successfulMiseCalls[4].args.at(-1), /^[1-9]\d*$/u);
  assert.equal(`${result.stdout}${result.stderr}`.includes(fixture), false);
  assert.equal(`${result.stdout}${result.stderr}`.includes(syntheticSecret), false);

  rmSync(capturePath);
  const startFailure = run("bash", [launcher], {
    cwd: fixture,
    env: {
      CAPTURE_PATH: capturePath,
      FAKE_CODEX_START_STATUS: "37",
      PATH: `${binDirectory}:/usr/bin:/bin`,
    },
  });
  assert.equal(startFailure.status, 37);
  assert.equal(capturedCalls().length, 2);

  rmSync(capturePath);
  const updateFailure = run("bash", [launcher], {
    cwd: fixture,
    env: {
      CAPTURE_PATH: capturePath,
      FAKE_CODEX_UPDATE_STATUS: "73",
      PATH: `${binDirectory}:/usr/bin:/bin`,
      SYNTHETIC_LAUNCH_SECRET: syntheticSecret,
    },
  });
  assert.equal(updateFailure.status, 73);
  assert.match(updateFailure.stderr, /synthetic update failure/);
  assert.deepEqual(capturedCalls(), [{ home: "<unset>", args: ["update"] }]);
  assert.equal(`${updateFailure.stdout}${updateFailure.stderr}`.includes(fixture), false);
  assert.equal(`${updateFailure.stdout}${updateFailure.stderr}`.includes(syntheticSecret), false);

  rmSync(capturePath);
  rmSync(miseCapturePath);
  const dependencyFailure = run("bash", [launcher], {
    cwd: fixture,
    env: {
      CAPTURE_PATH: capturePath,
      FAKE_MISE_FAIL_COMMAND: "exec --locked -- node scripts/deps/install-compatible.mjs",
      FAKE_MISE_STATUS: "74",
      MISE_CAPTURE_PATH: miseCapturePath,
      PATH: `${binDirectory}:/usr/bin:/bin`,
    },
  });
  assert.equal(dependencyFailure.status, 74);
  assert.deepEqual(capturedCalls(), [{ home: "<unset>", args: ["update"] }]);
  assert.equal(capturedMiseCalls().length, 3);

  rmSync(capturePath);
  for (const override of [
    ["--cd", "/tmp/other-project"],
    ["--cd=/tmp/other-project"],
    ["-C", "/tmp/other-project"],
    ["-C/tmp/other-project"],
  ]) {
    const rejected = run("bash", [launcher, ...override], {
      cwd: fixture,
      env: { CAPTURE_PATH: capturePath, PATH: `${binDirectory}:/usr/bin:/bin` },
    });
    assert.equal(rejected.status, 64, `${override.join(" ")}\n${rejected.stderr}`);
    assert.match(rejected.stderr, /unsupported launcher control argument/);
    assert.equal(rejected.stderr.includes(override.at(-1)), false);
    assert.equal(existsSync(capturePath), false);
  }

  for (const override of [
    ["--add-dir", "/tmp/other-project"],
    ["--add-dir=/tmp/other-project"],
    ["-c", 'sandbox_mode="workspace-write"'],
    ['--config=approval_policy="on-request"'],
    ["-p", "unsafe-profile"],
    ["--sandbox", "workspace-write"],
    ["-a", "on-request"],
    ["--dangerously-bypass-approvals-and-sandbox"],
    ["--enable", "unreviewed-feature"],
    ["--disable=memories"],
    ["--model", "untracked-model"],
    ["-mcompact-model"],
    ["--search"],
    ["--remote", "wss://example.invalid"],
    ["--remote-auth-token-env=TOKEN"],
    ["--dangerously-bypass-hook-trust"],
    ["--oss"],
    ["--local-provider", "ollama"],
    ["--image", "/tmp/outside.png"],
    ["--yolo"],
    ["exec"],
    ["exec", "--ignore-user-config"],
    ["resume"],
    ["prompt text without delimiter"],
    ["--future-cli-option"],
    ["--no-alt-screen", "--no-alt-screen"],
  ]) {
    const rejected = run("bash", [launcher, ...override], {
      cwd: fixture,
      env: { CAPTURE_PATH: capturePath, PATH: `${binDirectory}:/usr/bin:/bin` },
    });
    assert.equal(rejected.status, 64, `${override.join(" ")}\n${rejected.stderr}`);
    assert.match(rejected.stderr, /(unsupported launcher control argument|duplicate launcher)/);
    assert.equal(existsSync(capturePath), false);
  }

  const promptNamedLikeAnOption = run("bash", [launcher, "--", "--cd", "prompt text"], {
    cwd: fixture,
    env: {
      CAPTURE_PATH: capturePath,
      CODEX_HOME: externalCodexHome,
      PATH: `${binDirectory}:/usr/bin:/bin`,
    },
  });
  assert.equal(promptNamedLikeAnOption.status, 0, promptNamedLikeAnOption.stderr);
  assert.deepEqual(capturedCalls(), [
    { home: "<unset>", args: ["update"] },
    {
      home: runtimeCodexHome,
      args: ["--cd", fixture, "--", "--cd", "prompt text"],
    },
  ]);

  rmSync(capturePath, { force: true });
  const configPath = path.join(fixture, ".codex", "config.toml");
  writeFileSync(
    configPath,
    `${validPortableConfig}\n[mcp_servers.fixture]\ncommand = "/bin/false"\n`,
    "utf8",
  );
  const executableConfig = run("bash", [launcher], {
    cwd: fixture,
    env: { CAPTURE_PATH: capturePath, PATH: `${binDirectory}:/usr/bin:/bin` },
  });
  assert.notEqual(executableConfig.status, 0);
  assert.match(executableConfig.stderr, /unsupported table/i);
  assert.equal(existsSync(capturePath), false);

  writeFileSync(configPath, validPortableConfig.replace("hooks = true", "hooks = false"), "utf8");
  const disabledHooks = run("bash", [launcher], {
    cwd: fixture,
    env: { CAPTURE_PATH: capturePath, PATH: `${binDirectory}:/usr/bin:/bin` },
  });
  assert.notEqual(disabledHooks.status, 0);
  assert.match(disabledHooks.stderr, /enable lifecycle hooks/i);
  assert.equal(existsSync(capturePath), false);

  writeFileSync(configPath, validPortableConfig, "utf8");
  const hooksPath = path.join(fixture, ".codex", "hooks.json");
  const validHooks = readFileSync(hooksPath, "utf8");
  for (const invalidHooks of [
    "{}\n",
    validHooks.replace('"Stop": [', '"Start": [],\n    "Stop": ['),
    validHooks.replace(
      '"hooks": [\n          {',
      '"hooks": [\n          {\n            "type": "command",\n            "command": "false"\n          },\n          {',
    ),
  ]) {
    writeFileSync(hooksPath, invalidHooks, "utf8");
    const rejectedHooks = run("bash", [launcher], {
      cwd: fixture,
      env: { CAPTURE_PATH: capturePath, PATH: `${binDirectory}:/usr/bin:/bin` },
    });
    assert.notEqual(rejectedHooks.status, 0);
    assert.match(rejectedHooks.stderr, /exactly the supported SessionStart and Stop hooks/i);
    assert.equal(existsSync(capturePath), false);
  }
  writeFileSync(hooksPath, validHooks, "utf8");

  const gitignorePath = path.join(fixture, ".gitignore");
  const validGitignore = readFileSync(gitignorePath, "utf8");
  writeFileSync(gitignorePath, validGitignore.replace("/auth.json\n", ""), "utf8");
  const unsafeIgnore = run("bash", [launcher], {
    cwd: fixture,
    env: { CAPTURE_PATH: capturePath, PATH: `${binDirectory}:/usr/bin:/bin` },
  });
  assert.notEqual(unsafeIgnore.status, 0);
  assert.match(unsafeIgnore.stderr, /runtime ignore policy is incomplete/i);
  assert.equal(existsSync(capturePath), false);
  writeFileSync(gitignorePath, validGitignore, "utf8");

  for (const [override, expected] of [
    ["!/auth.json", /runtime ignore policy is ineffective/i],
    ["/.codex/config.toml", /portable project Codex configuration is unexpectedly ignored/i],
    ["!.codex/agents/extra.json", /runtime ignore policy is ineffective/i],
  ]) {
    writeFileSync(gitignorePath, `${validGitignore}\n${override}\n`, "utf8");
    const overriddenIgnore = run("bash", [launcher], {
      cwd: fixture,
      env: { CAPTURE_PATH: capturePath, PATH: `${binDirectory}:/usr/bin:/bin` },
    });
    assert.notEqual(overriddenIgnore.status, 0, override);
    assert.match(overriddenIgnore.stderr, expected);
    assert.equal(existsSync(capturePath), false);
  }
  writeFileSync(gitignorePath, validGitignore, "utf8");

  const outside = path.join(fixture, "outside-config.toml");
  writeFileSync(outside, validPortableConfig, "utf8");
  rmSync(configPath);
  symlinkSync(outside, configPath);
  const unsafe = run("bash", [launcher], {
    cwd: fixture,
    env: { CAPTURE_PATH: capturePath, PATH: `${binDirectory}:/usr/bin:/bin` },
  });
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /real file/i);
  assert.equal(existsSync(capturePath), false);
});
