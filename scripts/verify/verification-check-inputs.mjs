/** Derives per-check identities from the existing registry, source snapshot and execution contract. */
import process from "node:process";
import { classifyPath } from "./adaptive-state.mjs";
import { entryRouting } from "./verification-admission.mjs";
import { commandCoversTest } from "./verification-admission-commands.mjs";
import { canonicalJson, digest } from "./verification-record-helpers.mjs";

const presentationFlags = new Set(["--test-reporter=dot", "--test-concurrency=1"]);

/** Native isolated test files are independently reusable; unknown flags retain the original unit. */
export function verificationExecutionUnits(command) {
  if (command.workspaceTestCommands) {
    return command.workspaceTestCommands.map((unit) => ({
      ...unit,
      acceptanceKey: command.key,
      key: `workspace-test:${digest(canonicalJson(commandIdentity(unit))).slice(0, 24)}`,
      serialGroup: command.key,
    }));
  }
  const testFiles = command.args.filter((arg) => arg.endsWith(".test.mjs"));
  const splittable =
    command.executable === process.execPath &&
    command.args.includes("--test") &&
    testFiles.length > 0 &&
    !command.artifactOwners?.length &&
    command.args.every(
      (arg) => arg === "--test" || presentationFlags.has(arg) || testFiles.includes(arg),
    );
  if (!splittable) return [{ ...command, acceptanceKey: command.key }];
  return testFiles
    .map((testFile) => ({
      ...command,
      acceptanceKey: command.key,
      serialGroup: command.args.includes("--test-concurrency=1") ? command.key : null,
      args: [...command.args.filter((arg) => !testFiles.includes(arg)), testFile],
      testFile,
    }))
    .map((unit) => ({
      ...unit,
      key: `test:${digest(canonicalJson(commandIdentity(unit))).slice(0, 24)}`,
    }));
}

function commandIdentity(command) {
  return {
    executable: command.executable,
    args: command.testFile
      ? command.args.filter((arg) => !presentationFlags.has(arg))
      : command.args,
    artifactOwners: command.artifactOwners ?? [],
    diagnosticAfterMs: command.diagnosticAfterMs ?? 300000,
    cancellable: command.cancellable === true,
  };
}

/** Uses the same owner routing for selection and invalidation; there is no second dependency map. */
export function verificationCheckFingerprints({
  commands,
  inputs,
  configuration,
  repositoryRoot,
  workspaceManifests,
  productLayout,
}) {
  const available = new Map(configuration.commands.map((command) => [command.key, command]));
  const sharedRisks = new Set(configuration.risks.map((risk) => risk.path));
  const units = [
    ...new Map(
      commands.flatMap(verificationExecutionUnits).map((unit) => [unit.key, unit]),
    ).values(),
  ];
  const filesByKey = new Map(units.map((command) => [command.key, []]));
  for (const file of inputs.sourceFiles) {
    // Each command and its actual routed inputs below bind its part of the registry. Adding an
    // unrelated entry changes the complete plan, not every existing command's input identity.
    const categories = classifyPath(file.path, { productLayout });
    const route = entryRouting({
      entry: { path: file.path, categories },
      available,
      repositoryRoot,
      verifyOnlyRootManifest: false,
      workspaceManifests,
    });
    const global =
      categories.includes("dependency/package manager files") ||
      categories.includes("unknown or incomplete change scope") ||
      (!route.ownerKeys.length && !categories.includes("active documentation")) ||
      sharedRisks.has(file.path);
    for (const command of units) {
      const expensive =
        Boolean(command.testFile) ||
        Boolean(command.workspaceDirectories) ||
        command.key.startsWith("workspace:") ||
        command.args.includes("--test") ||
        ["broad", "workspace-build", "workspace-test", "delivery"].includes(
          available.get(command.acceptanceKey)?.phase ?? command.phase,
        );
      const relevant =
        global ||
        (command.workspaceDirectories
          ? command.workspaceDirectories.some((directory) =>
              route.workspaceDirectories?.includes(directory),
            )
          : route.readOnlyCommands.some((owner) =>
              command.testFile
                ? commandCoversTest(owner, command.testFile)
                : owner.key === command.acceptanceKey,
            ) || route.ownerKeys.includes(command.acceptanceKey)) ||
        command.args.includes(file.path);
      if (!expensive || (file.path !== ".codex/verification.json" && relevant))
        filesByKey
          .get(command.key)
          .push([file.path, expensive ? file.semanticFingerprint : file.fingerprint]);
    }
  }
  const result = new Map();
  for (const command of units) {
    const fingerprint = digest(
      canonicalJson({
        command: commandIdentity(command),
        files: filesByKey.get(command.key),
        runtime: inputs.runtimeDigest,
        delivery: [
          inputs.deliveryEnvironment,
          inputs.artifactDigest,
          inputs.artifactManifest,
          inputs.configurationDigest,
          inputs.deliveryPlanDigest,
          inputs.sourceCommit,
        ],
      }),
    );
    if (result.has(command.key) && result.get(command.key) !== fingerprint)
      throw new Error(`Conflicting execution conditions for ${command.key}.`);
    result.set(command.key, fingerprint);
  }
  return result;
}

/** Filters already successful units without weakening the complete plan's acceptance keys. */
export function pendingVerificationPlan(plan, fingerprints, checks) {
  const successful = new Map(checks.map((check) => [check.key, check.fingerprint]));
  const seen = new Set();
  const select = (commands) =>
    commands.flatMap(verificationExecutionUnits).filter((command) => {
      const covered = successful.get(command.key) === fingerprints.get(command.key);
      if (covered || seen.has(command.key)) return false;
      seen.add(command.key);
      return true;
    });
  return {
    ...plan,
    readOnlyCommands: select(plan.readOnlyCommands),
    workspaceCommands: select(plan.workspaceCommands),
  };
}

export function successfulVerificationCommands(commands, fingerprints, checks) {
  const successful = new Map(checks.map((check) => [check.key, check.fingerprint]));
  return commands
    .filter((command) =>
      verificationExecutionUnits(command).every(
        (unit) => successful.get(unit.key) === fingerprints.get(unit.key),
      ),
    )
    .map((command) => command.key);
}
