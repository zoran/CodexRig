/** Inventories repository-local storage and composes scratch recovery without deleting durable state. */
import { lstatSync, opendirSync, realpathSync, statSync, statfsSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { validateDirectoryChain } from "../filesystem/owned-path-safety.mjs";
import { spawnSyncWithBoundedIo } from "./runtime-process-io.mjs";
import { formatContextError } from "../terminal/terminal-output.mjs";
import { projectToolPaths, projectToolEnvironment } from "./project-tool-environment.mjs";
import { projectAccountStateDirectory } from "./source-inventory-policy.mjs";
import { reconcileProjectTemporaryStorage } from "./project-temporary-storage.mjs";

const gibibyte = 1024 ** 3;
export const repositoryScratchBudgetBytes = 2 * gibibyte;

function measure(root, relative, { maximumEntries, maximumMilliseconds }) {
  const target = path.join(root, relative);
  const initial = lstatSync(target, { throwIfNoEntry: false });
  if (!initial) return { bytes: 0, entries: 0, complete: true };
  const result = { bytes: 0, entries: 0, complete: true };
  const started = performance.now();
  const pending = [target];
  const seen = new Set();
  const account = (stats) => {
    const identity = `${stats.dev}:${stats.ino}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    result.bytes += typeof stats.blocks === "number" ? stats.blocks * 512 : stats.size;
    result.entries++;
  };
  try {
    if (path.dirname(target) !== root)
      validateDirectoryChain(root, path.dirname(target), "storage inventory");
    if (initial.dev !== lstatSync(root).dev) return { ...result, complete: false };
    if (!initial.isDirectory() || initial.isSymbolicLink()) {
      account(initial);
      return result;
    }
    while (pending.length) {
      if (result.entries >= maximumEntries || performance.now() - started > maximumMilliseconds) {
        result.complete = false;
        break;
      }
      const directory = pending.pop();
      const before = lstatSync(directory);
      if (
        !before.isDirectory() ||
        before.isSymbolicLink() ||
        before.dev !== initial.dev ||
        realpathSync.native(directory) !== directory
      ) {
        result.complete = false;
        continue;
      }
      account(before);
      const handle = opendirSync(directory);
      try {
        let entry;
        while ((entry = handle.readSync()) !== null) {
          if (
            result.entries + pending.length >= maximumEntries ||
            performance.now() - started > maximumMilliseconds
          ) {
            result.complete = false;
            pending.length = 0;
            break;
          }
          const child = path.join(directory, entry.name);
          const stats = lstatSync(child);
          if (stats.dev !== initial.dev) {
            result.complete = false;
            continue;
          }
          if (stats.isDirectory() && !stats.isSymbolicLink()) pending.push(child);
          else account(stats); // Links are counted as links, never followed; no file content is read.
        }
      } finally {
        handle.closeSync();
      }
    }
  } catch {
    result.complete = false; // Concurrent changes and inaccessible paths remain visible lower bounds.
  }
  return result;
}

/** Reports allocated bytes and reclaims only managed dead executions, through their existing owner. */
export function reconcileRepositoryStorage({
  root,
  apply = false,
  protectedPaths = [],
  scratchBudgetBytes = repositoryScratchBudgetBytes,
  maximumEntries = 250_000,
  maximumMilliseconds = 3000,
}) {
  const locations = projectToolPaths(root);
  const scopes = reconcileProjectTemporaryStorage({
    root,
    parent: locations.temporary,
    apply,
    protectedPaths,
  });
  const measuredScopes = scopes
    .filter((scope) => scope.status !== "removed")
    .map((scope) => ({
      ...scope,
      ...measure(root, scope.path, { maximumEntries, maximumMilliseconds }),
    }));
  const groups = [
    [".tmp", "unmanaged scratch / native cache", true],
    ["tmp", "handovers and unmanaged scratch", true],
    [
      projectAccountStateDirectory,
      "private accounts and tools total; subtotals below overlap",
      false,
    ],
    [path.relative(root, locations.temporary), "tool temporary data", true],
    [".project-state", "operation/recovery records; reconcile at their product owner", true],
    ["sessions", "native history; retain for the native session owner", false],
    ["logs", "native logs; retain for the native session owner", false],
    ["cache", "native cache; retain for the native session owner", false],
    [
      path.relative(root, locations.cache),
      "private/legacy caches; owner migration or eviction",
      false,
    ],
    [
      path.relative(root, locations.data),
      "legacy installations, private devices and durable tool data",
      false,
    ],
    [
      path.relative(root, path.join(locations.state, "tools")),
      "legacy native installations; quiescent installer retirement",
      false,
    ],
    [path.relative(root, locations.home), "private tool home and accounts", false],
    [path.relative(root, locations.config), "private account/tool configuration", false],
    [path.relative(root, locations.persistent), "persistent tool state", false],
    [path.relative(root, locations.runtime), "live tool runtime state", false],
  ].map(([relative, purpose, budgeted]) => {
    const observation = measure(root, relative, { maximumEntries, maximumMilliseconds });
    const activeBytes =
      relative === path.relative(root, locations.temporary)
        ? measuredScopes
            .filter(
              (scope) => scope.reason === "active owner" || scope.reason === "active consumers",
            )
            .reduce((sum, scope) => sum + scope.bytes, 0)
        : 0;
    return {
      path: relative,
      purpose,
      ...observation,
      reviewRequired:
        budgeted && (!observation.complete || observation.bytes - activeBytes > scratchBudgetBytes),
    };
  });
  return {
    groups,
    scopes,
    scratchBudgetBytes,
    reviewRequired:
      groups.some((group) => group.reviewRequired) ||
      scopes.some(
        (scope) =>
          scope.status === "eligible" ||
          scope.reason.startsWith("unsafe") ||
          scope.reason.startsWith("unknown"),
      ),
  };
}

/** Emits bounded metadata only; private file names, contents and account configuration stay private. */
export function repositoryStorageSummary(report) {
  const lines = ["Repository storage (allocated bytes; incomplete scans are lower bounds):"];
  for (const group of report.groups) {
    if (!group.bytes && group.complete) continue;
    lines.push(
      `- ${group.path}: ${group.bytes} bytes${group.complete ? "" : "+ (incomplete)"}; ${group.purpose}${group.reviewRequired ? "; OWNER REVIEW REQUIRED" : ""}`,
    );
  }
  const counts = {};
  for (const scope of report.scopes) counts[scope.status] = (counts[scope.status] ?? 0) + 1;
  lines.push(`Managed temporary executions: ${JSON.stringify(counts)}.`);
  if (report.reviewRequired)
    lines.push(
      "Storage reconciliation is incomplete. Retire eligible executions with --storage-only --apply; unknown scratch and recovery data require their owner, never blanket deletion.",
    );
  else
    lines.push(
      "No unmanaged scratch budget breach or pending managed cleanup was observed. Durable/native data was retained.",
    );
  return lines.join("\n");
}

const gib = 1024n ** 3n;
const minimumAvailableBytes = 2n * gib;
const recoveryTargetBytes = 3n * gib;

function readFilesystemCapacity(root) {
  if (!path.isAbsolute(root)) throw new Error("Storage capacity requires an absolute path.");
  // An installation may create its directories later; their existing ancestor owns the capacity.
  let existing = root;
  while (!lstatSync(existing, { throwIfNoEntry: false })) existing = path.dirname(existing);
  const filesystem = statfsSync(existing, { bigint: true });
  if (
    filesystem.bsize <= 0n ||
    filesystem.blocks <= 0n ||
    filesystem.bavail < 0n ||
    filesystem.bfree < filesystem.bavail ||
    filesystem.bfree > filesystem.blocks
  )
    throw new Error("Housekeeping could not establish valid filesystem capacity.");
  return {
    device: statSync(existing, { bigint: true }).dev,
    totalBytes: filesystem.blocks * filesystem.bsize,
    availableBytes: filesystem.bavail * filesystem.bsize,
    freeBytes: filesystem.bfree * filesystem.bsize,
  };
}

function runLocalDocker(root, args) {
  // Bind both the endpoint and built-in builder. Ambient remote contexts, accounts and builder
  // selections are removed by the project environment; Docker owns reference/in-use protection.
  const result = spawnSyncWithBoundedIo(
    "docker",
    ["--host", "unix:///var/run/docker.sock", ...args],
    {
      cwd: root,
      env: projectToolEnvironment({ root }),
      encoding: "utf8",
      input: "",
      stdio: "pipe",
      maxBuffer: 1024 * 1024,
      timeout: args[0] === "info" ? 15_000 : 180_000,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Local Docker storage operation failed: ${formatContextError(
        result.error?.message || result.stderr || "Docker returned a failure",
        root,
      )}`,
    );
  }
  return result.stdout;
}

