/** Isolates working-candidate workspace checks and retains only their declared physical outputs. */
import {
  chmodSync,
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  readVerificationConfiguration,
  verificationConfigurationPath,
} from "./verification-configuration.mjs";
import {
  atomicWriteOwnedFile,
  ensureOwnedDirectoryChain,
  readOptionalOwnedFile,
  removeOwnedRegularFile,
  removeOwnedEmptyDirectory,
} from "../filesystem/owned-file-operations.mjs";
import {
  createProjectTemporaryScope,
  reconcileProjectTemporaryStorage,
} from "../repository/project-temporary-storage.mjs";
import { listPortableTransferFiles } from "../repository/source-inventory.mjs";
import { sensitivePathReason } from "../repository/sensitive-paths.mjs";
import { copyStableRepositoryFile } from "../repository/stable-file-snapshot.mjs";
import { userToolPaths } from "../repository/user-tool-storage.mjs";

const outputDirectory = ".project-state/build/verification-outputs";
const workDirectory = ".project-state/build/verification-work";

export function retainedWorkspaceOutput(directory, file) {
  const relative = directory === "." ? file : `${directory}/${file}`;
  if (
    path.posix.normalize(relative) !== relative ||
    path.isAbsolute(relative) ||
    /[:\\\u0000-\u001f\u007f]/u.test(relative) ||
    relative
      .split("/")
      .some((part) =>
        ["", ".", "..", ".git", ".auth", ".codex", ".project-state", "node_modules"].includes(
          part.toLowerCase(),
        ),
      ) ||
    sensitivePathReason(relative)
  )
    throw new Error(
      "A workspace verification output must be a public package-relative artifact path.",
    );
  return `${outputDirectory}/${relative}`;
}

function inside(root, candidate) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function sourceCopy(root, target, file) {
  mkdirSync(path.dirname(path.join(target, file)), { recursive: true, mode: 0o700 });
  copyStableRepositoryFile({ repositoryRoot: root, relativePath: file, targetRoot: target });
  chmodSync(path.join(target, file), lstatSync(path.join(root, file)).mode & 0o777);
}

