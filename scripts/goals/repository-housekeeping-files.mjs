/** Owns held-parent, identity-checked filesystem I/O for repository housekeeping transactions. */
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { resolveFrameworkPath, sha256 } from "../contracts/framework-contract.mjs";
import {
  ensureOwnedDirectoryChain,
  removeOwnedEmptyDirectory,
} from "../filesystem/owned-file-operations.mjs";
import {
  closeOwnedDirectoryBinding,
  listOwnedDirectory,
  openOwnedDirectoryBinding,
  ownedDirectoryChildPath,
  readStableOwnedFile,
  safeArtifactStats,
  sameObjectIdentity,
  sameStableIdentity,
  validateOwnedDirectoryBinding,
} from "../filesystem/owned-path-safety.mjs";

export const housekeepingStateDirectory = ".project-state/repository-housekeeping";
export const housekeepingJournalPath = `${housekeepingStateDirectory}/journal.json`;
export const maximumJournalBytes = 48 * 1024 * 1024;
export const maximumTransactionContentBytes = 32 * 1024 * 1024;

export function decodeStableUtf8(buffer, label) {
  const content = buffer.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(buffer)) {
    throw new Error(`${label} must contain valid UTF-8 text.`);
  }
  return content;
}

export function assertHousekeepingDirectory(root, relativeDirectory) {
  const directory = relativeDirectory
    ? resolveFrameworkPath(root, relativeDirectory)
    : path.resolve(root);
  const binding = openOwnedDirectoryBinding(root, directory, "repository housekeeping directory");
  closeOwnedDirectoryBinding(binding);
}

export function ensureHousekeepingDirectory(root, relativeDirectory) {
  ensureOwnedDirectoryChain(root, relativeDirectory, "repository housekeeping state", {
    createdMode: 0o755,
  });
}

export function syncHousekeepingDirectory(
  root,
  directory,
  label = "repository housekeeping directory",
) {
  const binding = openOwnedDirectoryBinding(root, directory, label);
  try {
    fsyncSync(binding.descriptor);
    validateOwnedDirectoryBinding(binding, label);
  } finally {
    closeOwnedDirectoryBinding(binding);
  }
}

export function readHousekeepingRegularState(root, relativePath) {
  const target = resolveFrameworkPath(root, relativePath);
  const binding = openOwnedDirectoryBinding(
    root,
    path.dirname(target),
    `repository housekeeping ${relativePath} parent`,
  );
  try {
    const basename = path.basename(target);
    const boundTarget = ownedDirectoryChildPath(binding, basename, relativePath);
    const initial = lstatSync(boundTarget, { throwIfNoEntry: false });
    if (!initial) {
      validateOwnedDirectoryBinding(binding, `${relativePath} parent`);
      return Object.freeze({ content: "", exists: false, mode: null, sha256: null, stats: null });
    }
    const snapshot = readStableOwnedFile(binding, basename, relativePath, {
      maximumBytes: maximumTransactionContentBytes,
    });
    const content = decodeStableUtf8(snapshot.buffer, relativePath);
    return Object.freeze({
      content,
      exists: true,
      mode: snapshot.stats.mode & 0o777,
      sha256: sha256(content),
      stats: snapshot.stats,
    });
  } finally {
    closeOwnedDirectoryBinding(binding);
  }
}

export function writeHousekeepingTemporary(root, relativePath, content, mode) {
  const target = resolveFrameworkPath(root, relativePath);
  const label = `repository housekeeping temporary ${relativePath}`;
  const binding = openOwnedDirectoryBinding(root, path.dirname(target), `${label} parent`);
  let descriptor;
  try {
    const boundTarget = ownedDirectoryChildPath(binding, path.basename(target), label);
    descriptor = openSync(
      boundTarget,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      mode,
    );
    fchmodSync(descriptor, mode);
    writeFileSync(descriptor, content, "utf8");
    fsyncSync(descriptor);
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.nlink !== 1 || (stats.mode & 0o777) !== mode) {
      throw new Error(`Repository housekeeping created an unsafe temporary for ${relativePath}.`);
    }
    validateOwnedDirectoryBinding(binding, `${label} parent`);
    fsyncSync(binding.descriptor);
    return stats;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    closeOwnedDirectoryBinding(binding);
  }
}

