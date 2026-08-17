/** Verifies framework lifecycle behavior for the framework lifecycle and child upgrade boundary. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  compareSemver,
  isReusableFrameworkSource,
  parseSemver,
  readFrameworkContract,
  readInstallationReceipt,
  serializeCanonicalJson,
  sha256,
} from "../contracts/framework-contract.mjs";
import { writeInstallationReceipt } from "./framework-installation-receipt.mjs";
import {
  acknowledgeFrameworkReconciliation,
  applyFrameworkUpgrade,
  buildFrameworkUpgradePlan,
  frameworkUpgradePreviewMessage,
  recoverInterruptedFrameworkUpgrade,
} from "./framework-upgrade.mjs";
import { authorizePlannedLockfile } from "./refresh-upgrade-dependencies.mjs";
import { ciCompatibilityTracks, gitlabChildPipeline } from "./compatibility-matrix.mjs";
import {
  inspectRuntimeSessionLease,
  issueRuntimeSessionLease,
  issueStartupAttestation,
  releaseRuntimeSessionLease,
  startupAttestedInputs,
  startupControlPolicies,
  verifyStartupAttestation,
} from "../setup/startup-attestation.mjs";
import { spawnRuntimeLifecycleCommandSync } from "../repository/runtime-lifecycle-process.mjs";
import {
  acquireRuntimeLifecycleLock,
  inspectRuntimeLifecycleLock,
  releaseRuntimeLifecycleLock,
} from "../repository/runtime-session-lease.mjs";
import { repositoryRuntimeRootIdentity } from "../repository/runtime-owned-state.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");
const temporaryRoots = [];
const definitelyStalePid = 2_147_483_647;

after(() => {
  for (const root of temporaryRoots) rmSync(root, { force: true, recursive: true });
});

function temporaryRoot(prefix) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

async function waitForLifecycle(predicate, label, timeoutMilliseconds = 5_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;
  while (Date.now() <= deadline) {
    try {
      const result = predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}.`, { cause: lastError });
}

function terminateIfAlive(pid, signal = "SIGKILL") {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function write(root, relativePath, content, mode = 0o644) {
  const target = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, { encoding: "utf8", mode });
  chmodSync(target, mode);
}

function writeLegacyRuntimeSessionLease(root, pid) {
  write(
    root,
    ".codex/runtime/codexrig-session.json",
    serializeCanonicalJson({
      schemaVersion: 1,
      pid,
      startedAt: "2026-08-01T00:00:00.000Z",
      root: repositoryRuntimeRootIdentity(root),
    }),
    0o600,
  );
}

function contract(version) {
  return {
    schemaVersion: 2,
    frameworkId: "codexrig",
    frameworkVersion: version,
    compatibilityFile: ".codexrig/compatibility.json",
    startup: { attestationMaxAgeSeconds: 600 },
    platform: {
      provider: "auto",
      integrationBranch: "main",
      hosts: { github: ["github.com"], gitlab: ["gitlab.com"] },
      apiBaseUrls: {
        github: { "github.com": "https://api.github.com" },
        gitlab: { "gitlab.com": "https://gitlab.com/api/v4" },
      },
      ci: { requiredCheck: "verify" },
      protection: {
        requiredApprovals: 1,
        requireCodeOwnerReview: false,
        preventAuthorApproval: true,
        preventCommitterApproval: true,
        preventApprovalRuleOverrides: true,
        resetApprovalsOnPush: true,
        mergeSerialization: "prefer",
      },
    },
    upgrade: {
      receiptFile: ".codexrig/installation.json",
      projectOwnedDocuments: [
        ".codex/README.md",
        "AGENTS.md",
        "README.md",
        "config/delivery.json",
        "config/localization.json",
        "config/product.json",
        "config/tenancy.json",
        "docs/context-index.md",
        "docs/future-modules.md",
        "docs/project.md",
        "instructions.md",
      ],
      managedRoots: [
        ".codexrig/compatibility.json",
        ".codexrig/framework.json",
        ".codexrig/policy-projection.json",
        "managed",
      ],
      excludedPathReasons: {
        "managed/excluded.txt": "fixture-only managed exclusion",
      },
      managedPackageScripts: ["framework:doctor"],
      managedDevDependencies: ["prettier"],
    },
  };
}

const compatibility = {
  schemaVersion: 2,
  reviewedOn: "2026-08-16",
  ci: {
    codexNpmPackage: "@openai/codex",
    codexNpmPackageIntegrity:
      "sha512-EQLEXecAG2ptxI7UpBMo2TR/ga5596/c/OsYF/0LoUDh5JANZ7IoGqlzBEWbuEVQ76JePIbtTW/ihCkp1a7Z3w==",
    codexNpmPlatformIntegrities: {
      arm64:
        "sha512-SLC1JXw2TYfr/c3HhrJubyyLelq7vTOLWVmiThFA+z0+WgzCPmaseJ/kzDD3Gge/TO7fCnnj7UcPmC0d2c8XAg==",
      x64: "sha512-0W9MBxPpWW0cSkNqrTDN2jR7rzzT7oNMhQY5446lT2Lw5cz5yhDTck4Va9rjkQEm+HlFzP/dmEMSZbXfJsINmw==",
    },
    codexNpmPlatformPackages: {
      arm64: "@openai/codex-linux-arm64",
      x64: "@openai/codex-linux-x64",
    },
    codexVersion: "0.147.0",
    miseLinuxX64Sha256: "96f6f1f416d868b78addd22746eefc7f4bf7820c6a3afa392a9f653f708c1644",
    miseNpmPackageIntegrities: {
      arm64:
        "sha512-MOg3B92G0c1xu2wZX5wuJXSpNagxCu9HAv+tfDn+Rp9UF2sO1CVC7UAPOMcp49UNvcLqH9PeoPsMxIy0dC9FNQ==",
      x64: "sha512-FNEhITXrJmfmYfGsQTfldJGiqTXr3JEQlFMTPV0XJyFI7FP/3kOssgFgSkMOlNqJCT3qFqETi0kCO3PsYx9qUw==",
    },
    miseNpmPackages: {
      arm64: "@jdxcode/mise-linux-arm64",
      x64: "@jdxcode/mise-linux-x64",
    },
    miseVersion: "2026.8.6",
  },
  stable: {
    node: { version: "24.19.0", range: ">=24.19.0 <25.0.0", channel: "lts" },
    pnpm: { version: "11.22.0", range: ">=11.22.0 <12.0.0", channel: "latest-11" },
    codex: { minimumVersion: "0.147.0", channel: "latest" },
  },
  canaries: [
    {
      id: "next-node-lts",
      description: "next Node line",
      node: "26",
      pnpm: "11.22.0",
      codex: "latest",
      required: false,
    },
  ],
};

function packageJson(version) {
  return serializeCanonicalJson({
    name: "codexrig",
    version,
    private: true,
    type: "module",
    license: "PolyForm-Noncommercial-1.0.0",
    packageManager: version === "1.0.0" ? "pnpm@11.19.0" : "pnpm@11.22.0",
    scripts: { "framework:doctor": `node doctor-${version}.mjs` },
    devDependencies: { prettier: version === "1.0.0" ? "^3.8.0" : "^3.9.0" },
  });
}

function frameworkFixture(version, content, { projection, reusable = true } = {}) {
  const root = temporaryRoot(`codexrig-${version}-`);
  write(root, ".codexrig/framework.json", serializeCanonicalJson(contract(version)));
  write(root, ".codexrig/compatibility.json", serializeCanonicalJson(compatibility));
  write(
    root,
    ".codexrig/policy-projection.json",
    projection ??
      readFileSync(path.join(repositoryRoot, ".codexrig/policy-projection.json"), "utf8"),
  );
  if (reusable) {
    write(root, ".agents/skills/create-project-from-framework/SKILL.md", "# Fixture\n");
  }
  write(root, "managed/tool.mjs", content, 0o755);
  write(root, "package.json", packageJson(version));
  write(root, "pnpm-lock.yaml", `lockfileVersion: '${version}'\n`);
  return root;
}

function earlierPolicyProjection() {
  const projection = JSON.parse(
    readFileSync(path.join(repositoryRoot, ".codexrig/policy-projection.json"), "utf8"),
  );
  const delivery = projection.policies.find((policy) => policy.id === "delivery-environments");
  delivery.version = 1;
  delivery.statement =
    "Delivery targets are explicit and dev is the default until a stronger target is selected.";
  const frameworkLifecycle = projection.policies.find(
    (policy) => policy.id === "framework-lifecycle",
  );
  frameworkLifecycle.version -= 1;
  frameworkLifecycle.statement =
    "Framework updates are reviewed, receipt-backed, and reconciled into local project truth.";
  frameworkLifecycle.projectionStatement = frameworkLifecycle.statement;
  return serializeCanonicalJson(projection);
}

function schemaOnePolicyProjection() {
  return readFileSync(
    path.join(repositoryRoot, "scripts/framework/bootstrap/1.2.1/policy-projection.json"),
    "utf8",
  );
}

function installedFixture() {
  const root = frameworkFixture("1.0.0", "export const value = 'old';\n", {
    reusable: false,
  });
  writeInstallationReceipt({ root });
  return root;
}

function schemaOneInstalledFixture() {
  const root = frameworkFixture("1.2.1", "export const value = 'schema-two';\n", {
    projection: schemaOnePolicyProjection(),
    reusable: false,
  });
  const bootstrapDirectory = path.join(repositoryRoot, "scripts/framework/bootstrap/1.2.1");
  const baseline = JSON.parse(
    readFileSync(path.join(repositoryRoot, "scripts/framework/bootstrap/1.2.1.json"), "utf8"),
  );
  for (const [name, target] of [
    ["framework.json", ".codexrig/framework.json"],
    ["policy-projection.json", ".codexrig/policy-projection.json"],
    ["compatibility.json", ".codexrig/compatibility.json"],
  ]) {
    write(root, target, readFileSync(path.join(bootstrapDirectory, name), "utf8"));
  }
  write(
    root,
    ".codexrig/installation.json",
    serializeCanonicalJson({
      schemaVersion: 1,
      frameworkId: baseline.frameworkId,
      frameworkVersion: baseline.frameworkVersion,
      managedFiles: baseline.managedFiles,
      installedFiles: structuredClone(baseline.managedFiles),
      managedPackage: baseline.managedPackage,
      installedPackage: structuredClone(baseline.managedPackage),
    }),
  );

  const productPackage = {
    name: "legacy-product",
    version: "0.1.0",
    private: true,
    type: "module",
    packageManager: baseline.managedPackage.packageManager,
    scripts: structuredClone(baseline.managedPackage.scripts),
    devDependencies: structuredClone(baseline.managedPackage.devDependencies),
  };
  write(root, "package.json", serializeCanonicalJson(productPackage));
  return root;
}

test("framework semantic versions follow prerelease precedence and reject invalid identifiers", () => {
  assert.equal(compareSemver("1.0.0-alpha.2", "1.0.0-alpha.10"), -1);
  assert.equal(compareSemver("1.0.0-alpha.10", "1.0.0"), -1);
  assert.equal(compareSemver("1.0.0+build.1", "1.0.0+build.2"), 0);
  assert.throws(() => parseSemver("1.0.0-alpha..1"), /semantic versioning/);
  assert.throws(() => parseSemver("1.0.0-alpha.01"), /semantic versioning/);
});

test("framework source identity cannot be borrowed by a receipted generated project", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'source';\n");
  assert.equal(isReusableFrameworkSource(source), true);

  const child = installedFixture();
  write(child, ".agents/skills/create-project-from-framework/SKILL.md", "# Stray copy\n");
  assert.equal(isReusableFrameworkSource(child), false);

  writeInstallationReceipt({ root: source });
  assert.equal(isReusableFrameworkSource(source), false);
});

test("published schema-one children bootstrap transactionally into the active contract", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'schema-two';\n");
  const target = schemaOneInstalledFixture();
  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });

  assert.equal(plan.fromVersion, "1.2.1");
  assert.equal(plan.toVersion, "2.0.0");
  assert.deepEqual(plan.conflicts, []);
  assert.ok(
    plan.projectDocumentReconciliation.policies.some(
      (policy) => policy.id === "agent-orchestration" && policy.change === "added",
    ),
  );
  assert.equal(plan.projectDocumentReconciliation.paths.includes(".codex/README.md"), true);

  const receipt = applyFrameworkUpgrade(plan, {
    refreshDependencies: () => {},
    repairDependencies: () => {},
  });
  assert.equal(readFrameworkContract(target).schemaVersion, 2);
  assert.equal(readFrameworkContract(target).frameworkVersion, "2.0.0");
  assert.equal(receipt.schemaVersion, 2);
  assert.equal(readInstallationReceipt(target).pendingReconciliation?.fromVersion, "1.2.1");
  assert.equal(
    JSON.parse(readFileSync(path.join(target, "package.json"), "utf8")).version,
    "0.1.0",
  );

  const incompleteTarget = schemaOneInstalledFixture();
  const incompleteProjection = JSON.parse(
    readFileSync(path.join(incompleteTarget, ".codexrig/policy-projection.json"), "utf8"),
  );
  incompleteProjection.invariants.pop();
  write(
    incompleteTarget,
    ".codexrig/policy-projection.json",
    serializeCanonicalJson(incompleteProjection),
  );
  assert.throws(
    () => buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: incompleteTarget }),
    /policy projection is not the exact published 1\.2\.1 input/i,
  );

  const forgedReceiptTarget = schemaOneInstalledFixture();
  const forgedReceipt = JSON.parse(
    readFileSync(path.join(forgedReceiptTarget, ".codexrig/installation.json"), "utf8"),
  );
  forgedReceipt.managedFiles["scripts/context/context-build.mjs"].sha256 = "0".repeat(64);
  write(forgedReceiptTarget, ".codexrig/installation.json", serializeCanonicalJson(forgedReceipt));
  assert.throws(
    () => buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: forgedReceiptTarget }),
    /receipt is not the exact published 1\.2\.1 input/i,
  );

  for (const version of ["1.2.0", "1.2.2"]) {
    const wrongVersionTarget = schemaOneInstalledFixture();
    const wrongContract = JSON.parse(
      readFileSync(path.join(wrongVersionTarget, ".codexrig/framework.json"), "utf8"),
    );
    wrongContract.frameworkVersion = version;
    write(wrongVersionTarget, ".codexrig/framework.json", serializeCanonicalJson(wrongContract));
    assert.throws(
      () => buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: wrongVersionTarget }),
      /contract is not the exact published 1\.2\.1 input/i,
    );
  }

  const changedSurfaceTarget = schemaOneInstalledFixture();
  const changedSurfaceContract = JSON.parse(
    readFileSync(path.join(changedSurfaceTarget, ".codexrig/framework.json"), "utf8"),
  );
  changedSurfaceContract.upgrade.managedRoots.push("new-managed-surface");
  write(
    changedSurfaceTarget,
    ".codexrig/framework.json",
    serializeCanonicalJson(changedSurfaceContract),
  );
  assert.throws(
    () => buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: changedSurfaceTarget }),
    /contract is not the exact published 1\.2\.1 input/i,
  );

  for (const mutation of [
    (projection) => {
      projection.invariants[0].statement = `${projection.invariants[0].statement} Altered.`;
    },
    (projection) => {
      projection.invariants[0].surfaces = ["agents", "readme"];
    },
  ]) {
    const changedPolicyTarget = schemaOneInstalledFixture();
    const changedPolicy = JSON.parse(
      readFileSync(path.join(changedPolicyTarget, ".codexrig/policy-projection.json"), "utf8"),
    );
    mutation(changedPolicy);
    write(
      changedPolicyTarget,
      ".codexrig/policy-projection.json",
      serializeCanonicalJson(changedPolicy),
    );
    assert.throws(
      () => buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: changedPolicyTarget }),
      /policy projection is not the exact published 1\.2\.1 input/i,
    );
  }

  const incompleteReceiptTarget = schemaOneInstalledFixture();
  const incompleteReceipt = JSON.parse(
    readFileSync(path.join(incompleteReceiptTarget, ".codexrig/installation.json"), "utf8"),
  );
  const removedReceiptPath = Object.keys(incompleteReceipt.managedFiles)[0];
  delete incompleteReceipt.managedFiles[removedReceiptPath];
  delete incompleteReceipt.installedFiles[removedReceiptPath];
  write(
    incompleteReceiptTarget,
    ".codexrig/installation.json",
    serializeCanonicalJson(incompleteReceipt),
  );
  assert.throws(
    () => buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: incompleteReceiptTarget }),
    /receipt is not the exact published 1\.2\.1 input/i,
  );

  const extraReceiptTarget = schemaOneInstalledFixture();
  const extraReceipt = JSON.parse(
    readFileSync(path.join(extraReceiptTarget, ".codexrig/installation.json"), "utf8"),
  );
  const extraState = { mode: 420, sha256: "a".repeat(64) };
  extraReceipt.managedFiles["managed/extra.mjs"] = extraState;
  extraReceipt.installedFiles["managed/extra.mjs"] = structuredClone(extraState);
  write(extraReceiptTarget, ".codexrig/installation.json", serializeCanonicalJson(extraReceipt));
  assert.throws(
    () => buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: extraReceiptTarget }),
    /receipt is not the exact published 1\.2\.1 input/i,
  );
});

test("framework upgrade applies a clean three-way change and records the new contract", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'new';\n");
  const target = installedFixture();
  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });
  assert.deepEqual(plan.conflicts, []);
  assert.ok(plan.publicOperations.some((entry) => entry.path === "managed/tool.mjs"));
  const receipt = applyFrameworkUpgrade(plan, {
    refreshDependencies: () => {},
    repairDependencies: () => {},
  });
  assert.equal(readFrameworkContract(target).frameworkVersion, "2.0.0");
  assert.equal(readInstallationReceipt(target).frameworkVersion, "2.0.0");
  assert.equal(receipt.frameworkVersion, "2.0.0");
  assert.equal(
    readFileSync(path.join(target, "managed/tool.mjs"), "utf8"),
    "export const value = 'new';\n",
  );
  assert.match(readFileSync(path.join(target, "package.json"), "utf8"), /doctor-2\.0\.0/);
});

test("framework dependency refresh reenters only through its explicit delegated capability", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'delegated';\n");
  const target = installedFixture();
  const marker = path.join(target, "delegated-dependency-refresh.json");
  const ownershipUrl = pathToFileURL(
    path.join(repositoryRoot, "scripts/framework/framework-upgrade-ownership.mjs"),
  ).href;
  const transactionUrl = pathToFileURL(
    path.join(repositoryRoot, "scripts/deps/dependency-transaction-state.mjs"),
  ).href;
  const delegatedSource = `
    import { writeFileSync } from "node:fs";
    const { claimDependencyRefresh } = await import(${JSON.stringify(ownershipUrl)});
    const { acquireDependencyTransactionLock, releaseDependencyTransactionLock } = await import(${JSON.stringify(transactionUrl)});
    const claim = claimDependencyRefresh(process.argv[1]);
    try {
      const transaction = acquireDependencyTransactionLock(process.argv[1], {
        lifecycleCapability: claim.lifecycleCapability,
      });
      try {
        writeFileSync(process.argv[2], JSON.stringify({
          lifecycleNonce: transaction.lifecycleCapability.nonce,
          operation: transaction.lifecycleCapability.operation,
        }));
      } finally {
        releaseDependencyTransactionLock(transaction);
      }
    } finally {
      claim.release();
    }
  `;
  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });
  applyFrameworkUpgrade(plan, {
    refreshDependencies: (root, lifecycleCapability) => {
      const result = spawnRuntimeLifecycleCommandSync({
        args: ["--input-type=module", "--eval", delegatedSource, root, marker],
        command: process.execPath,
        commandDelegation: { operation: "dependency", role: "framework-dependency" },
        lifecycleCapability,
        options: { cwd: root, encoding: "utf8", stdio: "pipe" },
        repositoryRoot: root,
        role: "framework-dependency-test-supervisor",
      });
      assert.equal(result.status, 0, result.stderr);
    },
    repairDependencies: () => {},
  });

  const delegated = JSON.parse(readFileSync(marker, "utf8"));
  assert.equal(delegated.operation, "dependency");
  assert.match(delegated.lifecycleNonce, /^[a-f0-9-]{36}$/u);
  assert.equal(inspectRuntimeLifecycleLock({ root: target }).status, "absent");
});

test("framework rollback prunes a crashed delegated dependency descendant", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'delegated-crash';\n");
  const target = installedFixture();
  const original = readFileSync(path.join(target, "managed/tool.mjs"), "utf8");
  const ownershipUrl = pathToFileURL(
    path.join(repositoryRoot, "scripts/framework/framework-upgrade-ownership.mjs"),
  ).href;
  const delegatedSource = `
    const { claimDependencyRefresh } = await import(${JSON.stringify(ownershipUrl)});
    claimDependencyRefresh(process.argv[1]);
    process.kill(process.pid, "SIGKILL");
  `;
  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });

  assert.throws(
    () =>
      applyFrameworkUpgrade(plan, {
        refreshDependencies: (root, lifecycleCapability) => {
          const result = spawnRuntimeLifecycleCommandSync({
            args: ["--input-type=module", "--eval", delegatedSource, root],
            command: process.execPath,
            commandDelegation: { operation: "dependency", role: "framework-dependency" },
            lifecycleCapability,
            options: { cwd: root, encoding: "utf8", stdio: "pipe" },
            repositoryRoot: root,
            role: "framework-dependency-crash-supervisor",
          });
          assert.notEqual(result.status, 0);
          throw new Error("synthetic delegated refresh failure");
        },
        repairDependencies: () => {},
      }),
    /synthetic delegated refresh failure/u,
  );
  assert.equal(readFileSync(path.join(target, "managed/tool.mjs"), "utf8"), original);
  assert.equal(inspectRuntimeLifecycleLock({ root: target }).status, "absent");
});

test("versioned policy upgrade preserves project documents until explicit reconciliation", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'new';\n");
  const target = frameworkFixture("1.0.0", "export const value = 'old';\n", {
    projection: earlierPolicyProjection(),
    reusable: false,
  });
  writeInstallationReceipt({ root: target });
  const projectDocuments = new Map([
    [".codex/README.md", "# Local Codex policy\n"],
    ["AGENTS.md", "# Local bootstrap\n"],
    ["README.md", "# Local product\n"],
    ["config/delivery.json", '{"local":"delivery"}\n'],
    ["docs/context-index.md", "# Local context-index operations\n"],
    ["docs/future-modules.md", "# Future Modules\n"],
    ["docs/project.md", "# Local project truth\n"],
    ["instructions.md", "# Local workflow authority\n"],
  ]);
  for (const [relativePath, content] of projectDocuments) write(target, relativePath, content);

  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });
  assert.equal(plan.projectDocumentReconciliation.required, true);
  assert.deepEqual(plan.projectDocumentReconciliation.paths, [
    ".codex/README.md",
    "AGENTS.md",
    "README.md",
    "config/delivery.json",
    "docs/project.md",
    "instructions.md",
  ]);
  assert.deepEqual(
    plan.projectDocumentReconciliation.policies.map(({ change, id }) => ({ change, id })),
    [
      { change: "changed", id: "delivery-environments" },
      { change: "changed", id: "framework-lifecycle" },
    ],
  );
  assert.deepEqual(plan.projectDocumentReconciliation.previouslyManagedPaths, []);
  assert.match(plan.projectDocumentReconciliation.reason, /Reconcile each listed policy concept/i);
  assert.equal(
    plan.publicOperations.some(({ path: relativePath }) => projectDocuments.has(relativePath)),
    false,
  );

  applyFrameworkUpgrade(plan, {
    refreshDependencies: () => {},
    repairDependencies: () => {},
  });
  for (const [relativePath, content] of projectDocuments) {
    assert.equal(readFileSync(path.join(target, relativePath), "utf8"), content, relativePath);
  }
  const pending = readInstallationReceipt(target).pendingReconciliation;
  assert.equal(pending.planDigest, plan.digest);
  assert.deepEqual(
    pending.policies.map(({ id }) => id),
    ["delivery-environments", "framework-lifecycle"],
  );
  assert.throws(
    () => buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target }),
    /reconciliation .* is still pending/,
  );
  const dependencyMutation = acquireRuntimeLifecycleLock({
    root: target,
    operation: "dependency",
  });
  try {
    assert.throws(
      () => acknowledgeFrameworkReconciliation(target, plan.digest),
      /runtime lifecycle operation is active/u,
    );
    assert.equal(readInstallationReceipt(target).pendingReconciliation.planDigest, plan.digest);
  } finally {
    releaseRuntimeLifecycleLock({ root: target, owner: dependencyMutation });
  }
  assert.equal(acknowledgeFrameworkReconciliation(target, plan.digest), plan.digest);
  assert.equal(readInstallationReceipt(target).pendingReconciliation, null);
});

test("version-2 command boundary rejects ambiguous source and target selection", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(repositoryRoot, "scripts/framework/framework-upgrade.mjs"),
      "--source",
      repositoryRoot,
      "--target",
      repositoryRoot,
    ],
    { encoding: "utf8", stdio: "pipe" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Choose either --source.*or --target/);
  assert.match(frameworkUpgradePreviewMessage(), /Preview only/);
});

test("framework upgrade rejects source ownership of project policy documents", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'new';\n");
  const sourceContract = contract("2.0.0");
  sourceContract.upgrade.managedRoots.push("./instructions.md");
  write(source, ".codexrig/framework.json", serializeCanonicalJson(sourceContract));
  write(source, "instructions.md", "# Framework-owned workflow\n");
  const target = installedFixture();

  assert.throws(
    () => buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target }),
    /must not manage project-owned documents: instructions\.md/,
  );

  const removingSource = frameworkFixture("2.0.0", "export const value = 'new';\n");
  const removingContract = contract("2.0.0");
  removingContract.upgrade.projectOwnedDocuments =
    removingContract.upgrade.projectOwnedDocuments.filter(
      (relativePath) => relativePath !== "instructions.md",
    );
  write(removingSource, ".codexrig/framework.json", serializeCanonicalJson(removingContract));
  assert.throws(
    () => buildFrameworkUpgradePlan({ sourceRoot: removingSource, targetRoot: target }),
    /must preserve installed project-owned document classifications: instructions\.md/,
  );

  const conflictingSource = frameworkFixture("2.0.0", "export const value = 'new';\n");
  const conflictingContract = contract("2.0.0");
  conflictingContract.upgrade.projectOwnedDocuments.push("./pnpm-lock.yaml");
  write(conflictingSource, ".codexrig/framework.json", serializeCanonicalJson(conflictingContract));
  assert.throws(
    () => buildFrameworkUpgradePlan({ sourceRoot: conflictingSource, targetRoot: target }),
    /cannot classify framework-controlled upgrade inputs as project-owned documents: pnpm-lock\.yaml/,
  );
});

test("framework upgrade releases prior receipt ownership without changing project policy", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'new';\n");
  const target = frameworkFixture("1.0.0", "export const value = 'old';\n", {
    reusable: false,
  });
  const priorContract = contract("1.0.0");
  priorContract.upgrade.managedRoots.push("instructions.md");
  write(target, ".codexrig/framework.json", serializeCanonicalJson(priorContract));
  const localInstructions = "# Locally preserved workflow\n";
  write(target, "instructions.md", localInstructions);
  writeInstallationReceipt({ root: target });

  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });
  assert.deepEqual(plan.projectDocumentReconciliation.previouslyManagedPaths, ["instructions.md"]);
  assert.equal(
    plan.publicOperations.some(({ path: relativePath }) => relativePath === "instructions.md"),
    false,
  );
  applyFrameworkUpgrade(plan, {
    refreshDependencies: () => {},
    repairDependencies: () => {},
  });
  assert.equal(readFileSync(path.join(target, "instructions.md"), "utf8"), localInstructions);
  assert.equal("instructions.md" in readInstallationReceipt(target).managedFiles, false);
});

test("source-declared project documents cannot be deleted by an older installed path policy", () => {
  const newlyProjectOwnedPath = "docs/new-project-authority.md";
  const source = frameworkFixture("2.0.0", "export const value = 'new';\n");
  const sourceContract = contract("2.0.0");
  sourceContract.upgrade.projectOwnedDocuments.push(`./${newlyProjectOwnedPath}`);
  write(source, ".codexrig/framework.json", serializeCanonicalJson(sourceContract));

  const target = frameworkFixture("1.0.0", "export const value = 'old';\n", {
    reusable: false,
  });
  const priorContract = contract("1.0.0");
  priorContract.upgrade.managedRoots.push(newlyProjectOwnedPath);
  write(target, ".codexrig/framework.json", serializeCanonicalJson(priorContract));
  const localAuthority = "# Newly project-owned authority\n";
  write(target, newlyProjectOwnedPath, localAuthority);
  writeInstallationReceipt({ root: target });

  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });
  assert.equal(plan.projectDocumentReconciliation.paths.includes(newlyProjectOwnedPath), false);
  assert.equal(
    plan.projectDocumentReconciliation.previouslyManagedPaths.includes(newlyProjectOwnedPath),
    true,
  );
  assert.equal(
    plan.publicOperations.some(({ path: relativePath }) => relativePath === newlyProjectOwnedPath),
    false,
  );
  applyFrameworkUpgrade(plan, {
    refreshDependencies: () => {},
    repairDependencies: () => {},
  });
  assert.equal(readFileSync(path.join(target, newlyProjectOwnedPath), "utf8"), localAuthority);
  assert.equal(newlyProjectOwnedPath in readInstallationReceipt(target).managedFiles, false);
});

test("framework upgrade adopts newly managed files that are already byte-identical", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'new';\n");
  const target = installedFixture();
  const sharedContent = "export const adopted = true;\n";
  write(source, "managed/adopted.mjs", sharedContent, 0o644);
  write(target, "managed/adopted.mjs", sharedContent, 0o644);

  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.adoptedPaths, ["managed/adopted.mjs"]);
  assert.equal(
    plan.publicOperations.some(({ path: relativePath }) => relativePath === "managed/adopted.mjs"),
    false,
  );
  applyFrameworkUpgrade(plan, {
    refreshDependencies: () => {},
    repairDependencies: () => {},
  });
  assert.equal(readFileSync(path.join(target, "managed/adopted.mjs"), "utf8"), sharedContent);
  assert.equal("managed/adopted.mjs" in readInstallationReceipt(target).managedFiles, true);
});

test("framework upgrade reports divergent edits before writing", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'new';\n");
  const target = installedFixture();
  write(target, "managed/tool.mjs", "export const value = 'local';\n", 0o755);
  const before = readFileSync(path.join(target, "managed/tool.mjs"), "utf8");
  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });
  assert.deepEqual(plan.conflicts, ["managed/tool.mjs"]);
  assert.throws(() => applyFrameworkUpgrade(plan), /has conflicts/);
  assert.equal(readFileSync(path.join(target, "managed/tool.mjs"), "utf8"), before);
});

test("framework upgrade rejects a generated project as its upstream source", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'new';\n", {
    reusable: false,
  });
  const target = installedFixture();
  assert.throws(
    () => buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target }),
    /reusable CodexRig source checkout/,
  );
});

test("framework upgrade keeps the upstream merge base separate from preserved local changes", () => {
  const sourceTwo = frameworkFixture("2.0.0", "export const value = 'old';\n");
  const target = installedFixture();
  write(target, "managed/tool.mjs", "export const value = 'local';\n", 0o755);
  const firstPlan = buildFrameworkUpgradePlan({ sourceRoot: sourceTwo, targetRoot: target });
  assert.deepEqual(firstPlan.conflicts, []);
  applyFrameworkUpgrade(firstPlan, {
    refreshDependencies: () => {},
    repairDependencies: () => {},
  });
  const receipt = readInstallationReceipt(target);
  assert.notEqual(
    receipt.managedFiles["managed/tool.mjs"].sha256,
    receipt.installedFiles["managed/tool.mjs"].sha256,
  );
  assert.equal(
    readFileSync(path.join(target, "managed/tool.mjs"), "utf8"),
    "export const value = 'local';\n",
  );

  const sourceThree = frameworkFixture("3.0.0", "export const value = 'upstream';\n");
  const secondPlan = buildFrameworkUpgradePlan({ sourceRoot: sourceThree, targetRoot: target });
  assert.deepEqual(secondPlan.conflicts, ["managed/tool.mjs"]);
});

test("framework upgrade restores files, receipt, package, and lock after refresh failure", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'new';\n");
  const target = installedFixture();
  const before = Object.fromEntries(
    [
      ".codexrig/framework.json",
      ".codexrig/installation.json",
      "managed/tool.mjs",
      "package.json",
      "pnpm-lock.yaml",
    ].map((relativePath) => [relativePath, readFileSync(path.join(target, relativePath), "utf8")]),
  );
  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });
  assert.throws(
    () =>
      applyFrameworkUpgrade(plan, {
        refreshDependencies: (root) => {
          const content = "partially updated\n";
          authorizePlannedLockfile({ root, content });
          write(root, "pnpm-lock.yaml", content);
          throw new Error("synthetic refresh failure");
        },
        repairDependencies: () => {},
      }),
    /synthetic refresh failure/,
  );
  for (const [relativePath, content] of Object.entries(before)) {
    assert.equal(readFileSync(path.join(target, relativePath), "utf8"), content, relativePath);
  }
});

test("framework upgrade preserves an unrelated target edit when rollback is required", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'new';\n");
  const target = installedFixture();
  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });
  assert.throws(
    () =>
      applyFrameworkUpgrade(plan, {
        refreshDependencies: (root) => {
          write(root, "managed/tool.mjs", "export const value = 'concurrent';\n", 0o755);
          throw new Error("synthetic refresh failure");
        },
        repairDependencies: () => {},
      }),
    /rollback stopped safely.*unrelated change/u,
  );
  assert.equal(
    readFileSync(path.join(target, "managed/tool.mjs"), "utf8"),
    "export const value = 'concurrent';\n",
  );
  assert.equal(
    existsSync(path.join(target, ".project-state/framework-upgrade/journal.json")),
    true,
  );
});

test("framework upgrade receipt uses the immutable planned source snapshot", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'planned';\n");
  const target = installedFixture();
  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });
  const plannedFiles = structuredClone(plan.sourceSnapshot.managedFiles);
  const plannedPackage = structuredClone(plan.sourceSnapshot.managedPackage);
  const receipt = applyFrameworkUpgrade(plan, {
    refreshDependencies: () => {
      write(source, "managed/tool.mjs", "export const value = 'later';\n", 0o755);
      write(source, "package.json", packageJson("1.0.0"));
    },
    repairDependencies: () => {},
  });
  assert.deepEqual(receipt.managedFiles, plannedFiles);
  assert.deepEqual(receipt.managedPackage, plannedPackage);
  assert.equal(
    readFileSync(path.join(target, "managed/tool.mjs"), "utf8"),
    "export const value = 'planned';\n",
  );
});

test("framework upgrade rejects a managed source file added after planning", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'planned';\n");
  const target = installedFixture();
  const before = readFileSync(path.join(target, "managed/tool.mjs"), "utf8");
  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });
  write(source, "managed/added-after-preview.mjs", "export const added = true;\n");

  assert.throws(
    () =>
      applyFrameworkUpgrade(plan, {
        refreshDependencies: () => {},
        repairDependencies: () => {},
      }),
    /source managed-file inventory changed after planning/,
  );
  assert.equal(readFileSync(path.join(target, "managed/tool.mjs"), "utf8"), before);
});

test("framework upgrade rejects a target receipt changed after planning", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'planned';\n");
  const target = installedFixture();
  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });
  const receiptPath = path.join(target, ".codexrig/installation.json");
  const changedReceipt = `${readFileSync(receiptPath, "utf8").trimEnd()}  \n`;
  write(target, ".codexrig/installation.json", changedReceipt);

  assert.throws(
    () =>
      applyFrameworkUpgrade(plan, {
        refreshDependencies: () => {},
        repairDependencies: () => {},
      }),
    /target changed after planning: \.codexrig\/installation\.json/,
  );
  assert.equal(readFileSync(receiptPath, "utf8"), changedReceipt);
});

test(
  "framework recovery waits for a registered child after its upgrade coordinator is killed",
  { skip: process.platform !== "linux" },
  async (t) => {
    const source = frameworkFixture("2.0.0", "export const value = 'new';\n");
    const target = installedFixture();
    const readyPath = path.join(target, "framework-child-ready.json");
    const before = Object.fromEntries(
      [
        ".codexrig/framework.json",
        ".codexrig/installation.json",
        "managed/tool.mjs",
        "package.json",
        "pnpm-lock.yaml",
      ].map((relativePath) => [
        relativePath,
        readFileSync(path.join(target, relativePath), "utf8"),
      ]),
    );
    const upgradeUrl = pathToFileURL(
      path.join(repositoryRoot, "scripts/framework/framework-upgrade.mjs"),
    ).href;
    const supervisorUrl = pathToFileURL(
      path.join(repositoryRoot, "scripts/repository/runtime-lifecycle-process.mjs"),
    ).href;
    const targetSource = `
      import { writeFileSync } from "node:fs";
      writeFileSync(${JSON.stringify(readyPath)}, JSON.stringify({ pid: process.pid }));
      setInterval(() => {}, 1000);
    `;
    const coordinatorSource = `
import { applyFrameworkUpgrade, buildFrameworkUpgradePlan } from ${JSON.stringify(upgradeUrl)};
import { spawnRuntimeLifecycleCommandSync } from ${JSON.stringify(supervisorUrl)};
const plan = buildFrameworkUpgradePlan({ sourceRoot: process.argv[1], targetRoot: process.argv[2] });
applyFrameworkUpgrade(plan, {
  refreshDependencies: (root, lifecycleCapability) => {
    spawnRuntimeLifecycleCommandSync({
      args: ["--input-type=module", "--eval", ${JSON.stringify(targetSource)}],
      command: process.execPath,
      lifecycleCapability,
      options: { cwd: root, stdio: "ignore" },
      repositoryRoot: root,
      role: "framework-test-supervisor",
    });
  },
  repairDependencies: () => {},
});`;
    const coordinator = spawn(
      process.execPath,
      ["--input-type=module", "--eval", coordinatorSource, source, target],
      { stdio: "ignore" },
    );
    let targetPid;
    t.after(() => {
      terminateIfAlive(targetPid);
      terminateIfAlive(coordinator.pid);
    });

    await waitForLifecycle(() => existsSync(readyPath), "framework child readiness");
    targetPid = JSON.parse(readFileSync(readyPath, "utf8")).pid;
    await waitForLifecycle(
      () =>
        inspectRuntimeLifecycleLock({ root: target }).owner?.descendants?.some(
          (entry) =>
            entry.identity.pid === targetPid &&
            /^linux:[a-f0-9-]{36}:\d+$/u.test(entry.identity.startIdentity),
        ),
      "framework child identity registration",
    );

    terminateIfAlive(coordinator.pid, "SIGKILL");
    await new Promise((resolve) => coordinator.once("exit", resolve));
    const orphaned = inspectRuntimeLifecycleLock({ root: target });
    assert.equal(orphaned.owner.operation, "framework-upgrade");
    assert.equal(orphaned.status, "active");
    assert.throws(
      () => recoverInterruptedFrameworkUpgrade(target, { repairDependencies: () => {} }),
      /runtime lifecycle operation is active/u,
    );

    terminateIfAlive(targetPid, "SIGTERM");
    await waitForLifecycle(() => {
      try {
        return recoverInterruptedFrameworkUpgrade(target, { repairDependencies: () => {} });
      } catch (error) {
        if (/runtime lifecycle operation is active/u.test(error?.message ?? "")) return false;
        throw error;
      }
    }, "framework recovery after child exit");
    for (const [relativePath, content] of Object.entries(before)) {
      assert.equal(readFileSync(path.join(target, relativePath), "utf8"), content, relativePath);
    }
    assert.equal(inspectRuntimeLifecycleLock({ root: target }).status, "absent");
  },
);

test("compatibility matrix renders equivalent provider tracks", () => {
  const tracks = ciCompatibilityTracks(compatibility);
  assert.deepEqual(
    tracks.map((entry) => entry.id),
    ["next-node-lts"],
  );
  const gitlab = gitlabChildPipeline(compatibility);
  assert.match(gitlab, /compatibility:next-node-lts:/);
  assert.match(gitlab, /CODEXRIG_COMPATIBILITY_TRACK: 'next-node-lts'/);
  assert.match(gitlab, /allow_failure: true/);
  assert.match(gitlab, /apt-get install -y --no-install-recommends ripgrep shellcheck/);
  assert.match(gitlab, /x86_64\|amd64\) mise_package='@jdxcode\/mise-linux-x64'/);
  assert.match(gitlab, /aarch64\|arm64\) mise_package='@jdxcode\/mise-linux-arm64'/);
  assert.match(
    gitlab,
    /npm pack --ignore-scripts --pack-destination "\$mise_stage" "\$\{mise_package\}@2026\.8\.6"/,
  );
  assert.match(gitlab, /--verify-mise-archive "\$mise_stage" "\$mise_integrity"/);
  assert.match(gitlab, /npm install --global "\$mise_archive" --ignore-scripts --offline/);
  assert.doesNotMatch(
    gitlab,
    /npm install --global "\$\{mise_package\}@2026\.8\.6" --ignore-scripts/,
  );
  assert.match(gitlab, /pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile/);
  assert.doesNotMatch(gitlab, /mise@latest/);
  const github = readFileSync(path.join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");
  assert.equal((github.match(/version: 2026\.8\.6/gu) ?? []).length, 2);
  assert.equal(
    (
      github.match(/sha256: 96f6f1f416d868b78addd22746eefc7f4bf7820c6a3afa392a9f653f708c1644/gu) ??
      []
    ).length,
    2,
  );
});

function attestationFixture() {
  const root = temporaryRoot("codexrig-attestation-");
  for (const relativePath of startupAttestedInputs) {
    const source = path.join(repositoryRoot, relativePath);
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  return root;
}

test("runtime session leases migrate only stale schema-one ownership", () => {
  const staleRoot = temporaryRoot("codexrig-schema-one-stale-");
  writeLegacyRuntimeSessionLease(staleRoot, definitelyStalePid);

  const issued = issueRuntimeSessionLease({ root: staleRoot, pid: process.pid });
  assert.equal(issued.schemaVersion, 2);
  assert.match(issued.sessionId, /^[a-f0-9-]{36}$/u);
  assert.deepEqual(inspectRuntimeSessionLease({ root: staleRoot }).lease, issued);
  assert.equal(releaseRuntimeSessionLease({ root: staleRoot, pid: process.pid }), true);

  const activeRoot = temporaryRoot("codexrig-schema-one-active-");
  writeLegacyRuntimeSessionLease(activeRoot, process.pid);
  assert.throws(
    () => issueRuntimeSessionLease({ root: activeRoot, pid: process.pid }),
    /Another Codex session already owns this repository runtime/u,
  );
  assert.equal(inspectRuntimeSessionLease({ root: activeRoot }).lease.schemaVersion, 1);
  assert.equal(releaseRuntimeSessionLease({ root: activeRoot, pid: process.pid }), true);
});

test("startup attestation binds nonce, root, lifetime, inputs, and tool versions", () => {
  const root = attestationFixture();
  const now = 1_000_000;
  const controlPolicy = startupControlPolicies.default;
  issueRuntimeSessionLease({ root, pid: process.pid });
  const issued = issueStartupAttestation({ root, now: () => now, controlPolicy });
  const hookInput = { hook_event_name: "SessionStart", source: "startup", cwd: root };
  const verified = verifyStartupAttestation({
    root,
    hookInput,
    nonce: issued.nonce,
    now: () => now + 1,
    controlPolicy,
  });
  assert.equal(verified.frameworkVersion, readFrameworkContract(repositoryRoot).frameworkVersion);
  const statePath = path.join(root, ".codex/runtime/cache/codexrig/startup-attestation.json");
  assert.equal(statSync(statePath).mode & 0o777, 0o600);
  assert.equal(readFileSync(statePath, "utf8").includes(issued.nonce), false);
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        hookInput,
        nonce: "x".repeat(43),
        now: () => now + 1,
        controlPolicy,
      }),
    /does not match/,
  );
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        hookInput,
        nonce: issued.nonce,
        now: () => now + 1,
        controlPolicy: startupControlPolicies.noAltScreen,
      }),
    /control arguments differ/,
  );
  write(root, "package.json", "{}\n");
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        hookInput,
        nonce: issued.nonce,
        now: () => now + 1,
        controlPolicy,
      }),
    /startup-critical input changed/,
  );
});

test("startup attestation rejects expired launcher state", () => {
  const root = attestationFixture();
  const controlPolicy = startupControlPolicies.default;
  issueRuntimeSessionLease({ root, pid: process.pid });
  const issued = issueStartupAttestation({
    root,
    now: () => 1_000_000,
    controlPolicy,
  });
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        hookInput: { hook_event_name: "SessionStart", source: "resume", cwd: root },
        nonce: issued.nonce,
        now: () => 2_801_000,
        controlPolicy,
      }),
    /stale/,
  );
});

test("startup attestation rejects a missing runtime session lease", () => {
  const root = attestationFixture();
  const now = 1_000_000;
  const controlPolicy = startupControlPolicies.default;
  const issued = issueStartupAttestation({ root, now: () => now, controlPolicy });
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        hookInput: { hook_event_name: "SessionStart", source: "startup", cwd: root },
        nonce: issued.nonce,
        now: () => now + 1,
        controlPolicy,
      }),
    /runtime session lease is missing or inactive/,
  );
});
