/** Owns seo behavior for the repository verification boundary. */
import { spawnSyncWithBoundedIo as spawnSync } from "../repository/runtime-process-io.mjs";
import { cleanGitEnvironment } from "../repository/git-runtime-isolation.mjs";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  failMessage,
  reportResult,
  root,
  stripHtmlComments,
  webSurfaceSummary,
} from "../web/web-quality-scan.mjs";
import { verifyRealDirectory, verifyRealFileInside } from "../web/sitemap-files.mjs";
import {
  canonicalUrlFromHtml,
  hasHtmlDocumentElement,
  hasRobotsNoindex,
  httpUrlOrigin,
  isIso8601Timestamp,
  metaContentsFromHtml,
  parseSitemapEntries,
  titleFromHtml,
} from "../web/sitemap-metadata.mjs";

export function seoFailures({ htmlLikeFiles, hasWebSurface, sourceRoot = root }) {
  const failures = [];
  const staticWebIndexingCandidates = [];
  const indexableStaticWebPages = [];
  if (!hasWebSurface) return failures;

  for (const file of htmlLikeFiles) {
    const {
      content,
      metadataExport,
      jsxSelfClosingStarts,
      documentContent = content,
    } = frameworkSourceContract(file, sourceRoot);
    const isHtmlOrAstroPage = [".astro", ".html"].includes(file.extension);
    const isLayoutFile = /(?:^|\/)(?:app|pages|routes)\/.*layout\.(?:jsx|tsx|svelte|vue)$/i.test(
      file.relativePath,
    );
    const isDocumentShell =
      hasHtmlDocumentElement(documentContent, jsxSelfClosingStarts) ||
      isHtmlOrAstroPage ||
      isLayoutFile;
    if (!isDocumentShell) continue;

    const robotsNoIndex = hasRobotsNoindex(content, jsxSelfClosingStarts);
    const titleMatch = titleFromHtml(content, jsxSelfClosingStarts);

    if (!titleMatch && !metadataExport) {
      failures.push(failMessage(file, "document shell must define a title or framework metadata"));
    } else if (titleMatch) {
      const title = titleMatch.text.replace(/\s+/g, " ").trim();
      if (!title || /^untitled$/i.test(title)) {
        failures.push(failMessage(file, "title must be descriptive", titleMatch.index));
      }
    }

    const hasDescription = metaContentsFromHtml(content, "description", jsxSelfClosingStarts).some(
      (description) => description.length >= 20,
    );
    if (!robotsNoIndex && !hasDescription && !metadataExport) {
      failures.push(
        failMessage(file, "indexable pages need a useful meta description or explicit noindex"),
      );
    }

    const canonical = canonicalUrlFromHtml(content, jsxSelfClosingStarts);
    if (!robotsNoIndex && !canonical && !metadataExport) {
      failures.push(
        failMessage(file, "indexable pages need a canonical link or framework metadata"),
      );
    }

    if (isStaticWebHtmlPage(file) && !robotsNoIndex && !metadataExport) {
      staticWebIndexingCandidates.push(file);
      if (canonical) {
        const canonicalOrigin = httpUrlOrigin(canonical);
        if (!canonicalOrigin) {
          failures.push(failMessage(file, "canonical link must be an absolute http(s) URL"));
        } else {
          indexableStaticWebPages.push({ file, canonical, canonicalOrigin });
        }
      }
    }

    if (
      /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal|\.local)\b/i.test(
        stripHtmlComments(file.content),
      )
    ) {
      failures.push(failMessage(file, "metadata must not expose local development hosts"));
    }
  }

  failures.push(
    ...collectSitemapFailures({
      sourceRoot,
      indexingCandidateFiles: staticWebIndexingCandidates,
      indexablePages: indexableStaticWebPages,
    }),
  );
  return failures;
}

