import {
  paginatedPlatformApiRequest,
  PlatformApiError,
  platformApiRequest,
  providerApiBase,
} from "./platform-api.mjs";

export const githubRulesetName = "CodexRig main protection";

export function githubRulesetPayload(contract, { includeSerialization = true } = {}) {
  const { ci, integrationBranch, protection } = contract.platform;
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
    {
      type: "required_status_checks",
      parameters: {
        do_not_enforce_on_create: false,
        required_status_checks: [{ context: ci.requiredCheck }],
        strict_required_status_checks_policy: true,
      },
    },
  ];
  if (includeSerialization && protection.mergeSerialization !== "disabled") {
    rules.push({
      type: "merge_queue",
      parameters: {
        check_response_timeout_minutes: 60,
        grouping_strategy: "ALLGREEN",
        max_entries_to_build: 5,
        max_entries_to_merge: 5,
        merge_method: "SQUASH",
        min_entries_to_merge: 1,
        min_entries_to_merge_wait_minutes: 5,
      },
    });
  }
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
      throw new Error(`GitHub ruleset read-back differs at ${label}.`);
    }
    expected.forEach((value, index) =>
      assertExpectedSubset(actual[index], value, `${label}[${index}]`),
    );
    return;
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
      throw new Error(`GitHub ruleset read-back differs at ${label}.`);
    }
    for (const [key, value] of Object.entries(expected)) {
      assertExpectedSubset(actual[key], value, `${label}.${key}`);
    }
    return;
  }
  if (actual !== expected) throw new Error(`GitHub ruleset read-back differs at ${label}.`);
}

function verifyGithubRuleset(actual, expected) {
  for (const field of ["name", "target", "enforcement", "conditions", "bypass_actors"]) {
    assertExpectedSubset(actual?.[field], expected[field], field);
  }
  if (!Array.isArray(actual?.rules)) throw new Error("GitHub ruleset read-back has no rules.");
  const actualByType = new Map();
  for (const rule of actual.rules) {
    if (actualByType.has(rule?.type)) {
      throw new Error(`GitHub ruleset read-back duplicates ${String(rule?.type)}.`);
    }
    actualByType.set(rule?.type, rule);
  }
  for (const expectedRule of expected.rules) {
    const actualRule = actualByType.get(expectedRule.type);
    if (!actualRule) throw new Error(`GitHub ruleset read-back omitted ${expectedRule.type}.`);
    assertExpectedSubset(actualRule, expectedRule, `rules.${expectedRule.type}`);
  }
  if (
    !expected.rules.some((rule) => rule.type === "merge_queue") &&
    actualByType.has("merge_queue")
  ) {
    throw new Error("GitHub ruleset read-back retained an unwanted merge queue.");
  }
}

export async function applyGithubPlatform({
  contract,
  detected,
  environment,
  fetchImpl,
  stateStore,
}) {
  const token = environment.GH_TOKEN || environment.GITHUB_TOKEN;
  if (!token) throw new Error("GitHub configuration requires GH_TOKEN or GITHUB_TOKEN.");
  const base = `${providerApiBase(contract, "github", detected.hostname)}/repos/${detected.slug}`;
  const existing = await paginatedPlatformApiRequest(fetchImpl, `${base}/rulesets`, {
    provider: "github",
    token,
  });
  const ownedRulesets = existing.filter((ruleset) => ruleset?.name === githubRulesetName);
  if (ownedRulesets.length > 1) {
    throw new Error("GitHub has multiple CodexRig rulesets; reconcile duplicates manually.");
  }
  const owned = ownedRulesets[0];
  if (owned && !Number.isSafeInteger(owned.id)) {
    throw new Error("GitHub owned ruleset identity is invalid.");
  }
  const state = stateStore.begin();
  const method = owned ? "PUT" : "POST";
  const url = owned ? `${base}/rulesets/${owned.id}` : `${base}/rulesets`;
  const requestedSerialization = contract.platform.protection.mergeSerialization !== "disabled";
  const warnings = [];
  let payload = githubRulesetPayload(contract, {
    includeSerialization: requestedSerialization,
  });
  let written;
  try {
    written = await platformApiRequest(fetchImpl, url, {
      body: payload,
      method,
      provider: "github",
      token,
    });
  } catch (error) {
    const mayFallback =
      error instanceof PlatformApiError &&
      [403, 404, 422].includes(error.status) &&
      contract.platform.protection.mergeSerialization === "prefer";
    if (!mayFallback) throw error;
    payload = githubRulesetPayload(contract, { includeSerialization: false });
    written = await platformApiRequest(fetchImpl, url, {
      body: payload,
      method,
      provider: "github",
      token,
    });
    warnings.push(
      "GitHub merge queue was unavailable; branch, review, and CI protection remain active.",
    );
  }
  stateStore.record("ruleset written");
  const rulesetId = owned?.id ?? written?.id;
  if (!Number.isSafeInteger(rulesetId)) {
    throw new Error("GitHub ruleset write returned no stable identity.");
  }
  const actual = await platformApiRequest(fetchImpl, `${base}/rulesets/${rulesetId}`, {
    provider: "github",
    token,
  });
  verifyGithubRuleset(actual, payload);
  stateStore.record("ruleset verified");
  stateStore.complete();
  return {
    provider: "github",
    repository: detected.slug,
    resumed: state.resumed,
    updated: owned ? "ruleset" : "new ruleset",
    warnings,
  };
}
