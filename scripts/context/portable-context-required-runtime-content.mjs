/** Owns portable runtime required-content entries for the repository-local semantic context boundary. */
export function portableRuntimeRequiredContent() {
  return [
    [
      "scripts/contracts/product-configuration.mjs",
      [
        "productConfigurationPath",
        "initialProductConfiguration",
        "configuredProductFacingValues",
        "secret boundary",
      ],
    ],
    [
      "scripts/contracts/delivery-configuration.mjs",
      ["deliveryConfigurationPath", "declaredTargets", "detectedTargets", "defaultTarget"],
    ],
    [
      "scripts/contracts/tenancy-configuration.mjs",
      [
        "tenancyConfigurationPath",
        "initialTenancyConfiguration",
        "tenantContext",
        "crossTenantOperations",
      ],
    ],
    [
      "scripts/contracts/localization-configuration.mjs",
      [
        "localizationConfigurationPath",
        "initialLocalizationConfiguration",
        "codeLanguage",
        "supportedLocales",
      ],
    ],
    [
      "scripts/contracts/mise-toolchain-configuration.mjs",
      ["validateMinimalMiseTools", "exact semantic version pin", "node", "pnpm"],
    ],
    [
      "scripts/filesystem/owned-path-safety.mjs",
      ["openOwnedDirectoryBinding", "validateRemovalTree", "atomicReplaceOwnedFile"],
    ],
    [
      "scripts/filesystem/owned-file-operations.mjs",
      ["ensureOwnedDirectoryChain", "atomicWriteOwnedFile", "removeOwnedArtifact"],
    ],
    [
      "scripts/context/project-work-state.mjs",
      ["parseProjectWorkState", "readProjectWorkContext", "codexrig-work-state"],
    ],
    [
      "scripts/context/critical-budget-handover.mjs",
      [
        "createCriticalBudgetHandover",
        "discoverRecentCriticalBudgetHandover",
        "Critical Budget Drain",
        "findSecretMatches",
        "Stop now",
      ],
    ],
    [
      "scripts/contracts/framework-contract.mjs",
      [
        "supportedContractSchema = 2",
        "pendingReconciliation",
        "validateInstallationReceipt",
        "supportedReceiptSchema = 2",
      ],
    ],
    [
      "scripts/framework/framework-upgrade-bootstrap.mjs",
      [
        "readFrameworkUpgradeTargetState",
        "schema-one",
        "Legacy framework upgrade policy projection",
        "validatePolicyProjection",
      ],
    ],
    [
      "scripts/framework/framework-installation-receipt.mjs",
      ["writeInstallationReceipt", "buildInstallationReceipt", "atomicWriteOwnedFile"],
    ],
    [
      "scripts/framework/framework-upgrade-package.mjs",
      ["packageUpdatePlan", "frameworkUpgradeValuesEqual", "packageManager"],
    ],
    [
      "scripts/deps/dependency-plan.mjs",
      [
        "dependencyTransactionSchemaVersion",
        "validateDependencyPlan",
        "assertDependencyPlanRederivable",
      ],
    ],
    [
      "scripts/framework/framework-upgrade.mjs",
      [
        "buildFrameworkUpgradePlan",
        "applyFrameworkUpgrade",
        "policyProjectionChanges",
        "adoptedPaths",
        "pendingReconciliation",
        "readFrameworkUpgradeTargetState",
        "--target <child-root>",
        "--ack-reconciliation",
      ],
    ],
    [
      "scripts/verify/verification-admission-commands.mjs",
      ["focusedTestCommand", "isForbiddenFocusedOwner", "dedupeCommands"],
    ],
    [
      "scripts/verify/verification-admission-decision.mjs",
      ["decideVerificationAdmission", "omitAlreadyCoveredPaths", "uncoveredFullRelevantPaths"],
    ],
    [
      "scripts/verify/verification-admission-registry.mjs",
      ["ownedCategoryConsumers", "exactConsumerRegistry", "runtime-session-state.mjs"],
    ],
    [
      "scripts/framework/framework-upgrade-journal.mjs",
      ["restoreFrameworkUpgradeJournal", "unrelated change", "allowedSha256"],
    ],
    [
      "scripts/framework/policy-projection.mjs",
      ["generatedPolicyProjectionLines", "requiredPolicyIds", "policyProjectionChanges"],
    ],
    [
      "scripts/docs/delivery-manifest.mjs",
      ["deliveryReconciliationPlan", "codexrig:delivery-inventory:start", "ambiguousHints"],
    ],
    [
      "scripts/docs/project-manifest-contract.mjs",
      [
        "Active Module Inventory",
        "Future Modules",
        "moduleDependencyFindings",
        "active module dependency cycle",
        "Runtime and technology",
        "Tenant isolation",
      ],
    ],
    [
      "scripts/goals/repository-housekeeping.mjs",
      [
        "--apply",
        "--online",
        "applyHousekeepingWrites",
        "no deployment",
        "tenant-isolation.mjs",
        "stack-standards.mjs",
        "path-hygiene.mjs",
        "patterns.mjs",
        "localization.mjs",
      ],
    ],
    [
      "scripts/goals/repository-housekeeping-transaction.mjs",
      ["applyHousekeepingWrites", "recoverInterruptedHousekeepingWrites", "journalSchemaVersion"],
    ],
    [
      "scripts/goals/repository-housekeeping-files.mjs",
      [
        "openOwnedDirectoryBinding",
        "publishHousekeepingJournalLink",
        "replaceHousekeepingRegularFile",
      ],
    ],
    [
      "scripts/repository/delivery-environment-discovery.mjs",
      ["discoverDeliveryEnvironmentEvidence", "ambiguousHints", "detectedTargets"],
    ],
    [
      "scripts/verify/delivery-environments.mjs",
      ["deliveryEnvironmentFindings", "manifest projection"],
    ],
    [
      "scripts/verify/identity-access.mjs",
      ["identityAccessProjectFindings", "provider-adapter directory", "authorization/policy"],
    ],
    [
      "scripts/verify/tenant-isolation.mjs",
      ["tenantIsolationProjectFindings", "trusted context", "deny-by-default", "tenant scope"],
    ],
    [
      "scripts/verify/localization.mjs",
      [
        "localizationProjectFindings",
        "English source-language contract",
        "before product implementation",
      ],
    ],
    [
      "scripts/verify/path-hygiene.mjs",
      [
        "surfaceIsolationFindings",
        "platform dependency",
        "surface must not import the separately owned",
      ],
    ],
    [
      "scripts/verify/responsive.mjs",
      ["device-width", "overflow-x", "100vh", "hasAdaptiveLayoutEvidence"],
    ],
    [
      "scripts/verify/patterns.mjs",
      ["fileHeaderFindings", "declarationDocumentationFindings", "purpose/owner header"],
    ],
    [
      "scripts/verify/white-label.mjs",
      ["whiteLabelProjectFindings", "product-facing surface", "framework-owned boundary"],
    ],
    [
      "scripts/verify/docs.mjs",
      ["duplicate heading anchor", "broken heading reference", "pendingReconciliation"],
    ],
    [
      "scripts/verify/adaptive-options.mjs",
      ["--target-environment", "--artifact-manifest", "Default: dev"],
    ],
    [
      "scripts/verify/verification-evidence-record.mjs",
      [
        "deliveryEnvironment",
        "artifactDigest",
        "configurationDigest",
        "deliveryPlanDigest",
        "schemaVersion: 3",
      ],
    ],
    [
      "scripts/verify/delivery-artifact.mjs",
      ["sourceCommit", "configurationFiles", "verify:${targetEnvironment}"],
    ],
    [
      "scripts/setup/validate-codex-config.mjs",
      ["smol-toml", "interrupt_message", "workspace-write", "network_access"],
    ],
    [
      "scripts/repository/source-inventory.mjs",
      ["pre-descent.exclude", "--exclude-per-directory=.gitignore"],
    ],
    [
      "scripts/repository/runtime-session-lease.mjs",
      [
        "runtimeSessionLeasePath",
        "acquireRuntimeLifecycleLock",
        "registerRuntimeLifecycleDescendant",
        "assertRuntimeLifecycleQuiescent",
      ],
    ],
    [
      "scripts/repository/runtime-session-state.mjs",
      [
        "inspectRuntimeSessionLease",
        "issueRuntimeSessionLeaseState",
        "releaseRuntimeSessionLeaseState",
      ],
    ],
    [
      "scripts/repository/runtime-lifecycle-mutex.mjs",
      ["withRuntimeLifecycleUpdateMutex", "runtime lifecycle update mutex"],
    ],
    [
      "scripts/repository/runtime-lifecycle-process.mjs",
      ["spawnRuntimeLifecycleCommand", "spawnRuntimeLifecycleCommandSync", "process group"],
    ],
    [
      "scripts/repository/runtime-lifecycle-schema.mjs",
      ["runtimeLifecycleOperationPattern", "runtimeLifecycleStatus", "lifecycleGuardIdentity"],
    ],
    [
      "scripts/repository/runtime-owned-state.mjs",
      ["repositoryRuntimeRootIdentity", "ensureRuntimeDirectory", "runtimeFile"],
    ],
    [
      "scripts/repository/runtime-process-identity.mjs",
      ["captureProcessIdentity", "inspectProcessIdentity", "inspectGuardHolders"],
    ],
    [
      "scripts/repository/git-runtime-isolation.mjs",
      ["resolveOwnedGitMetadata", "core.fsmonitor=false", "bound Git directory and worktree"],
    ],
    [
      "scripts/setup/start-codex.sh",
      [
        "codex update",
        "mise install --locked",
        "scripts/deps/install-compatible.mjs",
        'CODEX_HOME="$runtime_directory"',
        '--session-pid "$$"',
      ],
    ],
    [
      "scripts/setup/startup-attestation.mjs",
      [
        "CODEXRIG_STARTUP_NONCE",
        "attestationMaxAgeSeconds",
        "runtimeSessionLeasePath",
        "discoverRecentCriticalBudgetHandover",
        "ask the developer whether to resume",
      ],
    ],
    [
      "scripts/context/refresh-context-index-on-stop.mjs",
      [
        "runAsSanitizedContextWorker",
        "stop_hook_active",
        "hasDurableTranscript",
        "transcript_path",
        "sealedHandoverStop",
        "Do not even refresh the semantic index afterward",
      ],
    ],
    [
      "scripts/context/context-worker-output.mjs",
      ["sanitizeMultilineForTerminal", "repositoryRoot"],
    ],
    [
      "scripts/terminal/terminal-output.mjs",
      ["redactLocalPaths", "<local-path>", "redactSecretMatches"],
    ],
    [
      "scripts/security/secret-patterns.mjs",
      [
        "secretPatterns",
        "findSecretMatches",
        "GitLab token",
        "literal named credential",
        "HTTP authorization credential",
        "credential-bearing connection URI",
      ],
    ],
    [
      "scripts/goals/goal-publication-precondition.mjs",
      ["resolveOwnedGitMetadata", "HEAD...@{upstream}", 'integrationBranch = "main"'],
    ],
    [
      ".agents/skills/create-project-from-framework/scripts/generated-framework-policy.mjs",
      [
        "## Subagent Orchestration And Integration Authority",
        "never assume a daily, weekly",
        "remaining token or credit amount directly",
        "no more than ten minutes",
        "hard Orchestration Housekeeping gate",
        "docs/project-context.md",
        "Housekeeping has two explicit layers",
        "Mirror every direct peer message and response to the",
        "primary immediately",
        "## Delivery Environments",
        "### Product Surface Selection",
        "### Requirement-Driven Technology Selection",
        "### Physical Surface Boundaries",
        "### Source And Declaration Headers",
        "### Multi-Device Experience",
        "### Localization And Language Strategy",
        "### Tenant Isolation Boundary",
        "path-hygiene.mjs",
        "Identity and Access is not UI state",
        "$security-review",
        "YOLO/fully autonomous dev session",
        "--target <child-root>",
      ],
    ],
  ];
}
