/** Derives per-check identities from the existing registry, source snapshot and execution contract. */
import process from "node:process";
import path from "node:path";
import { lstatSync } from "node:fs";
import { classifyPath, root } from "./adaptive-state.mjs";
import {
  captureStableRepositoryFileIdentity,
  readStableRepositoryFile,
} from "../repository/stable-file-snapshot.mjs";
import { entryRouting } from "./verification-admission.mjs";
import { commandCoversTest } from "./verification-admission-commands.mjs";
import { canonicalJson, digest, validDigest } from "./verification-record-helpers.mjs";
import { importSpecifiersForFile } from "../repository/source-import-specifiers.mjs";
import { discoverProductLayout } from "../repository/product-roots.mjs";

const presentationFlags = new Set(["--test-reporter=dot", "--test-concurrency=1"]);

/** Native isolated test files are independently reusable; unknown flags retain the original unit. */
export function verificationExecutionUnits(command) {
  if (command.workspaceUnits) {
    return command.workspaceUnits.map((unit) => ({
      ...unit,
      acceptanceKey: command.key,
      key: `workspace:${digest(canonicalJson(commandIdentity(unit))).slice(0, 24)}`,
      serialGroup: command.key,
    }));
  }
  const testFiles = command.args.filter((arg) => arg.endsWith(".test.mjs"));
  const splittable =
    command.executable === process.execPath &&
    command.args.includes("--test") &&
    testFiles.length > 0 &&
    !command.artifactOwners?.length &&
    !command.outputs?.length &&
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
    reuseMaxAgeMs: command.reuseMaxAgeMs ?? null,
    outputs: command.outputs ?? [],
    ...(command.inputScope ? { inputScope: command.inputScope } : {}),
  };
}

/** Scoped scanners bind their actual executable imports as well as registry-owned data inputs. */
function executableInputs(command, { sourceFiles, repositoryRoot, imports }) {
  const pending = command.args.filter((arg) => arg.endsWith(".mjs"));
  const closure = new Set();
  while (pending.length) {
    const relativePath = pending.pop();
    if (closure.has(relativePath)) continue;
    const expected = sourceFiles.get(relativePath);
    if (!expected)
      throw new Error(
        `Scoped verifier ${command.key} has an unbound executable input: ${relativePath}.`,
      );
    closure.add(relativePath);
    if (!imports.has(relativePath)) {
      const captured = captureStableRepositoryFileIdentity({ repositoryRoot, relativePath });
      const read = readStableRepositoryFile({
        repositoryRoot,
        relativePath,
        expectedIdentity: captured.identity,
      });
      const mode = lstatSync(path.join(repositoryRoot, relativePath)).mode & 0o7777;
      if (digest(`${mode}\0${digest(read.buffer)}`) !== expected.fingerprint)
        throw new Error(`Scoped verifier input changed during planning: ${relativePath}.`);
      imports.set(
        relativePath,
        importSpecifiersForFile({ relativePath, content: read.buffer.toString("utf8") })
          .filter((specifier) => specifier.startsWith("."))
          .map((specifier) =>
            path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), specifier)),
          ),
      );
    }
    pending.push(...imports.get(relativePath));
  }
  return closure;
}

