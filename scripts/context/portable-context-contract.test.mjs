import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  portableContextContractFiles,
  portableContextContractFindings,
} from "./portable-context-contract.mjs";
import { authorizedImplementationContinuationInvariant } from "./portable-context-required-content.mjs";

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

function append(root, relativePath, content) {
  const absolutePath = path.join(root, relativePath);
  writeFileSync(absolutePath, `${readFileSync(absolutePath, "utf8")}\n${content}\n`, "utf8");
}

function contradictionFindings(root) {
  return portableContextContractFindings({ repositoryRoot: root }).filter((finding) =>
    finding.includes("contradictory Stop-hook index contract"),
  );
}

after(() => {
  for (const root of temporaryRoots) rmSync(root, { force: true, recursive: true });
});

test("the hook mutation contract permits bounded lifecycle non-mutation", () => {
  const root = stagedFixture();
  append(
    root,
    "README.md",
    "Before bootstrap, the Stop hook does not update the context index. The Stop hook does not update the context index before bootstrap. During normal verification, the Stop hook does not update the context index. The Stop hook does not update the context index during normal verification. After each tool call, the Stop hook does not update the context index. The Stop hook does not update the context index after each tool call.",
  );
  assert.deepEqual(contradictionFindings(root), []);
});

test("the hook mutation contract rejects active and passive stale assertions", () => {
  for (const assertion of [
    "Project hooks never\nupdate the context index.",
    "The context index is never\nupdated by the Stop hook.",
    "Project hooks will never update the context index.",
    "The Stop hook never updates `.context-index/`.",
    "The Stop hook does not update the context index before bootstrap, but after bootstrap the Stop hook never updates the context index.",
    "Verification remains read-only; the Stop hook never updates the context index.",
    "The Stop hook never updates the context index; verification remains read-only.",
  ]) {
    const root = stagedFixture();
    append(root, "README.md", assertion);
    assert.equal(
      contradictionFindings(root).some((finding) => finding.endsWith("README.md")),
      true,
    );
  }
});

test("portable verification rejects native in-place context runtime maintenance", () => {
  const root = stagedFixture();
  append(
    root,
    "scripts/context/context-storage.mjs",
    "async function unsafe(table) { await table.optimize(); }",
  );
  assert.equal(
    portableContextContractFindings({ repositoryRoot: root }).some((finding) =>
      finding.includes("unsafe in-place maintenance"),
    ),
    true,
  );
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

  packageJson.scripts["context:index"] = "node scripts/context/other-indexer.mjs";
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  assert.equal(
    portableContextContractFindings({ repositoryRoot: root }).includes(
      "portable context contract requires package.json script context:index",
    ),
    true,
  );
});

test("portable workflow owners cannot lose the authorized implementation continuation invariant", () => {
  for (const relativePath of [
    "AGENTS.md",
    "README.md",
    "docs/project.md",
    "instructions.md",
    ".agents/skills/project-implementation/SKILL.md",
    ".agents/skills/resume-project/SKILL.md",
  ]) {
    const root = stagedFixture();
    const absolutePath = path.join(root, ...relativePath.split("/"));
    const content = readFileSync(absolutePath, "utf8");
    const invariantPattern = new RegExp(
      authorizedImplementationContinuationInvariant
        .split(/\s+/u)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
        .join("\\s+"),
      "u",
    );
    assert.match(content, invariantPattern, relativePath);
    writeFileSync(
      absolutePath,
      content.replace(invariantPattern, "Continue when appropriate."),
      "utf8",
    );
    assert.equal(
      portableContextContractFindings({ repositoryRoot: root }).some(
        (finding) =>
          finding.includes(relativePath) &&
          finding.includes(authorizedImplementationContinuationInvariant),
      ),
      true,
      relativePath,
    );
  }
});
