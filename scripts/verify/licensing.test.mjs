/** Verifies licensing and attribution enforcement for framework and generated-project baselines. */
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { licensingFindings } from "./licensing.mjs";

const repositoryRoot = path.resolve(new URL("../..", import.meta.url).pathname);

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "codexrig-license-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  for (const relativePath of [
    "LICENSE",
    "NOTICE",
    "README.md",
    "package.json",
    ".codexrig/framework.json",
  ]) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(repositoryRoot, relativePath), target, { recursive: true });
  }
  return root;
}

test("framework and generated-project licensing material is complete", () => {
  assert.deepEqual(licensingFindings({ root: repositoryRoot }), []);
});

test("license, required notice, package metadata, and upgrade ownership fail closed", (t) => {
  const root = fixture(t);
  writeFileSync(
    path.join(root, "LICENSE"),
    `${readFileSync(path.join(root, "LICENSE"), "utf8")}\n`,
  );
  writeFileSync(
    path.join(root, "NOTICE"),
    readFileSync(path.join(root, "NOTICE"), "utf8").replace(
      "Commercial Licensing",
      "Commercial License",
    ),
  );
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  delete packageJson.license;
  writeFileSync(path.join(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  const contract = JSON.parse(readFileSync(path.join(root, ".codexrig/framework.json"), "utf8"));
  contract.upgrade.managedRoots = contract.upgrade.managedRoots.filter(
    (relativePath) => !["LICENSE", "NOTICE"].includes(relativePath),
  );
  writeFileSync(
    path.join(root, ".codexrig/framework.json"),
    `${JSON.stringify(contract, null, 2)}\n`,
  );

  const findings = licensingFindings({ root });
  assert.ok(findings.some((finding) => finding.startsWith("LICENSE:")));
  assert.ok(findings.some((finding) => finding.includes("exact CodexRig licensing")));
  assert.ok(findings.some((finding) => finding.includes("package.json")));
  assert.ok(findings.some((finding) => finding.includes("managedRoots must include LICENSE")));
  assert.ok(findings.some((finding) => finding.includes("managedRoots must include NOTICE")));
});

test("the public summary preserves the commercial project-only credit exception", (t) => {
  const root = fixture(t);
  const readmePath = path.join(root, "README.md");
  writeFileSync(
    readmePath,
    readFileSync(readmePath, "utf8").replace(
      "It does not permit their removal from CodexRig itself",
      "Credits may also be removed from CodexRig",
    ),
  );
  assert.ok(
    licensingFindings({ root }).some((finding) =>
      finding.includes("controlling license and attribution boundary"),
    ),
  );
});
