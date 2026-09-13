/** Owns validate codex config behavior for the setup, launch, and portable project boundary. */
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parsePortableToml } from "../contracts/portable-toml.mjs";
import { formatContextError } from "../terminal/terminal-output.mjs";
import {
  repositoryCodexHomeGitignoreBehaviorFindings,
  repositoryCodexHomeGitignoreFindings,
} from "../repository/source-inventory.mjs";
import {
  closeOwnedDirectoryBinding,
  openOwnedDirectoryBinding,
  ownedDirectoryChildPath,
  readStableOwnedFile,
} from "../filesystem/owned-path-safety.mjs";
import {
  sessionControlHookConfigArguments,
  sessionControlHookExpectations,
  sessionControlHookPolicies,
} from "./session-control-hook-command.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDirectory, "..", "..");

export const sharedAgentIntelligencePolicy = Object.freeze({
  modelPattern: /^gpt-[a-z0-9]+(?:[.-][a-z0-9]+)*-astra$/u,
  reasoningEffort: "ultra",
});

export const startupAttestationHookPolicy = Object.freeze({
  additionalContextLimit: sessionControlHookPolicies.sessionStart.additionalContextLimit,
  matcher: sessionControlHookPolicies.sessionStart.matcher,
});

const portablePolicy = new Map([
  ["developer_instructions", { type: "string" }],
  ["project_doc_max_bytes", { type: "integer", value: 32_768 }],
  ["project_doc_fallback_filenames", { type: "string-array", value: ["instructions.md"] }],
  [
    "model_reasoning_effort",
    { type: "string", value: sharedAgentIntelligencePolicy.reasoningEffort },
  ],
  ["model_verbosity", { type: "string" }],
  ["web_search", { type: "string", value: "cached" }],
  ["model", { type: "string", pattern: sharedAgentIntelligencePolicy.modelPattern }],
  ["service_tier", { type: "string", optional: true }],
  ["approvals_reviewer", { type: "string", value: "user" }],
  ["approval_policy", { type: "string", value: "on-request" }],
  ["sandbox_mode", { type: "string", value: "workspace-write" }],
  ["sandbox_workspace_write.network_access", { type: "boolean", value: false }],
  ["agents.enabled", { type: "boolean", value: true }],
  [
    "agents.default_subagent_model",
    { type: "string", pattern: sharedAgentIntelligencePolicy.modelPattern },
  ],
  [
    "agents.default_subagent_reasoning_effort",
    { type: "string", value: sharedAgentIntelligencePolicy.reasoningEffort },
  ],
  ["agents.max_concurrent_threads_per_session", { type: "integer", value: 4 }],
  ["agents.interrupt_message", { type: "boolean", value: true }],
  ["features.goals", { type: "boolean", value: true }],
  ["features.hooks", { type: "boolean", value: true }],
  ["features.memories", { type: "boolean" }],
  ["features.network_proxy", { type: "boolean" }],
  ["features.prevent_idle_sleep", { type: "boolean" }],
  [
    "tui.status_line",
    {
      type: "string-array",
    },
  ],
  ["tui.status_line_use_colors", { type: "boolean" }],
  [
    "tui.terminal_title",
    {
      type: "string-array",
    },
  ],
  ["tui.theme", { type: "string" }],
]);
const portableTables = new Set(["agents", "features", "sandbox_workspace_write", "tui"]);
// Codex may persist model-picker choices in its user-level CODEX_HOME. They are bounded metadata
// here because canonical launch explicitly projects the tracked project model and effort.
const runtimeModelPreferencePattern = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const runtimeReasoningPreferencePattern = /^[a-z][a-z0-9_-]{0,63}$/u;
const requiredAgentRoles = new Set(["default", "explorer", "worker"]);
const requiredAgentInstructionFragments = Object.freeze([
  "manifest-led discovery",
  "matched source",
  "whole-repository course check",
  "milestone",
  "fresh audit",
  "Before every assigned slice begins",
  "wait only for the primary to close the agent",
  "5% or less",
  "without assuming a billing period",
  "absolute token/credit amount",
  "Mirror every direct peer message and response to the primary",
  "unavailable redeem/reset capacity counts as zero",
  "newest relevant primary or official sources",
  "critical-drain request",
  "start no further tool or task",
  "effective runtime sandbox",
  "live parent override",
]);
const requiredPrimaryInstructionFragments = Object.freeze([
  "primary orchestrator",
  "exactly one current internal contract",
  "at most four live",
  "never pass a model or reasoning override",
  "exact GPT Astra model with ultra reasoning",
  "owned subagent and background task",
  "foreign or ambiguous processes",
  "5% or less",
  "Critical Budget Drain",
  "pnpm handover:create -- --critical",
  "final repository action",
  "After a successful seal, stop completely",
  "permit automatic continuation",
  "effective runtime permissions",
  "live parent permission overrides",
  "already-authorized YOLO override",
  "exact disjoint repository write set",
  "after every completed slice",
  "pnpm worktree:status -- --json",
  "preservation is a safety state, never completion",
]);
const projectHooksDescription =
  "Declare that canonical lifecycle hooks are injected only by the issue-time session controller; no mutable project-file hook may execute.";
