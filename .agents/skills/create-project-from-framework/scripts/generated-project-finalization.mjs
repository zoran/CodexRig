import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { formatContextError } from "../../../../scripts/context/terminal-output.mjs";
import { listManagedMarkdownFiles } from "../../../../scripts/docs/document-scope.mjs";
import { listPortableTransferFiles } from "../../../../scripts/repository/source-inventory.mjs";
import {
  readStableRepositoryText,
  scanStableRepositoryFile,
} from "../../../../scripts/repository/stable-file-snapshot.mjs";
import { productSourceBoundaryFindings } from "../../../../scripts/verify/path-hygiene.mjs";
import { fail } from "./project-options.mjs";
import { generatedProjectDocuments } from "./project-transfer-policy.mjs";

const transformedProjectPaths = new Set([
  ".codex/README.md",
  ".codex/config.toml",
  ...generatedProjectDocuments,
  "package.json",
]);
const requiredGeneratedProjectPaths = new Set([".codexrig/installation.json"]);
const allowedGeneratedProjectPaths = new Set([...requiredGeneratedProjectPaths, "src/.gitkeep"]);

function posixRelative(root, fullPath) {
  return path.relative(root, fullPath).split(path.sep).join("/");
}

function stableFileDigest(repositoryRoot, relativePath, expectedIdentity) {
  const digest = createHash("sha256");
  scanStableRepositoryFile({
    repositoryRoot,
    relativePath,
    expectedIdentity,
    onChunk: (chunk) => digest.update(chunk),
  });
  return digest.digest("hex");
}

function validateTransferManifest(transferManifest) {
  if (
    !transferManifest ||
    !Array.isArray(transferManifest.files) ||
    !Array.isArray(transferManifest.excluded)
  ) {
    fail("Generated project transfer manifest is invalid.");
  }
  const includedPaths = transferManifest.files.map((entry) => entry?.relativePath);
  const excludedPaths = transferManifest.excluded.map((entry) => entry?.relativePath);
  if (
    transferManifest.files.some(
      (entry) =>
        typeof entry?.relativePath !== "string" ||
        !entry.relativePath ||
        typeof entry.identity !== "string" ||
        !entry.identity,
    ) ||
    transferManifest.excluded.some(
      (entry) =>
        typeof entry?.relativePath !== "string" ||
        !entry.relativePath ||
        typeof entry.exclusionReason !== "string" ||
        !entry.exclusionReason,
    ) ||
    new Set([...includedPaths, ...excludedPaths]).size !==
      includedPaths.length + excludedPaths.length
  ) {
    fail("Generated project transfer manifest is invalid.");
  }
}

function assertDeclaredConfigurationTransformations({ sourceRoot, targetRoot, transferManifest }) {
  const entries = new Map(transferManifest.files.map((entry) => [entry.relativePath, entry]));
  const sourceConfig = readStableRepositoryText({
    repositoryRoot: sourceRoot,
    relativePath: ".codex/config.toml",
    expectedIdentity: entries.get(".codex/config.toml").identity,
  }).text;
  const memoryFlagCount = sourceConfig.match(/^memories\s*=\s*false\s*$/gmu)?.length ?? 0;
  const expectedConfig = sourceConfig.replace(/^memories\s*=\s*false\s*$/mu, "memories = true");
  const targetConfig = readStableRepositoryText({
    repositoryRoot: targetRoot,
    relativePath: ".codex/config.toml",
  }).text;
  if (memoryFlagCount !== 1 || targetConfig !== expectedConfig) {
    fail("Generated project Codex config exceeds the declared memory-enablement transformation.");
  }

  const sourcePackage = JSON.parse(
    readStableRepositoryText({
      repositoryRoot: sourceRoot,
      relativePath: "package.json",
      expectedIdentity: entries.get("package.json").identity,
    }).text,
  );
  const targetPackage = JSON.parse(
    readStableRepositoryText({
      repositoryRoot: targetRoot,
      relativePath: "package.json",
    }).text,
  );
  const expectedPackage = structuredClone(sourcePackage);
  expectedPackage.name = targetPackage.name;
  expectedPackage.version = "0.1.0";
  delete expectedPackage.scripts["framework:reset"];
  if (JSON.stringify(targetPackage) !== JSON.stringify(expectedPackage)) {
    fail("Generated package exceeds the declared identity and source-reset transformation.");
  }
}

