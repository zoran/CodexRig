/** Owns validate codex config behavior for the setup, launch, and portable project boundary. */
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parsePortableTomlBootstrap } from "../contracts/portable-toml-bootstrap.mjs";
import { formatContextError } from "../terminal/terminal-output.mjs";
import {
  repositoryCodexHomeGitignoreBehaviorFindings,
  repositoryCodexHomeGitignoreFindings,
} from "../repository/source-inventory.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDirectory, "..", "..");

let parseToml = parsePortableTomlBootstrap;
try {
  ({ parse: parseToml } = await import("smol-toml"));
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND" || !String(error.message).includes("smol-toml")) {
    throw error;
  }
}

export const sharedAgentIntelligencePolicy = Object.freeze({
  modelPattern: /^gpt-[a-z0-9]+(?:[.-][a-z0-9]+)*-sol$/u,
  reasoningEffort: "ultra",
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
const requiredAgentRoles = new Set(["default", "explorer", "worker"]);
const requiredAgentInstructionFragments = Object.freeze([
  "context:search",
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
  "at most four live",
  "never pass a model or reasoning override",
  "exact GPT Sol model with ultra reasoning",
  "owned subagent and background task",
  "foreign or ambiguous work",
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
]);
const contextIndexStopHookPolicy = Object.freeze({
  description: "Coordinate durable Stop continuation, terminal handover, and context refresh.",
  command: "bash scripts/context/refresh-context-index-on-stop.sh",
  timeout: 600,
  statusMessage: "Finalizing CodexRig Stop lifecycle",
});
const startupAttestationHookPolicy = Object.freeze({
  additionalContextLimit: 768,
  command: "bash scripts/setup/verify-startup-attestation-on-session-start.sh",
  matcher: "^(startup|resume)$",
  statusMessage: "Verifying CodexRig startup",
  timeout: 30,
});
const projectHooksDescription =
  "Verify canonical startup, announce safe recovery metadata, and coordinate durable Stop continuation, terminal handover, and context refresh.";
/** Identifies a rejected Codex configuration contract without exposing runtime-local state. */
export class CodexConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "CodexConfigError";
  }
}

function parsedToml(content, label) {
  try {
    const parsed = parseToml(String(content).replace(/^\uFEFF/u, ""));
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
  requireExactObjectKeys(
    parsed.hooks,
    ["SessionStart", "Stop"],
    "Project-scoped Codex hook events",
  );
  if (!Array.isArray(parsed.hooks.SessionStart) || parsed.hooks.SessionStart.length !== 1) {
    throw new CodexConfigError(
      "Project-scoped Codex hooks must declare exactly one SessionStart group.",
    );
  }
  const startupGroup = parsed.hooks.SessionStart[0];
  requireExactObjectKeys(
    startupGroup,
    ["hooks", "matcher"],
    "Project-scoped Codex SessionStart group",
  );
  if (
    startupGroup.matcher !== startupAttestationHookPolicy.matcher ||
    !Array.isArray(startupGroup.hooks) ||
    startupGroup.hooks.length !== 1
  ) {
    throw new CodexConfigError(
      "Project-scoped Codex SessionStart group violates the startup attestation policy.",
    );
  }
  const startupHandler = startupGroup.hooks[0];
  requireExactObjectKeys(
    startupHandler,
    ["additionalContextLimit", "command", "statusMessage", "timeout", "type"],
    "Project-scoped Codex SessionStart handler",
  );
  if (
    startupHandler.type !== "command" ||
    startupHandler.command !== startupAttestationHookPolicy.command ||
    startupHandler.timeout !== startupAttestationHookPolicy.timeout ||
    startupHandler.statusMessage !== startupAttestationHookPolicy.statusMessage ||
    startupHandler.additionalContextLimit !== startupAttestationHookPolicy.additionalContextLimit
  ) {
    throw new CodexConfigError(
      "Project-scoped Codex SessionStart handler violates the exact startup attestation policy.",
    );
  }
  if (!Array.isArray(parsed.hooks.Stop) || parsed.hooks.Stop.length !== 1) {
    throw new CodexConfigError("Project-scoped Codex hooks must declare exactly one Stop group.");
  }

  const group = parsed.hooks.Stop[0];
  requireExactObjectKeys(group, ["hooks"], "Project-scoped Codex Stop group");
  if (!Array.isArray(group.hooks) || group.hooks.length !== 1) {
    throw new CodexConfigError("Project-scoped Codex Stop group must declare exactly one handler.");
  }

  const handler = group.hooks[0];
  requireExactObjectKeys(
    handler,
    ["command", "statusMessage", "timeout", "type"],
    "Project-scoped Codex Stop handler",
  );
  if (
    handler.type !== "command" ||
    handler.command !== contextIndexStopHookPolicy.command ||
    handler.timeout !== contextIndexStopHookPolicy.timeout ||
    handler.statusMessage !== contextIndexStopHookPolicy.statusMessage
  ) {
    throw new CodexConfigError(
      "Project-scoped Codex Stop handler violates the exact automatic context-index policy.",
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
          `Agent ${expectedName} must use a supported GPT Sol model matching the primary intelligence.`,
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
  const hookLauncherPath = path.join(
    root,
    "scripts",
    "context",
    "refresh-context-index-on-stop.sh",
  );
  const hookScriptPath = path.join(root, "scripts", "context", "refresh-context-index-on-stop.mjs");
  const startupAttestationPath = path.join(root, "scripts", "setup", "startup-attestation.mjs");
  const startupHookLauncherPath = path.join(
    root,
    "scripts",
    "setup",
    "verify-startup-attestation-on-session-start.sh",
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
  requireRegularFile(hookLauncherPath, "automatic context-index Stop hook launcher");
  requireRegularFile(hookScriptPath, "automatic context-index Stop hook script");
  requireRegularFile(startupAttestationPath, "startup attestation verifier");
  requireRegularFile(startupHookLauncherPath, "SessionStart hook launcher");
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
  const sourceCreationSkillPath = path.join(
    root,
    ".agents",
    "skills",
    "create-project-from-framework",
    "SKILL.md",
  );
  const isReusableFrameworkSource = existsSync(sourceCreationSkillPath);
  if (isReusableFrameworkSource) {
    requireRegularFile(sourceCreationSkillPath, "reusable-framework project-creation skill");
  }
  const expectedMemories = !isReusableFrameworkSource;
  if (policy["features.memories"] !== expectedMemories) {
    throw new CodexConfigError(
      isReusableFrameworkSource
        ? "Reusable framework source must disable local Codex memories so project work leaves no historical memory residue."
        : "Generated projects must enable local Codex memories only inside their isolated repository-local CODEX_HOME.",
    );
  }
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