/** Source declarations, rather than words inside HTML or JS examples, own framework metadata. */
function frameworkSourceContract(file, sourceRoot) {
  if (![".js", ".jsx", ".ts", ".tsx", ".astro", ".mdx"].includes(file.extension))
    return { content: file.content, metadataExport: false };
  try {
    const require = createRequire(path.join(sourceRoot, "package.json"));
    const parsers = require("prettier/plugins/babel").parsers;
    if ([".astro", ".mdx"].includes(file.extension)) {
      const markdownParser = require("prettier/plugins/markdown").parsers.markdown;
      const markdown = markdownParser.parse(file.content);
      if (file.extension === ".astro") {
        const frontmatter = markdown.children[0];
        return {
          content:
            frontmatter?.type === "frontMatter"
              ? maskSourceRanges(file.content, [
                  [frontmatter.position.start.offset, frontmatter.position.end.offset],
                ])
              : file.content,
          metadataExport: false,
        };
      }
      return projectMdxMarkup(file.content, markdown, parsers.babel);
    }
    const ast = parsers[/\.tsx?$/u.test(file.extension) ? "babel-ts" : "babel"].parse(file.content);
    const program = ast.program ?? ast;
    return {
      ...projectJsxMarkup(file.content, ast),
      metadataExport: hasMetadataValueExport(program),
    };
  } catch {
    // Unknown source cannot supply a proven title or metadata exemption.
    return { content: "", documentContent: file.content, metadataExport: false };
  }
}

/** Markdown supplies example boundaries; Babel proves ESM declarations and JSX identity. */
function projectMdxMarkup(content, markdown, parser) {
  const ranges = [];
  const statements = [];
  const jsxExports = [];
  for (let index = 0; index < markdown.children.length; index += 1) {
    const node = markdown.children[index];
    const start = node.position.start.offset;
    if (node.type !== "paragraph" || !/^(?:import|export)\s/u.test(content.slice(start))) continue;
    for (let last = index; last < markdown.children.length; last += 1) {
      const end = markdown.children[last].position.end.offset;
      let ast;
      try {
        ast = parser.parse(content.slice(start, end));
      } catch {
        continue;
      }
      const body = (ast.program ?? ast).body;
      if (
        !body.length ||
        body.some(
          (statement) =>
            !["ImportDeclaration", "ExportNamedDeclaration", "ExportDefaultDeclaration"].includes(
              statement.type,
            ),
        )
      )
        break;
      statements.push(...body);
      ranges.push([start, end]);
      const preserveJsx = (value) => {
        if (!value || typeof value !== "object") return;
        if (["JSXElement", "JSXFragment"].includes(value.type)) {
          jsxExports.push({
            start: start + value.start,
            end: start + value.end,
            content: content.slice(start + value.start, start + value.end),
          });
          return;
        }
        for (const child of Object.values(value))
          if (Array.isArray(child)) child.forEach(preserveJsx);
          else preserveJsx(child);
      };
      preserveJsx(ast);
      index = last;
      break;
    }
  }
  const regions = [];
  const collect = (node) => {
    const start = node.position.start.offset;
    const end = node.position.end.offset;
    if (
      ranges.some(([left, right]) => start < right && end > left) ||
      ["code", "inlineCode", "frontMatter"].includes(node.type)
    )
      return;
    if (node.type === "html" || ["paragraph", "heading"].includes(node.type)) {
      regions.push(mdxSourceRegion(content, node, parser));
      return;
    }
    node.children?.forEach(collect);
  };
  markdown.children.forEach(collect);
  let markup = blankSource(content);
  const jsxSelfClosingStarts = new Set();
  let uncertainDocument = false;
  for (let index = 0; index < regions.length; index += 1) {
    const start = regions[index].start;
    let syntax = "";
    let semantic = "";
    let cursor = start;
    let accepted = false;
    for (let last = index; last < regions.length; last += 1) {
      const region = regions[last];
      const gap = blankSource(content.slice(cursor, region.start));
      syntax += gap + region.syntax;
      semantic += gap + region.semantic;
      cursor = region.end;
      let ast;
      try {
        ast = parser.parse(`<>${syntax}</>`);
      } catch {
        continue;
      }
      const projection = projectProvenMdx(`<>${semantic}</>`, ast);
      markup = markup.slice(0, start) + projection.content.slice(2, -3) + markup.slice(cursor);
      for (const offset of projection.jsxSelfClosingStarts)
        jsxSelfClosingStarts.add(start + offset - 2);
      index = last;
      accepted = true;
      break;
    }
    if (!accepted) uncertainDocument ||= regions[index].documentHint;
  }
  for (const jsx of jsxExports) {
    const ast = parser.parse(`<>${jsx.content}</>`);
    const projection = projectProvenMdx(`<>${jsx.content}</>`, ast);
    markup = markup.slice(0, jsx.start) + projection.content.slice(2, -3) + markup.slice(jsx.end);
    for (const offset of projection.jsxSelfClosingStarts)
      jsxSelfClosingStarts.add(jsx.start + offset - 2);
  }
  return {
    content: markup,
    jsxSelfClosingStarts,
    documentContent: uncertainDocument ? "<html>" : undefined,
    metadataExport: hasMetadataValueExport({ body: statements }),
  };
}

