/** Owns project-selected verification commands and their explicit consumer bindings. */
import process from "node:process";
import { parseJsonFile, toolingRoot } from "../filesystem/repository-files.mjs";

export const verificationConfigurationPath = ".codex/verification.json";

/** This is executable project policy; native permissions still govern each selected command. */
export function readVerificationConfiguration(root = toolingRoot) {
  const value = parseJsonFile(root, verificationConfigurationPath, "Verification configuration");
  if (
    !value ||
    value.schemaVersion !== 1 ||
    Object.keys(value).sort().join(",") !==
      "commands,exactConsumers,ownedCategories,prePushChecks,risks,schemaVersion,testConsumers"
  )
    throw new Error("Unsupported verification configuration.");
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
