/** Owns github platform behavior for the Git provider integration boundary. */
import {
  paginatedPlatformApiRequest,
  platformApiRequest,
  providerApiBase,
} from "./platform-api.mjs";

export const githubRulesetName = "CodexRig main protection";

/** Distinguishes a verified policy mismatch from an unavailable provider read-back. */
class GithubRulesetMismatch extends Error {}

export function githubRulesetPayload(contract) {
  const { integrationBranch, protection } = contract.platform;
  const rules = [
    { type: "deletion" },
    { type: "non_fast_forward" },
    {
      type: "pull_request",
      parameters: {
        allowed_merge_methods: ["merge", "squash", "rebase"],
        dismiss_stale_reviews_on_push: protection.resetApprovalsOnPush,
        require_code_owner_review: protection.requireCodeOwnerReview,
        require_last_push_approval:
          protection.requiredApprovals > 0 && protection.preventCommitterApproval,
        required_approving_review_count: protection.requiredApprovals,
        required_review_thread_resolution: true,
      },
    },
  ];
  return {
    bypass_actors: [],
    conditions: {
      ref_name: { exclude: [], include: [`refs/heads/${integrationBranch}`] },
    },
    enforcement: "active",
    name: githubRulesetName,
    rules,
    target: "branch",
  };
}

function assertExpectedSubset(actual, expected, label) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      throw new GithubRulesetMismatch(`GitHub ruleset read-back differs at ${label}.`);
    }
    expected.forEach((value, index) =>
      assertExpectedSubset(actual[index], value, `${label}[${index}]`),
    );
    return;
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
      throw new GithubRulesetMismatch(`GitHub ruleset read-back differs at ${label}.`);
    }
    for (const [key, value] of Object.entries(expected)) {
      assertExpectedSubset(actual[key], value, `${label}.${key}`);
    }
    return;
  }
  if (actual !== expected)
    throw new GithubRulesetMismatch(`GitHub ruleset read-back differs at ${label}.`);
}

function verifyGithubRuleset(actual, expected) {
  for (const field of ["name", "target", "enforcement", "conditions", "bypass_actors"]) {
    assertExpectedSubset(actual?.[field], expected[field], field);
  }
  if (!Array.isArray(actual?.rules))
    throw new GithubRulesetMismatch("GitHub ruleset read-back has no rules.");
  const actualByType = new Map();
  for (const rule of actual.rules) {
    if (actualByType.has(rule?.type)) {
      throw new GithubRulesetMismatch(`GitHub ruleset read-back duplicates ${String(rule?.type)}.`);
    }
    actualByType.set(rule?.type, rule);
  }
  for (const expectedRule of expected.rules) {
    const actualRule = actualByType.get(expectedRule.type);
    if (!actualRule)
      throw new GithubRulesetMismatch(`GitHub ruleset read-back omitted ${expectedRule.type}.`);
    assertExpectedSubset(actualRule, expectedRule, `rules.${expectedRule.type}`);
  }
  for (const type of ["merge_queue", "required_status_checks"]) {
    if (!expected.rules.some((rule) => rule.type === type) && actualByType.has(type)) {
      throw new GithubRulesetMismatch(
        `GitHub ruleset read-back retained an unwanted ${type} rule.`,
      );
    }
  }
}

// The old framework-owned check was named "verify" and had no app binding.
// Additional protection rules and external checks can share this ruleset.
function retainAdditionalRules(payload, current) {
  if (!Array.isArray(current.rules))
    throw new Error("GitHub owned ruleset has no rules inventory.");
  for (const { type, parameters } of current.rules) {
    const owned = payload.rules.find((rule) => rule.type === type);
    if (owned) {
      if (owned.parameters) owned.parameters = { ...parameters, ...owned.parameters };
    } else if (type === "required_status_checks") {
      if (!Array.isArray(parameters?.required_status_checks)) {
        throw new Error("GitHub owned ruleset has an invalid required status check list.");
      }
      const checks = parameters.required_status_checks.filter(
        (check) => check.context !== "verify" || (check.integration_id ?? -1) > 0,
      );
      if (checks.length)
        payload.rules.push({ type, parameters: { ...parameters, required_status_checks: checks } });
    } else if (type !== "merge_queue") {
      payload.rules.push(parameters === undefined ? { type } : { type, parameters });
    }
  }
}

