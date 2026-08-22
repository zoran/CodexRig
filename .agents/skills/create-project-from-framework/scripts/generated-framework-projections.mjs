/** Owns concise generated agent and README projections for the clean-project boundary. */
import { generatedPolicyProjectionLines } from "../../../../scripts/framework/policy-projection.mjs";

export const generatedFrameworkAgentPolicy = Object.freeze(
  generatedPolicyProjectionLines("agents"),
);

export const generatedFrameworkReadmePolicy = Object.freeze([
  "## First Prompt: Define The Project",
  "",
  "The generator invites a detailed project description and stores it only as an intake draft.",
  "At first start, Codex explains the interview, evaluates any existing draft or filled manifest,",
  "shows material strengths, gaps, and contradictions, and asks whether to refine it further or—if",
  "the definition is decision-ready—begin from the confirmed scope. The manifest can be refined as",
  "the product evolves; Codex actively helps structure and challenge it rather than expecting a",
  "finished specification from the user.",
  "Resume the intake whenever a material product, scope, contract, trust, or delivery decision changes.",
  "",
  "## Framework Capability Map",
  "",
  "These concise projections keep every installed capability visible; `instructions.md` owns the complete versioned policy and rationale.",
  "",
  ...generatedPolicyProjectionLines("readme"),
  "",
  "## Documentation Context Economy",
  "",
  "`AGENTS.md` remains the bounded always-loaded bootstrap; complete policy stays visible in `instructions.md`, and skills load progressively when relevant.",
]);