/** Identifies a rejected Codex configuration contract without exposing runtime-local state. */
export class CodexConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "CodexConfigError";
  }
}

function parsedToml(content, label) {
  try {
    const parsed = parsePortableToml(String(content));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("root");
    return parsed;
  } catch (error) {
    throw new CodexConfigError(`${label} must contain valid TOML.`);
  }
}

function flattenedToml(parsed, tableNames, label) {
  const flattened = new Map();
  for (const [key, value] of Object.entries(parsed)) {
    if (!tableNames.has(key)) {
      flattened.set(key, value);
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Date) {
      throw new CodexConfigError(`${label} table ${key} must be a TOML table.`);
    }
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      if (
        nestedValue &&
        typeof nestedValue === "object" &&
        !Array.isArray(nestedValue) &&
        !(nestedValue instanceof Date)
      ) {
        throw new CodexConfigError(
          `${label} contains unsupported nested table ${key}.${nestedKey}.`,
        );
      }
      flattened.set(`${key}.${nestedKey}`, nestedValue);
    }
  }
  return flattened;
}

function valuesMatch(actual, expected) {
  if (expected === undefined) {
    if (typeof actual === "string") return actual.trim().length > 0;
    if (Array.isArray(actual)) {
      return actual.length > 0 && actual.every((value) => value.trim().length > 0);
    }
    return true;
  }
  if (!Array.isArray(expected)) return actual === expected;
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function valueMatchesSchema(actual, schema) {
  const typeMatches =
    (schema.type === "boolean" && typeof actual === "boolean") ||
    (schema.type === "integer" && Number.isSafeInteger(actual) && actual >= 0) ||
    (schema.type === "string" && typeof actual === "string" && actual.trim().length > 0) ||
    (schema.type === "string-array" &&
      Array.isArray(actual) &&
      actual.every((entry) => typeof entry === "string"));
  return (
    typeMatches &&
    valuesMatch(actual, schema.value) &&
    (!schema.values || schema.values.includes(actual)) &&
    (!schema.pattern || (typeof actual === "string" && schema.pattern.test(actual)))
  );
}

export function parsePortableCodexConfig(content) {
  const parsed = flattenedToml(
    parsedToml(content, "Project-scoped Codex config"),
    portableTables,
    "Project-scoped Codex config",
  );
  for (const [key, value] of parsed) {
    const schema = portablePolicy.get(key);
    if (!schema) throw new CodexConfigError(`Project-scoped Codex config uses unknown key ${key}.`);
    if (!valueMatchesSchema(value, schema)) {
      throw new CodexConfigError(
        `Project-scoped Codex config gives ${key} a value outside the portable project policy.`,
      );
    }
  }

  const missing = [...portablePolicy.entries()]
    .filter(([, schema]) => !schema.optional)
    .map(([key]) => key)
    .filter((key) => !parsed.has(key));
  if (missing.length > 0) {
    throw new CodexConfigError(`Missing portable project policy keys: ${missing.join(", ")}.`);
  }
  const policy = Object.fromEntries(parsed);
  if (
    policy["agents.default_subagent_model"] !== policy.model ||
    policy["agents.default_subagent_reasoning_effort"] !== policy.model_reasoning_effort
  ) {
    throw new CodexConfigError(
      "Project agent defaults must use exactly the primary model and reasoning effort.",
    );
  }
  const primaryInstructions = policy.developer_instructions.replace(/\s+/gu, " ");
  for (const fragment of requiredPrimaryInstructionFragments) {
    if (
      !primaryInstructions.toLocaleLowerCase("en-US").includes(fragment.toLocaleLowerCase("en-US"))
    ) {
      throw new CodexConfigError(
        `Primary developer_instructions must include orchestration marker ${fragment}.`,
      );
    }
  }
  return policy;
}

function requireRuntimeTable(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Date) {
    throw new CodexConfigError(`Repository-local Codex runtime ${label} must be a TOML table.`);
  }
  return value;
}