export function replaceHousekeepingRegularFile({
  expectedSource,
  expectedTarget,
  label,
  root,
  sourceRelativePath,
  targetRelativePath,
  testHooks,
}) {
  if (path.posix.dirname(sourceRelativePath) !== path.posix.dirname(targetRelativePath)) {
    throw new Error(`Repository housekeeping refused a cross-directory replacement in ${label}.`);
  }
  const source = resolveFrameworkPath(root, sourceRelativePath);
  const target = resolveFrameworkPath(root, targetRelativePath);
  const binding = openOwnedDirectoryBinding(root, path.dirname(target), `${label} parent`);
  try {
    const boundSource = ownedDirectoryChildPath(binding, path.basename(source), label);
    const boundTarget = ownedDirectoryChildPath(binding, path.basename(target), label);
    const sourceStats = safeArtifactStats(boundSource, "file", label);
    if (!sameStableIdentity(expectedSource, sourceStats)) {
      throw new Error(`Repository housekeeping detected a changed source in ${label}.`);
    }
    const targetStats = lstatSync(boundTarget, { throwIfNoEntry: false });
    if (
      (expectedTarget &&
        (!targetStats ||
          !sameStableIdentity(expectedTarget, safeArtifactStats(boundTarget, "file", label)))) ||
      (!expectedTarget && targetStats)
    ) {
      throw new Error(`Repository housekeeping detected a changed target in ${label}.`);
    }
    testHooks?.beforeBoundRename?.({ binding, label, source, target });
    validateOwnedDirectoryBinding(binding, `${label} parent`);
    renameSync(boundSource, boundTarget);
    testHooks?.afterBoundRenameBeforeSync?.({ binding, label, source, target });
    fsyncSync(binding.descriptor);
    const published = safeArtifactStats(boundTarget, "file", label);
    if (!sameObjectIdentity(sourceStats, published)) {
      throw new Error(
        `Repository housekeeping detected a replacement identity change in ${label}.`,
      );
    }
    validateOwnedDirectoryBinding(binding, `${label} parent`);
    return published;
  } finally {
    closeOwnedDirectoryBinding(binding);
  }
}

export function restoreHousekeepingContent({
  content,
  mode,
  relativePath,
  root,
  temporaryRelativePath,
  testHooks,
}) {
  const expectedTarget = readHousekeepingRegularState(root, relativePath);
  const temporary = writeHousekeepingTemporary(root, temporaryRelativePath, content, mode);
  return replaceHousekeepingRegularFile({
    expectedSource: temporary,
    expectedTarget: expectedTarget.stats,
    label: `restoring ${relativePath}`,
    root,
    sourceRelativePath: temporaryRelativePath,
    targetRelativePath: relativePath,
    testHooks,
  });
}

export function housekeepingStatePaths(root) {
  return {
    journal: resolveFrameworkPath(root, housekeepingJournalPath),
    projectState: resolveFrameworkPath(root, path.posix.dirname(housekeepingStateDirectory)),
    repositoryRoot: root,
    root: resolveFrameworkPath(root, housekeepingStateDirectory),
  };
}

export function listHousekeepingDirectory(root, directory, label) {
  const binding = openOwnedDirectoryBinding(root, directory, label);
  try {
    return listOwnedDirectory(binding, label);
  } finally {
    closeOwnedDirectoryBinding(binding);
  }
}

export function statHousekeepingPublication(root, target, label) {
  const repositoryRoot = path.resolve(root);
  const requestedParent = path.dirname(path.resolve(target));
  let existingParent = requestedParent;
  while (
    existingParent !== repositoryRoot &&
    !lstatSync(existingParent, { throwIfNoEntry: false })
  ) {
    existingParent = path.dirname(existingParent);
  }
  const binding = openOwnedDirectoryBinding(root, existingParent, `${label} parent`);
  try {
    if (existingParent !== requestedParent) {
      const firstMissingSegment = path.relative(existingParent, requestedParent).split(path.sep)[0];
      const rebound = ownedDirectoryChildPath(binding, firstMissingSegment, label);
      if (lstatSync(rebound, { throwIfNoEntry: false })) {
        throw new Error(`Repository housekeeping detected a changed parent in ${label}.`);
      }
      validateOwnedDirectoryBinding(binding, `${label} parent`);
      return null;
    }
    const boundTarget = ownedDirectoryChildPath(binding, path.basename(target), label);
    const stats = lstatSync(boundTarget, { throwIfNoEntry: false });
    validateOwnedDirectoryBinding(binding, `${label} parent`);
    return stats ?? null;
  } finally {
    closeOwnedDirectoryBinding(binding);
  }
}

