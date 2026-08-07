import {
  paginatedPlatformApiRequest,
  PlatformApiError,
  platformApiRequest,
  providerApiBase,
} from "./platform-api.mjs";

export const gitlabApprovalRuleName = "CodexRig review";

const approvalSettingFields = {
  allow_author_approval: (protection) => !protection.preventAuthorApproval,
  allow_committer_approval: (protection) => !protection.preventCommitterApproval,
  allow_overrides_to_approver_list_per_merge_request: (protection) =>
    !protection.preventApprovalRuleOverrides,
  retain_approvals_on_push: (protection) => !protection.resetApprovalsOnPush,
};

function tierCapabilityError() {
  return new Error(
    "GitLab cannot enforce the requested review policy on this tier; use a tier with project approval settings and approval rules.",
  );
}

async function approvalInventory({ base, fetchImpl, token }) {
  try {
    return await paginatedPlatformApiRequest(fetchImpl, `${base}/approval_rules`, {
      provider: "gitlab",
      token,
    });
  } catch (error) {
    if (error instanceof PlatformApiError && [403, 404].includes(error.status)) {
      throw tierCapabilityError();
    }
    throw error;
  }
}

async function approvalSettings({ base, fetchImpl, token }) {
  try {
    return await platformApiRequest(fetchImpl, `${base}/merge_request_approval_setting`, {
      provider: "gitlab",
      token,
    });
  } catch (error) {
    if (error instanceof PlatformApiError && [403, 404].includes(error.status)) {
      throw tierCapabilityError();
    }
    throw error;
  }
}

async function protectedBranch({ base, branch, fetchImpl, token }) {
  try {
    return await platformApiRequest(
      fetchImpl,
      `${base}/protected_branches/${encodeURIComponent(branch)}`,
      { provider: "gitlab", token },
    );
  } catch (error) {
    if (error instanceof PlatformApiError && error.status === 404) return null;
    throw error;
  }
}

function ownedApprovalRule(rules) {
  const owned = rules.filter((rule) => rule?.name === gitlabApprovalRuleName);
  if (owned.length > 1) {
    throw new Error("GitLab has multiple CodexRig approval rules; reconcile duplicates manually.");
  }
  if (owned[0] && !Number.isSafeInteger(owned[0].id)) {
    throw new Error("GitLab owned approval-rule identity is invalid.");
  }
  return owned[0] ?? null;
}

function desiredApprovalSettings(protection) {
  return Object.fromEntries(
    Object.entries(approvalSettingFields).map(([field, desired]) => [field, desired(protection)]),
  );
}

function normalizedSetting(settings, field) {
  const entry = settings?.[field];
  if (
    !entry ||
    typeof entry !== "object" ||
    typeof entry.value !== "boolean" ||
    typeof entry.locked !== "boolean"
  ) {
    throw new Error(`GitLab approval setting ${field} is invalid.`);
  }
  return { locked: entry.locked, value: entry.value };
}

function writableApprovalSettings(settings, desired) {
  const body = {};
  for (const [field, value] of Object.entries(desired)) {
    const current = normalizedSetting(settings, field);
    if (current.locked && current.value !== value) {
      throw new Error(`GitLab approval setting ${field} is locked to a weaker value.`);
    }
    if (!current.locked) body[field] = value;
  }
  return body;
}

function safeApproverIds(rule, field) {
  const values = rule?.[field];
  if (!Array.isArray(values)) {
    throw new Error(`GitLab owned approval rule has invalid ${field}.`);
  }
  const ids = values.map((entry) => entry?.id);
  if (ids.some((id) => !Number.isSafeInteger(id)) || new Set(ids).size !== ids.length) {
    throw new Error(`GitLab owned approval rule has invalid ${field} identities.`);
  }
  return ids;
}

function approvalRuleBody(owned, required) {
  const body = {
    applies_to_all_protected_branches: true,
    approvals_required: required,
    name: gitlabApprovalRuleName,
  };
  if (owned) {
    body.group_ids = safeApproverIds(owned, "groups");
    body.user_ids = safeApproverIds(owned, "users");
  }
  return body;
}

const granularAccessFields = ["deploy_key_id", "group_id", "member_role_id", "user_id"];

function normalizedAccessRecords(levels, label, { allowDeployKeys = false } = {}) {
  if (!Array.isArray(levels)) throw new Error(`GitLab protected-branch ${label} is invalid.`);
  return levels.map((entry) => {
    if (!entry || typeof entry !== "object" || !Number.isSafeInteger(entry.id)) {
      throw new Error(`GitLab protected-branch ${label} cannot be updated safely.`);
    }
    const identities = granularAccessFields.filter((field) => Number.isSafeInteger(entry[field]));
    if (!allowDeployKeys && identities.includes("deploy_key_id")) {
      throw new Error(`GitLab protected-branch ${label} contains unsupported deploy-key access.`);
    }
    const hasRole = Number.isSafeInteger(entry.access_level);
    if (Number(hasRole) + identities.length !== 1) {
      throw new Error(`GitLab protected-branch ${label} is invalid.`);
    }
    return {
      accessLevel: hasRole ? entry.access_level : null,
      id: entry.id,
      identity: identities[0] ?? null,
    };
  });
}