function requireRuntimeKeys(value, expected, label) {
  const actual = Object.keys(requireRuntimeTable(value, label)).sort();
  const allowed = [...expected].sort();
  if (actual.some((key) => !allowed.includes(key))) {
    throw new CodexConfigError(
      `Repository-local Codex runtime ${label} contains an executable or unsupported key.`,
    );
  }
}

function validateRuntimeConfigDocument(value, root) {
  requireRuntimeKeys(
    value,
    [
      "approvals_reviewer",
      "hooks",
      "model",
      "model_reasoning_effort",
      "notice",
      "projects",
      "service_tier",
      "tui",
    ],
    "config",
  );
  if (value.approvals_reviewer !== undefined && value.approvals_reviewer !== "user") {
    throw new CodexConfigError("Repository-local Codex runtime approval routing is unsupported.");
  }
  if (
    value.service_tier !== undefined &&
    (typeof value.service_tier !== "string" || value.service_tier.length > 64)
  ) {
    throw new CodexConfigError("Repository-local Codex runtime service tier is invalid.");
  }
  if (
    value.model !== undefined &&
    (typeof value.model !== "string" || !runtimeModelPreferencePattern.test(value.model))
  ) {
    throw new CodexConfigError("Repository-local Codex runtime model preference is invalid.");
  }
  if (
    value.model_reasoning_effort !== undefined &&
    (typeof value.model_reasoning_effort !== "string" ||
      !runtimeReasoningPreferencePattern.test(value.model_reasoning_effort))
  ) {
    throw new CodexConfigError("Repository-local Codex runtime reasoning preference is invalid.");
  }
  if (value.projects !== undefined) {
    requireRuntimeKeys(value.projects, [root], "project trust");
    for (const project of Object.values(value.projects)) {
      requireRuntimeKeys(project, ["trust_level"], "project trust entry");
      if (project.trust_level !== "trusted") {
        throw new CodexConfigError("Repository-local Codex runtime project trust is invalid.");
      }
    }
  }
  if (value.hooks !== undefined) {
    requireRuntimeKeys(value.hooks, ["state"], "hook state");
    const state = requireRuntimeTable(value.hooks.state, "hook state entries");
    for (const entry of Object.values(state)) {
      requireRuntimeKeys(entry, ["enabled", "trusted_hash"], "hook state entry");
      if (
        !/^sha256:[a-f0-9]{64}$/u.test(entry.trusted_hash ?? "") ||
        (entry.enabled !== undefined && typeof entry.enabled !== "boolean")
      ) {
        throw new CodexConfigError("Repository-local Codex runtime hook state is invalid.");
      }
    }
  }
  if (value.notice !== undefined) {
    const notice = requireRuntimeTable(value.notice, "notice state");
    if (
      Object.keys(notice).some((key) => !/^[a-z][a-z0-9_]{0,127}$/u.test(key)) ||
      Object.values(notice).some((entry) => typeof entry !== "boolean")
    ) {
      throw new CodexConfigError("Repository-local Codex runtime notice state is invalid.");
    }
  }
  if (value.tui !== undefined) {
    for (const [key, entry] of Object.entries(
      requireRuntimeTable(value.tui, "terminal preferences"),
    )) {
      if (key === "model_availability_nux") {
        const state = requireRuntimeTable(entry, "model tooltip state");
        if (
          Object.entries(state).some(
            ([model, count]) =>
              !runtimeModelPreferencePattern.test(model) ||
              !Number.isSafeInteger(count) ||
              count < 0,
          )
        ) {
          throw new CodexConfigError(
            "Repository-local Codex runtime model tooltip state is invalid.",
          );
        }
        continue;
      }
      const schema = portablePolicy.get(`tui.${key}`);
      if (!schema || !valueMatchesSchema(entry, schema)) {
        throw new CodexConfigError(
          "Repository-local Codex runtime terminal preference is unsupported.",
        );
      }
    }
  }
}

