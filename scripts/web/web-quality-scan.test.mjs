/** Verifies web quality scan behavior for the public web quality boundary. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { detectStacks } from "../stack/stack-detector.mjs";
import { collectSitemapLastmodFreshnessFailures, seoFailures } from "../verify/seo.mjs";
import { isIso8601Timestamp } from "./sitemap-metadata.mjs";
import {
  failMessage,
  isProductWebSource,
  isWebCandidate,
  webSurfaceSummary,
} from "./web-quality-scan.mjs";

const productLayout = {
  findings: [],
  sourceRoots: ["apps/web/src", "src"],
  units: [
    { root: ".", sourceRoots: ["src"], surfaceRoot: "src", kind: "default" },
    {
      root: "apps/web",
      sourceRoots: ["apps/web/src"],
      surfaceRoot: "apps/web",
      kind: "workspace",
    },
  ],
};

function staticPageSeoFailures(
  sourceRoot,
  metadata,
  title = "<title>Public project guide</title>",
) {
  const content = `<html><head>${title}${metadata}</head></html>`;
  const relativePaths = ["src/index.html"];
  const stackResult = detectStacks({
    root: sourceRoot,
    relativePaths,
    readSource: () => content,
    productLayout,
  });
  const summary = webSurfaceSummary({
    sourceRoot,
    relativePaths,
    stackResult,
    readText: () => content,
    productLayout,
  });
  assert.equal(summary.hasWebSurface, true);
  assert.equal(summary.htmlLikeFiles[0].productSourceRoot, "src");
  return seoFailures(summary);
}

test("static-page metadata uses complete attributes independently of their order", (t) => {
  const sourceRoot = mkdtempSync(path.join(os.tmpdir(), "web-metadata-"));
  t.after(() => rmSync(sourceRoot, { recursive: true, force: true }));
  const failures = (metadata) => staticPageSeoFailures(sourceRoot, metadata);
  const baseline = failures("");
  assert.equal(baseline.length, 3);
  for (const fake of [
    '<meta data-name="robots" content="noindex">',
    '<meta data-hint=\'name="robots"\' content="noindex">',
    '<meta-data name="robots" content="noindex">',
  ])
    assert.deepEqual(failures(fake), baseline, fake);
  assert.deepEqual(failures('<meta content="noindex" name="robots">'), []);
  const description = "A useful description of this public project guide.";
  for (const tag of [
    `<meta name="description" content="${description}">`,
    `<meta content="${description}" name="description">`,
    `<meta CONTENT='${description}' NAME=description>`,
  ])
    assert.equal(
      failures(tag).some((failure) => failure.includes("meta description")),
      false,
      tag,
    );
  assert.ok(
    failures(`<meta data-name="description" content="${description}">`).some((failure) =>
      failure.includes("meta description"),
    ),
  );
  assert.ok(
    failures('<link data-rel="canonical" href="https://example.com/">').some((failure) =>
      failure.includes("canonical link"),
    ),
  );
  assert.equal(
    failures('<link href="https://example.com/" rel="canonical">').some((failure) =>
      failure.includes("canonical link"),
    ),
    false,
  );
});

test("static-page metadata ignores tag literals in attributes and raw text", (t) => {
  const sourceRoot = mkdtempSync(path.join(os.tmpdir(), "web-metadata-literals-"));
  t.after(() => rmSync(sourceRoot, { recursive: true, force: true }));
  const failures = (metadata) => staticPageSeoFailures(sourceRoot, metadata);
  const baseline = failures("");
  const literals =
    '<meta name="robots" content="noindex"><meta name="description" content="An example description, not actual page metadata."><link rel="canonical" href="https://example.com/literal">';
  const actual =
    '<meta CONTENT="A useful description of the public project guide." NAME=description><link HREF=https://example.com/ REL=canonical>';
  const actualFailures = failures(actual);
  assert.equal(actualFailures.length, 1, "Only the missing sitemap remains.");
  for (const example of [
    `<div data-example='${literals}'></div>`,
    `<div data-example="${literals.replaceAll('"', "'")}"></div>`,
    `<script>const example = '${literals}';</script>`,
    `<SCRIPT type=module>const example = '${literals}';</scripture>${literals}</sCrIpT >`,
    `<style>body::before { content: '${literals}'; }</style>`,
    `<textarea>${literals}</textarea>`,
    `<!--${literals}-->`,
  ]) {
    assert.deepEqual(failures(example), baseline, example);
    assert.deepEqual(failures(example + actual), actualFailures, example);
    assert.deepEqual(failures(example + "<meta NAME=robots CONTENT=noindex>"), [], example);
  }
  for (const incomplete of [`<div data-example='${literals}`, `<script>${literals}`])
    assert.deepEqual(failures(incomplete), baseline, incomplete);
  assert.deepEqual(
    failures(`<meta name="example" content="<!--">${actual}<!-- actual comment -->`),
    actualFailures,
  );

  assert.deepEqual(
    seoFailures({
      hasWebSurface: true,
      htmlLikeFiles: [
        {
          extension: ".tsx",
          relativePath: "src/app/layout.tsx",
          content: 'export const metadata = { title: "Public project guide" };',
        },
      ],
    }),
    [],
    "Framework metadata remains an explicit exemption.",
  );
});

test("static HTML literals cannot supply a title or a framework metadata exemption", (t) => {
  const sourceRoot = mkdtempSync(path.join(os.tmpdir(), "web-title-literals-"));
  t.after(() => rmSync(sourceRoot, { recursive: true, force: true }));
  const baseline = staticPageSeoFailures(sourceRoot, "");
  for (const literal of [
    '<script>const example = "export const metadata = {}";</script>',
    '<div data-example="export const metadata = {}"></div>',
    '<script>const example = "generateMetadata()";</script>',
    "<!-- export const metadata = {} -->",
  ])
    assert.deepEqual(staticPageSeoFailures(sourceRoot, literal), baseline, literal);

  const noindex = '<meta name="robots" content="noindex">';
  const missingTitle = staticPageSeoFailures(sourceRoot, noindex, "");
  assert.equal(missingTitle.length, 1);
  assert.match(missingTitle[0], /document shell must define a title/);
  for (const literal of [
    '<script>const example = "<title>Example title</title>";</script>',
    '<div data-example="<title>Example title</title>"></div>',
    "<textarea><title>Example title</title></textarea>",
    "<!-- <title>Example title</title> -->",
  ]) {
    assert.deepEqual(staticPageSeoFailures(sourceRoot, noindex, literal), missingTitle, literal);
    assert.deepEqual(
      staticPageSeoFailures(sourceRoot, noindex, literal + "<title>Actual project guide</title>"),
      [],
      literal,
    );
  }
  for (const title of ["<title></title>", "<title> Untitled </title>"])
    assert.match(staticPageSeoFailures(sourceRoot, noindex, title)[0], /title must be descriptive/);
});

test("framework metadata exemptions require real value exports in parsed JSX or TSX", () => {
  const layout = "export default function Layout() { return <html><body /></html>; }";
  const failures = (content, extension = ".tsx") =>
    seoFailures({
      hasWebSurface: true,
      htmlLikeFiles: [{ extension, relativePath: `src/app/layout${extension}`, content }],
    });
  const baseline = failures(layout);
  assert.equal(baseline.length, 3);
  for (const declaration of [
    'export const metadata = { title: "Guide" };',
    'export async function generateMetadata() { return { title: "Guide" }; }',
    'export const generateMetadata = async () => ({ title: "Guide" });',
    'const pageMetadata = { title: "Guide" }; export { pageMetadata as metadata };',
    "function pageMetadata() { return {}; } export { pageMetadata as generateMetadata };",
    'export { metadata } from "./shared-metadata";',
  ])
    for (const extension of [".jsx", ".tsx"])
      assert.deepEqual(failures(`${declaration}\n${layout}`, extension), [], declaration);
  assert.deepEqual(
    failures(`export const metadata: Metadata = { title: "Guide" };\n${layout}`),
    [],
  );
  for (const literal of [
    'const example = "export const metadata = {}";',
    "const example = `export const metadata = {}`;",
    "/* export const metadata = {} */",
    'const example = <div data-example="export const metadata = {}" />;',
    'const metadata = { title: "Guide" };',
    "function generateMetadata() { return {}; } generateMetadata();",
    'export type { metadata } from "./shared-types";',
    'const example = "<title>Literal project title</title>";',
    "const example = `<title>Literal project title</title>`;",
    "/* <title>Literal project title</title> */",
    "export const metadata = ;",
  ])
    assert.deepEqual(failures(`${literal}\n${layout}`), baseline, literal);
  const actualHead = '<title>Public project guide</title><meta name="robots" content="noindex" />';
  assert.deepEqual(failures(`export default () => <html><head>${actualHead}</head></html>;`), []);
  assert.deepEqual(
    failures(`export default () => <html><head>{<>${actualHead}</>}</head></html>;`),
    [],
  );
  assert.deepEqual(
    failures(
      `export default () => <html><head>{"<title>Literal project title</title>"}</head></html>;`,
    ),
    baseline,
  );
  assert.equal(
    seoFailures({
      hasWebSurface: true,
      htmlLikeFiles: [
        {
          extension: ".tsx",
          relativePath: "src/document.tsx",
          content: `export const metadata = ;\n${layout}`,
        },
      ],
    }).length,
    3,
    "Unparseable document source must retain its missing metadata checks.",
  );
});

