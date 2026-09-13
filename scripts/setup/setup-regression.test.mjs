/** Verifies setup regression behavior for the setup, launch, and portable project boundary. */
import assert from "node:assert/strict";
import { readCompatibilityMatrix } from "../contracts/framework-contract.mjs";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { parsePortableToml } from "../contracts/portable-toml.mjs";
import {
  CodexConfigError,
  parseProjectHooks,
  parseProjectAgentConfig,
  parsePortableCodexConfig,
  sharedAgentIntelligencePolicy,
  validateCodexConfig,
  validateProjectAgentConfigs,
  validateRuntimeCodexConfig,
} from "./validate-codex-config.mjs";
import { validateModelCatalog } from "./validate-codex-model-policy.mjs";
import { renderManagedPrePushHook } from "./install-git-hooks.mjs";
import {
  sessionControlHookConfigArguments,
  sessionControlHookExpectations,
} from "./session-control-hook-command.mjs";
import {
  inspectRuntimeSessionLease,
  inspectRuntimeSessionRecovery,
  issueRuntimeSessionLease,
  releaseRuntimeSessionLease,
} from "../repository/runtime-session-lease.mjs";
import {
  beginStartupSessionWriterHandoff,
  bindStartupSessionCodexProcess,
  bindStartupSessionWriter,
  completeStartupSessionWriterHandoff,
  issueStartupAttestation,
  startupAttestationPath,
  startupAttestedInputPaths,
  startupControlPolicies,
  verifyStartupAttestation,
} from "./startup-attestation.mjs";
import {
  cleanupTemporaryRoots,
  configFixture,
  copyPortableSetupFixture,
  root,
  run,
  temporaryRoot,
  validPortableConfig,
} from "./setup-regression-test-helpers.mjs";

test("the sole TOML parser is strict and supports the portable config subset", () => {
  assert.deepEqual(
    parsePortableToml(`
name = "fixture # value"
enabled = true
items = ["one", 'two']
developer_instructions = """
bounded line one
bounded line two
"""

[sandbox_workspace_write]
network_access = false
`),
    {
      name: "fixture # value",
      enabled: true,
      items: ["one", "two"],
      developer_instructions: "bounded line one\nbounded line two\n",
      sandbox_workspace_write: { network_access: false },
    },
  );
  assert.throws(() => parsePortableToml('name = "one"\nname = "two"\n'), /duplicate key name/);
  assert.throws(() => parsePortableToml("unsupported = 1.5\n"), /unsupported portable TOML/);
  assert.throws(
    () => parsePortableToml("name = 'not''a-valid-literal'\n"),
    /unsupported quote in literal string/,
  );
  assert.deepEqual(parsePortableToml('[projects."/tmp/project.with-dot"]\ntrusted = true\n'), {
    projects: { "/tmp/project.with-dot": { trusted: true } },
  });
  const prototypeKey = parsePortableToml("[__proto__]\nunsafe = true\n");
  assert.equal(Object.hasOwn(prototypeKey, "__proto__"), true);
  assert.equal(Object.prototype.unsafe, undefined);
  assert.throws(
    () => parsePortableToml(`value = ${Number.MAX_SAFE_INTEGER + 1}\n`),
    /integer is out of range/,
  );
});

after(cleanupTemporaryRoots);

// Problem: portable skill validation rejected Codex's supported explicit-only activation policy.
// Contract: the real verifier accepts either boolean or the native default, never an invalid type.
test("skill metadata preserves native implicit and explicit activation choices", () => {
  const fixture = path.join(temporaryRoot("codex-skill-policy-"), "code");
  copyPortableSetupFixture(fixture);
  symlinkSync(path.join(root, "node_modules"), path.join(fixture, "node_modules"), "dir");
  const metadataPath = path.join(fixture, ".agents/skills/task-quality/agents/openai.yaml");
  const metadata = readFileSync(metadataPath, "utf8");
  for (const [policy, valid] of [
    ["", true],
    ["policy: {}\n", true],
    ['"policy":\n  "allow_implicit_invocation": false\n', true],
    ["policy:\n  allow_implicit_invocation: false # explicit\n", true],
    ["policy:\n  allow_implicit_invocation: true\n", true],
    ["policy:\n  allow_implicit_invocation: false\n", true],
    ['policy:\n  allow_implicit_invocation: "false"\n', false],
    ['"policy":\n  allow_implicit_invocation: "false"\n', false],
    ["policy: false\n", false],
    ["policy:\n  allow_implicit_invocation: null\n", false],
    ["policy:\n  allow_implicit_invocation: 0\n", false],
    ["policy:\n  allow_implicit_invocation: [false]\n", false],
    ["policy:\n  allow_implicit_invocation: true\n  allow_implicit_invocation: false\n", false],
  ]) {
    writeFileSync(metadataPath, `${metadata}\n${policy}`);
    const result = run(process.execPath, ["scripts/verify/skill-paths.mjs"], { cwd: fixture });
    assert.equal(result.status, valid ? 0 : 1, `${policy || "native default"}\n${result.stderr}`);
    if (!valid) assert.match(result.stderr, /allow_implicit_invocation|invalid YAML/);
  }
});

