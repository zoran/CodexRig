/** Verifies bounded context navigation, private-path exclusion and repository instruction pressure. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  documentContextExcerpt,
  documentContextSections,
  readContextDocument,
} from "../docs/document-context.mjs";
import { contextCommand } from "./context-cli.mjs";
import { inspectContextBudget } from "./context-budget.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "bounded-context-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  write("AGENTS.md", "# Entry\nRead relevant sections.\n");
  write(".codex/config.toml", 'developer_instructions = "Workflow"\n');
  for (const role of ["default", "explorer", "worker"])
    write(`.codex/agents/${role}.toml`, 'developer_instructions = "Role"\n');
  write(
    "instructions.md",
    "# Policy\n\n## Task Reading Routes\n\n| Task | Read |\n| --- | --- |\n" +
      "| Implementation | [Scope](#scope) |\n\n## Scope\nKeep the accepted scope.\n",
  );
  write("docs/project.md", "# Project\n\n#### Product\n- Root: `src/product`\n");
  return { root, write };
}

// A parent selection must expose its own requirements without loading oversized child bodies.
test("large specifications retain complete subtrees while parent reads navigate bounded evidence", (t) => {
  const { root, write } = fixture(t);
  const details = "details\n".repeat(20000);
  const content =
    "# Specification\n\n## Acceptance\nExact requirement.\n\n" +
    "### Evidence\nChild requirement.\n\n##### Detail\n" +
    details +
    "### Ownership\nOwner requirement.\n\n## Reference\nAnother chapter.\n";
  write("docs/requirements.md", content);
  assert.throws(
    () => contextCommand(["read", "docs/requirements.md"], root),
    /Nothing was truncated/,
  );
  const excerpt = contextCommand(
    ["read", "docs/requirements.md", "--section", "Acceptance"],
    root,
  ).output;
  assert.match(excerpt, /Exact requirement/);
  assert.doesNotMatch(excerpt, /details/);
  assert.doesNotMatch(excerpt, /Child requirement|Owner requirement|##### Detail/);
  assert.match(excerpt, /### Evidence/);
  assert.match(excerpt, /### Ownership/);
  assert.match(excerpt, /child bodies not loaded/);
  assert.match(excerpt, /Read the child sections required for this task/);
  assert.match(excerpt, /--subtree/);
  assert.ok(Buffer.byteLength(excerpt) < 16384);
  assert.match(
    contextCommand(["read", "docs/requirements.md", "--outline"], root).output,
    /Reference/,
  );
  assert.equal(readContextDocument(root, "docs/requirements.md").content, content);
  assert.throws(
    () =>
      contextCommand(
        ["read", "docs/requirements.md", "--section", "Acceptance", "--subtree"],
        root,
      ),
    /Nothing was truncated/,
  );
  write("docs/requirements.md", content.replace(details, "Complete detail.\n"));
  const subtree = contextCommand(
    ["read", "docs/requirements.md", "--section", "Acceptance", "--subtree"],
    root,
  ).output;
  assert.match(subtree, /Exact requirement/);
  assert.match(subtree, /Child requirement/);
  assert.match(subtree, /Complete detail/);
  assert.match(subtree, /Owner requirement/);
  assert.doesNotMatch(subtree, /Another chapter|child bodies not loaded/);
  assert.match(contextCommand(["map"], root).output, /src\/product/);
});

test("sections preserve physical lines, ignore fenced headings, reject ambiguous selections and invalid ranges", () => {
  const content = "# Test\n## One\ntext\n```md\n## False\n```\n## Two\nsecond";
  assert.deepEqual(
    documentContextSections("x.md", content).map((x) => [x.heading, x.start, x.directEnd, x.end]),
    [
      ["Test", 1, 1, 8],
      ["One", 2, 6, 6],
      ["Two", 7, 8, 8],
    ],
  );
  assert.match(
    documentContextExcerpt(
      {
        file: "x.html",
        content: '<h1>Test</h1>\n<h2 id="a">Target</h2>\n<p>truth</p>\n<h2>Next</h2>',
      },
      { section: "Target" },
    ),
    /<p>truth<\/p>/,
  );
  assert.throws(
    () =>
      documentContextExcerpt({ file: "x.md", content: "## Same\n## Same" }, { section: "Same" }),
    /exactly one/,
  );
  assert.throws(
    () => documentContextExcerpt({ file: "x.md", content }, { lines: "1:99" }),
    /outside/,
  );
  assert.throws(
    () => documentContextExcerpt({ file: "x.md", content }, { lines: "2:1" }),
    /outside/,
  );
});

// Shorter fences and fence-like sample lines must not expose literal headings as navigation.
test("fenced examples retain literal headings until a compatible closing fence", () => {
  for (const marker of ["`", "~"]) {
    const other = marker === "`" ? "~" : "`";
    const content = [
      "# Policy",
      "## Examples",
      `${marker.repeat(4)}markdown`,
      "Literal example. [Example link](missing-example.md)",
      marker.repeat(3),
      "### Shorter fence text",
      `${marker.repeat(4)} trailing text`,
      "### Nonclosing suffix",
      other.repeat(4),
      "### Other marker",
      `${marker.repeat(5)}  `,
      "### Real child",
      "Actual child body.",
      "## Next",
      "Outside the example.",
    ].join("\n");
    assert.deepEqual(documentContextSections("x.md", content), [
      { heading: "Policy", level: 1, start: 1, directEnd: 1, end: 15 },
      { heading: "Examples", level: 2, start: 2, directEnd: 11, end: 13 },
      { heading: "Real child", level: 3, start: 12, directEnd: 13, end: 13 },
      { heading: "Next", level: 2, start: 14, directEnd: 15, end: 15 },
    ]);
    const direct = documentContextExcerpt({ file: "x.md", content }, { section: "Examples" });
    assert.match(direct, /\[Example link\]\(missing-example\.md\)/u);
    for (const literal of ["Shorter fence text", "Nonclosing suffix", "Other marker"])
      assert.ok(direct.includes(literal));
    assert.match(direct, /12-13 ### Real child/u);
    assert.doesNotMatch(direct, /Actual child body|Outside the example/u);
    const subtree = documentContextExcerpt(
      { file: "x.md", content },
      { section: "Examples", subtree: true },
    );
    assert.match(subtree, /Actual child body/u);
    assert.doesNotMatch(subtree, /Outside the example/u);
    const outline = documentContextExcerpt({ file: "x.md", content }, { outline: true });
    assert.match(outline, /Real child/u);
    assert.doesNotMatch(outline, /Shorter fence text|Nonclosing suffix|Other marker|Example link/u);
  }
});

test("direct reads navigate immediate children across skipped Markdown and HTML heading levels", () => {
  for (const [file, content] of [
    [
      "x.md",
      "# Parent\nParent body.\n### First\nFirst body.\n##### Deep\nDeep body.\n" +
        "## Second\nSecond body.\n### Nested\nNested body.\n# Next\nOutside.\n",
    ],
    [
      "x.html",
      '<h1 id="parent">Parent</h1>\n<p>Parent body.</p>\n<h3>First</h3>\n<p>First body.</p>\n' +
        "<h5>Deep</h5>\n<p>Deep body.</p>\n<h2>Second</h2>\n<p>Second body.</p>\n" +
        "<h3>Nested</h3>\n<p>Nested body.</p>\n<h1>Next</h1>\n<p>Outside.</p>\n",
    ],
  ]) {
    const direct = documentContextExcerpt({ file, content }, { section: "Parent" });
    assert.match(direct, /Lines 1-2;/);
    assert.match(direct, /Parent body/);
    assert.match(direct, /3-6 ### First/);
    assert.match(direct, /7-10 ## Second/);
    assert.doesNotMatch(direct, /First body|Second body|Deep|Nested|Outside/);
    const subtree = documentContextExcerpt({ file, content }, { section: "Parent", subtree: true });
    assert.match(subtree, /Lines 1-10;/);
    assert.match(subtree, /Deep body/);
    assert.match(subtree, /Nested body/);
    assert.doesNotMatch(subtree, /Outside|child bodies not loaded/);
  }
});

test("read modes reject incompatible or repeated options and retain strict output bounds", (t) => {
  const { root, write } = fixture(t);
  for (const options of [
    ["--subtree"],
    ["--outline", "--subtree"],
    ["--lines", "1:2", "--subtree"],
    ["--section", "Scope", "--subtree", "--subtree"],
    ["--section", "Scope", "--outline"],
    ["--section", "Scope", "--lines", "1:2"],
    ["--offset", "0"],
    ["--outline", "--offset", "-1"],
    ["--outline", "--offset", "0.5"],
    ["--outline", "--offset", "0", "--offset", "1"],
    ["--outline", "--outline"],
    ["--section", ""],
    ["--lines", ""],
  ])
    assert.throws(
      () => contextCommand(["read", "instructions.md", ...options], root),
      options.join(" "),
    );
  for (const options of [
    { subtree: true },
    { section: "Scope", outline: true },
    { section: "Scope", lines: "1:2" },
    { section: "Scope", subtree: true, outline: true },
    { lines: "1:2", subtree: true },
  ])
    assert.throws(() =>
      documentContextExcerpt(readContextDocument(root, "instructions.md"), options),
    );
  assert.match(
    contextCommand(["read", "instructions.md", "--subtree", "--section", "Scope"], root).output,
    /Keep the accepted scope/,
  );
  const headings = Array.from({ length: 45 }, (_, index) => `## Section ${index}\nbody\n`).join("");
  write("docs/pages.md", `# Pages\n${headings}`);
  assert.match(
    contextCommand(["read", "docs/pages.md", "--outline"], root).output,
    /Next: --outline --offset 40/,
  );
  const lastPage = contextCommand(
    ["read", "docs/pages.md", "--outline", "--offset", "40"],
    root,
  ).output;
  assert.match(lastPage, /Section 44/);
  assert.doesNotMatch(lastPage, /Next:/);
  write("docs/large.md", `# Large\n${"body\n".repeat(4000)}`);
  assert.throws(
    () => contextCommand(["read", "docs/large.md", "--section", "Large"], root),
    /Nothing was truncated/,
  );
  write("docs/large.md", `# Large\n${"## Child\n".repeat(1500)}`);
  assert.throws(
    () => contextCommand(["read", "docs/large.md", "--section", "Large"], root),
    /Nothing was truncated/,
  );
});

test("map projects only canonical task routes verbatim and diagnoses missing or ambiguous owners", (t) => {
  const { root, write } = fixture(t);
  const routes = "\r\n| Task | Read |\r\n| --- | --- |\r\n| Repair | [Scope](#scope) |\r\n\r\n";
  const policy = (body = routes) =>
    `# Policy\r\n\r\n## Task Reading Routes\r\n${body}` +
    "### Supplemental\r\nChild routing explanation.\r\n\r\n## Scope\r\nKeep scope.\r\n";
  write("instructions.md", policy());
  const map = contextCommand(["map"], root).output;
  assert.ok(map.includes(routes));
  assert.match(map, /src\/product/);
  assert.doesNotMatch(map, /Child routing explanation|Keep scope/);
  write("instructions.md", policy(routes.replace("Repair", "Review")));
  assert.match(contextCommand(["map"], root).output, /Review/);
  for (const invalid of [
    "# Policy\n## Scope\nKeep scope.\n",
    `${policy()}\n## Task Reading Routes\nA competing owner.\n`,
    policy().replace("## Task Reading Routes", "### Task Reading Routes"),
  ]) {
    write("instructions.md", invalid);
    assert.throws(() => contextCommand(["map"], root), /exactly one.*Task Reading Routes/);
  }
  write("instructions.md", policy("Oversized routing text.\n".repeat(1000)));
  assert.throws(() => contextCommand(["map"], root), /Nothing was truncated/);
});

test("public document reader rejects private paths, escaped roots and symlinks", (t) => {
  const { root, write } = fixture(t);
  write(".codex/runtime/secret.md", "private");
  for (const file of [".codex/runtime/secret.md", "../instructions.md", "package.json"])
    assert.throws(() => readContextDocument(root, file));
  symlinkSync(path.join(root, ".codex/runtime/secret.md"), path.join(root, "docs/link.md"));
  assert.throws(() => readContextDocument(root, "docs/link.md"), /safety refused/i);
});

test("budget distinguishes injected scopes, conditional roles and complete references", (t) => {
  const { root, write } = fixture(t);
  write("README.md", "reference".repeat(100000));
  const initial = inspectContextBudget(root);
  assert.deepEqual(initial.findings, []);
  assert.equal(initial.references.find((entry) => entry.file === "README.md").bytes, 900000);
  write("AGENTS.md", "# Entry\n" + "x".repeat(8200));
  assert.ok(inspectContextBudget(root).findings.some((x) => x.includes("bootstrap")));
  write(
    ".agents/skills/large/SKILL.md",
    "---\nname: large\ndescription: test\n---\n" + "x".repeat(17000),
  );
  write(".codex/agents/explorer.toml", `developer_instructions = "${"x".repeat(6200)}"\n`);
  const grown = inspectContextBudget(root);
  assert.ok(grown.findings.some((x) => x.includes("role context")));
  assert.ok(grown.findings.some((x) => x.includes("skill context")));
  assert.equal(
    grown.automaticBytes - initial.automaticBytes,
    2 * (8208 - Buffer.byteLength("# Entry\nRead relevant sections.\n")) + grown.skillMetadataBytes,
  );
  assert.equal(contextCommand(["check"], root).failed, true);
});

test("context check validates optional work state without inventing work or certifying its prose", (t) => {
  const { root, write } = fixture(t);
  assert.equal(contextCommand(["check"], root).failed, false);
  const state = {
    version: 1,
    revision: 1,
    status: "complete",
    outcome: "Repair the accepted defect",
    currentGoal: "Repair",
    currentSlice: null,
    nextAction: null,
    blocker: { kind: "external", reason: "Already resolved" },
  };
  const save = () =>
    write(
      "docs/project-context.md",
      `<!-- codexrig-work-state\n${JSON.stringify(state)}\n-->\n\n# Work\n`,
    );
  save();
  const invalid = contextCommand(["check", "--json"], root);
  assert.equal(invalid.failed, true);
  assert.match(invalid.output, /complete work cannot declare a next action or blocker/u);
  state.blocker = null;
  save();
  assert.equal(contextCommand(["check"], root).failed, false);
  assert.match(contextCommand(["check"], root).output, /does not establish semantic currency/u);
  write("docs/project-context.md", "# Stale task without the required marker\n");
  assert.equal(contextCommand(["check"], root).failed, true);
});

test("aggregate delegated overflow is reported alongside component violations", (t) => {
  const { root, write } = fixture(t);
  write("AGENTS.md", "a".repeat(8300));
  write(".codex/config.toml", `developer_instructions = "${"d".repeat(4200)}"\n`);
  write(".codex/agents/worker.toml", `developer_instructions = "${"r".repeat(6200)}"\n`);
  write(
    ".agents/skills/bounded/SKILL.md",
    `---\nname: bounded\ndescription: ${"m".repeat(7000)}\n---\n# Bounded Skill\n`,
  );
  const report = inspectContextBudget(root);
  assert.ok(report.automaticBytes < 32768);
  assert.equal(report.delegatedBytes, report.automaticBytes + 6200);
  assert.ok(report.delegatedBytes > 32768);
  for (const expected of [
    /bootstrap context/u,
    /developer context/u,
    /role context/u,
    /Delegated repository context/u,
  ])
    assert.ok(
      report.findings.some((finding) => expected.test(finding)),
      String(expected),
    );
});