function mergeAccessUpdate(levels) {
  const records = normalizedAccessRecords(levels, "merge access");
  if (records.length === 0) return [{ access_level: 30 }];
  const updates = records
    .filter((entry) => entry.identity === null && entry.accessLevel < 30)
    .map((entry) => ({ access_level: 30, id: entry.id }));
  return updates.length > 0 ? updates : null;
}

function pushAccessUpdate(levels) {
  const records = normalizedAccessRecords(levels, "push access", { allowDeployKeys: true });
  const updates = [];
  let retainsNoAccess = false;
  for (const entry of records) {
    if (entry.identity !== null) {
      updates.push({ _destroy: true, id: entry.id });
    } else if (entry.accessLevel === 0) {
      retainsNoAccess = true;
    } else {
      updates.push({ access_level: 0, id: entry.id });
      retainsNoAccess = true;
    }
  }
  if (!retainsNoAccess) updates.push({ access_level: 0 });
  return updates.length > 0 ? updates : null;
}

function branchProtectionOperation({ base, branch, contract, current }) {
  if (!current) {
    return {
      body: {
        allow_force_push: false,
        allowed_to_merge: [{ access_level: 30 }],
        allowed_to_push: [{ access_level: 0 }],
        code_owner_approval_required: contract.platform.protection.requireCodeOwnerReview,
        name: branch,
      },
      method: "POST",
      updated: "new protected branch",
      url: `${base}/protected_branches`,
    };
  }
  const body = {
    allow_force_push: false,
    code_owner_approval_required: contract.platform.protection.requireCodeOwnerReview,
  };
  const mergeAccess = mergeAccessUpdate(current.merge_access_levels);
  const pushAccess = pushAccessUpdate(current.push_access_levels);
  if (mergeAccess) body.allowed_to_merge = mergeAccess;
  if (pushAccess) body.allowed_to_push = pushAccess;
  return {
    body,
    method: "PATCH",
    updated: "protected branch",
    url: `${base}/protected_branches/${encodeURIComponent(branch)}`,
  };
}

async function writeBranchProtection({ fetchImpl, operation, token }) {
  await platformApiRequest(fetchImpl, operation.url, {
    body: operation.body,
    method: operation.method,
    provider: "gitlab",
    token,
  });
  return operation.updated;
}

function basicProjectSettings() {
  return {
    only_allow_merge_if_all_discussions_are_resolved: true,
    only_allow_merge_if_pipeline_succeeds: true,
    remove_source_branch_after_merge: true,
  };
}

async function writeProjectSettings({ base, contract, fetchImpl, token, warnings }) {
  const basic = basicProjectSettings();
  const serialization = contract.platform.protection.mergeSerialization;
  const update = (body) =>
    platformApiRequest(fetchImpl, base, {
      body,
      method: "PUT",
      provider: "gitlab",
      token,
    });
  if (serialization === "disabled") {
    await update(basic);
    return basic;
  }
  const serialized = {
    ...basic,
    merge_pipelines_enabled: true,
    merge_trains_enabled: true,
    merge_trains_skip_train_allowed: false,
  };
  const enforced = { ...serialized, merge_train_enforcement: "enforce_for_all_users" };
  try {
    await update(enforced);
    return enforced;
  } catch (error) {
    const canFallback =
      error instanceof PlatformApiError &&
      [400, 403, 404].includes(error.status) &&
      serialization === "prefer";
    if (!canFallback) throw error;
  }
  try {
    await update(serialized);
    warnings.push(
      "GitLab merge-train enforcement was unavailable; merge trains remain enabled but privileged users may be able to bypass them.",
    );
    return serialized;
  } catch (error) {
    const canDisable = error instanceof PlatformApiError && [400, 403, 404].includes(error.status);
    if (!canDisable) throw error;
  }
  await update(basic);
  warnings.push(
    "GitLab merged-results pipelines or merge trains were unavailable; protected merge requests still require green CI.",
  );
  return basic;
}

function approvalRuleOperation({ base, owned, required }) {
  if (required === 0) {
    if (!owned) return { method: null, updated: "no approval rule", url: null };
    return {
      method: "DELETE",
      updated: "removed approval rule",
      url: `${base}/approval_rules/${owned.id}`,
    };
  }
  return {
    body: approvalRuleBody(owned, required),
    method: owned ? "PUT" : "POST",
    updated: owned ? "approval rule" : "new approval rule",
    url: owned ? `${base}/approval_rules/${owned.id}` : `${base}/approval_rules`,
  };
}

async function writeApprovalRule({ fetchImpl, operation, token }) {
  if (!operation.method) return operation.updated;
  await platformApiRequest(fetchImpl, operation.url, {
    body: operation.body,
    method: operation.method,
    provider: "gitlab",
    token,
  });
  return operation.updated;
}