/** Rejects executable user-runtime configuration before any Codex process can consume it. */
export function validateRuntimeCodexConfig(projectRoot = defaultRoot) {
  const root = realpathSync(path.resolve(projectRoot));
  const binding = openOwnedDirectoryBinding(root, root, "Codex runtime home");
  try {
    const basename = "config.toml";
    const target = ownedDirectoryChildPath(binding, basename, "Codex runtime config");
    if (!existsSync(target)) return Object.freeze({ status: "absent" });
    const snapshot = readStableOwnedFile(binding, basename, "Codex runtime config", {
      maximumBytes: 262_144,
    });
    if (
      (snapshot.stats.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && snapshot.stats.uid !== process.getuid())
    ) {
      throw new CodexConfigError("Repository-local Codex runtime config must remain private.");
    }
    validateRuntimeConfigDocument(
      parsedToml(snapshot.buffer.toString("utf8"), "Repository-local Codex runtime config"),
      root,
    );
    return Object.freeze({ status: "present" });
  } finally {
    closeOwnedDirectoryBinding(binding);
  }
}

function requireRegularFile(targetPath, label) {
  let stats;
  try {
    stats = lstatSync(targetPath);
  } catch {
    throw new CodexConfigError(`Missing ${label}.`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new CodexConfigError(`${label} must be a non-symlink regular file.`);
  }
}

function requireExactObjectKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CodexConfigError(`${label} must be a JSON object.`);
  }
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpected.length ||
    actualKeys.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new CodexConfigError(
      `${label} must contain exactly these keys: ${sortedExpected.join(", ")}.`,
    );
  }
}

export function parseProjectHooks(content) {
  let parsed;
  try {
    parsed = JSON.parse(String(content));
  } catch {
    throw new CodexConfigError("Project-scoped Codex hooks must contain valid JSON.");
  }

  requireExactObjectKeys(parsed, ["description", "hooks"], "Project-scoped Codex hooks");
  if (parsed.description !== projectHooksDescription) {
    throw new CodexConfigError(
      "Project-scoped Codex hooks must keep the exact portable description.",
    );
  }
  if (
    !parsed.hooks ||
    typeof parsed.hooks !== "object" ||
    Array.isArray(parsed.hooks) ||
    Object.keys(parsed.hooks).length !== 0
  ) {
    throw new CodexConfigError(
      "Project-scoped Codex hook events must remain empty; the issue-time controller injects the canonical hooks.",
    );
  }
  const argumentsList = sessionControlHookConfigArguments();
  const expectations = sessionControlHookExpectations();
  if (argumentsList.length !== 6 || expectations.length !== 2) {
    throw new CodexConfigError(
      "Issue-time session controller must own exactly two trusted lifecycle hook declarations.",
    );
  }
  return parsed;
}

