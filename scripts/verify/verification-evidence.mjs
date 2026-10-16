/** Owns verification evidence behavior for the repository verification boundary. */
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { listPortableTransferFiles } from "../repository/source-inventory.mjs";
import {
  captureStableRepositoryFileIdentity,
  readStableRepositoryFile,
} from "../repository/stable-file-snapshot.mjs";
import {
  captureVerificationGitBasis,
  normalizedVerificationGitBasis,
} from "./verification-git-basis.mjs";
import {
  normalizedVerificationRiskFingerprints,
  verificationRiskFingerprint,
  verificationRiskForPath,
} from "./verification-risk-profile.mjs";
import { normalizedVerificationRuntimeIdentity } from "./verification-runtime-identity.mjs";
import { assertVerificationSessionLockOwned } from "./verification-session-lock.mjs";
import { resolveDeliveryArtifactBinding } from "./delivery-artifact.mjs";
import {
  fullVerificationEvidenceRecord,
  refreshedVerificationEvidenceRecord,
  checkpointVerificationEvidenceRecord,
} from "./verification-evidence-record.mjs";
import { canonicalJson, digest } from "./verification-record-helpers.mjs";
import { executableFingerprint } from "./verification-source-inputs.mjs";
import { failVerificationEvidence as fail } from "./verification-evidence-error.mjs";
import {
  readVerificationEvidence as readEvidence,
  verificationEvidenceCachePath,
  writeVerificationEvidence as writeEvidence,
} from "./verification-evidence-store.mjs";
export { VerificationEvidenceError } from "./verification-evidence-error.mjs";
export { verificationEvidenceCachePath };
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDirectory, "..", "..");
const maximumSourceFiles = 50_000;
const maximumSourceFileBytes = 64 * 1024 * 1024;
const maximumSourceBytes = 512 * 1024 * 1024;
const allowedPlanPhases = new Set([
  "preflight",
  "broad",
  "workspace-build",
  "workspace-test",
  "delivery",
]);
const allowedDeliveryEnvironments = new Set(["dev", "staging", "prod"]);

function normalizedDeliveryIdentity(root, deliveryEnvironment = "dev", artifactManifest = "") {
  if (!allowedDeliveryEnvironments.has(deliveryEnvironment)) {
    fail("Verification evidence received an invalid delivery environment.");
  }
  try {
    const binding = resolveDeliveryArtifactBinding({
      root,
      artifactManifest,
      targetEnvironment: deliveryEnvironment,
    });
    return Object.freeze({
      artifactDigest: binding.artifactDigest,
      artifactManifest: binding.artifactManifest,
      configurationDigest: binding.configurationDigest,
      deliveryEnvironment: binding.targetEnvironment,
      deliveryPlanDigest: binding.deliveryPlanDigest,
      sourceCommit: binding.sourceCommit,
    });
  } catch (error) {
    fail(error.message);
  }
}

