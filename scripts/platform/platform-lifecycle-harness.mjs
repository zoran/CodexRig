/** Owns platform lifecycle harness behavior for the Git provider integration boundary. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { configurePlatform as configureActualPlatform } from "./configure-platform.mjs";

export async function configurePlatform(options) {
  if (options.apply && options.root) {
    const dir = path.join(options.root, ".auth");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const detected = options.detected;
    fs.writeFileSync(
      path.join(dir, "git-platform.json"),
      JSON.stringify({
        schemaVersion: 1,
        provider: detected.provider,
        hostname: detected.hostname,
        repository: detected.slug,
        token: "test-token",
      }),
      { mode: 0o600 },
    );
  }
  return configureActualPlatform(options);
}

/** Leaves a lock issued by an exact owned child that has exited before its caller resumes. */
export function abandonPlatformLock(root, plan) {
  const moduleUrl = new URL("./platform-configuration-state.mjs", import.meta.url).href;
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { platformConfigurationState } from ${JSON.stringify(moduleUrl)}; platformConfigurationState(process.argv[1], JSON.parse(process.argv[2])).acquire();`,
      root,
      JSON.stringify(plan),
    ],
    { cwd: root, encoding: "utf8", stdio: "pipe", timeout: 15_000 },
  );
}

/** Schedules a competing caller after the stale lock's bytes are read, before takeover. */
export function interleavePlatformLockRead(root, action, interleave) {
  const lock = path.join(root, ".project-state/platform-configuration.lock");
  const initial = fs.lstatSync(lock);
  const read = fs.readFileSync;
  let interleaved = false;
  fs.readFileSync = (target, ...options) => {
    const content = read(target, ...options);
    const sameFile =
      typeof target === "number"
        ? (() => {
            const current = fs.fstatSync(target);
            return current.dev === initial.dev && current.ino === initial.ino;
          })()
        : target === lock;
    if (!interleaved && sameFile) {
      interleaved = true;
      interleave();
    }
    return content;
  };
  syncBuiltinESMExports();
  try {
    action();
    return interleaved;
  } finally {
    fs.readFileSync = read;
    syncBuiltinESMExports();
  }
}

export function applyAccessUpdates(existing, updates, initialId) {
  let nextId = Math.max(initialId, ...existing.map((entry) => entry.id ?? 0));
  let result = structuredClone(existing);
  for (const update of updates) {
    if (Number.isSafeInteger(update.id)) {
      result = update._destroy
        ? result.filter((entry) => entry.id !== update.id)
        : result.map((entry) => (entry.id === update.id ? { ...entry, ...update } : entry));
    } else {
      nextId += 1;
      result.push({ ...update, id: nextId });
    }
  }
  return result.map(({ _destroy, ...entry }) => entry);
}

export function response(status, body, stream) {
  return {
    body: stream,
    headers: { get: () => null },
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return body === undefined ? "" : JSON.stringify(body);
    },
  };
}

export function approvalSettings(values = {}, locked = {}) {
  const defaults = {
    allow_author_approval: false,
    allow_committer_approval: false,
    allow_overrides_to_approver_list_per_merge_request: false,
    retain_approvals_on_push: false,
  };
  return Object.fromEntries(
    Object.entries({ ...defaults, ...values }).map(([field, value]) => [
      field,
      { inherited_from: null, locked: locked[field] ?? false, value },
    ]),
  );
}

export function protectedBranch() {
  return {
    allow_force_push: false,
    code_owner_approval_required: false,
    merge_access_levels: [{ access_level: 30, id: 2 }],
    push_access_levels: [{ access_level: 0, id: 1 }],
  };
}

export function gitlabHarness({
  initialBranch = null,
  initialRules = [],
  initialSettings = approvalSettings(),
  projectFailures = 0,
} = {}) {
  const calls = [];
  const projectBodies = [];
  let branch = structuredClone(initialBranch);
  let rules = structuredClone(initialRules);
  let settings = structuredClone(initialSettings);
  let project = {};
  let remainingProjectFailures = projectFailures;
  const fetchImpl = async (url, options) => {
    calls.push({ options, url });
    const route = new URL(url).pathname;
    const method = options.method;
    if (method === "GET" && route.endsWith("/approval_rules")) return response(200, rules);
    if (method === "GET" && route.endsWith("/merge_request_approval_setting")) {
      return response(200, settings);
    }
    if (method === "GET" && route.endsWith("/protected_branches/main")) {
      return branch ? response(200, branch) : response(404, { message: "not found" });
    }
    if (method === "GET" && route.includes("/projects/")) return response(200, project);
    if (method === "PUT" && /\/projects\/[^/]+$/u.test(route)) {
      const body = JSON.parse(options.body);
      projectBodies.push(body);
      if (remainingProjectFailures > 0) {
        remainingProjectFailures -= 1;
        return response(400, { message: "unsupported" });
      }
      project = { ...project, ...body };
      return response(200, project);
    }
    if (method === "POST" && route.endsWith("/protected_branches")) {
      const body = JSON.parse(options.body);
      branch = {
        allow_force_push: body.allow_force_push,
        code_owner_approval_required: body.code_owner_approval_required,
        merge_access_levels: [{ access_level: body.allowed_to_merge[0].access_level, id: 2 }],
        push_access_levels: [{ access_level: body.allowed_to_push[0].access_level, id: 1 }],
      };
      return response(201, branch);
    }
    if (method === "PATCH" && route.endsWith("/protected_branches/main")) {
      const body = JSON.parse(options.body);
      branch = {
        ...branch,
        allow_force_push: body.allow_force_push,
        code_owner_approval_required: body.code_owner_approval_required,
        merge_access_levels: body.allowed_to_merge
          ? applyAccessUpdates(branch.merge_access_levels, body.allowed_to_merge, 2)
          : branch.merge_access_levels,
        push_access_levels: body.allowed_to_push
          ? applyAccessUpdates(branch.push_access_levels, body.allowed_to_push, 1)
          : branch.push_access_levels,
      };
      return response(200, branch);
    }
    if (method === "POST" && route.endsWith("/approval_rules")) {
      const body = JSON.parse(options.body);
      rules.push({ ...body, groups: [], id: 9, users: [] });
      return response(201, rules.at(-1));
    }
    const ruleMatch = route.match(/\/approval_rules\/(\d+)$/u);
    if (ruleMatch && method === "PUT") {
      const body = JSON.parse(options.body);
      const id = Number(ruleMatch[1]);
      rules = rules.map((rule) =>
        rule.id === id
          ? {
              ...rule,
              ...body,
              groups: body.group_ids.map((groupId) => ({ id: groupId })),
              users: body.user_ids.map((userId) => ({ id: userId })),
            }
          : rule,
      );
      return response(
        200,
        rules.find((rule) => rule.id === id),
      );
    }
    if (ruleMatch && method === "DELETE") {
      const id = Number(ruleMatch[1]);
      rules = rules.filter((rule) => rule.id !== id);
      return response(204);
    }
    if (method === "POST" && route.endsWith("/merge_request_approval_setting")) {
      const body = JSON.parse(options.body);
      settings = Object.fromEntries(
        Object.entries(settings).map(([field, entry]) => [
          field,
          { ...entry, value: body[field] ?? entry.value },
        ]),
      );
      return response(200, settings);
    }
    throw new Error(`Unexpected GitLab request: ${method} ${url}`);
  };
  return {
    calls,
    fetchImpl,
    get projectBodies() {
      return projectBodies;
    },
  };
}

export function githubDetection() {
  return {
    hostname: "github.com",
    integrationBranch: "main",
    provider: "github",
    remoteName: "origin",
    slug: "owner/project",
    source: "git-remote",
  };
}

export function gitlabDetection(overrides = {}) {
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
