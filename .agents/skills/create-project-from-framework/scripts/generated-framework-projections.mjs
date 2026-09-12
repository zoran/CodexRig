/** Owns concise generated agent and README projections for the clean-project boundary. */
import { generatedPolicyProjectionLines } from "../../../../scripts/framework/policy-projection.mjs";

export const generatedFrameworkAgentPolicy = Object.freeze(
  generatedPolicyProjectionLines("agents"),
);

export const generatedFrameworkReadmePolicy = Object.freeze([
  "## First Prompt: Define The Project",
  "",
  "Give Codex a detailed project description or point it to the existing requirements owner.",
  "Follow [Project Definition Intake](instructions.md#first-prompt-project-definition-intake).",
  "",
  "## Documentation",
  "",
  ...generatedPolicyProjectionLines("readme"),
  "",
  "## Documentation Context Economy",
  "",
  "See [Documentation Ownership](instructions.md#documentation-ownership) for content routing and maintaining links as documents are added, moved or retired.",
]);
