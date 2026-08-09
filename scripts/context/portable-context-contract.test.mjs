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

function flexibleTextPattern(value) {
  return new RegExp(
    value
      .split(/\s+/u)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
      .join("\\s+"),
    "giu",
  );
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

test("portable workflow owners cannot lose pre-slice goal and slice coordination", () => {
  for (const [relativePath, marker] of [
    ["AGENTS.md", "Before every slice begins"],
    ["instructions.md", "Immediately before every slice begins"],
    [".agents/skills/project-implementation/SKILL.md", "Immediately before every slice begins"],
    [".agents/skills/resume-project/SKILL.md", "Before a resumed or newly selected slice begins"],
    [".codex/agents/default.toml", "Before every assigned slice begins"],
  ]) {
    const root = stagedFixture();
    const absolutePath = path.join(root, ...relativePath.split("/"));
    const content = readFileSync(absolutePath, "utf8");
    const markerPattern = flexibleTextPattern(marker);
    assert.match(content, markerPattern, relativePath);
    writeFileSync(absolutePath, content.replace(markerPattern, "Before integration"), "utf8");
    assert.equal(
      portableContextContractFindings({ repositoryRoot: root }).some(
        (finding) => finding.includes(relativePath) && finding.includes(marker),
      ),
      true,
      relativePath,
    );
  }
});

test("portable workflow owners cannot claim that local state observes other accounts", () => {
  const marker = "cannot prove that another clone, machine, or account is idle";
  for (const relativePath of [
    "AGENTS.md",
    "README.md",
    "docs/project.md",
    "instructions.md",
    ".codex/README.md",
    ".agents/skills/project-implementation/SKILL.md",
    ".agents/skills/resume-project/SKILL.md",
    ".agents/skills/task-quality/SKILL.md",
  ]) {
    const root = stagedFixture();
    const absolutePath = path.join(root, ...relativePath.split("/"));
    const content = readFileSync(absolutePath, "utf8");
    const markerPattern = flexibleTextPattern(marker);
    assert.match(content, markerPattern, relativePath);
    writeFileSync(
      absolutePath,
      content.replace(markerPattern, "proves that every account is idle"),
      "utf8",
    );
    assert.equal(
      portableContextContractFindings({ repositoryRoot: root }).some(
        (finding) => finding.includes(relativePath) && finding.includes(marker),
      ),
      true,
      relativePath,
    );
  }
});

test("portable verification identifies project-document reconciliation after an upgrade", () => {
  const root = stagedFixture();
  const relativePath = "AGENTS.md";
  const absolutePath = path.join(root, relativePath);
  const content = readFileSync(absolutePath, "utf8");
  writeFileSync(
    absolutePath,
    content.replace(flexibleTextPattern("Before every slice begins"), "After the slice begins"),
    "utf8",
  );

  assert.equal(
    portableContextContractFindings({ repositoryRoot: root }).some(
      (finding) =>
        finding.startsWith(
          "project-document reconciliation required before verification: portable context contract requires AGENTS.md",
        ) && finding.includes("Before every slice begins"),
    ),
    true,
  );
});

test("portable workflow owners cannot lose completed-goal documentation preservation", () => {
  for (const [relativePath, marker] of [
    ["AGENTS.md", "all active documentation"],
    ["README.md", "all-document currency review"],
    ["docs/project.md", "separate preservation review"],
    ["instructions.md", "instead of appending history"],
    [".agents/skills/project-implementation/SKILL.md", "all-document currency review"],
    [".agents/skills/task-quality/SKILL.md", "consolidate or remove"],
  ]) {
    const root = stagedFixture();
    const absolutePath = path.join(root, ...relativePath.split("/"));
    const content = readFileSync(absolutePath, "utf8");
    const markerPattern = flexibleTextPattern(marker);
    assert.match(content, markerPattern, relativePath);
    writeFileSync(absolutePath, content.replace(markerPattern, "selected documentation"), "utf8");
    assert.equal(
      portableContextContractFindings({ repositoryRoot: root }).some(
        (finding) => finding.includes(relativePath) && finding.includes(marker),
      ),
      true,
      relativePath,
    );
  }
});

test("portable workflow owners cannot weaken critical-manifest user confirmation", () => {
  for (const [relativePath, marker] of [
    ["AGENTS.md", "durable project manifest"],
    ["README.md", "explicit user confirmation"],
    ["docs/project.md", "durable project manifest"],
    ["instructions.md", "explicit user confirmation"],
    [".agents/skills/project-implementation/SKILL.md", "durable project manifest"],
    [".agents/skills/resume-project/SKILL.md", "explicit user confirmation"],
    [".agents/skills/task-quality/SKILL.md", "durable project manifest"],
  ]) {
    const root = stagedFixture();
    const absolutePath = path.join(root, ...relativePath.split("/"));
    const content = readFileSync(absolutePath, "utf8");
    const markerPattern = flexibleTextPattern(marker);
    assert.match(content, markerPattern, relativePath);
    writeFileSync(absolutePath, content.replace(markerPattern, "ordinary documentation"), "utf8");
    assert.equal(
      portableContextContractFindings({ repositoryRoot: root }).some(
        (finding) => finding.includes(relativePath) && finding.includes(marker),
      ),
      true,
      relativePath,
    );
  }
});

test("portable workflow owners cannot replace current research with stale authority", () => {
  for (const relativePath of [
    "AGENTS.md",
    "README.md",
    "docs/project.md",
    "instructions.md",
    ".agents/skills/project-implementation/SKILL.md",
  ]) {
    const marker = "newest relevant primary or official sources";
    const root = stagedFixture();
    const absolutePath = path.join(root, ...relativePath.split("/"));
    const content = readFileSync(absolutePath, "utf8");
    const markerPattern = flexibleTextPattern(marker);
    assert.match(content, markerPattern, relativePath);
    writeFileSync(absolutePath, content.replace(markerPattern, "available sources"), "utf8");
    assert.equal(
      portableContextContractFindings({ repositoryRoot: root }).some(
        (finding) => finding.includes(relativePath) && finding.includes(marker),
      ),
      true,
      relativePath,
    );
  }
});

test("portable workflow owners protect replaceable components and assembled compatibility", () => {
  for (const [relativePath, marker] of [
    ["AGENTS.md", "independently improvable or replaceable"],
    ["README.md", "assembled system is verified as one functioning unit"],
    ["docs/project.md", "independently improvable or replaceable"],
    ["instructions.md", "assembled system is verified as one functioning unit"],
    [".agents/skills/project-implementation/SKILL.md", "independently improvable or replaceable"],
  ]) {
    const root = stagedFixture();
    const absolutePath = path.join(root, ...relativePath.split("/"));
    const content = readFileSync(absolutePath, "utf8");
    const markerPattern = flexibleTextPattern(marker);
    assert.match(content, markerPattern, relativePath);
    writeFileSync(absolutePath, content.replace(markerPattern, "loosely separated"), "utf8");
    assert.equal(
      portableContextContractFindings({ repositoryRoot: root }).some(
        (finding) => finding.includes(relativePath) && finding.includes(marker),
      ),
      true,
      relativePath,
    );
  }
});
