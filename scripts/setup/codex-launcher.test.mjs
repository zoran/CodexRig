/** Verifies codex launcher behavior for the setup, launch, and portable project boundary. */
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
  cleanupTemporaryRoots,
  root,
  run,
  temporaryRoot,
  validPortableConfig,
  writeProjectAgents,
  writeProjectHookFiles,
} from "./setup-regression-fixtures.mjs";
import { sessionControlHookConfigArguments } from "./session-control-hook-command.mjs";

after(cleanupTemporaryRoots);

test("Codex launcher performs deterministic offline validation before isolated startup", () => {
  const projectIntelligenceArguments = [
    "-c",
    'model="gpt-5.6-sol"',
    "-c",
    'model_reasoning_effort="ultra"',
  ];
  const sessionControlArguments = [
    ...projectIntelligenceArguments,
    ...sessionControlHookConfigArguments(),
  ];
  const shellWords = sessionControlArguments
    .map((argument) => `'${argument.replaceAll("'", `'\\''`)}'`)
    .join(" ");
  const fixture = temporaryRoot("codex launcher with spaces ");
  const setupDirectory = path.join(fixture, "scripts", "setup");
  const dependencyDirectory = path.join(fixture, "scripts", "deps");
  const frameworkDirectory = path.join(fixture, "scripts", "framework");
  const contractDirectory = path.join(fixture, "scripts", "contracts");
  const filesystemDirectory = path.join(fixture, "scripts", "filesystem");
  const repositoryDirectory = path.join(fixture, "scripts", "repository");
  const securityDirectory = path.join(fixture, "scripts", "security");
  const terminalDirectory = path.join(fixture, "scripts", "terminal");
  const verifyDirectory = path.join(fixture, "scripts", "verify");
  const binDirectory = path.join(fixture, "bin");
  mkdirSync(setupDirectory, { recursive: true });
  mkdirSync(dependencyDirectory, { recursive: true });
  mkdirSync(frameworkDirectory, { recursive: true });
  mkdirSync(contractDirectory, { recursive: true });
  mkdirSync(filesystemDirectory, { recursive: true });
  mkdirSync(repositoryDirectory, { recursive: true });
  mkdirSync(securityDirectory, { recursive: true });
  mkdirSync(terminalDirectory, { recursive: true });
  mkdirSync(verifyDirectory, { recursive: true });
  mkdirSync(path.join(fixture, ".codex"), { recursive: true });
  writeFileSync(path.join(fixture, ".codex", "config.toml"), validPortableConfig, "utf8");
  writeProjectHookFiles(fixture);
  writeProjectAgents(fixture);
  mkdirSync(binDirectory);
  const launcher = path.join(setupDirectory, "start-codex.sh");
  copyFileSync(path.join(root, "scripts/setup/start-codex.sh"), launcher);
  copyFileSync(
    path.join(root, "scripts/setup/check-prereqs.sh"),
    path.join(setupDirectory, "check-prereqs.sh"),
  );
  copyFileSync(
    path.join(root, "scripts/deps/verify-pnpm-execution-policy.mjs"),
    path.join(dependencyDirectory, "verify-pnpm-execution-policy.mjs"),
  );
  copyFileSync(
    path.join(root, "scripts/verify/licensing.mjs"),
    path.join(verifyDirectory, "licensing.mjs"),
  );
  copyFileSync(
    path.join(root, "scripts/framework/framework-doctor.mjs"),
    path.join(frameworkDirectory, "framework-doctor.mjs"),
  );
  for (const name of [
    "session-control-hook-command.mjs",
    "startup-attestation.mjs",
    "startup-session-controller.mjs",
    "validate-codex-config.mjs",
    "validate-codex-model-policy.mjs",
  ]) {
    copyFileSync(path.join(root, "scripts/setup", name), path.join(setupDirectory, name));
  }
  copyFileSync(
    path.join(root, "scripts/contracts/portable-toml.mjs"),
    path.join(contractDirectory, "portable-toml.mjs"),
  );
  copyFileSync(
    path.join(root, "scripts/filesystem/owned-path-safety.mjs"),
    path.join(filesystemDirectory, "owned-path-safety.mjs"),
  );
  copyFileSync(
    path.join(root, "scripts/security/secret-patterns.mjs"),
    path.join(securityDirectory, "secret-patterns.mjs"),
  );
  copyFileSync(
    path.join(root, "scripts/terminal/terminal-output.mjs"),
    path.join(terminalDirectory, "terminal-output.mjs"),
  );
  for (const name of [
    "git-runtime-isolation.mjs",
    "runtime-process-io.mjs",
    "source-inventory-policy.mjs",
    "source-inventory.mjs",
  ]) {
    copyFileSync(path.join(root, "scripts/repository", name), path.join(repositoryDirectory, name));
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
      "for variable in NODE_OPTIONS NODE_PATH NPM_CONFIG_NODE_OPTIONS npm_config_node_options PNPM_CONFIG_NODE_OPTIONS pnpm_config_node_options NPM_CONFIG_SCRIPT_SHELL npm_config_script_shell PNPM_CONFIG_SCRIPT_SHELL pnpm_config_script_shell; do",
      '  [[ -z "${!variable:-}" ]] || exit 86',
      "done",
      '[[ "${NPM_CONFIG_IGNORE_PNPMFILE:-}" == "true" ]] || exit 87',
      '[[ "${PNPM_CONFIG_IGNORE_PNPMFILE:-}" == "true" ]] || exit 88',
      '[[ "${npm_config_ignore_pnpmfile:-}" == "true" ]] || exit 89',
      '[[ "${pnpm_config_ignore_pnpmfile:-}" == "true" ]] || exit 90',
      '[[ -z "${CODEXRIG_LAUNCHER_PID:-}" ]] || exit 104',
      'if [[ "$*" == "debug models --bundled" ]]; then',
      '  printf \'%s\\n\' \'{"models":[{"slug":"gpt-5.6-sol","visibility":"list","priority":1,"supported_reasoning_levels":[{"effort":"ultra"}]}]}\'',
      "  exit 0",
      "fi",
      "{",
      "  printf 'CALL\\0'",
      "  printf '%s\\0' \"${CODEX_HOME:-<unset>}\"",
      "  printf '%s\\0' \"$@\"",
      "  printf 'END\\0'",
      '} >> "$CAPTURE_PATH"',
      'if [[ "${CODEXRIG_STARTUP_NONCE:-}" != "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" ]]; then',
      "  printf 'missing startup nonce\\n' >&2",
      "  exit 91",
      "fi",
      "is_resume=false",
      'for argument in "$@"; do',
      '  if [[ "$argument" == "resume" ]]; then is_resume=true; fi',
      "done",
      'if [[ "$is_resume" == true ]]; then',
      '  [[ "${CODEXRIG_STARTUP_SESSION_SOURCE:-}" == "resume" ]] || exit 97',
      '  if [[ -n "${EXPECTED_RESUME_SESSION_ID:-}" ]]; then',
      '    [[ "${CODEXRIG_STARTUP_RESUME_SESSION_ID:-}" == "$EXPECTED_RESUME_SESSION_ID" ]] || exit 98',
      "  fi",
      "else",
      '  [[ "${CODEXRIG_STARTUP_SESSION_SOURCE:-}" == "startup" ]] || exit 99',
      '  [[ -z "${CODEXRIG_STARTUP_RESUME_SESSION_ID:-}" ]] || exit 100',
      "fi",
      'case "${CODEXRIG_STARTUP_CONTROL_POLICY:-}" in',
      "  interactive-v2:safe-defaults | interactive-v2:no-alt-screen | dev-yolo-v1:default-screen | dev-yolo-v1:no-alt-screen) ;;",
      "  *) printf 'missing startup control policy\\n' >&2; exit 92 ;;",
      "esac",
      'if [[ "$is_resume" == true ]]; then',
      '  exit "${FAKE_CODEX_RESUME_STATUS:-${FAKE_CODEX_START_STATUS:-0}}"',
      "fi",
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
      "for variable in NODE_OPTIONS NODE_PATH NPM_CONFIG_NODE_OPTIONS npm_config_node_options PNPM_CONFIG_NODE_OPTIONS pnpm_config_node_options NPM_CONFIG_SCRIPT_SHELL npm_config_script_shell PNPM_CONFIG_SCRIPT_SHELL pnpm_config_script_shell CODEXRIG_SESSION_CONTROL_NODE CODEXRIG_SESSION_CONTROL_PORT CODEXRIG_SESSION_CONTROL_TOKEN CODEXRIG_STARTUP_NONCE CODEXRIG_STARTUP_RESUME_SESSION_ID CODEXRIG_STARTUP_SESSION_SOURCE; do",
      '  [[ -z "${!variable:-}" ]] || exit 85',
      "done",
      '[[ "${NPM_CONFIG_IGNORE_PNPMFILE:-}" == "true" ]] || exit 93',
      '[[ "${PNPM_CONFIG_IGNORE_PNPMFILE:-}" == "true" ]] || exit 94',
      '[[ "${npm_config_ignore_pnpmfile:-}" == "true" ]] || exit 95',
      '[[ "${pnpm_config_ignore_pnpmfile:-}" == "true" ]] || exit 96',
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
      'if [[ "$1" == "exec" && "$2" == "--locked" && "$3" == "--" && "$4" == "node" && "$5" == "scripts/setup/startup-session-controller.mjs" ]]; then',
      "  shift 5",
      '  [[ "$1" == "--control-policy" && "$3" == "--codex-executable" && "$5" == "--prompt-present" && "$7" == "--" ]] || exit 105',
      '  control_policy="$2"',
      '  codex_executable="$4"',
      '  prompt_present="$6"',
      "  shift 7",
      '  codex_args=(--cd "$PWD")',
      '  case "$control_policy" in',
      "    interactive-v2:no-alt-screen) codex_args+=(--no-alt-screen) ;;",
      "    dev-yolo-v1:default-screen) codex_args+=(--dangerously-bypass-approvals-and-sandbox) ;;",
      "    dev-yolo-v1:no-alt-screen) codex_args+=(--no-alt-screen --dangerously-bypass-approvals-and-sandbox) ;;",
      "    interactive-v2:safe-defaults) ;;",
      "    *) exit 106 ;;",
      "  esac",
      `  codex_args+=(${shellWords})`,
      "  prompt_args=()",
      '  if [[ "$prompt_present" == "true" ]]; then prompt_args=(-- "$@"); elif [[ "$prompt_present" != "false" || "$#" != "0" ]]; then exit 107; fi',
      '  session_plan="${FAKE_STARTUP_SESSION_PLAN:-startup}"',
      '  session_source="startup"',
      '  resume_session_id=""',
      '  if [[ "$session_plan" == resume-id:* ]]; then',
      '    session_source="resume"',
      '    resume_session_id="${session_plan#resume-id:}"',
      '    if env CODEX_HOME="$PWD/.codex/runtime" CODEXRIG_PROJECT_ROOT="$PWD" CODEXRIG_STARTUP_CONTROL_POLICY="$control_policy" CODEXRIG_STARTUP_SESSION_SOURCE="$session_source" CODEXRIG_STARTUP_RESUME_SESSION_ID="$resume_session_id" CODEXRIG_STARTUP_NONCE=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "$codex_executable" "${codex_args[@]}" resume "$resume_session_id" "${prompt_args[@]}"; then',
      "      codex_status=0",
      "    else",
      "      codex_status=$?",
      "    fi",
      '    if [[ "$codex_status" -ge 128 || "${FAKE_STARTUP_LAUNCH_STATE:-active}" == "active" ]]; then exit "$codex_status"; fi',
      '    if [[ "$codex_status" == "0" ]]; then printf "Project resume exited without activating the trusted SessionStart hook; refusing automatic fresh fallback.\\n" >&2; exit 1; fi',
      '    session_source="startup"',
      '    resume_session_id=""',
      '  elif [[ "$session_plan" != "startup" ]]; then',
      "    exit 108",
      "  fi",
      '  exec env CODEX_HOME="$PWD/.codex/runtime" CODEXRIG_PROJECT_ROOT="$PWD" CODEXRIG_STARTUP_CONTROL_POLICY="$control_policy" CODEXRIG_STARTUP_SESSION_SOURCE="$session_source" CODEXRIG_STARTUP_RESUME_SESSION_ID="$resume_session_id" CODEXRIG_STARTUP_NONCE=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "$codex_executable" "${codex_args[@]}" "${prompt_args[@]}"',
      "fi",
      'case "$*" in',
      '  "exec --locked -- node scripts/setup/validate-codex-model-policy.mjs")',
      "    shift 3",
      '    exec "$@"',
      "    ;;",
      "esac",
      "exit 0",
    ].join("\n"),
    "utf8",
  );
  chmodSync(fakeMise, 0o755);

  function capturedDelimitedCalls(filePath, metadataKeys) {
    const fields = readFileSync(filePath, "utf8").split("\0");
    if (fields.at(-1) === "") fields.pop();
    const calls = [];
    for (let index = 0; index < fields.length;) {
      assert.equal(fields[index], "CALL");
      index += 1;
      const metadata = Object.fromEntries(metadataKeys.map((key) => [key, fields[index++]]));
      const args = [];
      while (fields[index] !== "END") args.push(fields[index++]);
      index += 1;
      calls.push({ ...metadata, args });
    }
    return calls;
  }
  const capturedCalls = () => capturedDelimitedCalls(capturePath, ["home"]);
  const capturedMiseCalls = () => capturedDelimitedCalls(miseCapturePath, ["home", "cwd"]);
  // Keep the launcher Bash-3.2-compatible for the supported macOS host.
  assert.doesNotMatch(readFileSync(launcher, "utf8"), /declare\s+-A|\[\[\s+-v\b/);

  const result = run("bash", [launcher, "--no-alt-screen", "--", "--fixture"], {
    cwd: fixture,
    env: {
      CAPTURE_PATH: capturePath,
      CODEX_HOME: externalCodexHome,
      CODEXRIG_LAUNCHER_PID: "999999",
      CODEXRIG_SESSION_CONTROL_NODE: "/synthetic/old-node",
      CODEXRIG_SESSION_CONTROL_PORT: "65535",
      CODEXRIG_SESSION_CONTROL_TOKEN: "old-session-control-token",
      CODEXRIG_STARTUP_CONTROL_POLICY: "old-control-policy",
      CODEXRIG_STARTUP_NONCE: "old-startup-nonce",
      CODEXRIG_STARTUP_RESUME_SESSION_ID: "old-resume-session",
      CODEXRIG_STARTUP_SESSION_SOURCE: "old-session-source",
      MISE_CAPTURE_PATH: miseCapturePath,
      NODE_OPTIONS: "--require=/synthetic/ambient/preload.cjs",
      NODE_PATH: "/synthetic/ambient/modules",
      NPM_CONFIG_SCRIPT_SHELL: "/synthetic/ambient/shell",
      PNPM_CONFIG_NODE_OPTIONS: "--require=/synthetic/pnpm/preload.cjs",
      PATH: `${binDirectory}:/usr/bin:/bin`,
      SYNTHETIC_LAUNCH_SECRET: syntheticSecret,
    },
  });
  assert.equal(
    result.status,
    0,
    JSON.stringify({ error: result.error?.message, signal: result.signal, stderr: result.stderr }),
  );
  assert.deepEqual(capturedCalls(), [
    {
      home: runtimeCodexHome,
      args: ["--cd", fixture, "--no-alt-screen", ...sessionControlArguments, "--", "--fixture"],
    },
  ]);
  const successfulMiseCalls = capturedMiseCalls();
  assert.deepEqual(successfulMiseCalls.slice(0, 5), [
    {
      home: "<unset>",
      cwd: fixture,
      args: ["exec", "--locked", "--", "node", "scripts/deps/verify-pnpm-execution-policy.mjs"],
    },
    {
      home: "<unset>",
      cwd: fixture,
      args: ["exec", "--locked", "--", "bash", "scripts/setup/check-prereqs.sh", "--codex"],
    },
    {
      home: "<unset>",
      cwd: fixture,
      args: ["exec", "--locked", "--", "node", "scripts/setup/validate-codex-model-policy.mjs"],
    },
    {
      home: "<unset>",
      cwd: fixture,
      args: ["exec", "--locked", "--", "node", "scripts/verify/licensing.mjs"],
    },
    {
      home: "<unset>",
      cwd: fixture,
      args: ["exec", "--locked", "--", "node", "scripts/framework/framework-doctor.mjs"],
    },
  ]);
  assert.equal(successfulMiseCalls.length, 6);
  assert.deepEqual(successfulMiseCalls[5].home, "<unset>");
  assert.deepEqual(successfulMiseCalls[5].cwd, fixture);
  assert.deepEqual(successfulMiseCalls[5].args, [
    "exec",
    "--locked",
    "--",
    "node",
    "scripts/setup/startup-session-controller.mjs",
    "--control-policy",
    "interactive-v2:no-alt-screen",
    "--codex-executable",
    fakeCodex,
    "--prompt-present",
    "true",
    "--",
    "--fixture",
  ]);
  assert.equal(`${result.stdout}${result.stderr}`.includes(fixture), false);
  assert.equal(`${result.stdout}${result.stderr}`.includes(syntheticSecret), false);

  rmSync(capturePath, { force: true });
  const yoloResult = run("bash", [launcher, "--yolo", "--", "--fixture"], {
    cwd: fixture,
    env: {
      CAPTURE_PATH: capturePath,
      CODEX_HOME: externalCodexHome,
      PATH: `${binDirectory}:/usr/bin:/bin`,
    },
  });
  assert.equal(yoloResult.status, 0, yoloResult.stderr);
  assert.deepEqual(capturedCalls(), [
    {
      home: runtimeCodexHome,
      args: [
        "--cd",
        fixture,
        "--dangerously-bypass-approvals-and-sandbox",
        ...sessionControlArguments,
        "--",
        "--fixture",
      ],
    },
  ]);

  const resumedSessionId = "01a01234-5678-7abc-8def-0123456789ab";

  rmSync(capturePath);
  const unavailableResume = run("bash", [launcher, "--", "continue"], {
    cwd: fixture,
    env: {
      CAPTURE_PATH: capturePath,
      EXPECTED_RESUME_SESSION_ID: resumedSessionId,
      FAKE_CODEX_RESUME_STATUS: "42",
      FAKE_STARTUP_LAUNCH_STATE: "launching",
      FAKE_STARTUP_SESSION_PLAN: `resume-id:${resumedSessionId}`,
      PATH: `${binDirectory}:/usr/bin:/bin`,
    },
  });
  assert.equal(unavailableResume.status, 0, unavailableResume.stderr);
  assert.deepEqual(capturedCalls(), [
    {
      home: runtimeCodexHome,
      args: [
        "--cd",
        fixture,
        ...sessionControlArguments,
        "resume",
        resumedSessionId,
        "--",
        "continue",
      ],
    },
    {
      home: runtimeCodexHome,
      args: ["--cd", fixture, ...sessionControlArguments, "--", "continue"],
    },
  ]);

  rmSync(capturePath);
  const unactivatedSuccessfulResume = run("bash", [launcher, "--", "continue"], {
    cwd: fixture,
    env: {
      CAPTURE_PATH: capturePath,
      EXPECTED_RESUME_SESSION_ID: resumedSessionId,
      FAKE_STARTUP_LAUNCH_STATE: "launching",
      FAKE_STARTUP_SESSION_PLAN: `resume-id:${resumedSessionId}`,
      PATH: `${binDirectory}:/usr/bin:/bin`,
    },
  });
  assert.equal(unactivatedSuccessfulResume.status, 1);
  assert.match(unactivatedSuccessfulResume.stderr, /refusing automatic fresh fallback/u);
  assert.deepEqual(capturedCalls(), [
    {
      home: runtimeCodexHome,
      args: [
        "--cd",
        fixture,
        ...sessionControlArguments,
        "resume",
        resumedSessionId,
        "--",
        "continue",
      ],
    },
  ]);

  rmSync(capturePath);
  const exactResume = run("bash", [launcher, "--", "continue"], {
    cwd: fixture,
    env: {
      CAPTURE_PATH: capturePath,
      EXPECTED_RESUME_SESSION_ID: resumedSessionId,
      EXPECTED_SESSION_SOURCE: "resume",
      FAKE_STARTUP_SESSION_PLAN: `resume-id:${resumedSessionId}`,
      PATH: `${binDirectory}:/usr/bin:/bin`,
    },
  });
  assert.equal(exactResume.status, 0, exactResume.stderr);
  assert.deepEqual(capturedCalls(), [
    {
      home: runtimeCodexHome,
      args: [
        "--cd",
        fixture,
        ...sessionControlArguments,
        "resume",
        resumedSessionId,
        "--",
        "continue",
      ],
    },
  ]);

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
  assert.equal(capturedCalls().length, 1);

  rmSync(capturePath);
  rmSync(miseCapturePath);
  const validationFailure = run("bash", [launcher], {
    cwd: fixture,
    env: {
      CAPTURE_PATH: capturePath,
      FAKE_MISE_FAIL_COMMAND: "exec --locked -- node scripts/framework/framework-doctor.mjs",
      FAKE_MISE_STATUS: "74",
      MISE_CAPTURE_PATH: miseCapturePath,
      PATH: `${binDirectory}:/usr/bin:/bin`,
    },
  });
  assert.equal(validationFailure.status, 74);
  assert.equal(existsSync(capturePath), false);
  assert.equal(capturedMiseCalls().length, 5);

  rmSync(capturePath, { force: true });
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
    {
      home: runtimeCodexHome,
      args: ["--cd", fixture, ...sessionControlArguments, "--", "--cd", "prompt text"],
    },
  ]);

  rmSync(capturePath, { force: true });
  const configPath = path.join(fixture, ".codex", "config.toml");
  writeFileSync(
    configPath,
    validPortableConfig.replace(
      "After a successful seal, stop completely and never permit automatic continuation.",
      "After a successful seal, finish safely.",
    ),
    "utf8",
  );
  const missingCriticalPolicy = run("bash", [launcher], {
    cwd: fixture,
    env: { CAPTURE_PATH: capturePath, PATH: `${binDirectory}:/usr/bin:/bin` },
  });
  assert.notEqual(missingCriticalPolicy.status, 0);
  assert.match(missingCriticalPolicy.stderr, /developer_instructions.*orchestration marker/i);
  assert.equal(existsSync(capturePath), false);

  rmSync(capturePath, { force: true });
  writeFileSync(configPath, validPortableConfig, "utf8");
  const defaultRolePath = path.join(fixture, ".codex", "agents", "default.toml");
  const validDefaultRole = readFileSync(defaultRolePath, "utf8");
  writeFileSync(
    defaultRolePath,
    validDefaultRole.replace('model = "gpt-5.6-sol"', 'model = "gpt-5.6-terra"'),
    "utf8",
  );
  const divergentRole = run("bash", [launcher], {
    cwd: fixture,
    env: { CAPTURE_PATH: capturePath, PATH: `${binDirectory}:/usr/bin:/bin` },
  });
  assert.notEqual(divergentRole.status, 0);
  assert.match(divergentRole.stderr, /agent default.*primary intelligence|supported GPT Sol/i);
  assert.equal(existsSync(capturePath), false);
  writeFileSync(defaultRolePath, validDefaultRole, "utf8");

  rmSync(capturePath, { force: true });
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
  assert.match(executableConfig.stderr, /unknown key mcp_servers/i);
  assert.equal(existsSync(capturePath), false);

  writeFileSync(
    configPath,
    validPortableConfig.replace('\n"""\nproject_doc_max_bytes', "\nproject_doc_max_bytes"),
    "utf8",
  );
  const unterminatedInstructions = run("bash", [launcher], {
    cwd: fixture,
    env: { CAPTURE_PATH: capturePath, PATH: `${binDirectory}:/usr/bin:/bin` },
  });
  assert.notEqual(unterminatedInstructions.status, 0);
  assert.match(unterminatedInstructions.stderr, /must contain valid TOML/i);
  assert.equal(existsSync(capturePath), false);

  writeFileSync(configPath, validPortableConfig.replace("hooks = true", "hooks = false"), "utf8");
  const disabledHooks = run("bash", [launcher], {
    cwd: fixture,
    env: { CAPTURE_PATH: capturePath, PATH: `${binDirectory}:/usr/bin:/bin` },
  });
  assert.notEqual(disabledHooks.status, 0);
  assert.match(disabledHooks.stderr, /features\.hooks.*outside the portable project policy/i);
  assert.equal(existsSync(capturePath), false);

  writeFileSync(configPath, validPortableConfig, "utf8");
  const hooksPath = path.join(fixture, ".codex", "hooks.json");
  const validHooks = readFileSync(hooksPath, "utf8");
  for (const invalidHooks of [
    "{}\n",
    validHooks.replace('"hooks": {}', '"hooks": {"Stop": []}'),
    validHooks.replace("issue-time session controller", "mutable project hook"),
  ]) {
    rmSync(capturePath, { force: true });
    writeFileSync(hooksPath, invalidHooks, "utf8");
    const rejectedHooks = run("bash", [launcher], {
      cwd: fixture,
      env: { CAPTURE_PATH: capturePath, PATH: `${binDirectory}:/usr/bin:/bin` },
    });
    assert.notEqual(rejectedHooks.status, 0);
    assert.match(
      rejectedHooks.stderr,
      /(exactly these keys|must remain empty|exact portable description)/i,
    );
    assert.equal(existsSync(capturePath), false);
  }
  writeFileSync(hooksPath, validHooks, "utf8");

  const gitignorePath = path.join(fixture, ".gitignore");
  const validGitignore = readFileSync(gitignorePath, "utf8");
  rmSync(capturePath, { force: true });
  writeFileSync(gitignorePath, validGitignore.replace("/auth.json\n", ""), "utf8");
  const unsafeIgnore = run("bash", [launcher], {
    cwd: fixture,
    env: { CAPTURE_PATH: capturePath, PATH: `${binDirectory}:/usr/bin:/bin` },
  });
  assert.notEqual(unsafeIgnore.status, 0);
  assert.match(unsafeIgnore.stderr, /CODEX_HOME isolation is incomplete/i);
  assert.equal(existsSync(capturePath), false);
  writeFileSync(gitignorePath, validGitignore, "utf8");

  for (const [override, expected] of [
    ["!/auth.json", /runtime is not effectively ignored/i],
    ["/.codex/config.toml", /portable Codex config is effectively ignored/i],
    ["!.codex/agents/extra.json", /runtime is not effectively ignored/i],
  ]) {
    rmSync(capturePath, { force: true });
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
  assert.match(unsafe.stderr, /non-symlink regular file/i);
  assert.equal(existsSync(capturePath), false);
});
