#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { lstatSync, rmSync } from "node:fs";
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
} from "./framework-contract.mjs";
import {
  atomicWriteUpgradeFile,
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
import { readPolicyProjection } from "./policy-projection.mjs";
import { projectOwnedUpgradeDocumentPaths } from "../docs/project-document-policy.mjs";

const projectDocumentReconciliationReason =
  "Project-owned documents are preserved by framework upgrade and require careful local reconciliation before verification; critical documents need explicit user confirmation whenever the factual correction or full preservation is uncertain.";

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

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

function packageUpdatePlan({ sourceManaged, targetRoot, receipt }) {
  const targetContent = readRegularFrameworkFile(targetRoot, "package.json");
  let targetPackage;
  try {
    targetPackage = JSON.parse(targetContent);
  } catch {
    throw new Error("Target package.json contains invalid JSON.");
  }
  const oldManaged = receipt.managedPackage;
  const conflicts = [];
  const desired = structuredClone(targetPackage);
  desired.scripts ??= {};
  desired.devDependencies ??= {};

  function mergeScalar(key, current, oldValue, newValue, assign) {
    if (equal(current, newValue)) return;
    if (equal(current, oldValue)) {
      if (!equal(current, newValue)) assign(newValue);
      return;
    }
    if (!equal(oldValue, newValue)) conflicts.push(`package.json ${key}`);
  }

  mergeScalar(
    "packageManager",
    targetPackage.packageManager,
    oldManaged.packageManager,
    sourceManaged.packageManager,
    (value) => {
      desired.packageManager = value;
    },
  );

  for (const section of ["scripts", "devDependencies"]) {
    const names = new Set([
      ...Object.keys(oldManaged[section] ?? {}),
      ...Object.keys(sourceManaged[section] ?? {}),
    ]);
    for (const name of [...names].sort()) {
      const current = targetPackage[section]?.[name];
      const oldValue = oldManaged[section]?.[name];
      const newValue = sourceManaged[section]?.[name];
      mergeScalar(`${section}.${name}`, current, oldValue, newValue, (value) => {
        if (value === undefined) delete desired[section][name];
        else desired[section][name] = value;
      });
    }
  }
  if (conflicts.length > 0) return { conflicts, operation: null };
  const desiredContent = serializeCanonicalJson(desired);
  return {
    conflicts,
    operation:
      desiredContent === targetContent
        ? null
        : {
            action: "write",
            content: desiredContent,
            expected: sha256(targetContent),
            expectedMode: lstatSync(resolveFrameworkPath(targetRoot, "package.json")).mode & 0o777,
            mode: lstatSync(resolveFrameworkPath(targetRoot, "package.json")).mode & 0o777,
            path: "package.json",
          },
  };
}

export function buildFrameworkUpgradePlan({
  sourceRoot,
  targetRoot = frameworkRoot,
  allowSame = false,
}) {
  const source = realUpgradeDirectory(sourceRoot, "framework upgrade source");
  const target = realUpgradeDirectory(targetRoot, "framework upgrade target");
  if (source === target) throw new Error("Framework upgrade source and target must differ.");
  if (isReusableFrameworkSource(target)) {
    throw new Error(
      "The reusable CodexRig source is upgraded through Git, not project upgrade receipts.",
    );
  }
  const sourceContract = validatedUpgradeSourceContract(source);
  const targetContract = readFrameworkContract(target);
  if (sourceContract.upgrade.receiptFile !== targetContract.upgrade.receiptFile) {
    throw new Error("Framework receipt-path migrations require a newer upgrade schema.");
  }
  const receipt = readInstallationReceipt(target, targetContract);
  if (sourceContract.frameworkId !== receipt.frameworkId) {
    throw new Error("Framework upgrade source belongs to another framework.");
  }
  const comparison = compareSemver(sourceContract.frameworkVersion, receipt.frameworkVersion);
  if (comparison < 0 || (comparison === 0 && !allowSame)) {
    throw new Error(
      comparison < 0
        ? "Framework downgrade is not supported."
        : "Framework source is not newer than the installed version.",
    );
  }

  const desiredPaths = listManagedFrameworkFiles(source, sourceContract);
  const removedProjectDocumentClassifications = projectOwnedUpgradeDocumentPaths.filter(
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
      if (current.exists) conflicts.push(relativePath);
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
  const projectDocumentReconciliation = {
    paths: projectOwnedDocumentPaths,
    previouslyManagedPaths: previouslyManagedProjectDocuments,
    reason: projectDocumentReconciliationReason,
    required: true,
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
      to: sourceContract.frameworkVersion,
    }),
  );
  return {
    conflicts: sortedConflicts,
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
    toVersion: sourceContract.frameworkVersion,
  };
}

