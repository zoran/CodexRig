/** Owns crash-recoverable local file transactions for the repository housekeeping boundary. */
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import {
  normalizeFrameworkPath,
  resolveFrameworkPath,
  serializeCanonicalJson,
  sha256,
} from "../contracts/framework-contract.mjs";
import { removeOwnedEmptyDirectory } from "../filesystem/owned-file-operations.mjs";
import {
  assertHousekeepingDirectory,
  decodeStableUtf8,
  ensureHousekeepingDirectory,
  housekeepingStateDirectory,
  housekeepingStatePaths,
  listHousekeepingDirectory,
  maximumJournalBytes,
  maximumTransactionContentBytes,
  publishHousekeepingJournalLink,
  readHousekeepingJournalFile,
  readHousekeepingRegularState,
  removeCompletedHousekeepingState,
  removeHousekeepingRegularFile,
  replaceHousekeepingRegularFile,
  restoreHousekeepingContent,
  statHousekeepingPublication,
  syncHousekeepingDirectory,
  writeHousekeepingTemporary,
} from "./repository-housekeeping-files.mjs";

export { housekeepingStateDirectory };

const journalSchemaVersion = 1;
const maximumTransactionWrites = 64;
const publicationTemporaryPattern =
  /^\.journal-(?<pid>[1-9][0-9]*)-(?<transactionId>[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.tmp$/u;
const transactionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const activeTransactionIds = new Set();

function recoveryFailure(detail) {
  throw new Error(`${detail}; manual recovery is required.`);
}
function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}
function transactionOwnerIsActive(owner, allowedOwnerPid) {
  if (owner.pid === allowedOwnerPid) return false;
  if (owner.pid === process.pid) return activeTransactionIds.has(owner.transactionId);
  return processIsAlive(owner.pid);
}
function assertExactKeys(value, expectedKeys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== [...expectedKeys].sort().join("\0")
  ) {
    recoveryFailure(`${label} is invalid`);
  }
}
function plannedTransaction(root, writes) {
  if (!Array.isArray(writes) || writes.length === 0) return null;
  if (writes.length > maximumTransactionWrites) {
    throw new Error(
      `Repository housekeeping transactions are limited to ${maximumTransactionWrites} writes.`,
    );
  }
  const transactionId = randomUUID();
  const seen = new Set();
  let contentBytes = 0;
  const journal = {
    ownerPid: process.pid,
    schemaVersion: journalSchemaVersion,
    transactionId,
    writes: writes.map((write, index) => {
      if (
        !write ||
        typeof write !== "object" ||
        typeof write.relativePath !== "string" ||
        typeof write.before !== "string" ||
        typeof write.after !== "string"
      ) {
        throw new Error("Repository housekeeping received an invalid write plan.");
      }
      const relativePath = normalizeFrameworkPath(
        write.relativePath,
        "repository housekeeping write path",
      );
      if (seen.has(relativePath)) {
        throw new Error(`Repository housekeeping planned ${relativePath} more than once.`);
      }
      seen.add(relativePath);
      const directory = path.posix.dirname(relativePath);
      assertHousekeepingDirectory(root, directory === "." ? "" : directory);
      const before = readHousekeepingRegularState(root, relativePath);
      if (before.content !== write.before) {
        throw new Error(`${relativePath} changed after repository housekeeping planned it.`);
      }
      if (before.exists && before.content === write.after) {
        throw new Error(`${relativePath} does not contain repository housekeeping drift.`);
      }
      contentBytes += Buffer.byteLength(before.content) + Buffer.byteLength(write.after);
      if (contentBytes > maximumTransactionContentBytes) {
        throw new Error(
          `Repository housekeeping journal content is limited to ${maximumTransactionContentBytes} bytes.`,
        );
      }
      const temporaryName = `.codexrig-housekeeping-${transactionId}-${index}.tmp`;
      return {
        afterContent: Buffer.from(write.after).toString("base64"),
        afterMode: before.mode ?? 0o644,
        afterSha256: sha256(write.after),
        beforeContent: Buffer.from(before.content).toString("base64"),
        beforeExists: before.exists,
        beforeMode: before.mode,
        beforeSha256: before.sha256,
        relativePath,
        temporaryRelativePath: directory === "." ? temporaryName : `${directory}/${temporaryName}`,
      };
    }),
  };
  if (Buffer.byteLength(serializeCanonicalJson(journal)) > maximumJournalBytes) {
    throw new Error(`Repository housekeeping journal is limited to ${maximumJournalBytes} bytes.`);
  }
  return journal;
}
function decodedContent(record, key) {
  const encoded = record[key];
  if (typeof encoded !== "string" || encoded.length % 4 !== 0) {
    recoveryFailure("Housekeeping journal content is invalid");
  }
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.toString("base64") !== encoded) {
    recoveryFailure("Housekeeping journal content is invalid");
  }
  const content = decoded.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(decoded)) {
    recoveryFailure("Housekeeping journal content is not valid UTF-8");
  }
  return content;
}
function validateJournal(journal) {
  assertExactKeys(
    journal,
    ["ownerPid", "schemaVersion", "transactionId", "writes"],
    "Repository housekeeping journal",
  );
  if (
    journal.schemaVersion !== journalSchemaVersion ||
    !Number.isSafeInteger(journal.ownerPid) ||
    journal.ownerPid <= 0 ||
    typeof journal.transactionId !== "string" ||
    !transactionIdPattern.test(journal.transactionId) ||
    !Array.isArray(journal.writes) ||
    journal.writes.length === 0 ||
    journal.writes.length > maximumTransactionWrites
  ) {
    recoveryFailure("Repository housekeeping journal is invalid");
  }
  const seen = new Set();
  let contentBytes = 0;
  for (const [index, record] of journal.writes.entries()) {
    assertExactKeys(
      record,
      [
        "afterContent",
        "afterMode",
        "afterSha256",
        "beforeContent",
        "beforeExists",
        "beforeMode",
        "beforeSha256",
        "relativePath",
        "temporaryRelativePath",
      ],
      "Repository housekeeping journal record",
    );
    const relativePath = normalizeFrameworkPath(record?.relativePath, "housekeeping journal path");
    const directory = path.posix.dirname(relativePath);
    const expectedTemporary = `${directory === "." ? "" : `${directory}/`}.codexrig-housekeeping-${journal.transactionId}-${index}.tmp`;
    const beforeContent = decodedContent(record, "beforeContent");
    const afterContent = decodedContent(record, "afterContent");
    contentBytes += Buffer.byteLength(beforeContent) + Buffer.byteLength(afterContent);
    if (
      seen.has(relativePath) ||
      record.temporaryRelativePath !== expectedTemporary ||
      typeof record.beforeExists !== "boolean" ||
      (record.beforeExists
        ? !Number.isInteger(record.beforeMode) || record.beforeMode < 0 || record.beforeMode > 0o777
        : record.beforeMode !== null || record.beforeSha256 !== null || beforeContent !== "") ||
      !Number.isInteger(record.afterMode) ||
      record.afterMode < 0 ||
      record.afterMode > 0o777 ||
      typeof record.afterSha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(record.afterSha256) ||
      (record.beforeExists && sha256(beforeContent) !== record.beforeSha256) ||
      (!record.beforeExists && record.beforeSha256 !== null) ||
      (record.beforeExists && !/^[0-9a-f]{64}$/u.test(record.beforeSha256)) ||
      sha256(afterContent) !== record.afterSha256 ||
      contentBytes > maximumTransactionContentBytes
    ) {
      recoveryFailure("Repository housekeeping journal is invalid");
    }
    seen.add(relativePath);
  }
  return journal;
}
function publicationTemporaryName(ownerPid, transactionId) {
  return `.journal-${ownerPid}-${transactionId}.tmp`;
}
function persistJournal(root, journal, testHooks) {
  ensureHousekeepingDirectory(root, housekeepingStateDirectory);
  const paths = housekeepingStatePaths(root);
  const temporaryName = publicationTemporaryName(journal.ownerPid, journal.transactionId);
  const temporaryRelativePath = `${housekeepingStateDirectory}/${temporaryName}`;
  const temporary = resolveFrameworkPath(root, temporaryRelativePath);
  const serialized = serializeCanonicalJson(journal);
  const initialTemporary = writeHousekeepingTemporary(
    root,
    temporaryRelativePath,
    serialized,
    0o600,
  );
  testHooks?.afterJournalTemporaryWrite?.();
  let linked = false;
  try {
    const published = publishHousekeepingJournalLink({
      expectedTemporary: initialTemporary,
      paths,
      root,
      temporary,
      testHooks,
    });
    linked = true;
    removeHousekeepingRegularFile({
      expectedIdentity: published.temporaryStats,
      label: "repository housekeeping journal publication temporary",
      root,
      target: temporary,
      testHooks: { beforeUnlink: testHooks?.beforePublicationTemporaryUnlink },
    });
  } catch (error) {
    const journalState = statHousekeepingPublication(
      root,
      paths.journal,
      "repository housekeeping journal",
    );
    const current = statHousekeepingPublication(
      root,
      temporary,
      "repository housekeeping journal temporary",
    );
    if (
      journalState &&
      current &&
      journalState.dev === current.dev &&
      journalState.ino === current.ino
    ) {
      linked = true;
    }
    if (!linked) {
      if (current) {
        removeHousekeepingRegularFile({
          expectedIdentity: current,
          label: "repository housekeeping journal temporary",
          root,
          target: temporary,
        });
      }
    }
    if (error?.code === "EEXIST") {
      throw new Error("Another repository housekeeping transaction already owns the journal.");
    }
    throw error;
  }
  testHooks?.afterJournalPersist?.();
  return statHousekeepingPublication(root, paths.journal, "repository housekeeping journal");
}
function publicationTemporaryOwner(entry) {
  const match = publicationTemporaryPattern.exec(entry);
  if (!match) return null;
  const pid = Number(match.groups.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  return { pid, transactionId: match.groups.transactionId };
}
function readBoundedJournal(root, journalPath) {
  try {
    const { buffer, stats } = readHousekeepingJournalFile(root, journalPath);
    return {
      journal: validateJournal(
        JSON.parse(decodeStableUtf8(buffer, "Repository housekeeping journal")),
      ),
      stats,
    };
  } catch (error) {
    if (/manual recovery is required/u.test(error.message)) throw error;
    recoveryFailure("Repository housekeeping journal is invalid");
  }
}
function inspectState(root) {
  const paths = housekeepingStatePaths(root);
  const rootStats = statHousekeepingPublication(root, paths.root, "repository housekeeping state");
  if (!rootStats) {
    return { journal: null, paths, publicationTemporaries: [], stateExists: false };
  }
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    recoveryFailure("Repository housekeeping state is unsafe");
  }
  const entries = listHousekeepingDirectory(root, paths.root, "repository housekeeping state");
  if (!entries.includes(path.basename(paths.journal))) {
    const publicationTemporaries = entries.map((entry) => ({
      entry,
      owner: publicationTemporaryOwner(entry),
      target: path.join(paths.root, entry),
    }));
    if (publicationTemporaries.some(({ owner }) => owner === null)) {
      recoveryFailure("Repository housekeeping state is incomplete");
    }
    return { journal: null, paths, publicationTemporaries, stateExists: true };
  }
  const { journal, stats } = readBoundedJournal(root, paths.journal);
  const publicationTemporaries = entries
    .filter((entry) => entry !== path.basename(paths.journal))
    .map((entry) => ({
      entry,
      owner: publicationTemporaryOwner(entry),
      target: path.join(paths.root, entry),
    }));
  if (publicationTemporaries.some(({ owner }) => owner === null)) {
    recoveryFailure("Repository housekeeping state contains unaccounted files");
  }
  return { journal, journalStats: stats, paths, publicationTemporaries, stateExists: true };
}
function matchesState(state, record, prefix) {
  return (
    state.exists === record[`${prefix}Exists`] &&
    state.mode === record[`${prefix}Mode`] &&
    state.sha256 === record[`${prefix}Sha256`]
  );
}
function temporaryState(root, relativePath) {
  const target = resolveFrameworkPath(root, relativePath);
  const state = readHousekeepingRegularState(root, relativePath);
  if (!state.exists) return null;
  return {
    mode: state.mode,
    sha256: state.sha256,
    stats: state.stats,
    target,
  };
}
function expectedTemporaryState(root, relativePath, mode, digest, label) {
  const state = temporaryState(root, relativePath);
  if (state && (state.mode !== mode || state.sha256 !== digest)) {
    recoveryFailure(`${label} is unrelated`);
  }
  return state;
}
function removeTemporary(root, state, testHook) {
  if (!state) return;
  removeHousekeepingRegularFile({
    expectedIdentity: state.stats,
    label: "repository housekeeping recovery temporary",
    root,
    target: state.target,
    testHooks: { beforeUnlink: testHook },
  });
}
function cleanupPublicationTemporaries(root, state, allowedOwnerPid, testHooks) {
  const expectedPublicationTemporary = state.journal
    ? publicationTemporaryName(state.journal.ownerPid, state.journal.transactionId)
    : null;
  const matchingExpected = state.publicationTemporaries.filter(
    ({ entry }) => entry === expectedPublicationTemporary,
  );
  if (
    state.journal &&
    ((state.journalStats.nlink === 2 && matchingExpected.length !== 1) ||
      (state.journalStats.nlink === 1 && matchingExpected.length !== 0))
  ) {
    recoveryFailure("Repository housekeeping journal publication is inconsistent");
  }
  for (const temporary of state.publicationTemporaries) {
    const stats = statHousekeepingPublication(
      root,
      temporary.target,
      "housekeeping publication temporary",
    );
    if (!stats) recoveryFailure("Repository housekeeping publication state disappeared");
    const isExpectedPublication = temporary.entry === expectedPublicationTemporary;
    if (transactionOwnerIsActive(temporary.owner, allowedOwnerPid)) {
      throw new Error("Another repository housekeeping transaction is active.");
    }
    if (
      stats.isSymbolicLink() ||
      !stats.isFile() ||
      (isExpectedPublication
        ? (stats.mode & 0o777) !== 0o600
        : ((stats.mode & 0o777) | 0o600) !== 0o600) ||
      stats.nlink !== (isExpectedPublication ? 2 : 1)
    ) {
      recoveryFailure("Repository housekeeping publication state is unsafe");
    }
    if (isExpectedPublication) {
      const journalStats = statHousekeepingPublication(
        root,
        state.paths.journal,
        "repository housekeeping journal",
      );
      if (stats.dev !== journalStats.dev || stats.ino !== journalStats.ino) {
        recoveryFailure("Repository housekeeping journal publication is inconsistent");
      }
      removeHousekeepingRegularFile({
        expectedIdentity: stats,
        label: "repository housekeeping publication temporary",
        root,
        target: temporary.target,
        testHooks: {
          afterUnlinkBeforeSync: testHooks?.afterPublicationTemporaryRemoveBeforeSync,
          beforeUnlink: testHooks?.beforePublicationTemporaryRemove,
        },
      });
    } else {
      removeHousekeepingRegularFile({
        expectedIdentity: stats,
        label: "abandoned housekeeping publication",
        root,
        target: temporary.target,
        testHooks: {
          afterUnlinkBeforeSync: testHooks?.afterPublicationTemporaryRemoveBeforeSync,
          beforeUnlink: testHooks?.beforePublicationTemporaryRemove,
        },
      });
    }
  }
  if (state.journal) {
    state.journalStats = statHousekeepingPublication(
      root,
      state.paths.journal,
      "repository housekeeping journal",
    );
  }
}
function removeAbandonedStateWithoutJournal(root, state, allowedOwnerPid, testHooks) {
  cleanupPublicationTemporaries(root, state, allowedOwnerPid, testHooks);
  if (
    listHousekeepingDirectory(root, state.paths.root, "repository housekeeping state").length !== 0
  ) {
    recoveryFailure("Repository housekeeping state contains unaccounted files");
  }
  if (!removeOwnedEmptyDirectory(root, state.paths.root, "repository housekeeping state")) {
    recoveryFailure("Repository housekeeping state could not be removed");
  }
  if (
    listHousekeepingDirectory(root, state.paths.projectState, "repository project state").length ===
      0 &&
    !removeOwnedEmptyDirectory(root, state.paths.projectState, "repository project state")
  ) {
    recoveryFailure("Repository project state could not be removed");
  }
}
function restorationTemporaryPath(record, transactionId, index) {
  const directory = path.posix.dirname(record.relativePath);
  const temporaryName = `.codexrig-housekeeping-restore-${transactionId}-${index}.tmp`;
  return directory === "." ? temporaryName : `${directory}/${temporaryName}`;
}
function recoverInterruptedHousekeepingWritesInternal(root, allowedOwnerPid = null, testHooks) {
  const state = inspectState(root);
  if (!state.journal) {
    if (!state.stateExists) return false;
    removeAbandonedStateWithoutJournal(root, state, allowedOwnerPid, testHooks);
    return true;
  }
  const { journal } = state;
  if (
    transactionOwnerIsActive(
      { pid: journal.ownerPid, transactionId: journal.transactionId },
      allowedOwnerPid,
    )
  ) {
    throw new Error("Another repository housekeeping transaction is active.");
  }
  cleanupPublicationTemporaries(root, state, allowedOwnerPid, testHooks);
  const inspected = journal.writes.map((record, index) => {
    const current = readHousekeepingRegularState(root, record.relativePath);
    const beforeRecord = { ...record, beforeExists: record.beforeExists };
    const afterRecord = { ...record, afterExists: true };
    if (
      !matchesState(current, beforeRecord, "before") &&
      !matchesState(current, afterRecord, "after")
    ) {
      throw new Error(
        `Repository housekeeping recovery found an unrelated change in ${record.relativePath}; manual recovery is required.`,
      );
    }
    const afterTemporary = expectedTemporaryState(
      root,
      record.temporaryRelativePath,
      record.afterMode,
      record.afterSha256,
      `Repository housekeeping temporary for ${record.relativePath}`,
    );
    const restorationRelativePath = restorationTemporaryPath(record, journal.transactionId, index);
    const restorationTemporary = record.beforeExists
      ? expectedTemporaryState(
          root,
          restorationRelativePath,
          record.beforeMode,
          record.beforeSha256,
          `Repository housekeeping recovery temporary for ${record.relativePath}`,
        )
      : temporaryState(root, restorationRelativePath);
    if (!record.beforeExists && restorationTemporary) {
      throw new Error(
        `Repository housekeeping found an unexpected recovery temporary for ${record.relativePath}; manual recovery is required.`,
      );
    }
    return {
      after: matchesState(current, afterRecord, "after"),
      afterTemporary,
      record,
      restorationRelativePath,
      restorationTemporary,
    };
  });
  if (inspected.every((entry) => entry.after)) {
    for (const entry of inspected) {
      removeTemporary(root, entry.afterTemporary, testHooks?.beforeRecoveryTemporaryRemove);
      removeTemporary(root, entry.restorationTemporary, testHooks?.beforeRecoveryTemporaryRemove);
    }
    for (const entry of inspected) {
      const current = readHousekeepingRegularState(root, entry.record.relativePath);
      const afterRecord = { ...entry.record, afterExists: true };
      if (!matchesState(current, afterRecord, "after")) {
        throw new Error(
          `Repository housekeeping recovery found a concurrent change in ${entry.record.relativePath}; manual recovery is required.`,
        );
      }
    }
    for (const directory of new Set(
      inspected.map((entry) => path.dirname(resolveFrameworkPath(root, entry.record.relativePath))),
    )) {
      syncHousekeepingDirectory(root, directory);
    }
    removeCompletedHousekeepingState({ root, state, testHooks });
    return true;
  }

  for (const entry of [...inspected].reverse()) {
    const { record } = entry;
    const target = resolveFrameworkPath(root, record.relativePath);
    const current = readHousekeepingRegularState(root, record.relativePath);
    const beforeRecord = { ...record, beforeExists: record.beforeExists };
    const afterRecord = { ...record, afterExists: true };
    if (
      !matchesState(current, beforeRecord, "before") &&
      !matchesState(current, afterRecord, "after")
    ) {
      throw new Error(
        `Repository housekeeping recovery found a concurrent change in ${record.relativePath}; manual recovery is required.`,
      );
    }
    const currentlyAfter = matchesState(current, afterRecord, "after");
    if (record.beforeExists) {
      if (currentlyAfter) {
        if (entry.restorationTemporary) {
          replaceHousekeepingRegularFile({
            expectedSource: entry.restorationTemporary.stats,
            expectedTarget: current.stats,
            label: `recovering ${record.relativePath}`,
            root,
            sourceRelativePath: entry.restorationRelativePath,
            targetRelativePath: record.relativePath,
            testHooks: { beforeBoundRename: testHooks?.beforeRecoveryRestoreRename },
          });
        } else {
          restoreHousekeepingContent({
            content: decodedContent(record, "beforeContent"),
            mode: record.beforeMode,
            relativePath: record.relativePath,
            root,
            temporaryRelativePath: entry.restorationRelativePath,
            testHooks: { beforeBoundRename: testHooks?.beforeRecoveryRestoreRename },
          });
        }
      } else {
        removeTemporary(root, entry.restorationTemporary, testHooks?.beforeRecoveryTemporaryRemove);
      }
    } else if (currentlyAfter) {
      removeHousekeepingRegularFile({
        expectedIdentity: current.stats,
        label: `recovering ${record.relativePath}`,
        root,
        target,
        testHooks: {
          afterUnlinkBeforeSync: testHooks?.afterRecoveryTargetRemoveBeforeSync,
          beforeUnlink: testHooks?.beforeRecoveryTargetRemove,
        },
      });
    }
    removeTemporary(root, entry.afterTemporary, testHooks?.beforeRecoveryTemporaryRemove);
  }
  for (const record of journal.writes) {
    const current = readHousekeepingRegularState(root, record.relativePath);
    if (!matchesState(current, record, "before")) {
      throw new Error(
        `Repository housekeeping could not restore ${record.relativePath}; manual recovery is required.`,
      );
    }
  }
  removeCompletedHousekeepingState({ root, state, testHooks });
  return true;
}

