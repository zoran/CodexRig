/** Verifies portable context contract behavior for the portable policy and durable project-context boundary. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  portableContextContractFiles,
  portableContextContractFindings,
} from "./portable-context-contract.mjs";
import { readProjectWorkContext } from "./project-work-state.mjs";
import { projectContextPath } from "../docs/document-scope.mjs";
import { listActiveFiles, listPortableTransferFiles } from "../repository/source-inventory.mjs";
import { cleanGitEnvironment } from "../repository/git-runtime-isolation.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const temporaryRoots = [];

function stagedFixture() {
  const parent = mkdtempSync(path.join(os.tmpdir(), "portable-context-contract-"));
  const root = path.join(parent, "stage");
  temporaryRoots.push(parent);
  for (const relativePath of portableContextContractFiles) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(repositoryRoot, relativePath), target);
  }
  return root;
}

after(() => {
  for (const root of temporaryRoots) rmSync(root, { force: true, recursive: true });
});

test("portable verification requires the active project Codex config", () => {
  const root = stagedFixture();
  rmSync(path.join(root, ".codex", "config.toml"));
  assert.ok(
    portableContextContractFindings({ repositoryRoot: root }).includes(
      "portable context contract is missing .codex/config.toml",
    ),
  );
});

test("established project documents do not inherit source wording or an upgrade contract", () => {
  const root = stagedFixture();
  for (const file of ["README.md", "AGENTS.md", "instructions.md"]) {
    writeFileSync(
      path.join(root, file),
      "# Product work\n\nOnly the confirmed product scope applies.\n",
    );
  }
  assert.deepEqual(portableContextContractFindings({ repositoryRoot: root }), []);
});

test("the package contract permits additive sibling exports but protects its owned scripts", () => {
  const root = stagedFixture();
  const packagePath = path.join(root, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  packageJson.exports = {
    "./sibling": "./src/sibling.js",
  };
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  assert.equal(
    portableContextContractFindings({ repositoryRoot: root }).some((finding) =>
      finding.includes("package.json script"),
    ),
    false,
  );

  packageJson.scripts["handover:receive"] = "node scripts/context/other-receiver.mjs";
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  assert.equal(
    portableContextContractFindings({ repositoryRoot: root }).includes(
      "portable context contract requires package.json script handover:receive",
    ),
    true,
  );
});

test("effective private state isolation rejects an override in the final ignore policy", () => {
  const root = stagedFixture();
  const target = path.join(root, ".gitignore");
  writeFileSync(target, readFileSync(target, "utf8") + "\n!/sessions/\n!/sessions/**\n");
  assert.ok(
    portableContextContractFindings({ repositoryRoot: root }).some((finding) =>
      finding.includes("not effectively ignored"),
    ),
  );
});

test("private working context remains readable but outside Gitless source and transfers", () => {
  const root = stagedFixture();
  const state = {
    version: 1,
    revision: 1,
    status: "active",
    outcome: "Complete the authorized fixture.",
    currentGoal: "Verify private context retention.",
    currentSlice: "Check source visibility.",
    nextAction: "Resume the fixture.",
    blocker: null,
  };
  const content = `<!-- codexrig-work-state\n${JSON.stringify(state)}\n-->\n\n# Project Context\n\nPrivate fixture context.\n`;
  writeFileSync(path.join(root, projectContextPath), content);
  writeFileSync(path.join(root, "docs/project-context-reference.md"), "# Durable reference\n");

  assert.deepEqual(portableContextContractFindings({ repositoryRoot: root }), []);
  for (const files of [
    listActiveFiles({ root }),
    listPortableTransferFiles({ root, includeUntracked: true }),
  ]) {
    assert.equal(files.includes(projectContextPath), false);
    assert.equal(files.includes("docs/project.md"), true);
    assert.equal(files.includes("docs/project-context-reference.md"), true);
  }
  assert.deepEqual(readProjectWorkContext(root), { content, state });
  assert.equal(readFileSync(path.join(root, projectContextPath), "utf8"), content);
});

test("portable working context protection rejects missing and negated ignore rules", () => {
  for (const variant of ["missing", "root negation", "nested negation"]) {
    const root = stagedFixture();
    const gitignore = path.join(root, ".gitignore");
    const rules = readFileSync(gitignore, "utf8")
      .split(/\r?\n/u)
      .filter((line) => line !== `/${projectContextPath}`)
      .join("\n");
    writeFileSync(
      gitignore,
      `${rules}\n${variant === "missing" ? "" : `/${projectContextPath}\n`}${variant === "root negation" ? `!/${projectContextPath}\n` : ""}`,
    );
    if (variant === "nested negation")
      writeFileSync(path.join(root, "docs/.gitignore"), "!project-context.md\n");

    assert.ok(
      portableContextContractFindings({ repositoryRoot: root }).some((finding) =>
        finding.includes(`private project state is not effectively ignored: ${projectContextPath}`),
      ),
      variant,
    );
  }
});

test("portable working context protection rejects tracked context without deleting local bytes", () => {
  const root = stagedFixture();
  const content = "# Private fixture context\n\nPreserve local work.\n";
  writeFileSync(path.join(root, projectContextPath), content);
  const git = (...args) => {
    const result = spawnSync("git", args, {
      cwd: root,
      env: cleanGitEnvironment(process.env, root),
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
  };
  git("init", "--quiet");
  assert.deepEqual(portableContextContractFindings({ repositoryRoot: root }), []);
  git("add", "--force", "--", projectContextPath);
  assert.ok(
    portableContextContractFindings({ repositoryRoot: root }).some((finding) =>
      finding.includes(`private project state is tracked in Git: ${projectContextPath}`),
    ),
  );
  git("rm", "--cached", "--", projectContextPath);
  assert.deepEqual(portableContextContractFindings({ repositoryRoot: root }), []);
  assert.equal(readFileSync(path.join(root, projectContextPath), "utf8"), content);
});
