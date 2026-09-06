/** Verifies path hygiene behavior for the repository verification boundary. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  activePathMarkerFindings,
  createPathMarkerScanner,
  neutralProductSourceFindings,
  productSourceBoundaryFindings,
  surfaceIsolationFindings,
} from "./path-hygiene.mjs";

test("path marker scanning is extension-independent and chunk-safe", () => {
  const scanner = createPathMarkerScanner(["private/workspace/project"]);
  scanner.write(Buffer.from("binary-prefix\0private/work"));
  scanner.write(Buffer.from("space/project\0suffix"));
  assert.deepEqual(scanner.matches(), ["private/workspace/project"]);
});

test("full active-source scan includes extension-neutral nested source", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "path-hygiene-nested-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const nested = path.join(root, "docs", "reference");
  mkdirSync(nested, { recursive: true });
  writeFileSync(
    path.join(nested, "example.py"),
    "workspace = '/private/workspace/project'\n",
    "utf8",
  );
  assert.deepEqual(
    activePathMarkerFindings({
      markers: ["private/workspace/project"],
      repositoryRoot: root,
    }),
    ['docs/reference/example.py: contains local path marker "private/workspace/project"'],
  );
});

test("default Product Root permits product files and the neutral placeholder", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "product-source-clean-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  mkdirSync(path.join(root, "src", "domain"), { recursive: true });
  writeFileSync(path.join(root, "src", ".gitkeep"), "", "utf8");
  writeFileSync(path.join(root, "src", "domain", "model.ts"), "export const model = true;\n");

  assert.deepEqual(productSourceBoundaryFindings({ repositoryRoot: root }), []);
  assert.deepEqual(neutralProductSourceFindings({ repositoryRoot: root }), [
    "src: neutral framework must contain only the .gitkeep placeholder",
  ]);
});

test("neutral product source accepts only an empty real placeholder", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "neutral-product-source-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "src", ".gitkeep"), "");
  assert.deepEqual(neutralProductSourceFindings({ repositoryRoot: root }), []);

  writeFileSync(path.join(root, "src", ".gitkeep"), "not empty\n");
  assert.deepEqual(neutralProductSourceFindings({ repositoryRoot: root }), [
    "src/.gitkeep: neutral framework placeholder must be a real empty file",
  ]);
});

test("default Product Root rejects missing, redirected, and nested agent state", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "product-source-polluted-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  assert.deepEqual(productSourceBoundaryFindings({ repositoryRoot: root }), [
    "src: required default product root is missing",
  ]);

  const outside = path.join(root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, path.join(root, "src"));
  assert.deepEqual(productSourceBoundaryFindings({ repositoryRoot: root }), [
    "src: default product root must be a real directory",
  ]);
  rmSync(path.join(root, "src"));

  mkdirSync(path.join(root, "src", "nested", ".agents", "skills"), { recursive: true });
  mkdirSync(path.join(root, "src", ".codex"), { recursive: true });
  writeFileSync(path.join(root, "src", "nested", "AGENTS.md"), "agent instructions\n");
  assert.deepEqual(productSourceBoundaryFindings({ repositoryRoot: root }), [
    "src/.codex: agent-only path is forbidden inside product unit src",
    "src/nested/.agents: agent-only path is forbidden inside product unit src",
    "src/nested/AGENTS.md: agent instruction path is forbidden inside product unit src",
  ]);
});

test("declared workspace and Android units reject nested agent state", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "product-units-polluted-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "src", ".gitkeep"), "");
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  mkdirSync(path.join(root, "apps", "web", "src"), { recursive: true });
  writeFileSync(path.join(root, "apps", "web", "package.json"), '{"name":"web"}\n');
  mkdirSync(path.join(root, "apps", "web", ".codex"));
  writeFileSync(path.join(root, "settings.gradle.kts"), 'include(":app")\n');
  mkdirSync(path.join(root, "app", "src", "main"), { recursive: true });
  writeFileSync(path.join(root, "app", "build.gradle.kts"), "plugins {}\n");
  writeFileSync(path.join(root, "app", "src", "main", "AndroidManifest.xml"), "<manifest />\n");
  mkdirSync(path.join(root, "app", ".agents"));

  assert.deepEqual(productSourceBoundaryFindings({ repositoryRoot: root }), [
    "app/.agents: agent-only path is forbidden inside product unit app",
    "apps/web/.codex: agent-only path is forbidden inside product unit apps/web",
  ]);
});

test("surface isolation accepts explicit independent surface and concern roots", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "surface-isolation-clean-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  mkdirSync(path.join(root, "src", "interfaces", "web", "routes"), { recursive: true });
  mkdirSync(path.join(root, "src", "interfaces", "mobile", "screens"), { recursive: true });
  mkdirSync(path.join(root, "src", "domains", "orders"), { recursive: true });
  writeFileSync(
    path.join(root, "src", "interfaces", "web", "routes", "home.tsx"),
    'import "react-dom/client";\nexport const home = true;\n',
  );
  writeFileSync(
    path.join(root, "src", "interfaces", "mobile", "screens", "home.tsx"),
    'import "react-native";\nexport const home = true;\n',
  );
  writeFileSync(
    path.join(root, "src", "domains", "orders", "public.ts"),
    "export const orders = true;\n",
  );

  assert.deepEqual(surfaceIsolationFindings({ repositoryRoot: root }), []);
});

test("surface isolation rejects mixed roots, platform leakage, and cross-surface imports", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "surface-isolation-unsafe-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  mkdirSync(path.join(root, "src", "interfaces", "web", "routes"), { recursive: true });
  mkdirSync(path.join(root, "src", "interfaces", "mobile", "screens"), { recursive: true });
  mkdirSync(path.join(root, "src", "domains", "orders"), { recursive: true });
  mkdirSync(path.join(root, "src", "shared"), { recursive: true });
  writeFileSync(path.join(root, "src", "web.ts"), "export const web = true;\n");
  writeFileSync(
    path.join(root, "src", "interfaces", "web", "app.tsx"),
    "export const app = true;\n",
  );
  writeFileSync(
    path.join(root, "src", "interfaces", "web", "routes", "home.tsx"),
    'import "../../mobile/screens/home";\n',
  );
  writeFileSync(
    path.join(root, "src", "interfaces", "web", "routes", "concatenated.ts"),
    'export const mobile = import.meta.resolve?.("../../mobile/" + "screens/home");\n',
  );
  writeFileSync(
    path.join(root, "src", "interfaces", "mobile", "screens", "home.tsx"),
    "export const home = true;\n",
  );
  writeFileSync(
    path.join(root, "src", "domains", "orders", "service.ts"),
    'import "../../interfaces/web/routes/home";\n',
  );
  writeFileSync(path.join(root, "src", "shared", "native.ts"), 'import "react-native";\n');

  assert.deepEqual(surfaceIsolationFindings({ repositoryRoot: root }), [
    "src/domains/orders/service.ts: domain, application, and shared code must not import the web surface ../../interfaces/web/routes/home",
    "src/interfaces/web/app.tsx: web UI implementation must live in an explicit views/screens, components, state, navigation, client/adapter, assets/styles, composition/entry, or public concern directory",
    "src/interfaces/web/routes/concatenated.ts: the web surface must not import the separately owned mobile surface ../../mobile/screens/home; move shared behavior behind an application/domain contract or explicit shared presentation boundary",
    "src/interfaces/web/routes/home.tsx: the web surface must not import the separately owned mobile surface ../../mobile/screens/home; move shared behavior behind an application/domain contract or explicit shared presentation boundary",
    "src/shared/native.ts: platform dependency react-native belongs only inside an explicit mobile surface root",
    "src/web.ts: a product surface needs a dedicated directory or declared product package instead of a Product Root-level file",
  ]);
});

test("surface isolation resolves aliases and workspace package imports", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "surface-isolation-import-resolution-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  mkdirSync(path.join(root, "src", "interfaces", "web", "routes"), { recursive: true });
  mkdirSync(path.join(root, "src", "interfaces", "mobile", "screens"), { recursive: true });
  mkdirSync(path.join(root, "src", "domains", "orders"), { recursive: true });
  mkdirSync(path.join(root, "packages", "web", "src", "routes"), { recursive: true });
  writeFileSync(
    path.join(root, "tsconfig.base.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
  );
  writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({ extends: "./tsconfig.base" }));
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
  writeFileSync(
    path.join(root, "packages", "web", "package.json"),
    JSON.stringify({
      name: "@product/web",
      exports: { "./home": { browser: "./src/routes/home.tsx" } },
    }),
  );
  writeFileSync(
    path.join(root, "packages", "web", "src", "routes", "home.tsx"),
    "export const home = true;\n",
  );
  writeFileSync(
    path.join(root, "src", "interfaces", "web", "routes", "home.tsx"),
    'import "@/interfaces/mobile/screens/home";\n',
  );
  writeFileSync(
    path.join(root, "src", "interfaces", "mobile", "screens", "home.tsx"),
    "export const home = true;\n",
  );
  writeFileSync(
    path.join(root, "src", "domains", "orders", "service.ts"),
    'import "@product/web/home";\n',
  );

  const findings = surfaceIsolationFindings({ repositoryRoot: root });
  assert.ok(
    findings.some(
      (finding) =>
        finding.includes("src/interfaces/web/routes/home.tsx") &&
        finding.includes("separately owned mobile surface"),
    ),
  );
  assert.ok(
    findings.some(
      (finding) =>
        finding.includes("src/domains/orders/service.ts") &&
        finding.includes("must not import the web surface"),
    ),
  );
});

test("surface isolation resolves baseUrl-only and non-JavaScript imports", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "surface-isolation-language-resolution-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  mkdirSync(path.join(root, "src", "interfaces", "web", "routes"), { recursive: true });
  mkdirSync(path.join(root, "src", "interfaces", "mobile", "screens"), { recursive: true });
  mkdirSync(path.join(root, "src", "domains", "orders"), { recursive: true });
  mkdirSync(path.join(root, "src", "domains", "interfaces", "web", "routes"), {
    recursive: true,
  });
  mkdirSync(path.join(root, "src", "Interfaces", "Desktop", "Views"), { recursive: true });
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: "src" } }),
  );
  writeFileSync(
    path.join(root, "src", "interfaces", "web", "routes", "home.tsx"),
    'import "interfaces/mobile/screens/home";\n',
  );
  writeFileSync(
    path.join(root, "src", "interfaces", "mobile", "screens", "home.tsx"),
    "export const home = true;\n",
  );
  writeFileSync(
    path.join(root, "src", "domains", "orders", "service.py"),
    "from interfaces.web.routes import home\n",
  );
  writeFileSync(
    path.join(root, "src", "domains", "orders", "service.rs"),
    'include!("../../interfaces/web/routes/home.rs");\n',
  );
  writeFileSync(
    path.join(root, "src", "domains", "orders", "service.kt"),
    "import interfaces.`web`.routes.Home\n",
  );
  writeFileSync(
    path.join(root, "src", "domains", "orders", "service.php"),
    "<?php require_once dirname(__DIR__) . '/interfaces/web/routes/home.php';\n",
  );
  writeFileSync(
    path.join(root, "src", "interfaces", "web", "routes", "home.rs"),
    "pub struct Home;\n",
  );
  writeFileSync(
    path.join(root, "src", "interfaces", "web", "routes", "Home.kt"),
    "package interfaces.web.routes\n",
  );
  writeFileSync(
    path.join(root, "src", "domains", "interfaces", "web", "routes", "home.php"),
    "<?php final class Home {}\n",
  );
  writeFileSync(
    path.join(root, "src", "Interfaces", "Desktop", "Views", "Home.cs"),
    "global using MobileScreens = Product.interfaces.mobile.screens;\n",
  );

  const findings = surfaceIsolationFindings({ repositoryRoot: root });
  assert.ok(
    findings.some(
      (finding) =>
        finding.includes("src/interfaces/web/routes/home.tsx") &&
        finding.includes("separately owned mobile surface"),
    ),
  );
  assert.ok(
    findings.some(
      (finding) =>
        finding.includes("src/domains/orders/service.py") &&
        finding.includes("must not import the web surface"),
    ),
  );
  assert.ok(
    findings.some(
      (finding) =>
        finding.includes("src/domains/orders/service.rs") &&
        finding.includes("must not import the web surface"),
    ),
  );
  assert.ok(
    findings.some(
      (finding) =>
        finding.includes("src/domains/orders/service.kt") &&
        finding.includes("must not import the web surface"),
    ),
  );
  assert.ok(
    findings.some(
      (finding) =>
        finding.includes("src/Interfaces/Desktop/Views/Home.cs") &&
        finding.includes("separately owned mobile surface"),
    ),
  );
});

test("surface isolation inspects embedded Vue, Svelte, Astro, and HTML scripts", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "surface-isolation-embedded-scripts-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  mkdirSync(path.join(root, "src", "interfaces", "web", "routes"), { recursive: true });
  mkdirSync(path.join(root, "src", "interfaces", "mobile", "screens"), { recursive: true });
  writeFileSync(
    path.join(root, "src", "interfaces", "mobile", "screens", "home.tsx"),
    "export const home = true;\n",
  );
  const embeddedFiles = {
    "Home.astro": "---\nawait import(`../../mobile/screens/home`);\n---\n<main />\n",
    "Home.html": '<script type="module">import "../../mobile/screens/home";</script>\n',
    "Home.svelte":
      '<script>import(/* webpackChunkName: "mobile" */ "../../mobile/screens/home");</script>\n<main />\n',
    "Home.vue":
      '<script setup>import("../../mobile/screens/home", { with: { type: "json" } });</script>\n<template />\n',
  };
  for (const [basename, content] of Object.entries(embeddedFiles)) {
    writeFileSync(path.join(root, "src", "interfaces", "web", "routes", basename), content);
  }

  const findings = surfaceIsolationFindings({ repositoryRoot: root });
  for (const basename of Object.keys(embeddedFiles)) {
    assert.ok(
      findings.some(
        (finding) =>
          finding.includes(`src/interfaces/web/routes/${basename}`) &&
          finding.includes("separately owned mobile surface"),
      ),
      basename,
    );
  }
});
