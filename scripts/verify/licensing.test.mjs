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

test("source licensing and generated-output permission is complete", () => {
  assert.deepEqual(licensingFindings({ root: repositoryRoot }), []);
});

test("source license, required notice and package metadata fail closed", (t) => {
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

  const findings = licensingFindings({ root });
  assert.ok(findings.some((finding) => finding.startsWith("LICENSE:")));
  assert.ok(findings.some((finding) => finding.includes("exact CodexRig licensing")));
  assert.ok(findings.some((finding) => finding.includes("package.json")));
});

test("the public summary keeps source credit protection distinct from output permission", (t) => {
  const root = fixture(t);
  const readmePath = path.join(root, "README.md");
  const readme = readFileSync(readmePath, "utf8");
  const protectedStatement = /does\s+not\s+permit\s+their\s+removal\s+from\s+CodexRig\s+itself/u;
  assert.match(readme, protectedStatement);
  writeFileSync(
    readmePath,
    readme.replace(protectedStatement, "Credits may also be removed from CodexRig"),
  );
  assert.ok(
    licensingFindings({ root }).some((finding) =>
      finding.includes("controlling license and attribution boundary"),
    ),
  );
});
