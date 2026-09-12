#!/usr/bin/env node
/** Owns framework upgrade behavior for the framework lifecycle and child upgrade boundary. */
import { existsSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  compareSemver,
  frameworkRoot,
  isReusableFrameworkSource,
  listManagedFrameworkFiles,
  managedPackageSnapshot,
  readCompatibilityMatrix,
  readFrameworkContract,
  readInstallationReceipt,
  readRegularFrameworkFile,
  resolveFrameworkPath,
  serializeCanonicalJson,
  sha256,
} from "../contracts/framework-contract.mjs";
import { readFrameworkUpgradeTargetState } from "./framework-upgrade-target.mjs";
import {
  atomicWriteUpgradeFile,
  ensureUpgradeDirectoryChain,
  managedUpgradeSourceState,
  realUpgradeDirectory,
  targetUpgradeFileState,
} from "./framework-upgrade-io.mjs";
import {
  authorizeFrameworkUpgradeOutput,
  beginFrameworkUpgrade,
  persistFrameworkUpgradeJournal,
  readFrameworkUpgradeJournal,
  recoverFrameworkUpgradeState,
  removeFrameworkUpgradeState,
  restoreFrameworkUpgradeJournal,
} from "./framework-upgrade-journal.mjs";
import { buildUpgradedReceipt } from "./framework-upgrade-receipt.mjs";
import { frameworkUpgradeValuesEqual, packageUpdatePlan } from "./framework-upgrade-package.mjs";
import { policyProjectionChanges, readPolicyProjection } from "./policy-projection.mjs";
import { projectOwnedUpgradeDocumentPaths } from "../docs/project-document-policy.mjs";
import {
  createExclusiveOwnedDirectory,
  removeOwnedArtifact,
  removeOwnedRegularFile,
} from "../filesystem/owned-file-operations.mjs";
import { spawnRuntimeLifecycleCommandSync } from "../repository/runtime-lifecycle-process.mjs";
import {
  acquireRuntimeLifecycleLock,
  assertRuntimeLifecycleQuiescent,
  releaseRuntimeLifecycleLock,
} from "../repository/runtime-session-lease.mjs";

const projectDocumentReconciliationReason =
  "Managed capabilities were updated, while project-owned documents remain unchanged. Reconcile each listed policy concept into local truth, preserve intentional project adaptations, and obtain explicit user confirmation whenever a critical-document correction or full preservation is uncertain.";

function validatedUpgradeSourceContract(source) {
  if (!isReusableFrameworkSource(source)) {
    throw new Error("Framework upgrade source must be a reusable CodexRig source checkout.");
  }
  const contract = readFrameworkContract(source);
  readCompatibilityMatrix(source, contract);
  readPolicyProjection(source);
  let packageJson;
  try {
    packageJson = JSON.parse(readRegularFrameworkFile(source, "package.json"));
  } catch {
    throw new Error("Framework upgrade source package.json is invalid.");
  }
  if (
    packageJson?.name !== "codexrig" ||
    packageJson.private !== true ||
    packageJson.version !== contract.frameworkVersion
  ) {
    throw new Error("Framework upgrade source package identity does not match its contract.");
  }
  return contract;
}