function normalizedBroadPlan(broadPlan) {
  if (!Array.isArray(broadPlan) || broadPlan.length > 1_000) {
    fail("Verification evidence requires a bounded broad command plan.");
  }
  const normalized = broadPlan.map((command, index) => {
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      fail(`Verification evidence broad command ${index + 1} is invalid.`);
    }
    const {
      args,
      artifactOwners = [],
      executable,
      key,
      phase,
      diagnosticAfterMs = 300000,
      cancellable = false,
      coveredTestPaths = [],
    } = command;
    if (
      typeof key !== "string" ||
      !/^[a-z0-9][a-z0-9:_-]*$/.test(key) ||
      typeof executable !== "string" ||
      !executable ||
      executable.length > 1_024 ||
      /[\0\r\n]/.test(executable) ||
      !allowedPlanPhases.has(phase) ||
      !Number.isSafeInteger(diagnosticAfterMs) ||
      diagnosticAfterMs <= 0 ||
      typeof cancellable !== "boolean" ||
      !Array.isArray(coveredTestPaths) ||
      coveredTestPaths.some((file) => typeof file !== "string" || /[\0\r\n]/u.test(file)) ||
      !Array.isArray(args) ||
      args.length > 256 ||
      args.some(
        (argument) =>
          typeof argument !== "string" || argument.length > 4_096 || /[\0\r\n]/.test(argument),
      ) ||
      !Array.isArray(artifactOwners) ||
      artifactOwners.length > 256 ||
      artifactOwners.some(
        (owner, ownerIndex) =>
          typeof owner !== "string" ||
          !owner ||
          owner.length > 4_096 ||
          /[\0\r\n]/u.test(owner) ||
          owner === artifactOwners[ownerIndex - 1],
      )
    ) {
      fail(`Verification evidence broad command ${index + 1} is invalid.`);
    }
    return Object.freeze({
      args: [...args],
      artifactOwners: [...artifactOwners],
      executable: executable === process.execPath ? "node" : executable,
      key,
      phase,
      diagnosticAfterMs,
      cancellable,
      coveredTestPaths,
    });
  });
  const uniqueKeys = new Set();
  for (const command of normalized) {
    if (uniqueKeys.has(command.key)) {
      fail(`Verification evidence plan duplicates command key ${command.key}.`);
    }
    uniqueKeys.add(command.key);
  }
  const parallel = normalized
    .filter((command) => ["preflight", "broad"].includes(command.phase))
    .sort(
      (left, right) =>
        left.key.localeCompare(right.key) ||
        canonicalJson(left).localeCompare(canonicalJson(right)),
    );
  return Object.freeze([
    ...parallel,
    ...normalized.filter((command) => command.phase === "workspace-build"),
    ...normalized.filter((command) => command.phase === "workspace-test"),
    ...normalized.filter((command) => command.phase === "delivery"),
  ]);
}

function normalizedSuccessfulCommandKeys(successfulCommandKeys) {
  if (
    !Array.isArray(successfulCommandKeys) ||
    successfulCommandKeys.length > 2_000 ||
    successfulCommandKeys.some(
      (key, index) =>
        typeof key !== "string" ||
        !/^[a-z0-9][a-z0-9:_-]*$/u.test(key) ||
        successfulCommandKeys.indexOf(key) !== index,
    )
  ) {
    fail("Verification evidence requires a bounded unique successful-command set.");
  }
  return new Set(successfulCommandKeys);
}

function planCommandKeys(broadPlan) {
  return normalizedBroadPlan(broadPlan).map((command) => command.key);
}

function planDigest(broadPlan) {
  return digest(canonicalJson(normalizedBroadPlan(broadPlan)));
}

function modeOf(root, relativePath, expectedIdentity) {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  const before = lstatSync(absolutePath, { bigint: true });
  const after = captureStableRepositoryFileIdentity({
    repositoryRoot: root,
    relativePath,
  });
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.nlink !== 1n ||
    after.identity !== expectedIdentity
  ) {
    fail("Verification evidence detected an unsafe source-file identity.");
  }
  return Number(before.mode & 0o7777n);
}

function fingerprintFiles(root, files) {
  const exact = createHash("sha256").update("verification-exact-v1\0");
  const broad = createHash("sha256").update("verification-broad-v1\0");
  const riskFingerprints = [];
  const sourceFiles = [];
  let rootManifestContent = "";
  let totalBytes = 0;
  for (const relativePath of files) {
    const captured = captureStableRepositoryFileIdentity({
      repositoryRoot: root,
      relativePath,
    });
    if (captured.bytes > maximumSourceFileBytes) {
      fail("Verification evidence source inventory contains an oversized file.");
    }
    totalBytes += captured.bytes;
    if (totalBytes > maximumSourceBytes) {
      fail("Verification evidence source inventory exceeds its byte bound.");
    }
    const read = readStableRepositoryFile({
      repositoryRoot: root,
      relativePath,
      expectedIdentity: captured.identity,
    });
    const mode = modeOf(root, relativePath, read.identity);
    const prefix = `${relativePath.length}:${relativePath}\0${mode.toString(8)}\0${read.bytes}\0`;
    exact.update(prefix).update(read.buffer).update("\0");
    sourceFiles.push({
      path: relativePath,
      fingerprint: digest(`${mode}\0${digest(read.buffer)}`),
      semanticFingerprint: digest(
        `${mode & 0o111}\0${executableFingerprint(root, relativePath, read.buffer)}`,
      ),
    });
    const risk = verificationRiskForPath(relativePath);
    if (risk) {
      broad.update(prefix).update(read.buffer).update("\0");
      riskFingerprints.push(
        verificationRiskFingerprint({ buffer: read.buffer, path: relativePath, prefix, ...risk }),
      );
    }
    if (relativePath === "package.json") rootManifestContent = read.buffer.toString("utf8");
  }
  return {
    broadFingerprint: broad.digest("hex"),
    exactFingerprint: exact.digest("hex"),
    riskFingerprints: normalizedVerificationRiskFingerprints(
      riskFingerprints.sort(
        (left, right) =>
          left.riskId.localeCompare(right.riskId) || left.path.localeCompare(right.path),
      ),
    ),
    rootManifestContent,
    sourceFiles,
  };
}

