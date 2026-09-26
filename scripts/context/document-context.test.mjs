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
  write("instructions.md", "# Policy\n\n## Scope\nKeep the accepted scope.\n");
  write("docs/project.md", "# Project\n\n#### Product\n- Root: `src/product`\n");
  return { root, write };
}

test("large specifications remain intact while selected evidence and outlines stay bounded", (t) => {
  const { root, write } = fixture(t);
  const content =
    "# Specification\n\n## Acceptance\nExact requirement.\n\n## Reference\n" +
    "details\n".repeat(20000);
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
  assert.ok(Buffer.byteLength(excerpt) < 16384);
  assert.match(
    contextCommand(["read", "docs/requirements.md", "--outline"], root).output,
    /Reference/,
  );
  assert.equal(readContextDocument(root, "docs/requirements.md").content, content);
  assert.match(contextCommand(["map"], root).output, /src\/product/);
});

test("sections preserve physical lines, ignore fenced headings, reject ambiguous selections and invalid ranges", () => {
  const content = "# Test\n## One\ntext\n```md\n## False\n```\n## Two\nsecond";
  assert.deepEqual(
    documentContextSections("x.md", content).map((x) => [x.heading, x.start, x.end]),
    [
      ["Test", 1, 8],
      ["One", 2, 6],
      ["Two", 7, 8],
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
  write("instructions.md", "reference".repeat(100000));
  const initial = inspectContextBudget(root);
  assert.deepEqual(initial.findings, []);
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

test("individually bounded scopes cannot overflow a delegated assembled context", (t) => {
  const { root, write } = fixture(t);
  write("AGENTS.md", "a".repeat(8100));
  write(".codex/config.toml", `developer_instructions = "${"d".repeat(4000)}"\n`);
  write(".codex/agents/worker.toml", `developer_instructions = "${"r".repeat(6000)}"\n`);
  write(
    ".agents/skills/bounded/SKILL.md",
    `---\nname: bounded\ndescription: ${"m".repeat(7000)}\n---\n# Bounded Skill\n`,
  );
  const report = inspectContextBudget(root);
  assert.ok(report.automaticBytes < 32768);
  assert.equal(report.delegatedBytes, report.automaticBytes + 6000);
  assert.ok(report.delegatedBytes > 32768);
  assert.equal(report.findings.length, 1);
  assert.match(report.findings[0], /Delegated repository context/u);
});
