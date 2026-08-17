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
  refreshExactAttestationAfterPreflight,
  validateExactCurrentEvidence,
} from "./verification-evidence.mjs";
import {
  captureVerificationGitBasis,
  changedPathsSinceVerificationBasis,
  rootManifestChangeIsVerifyOnly,
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
    .map(({ args, artifactOwners = [], executable, key, phase }) => ({
      args,
      artifactOwners,
      executable,
      key,
      phase,
    }));
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
    };
    const plan = buildRiskBoundPlan(options, planDependencies, expectedInputs);
    if (options.printPlan) {
      await runPlan(plan);
      return;
    }
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
    const execution = options.basisOnly
      ? Object.freeze({ successfulCommandKeys: Object.freeze([]) })
      : await runPlan(plan);
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
    if (!plan.admission.canAdvanceSuccessfulBasis) {
      console.log("Successful verification basis already covers the current source and Git state.");
      return;
    }
    const refresh = refreshExactAttestationAfterPreflight({
      broadPlan: evidencePlan,
      coverage: {
        basisChanged: plan.changed.basisChanged === true,
        broadRisks: plan.admission.coveredBroadRisks,
        complete: true,
        focusedCommandOwners: plan.admission.focusedCommandOwners,
        paths: plan.changed.paths,
      },
      expectedBasisToken: basis.token,
      expectedGitBasis,
      expectedInputs,
      deliveryEnvironment: options.targetEnvironment,
      artifactManifest: options.artifactManifest,
      successfulCommandKeys: execution.successfulCommandKeys,
    });
    console.log(
      refresh.refreshed
        ? "Successful verification basis advanced through complete focused delta coverage."
        : `Successful verification basis was not advanced: ${sanitizeMultilineForTerminal(sanitizeForTerminal(refresh.reason), process.cwd())}.`,
    );
    if (!refresh.refreshed) process.exitCode = 1;
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