/** Output evidence is separate from immutable inputs and reads only explicitly declared files. */
export function verificationOutputFingerprint(command, { repositoryRoot = root } = {}) {
  if (!command.outputs?.length) return undefined;
  if (command.outputs.length > 10_000)
    throw new Error("Too many declared verification output files.");
  let total = 0;
  try {
    const entries = command.outputs.map((file) => {
      const declared = lstatSync(path.join(repositoryRoot, file));
      if (declared.isSymbolicLink() || !declared.isFile() || declared.nlink !== 1)
        throw new Error("Verification outputs require single-link, non-symlink regular files.");
      const captured = captureStableRepositoryFileIdentity({ repositoryRoot, relativePath: file });
      total += Number(captured.bytes);
      if (captured.bytes > 64 * 1024 * 1024 || total > 512 * 1024 * 1024)
        throw new Error("Declared verification outputs exceed their bounded snapshot size.");
      const mode = lstatSync(path.join(repositoryRoot, file)).mode & 0o7777;
      const read = readStableRepositoryFile({
        repositoryRoot,
        relativePath: file,
        expectedIdentity: captured.identity,
      });
      return [file, mode, digest(read.buffer)];
    });
    return digest(canonicalJson(entries));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
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
  const units = [
    ...new Map(
      commands.flatMap(verificationExecutionUnits).map((unit) => [unit.key, unit]),
    ).values(),
  ];
  const sourceFiles = new Map(inputs.sourceFiles.map((file) => [file.path, file]));
  // Reuse the captured inventory once; per-file classification must not rediscover the repository.
  const layout =
    productLayout ??
    discoverProductLayout({
      repositoryRoot: repositoryRoot ?? root,
      relativePaths: [...sourceFiles.keys()],
    });
  const imports = new Map();
  const executableByKey = new Map(
    units
      .filter((command) => command.inputScope === "owners")
      .map((command) => [
        command.key,
        executableInputs(command, { sourceFiles, repositoryRoot, imports }),
      ]),
  );
  const filesByKey = new Map(units.map((command) => [command.key, []]));
  for (const file of inputs.sourceFiles) {
    // Each command and its actual routed inputs below bind its part of the registry. Adding an
    // unrelated entry changes the complete plan, not every existing command's input identity.
    const categories = classifyPath(file.path, { productLayout: layout });
    const route = entryRouting({
      entry: { path: file.path, categories },
      available,
      repositoryRoot,
      verifyOnlyRootManifest: false,
      workspaceManifests,
      configuration,
    });
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
        configuration.sharedInputs?.includes(file.path) ||
        executableByKey.get(command.key)?.has(file.path) ||
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
      if (
        (!expensive && command.inputScope !== "owners") ||
        (relevant && (!expensive || file.path !== ".codex/verification.json"))
      )
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
        // Some scoped checks validate path existence. Added/deleted paths remain observable even
        // when unrelated file bytes are not inputs (for example a skill's linked script).
        ...(command.inputScope === "owners" ? { inventory: [...sourceFiles.keys()] } : {}),
        runtime: inputs.runtimeDigest,
        delivery:
          command.phase === "delivery"
            ? [
                inputs.deliveryEnvironment,
                inputs.artifactDigest,
                inputs.artifactManifest,
                inputs.configurationDigest,
                inputs.deliveryPlanDigest,
                inputs.sourceCommit,
              ]
            : null,
      }),
    );
    if (result.has(command.key) && result.get(command.key) !== fingerprint)
      throw new Error(`Conflicting execution conditions for ${command.key}.`);
    result.set(command.key, fingerprint);
  }
  return result;
}

/** Filters already successful units without weakening the complete plan's acceptance keys. */
function reusableCheck(command, fingerprint, check, now) {
  const completed = Date.parse(check?.completedAt);
  return (
    validDigest(fingerprint) &&
    fingerprint === check?.fingerprint &&
    Number.isFinite(completed) &&
    completed <= now &&
    Number.isSafeInteger(check.elapsedMs) &&
    check.elapsedMs >= 0 &&
    (command.reuseMaxAgeMs === undefined || now - completed < command.reuseMaxAgeMs)
  );
}

