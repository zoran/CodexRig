/** Owns the explicit source recipe for project tools; newly added source files are excluded by default. */
import path from "node:path";
import {
  normalizeRepositoryPath,
  parseJsonFile,
  readRepositoryFile,
  toolingRoot,
} from "../filesystem/repository-files.mjs";
import { importSpecifiersForFile } from "../repository/source-import-specifiers.mjs";
import { nonPortableTransferPathReason } from "../repository/source-inventory-policy.mjs";

export const projectToolSelectionPath = ".codexrig/project-tools.json";
export function readProjectToolSelection(root = toolingRoot) {
  const selection = parseJsonFile(root, projectToolSelectionPath, "Project tool selection");
  if (
    selection?.schemaVersion !== 1 ||
    Object.keys(selection).sort().join(",") !==
      "capabilities,devDependencies,packageScripts,schemaVersion,scriptOverrides,verificationCommands" ||
    !selection.capabilities ||
    typeof selection.capabilities !== "object" ||
    Array.isArray(selection.capabilities) ||
    !selection.scriptOverrides ||
    typeof selection.scriptOverrides !== "object" ||
    Array.isArray(selection.scriptOverrides) ||
    !Array.isArray(selection.packageScripts) ||
    !Array.isArray(selection.verificationCommands) ||
    !Array.isArray(selection.devDependencies)
  )
    throw new Error("Invalid project tool selection.");
  for (const field of ["packageScripts", "verificationCommands", "devDependencies"]) {
    if (
      selection[field].some((name) => typeof name !== "string" || !name) ||
      new Set(selection[field]).size !== selection[field].length
    )
      throw new Error(`Invalid selected ${field}.`);
  }
  if (
    Object.entries(selection.scriptOverrides).some(
      ([name, command]) =>
        !selection.packageScripts.includes(name) || typeof command !== "string" || !command,
    )
  )
    throw new Error("Invalid project command override.");
  const owners = new Map();
  for (const [owner, files] of Object.entries(selection.capabilities)) {
    if (!owner || !Array.isArray(files) || !files.length)
      throw new Error("A selected capability needs its explicit files.");
    for (const file of files) {
      if (normalizeRepositoryPath(file) !== file)
        throw new Error("Selected project files must use canonical paths.");
      if (owners.has(file) || nonPortableTransferPathReason(file))
        throw new Error(`Unsafe or multiply-owned selected file: ${file}.`);
      owners.set(file, owner);
      readRepositoryFile(root, file);
    }
  }
  // Imports may only refer to already reviewed files. Computing a closure must never silently
  // expand the distribution when source code gains a dependency on a generator or release owner.
  for (const file of owners.keys()) {
    if (!file.endsWith(".mjs")) continue;
    for (const specifier of importSpecifiersForFile({
      relativePath: file,
      content: readRepositoryFile(root, file),
    })) {
      if (!specifier.startsWith(".")) continue;
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      if (!owners.has(dependency))
        throw new Error(
          `${file} imports unselected project dependency ${dependency}; review its owner before distribution.`,
        );
    }
  }
  const assertCommandClosure = (command, owner) => {
    for (const match of String(command).matchAll(
      /(?:^|[\s"']|\$root\/)((?:scripts|\.agents)\/[A-Za-z0-9._/-]+\.(?:mjs|sh))(?=$|[\s"'])/gu,
    )) {
      if (!owners.has(match[1]))
        throw new Error(`${owner} executes unselected project tool ${match[1]}.`);
    }
  };
  for (const file of owners.keys())
    if (file.endsWith(".sh") || file.endsWith(".mjs"))
      assertCommandClosure(readRepositoryFile(root, file), file);
  const sourcePackage = parseJsonFile(root, "package.json", "Source package");
  for (const name of selection.packageScripts)
    assertCommandClosure(selection.scriptOverrides[name] ?? sourcePackage.scripts[name], name);
  return { ...selection, files: [...owners.keys()].sort() };
}

export function selectedProjectPackage(sourcePackage, selection) {
  const scripts = Object.fromEntries(
    selection.packageScripts.map((name) => {
      const command = selection.scriptOverrides[name] ?? sourcePackage.scripts[name];
      if (typeof command !== "string" || !command)
        throw new Error(`Missing selected project command ${name}.`);
      return [name, command];
    }),
  );
  return {
    name: sourcePackage.name,
    version: "0.1.0",
    private: true,
    license: "UNLICENSED",
    type: "module",
    packageManager: sourcePackage.packageManager,
    scripts,
    devDependencies: Object.fromEntries(
      selection.devDependencies.map((name) => {
        const version = sourcePackage.devDependencies[name];
        if (!version) throw new Error(`Missing selected project dependency ${name}.`);
        return [name, version];
      }),
    ),
  };
}

export function selectedProjectVerification(source, selection) {
  const selected = new Set(selection.verificationCommands);
  const commands = source.commands.filter((command) => selected.has(command.key));
  if (commands.length !== selected.size)
    throw new Error("Project verification selects an unknown command.");
  const files = new Set(selection.files);
  const mapCommands = (entries) =>
    Object.fromEntries(
      Object.entries(entries).flatMap(([owner, values]) => {
        const retained = values.filter((value) => selected.has(value));
        return retained.length ? [[owner, retained]] : [];
      }),
    );
  const tests = Object.fromEntries(
    Object.entries(source.testConsumers)
      .filter(([file]) => files.has(file))
      .map(([file, values]) => [file, values.filter((value) => files.has(value))]),
  );
  for (const file of files)
    if (file.startsWith("scripts/") && file.endsWith(".mjs"))
      tests[file] = [...new Set([...(tests[file] ?? []), "scripts/setup/runtime-safety.test.mjs"])];
  return {
    schemaVersion: 1,
    prePushChecks: [],
    risks: source.risks.filter((entry) => files.has(entry.path)),
    commands,
    testConsumers: tests,
    exactConsumers: mapCommands(
      Object.fromEntries(Object.entries(source.exactConsumers).filter(([file]) => files.has(file))),
    ),
    ownedCategories: mapCommands(source.ownedCategories),
  };
}