export function assertGeneratedProjectParity({ sourceRoot, targetRoot, transferManifest }) {
  validateTransferManifest(transferManifest);
  const includedPaths = transferManifest.files.map(({ relativePath }) => relativePath);
  const includedPathSet = new Set(includedPaths);
  const missingTransformationInputs = [...transformedProjectPaths].filter(
    (relativePath) => !includedPathSet.has(relativePath),
  );
  if (missingTransformationInputs.length > 0) {
    fail(
      `Generated project transfer parity is missing declared transformation inputs: ${missingTransformationInputs.join(
        ", ",
      )}.`,
    );
  }

  const targetPaths = listPortableTransferFiles({ root: targetRoot, includeUntracked: true });
  const targetPathSet = new Set(targetPaths);
  const requiredPaths = new Set([...includedPaths, ...requiredGeneratedProjectPaths]);
  const allowedPaths = new Set([...requiredPaths, ...allowedGeneratedProjectPaths]);
  const missingPaths = [...requiredPaths].filter(
    (relativePath) => !targetPathSet.has(relativePath),
  );
  const unexpectedPaths = targetPaths.filter((relativePath) => !allowedPaths.has(relativePath));
  if (missingPaths.length > 0 || unexpectedPaths.length > 0) {
    const details = [];
    if (missingPaths.length > 0) details.push(`missing: ${missingPaths.join(", ")}`);
    if (unexpectedPaths.length > 0) details.push(`unexpected: ${unexpectedPaths.join(", ")}`);
    fail(`Generated project transfer parity failed (${details.join("; ")}).`);
  }

  assertDeclaredConfigurationTransformations({ sourceRoot, targetRoot, transferManifest });

  const changedPaths = transferManifest.files
    .filter(({ relativePath }) => !transformedProjectPaths.has(relativePath))
    .filter(
      ({ identity, relativePath }) =>
        stableFileDigest(sourceRoot, relativePath, identity) !==
        stableFileDigest(targetRoot, relativePath),
    )
    .map(({ relativePath }) => relativePath);
  if (changedPaths.length > 0) {
    fail(
      `Generated project transfer parity found reusable files changed outside declared project-specific transformations: ${changedPaths.join(
        ", ",
      )}.`,
    );
  }
}

export function updateGeneratedPackage(targetRoot, packageName) {
  const packagePath = path.join(targetRoot, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  packageJson.name = packageName;
  packageJson.version = "0.1.0";
  delete packageJson.scripts["framework:reset"];
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

export function runGeneratedNode(root, relativeScript, args = []) {
  const result = spawnSync(process.execPath, [path.join(root, relativeScript), ...args], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    input: "",
    stdio: "pipe",
  });
  if (result.error) fail(`${relativeScript} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = formatContextError(result.stderr || result.stdout || "", root);
    fail(`${relativeScript} failed with status ${result.status}${detail ? `: ${detail}` : ""}`);
  }
}

export function formatGeneratedMarkdown(sourceRoot, targetRoot) {
  const formatterPath = path.join(sourceRoot, "node_modules", "prettier", "bin", "prettier.cjs");
  if (!existsSync(formatterPath)) {
    fail(
      "Project initialization requires the framework's installed formatter. Run mise install --locked and then mise exec --locked -- pnpm install --frozen-lockfile --ignore-scripts first.",
    );
  }
  const result = spawnSync(
    process.execPath,
    [
      formatterPath,
      "--write",
      "AGENTS.md",
      "README.md",
      "docs/context-index.md",
      "docs/project.md",
      "instructions.md",
    ],
    {
      cwd: targetRoot,
      encoding: "utf8",
      input: "",
      stdio: "pipe",
    },
  );
  if (result.error) fail(`Generated Markdown formatter failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`Generated Markdown formatter failed with status ${result.status}`);
  }
}

