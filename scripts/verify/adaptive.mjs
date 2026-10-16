/** Owns adaptive behavior for the repository verification boundary. */
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  formatContextError,
  sanitizeForTerminal,
  sanitizeMultilineForTerminal,
} from "../terminal/terminal-output.mjs";
import {
  buildPlan,
  completeVerificationCommands,
  discoverWorkspaceManifests,
  runPlan,
  workspaceLifecycleCommands,
} from "./adaptive-runner.mjs";
import { changedPathsFromGit, validateCurrentCheckoutForPush } from "./adaptive-state.mjs";
import { parseArgs } from "./adaptive-options.mjs";
import {
  currentVerificationEvidenceInputs,
  readSuccessfulVerificationBasis,
  recordSuccessfulFullEvidence,
  refreshCommittedVerificationEvidence,
  validateExactCurrentEvidence,
  readVerificationCheckpoint,
  recordVerificationCheckpoint,
} from "./verification-evidence.mjs";
import { readVerificationConfiguration } from "./verification-configuration.mjs";
import { discoverProductLayout } from "../repository/product-roots.mjs";
import {
  verificationCheckFingerprints,
  pendingVerificationPlan,
  successfulVerificationCommands,
} from "./verification-check-inputs.mjs";
import {
  captureVerificationGitBasis,
  changedPathsSinceVerificationBasis,
  rootManifestChangeIsVerifyOnly,
  initialVerificationSourceFiles,
} from "./verification-git-basis.mjs";
import { omitAlreadyCoveredPaths } from "./verification-admission.mjs";
import { resolveDeliveryArtifactBinding } from "./delivery-artifact.mjs";
import { verificationBasisProfileRisks } from "./verification-risk-profile.mjs";
import { withVerificationSessionLock } from "./verification-session-lock.mjs";

export { parseArgs };

export function broadEvidencePlan(plan) {
  return [...plan.readOnlyCommands, ...plan.workspaceCommands]
    .filter((command) =>
      ["preflight", "broad", "workspace-build", "workspace-test", "delivery"].includes(
        command.phase,
      ),
    )
    .map(
      ({
        args,
        artifactOwners = [],
        executable,
        key,
        phase,
        diagnosticAfterMs,
        cancellable,
        coveredTestPaths,
      }) => ({
        args,
        artifactOwners,
        executable,
        key,
        phase,
        diagnosticAfterMs,
        cancellable,
        coveredTestPaths,
      }),
    );
}

export function buildRiskBoundPlan(options, planDependencies, expectedInputs, riskResolver) {
  const preliminaryOptions = { ...options, forceFull: false, forceReason: "" };
  const preliminary = buildPlan(preliminaryOptions, planDependencies);
  const resolveRisks = riskResolver ?? verificationBasisProfileRisks;
  const riskProfile = resolveRisks(planDependencies.basis, expectedInputs, {
    focusedCommandOwners: preliminary.admission.focusedCommandOwners,
  });
  return buildPlan(options, {
    ...planDependencies,
    broadOnlyRisks: riskProfile.uncovered,
    coveredBroadRisks: riskProfile.covered,
  });
}

function validatePrePushRefs() {
  const input = process.stdin.isTTY ? "" : readFileSync(0, "utf8");
  const result = validateCurrentCheckoutForPush(input);
  const scope = result.directInvocation
    ? "direct clean HEAD invocation"
    : `${result.pushedCommits.length} pushed commit object(s)`;
  console.log(`Pre-push commit scope validated: ${scope}.`);
}

function completeEvidenceCommandPlan(workspaceManifests, deliveryBinding) {
  return broadEvidencePlan({
    readOnlyCommands: [
      ...completeVerificationCommands(),
      ...(deliveryBinding.verificationCommand ? [deliveryBinding.verificationCommand] : []),
    ],
    workspaceCommands: workspaceLifecycleCommands(workspaceManifests),
  });
}

