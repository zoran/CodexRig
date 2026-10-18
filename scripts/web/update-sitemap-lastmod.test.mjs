/** Verifies update sitemap lastmod behavior for the public web quality boundary. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { updateSitemapLastmod } from "./update-sitemap-lastmod.mjs";

function write(root, relativePath, content) {
  const target = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function page(canonical) {
  return `<html><head><link rel="canonical" href="${canonical}"></head></html>\n`;
}

function sitemap(canonical) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `<url><loc>${canonical}</loc><lastmod>2026-07-13T00:00:00+00:00</lastmod></url>`,
    "</urlset>",
  ].join("\n");
}

test("sitemap updates group pages by declared product source root", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "sitemap-product-roots-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  write(root, "pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n");
  write(root, "src/index.html", page("https://root.example/"));
  write(root, "src/sitemap.xml", sitemap("https://root.example/"));
  write(root, "apps/web/package.json", '{"name":"web"}\n');
  write(root, "apps/web/src/index.html", page("https://web.example/"));
  write(root, "apps/web/src/sitemap.xml", sitemap("https://web.example/"));
  write(root, "modules/ignored/index.html", page("https://ignored.example/"));
  const files = [
    "pnpm-workspace.yaml",
    "src/index.html",
    "src/sitemap.xml",
    "apps/web/package.json",
    "apps/web/src/index.html",
    "apps/web/src/sitemap.xml",
    "modules/ignored/index.html",
  ];

  const result = updateSitemapLastmod(
    {
      timestamp: "2026-07-14T12:00:00+00:00",
      changedFrom: "",
      check: false,
      paths: ["src/index.html", "apps/web/src/index.html"],
    },
    { repositoryRoot: root, files },
  );
  assert.deepEqual(result.sitemaps, ["apps/web/src/sitemap.xml", "src/sitemap.xml"]);
  assert.deepEqual(result.updatedUrls, ["https://root.example/", "https://web.example/"]);
  assert.match(
    readFileSync(path.join(root, "src/sitemap.xml"), "utf8"),
    /2026-07-14T12:00:00\+00:00/,
  );
  assert.match(
    readFileSync(path.join(root, "apps/web/src/sitemap.xml"), "utf8"),
    /2026-07-14T12:00:00\+00:00/,
  );

  assert.throws(
    () =>
      updateSitemapLastmod(
        {
          timestamp: "2026-07-14T12:00:00+00:00",
          changedFrom: "",
          check: true,
          paths: ["modules/ignored/index.html"],
        },
        { repositoryRoot: root, files },
      ),
    /outside every declared product source root/,
  );
});

test("sitemap updates ignore quoted and raw-text metadata literals", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "sitemap-metadata-literals-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const canonical = "https://example.com/";
  const files = ["src/index.html", "src/sitemap.xml"];
  const update = () =>
    updateSitemapLastmod(
      {
        timestamp: "2026-07-14T12:00:00+00:00",
        changedFrom: "",
        check: false,
        paths: ["src/index.html"],
      },
      { repositoryRoot: root, files },
    );
  const fakeCanonical = `<link rel="canonical" href="${canonical}">`;
  for (const wrap of [
    (literal) => `<div data-example='${literal}'></div>`,
    (literal) => `<script>const example = '${literal}';</script>`,
    (literal) => `<textarea>${literal}</textarea>`,
    (literal) => `<!--${literal}-->`,
  ]) {
    write(root, "src/sitemap.xml", sitemap(canonical));
    const literal = wrap('<meta name="robots" content="noindex">' + fakeCanonical);
    write(
      root,
      "src/index.html",
      `<html><head>${literal}<link HREF=${canonical} REL=canonical></head></html>`,
    );
    const result = update();
    assert.deepEqual(result.updatedUrls, [canonical], literal);
    assert.deepEqual(result.skippedPages, [], literal);
    assert.match(
      readFileSync(path.join(root, "src/sitemap.xml"), "utf8"),
      /2026-07-14T12:00:00\+00:00/,
    );

    write(root, "src/index.html", `<html><head>${wrap(fakeCanonical)}</head></html>`);
    assert.throws(update, /indexable but has no canonical link/);
    write(
      root,
      "src/index.html",
      `<html><head>${literal}<meta CONTENT=noindex NAME=robots></head></html>`,
    );
    assert.deepEqual(update().skippedPages, ["src/index.html"]);
  }
});

test("sitemap updates preserve real metadata after quoted comment delimiters", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "sitemap-comment-delimiters-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const canonical = "https://example.com/";
  write(root, "src/sitemap.xml", sitemap(canonical));
  const update = () =>
    updateSitemapLastmod(
      {
        timestamp: "2026-07-14T12:00:00+00:00",
        changedFrom: "",
        check: false,
        paths: ["src/index.html"],
      },
      { repositoryRoot: root, files: ["src/index.html", "src/sitemap.xml"] },
    );
  const page = (metadata) =>
    `<html><head><meta name="example" content="<!--">${metadata}<!-- actual comment --></head></html>`;
  write(root, "src/index.html", page(`<link rel="canonical" href="${canonical}">`));
  assert.deepEqual(update().updatedUrls, [canonical]);
  write(root, "src/index.html", page('<meta name="robots" content="noindex">'));
  assert.deepEqual(update().skippedPages, ["src/index.html"]);
});