export function recoverInterruptedHousekeepingWrites(root, { testHooks } = {}) {
  return recoverInterruptedHousekeepingWritesInternal(root, null, testHooks);
}

export function applyHousekeepingWrites({ root, testHooks, writes }) {
  recoverInterruptedHousekeepingWrites(root);
  const journal = plannedTransaction(root, writes);
  if (!journal) return;
  activeTransactionIds.add(journal.transactionId);
  try {
    const journalStats = persistJournal(root, journal, testHooks);
    for (const [index, record] of journal.writes.entries()) {
      const current = readHousekeepingRegularState(root, record.relativePath);
      if (!matchesState(current, record, "before")) {
        throw new Error(
          `${record.relativePath} changed before repository housekeeping could apply.`,
        );
      }
      const directory = path.posix.dirname(record.relativePath);
      assertHousekeepingDirectory(root, directory === "." ? "" : directory);
      const temporary = writeHousekeepingTemporary(
        root,
        record.temporaryRelativePath,
        decodedContent(record, "afterContent"),
        record.afterMode,
      );
      testHooks?.afterTargetTemporaryWrite?.({ index, record });
      replaceHousekeepingRegularFile({
        expectedSource: temporary,
        expectedTarget: current.stats,
        label: `applying ${record.relativePath}`,
        root,
        sourceRelativePath: record.temporaryRelativePath,
        targetRelativePath: record.relativePath,
        testHooks: {
          afterBoundRenameBeforeSync: () => testHooks?.afterTargetRename?.({ index, record }),
          beforeBoundRename: (details) =>
            testHooks?.beforeBoundTargetRename?.({ ...details, index, record }),
        },
      });
      testHooks?.afterTargetDirectorySync?.({ index, record });
    }
    for (const record of journal.writes) {
      const current = readHousekeepingRegularState(root, record.relativePath);
      const afterRecord = { ...record, afterExists: true };
      if (!matchesState(current, afterRecord, "after")) {
        throw new Error(
          `${record.relativePath} changed before repository housekeeping could finalize.`,
        );
      }
    }
    testHooks?.beforeJournalRemoval?.();
    removeCompletedHousekeepingState({
      root,
      state: { journalStats, paths: housekeepingStatePaths(root) },
      testHooks,
    });
  } catch (error) {
    try {
      recoverInterruptedHousekeepingWritesInternal(root, process.pid, testHooks);
    } catch (recoveryError) {
      throw new Error(
        `Repository housekeeping failed and durable recovery stopped safely: ${recoveryError.message}`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    activeTransactionIds.delete(journal.transactionId);
  }
}
