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
  changedVerificationRisks,
  normalizedVerificationRiskFingerprints,
  verificationRiskFingerprint,
  verificationRiskForPath,
} from "./verification-risk-profile.mjs";
import { normalizedVerificationRuntimeIdentity } from "./verification-runtime-identity.mjs";
import { assertVerificationSessionLockOwned } from "./verification-session-lock.mjs";
import {
  fullVerificationEvidenceRecord,
  refreshedVerificationEvidenceRecord,
} from "./verification-evidence-record.mjs";
import { canonicalJson, digest } from "./verification-record-helpers.mjs";
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
const allowedPlanPhases = new Set(["preflight", "broad", "workspace-build", "workspace-test"]);

function normalizedBroadPlan(broadPlan) {
  if (!Array.isArray(broadPlan) || broadPlan.length > 1_000) {
    fail("Verification evidence requires a bounded broad command plan.");
  }
  const normalized = broadPlan.map((command, index) => {
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      fail(`Verification evidence broad command ${index + 1} is invalid.`);
    }
    const { args, artifactOwners = [], executable, key, phase } = command;
    if (
      typeof key !== "string" ||
      !/^[a-z0-9][a-z0-9:_-]*$/.test(key) ||
      typeof executable !== "string" ||
      !executable ||
      executable.length > 1_024 ||
      /[\0\r\n]/.test(executable) ||
      !allowedPlanPhases.has(phase) ||
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
} = {}) {
  const canonicalRoot = realpathSync.native(path.resolve(root));
  const plan = normalizedBroadPlan(broadPlan);
  const runtime = normalizedVerificationRuntimeIdentity(runtimeIdentity, { cwd: canonicalRoot });
  const fingerprints = repositoryFingerprints(canonicalRoot);
  return Object.freeze({
    ...fingerprints,
    planDigest: digest(canonicalJson(plan)),
    runtime,
    runtimeDigest: digest(canonicalJson(runtime)),
  });
}

function sameInputs(left, right) {
  return (
    left?.broadFingerprint === right?.broadFingerprint &&
    left?.exactFingerprint === right?.exactFingerprint &&
    left?.planDigest === right?.planDigest &&
    left?.runtimeDigest === right?.runtimeDigest &&
    canonicalJson(left?.riskFingerprints) === canonicalJson(right?.riskFingerprints)
  );
}

function sameGitBasis(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function currentBasisToken(record) {
  return digest(canonicalJson(record.current));
}

function publishEvidence({ root, record, inputs, gitBasis, broadPlan, runtimeIdentity }) {
  assertVerificationSessionLockOwned({ repositoryRoot: root });
  writeEvidence(root, record);
  const publishedInputs = currentVerificationEvidenceInputs({ root, broadPlan, runtimeIdentity });
  const publishedGitBasis = captureVerificationGitBasis({ repositoryRoot: root });
  if (!sameInputs(inputs, publishedInputs) || !sameGitBasis(gitBasis, publishedGitBasis)) {
    fail("Repository, plan, or runtime changed while publishing verification evidence.");
  }
}

export function readSuccessfulVerificationBasis({ root = defaultRoot, broadPlan } = {}) {
  try {
    const record = readEvidence(root);
    if (broadPlan !== undefined && planDigest(broadPlan) !== record.current.planDigest) {
      throw new Error("Successful verification command plan changed.");
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

export function recordSuccessfulFullEvidence({
  root = defaultRoot,
  broadPlan,
  runtimeIdentity,
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
  const current = currentVerificationEvidenceInputs({ root, broadPlan, runtimeIdentity });
  const gitBasis = captureVerificationGitBasis({ repositoryRoot: root });
  if (!sameInputs(current, expectedInputs) || !sameGitBasis(gitBasis, expectedGitBasis)) {
    fail("Repository, Git basis, plan, or runtime changed during complete verification.");
  }
  publishEvidence({
    root,
    record: fullVerificationEvidenceRecord(current, gitBasis),
    inputs: current,
    gitBasis,
    broadPlan,
    runtimeIdentity,
  });
  return Object.freeze({ gitBasis, recorded: true, inputs: current });
}

export function refreshExactAttestationAfterPreflight({
  root = defaultRoot,
  broadPlan,
  runtimeIdentity,
  expectedInputs,
  expectedGitBasis,
  expectedBasisToken,
  successfulCommandKeys,
  coverage,
} = {}) {
  try {
    if (!expectedInputs || !expectedGitBasis || !expectedBasisToken) {
      fail("Changed-path evidence refresh requires its basis and preflight snapshots.");
    }
    if (
      !coverage ||
      coverage.complete !== true ||
      !Array.isArray(coverage.paths) ||
      (coverage.paths.length === 0 && coverage.basisChanged !== true) ||
      coverage.paths.length > maximumSourceFiles ||
      coverage.paths.some(
        (item, index) =>
          typeof item !== "string" ||
          !item ||
          /[\0\r\n]/u.test(item) ||
          coverage.paths.indexOf(item) !== index,
      ) ||
      !Array.isArray(coverage.focusedCommandOwners) ||
      !Array.isArray(coverage.broadRisks)
    ) {
      fail("Changed-path evidence refresh requires complete nonempty owner coverage.");
    }
    const successful = normalizedSuccessfulCommandKeys(successfulCommandKeys);
    const record = readEvidence(root);
    if (currentBasisToken(record) !== expectedBasisToken) {
      fail("Successful verification basis changed during changed-path preflight.");
    }
    const current = currentVerificationEvidenceInputs({ root, broadPlan, runtimeIdentity });
    const gitBasis = captureVerificationGitBasis({ repositoryRoot: root });
    if (!sameInputs(current, expectedInputs) || !sameGitBasis(gitBasis, expectedGitBasis)) {
      fail("Repository, Git basis, plan, or runtime changed during changed-path preflight.");
    }
    if (
      record.current.planDigest !== current.planDigest ||
      record.current.runtimeDigest !== current.runtimeDigest
    ) {
      return Object.freeze({
        reason: "broad plan or runtime changed; recompute adaptive admission",
        refreshed: false,
      });
    }
    const ownersByPath = new Map();
    for (const owner of coverage.focusedCommandOwners) {
      if (
        !owner ||
        typeof owner !== "object" ||
        Array.isArray(owner) ||
        Object.keys(owner).sort().join("\n") !== "ownerKeys\npath" ||
        typeof owner.path !== "string" ||
        !owner.path ||
        /[\0\r\n]/u.test(owner.path) ||
        !Array.isArray(owner.ownerKeys) ||
        owner.ownerKeys.length === 0 ||
        owner.ownerKeys.some(
          (key, index) =>
            typeof key !== "string" ||
            !/^[a-z0-9][a-z0-9:_-]*$/u.test(key) ||
            owner.ownerKeys.indexOf(key) !== index,
        ) ||
        ownersByPath.has(owner.path)
      ) {
        fail("Changed-path evidence contains invalid focused command ownership.");
      }
      ownersByPath.set(owner.path, owner.ownerKeys);
    }
    for (const changedPath of coverage.paths) {
      const ownerKeys = ownersByPath.get(changedPath);
      if (!ownerKeys || ownerKeys.some((key) => !successful.has(key))) {
        return Object.freeze({
          reason: `changed path ${changedPath} lacks successful focused owner coverage`,
          refreshed: false,
        });
      }
    }
    const coveredRiskKeys = new Set();
    for (const risk of coverage.broadRisks) {
      if (
        !risk ||
        typeof risk !== "object" ||
        Array.isArray(risk) ||
        typeof risk.path !== "string" ||
        !risk.path ||
        typeof risk.riskId !== "string" ||
        !/^[a-z0-9][a-z0-9-]*$/u.test(risk.riskId) ||
        !Array.isArray(risk.ownerKeys) ||
        risk.ownerKeys.length === 0 ||
        risk.ownerKeys.some((key) => !successful.has(key))
      ) {
        fail("Changed-path evidence contains invalid named-risk coverage.");
      }
      coveredRiskKeys.add(`${risk.riskId}\0${risk.path}`);
    }
    const uncoveredRisk = changedVerificationRisks(
      record.current.riskFingerprints,
      current.riskFingerprints,
    ).find((risk) => !coveredRiskKeys.has(`${risk.riskId}\0${risk.path}`));
    if (uncoveredRisk) {
      return Object.freeze({
        reason: `named broad risk ${uncoveredRisk.riskId} at ${uncoveredRisk.path} lacks focused coverage`,
        refreshed: false,
      });
    }
    if (
      record.current.fingerprint === current.exactFingerprint &&
      sameGitBasis(record.current.gitBasis, gitBasis)
    ) {
      return Object.freeze({ alreadyCurrent: true, inputs: current, refreshed: true });
    }
    if (
      coverage.paths.length === 0 &&
      (record.current.fingerprint !== current.exactFingerprint ||
        record.current.broadFingerprint !== current.broadFingerprint ||
        record.current.planDigest !== current.planDigest ||
        record.current.runtimeDigest !== current.runtimeDigest ||
        canonicalJson(record.current.riskFingerprints) !== canonicalJson(current.riskFingerprints))
    ) {
      return Object.freeze({
        reason: "basis-only advancement cannot cover changed repository or runtime inputs",
        refreshed: false,
      });
    }
    publishEvidence({
      root,
      record: refreshedVerificationEvidenceRecord(record, current, gitBasis),
      inputs: current,
      gitBasis,
      broadPlan,
      runtimeIdentity,
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
} = {}) {
  const record = readEvidence(root);
  const current = currentVerificationEvidenceInputs({ root, broadPlan, runtimeIdentity });
  const gitBasis = captureVerificationGitBasis({ repositoryRoot: root });
  const findings = [];
  if (record.current.broadFingerprint !== current.broadFingerprint) {
    findings.push("broad verification inputs changed");
  }
  if (record.current.planDigest !== current.planDigest) findings.push("broad command plan changed");
  if (record.current.runtimeDigest !== current.runtimeDigest) findings.push("tool runtime changed");
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
