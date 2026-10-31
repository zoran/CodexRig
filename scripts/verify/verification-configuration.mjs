/** Owns project-selected verification commands and their explicit consumer bindings. */
import process from "node:process";
import {
  normalizeRepositoryPath,
  parseJsonFile,
  toolingRoot,
} from "../filesystem/repository-files.mjs";

export const verificationConfigurationPath = ".codex/verification.json";

function validateOutputs(outputs) {
  if (
    !Array.isArray(outputs) ||
    !outputs.length ||
    outputs.length > 128 ||
    new Set(outputs).size !== outputs.length ||
    outputs.some(
      (file) =>
        typeof file !== "string" ||
        file.length > 4096 ||
        /[*?\[\]{}]/u.test(file) ||
        /^[A-Za-z]:/u.test(file) ||
        normalizeRepositoryPath(file) !== file ||
        file.split("/").some((part) => [".", "..", ".git", ".auth"].includes(part)),
    )
  )
    throw new Error(
      "Verification outputs require bounded unique exact file paths within their owner.",
    );
}

function nodeTestRuntime(args) {
  return args.filter(
    (arg) => !arg.endsWith(".test.mjs") && !/^--test-(?:reporter|concurrency)=/u.test(arg),
  );
}

/** This is executable project policy; native permissions still govern each selected command. */
export function readVerificationConfiguration(root = toolingRoot) {
  const value = parseJsonFile(root, verificationConfigurationPath, "Verification configuration");
  if (
    !value ||
    value.schemaVersion !== 1 ||
    Object.keys(value)
      .filter((key) => !["sharedInputs", "workspaceOutputs"].includes(key))
      .sort()
      .join(",") !==
      "commands,exactConsumers,ownedCategories,prePushChecks,risks,schemaVersion,testConsumers"
  )
    throw new Error("Unsupported verification configuration.");
  if (value.workspaceOutputs !== undefined) {
    const outputs = value.workspaceOutputs;
    if (
      !outputs ||
      Array.isArray(outputs) ||
      typeof outputs !== "object" ||
      Object.keys(outputs).length > 128
    )
      throw new Error("Invalid workspace output declarations.");
    for (const [directory, lifecycles] of Object.entries(outputs)) {
      if (directory !== ".") validateOutputs([`${directory}/output`]);
      if (
        (directory !== "." &&
          (normalizeRepositoryPath(directory) !== directory ||
            directory.split("/").includes(".."))) ||
        !lifecycles ||
        typeof lifecycles !== "object" ||
        Array.isArray(lifecycles) ||
        Object.keys(lifecycles).length > 16
      )
        throw new Error("Invalid workspace output owner.");
      for (const [script, files] of Object.entries(lifecycles)) {
        if (!/^[a-z][a-z0-9:-]*$/u.test(script))
          throw new Error("Invalid workspace output lifecycle.");
        validateOutputs(files);
      }
    }
  }
  if (
    value.sharedInputs !== undefined &&
    (!Array.isArray(value.sharedInputs) ||
      value.sharedInputs.length > 64 ||
      new Set(value.sharedInputs).size !== value.sharedInputs.length ||
      value.sharedInputs.some(
        (file) =>
          typeof file !== "string" ||
          !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u.test(file) ||
          file.split("/").some((part) => part === "." || part === ".."),
      ))
  )
    throw new Error("Invalid shared verification execution inputs; use exact repository paths.");
  if (!Array.isArray(value.commands) || !value.commands.length || value.commands.length > 100)
    throw new Error("Verification requires a bounded nonempty command plan.");
  if (
    !Array.isArray(value.prePushChecks) ||
    value.prePushChecks.length > 4 ||
    value.prePushChecks.some(
      (file) =>
        typeof file !== "string" ||
        !/^(?:scripts|\.agents)\/[A-Za-z0-9_/-]+\.mjs$/u.test(file) ||
        file.includes(".."),
    )
  )
    throw new Error("Invalid selected pre-push checks.");
  if (
    !Array.isArray(value.risks) ||
    value.risks.length > 128 ||
    value.risks.some(
      (entry) =>
        !entry ||
        !/^[A-Za-z0-9._/-]+$/u.test(entry.path) ||
        entry.path.includes("..") ||
        !/^[a-z0-9][a-z0-9-]*$/u.test(entry.riskId),
    )
  )
    throw new Error("Invalid verification risk owners.");
  const keys = new Set();
  for (const command of value.commands) {
    if (command?.outputs !== undefined) validateOutputs(command.outputs);
    if (
      command?.inputScope !== undefined &&
      (!["repository", "owners"].includes(command.inputScope) ||
        (command.inputScope === "owners" &&
          (command.executable !== "$node" ||
            !Array.isArray(command.args) ||
            typeof command.args[0] !== "string" ||
            !command.args[0].endsWith(".mjs") ||
            normalizeRepositoryPath(command.args[0]) !== command.args[0])))
    )
      throw new Error("Scoped verifier inputs require a native module command and known scope.");
    if (
      !command ||
      !/^[a-z][a-z0-9-]*$/u.test(command.key) ||
      keys.has(command.key) ||
      !["$node", "bash"].includes(command.executable) ||
      !Array.isArray(command.args) ||
      command.args.some((arg) => typeof arg !== "string" || /[\0\r\n]/u.test(arg)) ||
      !["preflight", "broad"].includes(command.phase)
    )
      throw new Error("Invalid or duplicate verification command.");
    keys.add(command.key);
    if (command.executable === "$node") command.executable = process.execPath;
    if (
      (command.diagnosticAfterMs !== undefined &&
        (!Number.isSafeInteger(command.diagnosticAfterMs) ||
          command.diagnosticAfterMs < 1_000 ||
          command.diagnosticAfterMs > 3_600_000)) ||
      (command.cancellable !== undefined && typeof command.cancellable !== "boolean") ||
      (command.reuseMaxAgeMs !== undefined &&
        (!Number.isSafeInteger(command.reuseMaxAgeMs) ||
          command.reuseMaxAgeMs < 1 ||
          command.reuseMaxAgeMs > 30 * 24 * 60 * 60 * 1000))
    )
      throw new Error(`Invalid verification execution limit: ${command.key}.`);
  }
  for (const command of value.commands) {
    if (command.coveredBy === undefined) continue;
    const parent = value.commands.find((entry) => entry.key === command.coveredBy);
    const tests = command.args.filter((argument) => argument.endsWith(".test.mjs"));
    const parentTests = new Set([...(parent?.args ?? []), ...(parent?.coveredTestPaths ?? [])]);
    if (
      !parent ||
      parent === command ||
      parent.coveredBy !== undefined ||
      JSON.stringify(command.outputs ?? []) !== JSON.stringify(parent.outputs ?? []) ||
      command.executable !== process.execPath ||
      !command.args.includes("--test") ||
      !tests.length ||
      tests.some((file) => !parentTests.has(file)) ||
      (parent.executable === process.execPath &&
        parent.args.includes("--test") &&
        JSON.stringify(nodeTestRuntime(command.args)) !==
          JSON.stringify(nodeTestRuntime(parent.args))) ||
      [command, parent].some((entry) =>
        entry.args.some((arg) =>
          /^--test-(?:name-pattern|skip-pattern|only|shard)(?:=|$)/u.test(arg),
        ),
      )
    )
      throw new Error(`Invalid complete verification owner: ${command.key}.`);
  }
  for (const field of ["testConsumers", "exactConsumers", "ownedCategories"]) {
    if (!value[field] || typeof value[field] !== "object" || Array.isArray(value[field]))
      throw new Error(`Invalid verification ${field}.`);
    for (const [owner, consumers] of Object.entries(value[field])) {
      if (
        !owner ||
        !Array.isArray(consumers) ||
        consumers.some((item) => typeof item !== "string" || !item || /[\0\r\n]/u.test(item))
      )
        throw new Error(`Invalid verification consumer binding: ${owner}.`);
      if (field !== "testConsumers" && consumers.some((key) => !keys.has(key)))
        throw new Error(`Verification ${owner} references an unselected command.`);
    }
  }
  return value;
}
