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
  CodexConfigError,
  parseProjectHooks,
  parseProjectAgentConfig,
  parsePortableCodexConfig,
  subagentModelPolicy,
  validateCodexConfig,
  validateProjectAgentConfigs,
} from "./validate-codex-config.mjs";
import { validateModelCatalog } from "./validate-codex-model-policy.mjs";
import { renderManagedPrePushHook } from "./install-git-hooks.mjs";
import {
  cleanupTemporaryRoots,
  configFixture,
  root,
  run,
  temporaryRoot,
  validPortableConfig,
  writeProjectHookFiles,
} from "./setup-regression-fixtures.mjs";
const clearedHookEnvironmentNames = [
  "CONTEXT_INDEX_DIRECTORY",
  "CONTEXT_INDEX_DOCS_ONLY",
  "CONTEXT_INDEX_EMBEDDING_BATCH_SIZE",
  "CONTEXT_INDEX_LOCK_TIMEOUT_MS",
  "CONTEXT_INDEX_MAX_FILE_BYTES",
  "CONTEXT_INDEX_MAX_SOURCE_FILES",
  "CONTEXT_INDEX_MAX_TOTAL_BYTES",
  "CONTEXT_INDEX_MODEL_CACHE",
  "CONTEXT_INDEX_OFFLINE",
  "CONTEXT_INDEX_ONNX_THREADS",
  "CONTEXT_INDEX_ROOT",
  "CONTEXT_INDEX_SANITIZED_WORKER",
  "CONTEXT_INDEX_STALE_LOCK_MS",
  "CONTEXT_INDEX_TEST_MODE",
  "CONTEXT_INDEX_TRACKED_ONLY",
];

after(cleanupTemporaryRoots);

