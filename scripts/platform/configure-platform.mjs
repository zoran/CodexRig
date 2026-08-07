#!/usr/bin/env node
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  readFrameworkContract,
  validateFrameworkContract,
} from "../framework/framework-contract.mjs";
import { detectGitProvider, platformRoot } from "./git-provider.mjs";
import { applyGithubPlatform, githubRulesetPayload } from "./github-platform.mjs";
import { applyGitlabPlatform } from "./gitlab-platform.mjs";
import { providerApiBase } from "./platform-api.mjs";
import { platformConfigurationState } from "./platform-configuration-state.mjs";

export { githubRulesetPayload };

function repositoryIdentity(detected) {
  const segments = detected.slug.split("/");
  if (
    segments.length < 2 ||
    (detected.provider === "github" && segments.length !== 2) ||
    segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(segment))
  ) {
    throw new Error("Detected Git platform repository identity is invalid.");
  }
  return detected.slug;
}

export function platformConfigurationPlan({ contract, detected }) {
  if (!detected.provider || !detected.slug || !detected.hostname) {
    throw new Error(
      "A configured GitHub or GitLab remote is required before platform configuration.",
    );
  }
  if (
    !["github", "gitlab"].includes(detected.provider) ||
    !contract.platform.hosts[detected.provider].includes(detected.hostname)
  ) {
    throw new Error("Detected Git platform host is not owned by that provider in the contract.");
  }
  const serialization = contract.platform.protection.mergeSerialization;
  const serializationOperation =
    serialization === "disabled"
      ? []
      : [
          detected.provider === "github"
            ? `${serialization} merge queue`
            : `${serialization} merged-results pipeline and merge train`,
        ];
  return {
    apiBaseUrl: providerApiBase(contract, detected.provider, detected.hostname),
    integrationBranch: contract.platform.integrationBranch,
    mergeSerialization: serialization,
    operations:
      detected.provider === "github"
        ? [
            "reconcile repository ruleset",
            "require pull request review and resolved discussions",
            "require CI",
            ...serializationOperation,
            "read back effective policy",
          ]
        : [
            "reconcile integration-branch protection",
            "reconcile merge request approval policy and rule",
            "require CI and resolved discussions",
            ...serializationOperation,
            "read back effective policy",
          ],
    provider: detected.provider,
    repository: repositoryIdentity(detected),
    reviewPolicy: {
      preventApprovalRuleOverrides: contract.platform.protection.preventApprovalRuleOverrides,
      preventAuthorApproval: contract.platform.protection.preventAuthorApproval,
      preventCommitterApproval: contract.platform.protection.preventCommitterApproval,
      requireCodeOwnerReview: contract.platform.protection.requireCodeOwnerReview,
      requiredApprovals: contract.platform.protection.requiredApprovals,
      resetApprovalsOnPush: contract.platform.protection.resetApprovalsOnPush,
    },
    requiredCheck: contract.platform.ci.requiredCheck,
  };
}

export async function configurePlatform({
  root = platformRoot,
  environment = process.env,
  fetchImpl = globalThis.fetch,
  contract = readFrameworkContract(root),
  detected = detectGitProvider({ root, environment, contract }),
  apply = false,
} = {}) {
  const validatedContract = validateFrameworkContract(structuredClone(contract));
  const plan = platformConfigurationPlan({ contract: validatedContract, detected });
  if (!apply) return { applied: false, plan, warnings: [] };
  if (typeof fetchImpl !== "function") throw new Error("Platform configuration requires fetch.");
  const stateStore = platformConfigurationState(root, plan);
  const adapter = detected.provider === "github" ? applyGithubPlatform : applyGitlabPlatform;
  try {
    const result = await adapter({
      contract: validatedContract,
      detected,
      environment,
      fetchImpl,
      stateStore,
    });
    return { applied: true, plan, ...result };
  } finally {
    stateStore.release();
  }
}

function parseArgs(argv) {
  const args = new Set(argv.filter((argument) => argument !== "--"));
  const allowed = new Set(["--apply", "--json", "--help", "-h"]);
  const unknown = [...args].find((argument) => !allowed.has(argument));
  if (unknown) throw new Error(`Unknown platform configuration option: ${unknown}.`);
  return {
    apply: args.has("--apply"),
    help: args.has("--help") || args.has("-h"),
    json: args.has("--json"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: pnpm platform:configure [-- --json] [--apply]");
    return;
  }
  const result = await configurePlatform({ apply: args.apply });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(
    `${result.applied ? "Applied" : "Previewed"} ${result.plan.provider} policy for ${result.plan.repository}.`,
  );
  for (const operation of result.plan.operations) console.log(`- ${operation}`);
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  if (!result.applied) {
    console.log("Run again with --apply to change the detected remote platform.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`Git platform configuration failed: ${error.message}`);
    process.exit(1);
  }
}