export function recoverInterruptedFrameworkUpgrade(
  root = frameworkRoot,
  { repairDependencies = repairDependenciesAfterRollback } = {},
) {
  return recoverFrameworkUpgradeState(root, { repairDependencies });
}

function runDependencyRefresh(root) {
  const installTools = spawnSync("mise", ["install", "--locked"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    input: "",
    stdio: "pipe",
    timeout: 300_000,
  });
  if (installTools.error || installTools.status !== 0) {
    throw new Error("Upgraded toolchain installation failed.");
  }
  const installDependencies = spawnSync(
    "mise",
    ["exec", "--locked", "--", "node", "scripts/framework/refresh-upgrade-dependencies.mjs"],
    {
      cwd: root,
      encoding: "utf8",
      env: process.env,
      input: "",
      stdio: "pipe",
      timeout: 300_000,
    },
  );
  if (installDependencies.error || installDependencies.status !== 0) {
    throw new Error("Upgraded dependency resolution failed.");
  }
}

function repairDependenciesAfterRollback(root) {
  const install = spawnSync(
    "mise",
    ["exec", "--locked", "--", "pnpm", "install", "--frozen-lockfile", "--ignore-scripts"],
    {
      cwd: root,
      encoding: "utf8",
      env: process.env,
      input: "",
      stdio: "pipe",
      timeout: 300_000,
    },
  );
  if (install.error || install.status !== 0) {
    throw new Error("Dependency state could not be restored after framework rollback.");
  }
}

function verifyPlanInputs(plan) {
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
  if (!equal(currentPackage, plan.sourceSnapshot.managedPackage)) {
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
  const { paths } = beginFrameworkUpgrade(plan);
  try {
    // Lock acquisition and journal creation are separate filesystem operations. Revalidate after
    // both have completed so an edit racing the pre-lock snapshot is recovered, never overwritten
    // as though it belonged to the upgrade.
    verifyPlanInputs(plan);
    for (const operation of plan.operations) {
      const target = resolveFrameworkPath(plan.targetRoot, operation.path);
      if (operation.action === "delete") rmSync(target);
      else {
        atomicWriteUpgradeFile(plan.targetRoot, operation.path, operation.content, operation.mode);
      }
    }
    refreshDependencies(plan.targetRoot);
    const journal = readFrameworkUpgradeJournal(plan.targetRoot, plan.digest);
    const lockState = targetUpgradeFileState(plan.targetRoot, "pnpm-lock.yaml");
    authorizeFrameworkUpgradeOutput(journal, "pnpm-lock.yaml", lockState.sha256, lockState.mode);
    persistFrameworkUpgradeJournal(plan.targetRoot, journal);
    const { installedContract, receipt } = buildUpgradedReceipt({
      sourceSnapshot,
      targetRoot: plan.targetRoot,
    });
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
    removeFrameworkUpgradeState(paths);
    return receipt;
  } catch (error) {
    try {
      const rollbackJournal = readFrameworkUpgradeJournal(plan.targetRoot, plan.digest);
      restoreFrameworkUpgradeJournal(plan.targetRoot, rollbackJournal);
      repairDependencies(plan.targetRoot);
      removeFrameworkUpgradeState(paths);
    } catch (rollbackError) {
      throw new Error(
        `Framework upgrade failed (${error.message}) and automatic rollback stopped safely (${rollbackError.message}); the recovery journal was preserved.`,
        { cause: error },
      );
    }
    throw error;
  }
}

function parseArgs(argv) {
  const args = argv.filter((argument) => argument !== "--");
  const parsed = { allowSame: false, apply: false, json: false, source: "" };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--allow-same") parsed.allowSame = true;
    else if (argument === "--apply") parsed.apply = true;
    else if (argument === "--json") parsed.json = true;
    else if (argument === "--source") parsed.source = args[++index] ?? "";
    else if (argument.startsWith("--source=")) parsed.source = argument.slice(9);
    else if (argument === "--help" || argument === "-h") parsed.help = true;
    else throw new Error(`Unknown framework upgrade option: ${argument}.`);
  }
  if (!parsed.help && !parsed.source)
    throw new Error("Framework upgrade requires --source <path>.");
  if (parsed.allowSame && parsed.apply) {
    throw new Error(
      "--allow-same is a preview-only reconciliation option; do not combine it with --apply.",
    );
  }
  return parsed;
}