test("Codex config parser accepts only the complete typed portable policy", () => {
  assert.deepEqual(validateCodexConfig(configFixture()), {
    developer_instructions:
      "Act as the primary orchestrator. Retain exactly one current internal contract per concern. Keep at most four live agents and never pass a model or reasoning override; all use the exact GPT Astra model with ultra reasoning. Register every owned subagent and background task and leave foreign or ambiguous processes untouched. Treat role sandboxes as requested defaults because live parent permission overrides can be reapplied; require each child to report effective runtime permissions before tool work. Read-only roles stop on a broader override; a writer may accept this primary's already-authorized YOLO override only for its exact disjoint repository write set. After every completed slice, run pnpm worktree:status -- --json as the worktree settlement trigger; preservation is a safety state, never completion. At 5% or less, perform the exact Critical Budget Drain and run pnpm handover:create -- --critical as the final repository action. After a successful seal, stop completely and never permit automatic continuation.\n",
    project_doc_max_bytes: 32_768,
    project_doc_fallback_filenames: ["instructions.md"],
    model_reasoning_effort: "ultra",
    model_verbosity: "medium",
    web_search: "cached",
    model: "gpt-6-astra",
    approvals_reviewer: "user",
    approval_policy: "on-request",
    sandbox_mode: "workspace-write",
    "sandbox_workspace_write.network_access": false,
    "agents.enabled": true,
    "agents.default_subagent_model": "gpt-6-astra",
    "agents.default_subagent_reasoning_effort": "ultra",
    "agents.max_concurrent_threads_per_session": 4,
    "agents.interrupt_message": true,
    "features.goals": true,
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

  const disabledMemories = configFixture(
    validPortableConfig.replace("memories = true", "memories = false"),
  );
  assert.equal(validateCodexConfig(disabledMemories)["features.memories"], false);

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
    .replaceAll('model = "gpt-6-astra"', 'model = "gpt-7-astra"')
    .replace("memories = true", "memories = false")
    .replace('theme = "catppuccin-mocha"', 'theme = "light"');
  const customizedPolicy = parsePortableCodexConfig(customizedProjectDefaults);
  assert.equal(customizedPolicy.model, "gpt-7-astra");
  assert.equal(customizedPolicy.model_reasoning_effort, "ultra");

  assert.equal(Object.hasOwn(parsePortableCodexConfig(validPortableConfig), "service_tier"), false);
  assert.equal(Object.hasOwn(validateCodexConfig(root), "service_tier"), false);
  const customTierPolicy = parsePortableCodexConfig(
    validPortableConfig.replace(
      'model = "gpt-6-astra"\n',
      'model = "gpt-6-astra"\nservice_tier = "fast"\n',
    ),
  );
  assert.equal(customTierPolicy.service_tier, "fast");

  for (const [label, content, expected] of [
    [
      "commented required value",
      validPortableConfig.replace(
        'approval_policy = "on-request"',
        '# approval_policy = "on-request"',
      ),
      /Missing portable project policy keys: approval_policy/,
    ],
    [
      "duplicate contradiction",
      validPortableConfig.replace(
        'approval_policy = "on-request"',
        'approval_policy = "on-request"\napproval_policy = "never"',
      ),
      /valid TOML/,
    ],
    [
      "unknown key",
      validPortableConfig.replace("[features]", 'unsafe_path = "/tmp"\n\n[features]'),
      /unknown key agents\.unsafe_path/,
    ],
    [
      "unsupported top-level network access",
      validPortableConfig.replace(
        "\n[sandbox_workspace_write]",
        '\nnetwork_access = "enabled"\n\n[sandbox_workspace_write]',
      ),
      /unknown key network_access/,
    ],
    [
      "unsupported agent thread limit",
      validPortableConfig.replace("max_concurrent_threads_per_session = 4", "max_threads = 4"),
      /unknown key agents\.max_threads/,
    ],
    ["unknown table", `${validPortableConfig}[profiles.local]\n`, /unknown key profiles/],
    [
      "wrong type",
      validPortableConfig.replace(
        "project_doc_max_bytes = 32768",
        'project_doc_max_bytes = "32768"',
      ),
      /outside the portable project policy/,
    ],
    [
      "wrong allowed value",
      validPortableConfig.replace('web_search = "cached"', 'web_search = "live"'),
      /outside the portable project policy/,
    ],
    [
      "unsupported reasoning level",
      validPortableConfig.replace(
        'model_reasoning_effort = "ultra"',
        'model_reasoning_effort = "high"',
      ),
      /outside the portable project policy/,
    ],
    [
      "unsupported non-Astra primary model",
      validPortableConfig.replace('model = "gpt-6-astra"', 'model = "gpt-5.6-terra"'),
      /outside the portable project policy/,
    ],
    [
      "mismatched delegated default",
      validPortableConfig.replace(
        'default_subagent_model = "gpt-6-astra"',
        'default_subagent_model = "gpt-7-astra"',
      ),
      /agent defaults must use exactly the primary model and reasoning effort/,
    ],
    [
      "wrong table value type",
      validPortableConfig.replace("hooks = true", 'hooks = "true"'),
      /outside the portable project policy/,
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

test("malformed portable TOML diagnostics never echo source values", () => {
  const token = `sk-proj-${"x".repeat(32)}`;
  for (const parser of [parsePortableCodexConfig, parsePortableToml]) {
    let error;
    try {
      parser(`bad = ${token} /tmp/private-config\n`);
      assert.fail("Malformed TOML was accepted.");
    } catch (caught) {
      error = caught;
    }
    assert.equal(error.message.includes(token), false);
    assert.equal(error.message.includes("/tmp/private-config"), false);
  }
});

test("runtime Codex config permits only non-executable repository-local metadata", () => {
  const fixture = configFixture();
  const runtimeDirectory = fixture;
  const runtimeConfig = path.join(runtimeDirectory, "config.toml");
  const safe = [
    'approvals_reviewer = "user"',
    'model = "gpt-6-astra"',
    'model_reasoning_effort = "max"',
    'service_tier = "fast"',
    `[projects.${JSON.stringify(fixture)}]`,
    'trust_level = "trusted"',
    "",
    "[hooks.state]",
    "",
    "[notice]",
    "hide_rate_limit_model_nudge = true",
    "[tui]",
    'theme = "codex"',
    "[tui.model_availability_nux]",
    "gpt-6-astra = 2",
    "",
  ].join("\n");
  writeFileSync(runtimeConfig, safe, { encoding: "utf8", mode: 0o600 });
  assert.equal(validateRuntimeCodexConfig(fixture).status, "present");

  for (const unsafe of [
    'notify = ["sh", "-c", "run-project-code"]\n',
    '[mcp_servers.project]\ncommand = "run-project-code"\n',
    "[plugins.project]\nenabled = true\n",
    'openai_base_url = "https://attacker.invalid"\n',
  ]) {
    writeFileSync(runtimeConfig, unsafe, { encoding: "utf8", mode: 0o600 });
    assert.throws(
      () => validateRuntimeCodexConfig(fixture),
      /contains an executable or unsupported key/u,
    );
  }

  for (const invalidPreference of [
    'model = "invalid model"\n',
    'model_reasoning_effort = ["max"]\n',
  ]) {
    writeFileSync(runtimeConfig, invalidPreference, { encoding: "utf8", mode: 0o600 });
    assert.throws(() => validateRuntimeCodexConfig(fixture), /preference is invalid/u);
  }
  for (const [invalidTooltip, expected] of [
    ['[tui.model_availability_nux]\ngpt-6-astra = "command"\n', /tooltip state is invalid/u],
    ["[tui.model_availability_nux]\ngpt-6-astra = -1\n", /must contain valid TOML/u],
    ["[tui.model_availability_nux]\n-invalid = 1\n", /tooltip state is invalid/u],
  ]) {
    writeFileSync(runtimeConfig, invalidTooltip, { encoding: "utf8", mode: 0o600 });
    assert.throws(() => validateRuntimeCodexConfig(fixture), expected);
  }
});

test("project hooks leave lifecycle execution exclusively to the issue-time controller", () => {
  const validHooks = readFileSync(path.join(root, ".codex", "hooks.json"), "utf8");
  assert.deepEqual(parseProjectHooks(validHooks).hooks, {});

  for (const [label, content, expected] of [
    [
      "file-loaded event",
      validHooks.replace('"hooks": {}', '"hooks": {"Stop": []}'),
      /hook events must remain empty/,
    ],
    [
      "wrong description",
      validHooks.replace("issue-time session controller", "mutable project hook"),
      /exact portable description/,
    ],
    [
      "unexpected top-level field",
      validHooks.replace('"hooks": {}', '"hooks": {},\n  "trust": true'),
      /must contain exactly these keys/,
    ],
  ]) {
    assert.throws(() => parseProjectHooks(content), expected, label);
  }
});

test("session controller injects exactly two narrowly trusted Codex hook identities", () => {
  const hookArguments = sessionControlHookConfigArguments();
  const hooks = sessionControlHookExpectations();
  assert.equal(hookArguments.length, 6);
  assert.equal(hooks.length, 2);
  assert.deepEqual(
    hooks.map(({ eventName, key }) => ({ eventName, key })),
    [
      {
        eventName: "sessionStart",
        key: "/<session-flags>/config.toml:session_start:0:0",
      },
      { eventName: "stop", key: "/<session-flags>/config.toml:stop:0:0" },
    ],
  );
  assert.deepEqual(
    hooks.map((hook) => hook.currentHash),
    [
      "sha256:4eebb9d030b703339bf675708292c60fae1d4386dd43e5f142d646c914362151",
      "sha256:e1cf4a7ed1589a15080d76bbe031d5b3c1e4db20d4e526d21a4604b0f50fe2fd",
    ],
  );
  assert.equal(hookArguments.includes("--dangerously-bypass-hook-trust"), false);
});

test("embedded lifecycle clients fail closed without executing a repository path", () => {
  const hooks = sessionControlHookExpectations();
  for (const [mode, command] of [
    ["session-start", hooks[0].command],
    ["stop", hooks[1].command],
  ]) {
    const result = run("bash", ["-c", command], {
      cwd: root,
      env: {
        CODEXRIG_SESSION_CONTROL_PORT: "",
        CODEXRIG_SESSION_CONTROL_TOKEN: "",
        CODEXRIG_SESSION_CONTROL_NODE: process.execPath,
      },
      input: "{}",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    if (mode === "session-start") assert.equal(output.continue, false);
    else assert.deepEqual(Object.keys(output), ["systemMessage"]);
    assert.match(output.systemMessage, /issue-time controller/u);
  }
});

test("startup attestation binds the complete preloaded controller closure", () => {
  const fixture = temporaryRoot("startup-executable-closure-");
  for (const relativePath of startupAttestedInputPaths(root)) {
    const source = path.join(root, ...relativePath.split("/"));
    const target = path.join(fixture, ...relativePath.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  const binDirectory = temporaryRoot("startup-executable-closure-bin-");
  const current = readCompatibilityMatrix();
  for (const [name, version] of [
    ["codex", current.ci.codexVersion],
    ["node", `v${current.stable.node.version}`],
    ["pnpm", current.stable.pnpm.version],
    ["shell", "unused"],
  ]) {
    const executable = path.join(binDirectory, name);
    writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(version)}\n`, "utf8");
    chmodSync(executable, 0o755);
  }
  const runtimeExecutables = Object.freeze({
    codex: path.join(binDirectory, "codex"),
    node: path.join(binDirectory, "node"),
    pnpm: path.join(binDirectory, "pnpm"),
    shell: path.join(binDirectory, "shell"),
  });
  issueRuntimeSessionLease({ root: fixture, pid: process.pid });
  const issued = issueStartupAttestation({
    root: fixture,
    controlPolicy: startupControlPolicies.default,
    now: Date.now,
    runtimeExecutables,
  });

  assert.equal(issued.attestation.schemaVersion, 7);
  for (const relativePath of [
    "scripts/contracts/tooling-configuration.mjs",
    "scripts/context/session-stop-lifecycle.mjs",
    "scripts/repository/source-inventory.mjs",
    "scripts/security/secret-patterns.mjs",
    "scripts/setup/session-control-hook-command.mjs",
    "scripts/setup/startup-codex-process.mjs",
    "scripts/setup/startup-runtime-executables.mjs",
    "scripts/setup/startup-session-controller.mjs",
  ]) {
    assert.ok(Object.hasOwn(issued.attestation.inputs, relativePath), relativePath);
  }
  assert.equal(Object.hasOwn(issued.attestation.inputs, "scripts/web/sitemap-files.mjs"), false);
  const attestation = path.join(fixture, ...startupAttestationPath.split("/"));
  assert.equal(statSync(attestation).mode & 0o777, 0o600);

  const hookInput = {
    cwd: fixture,
    hook_event_name: "SessionStart",
    model: "gpt-6-astra",
    permission_mode: "default",
    session_id: "01a01234-5678-7abc-8def-0123456789ab",
    source: "startup",
    transcript_path: path.join(fixture, "session.jsonl"),
  };
  bindStartupSessionWriter(fixture, process.pid, process.pid, {
    controlPolicy: startupControlPolicies.default,
    expectedAttestation: issued.attestation,
    nonce: issued.nonce,
    runtimeExecutables,
  });
  beginStartupSessionWriterHandoff(fixture, process.pid, {
    controlPolicy: startupControlPolicies.default,
    expectedAttestation: issued.attestation,
    nonce: issued.nonce,
    runtimeExecutables,
  });
  bindStartupSessionCodexProcess(fixture, process.pid, process.pid, {
    controlPolicy: startupControlPolicies.default,
    expectedAttestation: issued.attestation,
    nonce: issued.nonce,
    runtimeExecutables,
  });
  const verification = {
    controlPolicy: startupControlPolicies.default,
    expectedAttestation: issued.attestation,
    nonce: issued.nonce,
    root: fixture,
    runtimeExecutables,
  };
  const sideInput = {
    ...hookInput,
    session_id: "01a07777-5678-7abc-8def-0123456789ab",
    transcript_path: null,
  };
  assert.throws(
    () => verifyStartupAttestation({ ...verification, hookInput: sideInput }),
    /requires its active verified launcher session/u,
  );
  for (const transcriptPath of [undefined, "", 42]) {
    assert.throws(
      () =>
        verifyStartupAttestation({
          ...verification,
          hookInput: { ...hookInput, transcript_path: transcriptPath },
        }),
      /invalid transcript path/u,
    );
  }
  assert.equal(
    verifyStartupAttestation({
      controlPolicy: startupControlPolicies.default,
      hookInput,
      nonce: issued.nonce,
      root: fixture,
      runtimeExecutables,
    }).schemaVersion,
    7,
  );

  const activeLease = inspectRuntimeSessionLease({ root: fixture }).lease;
  const recovery = inspectRuntimeSessionRecovery({ root: fixture }).recovery;
  const expiredNow = () => issued.attestation.expiresAt + 1;
  verification.now = expiredNow;
  assert.throws(
    () => verifyStartupAttestation({ ...verification, hookInput }),
    /stale or has an invalid lifetime/u,
  );
  assert.equal(verifyStartupAttestation({ ...verification, hookInput: sideInput }), null);
  assert.throws(
    () =>
      verifyStartupAttestation({ ...verification, hookInput: sideInput, nonce: "A".repeat(43) }),
    /requires its active verified launcher session/u,
  );
  assert.throws(
    () =>
      verifyStartupAttestation({
        ...verification,
        hookInput: { ...sideInput, cwd: path.dirname(fixture) },
      }),
    /root differs/u,
  );
  assert.deepEqual(inspectRuntimeSessionLease({ root: fixture }).lease, activeLease);
  assert.deepEqual(inspectRuntimeSessionRecovery({ root: fixture }).recovery, recovery);

  const changedHelper = path.join(fixture, "scripts", "contracts", "tooling-configuration.mjs");
  writeFileSync(changedHelper, `${readFileSync(changedHelper, "utf8")}\n`, "utf8");
  assert.equal(verifyStartupAttestation({ ...verification, hookInput: sideInput }), null);
  assert.throws(
    () =>
      verifyStartupAttestation({
        controlPolicy: startupControlPolicies.default,
        hookInput,
        nonce: issued.nonce,
        root: fixture,
        runtimeExecutables,
      }),
    /startup-critical input changed/u,
  );
  completeStartupSessionWriterHandoff(fixture, process.pid, {
    expectedAttestation: issued.attestation,
    nonce: issued.nonce,
  });
  assert.equal(releaseRuntimeSessionLease({ root: fixture, pid: process.pid }), true);
});

test("project roles enforce exact Astra/ultra parity with the primary", () => {
  const defaultAgent = readFileSync(path.join(root, ".codex", "agents", "default.toml"), "utf8");
  const parsedDefault = parseProjectAgentConfig(defaultAgent, "default");
  assert.equal(parsedDefault.model, "gpt-6-astra");
  assert.equal(parsedDefault.model_reasoning_effort, sharedAgentIntelligencePolicy.reasoningEffort);
  assert.equal(
    parseProjectAgentConfig(
      defaultAgent.replace('model = "gpt-6-astra"', 'model = "gpt-7-astra"'),
      "default",
    ).model,
    "gpt-7-astra",
  );
  assert.throws(
    () =>
      parseProjectAgentConfig(
        defaultAgent.replace('model = "gpt-6-astra"', 'model = "gpt-5.6-luna"'),
        "default",
      ),
    /supported GPT Astra model matching the primary intelligence/,
  );
  assert.throws(
    () =>
      parseProjectAgentConfig(
        defaultAgent.replace('model_reasoning_effort = "ultra"', 'model_reasoning_effort = "high"'),
        "default",
      ),
    /model_reasoning_effort|reasoning effort/u,
  );
  assert.throws(
    () =>
      parseProjectAgentConfig(
        defaultAgent.replace('sandbox_mode = "read-only"', 'sandbox_mode = "danger-full-access"'),
        "default",
      ),
    /project agent policy for sandbox_mode/,
  );
  assert.throws(
    () =>
      parseProjectAgentConfig(
        defaultAgent.replace("manifest-led discovery", "unbounded-discovery"),
        "default",
      ),
    /orchestration marker manifest-led discovery/,
  );
  assert.throws(
    () =>
      parseProjectAgentConfig(defaultAgent.replace("matched source", "search result"), "default"),
    /orchestration marker matched source/,
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
    /orchestration marker Before every assigned slice begins/,
  );
  assert.throws(
    () =>
      parseProjectAgentConfig(
        defaultAgent.replace("newest relevant primary or official sources", "available sources"),
        "default",
      ),
    /orchestration marker newest relevant primary or official sources/,
  );

  const fixture = configFixture();
  rmSync(path.join(fixture, ".codex", "agents", "worker.toml"));
  assert.throws(
    () => validateProjectAgentConfigs(path.join(fixture, ".codex")),
    /Missing project agent roles: worker/,
  );

  const mismatchedFixture = configFixture();
  const mismatchedDefaultPath = path.join(mismatchedFixture, ".codex", "agents", "default.toml");
  writeFileSync(
    mismatchedDefaultPath,
    readFileSync(mismatchedDefaultPath, "utf8").replace(
      'model = "gpt-6-astra"',
      'model = "gpt-7-astra"',
    ),
    "utf8",
  );
  assert.throws(
    () => validateCodexConfig(mismatchedFixture),
    /Agent default must use exactly the primary intelligence gpt-6-astra with ultra reasoning/,
  );

  const futureFixture = configFixture();
  const futureConfigPath = path.join(futureFixture, ".codex", "config.toml");
  writeFileSync(
    futureConfigPath,
    readFileSync(futureConfigPath, "utf8").replaceAll(
      'model = "gpt-6-astra"',
      'model = "gpt-7-astra"',
    ),
    "utf8",
  );
  for (const role of ["default", "explorer", "worker"]) {
    const rolePath = path.join(futureFixture, ".codex", "agents", `${role}.toml`);
    writeFileSync(
      rolePath,
      readFileSync(rolePath, "utf8").replace('model = "gpt-6-astra"', 'model = "gpt-7-astra"'),
      "utf8",
    );
  }
  assert.equal(validateCodexConfig(futureFixture).model, "gpt-7-astra");
});

test("installed model catalog requires the shared future-compatible Astra/ultra intelligence", () => {
  const catalog = {
    models: [
      {
        slug: "gpt-6-astra",
        priority: 1,
        visibility: "list",
        supported_reasoning_levels: [{ effort: "xhigh" }, { effort: "max" }, { effort: "ultra" }],
      },
      {
        slug: "gpt-5.6-terra",
        priority: 2,
        visibility: "list",
        supported_reasoning_levels: [{ effort: "medium" }, { effort: "high" }],
      },
      {
        slug: "gpt-5.6-luna",
        priority: 3,
        visibility: "list",
        supported_reasoning_levels: [{ effort: "xhigh" }, { effort: "max" }, { effort: "ultra" }],
      },
      {
        slug: "gpt-7-astra",
        priority: 4,
        visibility: "list",
        supported_reasoning_levels: [{ effort: "max" }, { effort: "ultra" }],
      },
    ],
  };
  assert.equal(validateModelCatalog(catalog, "gpt-6-astra", "ultra").delegatedModel, "gpt-6-astra");
  assert.equal(validateModelCatalog(catalog, "gpt-7-astra", "ultra").primaryModel, "gpt-7-astra");
  assert.throws(
    () => validateModelCatalog(catalog, "gpt-5.6-terra", "ultra"),
    /not a supported GPT Astra model/,
  );
  assert.throws(
    () => validateModelCatalog(catalog, "gpt-6-astra", "xhigh"),
    /Primary and subagent reasoning must remain ultra/,
  );
  const primaryMissing = structuredClone(catalog);
  primaryMissing.models[0].slug = "unavailable-model";
  assert.throws(
    () => validateModelCatalog(primaryMissing, "gpt-6-astra", "ultra"),
    /Configured primary model gpt-6-astra is unavailable/,
  );
  const ultraEffortMissing = structuredClone(catalog);
  ultraEffortMissing.models[0].supported_reasoning_levels = [
    { effort: "xhigh" },
    { effort: "max" },
  ];
  assert.throws(
    () => validateModelCatalog(ultraEffortMissing, "gpt-6-astra", "ultra"),
    /configured reasoning effort ultra.*gpt-6-astra/i,
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
  const processIo = path.join(fixture, "scripts", "repository", "runtime-process-io.mjs");
  const sourceHook = path.join(fixture, "scripts", "git-hooks", "pre-push");
  copyFileSync(path.join(root, "scripts/setup/install-git-hooks.sh"), installer);
  copyFileSync(path.join(root, "scripts/setup/install-git-hooks.mjs"), installerModule);
  copyFileSync(path.join(root, "scripts/setup/resolve-git-hooks-path.mjs"), pathResolver);
  copyFileSync(path.join(root, "scripts/repository/git-runtime-isolation.mjs"), gitIsolation);
  copyFileSync(path.join(root, "scripts/repository/runtime-process-io.mjs"), processIo);
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
  copyFileSync(path.join(root, "scripts/framework/export-project.sh"), exporter);
  chmodSync(exporter, 0o755);
  const optionsTarget = path.join(fixture, "scripts/framework/project-options.mjs");
  mkdirSync(path.dirname(optionsTarget), { recursive: true });
  copyFileSync(path.join(root, "scripts/framework/project-options.mjs"), optionsTarget);
  writeFileSync(path.join(fixture, "package.json"), '{"name":"export-boundary-fixture"}\n', "utf8");
  writeFileSync(path.join(fixture, "README.md"), "source sentinel\n", "utf8");

  const sourceTarget = run("bash", [exporter, "--name", "Fixture", "--output", "README.md"], {
    cwd: fixture,
  });
  assert.notEqual(sourceTarget.status, 0);
  assert.match(sourceTarget.stderr, /dist\/exports/);
  assert.equal(readFileSync(path.join(fixture, "README.md"), "utf8"), "source sentinel\n");

  mkdirSync(path.join(fixture, "dist", "exports"), { recursive: true });
  const existing = path.join(fixture, "dist", "exports", "existing.tar.gz");
  writeFileSync(existing, "archive sentinel\n", "utf8");
  const existingTarget = run(
    "bash",
    [exporter, "--name", "Fixture", "--output", "dist/exports/existing.tar.gz"],
    {
      cwd: fixture,
    },
  );
  assert.notEqual(existingTarget.status, 0);
  assert.match(existingTarget.stderr, /already exists/);
  assert.equal(readFileSync(existing, "utf8"), "archive sentinel\n");
});