function repositoryFingerprints(root) {
  const files = listPortableTransferFiles({ root, includeUntracked: true }).sort();
  if (files.length > maximumSourceFiles || files.some((item, index) => item === files[index - 1])) {
    fail("Verification evidence received an invalid portable source inventory.");
  }
  const fingerprints = fingerprintFiles(root, files);
  const after = listPortableTransferFiles({ root, includeUntracked: true }).sort();
  if (files.join("\0") !== after.join("\0")) {
    fail("Verification evidence detected a source-inventory change while hashing.");
  }
  return fingerprints;
}

export function currentVerificationEvidenceInputs({
  root = defaultRoot,
  broadPlan,
  runtimeIdentity,
  deliveryEnvironment = "dev",
  artifactManifest = "",
} = {}) {
  const canonicalRoot = realpathSync.native(path.resolve(root));
  const plan = normalizedBroadPlan(broadPlan);
  const runtime = normalizedVerificationRuntimeIdentity(runtimeIdentity, { cwd: canonicalRoot });
  const fingerprints = repositoryFingerprints(canonicalRoot);
  const delivery = normalizedDeliveryIdentity(canonicalRoot, deliveryEnvironment, artifactManifest);
  return Object.freeze({
    ...fingerprints,
    ...delivery,
    planDigest: digest(canonicalJson(plan)),
    runtime,
    runtimeDigest: digest(canonicalJson(runtime)),
  });
}

function sameInputs(left, right) {
  return (
    left?.broadFingerprint === right?.broadFingerprint &&
    left?.exactFingerprint === right?.exactFingerprint &&
    left?.artifactDigest === right?.artifactDigest &&
    left?.artifactManifest === right?.artifactManifest &&
    left?.configurationDigest === right?.configurationDigest &&
    left?.deliveryEnvironment === right?.deliveryEnvironment &&
    left?.deliveryPlanDigest === right?.deliveryPlanDigest &&
    left?.planDigest === right?.planDigest &&
    left?.runtimeDigest === right?.runtimeDigest &&
    left?.sourceCommit === right?.sourceCommit &&
    canonicalJson(left?.riskFingerprints) === canonicalJson(right?.riskFingerprints)
  );
}