function verifyObject(actual, expected, label) {
  for (const [field, value] of Object.entries(expected)) {
    if (actual?.[field] !== value) {
      throw new Error(`GitLab ${label} read-back differs at ${field}.`);
    }
  }
}

function verifyBranch(actual, protection) {
  if (!actual || actual.allow_force_push !== false) {
    throw new Error("GitLab protected-branch read-back permits force pushes.");
  }
  if (actual.code_owner_approval_required !== protection.requireCodeOwnerReview) {
    throw new Error("GitLab protected-branch code-owner read-back differs.");
  }
  if (
    !Array.isArray(actual.push_access_levels) ||
    actual.push_access_levels.length === 0 ||
    actual.push_access_levels.some((entry) => entry?.access_level !== 0)
  ) {
    throw new Error("GitLab protected-branch read-back permits direct pushes.");
  }
  let mergeRecords;
  try {
    mergeRecords = normalizedAccessRecords(actual.merge_access_levels, "merge access");
  } catch {
    throw new Error("GitLab protected-branch read-back has invalid merge access.");
  }
  if (
    mergeRecords.length === 0 ||
    mergeRecords.some((entry) => entry.identity === null && entry.accessLevel < 30)
  ) {
    throw new Error("GitLab protected-branch read-back has weak merge access.");
  }
}

function verifyApprovalSettings(actual, desired) {
  for (const [field, value] of Object.entries(desired)) {
    if (normalizedSetting(actual, field).value !== value) {
      throw new Error(`GitLab approval-setting read-back differs at ${field}.`);
    }
  }
}

function verifyApprovalRule(rules, required) {
  const owned = ownedApprovalRule(rules);
  if (required === 0) {
    if (owned) throw new Error("GitLab approval-rule read-back retained an unwanted rule.");
    return;
  }
  if (
    !owned ||
    owned.approvals_required !== required ||
    owned.applies_to_all_protected_branches !== true
  ) {
    throw new Error("GitLab approval-rule read-back differs from the requested policy.");
  }
}

export async function applyGitlabPlatform({
  contract,
  detected,
  environment,
  fetchImpl,
  stateStore,
}) {
  const token = environment.GITLAB_TOKEN || environment.GLAB_TOKEN;
  if (!token) throw new Error("GitLab configuration requires GITLAB_TOKEN or GLAB_TOKEN.");
  const base = `${providerApiBase(contract, "gitlab", detected.hostname)}/projects/${encodeURIComponent(detected.slug)}`;
  const branch = contract.platform.integrationBranch;
  const desiredSettings = desiredApprovalSettings(contract.platform.protection);

  // Finish every capability and identity read before the first remote mutation.
  const rules = await approvalInventory({ base, fetchImpl, token });
  const owned = ownedApprovalRule(rules);
  const settings = await approvalSettings({ base, fetchImpl, token });
  const writableSettings = writableApprovalSettings(settings, desiredSettings);
  const currentBranch = await protectedBranch({ base, branch, fetchImpl, token });
  const branchOperation = branchProtectionOperation({
    base,
    branch,
    contract,
    current: currentBranch,
  });
  const ruleOperation = approvalRuleOperation({
    base,
    owned,
    required: contract.platform.protection.requiredApprovals,
  });
  const state = stateStore.begin();

  const warnings = [];
  const expectedProject = await writeProjectSettings({
    base,
    contract,
    fetchImpl,
    token,
    warnings,
  });
  stateStore.record("project settings written");
  const branchUpdate = await writeBranchProtection({
    fetchImpl,
    operation: branchOperation,
    token,
  });
  stateStore.record("branch protection written");
  const approvalUpdate = await writeApprovalRule({
    fetchImpl,
    operation: ruleOperation,
    token,
  });
  stateStore.record("approval rule reconciled");
  if (Object.keys(writableSettings).length > 0) {
    await platformApiRequest(fetchImpl, `${base}/merge_request_approval_setting`, {
      body: writableSettings,
      method: "POST",
      provider: "gitlab",
      token,
    });
  }
  stateStore.record("approval settings written");

  const actualProject = await platformApiRequest(fetchImpl, base, {
    provider: "gitlab",
    token,
  });
  const actualBranch = await protectedBranch({ base, branch, fetchImpl, token });
  const actualSettings = await approvalSettings({ base, fetchImpl, token });
  const actualRules = await approvalInventory({ base, fetchImpl, token });
  verifyObject(actualProject, expectedProject, "project-settings");
  verifyBranch(actualBranch, contract.platform.protection);
  verifyApprovalSettings(actualSettings, desiredSettings);
  verifyApprovalRule(actualRules, contract.platform.protection.requiredApprovals);
  stateStore.record("remote policy verified");
  stateStore.complete();
  return {
    provider: "gitlab",
    repository: detected.slug,
    resumed: state.resumed,
    updated: [branchUpdate, approvalUpdate, "approval settings"].join(", "),
    warnings,
  };
}