export function publishHousekeepingJournalLink({
  expectedTemporary,
  paths,
  root,
  temporary,
  testHooks,
}) {
  const binding = openOwnedDirectoryBinding(root, paths.root, "repository housekeeping state");
  try {
    const boundTemporary = ownedDirectoryChildPath(
      binding,
      path.basename(temporary),
      "repository housekeeping journal temporary",
    );
    const boundJournal = ownedDirectoryChildPath(
      binding,
      path.basename(paths.journal),
      "repository housekeeping journal",
    );
    const before = safeArtifactStats(
      boundTemporary,
      "file",
      "repository housekeeping journal temporary",
    );
    if (!sameStableIdentity(expectedTemporary, before)) {
      throw new Error("Repository housekeeping journal temporary changed before publication.");
    }
    testHooks?.beforeBoundJournalLink?.({ binding, journal: paths.journal, temporary });
    validateOwnedDirectoryBinding(binding, "repository housekeeping state");
    linkSync(boundTemporary, boundJournal);
    fsyncSync(binding.descriptor);
    const journalStats = lstatSync(boundJournal);
    const temporaryStats = lstatSync(boundTemporary);
    if (
      journalStats.dev !== temporaryStats.dev ||
      journalStats.ino !== temporaryStats.ino ||
      journalStats.nlink !== 2
    ) {
      throw new Error(
        "Repository housekeeping journal publication is inconsistent; manual recovery is required.",
      );
    }
    validateOwnedDirectoryBinding(binding, "repository housekeeping state");
    testHooks?.afterJournalLink?.();
    return { journalStats, temporaryStats };
  } finally {
    closeOwnedDirectoryBinding(binding);
  }
}

export function removeHousekeepingRegularFile({
  expectedIdentity,
  label,
  root,
  target,
  testHooks,
}) {
  const binding = openOwnedDirectoryBinding(root, path.dirname(target), `${label} parent`);
  try {
    const boundTarget = ownedDirectoryChildPath(binding, path.basename(target), label);
    const current = lstatSync(boundTarget);
    if (!current.isFile() || !sameStableIdentity(expectedIdentity, current)) {
      throw new Error(`${label} changed before unlink; manual recovery is required.`);
    }
    testHooks?.beforeUnlink?.({ binding, label, target });
    validateOwnedDirectoryBinding(binding, `${label} parent`);
    unlinkSync(boundTarget);
    testHooks?.afterUnlinkBeforeSync?.({ binding, label, target });
    fsyncSync(binding.descriptor);
    validateOwnedDirectoryBinding(binding, `${label} parent`);
    testHooks?.afterUnlink?.({ binding, label, target });
  } finally {
    closeOwnedDirectoryBinding(binding);
  }
}

export function removeCompletedHousekeepingState({ root, state, testHooks }) {
  const { paths } = state;
  const entries = listHousekeepingDirectory(root, paths.root, "repository housekeeping state");
  if (entries.length !== 1 || entries[0] !== path.basename(paths.journal)) {
    throw new Error(
      "Repository housekeeping state contains unaccounted files; manual recovery is required.",
    );
  }
  removeHousekeepingRegularFile({
    expectedIdentity: state.journalStats,
    label: "repository housekeeping journal",
    root,
    target: paths.journal,
    testHooks: {
      afterUnlink: testHooks?.afterJournalRemove,
      afterUnlinkBeforeSync: testHooks?.afterJournalRemoveBeforeSync,
      beforeUnlink: testHooks?.beforeJournalRemove,
    },
  });
  if (!removeOwnedEmptyDirectory(root, paths.root, "repository housekeeping state")) {
    throw new Error(
      "Repository housekeeping state could not be removed; manual recovery is required.",
    );
  }
  if (
    listHousekeepingDirectory(root, paths.projectState, "repository project state").length === 0 &&
    !removeOwnedEmptyDirectory(root, paths.projectState, "repository project state")
  ) {
    throw new Error("Repository project state could not be removed; manual recovery is required.");
  }
}

export function readHousekeepingJournalFile(root, journalPath) {
  const binding = openOwnedDirectoryBinding(
    root,
    path.dirname(journalPath),
    "repository housekeeping journal parent",
  );
  let descriptor;
  try {
    const boundJournal = ownedDirectoryChildPath(
      binding,
      path.basename(journalPath),
      "repository housekeeping journal",
    );
    const initial = lstatSync(boundJournal);
    if (
      initial.isSymbolicLink() ||
      !initial.isFile() ||
      initial.nlink < 1 ||
      initial.nlink > 2 ||
      (initial.mode & 0o777) !== 0o600 ||
      initial.size > maximumJournalBytes
    ) {
      throw new Error("Repository housekeeping journal is unsafe; manual recovery is required.");
    }
    descriptor = openSync(boundJournal, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!sameStableIdentity(initial, opened)) {
      throw new Error(
        "Repository housekeeping journal changed during read; manual recovery is required.",
      );
    }
    const buffer = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (!sameStableIdentity(opened, after) || buffer.length !== after.size) {
      throw new Error(
        "Repository housekeeping journal changed during read; manual recovery is required.",
      );
    }
    validateOwnedDirectoryBinding(binding, "repository housekeeping journal parent");
    return { buffer, stats: after };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    closeOwnedDirectoryBinding(binding);
  }
}