test("Codex config parser accepts only the complete typed portable policy", () => {
  assert.deepEqual(validateCodexConfig(configFixture()), {
    project_doc_max_bytes: 65_536,
    project_doc_fallback_filenames: ["instructions.md"],
    model_reasoning_effort: "max",
    model_verbosity: "medium",
    web_search: "cached",
    model: "gpt-5.6-sol",
    service_tier: "fast",
    approvals_reviewer: "user",
    approval_policy: "never",
    sandbox_mode: "danger-full-access",
    "agents.max_concurrent_threads_per_session": 4,
    "agents.max_depth": 1,
    "features.hooks": true,
    "features.memories": true,
    "features.network_proxy": true,
    "features.prevent_idle_sleep": true,
    "tui.status_line": [
      "model-with-reasoning",
      "run-state",
      "weekly-limit",
      "five-hour-limit",
      "task-progress",
      "used-tokens",
    ],
    "tui.status_line_use_colors": true,
    "tui.terminal_title": [
      "activity",
      "project-name",
      "five-hour-limit",
      "weekly-limit",
      "task-progress",
    ],
    "tui.theme": "catppuccin-mocha",
  });

  const reusableFramework = configFixture(
    validPortableConfig.replace("memories = true", "memories = false"),
  );
  const sourceCreationSkill = path.join(
    reusableFramework,
    ".agents",
    "skills",
    "create-project-from-framework",
    "SKILL.md",
  );
  mkdirSync(path.dirname(sourceCreationSkill), { recursive: true });
  writeFileSync(sourceCreationSkill, "# Source-only fixture\n", "utf8");
  assert.equal(validateCodexConfig(reusableFramework)["features.memories"], false);

  const generatedWithDisabledMemories = configFixture(
    validPortableConfig.replace("memories = true", "memories = false"),
  );
  assert.throws(
    () => validateCodexConfig(generatedWithDisabledMemories),
    /Generated projects must enable local Codex memories/,
  );

  const reusableFrameworkWithEnabledMemories = configFixture();
  const enabledSourceCreationSkill = path.join(
    reusableFrameworkWithEnabledMemories,
    ".agents",
    "skills",
    "create-project-from-framework",
    "SKILL.md",
  );
  mkdirSync(path.dirname(enabledSourceCreationSkill), { recursive: true });
  writeFileSync(enabledSourceCreationSkill, "# Source-only fixture\n", "utf8");
  assert.throws(
    () => validateCodexConfig(reusableFrameworkWithEnabledMemories),
    /Reusable framework source must disable local Codex memories/,
  );

  const incompleteIsolation = configFixture();
  writeFileSync(
    path.join(incompleteIsolation, ".gitignore"),
    readFileSync(path.join(root, ".gitignore"), "utf8").replace("/auth.json\n", ""),
    "utf8",
  );
  assert.throws(
    () => validateCodexConfig(incompleteIsolation),
    /Repository-local CODEX_HOME isolation is incomplete.*auth\.json/s,
  );

  const overriddenIsolation = configFixture();
  writeFileSync(
    path.join(overriddenIsolation, ".gitignore"),
    `${readFileSync(path.join(root, ".gitignore"), "utf8")}\n!/auth.json\n/.codex/config.toml\n`,
    "utf8",
  );
  assert.throws(
    () => validateCodexConfig(overriddenIsolation),
    /runtime is not effectively ignored: auth\.json.*portable Codex config is effectively ignored: \.codex\/config\.toml/s,
  );

  const customizedProjectDefaults = validPortableConfig
    .replace('model = "gpt-5.6-sol"', 'model = "gpt-5.6-terra"')
    .replace('model_reasoning_effort = "max"', 'model_reasoning_effort = "ultra"')
    .replace("memories = true", "memories = false")
    .replace('theme = "catppuccin-mocha"', 'theme = "light"');
  const customizedPolicy = parsePortableCodexConfig(customizedProjectDefaults);
  assert.equal(customizedPolicy.model, "gpt-5.6-terra");
  assert.equal(customizedPolicy.model_reasoning_effort, "ultra");

  const standardTierPolicy = parsePortableCodexConfig(
    validPortableConfig.replace('service_tier = "fast"\n', ""),
  );
  assert.equal(Object.hasOwn(standardTierPolicy, "service_tier"), false);

  for (const [label, content, expected] of [
    [
      "commented required value",
      validPortableConfig.replace('approval_policy = "never"', '# approval_policy = "never"'),
      /Missing portable project policy keys: approval_policy/,
    ],
    [
      "duplicate contradiction",
      validPortableConfig.replace(
        'approval_policy = "never"',
        'approval_policy = "never"\napproval_policy = "on-request"',
      ),
      /duplicates key approval_policy/,
    ],
    [
      "unknown key",
      validPortableConfig.replace("[features]", 'unsafe_path = "/tmp"\n\n[features]'),
      /unknown key agents\.unsafe_path/,
    ],
    [
      "unsupported top-level network access",
      validPortableConfig.replace("\n[agents]", '\nnetwork_access = "enabled"\n\n[agents]'),
      /unknown key network_access/,
    ],
    [
      "unsupported agent thread limit",
      validPortableConfig.replace("max_concurrent_threads_per_session = 4", "max_threads = 4"),
      /unknown key agents\.max_threads/,
    ],
    ["unknown table", `${validPortableConfig}[profiles.local]\n`, /unsupported table/],
    [
      "wrong type",
      validPortableConfig.replace(
        "project_doc_max_bytes = 65536",
        'project_doc_max_bytes = "65536"',
      ),
      /non-negative decimal integer/,
    ],
    [
      "wrong allowed value",
      validPortableConfig.replace('web_search = "cached"', 'web_search = "live"'),
      /outside the portable project policy/,
    ],
    [
      "unsupported reasoning level",
      validPortableConfig.replace(
        'model_reasoning_effort = "max"',
        'model_reasoning_effort = "high"',
      ),
      /outside the portable project policy/,
    ],
    [
      "wrong table value type",
      validPortableConfig.replace("hooks = true", 'hooks = "true"'),
      /TOML boolean/,
    ],
    [
      "disabled lifecycle hooks",
      validPortableConfig.replace("hooks = true", "hooks = false"),
      /outside the portable project policy/,
    ],
  ]) {
    assert.throws(
      () => parsePortableCodexConfig(content),
      (error) => error instanceof CodexConfigError && expected.test(error.message),
      label,
    );
  }
});

test("project hooks enforce exact startup attestation and context-index handlers", () => {
  const validHooks = readFileSync(path.join(root, ".codex", "hooks.json"), "utf8");
  assert.equal(parseProjectHooks(validHooks).hooks.SessionStart.length, 1);
  assert.equal(parseProjectHooks(validHooks).hooks.Stop.length, 1);

  for (const [label, content, expected] of [
    [
      "wrong event",
      validHooks.replace('"SessionStart"', '"PostCompact"'),
      /hook events must contain exactly these keys: SessionStart, Stop/,
    ],
    [
      "wrong command",
      validHooks.replace("refresh-context-index-on-stop.sh", "index-codebase.mjs"),
      /violates the exact automatic context-index policy/,
    ],
    [
      "unexpected handler field",
      validHooks.replace('"type": "command",', '"type": "command",\n            "async": true,'),
      /must contain exactly these keys/,
    ],
  ]) {
    assert.throws(() => parseProjectHooks(content), expected, label);
  }
});