test("parsed JSX self-closing raw-text elements preserve following metadata without changing HTML", () => {
  const failures = (content, extension) =>
    seoFailures({
      hasWebSurface: true,
      htmlLikeFiles: [{ extension, relativePath: `src/app/layout${extension}`, content }],
    });
  const title = "<title>Actual public guide</title>";
  const noindex = '<meta name="robots" content="noindex" />';
  const indexable =
    '<meta name="description" content="A useful description of the actual public guide." />' +
    '<link rel="canonical" href="https://example.com/" />';
  const html = (head) => `<html><head>${head}</head><body /></html>`;
  for (const tag of ["script", "style"]) {
    const selfClosing = `<${tag} src="/site.js" />`;
    const paired = `<${tag} src="/site.js"></${tag}>`;
    for (const extension of [".jsx", ".tsx"]) {
      for (const metadata of [noindex, indexable]) {
        const source = `const example = "🧭 <${tag} />"; export default () => `;
        assert.deepEqual(
          failures(`${source}${html(selfClosing + title + metadata)};`, extension),
          [],
          `${extension}: self-closing ${tag}`,
        );
        assert.deepEqual(
          failures(`${source}${html(paired + title + metadata)};`, extension),
          [],
          `${extension}: paired ${tag}`,
        );
      }
    }
    assert.equal(
      failures(html(selfClosing + title + noindex), ".html").length,
      3,
      `HTML ${tag} stays raw text until its actual closing tag.`,
    );
    assert.deepEqual(failures(html(paired + title + noindex), ".html"), []);
    assert.deepEqual(
      failures(
        html(`${selfClosing}<title>Literal title</title></${tag}>${title}${noindex}`),
        ".html",
      ),
      [],
    );
  }
  const emptyTitle = failures(
    `export default () => ${html("<title />" + title + noindex)};`,
    ".tsx",
  );
  assert.equal(emptyTitle.length, 1);
  assert.match(emptyTitle[0], /title must be descriptive/);
});

