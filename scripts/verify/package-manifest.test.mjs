import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { packageManifestFindings } from "./package-manifest.mjs";

function fixture(t, manifest, ownedExports) {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "package-manifest-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  mkdirSync(path.join(repositoryRoot, "src"), { recursive: true });
  writeFileSync(path.join(repositoryRoot, "package.json"), `${JSON.stringify(manifest)}\n`, "utf8");
  if (ownedExports !== undefined) {
    writeFileSync(
      path.join(repositoryRoot, "package.exports.json"),
      `${JSON.stringify({ ownedExports, schemaVersion: 1 })}\n`,
      "utf8",
    );
  }
  return repositoryRoot;
}

test("the package-local export owner ignores siblings but rejects its own target drift", (t) => {
  const manifest = {
    dependencies: { alpha: "workspace:*" },
    exports: {
      ".": "./src/index.mjs",
      "./context": {
        import: "./src/context.mjs",
        types: "./src/context.d.ts",
      },
      "./independent": "./src/independent.mjs",
    },
    name: "@example/product",
    private: true,
    scripts: { test: "node --test", "verify:preflight": "node verify-exports.mjs" },
    type: "module",
    version: "1.0.0",
  };
  const expectedExports = {
    "./context": {
      import: "./src/context.mjs",
      types: "./src/context.d.ts",
    },
  };
  const repositoryRoot = fixture(t, manifest, expectedExports);
  assert.deepEqual(packageManifestFindings({ repositoryRoot }), []);

  manifest.exports["./context"].import = "./src/context-v2.mjs";
  writeFileSync(path.join(repositoryRoot, "package.json"), `${JSON.stringify(manifest)}\n`, "utf8");
  assert.ok(
    packageManifestFindings({ repositoryRoot }).some((finding) =>
      finding.includes("owned export ./context changed"),
    ),
  );
});

test("whole-manifest verifier checks scripts, dependencies, identity, and every export", (t) => {
  const repositoryRoot = fixture(t, {
    dependencies: { alpha: 1 },
    exports: {
      ".": "../outside.mjs",
      condition: "./mixed-condition.mjs",
    },
    name: "",
    private: "yes",
    scripts: { test: false },
  });
  const findings = packageManifestFindings({ repositoryRoot });
  assert.ok(findings.some((finding) => finding.includes("dependencies entry")));
  assert.ok(findings.some((finding) => finding.includes("scripts entry")));
  assert.ok(findings.some((finding) => finding.includes("name")));
  assert.ok(findings.some((finding) => finding.includes("private")));
  assert.ok(findings.some((finding) => finding.includes("cannot mix")));
});

test("whole-manifest verifier rejects control characters in map values", (t) => {
  const repositoryRoot = fixture(t, {
    dependencies: { alpha: "workspace:*\0hidden" },
    name: "@example/product",
    private: true,
    scripts: { test: "node --test\nnode unexpected.mjs" },
  });
  const findings = packageManifestFindings({ repositoryRoot });
  assert.ok(findings.some((finding) => finding.includes("dependencies entry")));
  assert.ok(findings.some((finding) => finding.includes("scripts entry")));
});

test("a dangling package export contract fails closed", (t) => {
  const repositoryRoot = fixture(t, {
    exports: { "./owned": "./src/owned.mjs" },
    name: "@example/product",
    private: true,
  });
  symlinkSync("missing-package-exports.json", path.join(repositoryRoot, "package.exports.json"));
  assert.ok(
    packageManifestFindings({ repositoryRoot }).some((finding) =>
      finding.includes("package.exports.json is missing or unsafe"),
    ),
  );
});
