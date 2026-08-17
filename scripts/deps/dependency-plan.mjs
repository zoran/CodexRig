/** Owns immutable dependency-plan derivation, validation, and reproducibility checks. */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  contentHash,
  copyLocalInput,
  DependencyTransactionError,
  discoverLocalInputs,
  inputRecord,
  normalizeRelativePath,
  projectIdentity,
  readOptionalFile,
  verifyInputRecords,
} from "./dependency-inputs.mjs";
import {
  discoverPnpmWorkspaceManifestPaths,
  pnpmHooksDisabledEnvironment,
} from "../repository/pnpm-workspace-manifests.mjs";
import { spawnRuntimeLifecycleCommandSync } from "../repository/runtime-lifecycle-process.mjs";
import { currentRuntimeLifecycleCapability } from "../repository/runtime-session-lease.mjs";
import { spawnTrustedPnpm, trustedPnpmCommand } from "./trusted-pnpm-command.mjs";

export const dependencyTransactionSchemaVersion = 2;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function stableDependencyJson(value) {
  return JSON.stringify(stableValue(value));
}

export function dependencyPlanHash(payload) {
  return contentHash(stableDependencyJson(payload));
}

function manifestPath(value) {
  const normalized = normalizeRelativePath(value);
  if (path.posix.basename(normalized) !== "package.json") {
    throw new DependencyTransactionError(`Dependency manifest must end in package.json: ${value}`);
  }
  return normalized;
}

export function normalizeDependencyOutputPath(value) {
  const normalized = normalizeRelativePath(value);
  if (normalized !== "pnpm-lock.yaml" && path.posix.basename(normalized) !== "package.json") {
    throw new DependencyTransactionError(`Unsupported dependency transaction output: ${value}`);
  }
  return normalized;
}

function exactObjectKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DependencyTransactionError(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    throw new DependencyTransactionError(`${label} has an unsupported schema.`);
  }
}

function canonicalStringList(value, label) {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !item || /[\0\r\n]/u.test(item)) ||
    value.some((item, index) => index > 0 && value[index - 1].localeCompare(item) >= 0)
  ) {
    throw new DependencyTransactionError(`${label} must be a sorted list of unique strings.`);
  }
  return value;
}

export function normalizeDependencyRequest(request) {
  return {
    level: String(request.level ?? "patch"),
    select: [...new Set((request.select ?? []).map(String))].sort(),
    allowMajor: Boolean(request.allowMajor),
    includePinned: Boolean(request.includePinned),
  };
}

export function updatedDependencySpec(oldSpec, targetVersion) {
  const spec = String(oldSpec).trim();
  if (/^(?:workspace|file|link|portal|catalog):/.test(spec)) return null;
  const alias = /^(npm:(?:@[^/]+\/[^@]+|[^@]+)@)([\^~]?)(\d+\.\d+\.\d+(?:[-+].*)?)$/.exec(spec);
  if (alias) return `${alias[1]}${alias[2]}${targetVersion}`;
  if (/^\^/.test(spec)) return `^${targetVersion}`;
  if (/^~/.test(spec)) return `~${targetVersion}`;
  if (/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(spec)) return targetVersion;
  return null;
}

