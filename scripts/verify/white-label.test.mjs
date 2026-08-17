/** Verifies white label behavior for the repository verification boundary. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  initialProductConfiguration,
  productConfigurationFindings,
  productConfigurationPath,
} from "../contracts/product-configuration.mjs";
import { whiteLabelProjectFindings } from "./white-label.mjs";

const roots = [];

function fixture(prefix = "white-label-") {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function write(root, relativePath, content) {
  const target = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

test.after(() => {
  for (const root of roots) rmSync(root, { force: true, recursive: true });
});

test("the portable product configuration is neutral, structured, and secret-free", () => {
  const content = initialProductConfiguration("Example Product");
  assert.deepEqual(productConfigurationFindings(content), []);
  assert.match(content, /"displayName": null/u);
  assert.doesNotMatch(content, /CodexRig/u);

  const leakedFramework = content.replace(
    '"displayName": null',
    '"displayName": "CodexRig Storefront"',
  );
  assert.ok(
    productConfigurationFindings(leakedFramework).some((finding) =>
      finding.includes("framework branding"),
    ),
  );
  const secretSetting = content.replace('"theme": {}', '"theme": { "apiToken": "x" }');
  assert.ok(
    productConfigurationFindings(secretSetting).some((finding) =>
      finding.includes("secret boundary"),
    ),
  );

  const designTokens = content.replace(
    '"theme": {}',
    '"theme": { "designTokens": { "accent": "#123456" } }',
  );
  assert.deepEqual(productConfigurationFindings(designTokens), []);
});

test("generated products require one owner and reject public identity literals", () => {
  const root = fixture();
  write(
    root,
    productConfigurationPath,
    initialProductConfiguration("Example Product").replace(
      '"displayName": null',
      '"displayName": "Example Product"',
    ),
  );
  write(
    root,
    "src/index.js",
    'import configuration from "../config/product.json" with { type: "json" };\nexport const productName = configuration.identity.displayName;\n',
  );
  const paths = [productConfigurationPath, "src/index.js"];
  assert.deepEqual(whiteLabelProjectFindings({ root, relativePaths: paths }), []);

  write(root, "src/index.js", 'export const productName = "Example Product";\n');
  assert.ok(
    whiteLabelProjectFindings({ root, relativePaths: paths }).some((finding) =>
      finding.includes("instead of deriving it"),
    ),
  );

  write(root, "src/index.js", 'export const productName = "EXAMPLE PRODUCT";\n');
  assert.ok(
    whiteLabelProjectFindings({ root, relativePaths: paths }).some((finding) =>
      finding.includes("instead of deriving it"),
    ),
  );

  write(root, "src/index.js", 'export const footer = "Powered by CodexRig";\n');
  assert.ok(
    whiteLabelProjectFindings({ root, relativePaths: paths }).some((finding) =>
      finding.includes("leaks CodexRig branding"),
    ),
  );

  write(root, "src/index.js", 'export const framework = "../.codexrig/framework.json";\n');
  assert.ok(
    whiteLabelProjectFindings({ root, relativePaths: paths }).some((finding) =>
      finding.includes("framework-owned boundary"),
    ),
  );

  write(root, "src/CODEXRIG-brand.js", "export const brand = true;\n");
  assert.ok(
    whiteLabelProjectFindings({
      root,
      relativePaths: [productConfigurationPath, "src/CODEXRIG-brand.js"],
    }).some((finding) => finding.includes("product-facing path")),
  );
});

test("the reusable source stays product-neutral while children require configuration", () => {
  const source = fixture("white-label-source-");
  write(source, ".agents/skills/create-project-from-framework/SKILL.md", "# Source-only skill\n");
  write(source, "src/.gitkeep", "");
  assert.deepEqual(
    whiteLabelProjectFindings({ root: source, relativePaths: ["src/.gitkeep"] }),
    [],
  );

  write(source, productConfigurationPath, initialProductConfiguration("Leaked Child"));
  assert.ok(
    whiteLabelProjectFindings({
      root: source,
      relativePaths: [productConfigurationPath, "src/.gitkeep"],
    }).some((finding) => finding.includes("neutral source framework")),
  );

  const child = fixture("white-label-child-");
  write(child, "src/.gitkeep", "");
  assert.ok(
    whiteLabelProjectFindings({ root: child, relativePaths: ["src/.gitkeep"] }).some((finding) =>
      finding.includes("missing required white-label owner"),
    ),
  );
});