function printablePlan(plan) {
  return {
    conflicts: plan.conflicts,
    digest: plan.digest,
    fromVersion: plan.fromVersion,
    operations: plan.publicOperations,
    projectDocumentReconciliation: plan.projectDocumentReconciliation,
    toVersion: plan.toVersion,
  };
}

export function frameworkUpgradePreviewMessage({ allowSame }) {
  return allowSame
    ? "Same-version reconciliation preview only; reconcile the listed project-owned documents before verification. Do not rerun with --apply."
    : "Preview only; rerun the same source with --apply.";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: pnpm framework:upgrade -- --source <new-codexrig-root> [--apply | --allow-same] [--json]",
    );
    return;
  }
  const recovered = recoverInterruptedFrameworkUpgrade(frameworkRoot);
  const plan = buildFrameworkUpgradePlan({
    allowSame: args.allowSame,
    sourceRoot: args.source,
    targetRoot: frameworkRoot,
  });
  const printable = printablePlan(plan);
  if (args.json) console.log(JSON.stringify({ ...printable, recovered }, null, 2));
  else {
    if (recovered) console.log("Recovered an interrupted framework upgrade before planning.");
    console.log(`Framework upgrade ${plan.fromVersion} -> ${plan.toVersion} (${plan.digest}).`);
    for (const operation of plan.publicOperations) {
      console.log(`- ${operation.action} ${operation.path}`);
    }
    for (const conflict of plan.conflicts) console.error(`- conflict ${conflict}`);
    if (plan.projectDocumentReconciliation.required) {
      console.log("Project-owned documents remain unchanged and require reconciliation:");
      for (const relativePath of plan.projectDocumentReconciliation.paths) {
        console.log(`- review ${relativePath}`);
      }
      if (plan.projectDocumentReconciliation.previouslyManagedPaths.length > 0) {
        console.log(
          "Legacy receipt ownership is released without changing these project-owned documents:",
        );
        for (const relativePath of plan.projectDocumentReconciliation.previouslyManagedPaths) {
          console.log(`- preserve ${relativePath}`);
        }
      }
      console.log(plan.projectDocumentReconciliation.reason);
    }
  }
  if (plan.conflicts.length > 0) process.exitCode = 1;
  else if (args.apply) {
    applyFrameworkUpgrade(plan);
    if (!args.json) {
      console.log("Framework upgrade applied transactionally.");
      if (plan.projectDocumentReconciliation.required) {
        console.log(
          "Project-document reconciliation remains required before verification; no project-owned document was changed automatically.",
        );
      }
    }
  } else if (!args.json) console.log(frameworkUpgradePreviewMessage(args));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Framework upgrade failed: ${error.message}`);
    process.exit(1);
  }
}