function changedScopeForOptions(options, basis) {
  if (options.simulatedPaths.length > 0) {
    return {
      basisChanged: false,
      incomplete: false,
      paths: options.simulatedPaths,
      reason: "simulated --path input",
    };
  }
  if (basis.trusted) {
    return changedPathsSinceVerificationBasis(basis.current.gitBasis);
  }
  return { ...changedPathsFromGit(), basisChanged: false };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--validate-pre-push-refs")) {
    if (argv.some((arg) => arg !== "--validate-pre-push-refs" && arg !== "--")) {
      throw new Error(
        "--validate-pre-push-refs cannot be combined with verification plan options.",
      );
    }
    validatePrePushRefs();
    return;
  }
  const options = parseArgs(argv);
  const execute = async () => {
    if (options.check) {
      await runPlan(buildPlan(options));
      console.log("Reproduction completed; successful acceptance evidence was not changed.");
      return;
    }
    const deliveryBinding = resolveDeliveryArtifactBinding({
      root: process.cwd(),
      artifactManifest: options.artifactManifest,
      targetEnvironment: options.targetEnvironment,
    });
    const workspaceManifests = discoverWorkspaceManifests();
    const evidencePlan = completeEvidenceCommandPlan(workspaceManifests, deliveryBinding);
    if (options.mode === "pre-push") {
      if (options.printPlan) {
        await runPlan(
          buildPlan(options, {
            basis: { reason: "", trusted: true },
            workspaceManifests,
          }),
        );
        return;
      }
      validateExactCurrentEvidence({
        broadPlan: evidencePlan,
        deliveryEnvironment: options.targetEnvironment,
        artifactManifest: options.artifactManifest,
      });
      console.log("Exact-current successful verification evidence passed.");
      return;
    }

    const basis = readSuccessfulVerificationBasis({
      broadPlan: evidencePlan,
      deliveryEnvironment: options.targetEnvironment,
      artifactManifest: options.artifactManifest,
    });
    const discoveredScope = changedScopeForOptions(options, basis);
    const expectedInputs = currentVerificationEvidenceInputs({
      broadPlan: evidencePlan,
      deliveryEnvironment: options.targetEnvironment,
      artifactManifest: options.artifactManifest,
    });
    const checkpoint = readVerificationCheckpoint();
    const previousFiles = new Map(checkpoint.sourceFiles.map((file) => [file.path, file]));
    for (const file of initialVerificationSourceFiles(
      discoveredScope.paths.filter((file) => !previousFiles.has(file)),
    ))
      previousFiles.set(file.path, file);
    const editorialPaths = new Set(
      expectedInputs.sourceFiles
        .filter(
          (file) =>
            previousFiles.get(file.path)?.semanticFingerprint === file.semanticFingerprint &&
            previousFiles.get(file.path)?.fingerprint !== file.fingerprint,
        )
        .map((file) => file.path),
    );
    const changedScope = omitAlreadyCoveredPaths({
      basis,
      changedScope: discoveredScope,
      expectedInputs,
      simulated: options.simulatedPaths.length > 0,
    });
    const planDependencies = {
      basis,
      changedScope,
      verifyOnlyRootManifest:
        basis.trusted &&
        changedScope.paths.includes("package.json") &&
        rootManifestChangeIsVerifyOnly(basis.current.gitBasis, {
          currentContent: expectedInputs.rootManifestContent,
        }),
      workspaceManifests,
      deliveryBinding,
      editorialPaths,
    };
    const plan = buildRiskBoundPlan(options, planDependencies, expectedInputs);
    if (
      options.basisOnly &&
      (plan.admission.mode !== "targeted" ||
        plan.changed.incomplete ||
        plan.changed.paths.length > 0 ||
        plan.readOnlyCommands.length > 0 ||
        plan.workspaceCommands.length > 0)
    ) {
      throw new Error(
        "Basis-only refresh requires unchanged successful source, plan, runtime, and risk evidence; " +
          `current admission is ${plan.admission.mode}, Git scope incomplete is ${String(plan.changed.incomplete)}, ` +
          `and the plan contains ${plan.changed.paths.length} changed path(s), ${plan.readOnlyCommands.length} read-only command(s), ` +
          `${plan.workspaceCommands.length} workspace command(s). Admission reason: ${plan.admission.reason}. ` +
          "Run normal verification before push.",
      );
    }
    const expectedGitBasis = changedScope.basis ?? captureVerificationGitBasis();
    if (options.basisOnly) {
      const refresh = refreshCommittedVerificationEvidence({
        broadPlan: evidencePlan,
        expectedBasisToken: basis.token,
        expectedGitBasis,
        expectedInputs,
        deliveryEnvironment: options.targetEnvironment,
        artifactManifest: options.artifactManifest,
      });
      if (!refresh.refreshed) throw new Error(refresh.reason);
      console.log("Complete verification evidence bound to the current committed Git state.");
      return;
    }
    const selectedCommands = [...plan.readOnlyCommands, ...plan.workspaceCommands];
    const completeCommands = [
      ...completeVerificationCommands(),
      ...workspaceLifecycleCommands(workspaceManifests),
      ...(deliveryBinding.verificationCommand ? [deliveryBinding.verificationCommand] : []),
    ];
    // Keep complete workspace units as well as the selected subset, so development cannot discard
    // an unaffected package's still-valid receipt from the shared evidence record.
    const commands = [...completeCommands, ...selectedCommands];
    const fingerprints = verificationCheckFingerprints({
      commands,
      inputs: expectedInputs,
      configuration: readVerificationConfiguration(),
      repositoryRoot: process.cwd(),
      workspaceManifests,
      productLayout: discoverProductLayout({
        repositoryRoot: process.cwd(),
        relativePaths: expectedInputs.sourceFiles.map((file) => file.path),
      }),
    });
    const checks = new Map(
      checkpoint.checks
        .filter((check) => fingerprints.get(check.key) === check.fingerprint)
        .map((check) => [check.key, check]),
    );
    const pending = pendingVerificationPlan(
      plan,
      fingerprints,
      options.forceFull ? [] : [...checks.values()],
    );
    if (options.printPlan) {
      await runPlan(options.simulatedPaths.length ? plan : pending);
      return;
    }
    let failure;
    try {
      await runPlan(pending, {
        onResult(result) {
          const key = result.command.key;
          if (result.status === 0 && !result.error && !result.diagnosticRequired)
            checks.set(key, { key, fingerprint: fingerprints.get(key) });
          else checks.delete(key);
        },
      });
    } catch (error) {
      failure = error;
    }
    recordVerificationCheckpoint({
      checks: [...checks.values()].sort((a, b) => a.key.localeCompare(b.key)),
      expectedInputs,
      expectedGitBasis,
      broadPlan: evidencePlan,
      deliveryEnvironment: options.targetEnvironment,
      artifactManifest: options.artifactManifest,
      failed: Boolean(failure),
    });
    if (failure) throw failure;
    const execution = {
      successfulCommandKeys: successfulVerificationCommands(selectedCommands, fingerprints, [
        ...checks.values(),
      ]),
    };
    if (plan.admission.mode === "full") {
      recordSuccessfulFullEvidence({
        broadPlan: evidencePlan,
        expectedGitBasis,
        expectedInputs,
        deliveryEnvironment: options.targetEnvironment,
        artifactManifest: options.artifactManifest,
        successfulCommandKeys: execution.successfulCommandKeys,
      });
      console.log("Successful full verification basis recorded.");
      return;
    }
    console.log(
      "Development results retained; complete acceptance belongs to publication verification.",
    );
  };
  if (options.mode === "pre-push" || options.printPlan) {
    await execute();
    return;
  }
  await withVerificationSessionLock(execute);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`Adaptive verification failed: ${formatContextError(error, process.cwd())}`);
    if (Array.isArray(error?.findings)) {
      for (const finding of error.findings) {
        console.error(
          `- ${sanitizeMultilineForTerminal(sanitizeForTerminal(finding), process.cwd())}`,
        );
      }
    }
    process.exitCode = 1;
  }
}
