import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  readFrameworkContract,
  validateFrameworkContract,
} from "../framework/framework-contract.mjs";
import { configurePlatform, githubRulesetPayload } from "./configure-platform.mjs";
import { detectGitProvider, parseGitRemoteUrl } from "./git-provider.mjs";
import { gitlabApprovalRuleName } from "./gitlab-platform.mjs";
import { platformApiRequest } from "./platform-api.mjs";
import { platformConfigurationState } from "./platform-configuration-state.mjs";
import {
  approvalSettings,
  gitlabHarness,
  protectedBranch,
  response,
} from "./platform-lifecycle-harness.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");
const contract = readFrameworkContract(repositoryRoot);
const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) rmSync(root, { force: true, recursive: true });
});

function temporaryRoot(prefix = "codexrig-platform-") {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function repository(remote) {
  const root = temporaryRoot();
  for (const args of [
    ["init", "--quiet"],
    ["remote", "add", "origin", remote],
  ]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
    assert.equal(result.status, 0, result.stderr);
  }
  return root;
}

function githubDetection() {
  return {
    hostname: "github.com",
    integrationBranch: "main",
    provider: "github",
    remoteName: "origin",
    slug: "owner/project",
    source: "git-remote",
  };
}

function gitlabDetection(overrides = {}) {
  return {
    hostname: "gitlab.com",
    integrationBranch: "main",
    provider: "gitlab",
    remoteName: "origin",
    slug: "group/project",
    source: "git-remote",
    ...overrides,
  };
}

test("remote parsing accepts standard, credentialed, SSH, and nested GitLab identities", () => {
  assert.deepEqual(parseGitRemoteUrl("git@github.com:owner/project.git"), {
    hostname: "github.com",
    slug: "owner/project",
  });
  assert.deepEqual(
    parseGitRemoteUrl("https://gitlab-ci-token:secret@gitlab.com/group/subgroup/project.git"),
    { hostname: "gitlab.com", slug: "group/subgroup/project" },
  );
  assert.deepEqual(parseGitRemoteUrl("ssh://git@gitlab.example.test/group/project.git"), {
    hostname: "gitlab.example.test",
    slug: "group/project",
  });
  assert.throws(() => parseGitRemoteUrl("file:///tmp/project"), /supported network URL/);
});

test("provider detection follows the selected remote and supports both platforms", () => {
  const github = detectGitProvider({
    root: repository("git@github.com:owner/project.git"),
    environment: {},
    contract,
  });
  assert.equal(github.provider, "github");
  assert.equal(github.slug, "owner/project");
  const gitlab = detectGitProvider({
    root: repository("https://gitlab.com/group/subgroup/project.git"),
    environment: {},
    contract,
  });
  assert.equal(gitlab.provider, "gitlab");
  assert.equal(gitlab.slug, "group/subgroup/project");
});

test("provider detection never inherits a remote from a parent repository", () => {
  const parent = repository("git@github.com:owner/project.git");
  const nested = path.join(parent, "gitless-project");
  mkdirSync(nested);
  assert.equal(detectGitProvider({ root: nested, environment: {}, contract }).provider, null);
});

test("provider detection supports declared self-hosts and rejects contradictory evidence", () => {
  const selfHosted = structuredClone(contract);
  selfHosted.platform.hosts.gitlab.push("gitlab.example.test");
  selfHosted.platform.apiBaseUrls.gitlab["gitlab.example.test"] =
    "https://gitlab.example.test/api/v4";
  const detected = detectGitProvider({
    root: repository("git@gitlab.example.test:team/project.git"),
    environment: {},
    contract: selfHosted,
  });
  assert.equal(detected.provider, "gitlab");
  assert.throws(
    () =>
      detectGitProvider({
        root: repository("git@gitlab.com:team/project.git"),
        environment: {
          GITHUB_ACTIONS: "true",
          GITHUB_REPOSITORY: "owner/project",
          GITHUB_SERVER_URL: "https://github.com",
        },
        contract,
      }),
    /contradicts/,
  );
});

test("API bases support self-hosted ports and paths but reject foreign origins", () => {
  const selfHosted = structuredClone(contract);
  selfHosted.platform.hosts.gitlab.push("gitlab.example.test");
  selfHosted.platform.apiBaseUrls.gitlab["gitlab.example.test"] =
    "https://gitlab.example.test:8443/custom/api/v4/";
  const validated = validateFrameworkContract(selfHosted);
  assert.equal(
    validated.platform.apiBaseUrls.gitlab["gitlab.example.test"],
    "https://gitlab.example.test:8443/custom/api/v4",
  );
  const foreign = structuredClone(selfHosted);
  foreign.platform.apiBaseUrls.gitlab["gitlab.example.test"] =
    "https://foreign.example.test/api/v4";
  assert.throws(() => validateFrameworkContract(foreign), /owned by gitlab\.example\.test/);
});

test("platform configuration refuses an unowned host before I/O", async () => {
  let calls = 0;
  await assert.rejects(
    configurePlatform({
      apply: true,
      contract,
      detected: gitlabDetection({ hostname: "untrusted.example.test" }),
      environment: { GITLAB_TOKEN: "test-token" },
      fetchImpl: async () => {
        calls += 1;
        return response(200, {});
      },
    }),
    /not owned/,
  );
  assert.equal(calls, 0);
});

test("platform configuration state serializes remote mutations and resumes after release", () => {
  const root = temporaryRoot();
  const plan = {
    provider: "github",
    repository: "owner/project",
    operations: ["reconcile ruleset"],
  };
  const first = platformConfigurationState(root, plan);
  assert.equal(first.begin().resumed, false);
  const second = platformConfigurationState(root, plan);
  assert.throws(() => second.begin(), /another platform configuration is active/i);
  first.release();
  assert.equal(second.begin().resumed, true);
  second.release();
});

test("platform API bounds streamed responses before buffering the full body", async () => {
  let canceled = false;
  let reads = 0;
  await assert.rejects(
    platformApiRequest(
      async () =>
        response(200, undefined, {
          getReader() {
            return {
              async cancel() {
                canceled = true;
              },
              async read() {
                reads += 1;
                return { done: false, value: Buffer.alloc(600 * 1024, 0x61) };
              },
              releaseLock() {},
            };
          },
        }),
      "https://api.github.com/repos/owner/project/rulesets",
      { provider: "github", token: "test-token" },
    ),
    /size limit/,
  );
  assert.equal(reads, 2);
  assert.equal(canceled, true);
});

test("GitHub previews without I/O and applies a verified owned ruleset", async () => {
  let previewCalls = 0;
  const preview = await configurePlatform({
    contract,
    detected: githubDetection(),
    fetchImpl: async () => {
      previewCalls += 1;
      return response(500);
    },
  });
  assert.equal(preview.applied, false);
  assert.equal(previewCalls, 0);

  const calls = [];
  const payload = githubRulesetPayload(contract);
  const applied = await configurePlatform({
    apply: true,
    contract,
    detected: githubDetection(),
    environment: { GH_TOKEN: "test-token" },
    root: temporaryRoot(),
    fetchImpl: async (url, options) => {
      calls.push({ options, url });
      if (url.includes("?")) return response(200, []);
      if (options.method === "POST") return response(201, { id: 7 });
      return response(200, { id: 7, ...payload });
    },
  });
  assert.equal(applied.applied, true);
  assert.equal(calls.length, 3);
  assert.equal(
    calls[0].url,
    "https://api.github.com/repos/owner/project/rulesets?page=1&per_page=100",
  );
  assert.deepEqual(JSON.parse(calls[1].options.body), payload);
  assert.equal(calls[1].options.headers.Authorization, "Bearer test-token");
  assert.equal(JSON.stringify(payload).includes("test-token"), false);
});

test("GitHub pagination finds an existing owned ruleset without creating a duplicate", async () => {
  const pageOne = Array.from({ length: 100 }, (_, id) => ({ id, name: `foreign-${id}` }));
  const payload = githubRulesetPayload(contract);
  const calls = [];
  await configurePlatform({
    apply: true,
    contract,
    detected: githubDetection(),
    environment: { GITHUB_TOKEN: "test-token" },
    root: temporaryRoot(),
    fetchImpl: async (url, options) => {
      calls.push({ options, url });
      const page = new URL(url).searchParams.get("page");
      if (page === "1") return response(200, pageOne);
      if (page === "2") return response(200, [{ id: 707, name: payload.name }]);
      if (options.method === "PUT") return response(200, { id: 707 });
      return response(200, { id: 707, ...payload });
    },
  });
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 0);
  assert.ok(calls.some((call) => call.options.method === "PUT"));
});