test("Astro and MDX distinguish page markup and value exports from source examples", () => {
  const failures = (content, extension, relativePath = `src/pages/index${extension}`) =>
    seoFailures({
      hasWebSurface: true,
      htmlLikeFiles: [{ extension, relativePath, content }],
    });
  const empty = "<html><head></head><body /></html>";
  const title = "<title>Actual public guide</title>";
  const noindex = '<meta name="robots" content="noindex" />';
  const actual = `<html><head>${title}${noindex}</head><body /></html>`;
  const example = `${title}${noindex}`;
  const frontmatter = `---\nconst example = '${example}';\n---\n`;
  assert.equal(failures(frontmatter + empty, ".astro").length, 3);
  assert.deepEqual(failures(frontmatter + actual, ".astro"), []);
  for (const declaration of [
    'export const metadata = { title: "Public guide", description: "A useful public guide description" };',
    'export const metadata = {\n\n  title: "Public guide",\n  description: "A useful public guide description"\n};',
    'export async function generateMetadata() {\n\n return { title: "Public guide" };\n}',
    'import pageMetadata from "./metadata";\n\nexport { pageMetadata as metadata };',
  ])
    assert.deepEqual(failures(`${declaration}\n\n${empty}`, ".mdx"), [], declaration);
  for (const sample of [
    `\`\`\`html\n${example}\n\`\`\`\n\n`,
    `\`\`\`js\nexport const metadata = {};\n\`\`\`\n\n`,
    `Inline \`${example}\`\n\n`,
    `    ${example}\n\n`,
  ]) {
    assert.equal(failures(sample + empty, ".mdx").length, 3, sample);
    assert.deepEqual(failures(sample + actual, ".mdx"), [], sample);
  }
  assert.deepEqual(
    failures(`\`\`\`html\n${empty}\n\`\`\`\n\n<Component />`, ".mdx"),
    [],
    "An HTML example does not turn a component into a document shell.",
  );
  for (const prose of [
    "> Public guide note.\n\n",
    "> Public guide <em>note</em>.\n\n",
    "> Public <em>one\n> two</em>.\n\n",
    "- Public guide <em>note</em>.\n\n",
    "> - Public guide <em>note</em>.\n\n",
    "2 > 1 <em>note</em>.\n\n",
    "# Public guide\n\n2 > 1\n\n",
    "Escaped \\<html> example\n\n",
  ]) {
    assert.deepEqual(failures(prose + actual, ".mdx"), [], prose);
    assert.deepEqual(failures(prose + "<Component />", ".mdx"), [], prose);
  }
  assert.deepEqual(failures(`export default function Layout() { return ${actual}; }`, ".mdx"), []);
  assert.deepEqual(failures(`<html>\n\n${title}${noindex}\n\n</html>`, ".mdx"), []);
  for (const invalidTitle of ["<title></title>", "<title>Untitled</title>"]) {
    const result = failures(`<html>\n\n${invalidTitle}${noindex}\n\n</html>`, ".mdx");
    assert.equal(result.length, 1);
    assert.match(result[0], /title must be descriptive/);
  }
  assert.deepEqual(
    failures(`> <html>\n> <head>${title}${noindex}</head>\n> </html>`, ".mdx"),
    [],
    "Container syntax must not erase real multiline markup or its title text.",
  );
  const expressionNote = `> 🧭 Public <em>{${JSON.stringify(example)}}</em> note.\n\n`;
  assert.equal(failures(expressionNote + empty, ".mdx").length, 3);
  assert.deepEqual(
    failures(expressionNote + `<html><head><script />${title}${noindex}</head></html>`, ".mdx"),
    [],
    "Container projection preserves JSX literals and exact self-closing offsets.",
  );
  const mixedExpression = `2 > 1 <em>{${JSON.stringify(example)}}</em>.\n\n`;
  assert.equal(failures(mixedExpression + empty, ".mdx").length, 3);
  assert.deepEqual(failures(mixedExpression + actual, ".mdx"), []);
  assert.equal(
    failures(`2 > 1 {${JSON.stringify("} " + example + " {")}}.\n\n${empty}`, ".mdx").length,
    3,
  );
  assert.deepEqual(failures(`2 > 1 {ready && ${actual}}.`, ".mdx"), []);
  assert.equal(failures(`2 > 1 {ready && ${empty}}.`, ".mdx").length, 3);
  assert.deepEqual(
    failures(`2 > 1 {${JSON.stringify("<html>" + example + "</html>")}}.\n\n<Component />`, ".mdx"),
    [],
    "An expression string cannot establish a document shell.",
  );
  assert.deepEqual(failures(`<Broken>\n\n${actual}`, ".mdx"), []);
  assert.deepEqual(failures(`{ "unterminated <title>Fake</title>\n\n${actual}`, ".mdx"), []);
  assert.equal(failures("<html><head><title>Unclosed", ".mdx").length, 3);
  assert.deepEqual(
    failures(`<html>\n\n${title}\n\n${noindex}\n\n</html>`, ".mdx"),
    [],
    "Separate source blocks can form one document without parsing unrelated prose.",
  );
  for (const actualTitle of ["", "Untitled", "Actual public guide"])
    assert.equal(
      failures(`2 > 1 <title>${actualTitle}</title>.\n\n<html>${noindex}</html>`, ".mdx").length,
      actualTitle === "Actual public guide" ? 0 : 1,
      "Original title text survives the syntax-only copy.",
    );
  assert.deepEqual(
    failures(
      `export default () => <html><head>${title}${noindex}</head><body>{ok ? "yes" : "no"}</body></html>`,
      ".mdx",
    ),
    [],
  );
  assert.equal(failures('<html lang={locale ? "en" : "de"}><head /></html>', ".mdx").length, 3);
  assert.deepEqual(failures((expressionNote + actual).replaceAll("\n", "\r\n"), ".mdx"), []);
  assert.equal(
    failures(`export const example = "export const metadata = {}";\n\n${empty}`, ".mdx").length,
    3,
  );
  for (const tag of ["script", "style"])
    assert.deepEqual(
      failures(`<html><head><${tag} />${title}${noindex}</head></html>`, ".mdx"),
      [],
    );
  for (const extension of [".vue", ".svelte"]) {
    const script = `<script>const example = '${example}';</script>`;
    assert.equal(failures(script + empty, extension).length, 3);
    assert.deepEqual(failures(script + actual, extension), []);
  }
});