function blankSource(content) {
  return content.replace(/[^\r\n]/g, " ");
}

/** Node values remove Markdown containers; source positions retain original UTF-16 offsets. */
function markdownMarkupSource(content, node) {
  const source = content.slice(node.position.start.offset, node.position.end.offset);
  const values = node.value.split(/\r\n|\r|\n/u);
  return source
    .split(/(\r\n|\r|\n)/u)
    .map((raw, index) => {
      if (index % 2) return raw;
      const value = values[index / 2];
      return value !== undefined && raw.endsWith(value)
        ? " ".repeat(raw.length - value.length) + value
        : blankSource(raw);
    })
    .join("");
}

/** Ordinary text is absent only from the syntax copy; expressions require an exact Babel proof. */
function mdxSourceRegion(content, node, parser) {
  const start = node.position.start.offset,
    end = node.position.end.offset;
  const source = content.slice(start, end);
  if (node.type === "html") {
    const syntax = markdownMarkupSource(content, node);
    return {
      start,
      end,
      syntax,
      semantic: syntax,
      documentHint: /^<html(?=[\s/>])/iu.test(node.value),
    };
  }
  let syntax = blankSource(source);
  let semantic = source;
  const html = [],
    text = [];
  const collect = (child) => {
    if (child.type === "inlineCode") return;
    if (child.type === "html") html.push(child);
    if (child.type === "text") text.push(child);
    child.children?.forEach(collect);
  };
  node.children.forEach(collect);
  const expressions = [];
  for (const child of text) {
    const raw = content.slice(child.position.start.offset, child.position.end.offset);
    for (const match of raw.matchAll(/\{/gu)) {
      if ((/\\+$/u.exec(raw.slice(0, match.index))?.[0].length ?? 0) % 2) continue;
      const left = child.position.start.offset - start + match.index;
      if (expressions.some(([from, to]) => left >= from && left < to)) continue;
      let right = left;
      let proven = false;
      while ((right = source.indexOf("}", right + 1)) !== -1) {
        try {
          const ast = parser.parse(`<>${source.slice(left, right + 1)}</>`);
          const children = (ast.program ?? ast).body[0].expression.children;
          if (children.length !== 1 || children[0].type !== "JSXExpressionContainer") continue;
          proven = true;
          break;
        } catch {
          /* A brace in a string does not terminate the expression. */
        }
      }
      const limit = proven ? right + 1 : source.length;
      expressions.push([left, limit]);
      if (proven) syntax = syntax.slice(0, left) + source.slice(left, limit) + syntax.slice(limit);
    }
  }
  let documentHint = false;
  for (const child of html) {
    const left = child.position.start.offset - start,
      right = child.position.end.offset - start;
    if (expressions.some(([from, to]) => left < to && right > from)) continue;
    const value = markdownMarkupSource(content, child);
    syntax = syntax.slice(0, left) + value + syntax.slice(right);
    semantic = semantic.slice(0, left) + value + semantic.slice(right);
    documentHint ||= /^<html(?=[\s/>])/iu.test(child.value);
  }
  return { start, end, syntax, semantic, documentHint };
}

/** Project AST-proven tags and original title contents, never unrelated Markdown prose. */
function projectProvenMdx(content, ast) {
  const keep = [];
  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    if (["JSXOpeningElement", "JSXClosingElement"].includes(node.type))
      keep.push([node.start, node.end]);
    if (node.type === "JSXElement" && node.openingElement.name.name?.toLowerCase() === "title")
      for (const child of node.children) keep.push([child.start, child.end]);
    for (const value of Object.values(node))
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
  };
  visit(ast);
  const projection = projectJsxMarkup(content, ast);
  const excluded = [];
  let cursor = 0;
  for (const [start, end] of keep.sort(([left], [right]) => left - right)) {
    if (start > cursor) excluded.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  excluded.push([cursor, content.length]);
  return { ...projection, content: maskSourceRanges(projection.content, excluded) };
}

function hasMetadataValueExport(program) {
  const bindings = new Set();
  for (const statement of program.body) {
    const declaration = statement.declaration ?? statement;
    if (declaration.type === "VariableDeclaration") {
      for (const binding of declaration.declarations)
        if (binding.id.type === "Identifier" && binding.init) bindings.add(binding.id.name);
    } else if (declaration.type === "FunctionDeclaration" && declaration.body) {
      bindings.add(declaration.id?.name);
    } else if (declaration.type === "ImportDeclaration" && declaration.importKind !== "type") {
      for (const specifier of declaration.specifiers)
        if (specifier.importKind !== "type") bindings.add(specifier.local.name);
    }
  }
  const metadataNames = new Set(["metadata", "generateMetadata"]);
  return program.body.some((statement) => {
    if (statement.type !== "ExportNamedDeclaration" || statement.exportKind === "type")
      return false;
    const declaration = statement.declaration;
    if (declaration?.type === "VariableDeclaration")
      return declaration.declarations.some(
        (binding) => metadataNames.has(binding.id.name) && bindings.has(binding.id.name),
      );
    if (declaration?.type === "FunctionDeclaration")
      return declaration.id?.name === "generateMetadata" && Boolean(declaration.body);
    return statement.specifiers.some(
      (specifier) =>
        specifier.type === "ExportSpecifier" &&
        specifier.exportKind !== "type" &&
        metadataNames.has(specifier.exported.name ?? specifier.exported.value) &&
        (statement.source || bindings.has(specifier.local.name)),
    );
  });
}

/** Keep JSX attributes and markup, masking executable-source examples without moving locations. */
function projectJsxMarkup(content, ast) {
  const ranges = (ast.comments ?? []).map(({ start, end }) => [start, end]);
  const jsxSelfClosingStarts = new Set();
  const literalTypes = new Set([
    "StringLiteral",
    "DirectiveLiteral",
    "TemplateLiteral",
    "RegExpLiteral",
  ]);
  const visit = (node, parent) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "JSXOpeningElement" && node.selfClosing) jsxSelfClosingStarts.add(node.start);
    if (
      literalTypes.has(node.type) &&
      !(node.type === "StringLiteral" && parent?.type === "JSXAttribute")
    ) {
      ranges.push([node.start, node.end]);
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((child) => visit(child, node));
      else if (value && typeof value === "object") visit(value, node);
    }
  };
  visit(ast);
  return { content: maskSourceRanges(content, ranges), jsxSelfClosingStarts };
}

