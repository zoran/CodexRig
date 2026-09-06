/** Verifies portable context contract behavior for the portable policy and durable project-context boundary. */
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

function flexibleTextPattern(value) {
  return new RegExp(
    value
      .split(/\s+/u)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
      .join("\\s+"),
    "giu",
  );
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

test("portable runtime content declarations are active for their existing owners", () => {
  const root = stagedFixture();
  const relativePath = "scripts/repository/runtime-session-state.mjs";
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  copyFileSync(path.join(repositoryRoot, relativePath), absolutePath);

  assert.equal(
    portableContextContractFindings({ repositoryRoot: root }).some((finding) =>
      finding.includes(relativePath),
    ),
    false,
  );
  writeFileSync(
    absolutePath,
    readFileSync(absolutePath, "utf8").replace("schemaVersion: 6", "schemaVersion: 9"),
    "utf8",
  );
  assert.equal(
    portableContextContractFindings({ repositoryRoot: root }).some(
      (finding) => finding.includes(relativePath) && finding.includes("schemaVersion: 6"),
    ),
    true,
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

  packageJson.scripts["handover:receive"] = "node scripts/context/other-receiver.mjs";
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  assert.equal(
    portableContextContractFindings({ repositoryRoot: root }).includes(
      "portable context contract requires package.json script handover:receive",
    ),
    true,
  );
});

test("portable workflow owners cannot lose the authorized implementation continuation invariant", () => {
  for (const relativePath of [
    "AGENTS.md",
    "README.md",
    "instructions.md",
    ".agents/skills/resume-project/SKILL.md",
    ".agents/skills/project-implementation/SKILL.md",
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
    ["instructions.md", "Immediately before every slice begins"],
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

test("portable workflow owners cannot claim that local state observes other developers", () => {
  const marker = "cannot prove that another developer's clone is idle";
  for (const relativePath of [".codex/README.md"]) {
    const root = stagedFixture();
    const absolutePath = path.join(root, ...relativePath.split("/"));
    const content = readFileSync(absolutePath, "utf8");
    const markerPattern = flexibleTextPattern(marker);
    assert.match(content, markerPattern, relativePath);
    writeFileSync(
      absolutePath,
      content.replace(markerPattern, "proves that every developer is idle"),
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
  const relativePath = "instructions.md";
  const absolutePath = path.join(root, relativePath);
  const content = readFileSync(absolutePath, "utf8");
  writeFileSync(
    absolutePath,
    content.replace(
      flexibleTextPattern("Immediately before every slice begins"),
      "After the slice begins",
    ),
    "utf8",
  );

  assert.equal(
    portableContextContractFindings({ repositoryRoot: root }).some(
      (finding) =>
        finding.startsWith(
          "project-document reconciliation required before verification: portable context contract requires instructions.md",
        ) && finding.includes("Immediately before every slice begins"),
    ),
    true,
  );
});

test("portable workflow owners cannot lose completed-goal documentation preservation", () => {
  for (const [relativePath, marker] of [["instructions.md", "instead of appending history"]]) {
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
  for (const [relativePath, marker] of [["instructions.md", "explicit user confirmation"]]) {
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
  for (const relativePath of ["instructions.md"]) {
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
    ["instructions.md", "assembled system is verified as one functioning unit"],
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

test("implementation policy routes to canonical authority without repeating its governance", () => {
  for (const anchor of [
    "authorized-work-and-native-codex",
    "subagent-orchestration-and-integration-authority",
    "ui-intent-and-change-boundaries",
  ]) {
    const root = stagedFixture();
    const relativePath = ".agents/skills/project-implementation/SKILL.md";
    const absolutePath = path.join(root, relativePath);
    const content = readFileSync(absolutePath, "utf8");
    const target = `../../../instructions.md#${anchor}`;
    assert.ok(content.includes(target), target);
    writeFileSync(absolutePath, content.replace(target, "../../../instructions.md"), "utf8");
    assert.ok(
      portableContextContractFindings({ repositoryRoot: root }).some(
        (finding) => finding.includes(relativePath) && finding.includes(target),
      ),
    );
  }
});