test("web candidates follow declared product roots", () => {
  for (const relativePath of [
    "src/App.tsx",
    "apps/web/src/index.html",
    "apps/web/public/page.html",
  ]) {
    assert.equal(isProductWebSource(relativePath, productLayout), true, relativePath);
  }
  for (const relativePath of [
    "web/index.html",
    "modules/catalog/view.vue",
    "examples/site/page.svelte",
  ]) {
    assert.equal(isProductWebSource(relativePath, productLayout), false, relativePath);
  }
});

test("framework automation and non-web files are not product web sources", () => {
  assert.equal(isProductWebSource("scripts/verify/fixture.ts", productLayout), false);
  assert.equal(isProductWebSource("docs/example.html", productLayout), false);
  assert.equal(isWebCandidate("src/service.py"), false);
});

test("repeated findings use indexed line lookup for large context carriers", () => {
  const file = {
    relativePath: "site/archive.html",
    content: `${"x".repeat(600_000)}\n<section>\n<img>`,
  };
  assert.equal(failMessage(file, "first", 500_000), "site/archive.html:1: first");
  assert.equal(
    failMessage(file, "second", file.content.indexOf("<img>")),
    "site/archive.html:3: second",
  );
});

test("sitemap timestamps reject incomplete and impossible calendar values", () => {
  assert.equal(isIso8601Timestamp("2026-07-08T16:29:57+00:00"), true);
  assert.equal(isIso8601Timestamp("2026-07-08"), false);
  assert.equal(isIso8601Timestamp("2026-02-31T00:00:00+00:00"), false);
});

test("changed static pages require an advancing sitemap lastmod", () => {
  const canonical = "https://example.com/";
  const pages = [{ file: { relativePath: "apps/web/index.html" }, canonical }];
  const stale = collectSitemapLastmodFreshnessFailures({
    changedHtmlRelativePaths: new Set(["apps/web/index.html"]),
    currentEntries: [{ loc: canonical, lastmod: "2026-07-08T16:29:57+00:00" }],
    previousEntries: [{ loc: canonical, lastmod: "2026-07-08T16:29:57+00:00" }],
    pages,
  });
  assert.ok(stale.some((failure) => failure.includes("must advance")));

  const advanced = collectSitemapLastmodFreshnessFailures({
    changedHtmlRelativePaths: new Set(["apps/web/index.html"]),
    currentEntries: [{ loc: canonical, lastmod: "2026-07-08T16:30:57+00:00" }],
    previousEntries: [{ loc: canonical, lastmod: "2026-07-08T16:29:57+00:00" }],
    pages,
  });
  assert.deepEqual(advanced, []);
});