// The pnpm linker stores packages in the host's pinned graph. Rebase project links into the
// workspace. Make a private copy of local linker metadata, shims and any local dependency payload.
function projectPreparedDependencies(root, target, files) {
  const packages = new Set(
    files
      .filter((file) => path.basename(file) === "package.json")
      .map((file) => path.dirname(path.join(root, file))),
  );
  const moduleRoots = [...packages].map((directory) => path.join(directory, "node_modules"));
  if (!moduleRoots.some((modules) => lstatSync(modules, { throwIfNoEntry: false }))) return;
  const sharedStore = userToolPaths().pnpmStore;
  const destination = (absolute) => path.join(target, path.relative(root, absolute));
  const cache = path.join(root, "node_modules", ".pnpm-workspace-state-v1.json");
  const modulesFile = path.join(root, "node_modules/.modules.yaml");
  const installed = readOptionalOwnedFile(
    root,
    modulesFile,
    "installed pnpm linker configuration",
    { maximumBytes: 64 * 1024 * 1024 },
  );
  const metadata = installed.exists ? JSON.parse(installed.buffer) : undefined;
  const virtual = metadata?.virtualStoreDir
    ? path.resolve(path.dirname(modulesFile), metadata.virtualStoreDir)
    : undefined;
  const globalGraph = virtual && inside(sharedStore, virtual);
  const localGraph = path.join(root, "node_modules/.pnpm");
  const visited = new Set();
  function projectEntry(source) {
    if (visited.has(source)) return;
    visited.add(source);
    const stats = lstatSync(source);
    const output = destination(source);
    if (stats.isSymbolicLink()) {
      const resolved = realpathSync.native(source);
      if (inside(sharedStore, resolved)) symlinkSync(resolved, output);
      else if (
        inside(root, resolved) &&
        (packages.has(resolved) || moduleRoots.some((modules) => inside(modules, resolved)))
      ) {
        symlinkSync(destination(resolved), output);
        if (globalGraph && inside(localGraph, resolved) && resolved !== localGraph) {
          // A mixed installation can still reference an individual old local package.
          const group = path.relative(localGraph, resolved).split(path.sep)[0];
          ensureOwnedDirectoryChain(
            target,
            path.relative(root, localGraph),
            "local dependency graph",
          );
          projectEntry(path.join(localGraph, group));
        }
      } else
        throw new Error(
          `Prepared dependency points outside the workspace or shared store: ${path.relative(root, source)}.`,
        );
    } else if (stats.isDirectory()) {
      mkdirSync(output, { recursive: true, mode: 0o700 });
      // A prior local installation can leave gigabytes in .pnpm even when all current packages
      // live in the shared store. pnpm still reads its local lock metadata.
      for (const child of readdirSync(source, { withFileTypes: true }))
        if (source !== localGraph || !globalGraph || child.isFile())
          projectEntry(path.join(source, child.name));
    } else if (!stats.isFile()) {
      throw new Error("Unsupported special file in prepared workspace dependencies.");
    } else if (source === cache) {
      const state = JSON.parse(readFileSync(source, "utf8"));
      const moved = (entries) =>
        Object.fromEntries(
          Object.entries(entries).map(([key, value]) => {
            if (!inside(root, key))
              throw new Error("Installed dependency state belongs to another workspace.");
            return [destination(key), value];
          }),
        );
      state.projects = moved(state.projects);
      // The relocated files have new inode times. pnpm must check the input digests itself.
      if (state.validation) state.validation.files = {};
      writeFileSync(output, JSON.stringify(state), { mode: 0o600, flag: "wx" });
    } else if (source === modulesFile) {
      // Current pnpm writes JSON with a location relative to this file.
      if (virtual) {
        if (!globalGraph && !inside(path.join(root, "node_modules"), virtual))
          throw new Error(
            "Installed virtual store is outside the project and shared tool storage.",
          );
        metadata.virtualStoreDir = path.relative(
          path.dirname(output),
          globalGraph ? virtual : destination(virtual),
        );
      }
      writeFileSync(output, JSON.stringify(metadata), { mode: 0o600, flag: "wx" });
    } else if (path.basename(path.dirname(source)) === ".bin" && stats.size < 1024 * 1024) {
      const bytes = readFileSync(source);
      const shell = bytes.subarray(0, 2).toString() === "#!";
      writeFileSync(
        output,
        shell ? bytes.toString("utf8").replaceAll(root + path.sep, target + path.sep) : bytes,
        { mode: stats.mode & 0o777, flag: "wx" },
      );
    } else {
      copyFileSync(source, output, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
    }
  }
  for (const modules of moduleRoots) {
    if (lstatSync(modules, { throwIfNoEntry: false })) projectEntry(modules);
  }
}

export function createWorkspaceVerificationDirectory(root) {
  const parent = ensureOwnedDirectoryChain(root, workDirectory, "workspace verification runs", {
    createdMode: 0o700,
  });
  const scope = createProjectTemporaryScope({ root, parent });
  try {
    const files = listPortableTransferFiles({ root, includeUntracked: true });
    for (const file of files) {
      if (sensitivePathReason(file))
        throw new Error(`Private input in workspace verification source: ${file}.`);
      sourceCopy(root, scope.directory, file);
    }
    projectPreparedDependencies(root, scope.directory, files);
    return scope;
  } catch (error) {
    scope.release();
    throw error;
  }
}

const retainedInventory = ".project-state/build/verification-inventory.json";
const checksum = (data) => createHash("sha256").update(data).digest("hex");
const fileIdentity = (stats) => `${stats.dev}:${stats.ino}`;

/** Record only files actually produced by this project. Unrecognized files remain untouched. */
export function prepareWorkspaceVerificationStorage(root) {
  reconcileProjectTemporaryStorage({ root, parent: path.join(root, workDirectory), apply: true });
  const label = "workspace verification inventory";
  const inventory = path.join(root, retainedInventory);
  const stored = readOptionalOwnedFile(root, inventory, label, { maximumBytes: 8 * 1024 * 1024 });
  const owner = { root, identity: fileIdentity(lstatSync(root)) };
  const state = stored.exists ? JSON.parse(stored.buffer) : { version: 1, owner, files: {} };
  if (
    state.version !== 1 ||
    state.owner?.root !== root ||
    state.owner.identity !== owner.identity ||
    !state.files ||
    Array.isArray(state.files) ||
    typeof state.files !== "object"
  )
    throw new Error("Workspace verification inventory does not belong to this checkout.");
  const write = () =>
    atomicWriteOwnedFile(root, inventory, JSON.stringify(state) + "\n", 0o600, { label });
  if (
    stored.exists &&
    lstatSync(path.join(root, verificationConfigurationPath), { throwIfNoEntry: false })
  ) {
    const configured = readVerificationConfiguration(root).workspaceOutputs ?? {};
    const declared = new Set(
      Object.entries(configured).flatMap(([directory, lifecycles]) =>
        Object.values(lifecycles).flatMap((files) =>
          files.map((file) => retainedWorkspaceOutput(directory, file)),
        ),
      ),
    );
    let changed = false;
    for (const [retained, receipt] of Object.entries(state.files)) {
      if (
        !retained.startsWith(outputDirectory + "/") ||
        retainedWorkspaceOutput(".", retained.slice(outputDirectory.length + 1)) !== retained
      )
        throw new Error("Invalid retained verification path in this project's inventory.");
      if (declared.has(retained)) continue;
      const target = path.join(root, retained);
      const current = lstatSync(target, { throwIfNoEntry: false });
      const owned =
        current?.isFile() &&
        current.nlink === 1 &&
        current.size <= 64 * 1024 * 1024 &&
        (receipt.identity === fileIdentity(current) || receipt.pending);
      if (owned) {
        const entry = readOptionalOwnedFile(root, target, label, {
          maximumBytes: 64 * 1024 * 1024,
        });
        if (entry.exists) {
          const digest = checksum(entry.buffer);
          // A pending intent survives process exit between the atomic output and inventory writes.
          if (
            (receipt.identity === fileIdentity(entry.stats) && receipt.digest === digest) ||
            receipt.pending === digest
          ) {
            removeOwnedRegularFile(root, target, label, { expectedIdentity: entry.stats });
            for (
              let directory = path.dirname(target);
              directory !== path.join(root, outputDirectory);
              directory = path.dirname(directory)
            )
              if (!removeOwnedEmptyDirectory(root, directory, label)) break;
          }
        }
      }
      delete state.files[retained];
      changed = true;
    }
    if (changed) {
      if (Object.keys(state.files).length) write();
      else removeOwnedRegularFile(root, inventory, label, { expectedIdentity: stored.stats });
    }
  }
  return {
    retain(batch) {
      if (!batch.length) return;
      for (const { file, buffer } of batch) {
        if (
          !Object.hasOwn(state.files, file) &&
          lstatSync(path.join(root, file), { throwIfNoEntry: false })
        )
          throw new Error(`Unowned file in declared verification storage: ${file}.`);
        state.files[file] = { ...state.files[file], pending: checksum(buffer) };
      }
      write();
      try {
        for (const { file, buffer, mode } of batch) {
          ensureOwnedDirectoryChain(root, path.dirname(file), "workspace verification outputs");
          const written = atomicWriteOwnedFile(root, path.join(root, file), buffer, mode, {
            label: "declared workspace verification output",
            exactMode: true,
          });
          state.files[file] = {
            digest: state.files[file].pending,
            identity: fileIdentity(written),
          };
        }
      } finally {
        write();
      }
    },
  };
}

export function transferWorkspaceOutputs(
  root,
  workspace,
  store,
  outputs,
  { restore = false } = {},
) {
  let totalBytes = 0;
  let batch = [];
  let batchBytes = 0;
  for (const retained of outputs ?? []) {
    if (!retained.startsWith(outputDirectory + "/"))
      throw new Error("Workspace output is outside private verification storage.");
    const file = retained.slice(outputDirectory.length + 1);
    retainedWorkspaceOutput(".", file);
    const [source, input, target, output] = restore
      ? [root, retained, workspace, file]
      : [workspace, file, root, retained];
    const label = "declared workspace verification output";
    const entry = readOptionalOwnedFile(source, path.join(source, input), label, {
      maximumBytes: 64 * 1024 * 1024,
    });
    if (!entry.exists) throw new Error(`Missing declared workspace output: ${file}.`);
    totalBytes += entry.buffer.length;
    if (totalBytes > 512 * 1024 * 1024)
      throw new Error("Declared workspace outputs exceed the bounded snapshot size.");
    if (!restore) {
      if (batchBytes + entry.buffer.length > 64 * 1024 * 1024) {
        store.retain(batch);
        batch = [];
        batchBytes = 0;
      }
      batch.push({ file: retained, buffer: entry.buffer, mode: entry.stats.mode & 0o777 });
      batchBytes += entry.buffer.length;
      continue;
    }
    const current = readOptionalOwnedFile(target, path.join(target, output), label, {
      maximumBytes: 64 * 1024 * 1024,
    });
    if (current.exists) {
      if (
        !current.buffer.equals(entry.buffer) ||
        (current.stats.mode & 0o777) !== (entry.stats.mode & 0o777)
      )
        throw new Error(`Workspace build prerequisite changed in the current run: ${file}.`);
      continue;
    }
    ensureOwnedDirectoryChain(target, path.dirname(output), label, { createdMode: 0o700 });
    atomicWriteOwnedFile(
      target,
      path.join(target, output),
      entry.buffer,
      entry.stats.mode & 0o777,
      { label, exactMode: true },
    );
  }
  store.retain(batch);
}