export function buildFrameworkUpgradePlan({ sourceRoot, targetRoot = frameworkRoot }) {
  const source = realUpgradeDirectory(sourceRoot, "framework upgrade source");
  const target = realUpgradeDirectory(targetRoot, "framework upgrade target");
  if (source === target) throw new Error("Framework upgrade source and target must differ.");
  if (isReusableFrameworkSource(target)) {
    throw new Error(
      "The reusable CodexRig source is upgraded through Git, not project upgrade receipts.",
    );
  }
  const sourceContract = validatedUpgradeSourceContract(source);
  const targetState = readFrameworkUpgradeTargetState(target);
  const targetContract = targetState.contract;
  if (sourceContract.upgrade.receiptFile !== targetContract.upgrade.receiptFile) {
    throw new Error("Framework upgrade source and target receipt paths must match.");
  }
  const receipt = targetState.receipt;
  const targetInputSnapshots = Object.fromEntries(
    [targetContract.upgrade.receiptFile, "package.json"].map((relativePath) => {
      const state = targetUpgradeFileState(target, relativePath);
      if (!state.exists)
        throw new Error(`Missing framework upgrade target input: ${relativePath}.`);
      return [relativePath, { mode: state.mode, sha256: state.sha256 }];
    }),
  );
  if (receipt.pendingReconciliation) {
    throw new Error(
      `Framework reconciliation ${receipt.pendingReconciliation.planDigest} is still pending; reconcile and acknowledge it before another update.`,
    );
  }
  if (sourceContract.frameworkId !== receipt.frameworkId) {
    throw new Error("Framework upgrade source belongs to another framework.");
  }
  const comparison = compareSemver(sourceContract.frameworkVersion, receipt.frameworkVersion);
  if (comparison <= 0) {
    throw new Error(
      comparison < 0
        ? "Framework downgrade is not supported."
        : "Framework source is not newer than the installed version.",
    );
  }

  const installedProjection = targetState.policyProjection;
  const sourceProjection = readPolicyProjection(source);
  const policyChanges = policyProjectionChanges(installedProjection, sourceProjection);

  const desiredPaths = listManagedFrameworkFiles(source, sourceContract);
  const removedProjectDocumentClassifications = targetContract.upgrade.projectOwnedDocuments.filter(
    (relativePath) => !sourceContract.upgrade.projectOwnedDocuments.includes(relativePath),
  );
  if (removedProjectDocumentClassifications.length > 0) {
    throw new Error(
      `Framework upgrade source must preserve installed project-owned document classifications: ${removedProjectDocumentClassifications.join(
        ", ",
      )}.`,
    );
  }
  const projectOwnedDocumentPaths = [
    ...new Set([
      ...projectOwnedUpgradeDocumentPaths,
      ...targetContract.upgrade.projectOwnedDocuments,
      ...sourceContract.upgrade.projectOwnedDocuments,
    ]),
  ].sort();
  const projectOwnedDocumentPathSet = new Set(projectOwnedDocumentPaths);
  const sourceManagedProjectDocuments = desiredPaths.filter((relativePath) =>
    projectOwnedDocumentPathSet.has(relativePath),
  );
  if (sourceManagedProjectDocuments.length > 0) {
    throw new Error(
      `Framework upgrade source must not manage project-owned documents: ${sourceManagedProjectDocuments.join(
        ", ",
      )}.`,
    );
  }
  const previouslyManagedProjectDocuments = Object.keys(receipt.managedFiles)
    .filter((relativePath) => projectOwnedDocumentPathSet.has(relativePath))
    .sort();
  const allPaths = new Set([
    ...Object.keys(receipt.managedFiles).filter(
      (relativePath) => !projectOwnedDocumentPathSet.has(relativePath),
    ),
    ...desiredPaths,
  ]);
  const desiredSet = new Set(desiredPaths);
  const operations = [];
  const conflicts = [];
  const adoptedPaths = [];
  const sourceManagedFiles = {};

  for (const relativePath of [...allPaths].sort()) {
    const old = receipt.managedFiles[relativePath] ?? null;
    const current = targetUpgradeFileState(target, relativePath);
    const desired = desiredSet.has(relativePath)
      ? managedUpgradeSourceState(source, relativePath)
      : null;
    if (desired) {
      sourceManagedFiles[relativePath] = {
        mode: desired.mode,
        sha256: sha256(desired.content),
      };
    }
    if (!old) {
      if (
        current.exists &&
        desired &&
        current.sha256 === sha256(desired.content) &&
        current.mode === desired.mode
      ) {
        adoptedPaths.push(relativePath);
      } else if (current.exists) conflicts.push(relativePath);
      else {
        operations.push({
          action: "write",
          content: desired.content,
          expected: null,
          expectedMode: null,
          mode: desired.mode,
          path: relativePath,
        });
      }
      continue;
    }
    if (!current.exists) {
      if (desired) conflicts.push(relativePath);
      continue;
    }
    const locallyUnchanged = current.sha256 === old.sha256 && current.mode === old.mode;
    if (!desired) {
      if (locallyUnchanged) {
        operations.push({
          action: "delete",
          expected: current.sha256,
          expectedMode: current.mode,
          mode: null,
          path: relativePath,
        });
      } else conflicts.push(relativePath);
      continue;
    }
    const frameworkUnchanged = sha256(desired.content) === old.sha256 && desired.mode === old.mode;
    const alreadyDesired =
      current.sha256 === sha256(desired.content) && current.mode === desired.mode;
    if (alreadyDesired) continue;
    if (!locallyUnchanged) {
      if (!frameworkUnchanged) conflicts.push(relativePath);
      continue;
    }
    if (!frameworkUnchanged) {
      operations.push({
        action: "write",
        content: desired.content,
        expected: current.sha256,
        expectedMode: current.mode,
        mode: desired.mode,
        path: relativePath,
      });
    }
  }

  const sourceManagedPackage = managedPackageSnapshot(source, sourceContract);
  const packagePlan = packageUpdatePlan({
    preservePackageManager: sourceContract.upgrade.projectOwnedDocuments.includes(
      sourceContract.compatibilityFile,
    ),
    receipt,
    sourceManaged: sourceManagedPackage,
    targetRoot: target,
  });
  conflicts.push(...packagePlan.conflicts);
  if (packagePlan.operation) operations.push(packagePlan.operation);
  const sortedConflicts = [...new Set(conflicts)].sort();
  const publicOperations = operations
    .map(({ action, path: relativePath }) => ({ action, path: relativePath }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const reconciliationPaths = [
    ...new Set(policyChanges.flatMap((change) => change.documents)),
  ].sort();
  const projectDocumentReconciliation = {
    paths: reconciliationPaths,
    policies: policyChanges,
    previouslyManagedPaths: previouslyManagedProjectDocuments,
    reason: projectDocumentReconciliationReason,
    required: policyChanges.length > 0,
  };
  const digest = sha256(
    JSON.stringify({
      from: receipt.frameworkVersion,
      operations: operations.map((operation) => ({
        action: operation.action,
        contentSha256: operation.action === "write" ? sha256(operation.content) : null,
        expected: operation.expected,
        expectedMode: operation.expectedMode ?? null,
        mode: operation.mode,
        path: operation.path,
      })),
      package: sha256(JSON.stringify(sourceManagedPackage)),
      projectDocumentReconciliation,
      sourceManagedFiles,
      targetInputSnapshots,
      to: sourceContract.frameworkVersion,
    }),
  );
  return {
    conflicts: sortedConflicts,
    adoptedPaths: adoptedPaths.sort(),
    digest,
    fromVersion: receipt.frameworkVersion,
    managedPaths: desiredPaths,
    operations,
    projectDocumentReconciliation,
    publicOperations,
    sourceContract,
    sourceSnapshot: {
      frameworkVersion: sourceContract.frameworkVersion,
      managedFiles: sourceManagedFiles,
      managedPackage: sourceManagedPackage,
    },
    sourceRoot: source,
    targetRoot: target,
    targetInputSnapshots,
    toVersion: sourceContract.frameworkVersion,
  };
}

export function recoverInterruptedFrameworkUpgrade(
  root = frameworkRoot,
  { repairDependencies = repairDependenciesAfterRollback } = {},
) {
  return recoverFrameworkUpgradeState(root, { repairDependencies });
}

function runDependencyRefresh(root, lifecycleCapability) {
  const installTools = spawnRuntimeLifecycleCommandSync({
    args: ["install", "--locked"],
    command: "mise",
    lifecycleCapability,
    options: {
      cwd: root,
      encoding: "utf8",
      env: process.env,
      input: "",
      stdio: "pipe",
      timeout: 300_000,
    },
    repositoryRoot: root,
    role: "framework-toolchain-supervisor",
  });
  if (installTools.error || installTools.status !== 0) {
    throw new Error("Upgraded toolchain installation failed.");
  }
  const installDependencies = spawnRuntimeLifecycleCommandSync({
    args: ["exec", "--locked", "--", "node", "scripts/framework/refresh-upgrade-dependencies.mjs"],
    command: "mise",
    commandDelegation: { operation: "dependency", role: "framework-dependency" },
    lifecycleCapability,
    options: {
      cwd: root,
      encoding: "utf8",
      env: process.env,
      input: "",
      stdio: "pipe",
      timeout: 300_000,
    },
    repositoryRoot: root,
    role: "framework-dependency-supervisor",
  });
  if (installDependencies.error || installDependencies.status !== 0) {
    throw new Error("Upgraded dependency resolution failed.");
  }
}

function repairDependenciesAfterRollback(root, lifecycleCapability) {
  const install = spawnRuntimeLifecycleCommandSync({
    args: [
      "exec",
      "--locked",
      "--",
      "pnpm",
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--ignore-pnpmfile",
    ],
    command: "mise",
    lifecycleCapability,
    options: {
      cwd: root,
      encoding: "utf8",
      env: process.env,
      input: "",
      stdio: "pipe",
      timeout: 300_000,
    },
    repositoryRoot: root,
    role: "framework-rollback-supervisor",
  });
  if (install.error || install.status !== 0) {
    throw new Error("Dependency state could not be restored after framework rollback.");
  }
}

function verifyTargetInputSnapshot(plan, relativePath) {
  const expected = plan.targetInputSnapshots[relativePath];
  const current = targetUpgradeFileState(plan.targetRoot, relativePath);
  if (!expected || current.sha256 !== expected.sha256 || current.mode !== expected.mode) {
    throw new Error(`Upgrade target changed after planning: ${relativePath}.`);
  }
}

function verifyPlanInputs(plan) {
  const currentManagedPaths = listManagedFrameworkFiles(plan.sourceRoot, plan.sourceContract);
  if (!frameworkUpgradeValuesEqual(currentManagedPaths, plan.managedPaths)) {
    throw new Error("Upgrade source managed-file inventory changed after planning.");
  }
  for (const relativePath of Object.keys(plan.targetInputSnapshots)) {
    verifyTargetInputSnapshot(plan, relativePath);
  }
  for (const operation of plan.operations) {
    const current = targetUpgradeFileState(plan.targetRoot, operation.path);
    if (
      current.sha256 !== operation.expected ||
      (current.exists &&
        operation.expectedMode !== undefined &&
        current.mode !== operation.expectedMode)
    ) {
      throw new Error(`Upgrade target changed after planning: ${operation.path}.`);
    }
  }
  for (const [relativePath, expected] of Object.entries(plan.sourceSnapshot.managedFiles)) {
    const current = managedUpgradeSourceState(plan.sourceRoot, relativePath);
    if (sha256(current.content) !== expected.sha256 || current.mode !== expected.mode) {
      throw new Error(`Upgrade source changed after planning: ${relativePath}.`);
    }
  }
  const currentPackage = managedPackageSnapshot(plan.sourceRoot, plan.sourceContract);
  if (!frameworkUpgradeValuesEqual(currentPackage, plan.sourceSnapshot.managedPackage)) {
    throw new Error("Upgrade source package fields changed after planning.");
  }
}

export function applyFrameworkUpgrade(
  plan,
  {
    refreshDependencies = runDependencyRefresh,
    repairDependencies = repairDependenciesAfterRollback,
  } = {},
) {
  if (plan.conflicts.length > 0) {
    throw new Error(`Framework upgrade has conflicts: ${plan.conflicts.join(", ")}.`);
  }
  recoverInterruptedFrameworkUpgrade(plan.targetRoot, { repairDependencies });
  verifyPlanInputs(plan);
  const sourceSnapshot = structuredClone(plan.sourceSnapshot);
  const { lifecycleCapability, paths } = beginFrameworkUpgrade(plan);
  try {
    // Lock acquisition and journal creation are separate filesystem operations. Revalidate after
    // both have completed so an edit racing the pre-lock snapshot is recovered, never overwritten
    // as though it belonged to the upgrade.
    verifyPlanInputs(plan);
    for (const operation of plan.operations) {
      const target = resolveFrameworkPath(plan.targetRoot, operation.path);
      if (operation.action === "delete") {
        removeOwnedRegularFile(
          plan.targetRoot,
          target,
          `framework upgrade deletion ${operation.path}`,
        );
      } else {
        atomicWriteUpgradeFile(plan.targetRoot, operation.path, operation.content, operation.mode);
      }
    }
    refreshDependencies(plan.targetRoot, lifecycleCapability);
    const journal = readFrameworkUpgradeJournal(plan.targetRoot, plan.digest);
    const lockState = targetUpgradeFileState(plan.targetRoot, "pnpm-lock.yaml");
    authorizeFrameworkUpgradeOutput(journal, "pnpm-lock.yaml", lockState.sha256, lockState.mode);
    persistFrameworkUpgradeJournal(plan.targetRoot, journal);
    const { installedContract, receipt } = buildUpgradedReceipt({
      pendingReconciliation: plan.projectDocumentReconciliation.required
        ? {
            fromVersion: plan.fromVersion,
            planDigest: plan.digest,
            policies: plan.projectDocumentReconciliation.policies,
            toVersion: plan.toVersion,
          }
        : null,
      sourceSnapshot,
      targetRoot: plan.targetRoot,
    });
    verifyTargetInputSnapshot(plan, plan.sourceContract.upgrade.receiptFile);
    const receiptContent = serializeCanonicalJson(receipt);
    authorizeFrameworkUpgradeOutput(
      journal,
      installedContract.upgrade.receiptFile,
      sha256(receiptContent),
      0o644,
    );
    persistFrameworkUpgradeJournal(plan.targetRoot, journal);
    atomicWriteUpgradeFile(
      plan.targetRoot,
      installedContract.upgrade.receiptFile,
      receiptContent,
      0o644,
    );
    removeFrameworkUpgradeState(paths, lifecycleCapability);
    return receipt;
  } catch (error) {
    try {
      assertRuntimeLifecycleQuiescent({
        root: plan.targetRoot,
        owner: lifecycleCapability,
      });
      const rollbackJournal = readFrameworkUpgradeJournal(plan.targetRoot, plan.digest);
      restoreFrameworkUpgradeJournal(plan.targetRoot, rollbackJournal);
      repairDependencies(plan.targetRoot, lifecycleCapability);
      removeFrameworkUpgradeState(paths, lifecycleCapability);
    } catch (rollbackError) {
      throw new Error(
        `Framework upgrade failed (${error.message}) and automatic rollback stopped safely (${rollbackError.message}); the recovery journal was preserved.`,
        { cause: error },
      );
    }
    throw error;
  }
}

export function acknowledgeFrameworkReconciliation(targetRoot, planDigest) {
  const target = realUpgradeDirectory(targetRoot, "framework reconciliation target");
  if (isReusableFrameworkSource(target)) {
    throw new Error("The reusable framework source has no child reconciliation receipt.");
  }
  if (!/^[0-9a-f]{64}$/u.test(planDigest)) {
    throw new Error("Framework reconciliation acknowledgment requires one plan digest.");
  }
  recoverInterruptedFrameworkUpgrade(target);
  const lifecycleCapability = acquireRuntimeLifecycleLock({
    root: target,
    operation: "framework-reconciliation",
  });
  const lockPath = resolveFrameworkPath(target, ".project-state/framework-upgrade/lock");
  try {
    ensureUpgradeDirectoryChain(target, ".project-state/framework-upgrade");
    createExclusiveOwnedDirectory(target, lockPath, "framework reconciliation lock");
  } catch (error) {
    releaseRuntimeLifecycleLock({ root: target, owner: lifecycleCapability });
    if (error?.code === "EEXIST") {
      throw new Error("Another framework update or reconciliation is active.");
    }
    throw error;
  }
  try {
    const contract = readFrameworkContract(target);
    const receipt = readInstallationReceipt(target, contract);
    if (!receipt.pendingReconciliation) {
      throw new Error("No framework policy reconciliation is pending.");
    }
    if (receipt.pendingReconciliation.planDigest !== planDigest) {
      throw new Error("Framework reconciliation digest does not match the pending plan.");
    }
    receipt.pendingReconciliation = null;
    atomicWriteUpgradeFile(
      target,
      contract.upgrade.receiptFile,
      serializeCanonicalJson(receipt),
      0o644,
    );
    return planDigest;
  } finally {
    if (existsSync(lockPath)) {
      removeOwnedArtifact(target, lockPath, "directory", "framework reconciliation lock");
    }
    releaseRuntimeLifecycleLock({ root: target, owner: lifecycleCapability });
  }
}

function parseArgs(argv) {
  const args = argv.filter((argument) => argument !== "--");
  const parsed = { acknowledge: "", apply: false, json: false, source: "", target: "" };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--apply") parsed.apply = true;
    else if (argument === "--json") parsed.json = true;
    else if (argument === "--source") parsed.source = args[++index] ?? "";
    else if (argument.startsWith("--source=")) parsed.source = argument.slice(9);
    else if (argument === "--target") parsed.target = args[++index] ?? "";
    else if (argument.startsWith("--target=")) parsed.target = argument.slice(9);
    else if (argument === "--ack-reconciliation") parsed.acknowledge = args[++index] ?? "";
    else if (argument.startsWith("--ack-reconciliation=")) {
      parsed.acknowledge = argument.slice("--ack-reconciliation=".length);
    } else if (argument === "--help" || argument === "-h") parsed.help = true;
    else throw new Error(`Unknown framework upgrade option: ${argument}.`);
  }
  if (parsed.help) return parsed;
  if (parsed.source && parsed.target) {
    throw new Error("Choose either --source from a child or --target from the source framework.");
  }
  if (parsed.acknowledge) {
    if (parsed.source || parsed.apply) {
      throw new Error(
        "Reconciliation acknowledgment accepts only an optional --target and --json.",
      );
    }
  } else if (Boolean(parsed.source) === Boolean(parsed.target)) {
    throw new Error(
      "Framework update requires exactly one of --source <framework> or --target <child>.",
    );
  }
  return parsed;
}

function printablePlan(plan) {
  return {
    adoptedPaths: plan.adoptedPaths,
    conflicts: plan.conflicts,
    digest: plan.digest,
    fromVersion: plan.fromVersion,
    operations: plan.publicOperations,
    projectDocumentReconciliation: plan.projectDocumentReconciliation,
    toVersion: plan.toVersion,
  };
}

export function frameworkUpgradePreviewMessage() {
  return "Preview only; rerun the same source/target selection with --apply.";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: pnpm framework:upgrade -- (--source <framework-root> | --target <child-root>) [--apply] [--json]\n       pnpm framework:upgrade -- [--target <child-root>] --ack-reconciliation <plan-digest> [--json]",
    );
    return;
  }
  const targetRoot = args.target || frameworkRoot;
  if (args.acknowledge) {
    acknowledgeFrameworkReconciliation(targetRoot, args.acknowledge);
    if (args.json) {
      console.log(JSON.stringify({ acknowledged: args.acknowledge, targetRoot }, null, 2));
    } else {
      console.log(`Framework reconciliation acknowledged: ${args.acknowledge}.`);
    }
    return;
  }
  const sourceRoot = args.source || frameworkRoot;
  const recovered = recoverInterruptedFrameworkUpgrade(targetRoot);
  const plan = buildFrameworkUpgradePlan({
    sourceRoot,
    targetRoot,
  });
  const printable = printablePlan(plan);
  if (!args.json) {
    if (recovered) console.log("Recovered an interrupted framework upgrade before planning.");
    console.log(`Framework upgrade ${plan.fromVersion} -> ${plan.toVersion} (${plan.digest}).`);
    for (const operation of plan.publicOperations) {
      console.log(`- ${operation.action} ${operation.path}`);
    }
    for (const relativePath of plan.adoptedPaths) console.log(`- adopt ${relativePath}`);
    for (const conflict of plan.conflicts) console.error(`- conflict ${conflict}`);
    if (plan.projectDocumentReconciliation.required) {
      console.log("Project-owned documents remain unchanged and require reconciliation:");
      for (const policy of plan.projectDocumentReconciliation.policies) {
        console.log(
          `- policy ${policy.id}: ${policy.change} ${String(policy.fromVersion ?? "none")} -> ${String(policy.toVersion ?? "retired")}`,
        );
      }
      for (const relativePath of plan.projectDocumentReconciliation.paths) {
        console.log(`- review ${relativePath}`);
      }
      console.log(plan.projectDocumentReconciliation.reason);
    }
    if (plan.projectDocumentReconciliation.previouslyManagedPaths.length > 0) {
      console.log(
        "Prior receipt ownership is released without changing these project-owned documents:",
      );
      for (const relativePath of plan.projectDocumentReconciliation.previouslyManagedPaths) {
        console.log(`- preserve ${relativePath}`);
      }
    }
  }
  let applied = false;
  if (plan.conflicts.length > 0) process.exitCode = 1;
  else if (args.apply) {
    applyFrameworkUpgrade(plan);
    applied = true;
    if (!args.json) {
      console.log("Framework upgrade applied transactionally.");
      if (plan.projectDocumentReconciliation.required) {
        console.log(
          `Project-document reconciliation remains required before verification; after reconciling local truth, acknowledge ${plan.digest}.`,
        );
      }
    }
  } else if (!args.json) console.log(frameworkUpgradePreviewMessage());
  if (args.json) {
    console.log(JSON.stringify({ ...printable, applied, recovered }, null, 2));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Framework upgrade failed: ${error.message}`);
    process.exit(1);
  }
}
