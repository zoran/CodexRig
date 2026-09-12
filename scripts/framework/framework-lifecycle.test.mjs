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
import { frameworkInstallationFindings } from "./framework-doctor.mjs";
import { readFrameworkUpgradeTargetState } from "./framework-upgrade-target.mjs";
import {
  acknowledgeFrameworkReconciliation,
  applyFrameworkUpgrade,
  buildFrameworkUpgradePlan,
  frameworkUpgradePreviewMessage,
  recoverInterruptedFrameworkUpgrade,
} from "./framework-upgrade.mjs";
import { authorizePlannedLockfile } from "./refresh-upgrade-dependencies.mjs";
import { ciCompatibilityTracks, gitlabChildPipeline } from "./compatibility-matrix.mjs";
import { projectDocumentOwners } from "../docs/project-document-owners.mjs";
import {
  beginStartupSessionWriterHandoff as beginStartupSessionWriterHandoffWithRuntime,
  bindStartupSessionCodexProcess as bindStartupSessionCodexProcessWithRuntime,
  bindStartupSessionWriter as bindStartupSessionWriterWithRuntime,
  completeStartupSessionWriterHandoff as completeStartupSessionWriterHandoffWithRuntime,
  issueStartupAttestation as issueStartupAttestationWithRuntime,
  reserveStartupAttestation as reserveStartupAttestationWithRuntime,
  runtimeSessionLaunchState,
  startupAttestedInputs,
  startupControlPolicies,
  startupSessionPlan,
  startupSessionPlanToken,
  verifyStartupAttestation as verifyStartupAttestationWithRuntime,
} from "../setup/startup-attestation.mjs";
import { sessionStartSuccess } from "../setup/startup-session-context.mjs";
import { spawnRuntimeLifecycleCommandSync } from "../repository/runtime-lifecycle-process.mjs";
import {
  acquireRuntimeLifecycleLock,
  activateRuntimeSessionLease,
  clearStaleRuntimeSessionLease,
  inspectRuntimeLifecycleLock,
  inspectRuntimeSessionLease,
  inspectRuntimeSessionRecovery,
  issueRuntimeSessionLease,
  releaseRuntimeLifecycleLock,
  releaseRuntimeSessionLease,
  transitionRuntimeSessionWriterProcess,
} from "../repository/runtime-session-lease.mjs";
import {
  ensureRuntimeDirectory,
  repositoryRuntimeRootIdentity,
} from "../repository/runtime-owned-state.mjs";
import {
  captureProcessIdentity,
  inspectProcessIdentity,
} from "../repository/runtime-process-identity.mjs";

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

let testRuntimeExecutables;

function lifecycleRuntimeExecutables() {
  if (testRuntimeExecutables) return testRuntimeExecutables;
  const runtimeRoot = temporaryRoot("codexrig-lifecycle-runtime-");
  const codex = path.join(runtimeRoot, "codex");
  const node = path.join(runtimeRoot, "node");
  const pnpm = path.join(runtimeRoot, "pnpm");
  const shell = path.join(runtimeRoot, "shell");
  write(runtimeRoot, "codex", "#!/bin/sh\nprintf '%s\\n' 'codex-cli 0.147.0'\n", 0o755);
  write(runtimeRoot, "node", "#!/bin/sh\nprintf '%s\\n' 'v24.19.0'\n", 0o755);
  write(runtimeRoot, "pnpm", "#!/bin/sh\nprintf '%s\\n' '11.22.0'\n", 0o755);
  write(runtimeRoot, "shell", "#!/bin/sh\nexit 0\n", 0o755);
  testRuntimeExecutables = Object.freeze({ codex, node, pnpm, shell });
  return testRuntimeExecutables;
}

function withRuntimeExecutables(options = {}) {
  return {
    ...options,
    runtimeExecutables: options.runtimeExecutables ?? lifecycleRuntimeExecutables(),
  };
}

function issueStartupAttestation(options = {}) {
  return issueStartupAttestationWithRuntime(withRuntimeExecutables(options));
}

function reserveStartupAttestation(root, pid, options = {}) {
  return reserveStartupAttestationWithRuntime(root, pid, withRuntimeExecutables(options));
}

function bindStartupSessionWriter(root, pid, writerPid, options = {}) {
  const runtimeOptions = withRuntimeExecutables(options);
  bindStartupSessionWriterWithRuntime(root, pid, writerPid, runtimeOptions);
  beginStartupSessionWriterHandoffWithRuntime(root, pid, runtimeOptions);
  return bindStartupSessionCodexProcessWithRuntime(root, pid, writerPid, runtimeOptions);
}

function verifyStartupAttestation(options = {}) {
  return verifyStartupAttestationWithRuntime(withRuntimeExecutables(options));
}