test("GitHub preferred serialization falls back and verifies the reduced policy", async () => {
  const bodies = [];
  const applied = await configurePlatform({
    apply: true,
    contract,
    detected: githubDetection(),
    environment: { GH_TOKEN: "test-token" },
    root: temporaryRoot(),
    fetchImpl: async (url, options) => {
      if (url.includes("?")) return response(200, []);
      if (options.method === "POST") {
        bodies.push(JSON.parse(options.body));
        return bodies.length === 1
          ? response(422, { message: "unsupported" })
          : response(201, { id: 7 });
      }
      return response(200, { id: 7, ...bodies.at(-1) });
    },
  });
  assert.equal(bodies.length, 2);
  assert.ok(bodies[0].rules.some((rule) => rule.type === "merge_queue"));
  assert.equal(
    bodies[1].rules.some((rule) => rule.type === "merge_queue"),
    false,
  );
  assert.equal(applied.warnings.length, 1);
});

test("GitHub retains recovery state after failed read-back and resumes safely", async () => {
  const root = temporaryRoot();
  const payload = githubRulesetPayload(contract);
  await assert.rejects(
    configurePlatform({
      apply: true,
      contract,
      detected: githubDetection(),
      environment: { GH_TOKEN: "secret-token" },
      root,
      fetchImpl: async (url, options) => {
        if (url.includes("?")) return response(200, []);
        if (options.method === "POST") return response(201, { id: 7 });
        return response(200, { id: 7, name: "wrong" });
      },
    }),
    /read-back/,
  );
  const statePath = path.join(root, ".project-state", "platform-configuration.json");
  assert.equal(existsSync(statePath), true);
  assert.equal(readFileSync(statePath, "utf8").includes("secret-token"), false);
  const resumed = await configurePlatform({
    apply: true,
    contract,
    detected: githubDetection(),
    environment: { GH_TOKEN: "secret-token" },
    root,
    fetchImpl: async (url, options) => {
      if (url.includes("?")) return response(200, [{ id: 7, name: payload.name }]);
      if (options.method === "PUT") return response(200, { id: 7 });
      return response(200, { id: 7, ...payload });
    },
  });
  assert.equal(resumed.resumed, true);
  assert.equal(existsSync(statePath), false);
});