export function parseProjectAgentConfig(content, expectedName) {
  const worker = expectedName === "worker";
  const schemas = new Map([
    ["name", { type: "string", value: expectedName }],
    ["description", { type: "string" }],
    ["model", { type: "string", pattern: sharedAgentIntelligencePolicy.modelPattern }],
    [
      "model_reasoning_effort",
      { type: "string", value: sharedAgentIntelligencePolicy.reasoningEffort },
    ],
    ["sandbox_mode", { type: "string", value: worker ? "workspace-write" : "read-only" }],
    ["developer_instructions", { type: "string" }],
    ...(worker
      ? [["sandbox_workspace_write.network_access", { type: "boolean", value: false }]]
      : []),
  ]);
  const parsed = flattenedToml(
    parsedToml(content, `Agent ${expectedName}`),
    new Set(worker ? ["sandbox_workspace_write"] : []),
    `Agent ${expectedName}`,
  );
  for (const [key, value] of parsed) {
    const schema = schemas.get(key);
    if (!schema) {
      throw new CodexConfigError(`Agent ${expectedName} uses unsupported key ${key}.`);
    }
    if (!valueMatchesSchema(value, schema)) {
      if (key === "model") {
        throw new CodexConfigError(
          `Agent ${expectedName} must use a supported GPT Astra model matching the primary intelligence.`,
        );
      }
      throw new CodexConfigError(
        `Agent ${expectedName} violates the portable project agent policy for ${key}.`,
      );
    }
  }
  const missing = [...schemas.entries()]
    .filter(([, schema]) => !schema.optional)
    .map(([key]) => key)
    .filter((key) => !parsed.has(key));
  if (missing.length > 0) {
    throw new CodexConfigError(`Agent ${expectedName} is missing keys: ${missing.join(", ")}.`);
  }
  const developerInstructions = parsed.get("developer_instructions");
  const normalizedInstructions = developerInstructions.replace(/\s+/gu, " ");
  for (const fragment of [
    ...requiredAgentInstructionFragments,
    "Never delegate or spawn another agent",
    "token envelope",
    "Never",
    "commit",
    ...(worker
      ? ["already-authorized YOLO/danger-full-access override", "strict logical isolation boundary"]
      : []),
  ]) {
    if (
      !normalizedInstructions
        .toLocaleLowerCase("en-US")
        .includes(fragment.toLocaleLowerCase("en-US"))
    ) {
      throw new CodexConfigError(
        `Agent ${expectedName} developer_instructions must include orchestration marker ${fragment}.`,
      );
    }
  }
  return Object.fromEntries(parsed);
}

export function validateProjectAgentConfigs(
  codexDirectory,
  { expectedModel, expectedReasoningEffort } = {},
) {
  if ((expectedModel === undefined) !== (expectedReasoningEffort === undefined)) {
    throw new CodexConfigError(
      "Primary model and reasoning effort must be supplied together for agent parity validation.",
    );
  }
  const agentsDirectory = path.join(codexDirectory, "agents");
  let stats;
  try {
    stats = lstatSync(agentsDirectory);
  } catch {
    throw new CodexConfigError("Missing project-scoped Codex agents directory.");
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new CodexConfigError("Project-scoped Codex agents path must be a non-symlink directory.");
  }
  const entries = readdirSync(agentsDirectory, { withFileTypes: true });
  const names = new Set();
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isFile() || !/^[a-z][a-z0-9_-]*\.toml$/.test(entry.name)) {
      throw new CodexConfigError(`Unsupported project agent entry: .codex/agents/${entry.name}.`);
    }
    const name = entry.name.slice(0, -".toml".length);
    names.add(name);
    const agentPath = path.join(agentsDirectory, entry.name);
    requireRegularFile(agentPath, `project agent ${name}`);
    const parsedAgent = parseProjectAgentConfig(readFileSync(agentPath, "utf8"), name);
    if (
      expectedModel !== undefined &&
      (parsedAgent.model !== expectedModel ||
        parsedAgent.model_reasoning_effort !== expectedReasoningEffort)
    ) {
      throw new CodexConfigError(
        `Agent ${name} must use exactly the primary intelligence ${expectedModel} with ${expectedReasoningEffort} reasoning.`,
      );
    }
  }
  const missing = [...requiredAgentRoles].filter((name) => !names.has(name));
  if (missing.length > 0) {
    throw new CodexConfigError(`Missing project agent roles: ${missing.join(", ")}.`);
  }
  return [...names].sort();
}

