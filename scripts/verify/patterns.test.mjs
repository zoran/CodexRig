/** Verifies patterns behavior for the repository verification boundary. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeCodePatterns,
  isMaintainedExecutablePath,
  maxExecutableLines,
  physicalLineCount,
} from "./patterns.mjs";

function analyze(files) {
  return analyzeCodePatterns({
    activeFiles: Object.keys(files),
    readText: (relativePath) => files[relativePath],
  });
}

const moduleHeader = "/** Owns exact behavior for the product-domain verification boundary. */\n";
const largeTestHeader =
  "/** Verifies large-source behavior for the product-domain verification boundary. */\n";
const orderHeader =
  "/** Owns order policy behavior for the product-domain verification boundary. */\n";

test("maintained executable code accepts 700 physical lines and rejects 701", () => {
  assert.equal(maxExecutableLines, 700);
  assert.deepEqual(analyze({ "src/exact.ts": moduleHeader + "line\n".repeat(699) }).failures, []);
  assert.match(
    analyze({ "src/over.ts": moduleHeader + "line\n".repeat(700) }).failures.join("\n"),
    /src\/over\.ts: 701 physical lines; maximum for maintained executable code is 700/,
  );
});

test("maintained files and public types require current responsibility headers", () => {
  assert.match(
    analyze({ "src/order-policy.ts": "export const policy = true;\n" }).failures.join("\n"),
    /purpose\/owner header/,
  );
  assert.match(
    analyze({ "src/order-policy.ts": "/** Generic file. *\/\n" }).failures.join("\n"),
    /meaningfully explain/,
  );
  assert.match(
    analyze({
      "src/order-policy.ts":
        "/** Owns catalog behavior for the product-domain verification boundary. *\/\n",
    }).failures.join("\n"),
    /no longer names the file's responsibility/,
  );
  assert.match(
    analyze({
      "src/order-policy.ts": `${orderHeader}export class OrderPolicy {}\n`,
    }).failures.join("\n"),
    /OrderPolicy needs a declaration-adjacent/,
  );
  assert.deepEqual(
    analyze({
      "src/order-policy.ts":
        `${orderHeader}/** Decides whether an order action satisfies the public policy contract. */\n` +
        "export class OrderPolicy {}\n",
    }).failures,
    [],
  );
});

test("physical line counting treats LF and CRLF consistently", () => {
  assert.equal(physicalLineCount("one\ntwo\n"), 2);
  assert.equal(physicalLineCount("one\r\ntwo\r\n"), 2);
  assert.equal(physicalLineCount("one\r\ntwo"), 2);
  assert.equal(physicalLineCount(""), 0);
});

test("header checks cover executable tests and hooks while size excludes test corpora", () => {
  for (const relativePath of [
    "src/domain.test.ts",
    "src/native.swift",
    "src/module.mts",
    "scripts/git-hooks/pre-push",
  ]) {
    assert.equal(isMaintainedExecutablePath(relativePath), true, relativePath);
  }
  assert.deepEqual(
    analyze({ "src/large.test.ts": largeTestHeader + "line\n".repeat(900) }).failures,
    [],
  );
});

test("language-aware declaration checks preserve license and annotation preambles", () => {
  assert.deepEqual(
    analyze({
      "src/catalog.ts":
        "// SPDX-License-Identifier: MIT\n" +
        "/** Owns catalog behavior for the product-domain verification boundary. */\n" +
        "/** Exposes the catalog policy contract. */\n" +
        "@sealed\n" +
        "export class Catalog {}\n",
    }).failures,
    [],
  );
  assert.deepEqual(
    analyze({
      "src/session.py":
        '"""Owns session behavior for the authentication domain boundary."""\n' +
        "class Session:\n" +
        '    """Represents an authenticated session and its expiry invariant."""\n',
    }).failures,
    [],
  );
});

test("the quota excludes non-code and code-shaped context carriers", () => {
  for (const relativePath of [
    "docs/project.md",
    "src/page.html",
    "src/styles.css",
    "src/schema.sql",
    "src/fixtures/large.ts",
    "src/snapshots/output.js",
    "src/client.generated.ts",
    "generated/client.py",
  ]) {
    assert.equal(isMaintainedExecutablePath(relativePath), false, relativePath);
  }
  const oversized = "line\n".repeat(701);
  assert.deepEqual(
    analyze({
      "docs/project.md": oversized,
      "src/styles.css": oversized,
      "src/fixtures/large.ts": oversized,
      "src/client.generated.ts": oversized,
    }).failures,
    [],
  );
});