function maskSourceRanges(content, ranges) {
  const parts = [];
  let cursor = 0;
  for (const [start, end] of ranges.sort(([left], [right]) => left - right)) {
    if (end <= cursor) continue;
    parts.push(content.slice(cursor, Math.max(cursor, start)));
    parts.push(content.slice(Math.max(cursor, start), end).replace(/[^\r\n]/g, " "));
    cursor = end;
  }
  return parts.join("") + content.slice(cursor);
}

export function runSeo(summary = webSurfaceSummary()) {
  const failures = seoFailures(summary);
  reportResult(
    "SEO verification",
    failures,
    summary.hasWebSurface ? undefined : "SEO verification skipped; no web surface detected.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runSeo();
}

function isStaticWebHtmlPage(file) {
  return (
    file.extension === ".html" &&
    Boolean(file.productSourceRoot) &&
    (file.relativePath === file.productSourceRoot ||
      file.relativePath.startsWith(`${file.productSourceRoot}/`))
  );
}

function groupByProductSourceRoot(files) {
  const groups = new Map();
  for (const file of files) {
    if (!file.productSourceRoot) continue;
    if (!groups.has(file.productSourceRoot)) groups.set(file.productSourceRoot, []);
    groups.get(file.productSourceRoot).push(file);
  }
  return groups;
}

function collectSitemapFailures({ sourceRoot, indexingCandidateFiles, indexablePages }) {
  const sitemapFailures = [];
  if (indexingCandidateFiles.length === 0) return sitemapFailures;

  const candidateGroups = groupByProductSourceRoot(indexingCandidateFiles);
  const pageGroups = groupByProductSourceRoot(indexablePages.map((page) => page.file));
  for (const [productSourceRoot, candidateFiles] of candidateGroups) {
    const pageFiles = new Set(pageGroups.get(productSourceRoot) ?? []);
    const pages = indexablePages.filter((page) => pageFiles.has(page.file));
    sitemapFailures.push(
      ...collectProductSitemapFailures({
        sourceRoot,
        productSourceRoot,
        indexingCandidateFiles: candidateFiles,
        indexablePages: pages,
      }),
    );
  }
  return sitemapFailures;
}

function collectProductSitemapFailures({
  sourceRoot,
  productSourceRoot,
  indexingCandidateFiles,
  indexablePages,
}) {
  const sitemapFailures = [];
  if (indexingCandidateFiles.length === 0) return sitemapFailures;
  const productRoot = path.join(sourceRoot, ...productSourceRoot.split("/"));
  const sitemapRelativePath = `${productSourceRoot}/sitemap.xml`;
  const sitemapPath = path.join(sourceRoot, ...sitemapRelativePath.split("/"));

  if (!existsSync(sitemapPath)) {
    sitemapFailures.push(
      `${sitemapRelativePath}: indexable static HTML pages require a committed sitemap.xml in their product source root`,
    );
    return sitemapFailures;
  }

  let realSitemapPath = "";
  try {
    const realProductRoot = verifyRealDirectory(productRoot, productSourceRoot);
    realSitemapPath = verifyRealFileInside({
      filePath: sitemapPath,
      parentPath: productRoot,
      realParentPath: realProductRoot,
      label: sitemapRelativePath,
    });
  } catch (error) {
    sitemapFailures.push(`${sitemapRelativePath}: ${error.message}`);
    return sitemapFailures;
  }
  const sitemap = readFileSync(realSitemapPath, "utf8");
  const sitemapEntries = parseSitemapEntries(sitemap);
  const sitemapLocs = new Set(sitemapEntries.map((entry) => entry.loc));
  const sitemapOrigins = new Set();

  if (sitemapEntries.length === 0) {
    sitemapFailures.push(`${sitemapRelativePath}: sitemap must include at least one <url> entry`);
  }

  for (const entry of sitemapEntries) {
    if (!entry.loc) {
      sitemapFailures.push(`${sitemapRelativePath}: each sitemap entry needs a loc URL`);
    } else {
      const origin = httpUrlOrigin(entry.loc);
      if (!origin) {
        sitemapFailures.push(`${sitemapRelativePath}: loc URLs must be absolute http(s) URLs`);
      } else {
        sitemapOrigins.add(origin);
      }
    }
    if (!entry.lastmod) {
      sitemapFailures.push(`${sitemapRelativePath}: each sitemap entry needs a lastmod timestamp`);
      continue;
    }
    if (!isIso8601Timestamp(entry.lastmod)) {
      sitemapFailures.push(
        `${sitemapRelativePath}: lastmod values must use ISO 8601 timestamps with seconds and timezone`,
      );
    }
  }

  if (sitemapOrigins.size > 1) {
    sitemapFailures.push(`${sitemapRelativePath}: loc URLs must use one canonical origin`);
  }

  for (const page of indexablePages) {
    if (sitemapOrigins.size > 0 && !sitemapOrigins.has(page.canonicalOrigin)) {
      sitemapFailures.push(
        `${page.file.relativePath}: canonical origin must match ${sitemapRelativePath}`,
      );
    }
    if (!sitemapLocs.has(page.canonical)) {
      sitemapFailures.push(
        `${sitemapRelativePath}: missing canonical URL for ${page.file.relativePath}`,
      );
    }
  }

  sitemapFailures.push(
    ...collectCurrentSitemapLastmodFreshnessFailures({
      sourceRoot,
      productSourceRoot,
      sitemapRelativePath,
      currentEntries: sitemapEntries,
      pages: indexablePages,
    }),
  );

  return sitemapFailures;
}

function collectCurrentSitemapLastmodFreshnessFailures({
  sourceRoot,
  productSourceRoot,
  sitemapRelativePath,
  currentEntries,
  pages,
}) {
  const changedHtmlRelativePaths = changedHtmlPathsFromGit(sourceRoot, productSourceRoot);
  if (changedHtmlRelativePaths.size === 0) return [];

  const previousSitemap = readGitFile(sourceRoot, `HEAD:${sitemapRelativePath}`);
  if (!previousSitemap) return [];

  return collectSitemapLastmodFreshnessFailures({
    changedHtmlRelativePaths,
    currentEntries,
    previousEntries: parseSitemapEntries(previousSitemap),
    pages,
  });
}

export function collectSitemapLastmodFreshnessFailures({
  changedHtmlRelativePaths,
  currentEntries,
  previousEntries,
  pages,
}) {
  const freshnessFailures = [];
  const currentByUrl = new Map(currentEntries.map((entry) => [entry.loc, entry]));
  const previousByUrl = new Map(previousEntries.map((entry) => [entry.loc, entry]));
  const changedPathsByCanonical = new Map();

  for (const page of pages) {
    if (!changedHtmlRelativePaths.has(page.file.relativePath)) continue;
    if (!changedPathsByCanonical.has(page.canonical)) {
      changedPathsByCanonical.set(page.canonical, []);
    }
    changedPathsByCanonical.get(page.canonical).push(page.file.relativePath);
  }

  for (const [canonical, pagePaths] of changedPathsByCanonical) {
    const current = currentByUrl.get(canonical);
    const previous = previousByUrl.get(canonical);
    if (!current?.lastmod || !previous?.lastmod) continue;
    if (!isIso8601Timestamp(current.lastmod) || !isIso8601Timestamp(previous.lastmod)) continue;

    if (Date.parse(current.lastmod) <= Date.parse(previous.lastmod)) {
      const sortedPagePaths = pagePaths.sort();
      freshnessFailures.push(
        `${sortedPagePaths.join(
          ", ",
        )}: sitemap lastmod must advance when indexable page content changes; run pnpm web:update-sitemap-lastmod -- --timestamp <ISO> ${sortedPagePaths.join(
          " ",
        )}`,
      );
    }
  }

  return freshnessFailures;
}

function changedHtmlPathsFromGit(sourceRoot, productSourceRoot) {
  const changedPaths = new Set();
  for (const line of gitOutputLines(sourceRoot, [
    "diff",
    "--name-only",
    "HEAD",
    "--",
    productSourceRoot,
  ])) {
    if (line.endsWith(".html")) changedPaths.add(line);
  }
  for (const line of gitOutputLines(sourceRoot, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    productSourceRoot,
  ])) {
    if (line.endsWith(".html")) changedPaths.add(line);
  }
  return changedPaths;
}

function gitOutputLines(sourceRoot, args) {
  const result = spawnSync("git", args, {
    cwd: sourceRoot,
    env: cleanGitEnvironment(process.env, sourceRoot),
    encoding: "utf8",
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function readGitFile(sourceRoot, revisionPath) {
  const result = spawnSync("git", ["show", revisionPath], {
    cwd: sourceRoot,
    env: cleanGitEnvironment(process.env, sourceRoot),
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout : "";
}
