/** Verifies surface quality behavior for the repository verification boundary. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readStableRepositoryPrefixText } from "../repository/stable-file-snapshot.mjs";
import { responsiveFailures } from "./responsive.mjs";
import { analyzeRepositorySurfaces, createSurfaceSnapshot } from "./surface-quality.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");
const fixturePackageManager = JSON.parse(
  readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
).packageManager;

function write(root, relativePath, content) {
  const target = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

test("the surface owner inventories once and reuses one content snapshot", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "surface-quality-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  write(
    root,
    "package.json",
    `${JSON.stringify({ name: "surface", packageManager: fixturePackageManager })}\n`,
  );
  write(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  write(
    root,
    "src/index.html",
    [
      "<!doctype html>",
      '<html><head><meta name="viewport" content="width=device-width, initial-scale=1">',
      "<title>Surface fixture</title>",
      '<meta name="description" content="A complete surface analysis fixture page.">',
      '<link rel="canonical" href="https://example.invalid/fixture">',
      "</head><body><main>Fixture</main></body></html>",
    ].join("\n"),
  );
  write(
    root,
    "src/sitemap.xml",
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      "<url><loc>https://example.invalid/fixture</loc><lastmod>2026-07-14T00:00:00+00:00</lastmod></url>",
      "</urlset>",
    ].join("\n"),
  );
  const files = ["package.json", "pnpm-lock.yaml", "src/index.html", "src/sitemap.xml"];
  let inventoryCalls = 0;
  const reads = new Map();

  const result = analyzeRepositorySurfaces({
    root,
    listFiles: () => {
      inventoryCalls += 1;
      return files;
    },
    readFile: (absolutePath) => {
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      reads.set(relativePath, (reads.get(relativePath) ?? 0) + 1);
      return readFileSync(absolutePath, "utf8");
    },
  });

  assert.equal(result.webSummary.hasWebSurface, true);
  assert.equal(inventoryCalls, 1);
  assert.equal(reads.get("package.json"), 1);
  assert.equal(reads.get("src/index.html"), 1);
  assert.ok([...reads.values()].every((count) => count === 1));
});

test("stack detection reads a stable bounded prefix instead of the complete active file", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "surface-prefix-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const maximum = 512 * 1024;
  write(root, "src/large.js", Buffer.alloc(maximum + 128 * 1024, 65));

  const prefix = readStableRepositoryPrefixText({
    repositoryRoot: root,
    relativePath: "src/large.js",
    maxBytes: maximum,
  });
  assert.equal(prefix.bytes, maximum);
  assert.equal(prefix.fileBytes, maximum + 128 * 1024);
  assert.equal(prefix.truncated, true);

  const snapshot = createSurfaceSnapshot({ root, files: ["src/large.js"] });
  assert.equal(
    snapshot.readSource(path.join(root, "src", "large.js"), { prefixOnly: true }).length,
    maximum,
  );
  assert.equal(snapshot.cache.get("src/large.js").full, undefined);
});

test("responsive verification covers mobile, tablet, desktop, input, zoom, and viewport hazards", () => {
  const unsafe = responsiveFailures({
    hasWebSurface: true,
    files: [
      {
        content:
          '<html><head><meta name="viewport" content="width=device-width,user-scalable=no"></head></html>\n<script>const mobile = /mobile|ipad/i.test(navigator.userAgent)</script>',
        extension: ".html",
        relativePath: "src/index.html",
      },
      {
        content:
          "body { width: 960px; overflow-x: hidden; height: 100vh }\n.toolbar { display: flex }\nbutton { min-height: 24px }\n@media (device-width: 768px) {}",
        extension: ".css",
        relativePath: "src/app.css",
      },
    ],
  });
  const message = unsafe.join("\n");
  assert.match(message, /must not disable user zoom/);
  assert.match(message, /user-agent device classes/);
  assert.match(message, /without content-driven responsive evidence/);
  assert.match(message, /fixed 960px width/);
  assert.match(message, /rather than hidden/);
  assert.match(message, /dynamic mobile browser/);
  assert.match(message, /physical device dimensions/);
  assert.match(message, /touch-usable target/);

  assert.deepEqual(
    responsiveFailures({
      hasWebSurface: true,
      files: [
        {
          content:
            '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head></html>',
          extension: ".html",
          relativePath: "src/index.html",
        },
        {
          content:
            ".layout { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); gap: clamp(.5rem, 2vw, 2rem) }\n.toolbar { display: flex; flex-wrap: wrap }\nbutton { min-height: 44px }",
          extension: ".css",
          relativePath: "src/app.css",
        },
      ],
    }),
    [],
  );
});
