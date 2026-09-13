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

  write(root, "src/index.js", 'import "../scripts/setup/tooling-doctor.mjs";\n');
  assert.ok(
    whiteLabelProjectFindings({ root, relativePaths: paths }).some((finding) =>
      finding.includes("boundary"),
    ),
  );
});

test("repositories with product roots require explicit configuration", () => {
  const source = fixture("white-label-source-");
  assert.deepEqual(whiteLabelProjectFindings({ root: source, relativePaths: [] }), []);
  const child = fixture("white-label-child-");
  write(child, "src/.gitkeep", "");
  assert.ok(
    whiteLabelProjectFindings({ root: child, relativePaths: ["src/.gitkeep"] }).some((finding) =>
      finding.includes("missing required white-label owner"),
    ),
  );
});