export function assertGeneratedProjectClean(targetRoot, packageName) {
  for (const forbidden of [
    ".git",
    ".gitlab",
    ".context-index",
    ".codex/runtime",
    "docs/planning",
    ".project-state",
    "node_modules",
    ".agents/skills/create-project-from-framework",
    ".agents/skills/reset-framework",
    "scripts/setup/project-initialization-test-helpers.mjs",
    "scripts/setup/project-initialization.source.test.mjs",
    "scripts/setup/project-initialization-transfer.source.test.mjs",
    "scripts/setup/project-creator-contract.source.test.mjs",
    "scripts/verify/source-baseline.mjs",
  ]) {
    if (existsSync(path.join(targetRoot, ...forbidden.split("/")))) {
      fail(`Generated project contains forbidden state: ${forbidden}`);
    }
  }
  const forbiddenSegments = new Set([
    ".git",
    ".gitlab",
    ".context-index",
    ".next",
    ".pnpm-store",
    ".project-state",
    "coverage",
    "node_modules",
    "playwright-report",
    "test-results",
  ]);
  const pendingDirectories = [targetRoot];
  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = posixRelative(targetRoot, absolutePath);
      if (entry.isSymbolicLink()) fail(`Generated project contains a symlink: ${relativePath}`);
      if (entry.isFile()) continue;
      if (!entry.isDirectory()) continue;
      if (forbiddenSegments.has(entry.name)) {
        fail(`Generated project contains forbidden nested state: ${relativePath}`);
      }
      pendingDirectories.push(absolutePath);
    }
  }
  const githubEntries = readdirSync(path.join(targetRoot, ".github"), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) => posixRelative(targetRoot, path.join(entry.parentPath, entry.name)))
    .sort();
  if (githubEntries.join("\n") !== ".github/workflows/ci.yml") {
    fail("Generated project must retain only the portable GitHub CI adapter under .github/.");
  }
  const boundaryFindings = productSourceBoundaryFindings({ repositoryRoot: targetRoot });
  if (boundaryFindings.length > 0) {
    fail(`Generated project violates the Product Roots contract: ${boundaryFindings.join(", ")}`);
  }
  const codexEntries = readdirSync(path.join(targetRoot, ".codex")).sort();
  if (codexEntries.join("\n") !== ["README.md", "agents", "config.toml", "hooks.json"].join("\n")) {
    fail(
      "Generated .codex directory must contain only portable config, hooks, agents, and documentation.",
    );
  }
  const agentEntries = readdirSync(path.join(targetRoot, ".codex", "agents")).sort();
  const requiredAgentEntries = ["default.toml", "explorer.toml", "worker.toml"];
  const invalidAgentEntries = agentEntries.filter(
    (entry) => !/^[a-z][a-z0-9_-]*\.toml$/u.test(entry),
  );
  const missingAgentEntries = requiredAgentEntries.filter((entry) => !agentEntries.includes(entry));
  if (invalidAgentEntries.length > 0 || missingAgentEntries.length > 0) {
    fail(
      "Generated project must retain every validated project agent role and all built-in role overrides.",
    );
  }
  const packageJson = JSON.parse(readFileSync(path.join(targetRoot, "package.json"), "utf8"));
  if (packageJson.name !== packageName) fail("Generated package name was not updated.");
  if (packageJson.version !== "0.1.0") fail("Generated package must start at version 0.1.0.");
  if (!existsSync(path.join(targetRoot, ".gitlab-ci.yml"))) {
    fail("Generated project must retain the portable GitLab CI adapter.");
  }
  const projectDocuments = listManagedMarkdownFiles({ root: targetRoot });
  const expectedDocuments = [...generatedProjectDocuments].sort();
  if (projectDocuments.join("\n") !== expectedDocuments.join("\n")) {
    fail(
      `Generated project documentation must stay code-first and minimal. Expected ${expectedDocuments.join(", ")}; found ${projectDocuments.join(", ")}.`,
    );
  }
}