function describe(capacity) {
  const percent = Number((capacity.availableBytes * 1000n) / capacity.totalBytes) / 10;
  return `${(Number(capacity.availableBytes) / Number(gib)).toFixed(1)} GiB available (${percent.toFixed(1)}%)`;
}

/**
 * Check is observational. Apply prunes only on pressure, on the same filesystem, through the
 * local daemon's native build-cache GC. No images, volumes, files, accounts or worktrees are deleted.
 * The native GC target includes reserved blocks so root-visible free space cannot hide low bavail.
 */
export function runStorageHousekeeping(
  { root, apply = false, storagePaths = [] },
  { readCapacity = readFilesystemCapacity, docker = runLocalDocker, log = console.log } = {},
) {
  const filesystems = new Map();
  for (const location of new Set([root, ...storagePaths])) {
    const capacity = readCapacity(location);
    if (!filesystems.has(capacity.device)) {
      filesystems.set(capacity.device, { path: location, before: capacity, after: capacity });
      log(`Repository storage (${location}): ${describe(capacity)}; minimum 2.0 GiB.`);
    }
  }
  const observations = [...filesystems.values()];
  const before = observations[0].before;
  const result = (cleaned) => ({
    cleaned,
    before,
    after: observations[0].after,
    filesystems: observations,
  });
  const deficient = observations.filter(
    (item) => item.before.availableBytes < minimumAvailableBytes,
  );
  if (!deficient.length) return result(false);
  if (!apply) {
    throw new Error(
      `Repository storage at ${deficient[0].path} is below the required 2.0 GiB available; run housekeeping with --apply for bounded cache recovery.`,
    );
  }

  const dockerRoot = JSON.parse(docker(root, ["info", "--format", "{{json .DockerRootDir}}"]));
  if (
    typeof dockerRoot !== "string" ||
    !path.isAbsolute(dockerRoot) ||
    /[\0\r\n]/u.test(dockerRoot)
  )
    throw new Error(
      "Local Docker did not identify an absolute data directory; cache was preserved.",
    );
  const dockerDevice = readCapacity(dockerRoot).device;
  if (deficient.some((item) => item.before.device !== dockerDevice))
    throw new Error(
      "Docker data is on a different filesystem; cache was preserved and storage pressure remains unresolved.",
    );

  const affected = deficient[0].before;
  const reserved = affected.freeBytes - affected.availableBytes;
  log(
    "Storage pressure: reclaiming unused local Docker build cache toward 3.0 GiB available (required minimum: 2.0 GiB).",
  );
  docker(root, [
    "buildx",
    "prune",
    "--builder",
    "default",
    "--force",
    "--min-free-space",
    String(recoveryTargetBytes + reserved),
  ]);
  for (const item of observations) {
    item.after = readCapacity(item.path);
    log(
      `Repository storage after cache recovery (${item.path}): ${describe(item.after)}; net available change ${(Number(item.after.availableBytes - item.before.availableBytes) / Number(gib)).toFixed(1)} GiB.`,
    );
    if (
      item.after.device !== item.before.device ||
      item.after.totalBytes !== item.before.totalBytes
    )
      throw new Error(
        "Repository filesystem changed during storage recovery; result is unverified.",
      );
  }
  if (observations.some((item) => item.after.availableBytes < minimumAvailableBytes))
    throw new Error(
      "Local cache cleanup did not restore the required 2.0 GiB available; inspect disk usage. Durable data and other caches were preserved.",
    );
  if (deficient.some((item) => item.after.availableBytes < recoveryTargetBytes))
    log("Required storage reserve restored; the additional cleanup target was not reached.");
  return result(true);
}
