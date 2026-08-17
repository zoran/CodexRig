/** Owns validate codex model policy behavior for the setup, launch, and portable project boundary. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sharedAgentIntelligencePolicy, validateCodexConfig } from "./validate-codex-config.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDirectory, "..", "..");

export function validateModelCatalog(catalog, primaryModel, primaryReasoningEffort) {
  if (!catalog || !Array.isArray(catalog.models)) {
    throw new Error("Codex model catalog is missing its models array.");
  }
  if (!sharedAgentIntelligencePolicy.modelPattern.test(primaryModel)) {
    throw new Error(`Configured primary model ${primaryModel} is not a supported GPT Sol model.`);
  }
  if (primaryReasoningEffort !== sharedAgentIntelligencePolicy.reasoningEffort) {
    throw new Error(
      `Primary and subagent reasoning must remain ${sharedAgentIntelligencePolicy.reasoningEffort}; got ${primaryReasoningEffort}.`,
    );
  }
  const ranked = catalog.models
    .filter(
      (model) =>
        model?.visibility === "list" &&
        model.slug !== "codex-auto-review" &&
        Number.isFinite(model.priority),
    )
    .sort((left, right) => left.priority - right.priority);
  if (ranked.length < 1) throw new Error("Codex model catalog has no ranked models.");
  const primaryTier = ranked.find((model) => model.slug === primaryModel);
  if (!primaryTier) {
    throw new Error(`Configured primary model ${primaryModel} is unavailable.`);
  }
  if (
    !(primaryTier.supported_reasoning_levels ?? []).some(
      (entry) => entry?.effort === primaryReasoningEffort,
    )
  ) {
    throw new Error(
      `Configured reasoning effort ${primaryReasoningEffort} is not supported by primary model ${primaryModel}.`,
    );
  }
  return {
    primaryModel,
    primaryReasoningEffort,
    delegatedModel: primaryModel,
    delegatedReasoningEffort: primaryReasoningEffort,
  };
}

export function validateInstalledCodexModelPolicy(projectRoot = defaultRoot) {
  const policy = validateCodexConfig(projectRoot);
  const result = spawnSync("codex", ["debug", "models", "--bundled"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
    input: "",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr.trim() || `status ${result.status}`;
    throw new Error(`Unable to inspect the installed Codex model catalog: ${detail}`);
  }
  let catalog;
  try {
    catalog = JSON.parse(result.stdout);
  } catch {
    throw new Error("Installed Codex model catalog is not valid JSON.");
  }
  return validateModelCatalog(catalog, policy.model, policy.model_reasoning_effort);
}

function main() {
  try {
    const result = validateInstalledCodexModelPolicy();
    console.log(
      `Codex model policy passed (primary and subagents: ${result.primaryModel}; reasoning: ${result.primaryReasoningEffort}).`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