function defaultLockfilePlanner({ projectRoot, manifestPaths, manifestOutputs, localInputs }) {
  for (const pnpmHook of [".pnpmfile.cjs", ".pnpmfile.mjs", "pnpmfile.cjs", "pnpmfile.mjs"]) {
    if (readOptionalFile(projectRoot, pnpmHook).exists) {
      throw new DependencyTransactionError(
        `${pnpmHook} is executable dependency-resolution code; use a reviewed project-specific lockfile workflow.`,
      );
    }
  }
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "codex-dependency-plan-"));
  chmodSync(temporaryRoot, 0o700);
  try {
    const outputByPath = new Map(manifestOutputs.map((output) => [output.path, output.content]));
    const sourcePaths = [...manifestPaths, ".npmrc", "pnpm-workspace.yaml", "pnpm-lock.yaml"];
    for (const record of localInputs) copyLocalInput(projectRoot, temporaryRoot, record);
    for (const relativePath of [...new Set(sourcePaths)]) {
      const source = readOptionalFile(projectRoot, relativePath);
      if (!source.exists && !outputByPath.has(relativePath)) continue;
      const target = path.join(temporaryRoot, relativePath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, outputByPath.get(relativePath) ?? source.content, "utf8");
    }
    for (const output of manifestOutputs) {
      const target = path.join(temporaryRoot, output.path);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, output.content, "utf8");
    }
    const lifecycleCapability = currentRuntimeLifecycleCapability({
      root: projectRoot,
      operation: "dependency",
    });
    if (!lifecycleCapability) {
      throw new DependencyTransactionError(
        "Dependency lockfile planning requires the repository dependency capability.",
      );
    }
    const spawnPnpm = (command, args, options) =>
      spawnRuntimeLifecycleCommandSync({
        args,
        command,
        lifecycleCapability,
        options,
        repositoryRoot: projectRoot,
        role: "dependency-supervisor",
      });
    const command = trustedPnpmCommand({
      repositoryRoot: projectRoot,
      environment: pnpmHooksDisabledEnvironment({ ...process.env, CI: "true" }),
      spawn: spawnPnpm,
    });
    const result = spawnTrustedPnpm({
      command,
      repositoryRoot: projectRoot,
      args: ["install", "--lockfile-only", "--ignore-scripts", "--ignore-pnpmfile"],
      spawnPnpm,
      options: {
        cwd: temporaryRoot,
        encoding: "utf8",
        env: pnpmHooksDisabledEnvironment({ ...process.env, CI: "true" }),
        input: "",
        stdio: "pipe",
        timeout: 180_000,
      },
    });
    if (result.error) {
      throw new DependencyTransactionError(
        `Planned lockfile generation failed to start: ${result.error.message}`,
      );
    }
    if (result.status !== 0) {
      const detail = String(result.stderr ?? result.stdout ?? "")
        .trim()
        .split(/\r?\n/)
        .at(-1);
      throw new DependencyTransactionError(
        `Planned lockfile generation failed with status ${result.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    const lockfilePath = path.join(temporaryRoot, "pnpm-lock.yaml");
    if (!existsSync(lockfilePath)) {
      throw new DependencyTransactionError(
        "Planned lockfile generation produced no pnpm-lock.yaml.",
      );
    }
    return readFileSync(lockfilePath, "utf8");
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function createDependencyPlan(options) {
  const projectRoot = projectIdentity(options.projectRoot).root;
  const request = normalizeDependencyRequest(options.request);
  const manifestPaths = [...new Set(options.manifestPaths.map(manifestPath))].sort();
  const inputPaths = [
    ...manifestPaths,
    ".npmrc",
    ".pnpmfile.cjs",
    ".pnpmfile.mjs",
    "dependency-policy.json",
    "pnpm-lock.yaml",
    "pnpmfile.cjs",
    "pnpmfile.mjs",
    "pnpm-workspace.yaml",
  ];
  const policySource = readOptionalFile(projectRoot, "dependency-policy.json");
  let pins = [];
  if (policySource.exists) {
    try {
      const policy = JSON.parse(policySource.content);
      if (!Array.isArray(policy.pins)) throw new Error("pins must be an array");
      pins = policy.pins;
    } catch {
      throw new DependencyTransactionError(
        "dependency-policy.json changed to an invalid policy before the preview was frozen.",
      );
    }
  }
  const manifests = new Map();
  for (const relativePath of manifestPaths) {
    const source = readOptionalFile(projectRoot, relativePath);
    if (!source.exists) {
      throw new DependencyTransactionError(`Dependency manifest disappeared: ${relativePath}`);
    }
    let data;
    try {
      data = JSON.parse(source.content);
    } catch {
      throw new DependencyTransactionError(
        `Dependency manifest contains invalid JSON: ${relativePath}`,
      );
    }
    manifests.set(relativePath, { data, content: source.content });
  }

  const changed = new Map();
  const updateKeys = new Set();
  const skipped = [];
  const reviewedUpdates = [];
  for (const update of options.updates) {
    if (
      !["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].includes(
        update.section,
      )
    ) {
      throw new DependencyTransactionError(`Unsupported dependency section: ${update.section}`);
    }
    const relativePath = manifestPath(update.manifestPath);
    const canonicalKey = `${relativePath}:${update.section}:${update.name}`;
    if (String(update.key) !== canonicalKey) {
      throw new DependencyTransactionError(
        `Dependency update key does not match its manifest identity: ${canonicalKey}`,
      );
    }
    if (updateKeys.has(canonicalKey)) {
      throw new DependencyTransactionError(`Dependency update is duplicated: ${canonicalKey}`);
    }
    updateKeys.add(canonicalKey);
    const nowPinned = pins.some(
      (pin) =>
        pin?.name === update.name &&
        (!pin.manifest || pin.manifest === relativePath) &&
        (!pin.section || pin.section === update.section),
    );
    if (nowPinned && !request.includePinned) {
      throw new DependencyTransactionError(
        `Dependency became pinned before the preview was frozen: ${update.key}`,
      );
    }
    const source = manifests.get(relativePath);
    const oldSpec = source?.data?.[update.section]?.[update.name];
    if (oldSpec === undefined) {
      throw new DependencyTransactionError(`Dependency target disappeared: ${update.key}`);
    }
    if (String(oldSpec) !== String(update.currentSpec)) {
      throw new DependencyTransactionError(`Dependency source spec changed: ${update.key}`);
    }
    const nextSpec = updatedDependencySpec(oldSpec, update.target);
    if (!nextSpec) {
      skipped.push(`${update.key}: unsupported spec ${oldSpec}`);
      continue;
    }
    const nextData = changed.get(relativePath) ?? structuredClone(source.data);
    nextData[update.section][update.name] = nextSpec;
    changed.set(relativePath, nextData);
    reviewedUpdates.push({
      key: String(update.key),
      manifestPath: relativePath,
      section: String(update.section),
      name: String(update.name),
      current: String(update.current),
      currentSpec: String(update.currentSpec),
      target: String(update.target),
      nextSpec,
      delta: String(update.delta),
    });
  }

  const manifestOutputs = [...changed.entries()]
    .map(([relativePath, data]) => {
      const content = `${JSON.stringify(data, null, 2)}\n`;
      return { path: relativePath, hash: contentHash(content), content };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  if (manifestOutputs.length === 0) {
    throw new DependencyTransactionError("No supported dependency manifest updates were planned.");
  }

  const localInputs = discoverLocalInputs(projectRoot, manifests);
  const inputsByPath = new Map(
    [...new Set(inputPaths)]
      .sort()
      .map((relativePath) => [relativePath, inputRecord(projectRoot, relativePath)]),
  );
  for (const record of localInputs) inputsByPath.set(record.path, record);
  const inputs = [...inputsByPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const planLockfile = options.lockfilePlanner ?? defaultLockfilePlanner;
  const lockfileContent = planLockfile({
    projectRoot,
    manifestPaths,
    manifestOutputs,
    localInputs,
  });
  verifyInputRecords(projectRoot, inputs);
  const payload = {
    version: dependencyTransactionSchemaVersion,
    createdAt: (options.now ?? new Date()).toISOString(),
    request,
    updates: reviewedUpdates.sort((left, right) => left.key.localeCompare(right.key)),
    skipped: skipped.sort(),
    inputs,
    outputs: {
      manifests: manifestOutputs,
      lockfile: {
        path: "pnpm-lock.yaml",
        hash: contentHash(lockfileContent),
        content: lockfileContent,
      },
    },
  };
  return { ...payload, hash: dependencyPlanHash(payload) };
}

export function validateDependencyPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new DependencyTransactionError("Dependency plan must be an object.");
  }
  const { hash, ...payload } = plan;
  exactObjectKeys(
    plan,
    ["createdAt", "hash", "inputs", "outputs", "request", "skipped", "updates", "version"],
    "Dependency plan",
  );
  if (
    plan.version !== dependencyTransactionSchemaVersion ||
    typeof hash !== "string" ||
    hash !== dependencyPlanHash(payload)
  ) {
    throw new DependencyTransactionError("Dependency plan hash or schema is invalid.");
  }
  exactObjectKeys(
    plan.request,
    ["allowMajor", "includePinned", "level", "select"],
    "Dependency request",
  );
  if (
    stableDependencyJson(plan.request) !==
      stableDependencyJson(normalizeDependencyRequest(plan.request)) ||
    !["all", "major", "minor", "patch"].includes(plan.request.level)
  ) {
    throw new DependencyTransactionError("Dependency plan request is not canonical.");
  }
  canonicalStringList(plan.request.select, "Dependency selection");
  canonicalStringList(plan.skipped, "Dependency skipped results");
  const createdAtMilliseconds =
    typeof plan.createdAt === "string" ? Date.parse(plan.createdAt) : Number.NaN;
  if (
    typeof plan.createdAt !== "string" ||
    !plan.createdAt ||
    !Number.isFinite(createdAtMilliseconds) ||
    new Date(createdAtMilliseconds).toISOString() !== plan.createdAt ||
    !Array.isArray(plan.inputs) ||
    plan.inputs.length === 0 ||
    !Array.isArray(plan.updates) ||
    plan.updates.length === 0
  ) {
    throw new DependencyTransactionError("Dependency plan structure is incomplete.");
  }
  exactObjectKeys(plan.outputs, ["lockfile", "manifests"], "Dependency outputs");
  if (!Array.isArray(plan.outputs.manifests) || plan.outputs.manifests.length === 0) {
    throw new DependencyTransactionError("Dependency plan manifest outputs are incomplete.");
  }
  const inputPaths = new Set();
  for (const input of plan.inputs) {
    exactObjectKeys(input, ["exists", "hash", "kind", "path"], "Dependency input");
    const relativePath = normalizeRelativePath(input?.path);
    const validExistingInput =
      input?.exists === true &&
      ["file", "directory"].includes(input?.kind) &&
      /^[a-f0-9]{64}$/.test(input?.hash);
    const validMissingInput =
      input?.exists === false && input?.kind === "missing" && input?.hash === null;
    if (inputPaths.has(relativePath) || (!validExistingInput && !validMissingInput)) {
      throw new DependencyTransactionError(`Dependency plan input is invalid: ${relativePath}`);
    }
    inputPaths.add(relativePath);
  }
  const requiredInputPaths = [
    ".npmrc",
    ".pnpmfile.cjs",
    ".pnpmfile.mjs",
    "dependency-policy.json",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "pnpmfile.cjs",
    "pnpmfile.mjs",
  ];
  if (requiredInputPaths.some((relativePath) => !inputPaths.has(relativePath))) {
    throw new DependencyTransactionError("Dependency plan omits required repository inputs.");
  }
  if (plan.inputs.some((input, index) => index > 0 && plan.inputs[index - 1].path >= input.path)) {
    throw new DependencyTransactionError("Dependency plan inputs are not uniquely sorted.");
  }
  const updateKeys = new Set();
  const updatedManifestPaths = new Set();
  for (const update of plan.updates) {
    exactObjectKeys(
      update,
      [
        "current",
        "currentSpec",
        "delta",
        "key",
        "manifestPath",
        "name",
        "nextSpec",
        "section",
        "target",
      ],
      "Dependency update",
    );
    const relativePath = manifestPath(update.manifestPath);
    const canonicalKey = `${relativePath}:${update.section}:${update.name}`;
    if (
      !["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].includes(
        update.section,
      ) ||
      !["major", "minor", "patch"].includes(update.delta) ||
      typeof update.name !== "string" ||
      !update.name ||
      update.key !== canonicalKey ||
      updateKeys.has(update.key) ||
      updatedDependencySpec(update.currentSpec, update.target) !== update.nextSpec
    ) {
      throw new DependencyTransactionError(`Dependency plan update is invalid: ${canonicalKey}`);
    }
    updateKeys.add(update.key);
    updatedManifestPaths.add(relativePath);
  }
  if (
    plan.updates.some((update, index) => index > 0 && plan.updates[index - 1].key >= update.key)
  ) {
    throw new DependencyTransactionError("Dependency plan updates are not uniquely sorted.");
  }
  const outputPaths = new Set();
  for (const output of plan.outputs.manifests) {
    exactObjectKeys(output, ["content", "hash", "path"], "Dependency manifest output");
    const relativePath = manifestPath(output.path);
    if (
      outputPaths.has(relativePath) ||
      !updatedManifestPaths.has(relativePath) ||
      typeof output.content !== "string" ||
      contentHash(output.content) !== output.hash
    ) {
      throw new DependencyTransactionError(
        `Dependency plan output hash is invalid: ${output.path}`,
      );
    }
    outputPaths.add(relativePath);
  }
  if (
    outputPaths.size !== updatedManifestPaths.size ||
    plan.outputs.manifests.some(
      (output, index) => index > 0 && plan.outputs.manifests[index - 1].path >= output.path,
    )
  ) {
    throw new DependencyTransactionError("Dependency manifest outputs are incomplete or unsorted.");
  }
  exactObjectKeys(plan.outputs.lockfile, ["content", "hash", "path"], "Dependency lockfile output");
  if (
    plan.outputs.lockfile.path !== "pnpm-lock.yaml" ||
    typeof plan.outputs.lockfile.content !== "string" ||
    contentHash(plan.outputs.lockfile.content) !== plan.outputs.lockfile.hash
  ) {
    throw new DependencyTransactionError("Dependency plan lockfile hash is invalid.");
  }
  return plan;
}

export function assertDependencyPlanRederivable(projectRoot, plan) {
  const workspaceInput = plan.inputs.find((input) => input.path === "pnpm-workspace.yaml");
  const manifestPaths = workspaceInput?.exists
    ? discoverPnpmWorkspaceManifestPaths({ repositoryRoot: projectRoot })
    : ["package.json"];
  const rederived = createDependencyPlan({
    projectRoot,
    request: plan.request,
    updates: plan.updates,
    manifestPaths,
    now: new Date(plan.createdAt),
    lockfilePlanner: () => plan.outputs.lockfile.content,
  });
  if (stableDependencyJson(rederived) !== stableDependencyJson(plan)) {
    throw new DependencyTransactionError(
      "Stored dependency plan cannot be derived exactly from the current repository inputs and reviewed updates; generate and review a new preview.",
      73,
    );
  }
}