test("automatic context-index Stop hook skips bootstrap and reports unsafe state", () => {
  const script = path.join(root, "scripts", "context", "refresh-context-index-on-stop.mjs");
  const beforeSetup = temporaryRoot("context-stop-before-setup-");
  writeProjectHookFiles(beforeSetup);
  const launcher = path.join(beforeSetup, "scripts", "context", "refresh-context-index-on-stop.sh");
  const skippedWithoutRuntime = run("bash", [launcher], {
    cwd: beforeSetup,
    env: { CODEX_HOME: beforeSetup, PATH: "/usr/bin:/bin" },
  });
  assert.equal(skippedWithoutRuntime.status, 0, skippedWithoutRuntime.stderr);
  assert.equal(skippedWithoutRuntime.stdout, "");
  assert.equal(existsSync(path.join(beforeSetup, ".context-index")), false);

  const binDirectory = path.join(beforeSetup, "bin");
  const capturePath = path.join(beforeSetup, "mise-capture.txt");
  mkdirSync(path.join(beforeSetup, ".context-index"));
  mkdirSync(binDirectory);
  const fakeMise = path.join(binDirectory, "mise");
  const fakeMiseSource = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'if [[ "${MISE_FAIL:-0}" == "1" ]]; then',
    "  printf 'mise stdout %s\\n' \"$PWD/private\"",
    "  printf 'mise stderr %s\\n' \"$PWD/private\" >&2",
    "  exit 42",
    "fi",
    "{",
    "  printf '%s\\0' \"$PWD\"",
    `  for variable_name in ${clearedHookEnvironmentNames.join(" ")}; do`,
    '    if declare -p "$variable_name" >/dev/null 2>&1; then',
    "      printf '%s\\0' \"${!variable_name}\"",
    "    else",
    "      printf '<unset>\\0'",
    "    fi",
    "  done",
    "  printf '%s\\0' \"$@\"",
    '} > "$CAPTURE_PATH"',
    'if [[ -n "${MISE_OUTPUT:-}" ]]; then',
    "  printf '%s\\n' \"$MISE_OUTPUT\"",
    "fi",
    'if [[ -n "${MISE_ERROR_OUTPUT:-}" ]]; then',
    "  printf '%s\\n' \"$MISE_ERROR_OUTPUT\" >&2",
    "fi",
  ].join("\n");
  for (const shellSource of [readFileSync(launcher, "utf8"), fakeMiseSource]) {
    assert.doesNotMatch(shellSource, /declare\s+-A|\[\[\s+-v\b/);
  }
  writeFileSync(fakeMise, fakeMiseSource, "utf8");
  chmodSync(fakeMise, 0o755);
  const pinned = run("bash", [launcher], {
    cwd: beforeSetup,
    env: {
      CAPTURE_PATH: capturePath,
      CODEX_HOME: beforeSetup,
      PATH: `${binDirectory}:/usr/bin:/bin`,
      ...Object.fromEntries(
        clearedHookEnvironmentNames.map((name) => [name, `${beforeSetup}/unsafe-${name}`]),
      ),
    },
  });
  assert.equal(pinned.status, 0, pinned.stderr);
  assert.deepEqual(readFileSync(capturePath, "utf8").split("\0").filter(Boolean), [
    beforeSetup,
    ...clearedHookEnvironmentNames.map(() => "<unset>"),
    "exec",
    "--locked",
    "--",
    "node",
    "scripts/context/refresh-context-index-on-stop.mjs",
  ]);

  const continuedOutput = JSON.stringify({ decision: "block", reason: "Continue the outcome" });
  const continued = run("bash", [launcher], {
    cwd: beforeSetup,
    env: {
      CAPTURE_PATH: capturePath,
      CODEX_HOME: beforeSetup,
      MISE_ERROR_OUTPUT: `${beforeSetup}/sanitized-worker-warning`,
      MISE_OUTPUT: continuedOutput,
      PATH: `${binDirectory}:/usr/bin:/bin`,
    },
  });
  assert.equal(continued.status, 0, continued.stderr);
  assert.equal(continued.stderr, "");
  assert.deepEqual(JSON.parse(continued.stdout), JSON.parse(continuedOutput));

  const failedMise = run("bash", [launcher], {
    cwd: beforeSetup,
    env: {
      CAPTURE_PATH: capturePath,
      CODEX_HOME: beforeSetup,
      MISE_FAIL: "1",
      PATH: `${binDirectory}:/usr/bin:/bin`,
    },
  });
  assert.equal(failedMise.status, 0, failedMise.stderr);
  assert.equal(failedMise.stderr, "");
  assert.deepEqual(Object.keys(JSON.parse(failedMise.stdout)), ["systemMessage"]);
  assert.match(failedMise.stdout, /Automatic context index refresh failed/);
  assert.equal(failedMise.stdout.includes(beforeSetup), false);

  const unsafeRoot = temporaryRoot("context-stop-unsafe-");
  const externalIndex = temporaryRoot("context-stop-external-");
  writeFileSync(path.join(externalIndex, "manifest.json"), "{}\n", "utf8");
  symlinkSync(externalIndex, path.join(unsafeRoot, ".context-index"), "dir");
  const reported = run(process.execPath, [script], {
    cwd: unsafeRoot,
    env: {
      CODEX_HOME: unsafeRoot,
      CONTEXT_INDEX_ROOT: unsafeRoot,
      CONTEXT_INDEX_TEST_MODE: "1",
    },
    input: JSON.stringify({
      session_id: "setup-regression-session",
      turn_id: "setup-regression-turn",
      transcript_path: path.join(unsafeRoot, ".codex/runtime/sessions/fixture.jsonl"),
      cwd: unsafeRoot,
      hook_event_name: "Stop",
      model: "test-model",
      permission_mode: "dontAsk",
      stop_hook_active: false,
      last_assistant_message: null,
    }),
  });
  assert.equal(reported.status, 0, reported.stderr);
  const message = JSON.parse(reported.stdout);
  assert.deepEqual(Object.keys(message), ["systemMessage"]);
  assert.match(message.systemMessage, /Automatic context index refresh failed/);
  assert.equal(reported.stderr, "");
  assert.equal(reported.stdout.includes(unsafeRoot), false);
  assert.equal(reported.stdout.includes(externalIndex), false);
});

test("project subagent roles fix the second model tier and allow safe bounded overrides", () => {
  const defaultAgent = readFileSync(path.join(root, ".codex", "agents", "default.toml"), "utf8");
  assert.equal(parseProjectAgentConfig(defaultAgent, "default").model, subagentModelPolicy.model);
  assert.throws(
    () =>
      parseProjectAgentConfig(
        defaultAgent.replace('model = "gpt-5.6-terra"', 'model = "gpt-5.6-sol"'),
        "default",
      ),
    /project agent policy for model/,
  );
  assert.throws(
    () =>
      parseProjectAgentConfig(
        defaultAgent.replace('model = "gpt-5.6-terra"', 'model = "gpt-5.6-luna"'),
        "default",
      ),
    /project agent policy for model/,
  );
  const boundedReviewer = parseProjectAgentConfig(
    `${defaultAgent}model_reasoning_effort = "ultra"\nsandbox_mode = "read-only"\n`,
    "default",
  );
  assert.equal(boundedReviewer.model_reasoning_effort, "ultra");
  assert.equal(boundedReviewer.sandbox_mode, "read-only");
  assert.throws(
    () => parseProjectAgentConfig(`${defaultAgent}model_reasoning_effort = "high"\n`, "default"),
    /project agent policy for model_reasoning_effort/,
  );
  assert.throws(
    () =>
      parseProjectAgentConfig(`${defaultAgent}sandbox_mode = "danger-full-access"\n`, "default"),
    /project agent policy for sandbox_mode/,
  );
  assert.throws(
    () =>
      parseProjectAgentConfig(defaultAgent.replace("context:search", "semantic-search"), "default"),
    /retrieval contract marker context:search/,
  );
  assert.throws(
    () =>
      parseProjectAgentConfig(defaultAgent.replace("matched source", "search result"), "default"),
    /retrieval contract marker matched source/,
  );
  assert.throws(
    () =>
      parseProjectAgentConfig(
        defaultAgent.replace(
          "Before every assigned slice begins",
          "After every assigned slice begins",
        ),
        "default",
      ),
    /retrieval contract marker Before every assigned slice begins/,
  );
  assert.throws(
    () =>
      parseProjectAgentConfig(
        defaultAgent.replace("newest relevant primary or official sources", "available sources"),
        "default",
      ),
    /retrieval contract marker newest relevant primary or official sources/,
  );

  const fixture = configFixture();
  rmSync(path.join(fixture, ".codex", "agents", "worker.toml"));
  assert.throws(
    () => validateProjectAgentConfigs(path.join(fixture, ".codex")),
    /Missing project agent roles: worker/,
  );
});

test("installed model catalog permits only first-tier or second-tier primaries and Terra subagents", () => {
  const catalog = {
    models: [
      {
        slug: "gpt-5.6-sol",
        priority: 1,
        visibility: "list",
        supported_reasoning_levels: [{ effort: "xhigh" }, { effort: "max" }, { effort: "ultra" }],
      },
      {
        slug: "gpt-5.6-terra",
        priority: 2,
        visibility: "list",
        supported_reasoning_levels: [{ effort: "xhigh" }, { effort: "max" }, { effort: "ultra" }],
      },
      {
        slug: "gpt-5.6-luna",
        priority: 3,
        visibility: "list",
        supported_reasoning_levels: [{ effort: "xhigh" }, { effort: "max" }, { effort: "ultra" }],
      },
    ],
  };
  assert.equal(validateModelCatalog(catalog, "gpt-5.6-sol", "xhigh").secondTier, "gpt-5.6-terra");
  assert.equal(
    validateModelCatalog(catalog, "gpt-5.6-terra", "xhigh").primaryModel,
    "gpt-5.6-terra",
  );
  assert.throws(() => validateModelCatalog(catalog, "gpt-5.6-luna", "xhigh"), /below or outside/);
  const terraMissing = structuredClone(catalog);
  terraMissing.models[1].slug = "gpt-5.6-luna";
  assert.throws(
    () => validateModelCatalog(terraMissing, "gpt-5.6-sol", "xhigh"),
    /no longer.*second tier/,
  );
  const defaultEffortMissing = structuredClone(catalog);
  defaultEffortMissing.models[1].supported_reasoning_levels = [
    { effort: "xhigh" },
    { effort: "ultra" },
  ];
  assert.throws(
    () => validateModelCatalog(defaultEffortMissing, "gpt-5.6-sol", "xhigh"),
    /required reasoning: max/,
  );
  const primaryEffortMissing = structuredClone(catalog);
  primaryEffortMissing.models[0].supported_reasoning_levels = [
    { effort: "max" },
    { effort: "ultra" },
  ];
  assert.throws(
    () => validateModelCatalog(primaryEffortMissing, "gpt-5.6-sol", "xhigh"),
    /configured reasoning effort xhigh.*gpt-5\.6-sol/i,
  );
});

test("hook installation is managed and never overwrites an unrelated hook", () => {
  const fixture = temporaryRoot("codex-hooks-");
  mkdirSync(path.join(fixture, "scripts", "repository"), { recursive: true });
  mkdirSync(path.join(fixture, "scripts", "setup"), { recursive: true });
  mkdirSync(path.join(fixture, "scripts", "git-hooks"), { recursive: true });
  const installer = path.join(fixture, "scripts", "setup", "install-git-hooks.sh");
  const installerModule = path.join(fixture, "scripts", "setup", "install-git-hooks.mjs");
  const pathResolver = path.join(fixture, "scripts", "setup", "resolve-git-hooks-path.mjs");
  const gitIsolation = path.join(fixture, "scripts", "repository", "git-runtime-isolation.mjs");
  const sourceHook = path.join(fixture, "scripts", "git-hooks", "pre-push");
  copyFileSync(path.join(root, "scripts/setup/install-git-hooks.sh"), installer);
  copyFileSync(path.join(root, "scripts/setup/install-git-hooks.mjs"), installerModule);
  copyFileSync(path.join(root, "scripts/setup/resolve-git-hooks-path.mjs"), pathResolver);
  copyFileSync(path.join(root, "scripts/repository/git-runtime-isolation.mjs"), gitIsolation);
  copyFileSync(path.join(root, "scripts/git-hooks/pre-push"), sourceHook);
  chmodSync(installer, 0o755);
  chmodSync(sourceHook, 0o755);
  assert.equal(run("git", ["init", "-q"], { cwd: fixture }).status, 0);

  const installed = run("bash", [installer], { cwd: fixture });
  assert.equal(installed.status, 0, installed.stderr);
  const targetHook = path.join(fixture, ".git", "hooks", "pre-push");
  assert.equal(
    readFileSync(targetHook, "utf8"),
    renderManagedPrePushHook({
      installedHook: targetHook,
      root: fixture,
      sourceHook,
    }),
  );
  chmodSync(sourceHook, 0o644);
  const nonExecutableSource = run("sh", [targetHook], { cwd: fixture });
  assert.notEqual(nonExecutableSource.status, 126, nonExecutableSource.stderr);
  chmodSync(sourceHook, 0o755);

  const foreignRepository = temporaryRoot("codex-foreign-git-");
  assert.equal(run("git", ["init", "-q"], { cwd: foreignRepository }).status, 0);
  const ambient = run("bash", [installer], {
    cwd: fixture,
    env: {
      GIT_DIR: path.join(foreignRepository, ".git"),
      GIT_WORK_TREE: foreignRepository,
    },
  });
  assert.equal(ambient.status, 0, ambient.stderr);
  assert.equal(existsSync(path.join(foreignRepository, ".git", "hooks", "pre-push")), false);
  assert.equal(existsSync(targetHook), true);

  const redirectedWorktree = temporaryRoot("codex-redirected-worktree-");
  assert.equal(
    run("git", ["config", "core.worktree", redirectedWorktree], { cwd: fixture }).status,
    0,
  );
  const redirected = run("bash", [installer], { cwd: fixture });
  assert.equal(redirected.status, 0, redirected.stderr);
  assert.equal(existsSync(path.join(redirectedWorktree, ".git", "hooks", "pre-push")), false);
  assert.equal(
    run("git", [`--git-dir=${path.join(fixture, ".git")}`, "config", "--unset", "core.worktree"], {
      cwd: fixture,
    }).status,
    0,
  );

  const foreign = "#!/usr/bin/env bash\necho foreign\n";
  writeFileSync(targetHook, foreign, "utf8");
  const refused = run("bash", [installer], { cwd: fixture });
  assert.notEqual(refused.status, 0);
  assert.equal(readFileSync(targetHook, "utf8"), foreign);

  const externalHooks = path.join(temporaryRoot("codex-shared-hooks-"), "hooks");
  mkdirSync(externalHooks, { recursive: true });
  const sentinel = path.join(externalHooks, "pre-push");
  writeFileSync(sentinel, "shared hook\n", "utf8");
  assert.equal(run("git", ["config", "core.hooksPath", externalHooks], { cwd: fixture }).status, 0);
  const outsideRefused = run("bash", [installer], { cwd: fixture });
  assert.notEqual(outsideRefused.status, 0);
  assert.match(outsideRefused.stderr, /outside this repository's Git common directory/);
  assert.equal(readFileSync(sentinel, "utf8"), "shared hook\n");
});

test("project export cannot overwrite source or an existing archive", () => {
  const fixture = temporaryRoot("codex-export-boundary-");
  const setupDirectory = path.join(fixture, "scripts", "setup");
  mkdirSync(setupDirectory, { recursive: true });
  const exporter = path.join(setupDirectory, "export-project.sh");
  copyFileSync(path.join(root, "scripts/setup/export-project.sh"), exporter);
  chmodSync(exporter, 0o755);
  const exporterContent = readFileSync(exporter, "utf8");
  assert.match(exporterContent, /node "\$stage\/scripts\/setup\/validate-staged-project\.mjs"/);
  assert.doesNotMatch(
    exporterContent,
    /node scripts\/setup\/validate-staged-project\.mjs "\$stage"/,
  );
  writeFileSync(path.join(fixture, "package.json"), '{"name":"export-boundary-fixture"}\n', "utf8");
  writeFileSync(path.join(fixture, "README.md"), "source sentinel\n", "utf8");

  const sourceTarget = run("bash", [exporter, "README.md"], { cwd: fixture });
  assert.notEqual(sourceTarget.status, 0);
  assert.match(sourceTarget.stderr, /dist\/exports/);
  assert.equal(readFileSync(path.join(fixture, "README.md"), "utf8"), "source sentinel\n");

  mkdirSync(path.join(fixture, "dist", "exports"), { recursive: true });
  const existing = path.join(fixture, "dist", "exports", "existing.tar.gz");
  writeFileSync(existing, "archive sentinel\n", "utf8");
  const existingTarget = run("bash", [exporter, "dist/exports/existing.tar.gz"], {
    cwd: fixture,
  });
  assert.notEqual(existingTarget.status, 0);
  assert.match(existingTarget.stderr, /already exists/);
  assert.equal(readFileSync(existing, "utf8"), "archive sentinel\n");
});
