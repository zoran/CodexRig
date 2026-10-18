#!/usr/bin/env node
/** Owns configure platform behavior for the Git provider integration boundary. */
import { readPlatformCredential } from "./platform-credentials.mjs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  readToolingConfiguration,
  validateToolingConfiguration,
} from "../contracts/tooling-configuration.mjs";
import { detectGitProvider, platformRoot } from "./git-provider.mjs";
import { applyGithubPlatform, githubRulesetPayload } from "./github-platform.mjs";
import { applyGitlabPlatform } from "./gitlab-platform.mjs";
import { providerApiBase } from "./platform-api.mjs";
import {
  platformConfigurationState,
  recoverPlatformConfigurationLock,
} from "./platform-configuration-state.mjs";

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
  contract,
  detected,
  apply = false,
  recoverLock = false,
  confirmQuiescent = false,
  expectedLockFingerprint,
} = {}) {
  // Local recovery must not inspect provider configuration, account files or remote state.
  if (recoverLock)
    return recoverPlatformConfigurationLock(root, {
      apply,
      confirmQuiescent,
      expectedFingerprint: expectedLockFingerprint,
    });
  if (confirmQuiescent || expectedLockFingerprint !== undefined)
    throw new Error("Lock recovery arguments require --recover-lock.");
  contract ??= readToolingConfiguration(root);
  detected ??= detectGitProvider({ root, environment, contract });
  const validatedContract = validateToolingConfiguration(structuredClone(contract));
  const plan = platformConfigurationPlan({ contract: validatedContract, detected });
  if (!apply) return { applied: false, plan, warnings: [] };
  if (typeof fetchImpl !== "function") throw new Error("Platform configuration requires fetch.");
  const token = readPlatformCredential(root, detected);
  const stateStore = platformConfigurationState(root, plan);
  const adapter = detected.provider === "github" ? applyGithubPlatform : applyGitlabPlatform;
  try {
    // The inventory determines mutation identities and must share their serialization boundary.
    stateStore.acquire();
    const result = await adapter({
      contract: validatedContract,
      detected,
      token,
      fetchImpl,
      stateStore,
    });
    return { applied: true, plan, ...result };
  } finally {
    stateStore.release();
  }
}

export function parseArgs(argv) {
  const args = argv.filter((argument) => argument !== "--");
  const flags = new Set();
  const allowed = new Set([
    "--apply",
    "--json",
    "--help",
    "-h",
    "--recover-lock",
    "--confirm-quiescent",
  ]);
  let expectedLockFingerprint;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--expected-lock-fingerprint") {
      if (expectedLockFingerprint !== undefined || !/^[a-f0-9]{64}$/u.test(args[index + 1] ?? ""))
        throw new Error("Expected lock fingerprint must be supplied once as a SHA-256 value.");
      expectedLockFingerprint = args[++index];
    } else {
      if (!allowed.has(argument))
        throw new Error(`Unknown platform configuration option: ${argument}.`);
      flags.add(argument);
    }
  }
  if (
    !flags.has("--recover-lock") &&
    (flags.has("--confirm-quiescent") || expectedLockFingerprint !== undefined)
  )
    throw new Error("Lock recovery arguments require --recover-lock.");
  return {
    apply: flags.has("--apply"),
    help: flags.has("--help") || flags.has("-h"),
    json: flags.has("--json"),
    recoverLock: flags.has("--recover-lock"),
    confirmQuiescent: flags.has("--confirm-quiescent"),
    expectedLockFingerprint,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: pnpm platform:configure [-- --json] [--apply]\n" +
        "       pnpm platform:configure -- --recover-lock [--json]\n" +
        "       pnpm platform:configure -- --recover-lock --apply --confirm-quiescent --expected-lock-fingerprint <sha256>",
    );
    return;
  }
  const result = await configurePlatform(args);
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (args.recoverLock) {
    if (result.applied) {
      console.log(
        "Retired the reviewed local platform lock; the reconciliation journal was left unchanged.",
      );
    } else if (!result.lockPresent) {
      console.log("No local platform configuration lock requires recovery.");
    } else {
      console.log(`Platform lock owner status: ${result.ownerStatus}.`);
      console.log(`Reviewed lock fingerprint: ${result.fingerprint}`);
      console.log(
        "After independently confirming that all platform configuration writers have stopped, run:",
      );
      console.log(
        `pnpm platform:configure -- --recover-lock --apply --confirm-quiescent --expected-lock-fingerprint ${result.fingerprint}`,
      );
    }
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