async function readActionsEnabled(fetchImpl, url, token) {
  const permissions = await platformApiRequest(fetchImpl, url, { provider: "github", token });
  if (typeof permissions?.enabled !== "boolean")
    throw new Error("GitHub repository Actions permission could not be verified.");
  return permissions.enabled;
}

export async function applyGithubPlatform({ contract, detected, token, fetchImpl, stateStore }) {
  const base = `${providerApiBase(contract, "github", detected.hostname)}/repos/${detected.slug}`;
  const request = { provider: "github", token };
  const existing = await paginatedPlatformApiRequest(
    fetchImpl,
    `${base}/rulesets?includes_parents=false`,
    request,
  );
  const ownedRulesets = existing.filter((ruleset) => ruleset?.name === githubRulesetName);
  if (ownedRulesets.length > 1) {
    throw new Error("GitHub has multiple CodexRig rulesets; reconcile duplicates manually.");
  }
  const owned = ownedRulesets[0];
  if (
    owned &&
    (!Number.isSafeInteger(owned.id) ||
      (owned.source_type !== undefined && owned.source_type !== "Repository") ||
      (owned.source !== undefined && owned.source.toLowerCase() !== detected.slug.toLowerCase()))
  ) {
    throw new Error("GitHub owned ruleset identity is invalid.");
  }
  const url = owned ? `${base}/rulesets/${owned.id}` : `${base}/rulesets`;
  const payload = githubRulesetPayload(contract);
  let rulesMatch = false;
  if (owned) {
    const current = await platformApiRequest(fetchImpl, url, request);
    if (current?.id !== owned.id || current?.name !== githubRulesetName)
      throw new Error("GitHub owned ruleset identity changed during inventory.");
    retainAdditionalRules(payload, current);
    try {
      verifyGithubRuleset(current, payload);
      rulesMatch = true;
    } catch (error) {
      if (!(error instanceof GithubRulesetMismatch)) throw error;
    }
  }
  const actionsUrl = `${base}/actions/permissions`;
  const actionsEnabled = await readActionsEnabled(fetchImpl, actionsUrl, token);
  const state = stateStore.begin();
  if (state.resumed && !owned) {
    throw new Error(
      "GitHub ruleset creation outcome is unknown; reconcile the original remote state before another create.",
    );
  }
  if (!rulesMatch) {
    const written = await platformApiRequest(fetchImpl, url, {
      ...request,
      body: payload,
      method: owned ? "PUT" : "POST",
    });
    stateStore.record("ruleset written");
    const rulesetId = owned?.id ?? written?.id;
    if (!Number.isSafeInteger(rulesetId))
      throw new Error("GitHub ruleset write returned no stable identity.");
    const actual = await platformApiRequest(fetchImpl, `${base}/rulesets/${rulesetId}`, request);
    verifyGithubRuleset(actual, payload);
  }
  stateStore.record("ruleset verified");
  if (actionsEnabled) {
    await platformApiRequest(fetchImpl, actionsUrl, {
      ...request,
      body: { enabled: false },
      method: "PUT",
    });
    if (await readActionsEnabled(fetchImpl, actionsUrl, token))
      throw new Error("GitHub read-back still permits repository Actions.");
  }
  stateStore.complete();
  const retainedChecks = payload.rules.find((rule) => rule.type === "required_status_checks");
  return {
    provider: "github",
    repository: detected.slug,
    resumed: state.resumed,
    updated: rulesMatch ? "verified existing ruleset" : owned ? "ruleset" : "new ruleset",
    warnings: retainedChecks
      ? [
          "Existing external status checks remain required. Their owners must provide results with repository Actions disabled.",
        ]
      : [],
  };
}