export function pendingVerificationPlan(
  plan,
  fingerprints,
  checks,
  { completeCommands, now = Date.now(), repositoryRoot = root } = {},
) {
  const successful = new Map(checks.map((check) => [check.key, check]));
  const selected = [...plan.readOnlyCommands, ...plan.workspaceCommands].flatMap(
    verificationExecutionUnits,
  );
  const all = [
    ...new Map(
      [...(completeCommands ?? []).flatMap(verificationExecutionUnits), ...selected].map((unit) => [
        unit.key,
        unit,
      ]),
    ).values(),
  ];
  const dependencies = new Map(
    all.map((unit) => [
      unit.key,
      all.filter(
        (producer) =>
          producer.key !== unit.key &&
          producer.phase === "workspace-build" &&
          producer.workspaceDirectories?.some((directory) =>
            unit.buildPrerequisites?.includes(directory),
          ),
      ),
    ]),
  );
  const states = new Map();
  function covered(unit) {
    if (states.has(unit.key)) return states.get(unit.key);
    states.set(unit.key, false);
    let valid = reusableCheck(unit, fingerprints.get(unit.key), successful.get(unit.key), now);
    if (valid && unit.outputs?.length)
      valid =
        verificationOutputFingerprint(unit, { repositoryRoot }) ===
        successful.get(unit.key).outputFingerprint;
    if (valid) valid = (dependencies.get(unit.key) ?? []).every(covered);
    states.set(unit.key, valid);
    return valid;
  }
  const invalidated = new Set();
  const needed = new Set(selected.filter((unit) => !covered(unit)).map((unit) => unit.key));
  let changed;
  do {
    changed = false;
    for (const unit of all) {
      if (needed.has(unit.key) || invalidated.has(unit.key)) continue;
      if (
        (dependencies.get(unit.key) ?? []).some(
          (producer) => needed.has(producer.key) || invalidated.has(producer.key),
        )
      ) {
        invalidated.add(unit.key);
        states.set(unit.key, false);
        if (selected.some((candidate) => candidate.key === unit.key)) needed.add(unit.key);
        changed = true;
      }
    }
    for (const key of [...needed])
      for (const producer of dependencies.get(key) ?? []) {
        if (!covered(producer) && !needed.has(producer.key)) {
          needed.add(producer.key);
          changed = true;
        }
      }
  } while (changed);
  const reused = [];
  const required = [];
  const prerequisites = [];
  const blockedPrerequisites = [];
  const scheduled = [];
  const seen = new Set();
  function visit(command) {
    if (seen.has(command.key)) return;
    seen.add(command.key);
    const fingerprint = fingerprints.get(command.key);
    if (!validDigest(fingerprint)) throw new Error(`Missing input fingerprint for ${command.key}.`);
    const check = successful.get(command.key);
    const reusable = !needed.has(command.key) && covered(command);
    const observation = {
      key: command.key,
      label:
        command.testFile ??
        (command.workspaceDirectories
          ? `${command.workspaceDirectories.join(", ")} ${command.acceptanceKey ?? command.key}`
          : (command.acceptanceKey ?? command.key)),
      elapsedMs: check?.elapsedMs ?? null,
      reason: reusable
        ? "matching inputs, execution contract and environment"
        : !check
          ? "no successful result"
          : check.fingerprint !== fingerprint
            ? "relevant inputs or execution contract changed"
            : "result expired, incomplete, or required output state changed",
    };
    (reusable ? reused : required).push(observation);
    if (reusable) return;
    const outputPrerequisites = (dependencies.get(command.key) ?? []).map((producer) => {
      if (needed.has(producer.key)) visit(producer);
      else if (!producer.outputs?.length)
        blockedPrerequisites.push(
          `Missing output contract for ${producer.workspaceDirectories?.join(", ") ?? producer.key} required by ${observation.label}; declare workspaceOutputs in .codex/verification.json before reusing this build.`,
        );
      prerequisites.push(
        `${producer.workspaceDirectories?.join(", ") ?? producer.key} outputs -> ${observation.label}`,
      );
      return {
        key: producer.key,
        outputs: producer.outputs,
        outputFingerprint: successful.get(producer.key)?.outputFingerprint,
      };
    });
    scheduled.push({ ...command, outputPrerequisites });
  }
  for (const command of selected) visit(command);
  // Unselected artifact trees are not a development-plan prerequisite. Their validation inputs
  // remain visible here; actual output state is checked when that unit or its consumer is selected.
  const missing = all.filter((unit) =>
    states.has(unit.key)
      ? !states.get(unit.key)
      : !reusableCheck(unit, fingerprints.get(unit.key), successful.get(unit.key), now),
  );
  return {
    ...plan,
    readOnlyCommands: scheduled.filter((unit) => !unit.workspaceDirectories),
    workspaceCommands: scheduled.filter((unit) => unit.workspaceDirectories),
    evidence: {
      reused,
      required,
      prerequisites,
      blockedPrerequisites,
      invalidatedKeys: [...invalidated],
      missingCoverage: [...new Set(missing.map((unit) => unit.testFile ?? unit.key))],
    },
  };
}

export function successfulVerificationCommands(
  commands,
  fingerprints,
  checks,
  { now = Date.now(), repositoryRoot = root } = {},
) {
  const successful = new Map(checks.map((check) => [check.key, check]));
  return commands
    .filter((command) =>
      verificationExecutionUnits(command).every(
        (unit) =>
          reusableCheck(unit, fingerprints.get(unit.key), successful.get(unit.key), now) &&
          (!unit.outputs?.length ||
            verificationOutputFingerprint(unit, { repositoryRoot }) ===
              successful.get(unit.key).outputFingerprint),
      ),
    )
    .map((command) => command.key);
}