test("GitLab validates approval capability before making any change", async () => {
  const calls = [];
  await assert.rejects(
    configurePlatform({
      apply: true,
      contract,
      detected: gitlabDetection(),
      environment: { GITLAB_TOKEN: "test-token" },
      root: temporaryRoot(),
      fetchImpl: async (url, options) => {
        calls.push({ options, url });
        return response(404, { message: "not available" });
      },
    }),
    /cannot enforce the requested review policy/,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
});

test("GitLab rejects a locked weaker approval setting before mutation", async () => {
  const harness = gitlabHarness({
    initialSettings: approvalSettings(
      { allow_author_approval: true },
      { allow_author_approval: true },
    ),
  });
  await assert.rejects(
    configurePlatform({
      apply: true,
      contract,
      detected: gitlabDetection(),
      environment: { GITLAB_TOKEN: "test-token" },
      fetchImpl: harness.fetchImpl,
      root: temporaryRoot(),
    }),
    /locked to a weaker value/,
  );
  assert.ok(harness.calls.every((call) => call.options.method === "GET"));
});

test("GitLab reconciles and reads back the complete merge-request policy", async () => {
  const harness = gitlabHarness();
  const applied = await configurePlatform({
    apply: true,
    contract,
    detected: gitlabDetection({ slug: "group/subgroup/project" }),
    environment: { GITLAB_TOKEN: "test-token" },
    fetchImpl: harness.fetchImpl,
    root: temporaryRoot(),
  });
  assert.equal(applied.provider, "gitlab");
  assert.deepEqual(harness.projectBodies[0], {
    merge_pipelines_enabled: true,
    merge_train_enforcement: "enforce_for_all_users",
    merge_trains_enabled: true,
    merge_trains_skip_train_allowed: false,
    only_allow_merge_if_all_discussions_are_resolved: true,
    only_allow_merge_if_pipeline_succeeds: true,
    remove_source_branch_after_merge: true,
  });
  const settingsWrite = harness.calls.find(
    (call) => call.options.method === "POST" && call.url.includes("merge_request_approval_setting"),
  );
  assert.deepEqual(JSON.parse(settingsWrite.options.body), {
    allow_author_approval: false,
    allow_committer_approval: false,
    allow_overrides_to_approver_list_per_merge_request: false,
    retain_approvals_on_push: false,
  });
  assert.ok(harness.calls.every((call) => call.options.headers["PRIVATE-TOKEN"] === "test-token"));
});

test("GitLab removes the owned approval rule when zero approvals are requested", async () => {
  const zeroApprovals = structuredClone(contract);
  zeroApprovals.platform.protection.requiredApprovals = 0;
  const harness = gitlabHarness({
    initialBranch: protectedBranch(),
    initialRules: [
      {
        applies_to_all_protected_branches: true,
        approvals_required: 1,
        groups: [{ id: 4 }],
        id: 12,
        name: gitlabApprovalRuleName,
        users: [{ id: 3 }],
      },
    ],
  });
  await configurePlatform({
    apply: true,
    contract: zeroApprovals,
    detected: gitlabDetection(),
    environment: { GITLAB_TOKEN: "test-token" },
    fetchImpl: harness.fetchImpl,
    root: temporaryRoot(),
  });
  assert.ok(
    harness.calls.some(
      (call) => call.options.method === "DELETE" && call.url.endsWith("/approval_rules/12"),
    ),
  );
});

test("GitLab preserves visible approvers while updating an owned rule", async () => {
  const harness = gitlabHarness({
    initialBranch: protectedBranch(),
    initialRules: [
      {
        applies_to_all_protected_branches: true,
        approvals_required: 2,
        groups: [{ id: 4 }],
        id: 12,
        name: gitlabApprovalRuleName,
        users: [{ id: 3 }],
      },
    ],
  });
  await configurePlatform({
    apply: true,
    contract,
    detected: gitlabDetection(),
    environment: { GITLAB_TOKEN: "test-token" },
    fetchImpl: harness.fetchImpl,
    root: temporaryRoot(),
  });
  const update = harness.calls.find(
    (call) => call.options.method === "PUT" && call.url.endsWith("/approval_rules/12"),
  );
  assert.deepEqual(JSON.parse(update.options.body).group_ids, [4]);
  assert.deepEqual(JSON.parse(update.options.body).user_ids, [3]);
});

test("GitLab preserves granular merge access and removes every granular direct-push grant", async () => {
  const harness = gitlabHarness({
    initialBranch: {
      allow_force_push: false,
      code_owner_approval_required: false,
      merge_access_levels: [
        { access_level: 20, group_id: null, id: 2, user_id: null },
        { access_level: null, group_id: 7, id: 3, user_id: null },
      ],
      push_access_levels: [
        { access_level: 30, group_id: null, id: 1, user_id: null },
        { access_level: null, group_id: null, id: 4, user_id: 9 },
      ],
    },
  });
  await configurePlatform({
    apply: true,
    contract,
    detected: gitlabDetection(),
    environment: { GITLAB_TOKEN: "test-token" },
    fetchImpl: harness.fetchImpl,
    root: temporaryRoot(),
  });
  const update = harness.calls.find(
    (call) => call.options.method === "PATCH" && call.url.endsWith("/protected_branches/main"),
  );
  assert.deepEqual(JSON.parse(update.options.body).allowed_to_merge, [{ access_level: 30, id: 2 }]);
  assert.deepEqual(JSON.parse(update.options.body).allowed_to_push, [
    { access_level: 0, id: 1 },
    { _destroy: true, id: 4 },
  ]);
});

test("GitLab preferred serialization degrades progressively without weakening CI", async () => {
  const harness = gitlabHarness({ projectFailures: 2 });
  const applied = await configurePlatform({
    apply: true,
    contract,
    detected: gitlabDetection(),
    environment: { GITLAB_TOKEN: "test-token" },
    fetchImpl: harness.fetchImpl,
    root: temporaryRoot(),
  });
  assert.equal(harness.projectBodies.length, 3);
  assert.equal(harness.projectBodies[0].merge_train_enforcement, "enforce_for_all_users");
  assert.equal(harness.projectBodies[1].merge_train_enforcement, undefined);
  assert.deepEqual(harness.projectBodies[2], {
    only_allow_merge_if_all_discussions_are_resolved: true,
    only_allow_merge_if_pipeline_succeeds: true,
    remove_source_branch_after_merge: true,
  });
  assert.match(applied.warnings[0], /merged-results pipelines or merge trains/u);
});

test("GitLab uses the contract-owned self-hosted API base", async () => {
  const selfHosted = structuredClone(contract);
  selfHosted.platform.hosts.gitlab.push("gitlab.example.test");
  selfHosted.platform.apiBaseUrls.gitlab["gitlab.example.test"] =
    "https://gitlab.example.test:8443/custom/api/v4";
  const harness = gitlabHarness();
  await configurePlatform({
    apply: true,
    contract: selfHosted,
    detected: gitlabDetection({ hostname: "gitlab.example.test" }),
    environment: { GITLAB_TOKEN: "test-token" },
    fetchImpl: harness.fetchImpl,
    root: temporaryRoot(),
  });
  assert.ok(
    harness.calls.every((call) =>
      call.url.startsWith("https://gitlab.example.test:8443/custom/api/v4/projects/"),
    ),
  );
});