export function validateCodexConfig(projectRoot = defaultRoot) {
  const root = path.resolve(projectRoot);
  const codexDirectory = path.join(root, ".codex");
  const configPath = path.join(codexDirectory, "config.toml");
  const hooksPath = path.join(codexDirectory, "hooks.json");
  const gitignorePath = path.join(root, ".gitignore");
  const stopLifecyclePath = path.join(root, "scripts", "context", "session-stop-lifecycle.mjs");
  const startupAttestationPath = path.join(root, "scripts", "setup", "startup-attestation.mjs");
  const sessionControlHookCommandPath = path.join(
    root,
    "scripts",
    "setup",
    "session-control-hook-command.mjs",
  );
  const startupSessionControllerPath = path.join(
    root,
    "scripts",
    "setup",
    "startup-session-controller.mjs",
  );
  let directoryStats;
  try {
    directoryStats = lstatSync(codexDirectory);
  } catch {
    throw new CodexConfigError("Missing project .codex directory.");
  }
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new CodexConfigError("Project .codex path must be a non-symlink directory.");
  }
  requireRegularFile(configPath, "project-scoped Codex config");
  requireRegularFile(hooksPath, "project-scoped Codex hooks");
  requireRegularFile(gitignorePath, "root-bound Codex runtime ignore policy");
  requireRegularFile(stopLifecyclePath, "preloaded Stop lifecycle");
  requireRegularFile(startupAttestationPath, "startup attestation verifier");
  requireRegularFile(sessionControlHookCommandPath, "session-control hook command owner");
  requireRegularFile(startupSessionControllerPath, "startup session controller");
  if (path.dirname(realpathSync(configPath)) !== realpathSync(codexDirectory)) {
    throw new CodexConfigError(
      "Project-scoped Codex config must remain directly under .codex/config.toml.",
    );
  }
  if (path.dirname(realpathSync(hooksPath)) !== realpathSync(codexDirectory)) {
    throw new CodexConfigError(
      "Project-scoped Codex hooks must remain directly under .codex/hooks.json.",
    );
  }
  parseProjectHooks(readFileSync(hooksPath, "utf8"));
  const ignoreFindings = [
    ...repositoryCodexHomeGitignoreFindings(readFileSync(gitignorePath, "utf8")),
    ...repositoryCodexHomeGitignoreBehaviorFindings({ root }),
  ];
  if (ignoreFindings.length > 0) {
    throw new CodexConfigError(
      ["Repository-local CODEX_HOME isolation is incomplete:", ...ignoreFindings].join("\n"),
    );
  }
  const policy = parsePortableCodexConfig(readFileSync(configPath, "utf8"));
  validateProjectAgentConfigs(codexDirectory, {
    expectedModel: policy.model,
    expectedReasoningEffort: policy.model_reasoning_effort,
  });
  return policy;
}

export function codexConfigOverrideArguments(policy) {
  const argumentsList = [];
  for (const [key, schema] of portablePolicy) {
    if (!Object.prototype.hasOwnProperty.call(policy, key)) {
      if (schema.optional) continue;
      throw new CodexConfigError(`Cannot render missing portable policy key ${key}.`);
    }
    argumentsList.push("-c", `${key}=${JSON.stringify(policy[key])}`);
  }
  return argumentsList;
}

function main() {
  try {
    const policy = validateCodexConfig();
    if (process.argv.includes("--print-cli-overrides")) {
      process.stdout.write(`${codexConfigOverrideArguments(policy).join("\n")}\n`);
      return;
    }
    console.log("Project-scoped Codex config and hooks match the strict portable project policy.");
    console.log("Repository-local CODEX_HOME isolation matches the portable project policy.");
  } catch (error) {
    console.error(formatContextError(error, defaultRoot));
    process.exit(1);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main();
