import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { formatContextError } from "../../../../scripts/context/terminal-output.mjs";
import { listManagedMarkdownFiles } from "../../../../scripts/docs/document-scope.mjs";
import { productSourceBoundaryFindings } from "../../../../scripts/verify/path-hygiene.mjs";
import { fail } from "./project-options.mjs";
import { generatedProjectDocuments } from "./project-transfer-policy.mjs";

function posixRelative(root, fullPath) {
  return path.relative(root, fullPath).split(path.sep).join("/");
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