function sameGitBasis(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function currentBasisToken(record) {
  return digest(canonicalJson(record.current));
}

function publishEvidence({
  root,
  record,
  inputs,
  gitBasis,
  broadPlan,
  runtimeIdentity,
  deliveryEnvironment,
  artifactManifest,
}) {
  assertVerificationSessionLockOwned({ repositoryRoot: root });
  writeEvidence(root, record);
  const publishedInputs = currentVerificationEvidenceInputs({
    root,
    broadPlan,
    runtimeIdentity,
    deliveryEnvironment,
    artifactManifest,
  });
  const publishedGitBasis = captureVerificationGitBasis({ repositoryRoot: root });
  if (!sameInputs(inputs, publishedInputs) || !sameGitBasis(gitBasis, publishedGitBasis)) {
    fail("Repository, plan, or runtime changed while publishing verification evidence.");
  }
}

export function readSuccessfulVerificationBasis({
  root = defaultRoot,
  broadPlan,
  deliveryEnvironment = "dev",
  artifactManifest = "",
} = {}) {
  try {
    const record = readEvidence(root);
    if (!record.current) throw new Error("Publication coverage has not yet been completed.");
    if (broadPlan !== undefined && planDigest(broadPlan) !== record.current.planDigest) {
      throw new Error("Successful verification command plan changed.");
    }
    const delivery = normalizedDeliveryIdentity(root, deliveryEnvironment, artifactManifest);
    if (
      record.current.deliveryEnvironment !== delivery.deliveryEnvironment ||
      record.current.artifactDigest !== delivery.artifactDigest ||
      record.current.artifactManifest !== delivery.artifactManifest ||
      record.current.configurationDigest !== delivery.configurationDigest ||
      record.current.deliveryPlanDigest !== delivery.deliveryPlanDigest ||
      record.current.sourceCommit !== delivery.sourceCommit
    ) {
      throw new Error("Successful verification delivery target or artifact changed.");
    }
    const gitBasis = normalizedVerificationGitBasis(record.current.gitBasis);
    return Object.freeze({
      current: record.current,
      reason: gitBasis.complete ? "" : "successful evidence has no complete Git basis",
      token: currentBasisToken(record),
      trusted: gitBasis.complete,
    });
  } catch (error) {
    return Object.freeze({
      reason: error.message,
      token: "",
      trusted: false,
    });
  }
}

export function readVerificationCheckpoint({ root = defaultRoot } = {}) {
  try {
    const record = readEvidence(root);
    return { checks: record.checks, sourceFiles: record.observedFiles };
  } catch {
    return { checks: [], sourceFiles: [] };
  }
}

/** Persist independent successes even after failure, only for the unchanged execution snapshot. */
export function recordVerificationCheckpoint({
  root = defaultRoot,
  checks,
  expectedInputs,
  expectedGitBasis,
  broadPlan,
  runtimeIdentity,
  deliveryEnvironment = "dev",
  artifactManifest = "",
  failed = false,
}) {
  const inputs = currentVerificationEvidenceInputs({
    root,
    broadPlan,
    runtimeIdentity,
    deliveryEnvironment,
    artifactManifest,
  });
  const gitBasis = captureVerificationGitBasis({ repositoryRoot: root });
  if (!sameInputs(inputs, expectedInputs) || !sameGitBasis(gitBasis, expectedGitBasis))
    fail(
      "Repository, Git basis, plan, or runtime changed during verification; results were not recorded.",
    );
  let previous;
  try {
    previous = readEvidence(root);
  } catch {
    previous = null;
  }
  if (failed && previous?.current?.fingerprint === inputs.exactFingerprint) previous = null;
  publishEvidence({
    root,
    record: checkpointVerificationEvidenceRecord(previous, checks, inputs.sourceFiles),
    inputs,
    gitBasis,
    broadPlan,
    runtimeIdentity,
    deliveryEnvironment,
    artifactManifest,
  });
}

export function recordSuccessfulFullEvidence({
  root = defaultRoot,
  broadPlan,
  runtimeIdentity,
  deliveryEnvironment = "dev",
  artifactManifest = "",
  expectedInputs,
  expectedGitBasis,
  successfulCommandKeys,
} = {}) {
  if (!expectedInputs || !expectedGitBasis) {
    fail("Full verification evidence requires its pre-gate snapshots.");
  }
  const successful = normalizedSuccessfulCommandKeys(successfulCommandKeys);
  const missing = planCommandKeys(broadPlan).filter((key) => !successful.has(key));
  if (missing.length > 0) {
    fail(`Full verification evidence is missing successful commands: ${missing.join(", ")}.`);
  }
  const current = currentVerificationEvidenceInputs({
    root,
    broadPlan,
    runtimeIdentity,
    deliveryEnvironment,
    artifactManifest,
  });
  const gitBasis = captureVerificationGitBasis({ repositoryRoot: root });
  if (!sameInputs(current, expectedInputs) || !sameGitBasis(gitBasis, expectedGitBasis)) {
    fail("Repository, Git basis, plan, or runtime changed during complete verification.");
  }
  const checkpoint = readVerificationCheckpoint({ root });
  publishEvidence({
    root,
    record: checkpointVerificationEvidenceRecord(
      fullVerificationEvidenceRecord(current, gitBasis),
      checkpoint.checks,
      current.sourceFiles,
    ),
    inputs: current,
    gitBasis,
    broadPlan,
    runtimeIdentity,
    deliveryEnvironment,
    artifactManifest,
  });
  return Object.freeze({ gitBasis, recorded: true, inputs: current });
}

/** Bind already complete evidence to its committed Git state without accepting source deltas. */
export function refreshCommittedVerificationEvidence({
  root = defaultRoot,
  broadPlan,
  runtimeIdentity,
  deliveryEnvironment = "dev",
  artifactManifest = "",
  expectedInputs,
  expectedGitBasis,
  expectedBasisToken,
} = {}) {
  try {
    if (!expectedInputs || !expectedGitBasis || !expectedBasisToken) {
      fail("Committed evidence refresh requires its complete basis and current snapshots.");
    }
    const record = readEvidence(root);
    if (!record.current || currentBasisToken(record) !== expectedBasisToken) {
      fail("Successful verification basis changed during committed evidence refresh.");
    }
    const current = currentVerificationEvidenceInputs({
      root,
      broadPlan,
      runtimeIdentity,
      deliveryEnvironment,
      artifactManifest,
    });
    const gitBasis = captureVerificationGitBasis({ repositoryRoot: root });
    if (!sameInputs(current, expectedInputs) || !sameGitBasis(gitBasis, expectedGitBasis)) {
      fail("Repository, Git basis, plan, or runtime changed during committed evidence refresh.");
    }
    if (!sameInputs({ ...record.current, exactFingerprint: record.current.fingerprint }, current)) {
      fail("Git-basis refresh cannot accept changed source, plan, runtime or delivery inputs.");
    }
    if (!gitBasis.complete || gitBasis.dirtyPaths.length > 0) {
      fail("Committed evidence refresh requires a complete clean Git basis.");
    }
    if (sameGitBasis(record.current.gitBasis, gitBasis)) {
      return Object.freeze({ alreadyCurrent: true, inputs: current, refreshed: true });
    }
    publishEvidence({
      root,
      record: refreshedVerificationEvidenceRecord(record, current, gitBasis),
      inputs: current,
      gitBasis,
      broadPlan,
      runtimeIdentity,
      deliveryEnvironment,
      artifactManifest,
    });
    return Object.freeze({ gitBasis, inputs: current, refreshed: true });
  } catch (error) {
    return Object.freeze({ reason: error.message, refreshed: false });
  }
}

export function validateExactCurrentEvidence({
  root = defaultRoot,
  broadPlan,
  runtimeIdentity,
  deliveryEnvironment = "dev",
  artifactManifest = "",
} = {}) {
  const record = readEvidence(root);
  if (!record.current)
    fail(
      "Verification evidence has partial results only; run publication verification before push.",
    );
  const current = currentVerificationEvidenceInputs({
    root,
    broadPlan,
    runtimeIdentity,
    deliveryEnvironment,
    artifactManifest,
  });
  const gitBasis = captureVerificationGitBasis({ repositoryRoot: root });
  const findings = [];
  if (record.current.broadFingerprint !== current.broadFingerprint) {
    findings.push("broad verification inputs changed");
  }
  if (record.current.planDigest !== current.planDigest) findings.push("broad command plan changed");
  if (record.current.runtimeDigest !== current.runtimeDigest) findings.push("tool runtime changed");
  if (
    record.current.deliveryEnvironment !== current.deliveryEnvironment ||
    record.current.artifactDigest !== current.artifactDigest ||
    record.current.artifactManifest !== current.artifactManifest ||
    record.current.configurationDigest !== current.configurationDigest ||
    record.current.deliveryPlanDigest !== current.deliveryPlanDigest ||
    record.current.sourceCommit !== current.sourceCommit
  ) {
    findings.push("delivery target or artifact changed");
  }
  if (record.current.fingerprint !== current.exactFingerprint) {
    findings.push("current repository state is not attested");
  }
  if (!gitBasis.complete || !sameGitBasis(record.current.gitBasis, gitBasis)) {
    findings.push("current Git basis is not attested");
  }
  if (findings.length > 0) {
    fail(
      "Verification evidence is stale; recompute adaptive changed-path or publication admission.",
      findings,
    );
  }
  return Object.freeze({ gitBasis, inputs: current, record, valid: true });
}
