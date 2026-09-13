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
