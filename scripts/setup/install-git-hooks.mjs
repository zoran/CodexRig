import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  cleanGitEnvironment,
  isolatedGitArguments,
  resolveOwnedGitMetadata,
} from "../repository/git-runtime-isolation.mjs";
import { resolveGitHooksPath } from "./resolve-git-hooks-path.mjs";

const managedMarker = "Managed by this repository; installed by hooks:install.";
const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = realpathSync(path.resolve(path.dirname(modulePath), "..", ".."));

function sameIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.nlink === right.nlink
  );
}

function gitOutput(metadata, args) {
  const result = spawnSync(
    "git",
    isolatedGitArguments({
      args,
      gitDirectory: metadata.gitDirectory,
      workTree: metadata.workTree,
    }),
    {
      cwd: metadata.workTree,
      encoding: "utf8",
      env: cleanGitEnvironment(),
      input: "",
      stdio: "pipe",
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error("Project-owned Git hook metadata could not be resolved.");
  }
  const value = result.stdout.trim();
  if (!value || value.includes("\0")) {
    throw new Error("Project-owned Git hook metadata returned an invalid path.");
  }
  return value;
}

export function renderManagedPrePushHook({ installedHook, root, sourceHook }) {
  const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  return [
    "#!/bin/sh",
    `# ${managedMarker}`,
    "set -eu",
    `installed_hook=${shellQuote(installedHook)}`,
    `repository_root=${shellQuote(root)}`,
    `source_hook=${shellQuote(sourceHook)}`,
    'script_dir="$(CDPATH=\'\' cd -- "$(dirname -- "$0")" && pwd -P)"',
    'script_path="$script_dir/${0##*/}"',
    'if [ -L "$0" ] || [ ! -f "$0" ] || [ "$script_path" != "$installed_hook" ] ||',
    '   [ "$(CDPATH=\'\' cd -- "$repository_root" && pwd -P)" != "$repository_root" ]; then',
    '  echo "Repository-managed pre-push hook binding is invalid; run hooks:install." >&2',
    "  exit 1",
    "fi",
    "unset BASH_ENV ENV NODE_OPTIONS NODE_PATH",
    'exec sh "$source_hook" "$@"',
    "",
  ].join("\n");
}

function existingHookContent(targetHook) {
  if (!existsSync(targetHook)) return null;
  const initial = lstatSync(targetHook, { bigint: true });
  if (
    initial.isSymbolicLink() ||
    !initial.isFile() ||
    initial.nlink !== 1n ||
    initial.size > 1024n * 1024n
  ) {
    throw new Error(`Refusing to replace unsafe hook: ${targetHook}`);
  }
  const descriptor = openSync(targetHook, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameIdentity(initial, opened)) throw new Error("changed hook");
    const content = readFileSync(descriptor, "utf8");
    if (!sameIdentity(initial, fstatSync(descriptor, { bigint: true }))) {
      throw new Error("changed hook");
    }
    return content;
  } catch {
    throw new Error(`Refusing to replace unstable hook: ${targetHook}`);
  } finally {
    closeSync(descriptor);
  }
}

function publishHook(hooksDirectory, targetHook, content) {
  const temporaryHook = path.join(hooksDirectory, `.pre-push.${process.pid}.${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(
      temporaryHook,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o700,
    );
    fchmodSync(descriptor, 0o700);
    writeFileSync(descriptor, content, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryHook, targetHook);
    const directoryDescriptor = openSync(
      hooksDirectory,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0),
    );
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryHook, { force: true });
  }
}

export function installGitHooks() {
  const metadata = resolveOwnedGitMetadata(repositoryRoot);
  if (!metadata) {
    console.log("No Git worktree found; skipping hook installation.");
    return false;
  }
  const commonDirectory = gitOutput(metadata, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  const requestedHooksDirectory = gitOutput(metadata, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "hooks",
  ]);
  const hooksDirectory = resolveGitHooksPath({
    commonDirectory,
    hooksDirectory: requestedHooksDirectory,
    repositoryRoot,
  });
  mkdirSync(hooksDirectory, { recursive: true, mode: 0o700 });
  const hooksStats = lstatSync(hooksDirectory);
  if (hooksStats.isSymbolicLink() || !hooksStats.isDirectory()) {
    throw new Error(`Refusing unsafe Git hooks directory: ${hooksDirectory}`);
  }
  const targetHook = path.join(realpathSync(hooksDirectory), "pre-push");
  const sourceHook = path.join(repositoryRoot, "scripts", "git-hooks", "pre-push");
  const sourceStats = lstatSync(sourceHook);
  if (
    sourceStats.isSymbolicLink() ||
    !sourceStats.isFile() ||
    sourceStats.nlink !== 1 ||
    realpathSync(sourceHook) !== sourceHook
  ) {
    throw new Error("Repository-managed pre-push source must be a stable real file.");
  }
  const expected = renderManagedPrePushHook({
    installedHook: targetHook,
    root: repositoryRoot,
    sourceHook,
  });
  const existing = existingHookContent(targetHook);
  if (existing !== null && existing !== expected && !existing.includes(managedMarker)) {
    throw new Error(
      `Existing pre-push hook is not repository-managed; leaving it unchanged: ${targetHook}`,
    );
  }
  publishHook(hooksDirectory, targetHook, expected);
  console.log("Installed repository-managed pre-push hook.");
  return true;
}

if (process.argv[1] === modulePath) {
  try {
    installGitHooks();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