function writeCurrentRuntimeSessionLease(
  root,
  pid,
  codexSessionId,
  phase = "active",
  {
    sessionId = "10000000-0000-4000-8000-000000000001",
    startIdentity = captureProcessIdentity(process.pid)?.startIdentity ?? null,
    startedAt = "2026-08-01T00:00:00.000Z",
  } = {},
) {
  ensureRuntimeDirectory(root);
  const processIdentity = {
    pid,
    startIdentity,
  };
  write(
    root,
    ".codex/runtime/codexrig-session.json",
    serializeCanonicalJson({
      schemaVersion: 6,
      codexProcess: phase === "active" ? processIdentity : null,
      codexSessionId: phase === "active" ? codexSessionId : null,
      phase,
      process: processIdentity,
      sessionId,
      startedAt,
      writerPhase: phase === "active" ? "bound" : "unbound",
      writerProcess: phase === "active" ? processIdentity : null,
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
        ".codexrig/compatibility.json",
        ".codex/README.md",
        "AGENTS.md",
        "README.md",
        "config/delivery.json",
        "config/localization.json",
        "config/product.json",
        "config/tenancy.json",
        "docs/future-modules.md",
        "docs/project.md",
        "instructions.md",
      ],
      managedRoots: [".codexrig/framework.json", ".codexrig/policy-projection.json", "managed"],
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

function installedFixture() {
  const root = frameworkFixture("1.0.0", "export const value = 'old';\n", {
    reusable: false,
  });
  writeInstallationReceipt({ root });
  return root;
}

test("framework semantic versions follow prerelease precedence and reject invalid identifiers", () => {
  assert.equal(compareSemver("1.0.0-alpha.2", "1.0.0-alpha.10"), -1);
  assert.equal(compareSemver("1.0.0-alpha.10", "1.0.0"), -1);
  assert.equal(compareSemver("1.0.0+build.1", "1.0.0+build.2"), 0);
  assert.throws(() => parseSemver("1.0.0-alpha..1"), /semantic versioning/);
  assert.throws(() => parseSemver("1.0.0-alpha.01"), /semantic versioning/);
});

test("shared startup and verification diagnostics reject drift until a reviewed upgrade adopts the repair", () => {
  const original = "export const repaired = false;\n";
  const repaired = "export const repaired = true;\n";
  const target = frameworkFixture("1.0.0", original, { reusable: false });
  const source = frameworkFixture("2.0.0", repaired);
  writeInstallationReceipt({ root: target });
  write(target, "docs/project.md", "# Product Manifest\n\nKeep this product definition.\n");
  assert.deepEqual(frameworkInstallationFindings({ root: target }).errors, []);

  write(target, "managed/tool.mjs", repaired, 0o755);
  assert.deepEqual(frameworkInstallationFindings({ root: target }).errors, [
    {
      code: "installation.managed-drift",
      message: "Managed framework file has local changes: managed/tool.mjs.",
    },
  ]);

  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });
  assert.deepEqual(plan.conflicts, []);
  applyFrameworkUpgrade(plan, {
    refreshDependencies: () => {},
    repairDependencies: () => {},
  });
  assert.deepEqual(frameworkInstallationFindings({ root: target }).errors, []);
  assert.equal(readFileSync(path.join(target, "managed/tool.mjs"), "utf8"), repaired);
  assert.equal(
    readFileSync(path.join(target, "docs/project.md"), "utf8"),
    "# Product Manifest\n\nKeep this product definition.\n",
  );
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

test("framework upgrades reject every non-current target schema", () => {
  for (const { path: relativePath, schemaVersion, message } of [
    {
      path: ".codexrig/framework.json",
      schemaVersion: 1,
      message: /Unsupported framework contract schema/u,
    },
    {
      path: ".codexrig/installation.json",
      schemaVersion: 1,
      message: /Unsupported installation receipt schema/u,
    },
    {
      path: ".codexrig/policy-projection.json",
      schemaVersion: 2,
      message: /policy projection is invalid/u,
    },
  ]) {
    const target = installedFixture();
    const absolutePath = path.join(target, relativePath);
    const value = JSON.parse(readFileSync(absolutePath, "utf8"));
    value.schemaVersion = schemaVersion;
    write(target, relativePath, serializeCanonicalJson(value));
    assert.throws(() => readFrameworkUpgradeTargetState(target), message);
  }
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

// Ownership migration is explicit local reconciliation: the updater preserves authored bytes,
// binds references to the preview, and cannot infer semantic preservation from a policy receipt.
test("repeated upgrades preserve HTML owners and a conservatively reconciled mixed manifest", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'new';\n");
  const target = frameworkFixture("1.0.0", "export const value = 'old';\n", {
    projection: earlierPolicyProjection(),
    reusable: false,
  });
  writeInstallationReceipt({ root: target });
  const uniqueRequirement =
    "Offline inspections must survive restart, except explicitly discarded drafts.";
  const evidenceLimit =
    "No authentication runtime is implemented; the configured policy and fictional UI prove no account-backed operation.";
  const owners =
    "- Requirements owner: [Requirements](specification.html#offline).\n- UI reference: [Reference](../design/reference.html#preview).";
  const mixed = `# Project Manifest\n\n## Definition\n\nAn inspection product.\n\n${owners}\n\n${uniqueRequirement}\n\n## System Shape\n\n${evidenceLimit}\n`;
  const originalSpecification =
    '<!doctype html><title>Product requirements</title><h1 id="offline">Offline inspections</h1><p>Encrypt local inspection data.</p>';
  const reference =
    '<!doctype html><title>UI reference</title><h1 id="preview">Fictional sign-in preview</h1>';
  write(target, "docs/project.md", mixed);
  write(target, "docs/specification.html", originalSpecification);
  write(target, "design/reference.html", reference);
  write(
    target,
    "README.md",
    "# Inspection project\n\nSee [requirements](docs/specification.html#offline).\n",
  );
  const plan = buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target });
  assert.ok(plan.projectDocumentReconciliation.paths.includes("docs/specification.html"));
  assert.ok(plan.projectDocumentReconciliation.paths.includes("design/reference.html"));
  assert.equal(
    plan.publicOperations.some(({ path: value }) =>
      ["docs/project.md", "docs/specification.html", "design/reference.html", "README.md"].includes(
        value,
      ),
    ),
    false,
  );
  // A reference changing after preview invalidates the plan instead of silently changing its basis.
  write(target, "docs/specification.html", originalSpecification + "<p>Changed after preview.</p>");
  assert.throws(
    () => applyFrameworkUpgrade(plan, { refreshDependencies: () => {} }),
    /target changed after planning/,
  );
  write(target, "docs/specification.html", originalSpecification);
  applyFrameworkUpgrade(plan, { refreshDependencies: () => {}, repairDependencies: () => {} });
  assert.equal(readFileSync(path.join(target, "docs/project.md"), "utf8"), mixed);
  assert.equal(
    readFileSync(path.join(target, "docs/specification.html"), "utf8"),
    originalSpecification,
  );
  assert.equal(readFileSync(path.join(target, "design/reference.html"), "utf8"), reference);
  // Model the reviewed local migration, preserving the exception and evidence qualification.
  const reconciledSpecification = originalSpecification + `<p>${uniqueRequirement}</p>`;
  write(target, "docs/specification.html", reconciledSpecification);
  const reconciled = mixed.replace(`\n\n${uniqueRequirement}`, "");
  write(target, "docs/project.md", reconciled.replace("#offline", "#missing"));
  assert.throws(
    () => acknowledgeFrameworkReconciliation(target, plan.digest),
    /ownership reconciliation is unresolved/,
  );
  assert.ok(readInstallationReceipt(target).pendingReconciliation);
  write(target, "docs/project.md", reconciled);
  acknowledgeFrameworkReconciliation(target, plan.digest);
  assert.deepEqual(projectDocumentOwners({ root: target }).findings, []);
  const nextSource = frameworkFixture("3.0.0", "export const value = 'newer';\n");
  const next = buildFrameworkUpgradePlan({ sourceRoot: nextSource, targetRoot: target });
  applyFrameworkUpgrade(next, { refreshDependencies: () => {}, repairDependencies: () => {} });
  assert.equal(readFileSync(path.join(target, "docs/project.md"), "utf8"), reconciled);
  assert.equal(
    readFileSync(path.join(target, "docs/specification.html"), "utf8"),
    reconciledSpecification,
  );
  assert.equal(readFileSync(path.join(target, "design/reference.html"), "utf8"), reference);
  assert.ok(reconciled.includes(evidenceLimit));
  assert.ok(reconciledSpecification.includes(uniqueRequirement));
  assert.ok(
    readFileSync(path.join(target, "README.md"), "utf8").includes("specification.html#offline"),
  );
  assert.equal(readInstallationReceipt(target).frameworkVersion, "3.0.0");
});

test("upgrade refuses ambiguous or managed documentation owners without writing", () => {
  const source = frameworkFixture("2.0.0", "export const value = 'new';\n");
  const target = frameworkFixture("1.0.0", "export const value = 'old';\n", { reusable: false });
  writeInstallationReceipt({ root: target });
  const receipt = readFileSync(path.join(target, ".codexrig/installation.json"), "utf8");
  for (const declarations of [
    "- Requirements owner: [Missing](missing.html).",
    "- Requirements owner: [First](spec.html).\n- Requirements owner: [Second](spec.html).",
    "- Requirements owner: [Managed policy](../.codexrig/policy-projection.json).",
  ]) {
    write(target, "docs/spec.html", "<h1>Requirements</h1>");
    write(target, "docs/project.md", `# Project Manifest\n\n${declarations}\n`);
    assert.throws(
      () => buildFrameworkUpgradePlan({ sourceRoot: source, targetRoot: target }),
      /documentation ownership|Documentation owner conflicts/,
    );
    assert.equal(readFileSync(path.join(target, ".codexrig/installation.json"), "utf8"), receipt);
  }
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
  const removingProjection = JSON.parse(
    readFileSync(path.join(removingSource, ".codexrig/policy-projection.json"), "utf8"),
  );
  for (const policy of removingProjection.policies) {
    if (!policy.reconcileDocuments.includes("instructions.md")) continue;
    policy.reconcileDocuments = policy.reconcileDocuments.filter(
      (relativePath) => relativePath !== "instructions.md",
    );
    policy.version += 1;
  }
  write(
    removingSource,
    ".codexrig/policy-projection.json",
    serializeCanonicalJson(removingProjection),
  );
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
  plannedPackage.packageManager = JSON.parse(
    readFileSync(path.join(target, "package.json"), "utf8"),
  ).packageManager;
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
            /^linux:[a-f0-9-]{36}:\d+:\d+:\d+$/u.test(entry.identity.startIdentity),
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
  const currentMatrix = JSON.parse(
    readFileSync(path.join(repositoryRoot, ".codexrig/compatibility.json"), "utf8"),
  );
  assert.equal(github.split(`version: ${currentMatrix.ci.miseVersion}`).length - 1, 2);
  assert.equal(github.split(`sha256: ${currentMatrix.ci.miseLinuxX64Sha256}`).length - 1, 2);
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

function sessionStartHookInput(root, overrides = {}) {
  return {
    cwd: root,
    hook_event_name: "SessionStart",
    transcript_path: path.join(root, "session.jsonl"),
    model: "gpt-6-astra",
    permission_mode: "default",
    session_id: "01a01234-5678-7abc-8def-0123456789ab",
    source: "startup",
    ...overrides,
  };
}

function bindCurrentRuntimeSessionWriter(root, lease) {
  const input = {
    root,
    pid: process.pid,
    runtimeSessionId: lease.sessionId,
    writerPid: process.pid,
  };
  transitionRuntimeSessionWriterProcess({ ...input, transition: "supervisor" });
  transitionRuntimeSessionWriterProcess({ ...input, transition: "handoff" });
  return transitionRuntimeSessionWriterProcess({ ...input, transition: "codex" });
}

function releaseCurrentRuntimeSession(root, pid = process.pid) {
  const current = inspectRuntimeSessionLease({ root });
  if (
    current.status === "active" &&
    current.lease.process.pid === process.pid &&
    ["handoff", "bound"].includes(current.lease.writerPhase)
  ) {
    transitionRuntimeSessionWriterProcess({
      root,
      pid: process.pid,
      runtimeSessionId: current.lease.sessionId,
      transition: "complete",
    });
  }
  return releaseRuntimeSessionLease({ root, pid });
}

test("runtime session leases enforce one current schema without choosing the native session", () => {
  const emptyRoot = temporaryRoot("codexrig-no-session-");
  assert.deepEqual(startupSessionPlan({ root: emptyRoot }), {
    mode: "resume-picker",
  });

  const unsupportedRoot = temporaryRoot("codexrig-unsupported-session-");
  ensureRuntimeDirectory(unsupportedRoot);
  write(
    unsupportedRoot,
    ".codex/runtime/codexrig-session.json",
    serializeCanonicalJson({ schemaVersion: 999 }),
    0o600,
  );
  assert.throws(
    () => inspectRuntimeSessionLease({ root: unsupportedRoot }),
    /invalid or uses an unsupported schema/u,
  );
  for (const [name, overrides] of [
    ["noncanonical-time", { startedAt: "August 1, 2026" }],
    ["noncanonical-id", { sessionId: "10000000-0000-0000-0000-000000000001" }],
  ]) {
    const invalidRoot = temporaryRoot(`codexrig-${name}-session-`);
    writeCurrentRuntimeSessionLease(
      invalidRoot,
      definitelyStalePid,
      "01a01234-5678-7abc-8def-0123456789ab",
      "active",
      overrides,
    );
    assert.throws(
      () => inspectRuntimeSessionLease({ root: invalidRoot }),
      /invalid or uses an unsupported schema/u,
    );
  }

  const issuanceRoot = emptyRoot;
  const issued = issueRuntimeSessionLease({ root: issuanceRoot, pid: process.pid });
  assert.equal(issued.schemaVersion, 6);
  assert.equal(issued.phase, "launching");
  assert.equal(issued.codexSessionId, null);
  assert.equal(issued.process.pid, process.pid);
  assert.equal(
    issued.process.startIdentity === null ||
      /^linux:[a-f0-9-]{36}:\d+:\d+:\d+$/u.test(issued.process.startIdentity),
    true,
  );
  assert.match(
    issued.sessionId,
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,
  );
  assert.deepEqual(inspectRuntimeSessionLease({ root: issuanceRoot }).lease, issued);
  assert.equal(releaseCurrentRuntimeSession(issuanceRoot), true);

  const activeRoot = temporaryRoot("codexrig-current-active-");
  const activeLease = issueRuntimeSessionLease({ root: activeRoot, pid: process.pid });
  assert.throws(
    () => issueRuntimeSessionLease({ root: activeRoot, pid: process.pid }),
    /Another Codex session already owns this repository runtime/u,
  );
  assert.deepEqual(inspectRuntimeSessionLease({ root: activeRoot }).lease, activeLease);
  assert.equal(releaseCurrentRuntimeSession(activeRoot), true);

  const currentProcess = captureProcessIdentity(process.pid);
  if (currentProcess.startIdentity !== null) {
    const fields = currentProcess.startIdentity.split(":");
    const foreignNamespace = {
      ...currentProcess,
      startIdentity: [...fields.slice(0, 3), String(BigInt(fields[3]) + 1n), fields[4]].join(":"),
    };
    assert.equal(inspectProcessIdentity(foreignNamespace), "unknown");
    assert.equal(inspectProcessIdentity({ ...currentProcess, pid: definitelyStalePid }), "stale");

    const reusedPidRoot = temporaryRoot("codexrig-reused-owner-pid-");
    const reusedPidLease = issueRuntimeSessionLease({ root: reusedPidRoot, pid: process.pid });
    const reusedProcess = {
      ...currentProcess,
      startIdentity: [...fields.slice(0, 4), String(BigInt(fields[4]) + 1n)].join(":"),
    };
    write(
      reusedPidRoot,
      ".codex/runtime/codexrig-session.json",
      serializeCanonicalJson({ ...reusedPidLease, process: reusedProcess }),
      0o600,
    );
    assert.equal(inspectRuntimeSessionLease({ root: reusedPidRoot }).status, "stale");
    assert.throws(
      () => releaseRuntimeSessionLease({ root: reusedPidRoot, pid: process.pid }),
      /different process identity/u,
    );
    assert.equal(clearStaleRuntimeSessionLease({ root: reusedPidRoot }), true);
  }
  assert.equal(
    inspectProcessIdentity({ pid: definitelyStalePid, startIdentity: null }),
    process.platform === "linux" ? "unknown" : "stale",
  );
  assert.equal(
    inspectProcessIdentity({ pid: process.pid, startIdentity: null }),
    process.platform === "linux" ? "unknown" : "active",
  );
  const codexSessionId = "01a01234-5678-7abc-8def-0123456789ab";

  if (currentProcess.startIdentity !== null) {
    const indeterminateHandoffRoot = temporaryRoot("codexrig-indeterminate-writer-handoff-");
    ensureRuntimeDirectory(indeterminateHandoffRoot);
    const deadCoordinator = { ...currentProcess, pid: definitelyStalePid };
    write(
      indeterminateHandoffRoot,
      ".codex/runtime/codexrig-session.json",
      serializeCanonicalJson({
        schemaVersion: 6,
        codexProcess: null,
        codexSessionId: null,
        phase: "launching",
        process: deadCoordinator,
        root: repositoryRuntimeRootIdentity(indeterminateHandoffRoot),
        sessionId: "10000000-0000-4000-8000-000000000004",
        startedAt: "2026-08-01T00:00:00.000Z",
        writerPhase: "handoff",
        writerProcess: deadCoordinator,
      }),
      0o600,
    );
    assert.equal(inspectRuntimeSessionLease({ root: indeterminateHandoffRoot }).status, "unknown");
    assert.throws(
      () => clearStaleRuntimeSessionLease({ root: indeterminateHandoffRoot }),
      /still active or cannot be verified as stopped/u,
    );

    const boundRoot = temporaryRoot("codexrig-bound-resume-writer-");
    ensureRuntimeDirectory(boundRoot);
    write(
      boundRoot,
      ".codex/runtime/codexrig-session.json",
      serializeCanonicalJson({
        schemaVersion: 6,
        codexProcess: currentProcess,
        codexSessionId,
        phase: "active",
        process: deadCoordinator,
        root: repositoryRuntimeRootIdentity(boundRoot),
        sessionId: "10000000-0000-4000-8000-000000000002",
        startedAt: "2026-08-01T00:00:00.000Z",
        writerPhase: "bound",
        writerProcess: currentProcess,
      }),
      0o600,
    );
    assert.equal(inspectRuntimeSessionLease({ root: boundRoot }).status, "active");

    const freshBoundRoot = temporaryRoot("codexrig-bound-fresh-writer-");
    ensureRuntimeDirectory(freshBoundRoot);
    write(
      freshBoundRoot,
      ".codex/runtime/codexrig-session.json",
      serializeCanonicalJson({
        schemaVersion: 6,
        codexProcess: currentProcess,
        codexSessionId,
        phase: "active",
        process: deadCoordinator,
        root: repositoryRuntimeRootIdentity(freshBoundRoot),
        sessionId: "10000000-0000-4000-8000-000000000003",
        startedAt: "2026-08-01T00:00:00.000Z",
        writerPhase: "bound",
        writerProcess: currentProcess,
      }),
      0o600,
    );
    assert.equal(inspectRuntimeSessionLease({ root: freshBoundRoot }).status, "active");
    write(
      freshBoundRoot,
      ".codex/runtime/codexrig-session.json",
      serializeCanonicalJson({
        ...inspectRuntimeSessionLease({ root: freshBoundRoot }).lease,
        writerProcess: null,
      }),
      0o600,
    );
    assert.throws(
      () => inspectRuntimeSessionLease({ root: freshBoundRoot }),
      /invalid or uses an unsupported schema/u,
    );
  }

  const obscuredIdentityRoot = temporaryRoot("codexrig-obscured-process-identity-");
  writeCurrentRuntimeSessionLease(
    obscuredIdentityRoot,
    definitelyStalePid,
    "01a01234-5678-7abc-8def-0123456789ab",
    "active",
    { startIdentity: null },
  );
  assert.equal(
    inspectRuntimeSessionLease({ root: obscuredIdentityRoot }).status,
    process.platform === "linux" ? "unknown" : "stale",
  );

  const portableIdentityRoot = temporaryRoot("codexrig-portable-process-identity-");
  writeCurrentRuntimeSessionLease(
    portableIdentityRoot,
    process.pid,
    "01a01234-5678-7abc-8def-0123456789ab",
  );
  assert.equal(inspectRuntimeSessionLease({ root: portableIdentityRoot }).status, "active");
  assert.equal(releaseCurrentRuntimeSession(portableIdentityRoot), true);

  const exactRoot = temporaryRoot("codexrig-exact-session-stale-");
  writeCurrentRuntimeSessionLease(exactRoot, definitelyStalePid, codexSessionId);
  assert.deepEqual(startupSessionPlan({ root: exactRoot }), {
    mode: "resume-picker",
  });
  assert.equal(startupSessionPlanToken(startupSessionPlan({ root: exactRoot })), "resume-picker");

  const interruptedLaunchRoot = temporaryRoot("codexrig-interrupted-launch-");
  writeCurrentRuntimeSessionLease(
    interruptedLaunchRoot,
    definitelyStalePid,
    codexSessionId,
    "launching",
  );
  assert.deepEqual(startupSessionPlan({ root: interruptedLaunchRoot }), {
    mode: "resume-picker",
  });

  const interruptedResumeRoot = temporaryRoot("codexrig-interrupted-resume-");
  const markerLease = issueRuntimeSessionLease({ root: interruptedResumeRoot, pid: process.pid });
  bindCurrentRuntimeSessionWriter(interruptedResumeRoot, markerLease);
  activateRuntimeSessionLease({
    root: interruptedResumeRoot,
    pid: process.pid,
    runtimeSessionId: markerLease.sessionId,
    codexSessionId,
  });
  assert.equal(releaseCurrentRuntimeSession(interruptedResumeRoot), true);
  writeCurrentRuntimeSessionLease(
    interruptedResumeRoot,
    definitelyStalePid,
    codexSessionId,
    "launching",
  );
  assert.deepEqual(startupSessionPlan({ root: interruptedResumeRoot }), {
    mode: "resume-picker",
  });
});

test("session mutation authenticates its caller and release requires terminal completion", () => {
  const root = temporaryRoot("codexrig-terminal-session-release-");
  const lease = issueRuntimeSessionLease({ root, pid: process.pid });
  bindCurrentRuntimeSessionWriter(root, lease);
  activateRuntimeSessionLease({
    root,
    pid: process.pid,
    runtimeSessionId: lease.sessionId,
    codexSessionId: "01a01234-5678-7abc-8def-0123456789ab",
  });
  assert.throws(
    () => releaseRuntimeSessionLease({ root, pid: process.pid }),
    /requires proven terminal child completion/u,
  );
  assert.equal(inspectRuntimeSessionLease({ root }).lease.writerPhase, "bound");
  assert.equal(releaseCurrentRuntimeSession(root), true);

  const callerRoot = temporaryRoot("codexrig-session-caller-");
  issueRuntimeSessionLease({ root: callerRoot, pid: process.pid });
  const leaseModule = pathToFileURL(
    path.join(repositoryRoot, "scripts/repository/runtime-session-lease.mjs"),
  ).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { releaseRuntimeSessionLease } from ${JSON.stringify(leaseModule)}; releaseRuntimeSessionLease({ root: ${JSON.stringify(callerRoot)}, pid: ${process.pid} });`,
    ],
    { cwd: callerRoot, encoding: "utf8", input: "", stdio: "pipe" },
  );
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /mutation must be performed by its owning process/u);
  assert.equal(inspectRuntimeSessionLease({ root: callerRoot }).status, "active");
  assert.equal(releaseCurrentRuntimeSession(callerRoot), true);
});

test("exact Codex PID binding survives SessionStart activation winning the race", () => {
  const root = attestationFixture();
  const controlPolicy = startupControlPolicies.default;
  const reservation = reserveStartupAttestation(root, process.pid, { controlPolicy });
  const transitionOptions = withRuntimeExecutables({
    controlPolicy,
    expectedAttestation: reservation.attestation,
    nonce: reservation.nonce,
  });
  bindStartupSessionWriterWithRuntime(root, process.pid, process.pid, transitionOptions);
  beginStartupSessionWriterHandoffWithRuntime(root, process.pid, transitionOptions);

  verifyStartupAttestation({
    root,
    controlPolicy,
    expectedAttestation: reservation.attestation,
    hookInput: sessionStartHookInput(root),
    nonce: reservation.nonce,
  });
  assert.equal(inspectRuntimeSessionLease({ root }).lease.phase, "active");
  assert.equal(inspectRuntimeSessionLease({ root }).lease.writerPhase, "handoff");
  bindStartupSessionCodexProcessWithRuntime(root, process.pid, process.pid, transitionOptions);
  assert.equal(inspectRuntimeSessionLease({ root }).lease.writerPhase, "bound");

  write(root, "package.json", '{"changedDuringSession":true}\n');
  completeStartupSessionWriterHandoffWithRuntime(root, process.pid, transitionOptions);
  assert.equal(inspectRuntimeSessionLease({ root }).lease.writerPhase, "completed");
  assert.equal(releaseRuntimeSessionLease({ root, pid: process.pid }), true);
});

test("terminal lease release repairs missing or invalid recovery without replacing a valid marker", () => {
  const activeSessionId = "01a01234-5678-7abc-8def-0123456789ab";
  const differentSessionId = "01a09999-5678-7abc-8def-0123456789ab";
  for (const recoveryState of ["missing", "invalid", "different-valid"]) {
    const root = temporaryRoot(`codexrig-release-recovery-${recoveryState}-`);
    const lease = issueRuntimeSessionLease({ root, pid: process.pid });
    bindCurrentRuntimeSessionWriter(root, lease);
    activateRuntimeSessionLease({
      root,
      pid: process.pid,
      runtimeSessionId: lease.sessionId,
      codexSessionId: activeSessionId,
    });
    const recoveryPath = path.join(root, ".codex/runtime/codexrig-session-recovery.json");
    if (recoveryState === "missing") rmSync(recoveryPath);
    else if (recoveryState === "invalid")
      write(root, ".codex/runtime/codexrig-session-recovery.json", "{}\n", 0o600);
    else {
      write(
        root,
        ".codex/runtime/codexrig-session-recovery.json",
        serializeCanonicalJson({
          schemaVersion: 1,
          codexSessionId: differentSessionId,
          root: repositoryRuntimeRootIdentity(root),
          updatedAt: "2026-08-18T00:00:00.000Z",
        }),
        0o600,
      );
    }

    assert.equal(releaseCurrentRuntimeSession(root), true);
    const recovery = inspectRuntimeSessionRecovery({ root });
    assert.equal(recovery.status, "present");
    assert.equal(
      recovery.recovery.codexSessionId,
      recoveryState === "different-valid" ? differentSessionId : activeSessionId,
    );
  }
});

test("native picker reservation preserves recovery evidence until authenticated selection", () => {
  const root = attestationFixture();
  const controlPolicy = startupControlPolicies.default;
  const previousId = "01a01234-5678-7abc-8def-0123456789ab";
  const selectedId = "01a09999-5678-7abc-8def-0123456789ab";
  const initial = issueRuntimeSessionLease({ root, pid: process.pid });
  bindCurrentRuntimeSessionWriter(root, initial);
  activateRuntimeSessionLease({
    root,
    pid: process.pid,
    runtimeSessionId: initial.sessionId,
    codexSessionId: previousId,
  });
  assert.equal(releaseCurrentRuntimeSession(root), true);
  const reservation = reserveStartupAttestation(root, process.pid, { controlPolicy });
  assert.deepEqual(reservation.plan, { mode: "resume-picker" });
  assert.equal(reservation.lease.codexSessionId, null);
  assert.equal(runtimeSessionLaunchState(root, process.pid), "launching");
  assert.equal(inspectRuntimeSessionRecovery({ root }).recovery.codexSessionId, previousId);
  assert.throws(
    () => reserveStartupAttestation(root, process.pid, { controlPolicy }),
    /already owns/u,
  );
  bindStartupSessionWriter(root, process.pid, process.pid, {
    controlPolicy,
    expectedAttestation: reservation.attestation,
    nonce: reservation.nonce,
  });
  const verified = verifyStartupAttestation({
    root,
    controlPolicy,
    expectedAttestation: reservation.attestation,
    nonce: reservation.nonce,
    hookInput: sessionStartHookInput(root, { session_id: selectedId, source: "resume" }),
  });
  assert.equal(verified.sessionSource, "resume");
  assert.equal(inspectRuntimeSessionLease({ root }).lease.codexSessionId, selectedId);
  assert.equal(inspectRuntimeSessionRecovery({ root }).recovery.codexSessionId, selectedId);
  assert.equal(releaseCurrentRuntimeSession(root), true);
});

test("exact recovery survives an interrupted lease activation", () => {
  const root = attestationFixture();
  const codexSessionId = "01a01234-5678-7abc-8def-0123456789ab";
  const lease = issueRuntimeSessionLease({ root, pid: process.pid });
  bindCurrentRuntimeSessionWriter(root, lease);
  assert.throws(
    () =>
      activateRuntimeSessionLease({
        root,
        pid: process.pid,
        runtimeSessionId: lease.sessionId,
        codexSessionId,
        testHooks: {
          beforeSessionLeaseActivate() {
            throw new Error("synthetic interrupted activation");
          },
        },
      }),
    /synthetic interrupted activation/u,
  );
  assert.equal(inspectRuntimeSessionLease({ root }).lease.phase, "launching");
  assert.equal(inspectRuntimeSessionRecovery({ root }).recovery.codexSessionId, codexSessionId);
  assert.equal(releaseCurrentRuntimeSession(root), true);
  assert.deepEqual(startupSessionPlan({ root }), {
    mode: "resume-picker",
  });
});

test("lease activation never overwrites a concurrently changed reservation", () => {
  const root = attestationFixture();
  const codexSessionId = "01a01234-5678-7abc-8def-0123456789ab";
  const lease = issueRuntimeSessionLease({ root, pid: process.pid });
  bindCurrentRuntimeSessionWriter(root, lease);
  const replacementSessionId = "20000000-0000-4000-8000-000000000001";
  assert.throws(
    () =>
      activateRuntimeSessionLease({
        root,
        pid: process.pid,
        runtimeSessionId: lease.sessionId,
        codexSessionId,
        testHooks: {
          beforeSessionLeaseActivate({ current }) {
            write(
              root,
              ".codex/runtime/codexrig-session.json",
              serializeCanonicalJson({ ...current.lease, sessionId: replacementSessionId }),
              0o600,
            );
          },
        },
      }),
    /lease changed before replacement/u,
  );
  const replacement = inspectRuntimeSessionLease({ root }).lease;
  assert.equal(replacement.sessionId, replacementSessionId);
  assert.equal(replacement.phase, "launching");
  assert.equal(inspectRuntimeSessionRecovery({ root }).recovery.codexSessionId, codexSessionId);
  assert.equal(releaseCurrentRuntimeSession(root), true);
});

test("invalid recovery metadata does not override native selection and is replaced after verification", () => {
  const root = temporaryRoot("codexrig-invalid-recovery-");
  ensureRuntimeDirectory(root);
  write(root, ".codex/runtime/codexrig-session-recovery.json", "{invalid\n", 0o600);
  assert.equal(inspectRuntimeSessionRecovery({ root }).status, "invalid");
  assert.deepEqual(startupSessionPlan({ root }), {
    mode: "resume-picker",
  });

  const codexSessionId = "01a01234-5678-7abc-8def-0123456789ab";
  const lease = issueRuntimeSessionLease({ root, pid: process.pid });
  bindCurrentRuntimeSessionWriter(root, lease);
  activateRuntimeSessionLease({
    root,
    pid: process.pid,
    runtimeSessionId: lease.sessionId,
    codexSessionId,
  });
  const repaired = inspectRuntimeSessionRecovery({ root });
  assert.equal(repaired.status, "present");
  assert.equal(repaired.recovery.codexSessionId, codexSessionId);
  assert.equal(releaseCurrentRuntimeSession(root), true);
});

test("a valid latest-session marker outranks a mismatched stale active lease", () => {
  const root = temporaryRoot("codexrig-newer-recovery-");
  const latestSessionId = "01a09999-5678-7abc-8def-0123456789ab";
  const staleLeaseSessionId = "01a01111-5678-7abc-8def-0123456789ab";
  const initial = issueRuntimeSessionLease({ root, pid: process.pid });
  bindCurrentRuntimeSessionWriter(root, initial);
  activateRuntimeSessionLease({
    root,
    pid: process.pid,
    runtimeSessionId: initial.sessionId,
    codexSessionId: latestSessionId,
  });
  assert.equal(releaseCurrentRuntimeSession(root), true);
  writeCurrentRuntimeSessionLease(root, definitelyStalePid, staleLeaseSessionId);

  assert.deepEqual(startupSessionPlan({ root }), {
    mode: "resume-picker",
  });
  const replacement = issueRuntimeSessionLease({
    root,
    pid: process.pid,
  });
  assert.equal(inspectRuntimeSessionRecovery({ root }).recovery.codexSessionId, latestSessionId);
  assert.equal(releaseCurrentRuntimeSession(root, replacement.process.pid), true);
});

test("startup attestation binds nonce, root, lifetime, inputs, and tool versions", () => {
  const root = attestationFixture();
  const now = 1_000_000;
  const controlPolicy = startupControlPolicies.default;
  issueRuntimeSessionLease({ root, pid: process.pid });
  const issued = issueStartupAttestation({ root, now: () => now, controlPolicy });
  bindStartupSessionWriter(root, process.pid, process.pid, {
    controlPolicy,
    expectedAttestation: issued.attestation,
    nonce: issued.nonce,
    now: () => now + 1,
  });
  const codexSessionId = "01a01234-5678-7abc-8def-0123456789ab";
  const hookInput = sessionStartHookInput(root, { session_id: codexSessionId });
  const { cwd: _cwd, ...missingRoot } = hookInput;
  for (const [candidate, expected] of [
    [missingRoot, /session root is missing or invalid/u],
    [{ ...hookInput, model: "gpt-5.6-terra" }, /effective model differs/u],
    [{ ...hookInput, permission_mode: "bypassPermissions" }, /permission mode differs/u],
  ]) {
    assert.throws(
      () =>
        verifyStartupAttestation({
          root,
          hookInput: candidate,
          nonce: issued.nonce,
          now: () => now + 1,
          controlPolicy,
        }),
      expected,
    );
  }
  const verified = verifyStartupAttestation({
    root,
    hookInput,
    nonce: issued.nonce,
    now: () => now + 1,
    controlPolicy,
  });
  assert.equal(verified.schemaVersion, 7);
  assert.equal(verified.sessionSource, "startup");
  const startupContext = sessionStartSuccess(verified, { root, now: () => now + 1 })
    .hookSpecificOutput.additionalContext;
  assert.ok(Buffer.byteLength(startupContext, "utf8") <= 768);
  assert.match(startupContext, /Startup Repository Reconstruction/u);
  assert.match(startupContext, /worktree:status/u);
  assert.equal(verified.frameworkVersion, readFrameworkContract(repositoryRoot).frameworkVersion);
  assert.equal(inspectRuntimeSessionLease({ root }).lease.codexSessionId, codexSessionId);
  assert.equal(inspectRuntimeSessionLease({ root }).lease.phase, "active");
  assert.equal(inspectRuntimeSessionRecovery({ root }).recovery.codexSessionId, codexSessionId);
  const statePath = path.join(root, ".codex/runtime/cache/codexrig/startup-attestation.json");
  assert.equal(statSync(statePath).mode & 0o777, 0o600);
  assert.equal(readFileSync(statePath, "utf8").includes(issued.nonce), false);
  const attestationContent = readFileSync(statePath, "utf8");
  writeFileSync(
    statePath,
    serializeCanonicalJson({ ...JSON.parse(attestationContent), unsupportedField: true }),
    "utf8",
  );
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        hookInput,
        nonce: issued.nonce,
        now: () => now + 1,
        controlPolicy,
      }),
    /attestation schema is unsupported/u,
  );
  writeFileSync(statePath, attestationContent, "utf8");
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

test("startup attestation accepts only the YOLO permission mode for a YOLO launch", () => {
  const root = attestationFixture();
  const controlPolicy = startupControlPolicies.yolo;
  issueRuntimeSessionLease({ root, pid: process.pid });
  const issued = issueStartupAttestation({ root, controlPolicy });
  bindStartupSessionWriter(root, process.pid, process.pid, {
    controlPolicy,
    expectedAttestation: issued.attestation,
    nonce: issued.nonce,
  });
  const verified = verifyStartupAttestation({
    root,
    hookInput: sessionStartHookInput(root, { permission_mode: "bypassPermissions" }),
    nonce: issued.nonce,
    controlPolicy,
  });
  assert.equal(verified.permissionMode, "bypassPermissions");
  assert.equal(verified.model, "gpt-6-astra");
  assert.equal(releaseCurrentRuntimeSession(root), true);
});

test("picker attestation binds one authenticated session and rejects later identity changes", () => {
  const root = attestationFixture();
  const controlPolicy = startupControlPolicies.default;
  issueRuntimeSessionLease({ root, pid: process.pid });
  const issued = issueStartupAttestation({ root, controlPolicy });
  bindStartupSessionWriter(root, process.pid, process.pid, { controlPolicy, nonce: issued.nonce });
  const selectedId = "01a01234-5678-7abc-8def-0123456789ab";
  verifyStartupAttestation({
    root,
    controlPolicy,
    nonce: issued.nonce,
    hookInput: sessionStartHookInput(root, { session_id: selectedId, source: "resume" }),
  });
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        controlPolicy,
        nonce: issued.nonce,
        hookInput: sessionStartHookInput(root, {
          session_id: "01b01234-5678-7abc-8def-0123456789ab",
          source: "resume",
        }),
      }),
    /already bound to a different/u,
  );
  assert.equal(inspectRuntimeSessionLease({ root }).lease.codexSessionId, selectedId);
  assert.equal(releaseCurrentRuntimeSession(root), true);
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
        hookInput: sessionStartHookInput(root, {
          source: "resume",
        }),
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
  issueRuntimeSessionLease({ root, pid: process.pid });
  const issued = issueStartupAttestation({ root, now: () => now, controlPolicy });
  releaseCurrentRuntimeSession(root);
  assert.throws(
    () =>
      verifyStartupAttestation({
        root,
        hookInput: sessionStartHookInput(root),
        nonce: issued.nonce,
        now: () => now + 1,
        controlPolicy,
      }),
    /runtime session lease is missing or inactive/,
  );
});
