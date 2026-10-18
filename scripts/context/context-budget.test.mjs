/** Protects direct-section budget evidence from subtree inflation and blanket reference limits. */
import assert from "node:assert/strict";
import test from "node:test";
import { contextBudgets, inspectContextReference } from "./context-budget.mjs";

test("nested policy reports bounded direct-body evidence instead of inflated subtree bytes", () => {
  const first = `## First\n${"a".repeat(5000)}\n`;
  const second = `## Second\n${"é".repeat(2400)}\n`;
  const third = `## Third\n${"b".repeat(4300)}\n`;
  const fourth = `## Fourth\n${"c".repeat(4000)}\n`;
  const content = `# Policy\nRoot guidance.\n${first}${second}${third}${fourth}`;
  const { reference, findings } = inspectContextReference("instructions.md", content);

  assert.ok(Buffer.byteLength(content) > 16_384);
  assert.deepEqual(findings, []);
  assert.equal(reference.bytes, Buffer.byteLength(content));
  assert.equal(reference.directSectionCount, 5);
  assert.equal(reference.largestDirectSectionBytes, Buffer.byteLength(first));
  assert.deepEqual(reference.largestDirectSections, [
    { heading: "First", start: 3, end: 4, bytes: Buffer.byteLength(first) },
    { heading: "Second", start: 5, end: 6, bytes: Buffer.byteLength(second) },
    { heading: "Third", start: 7, end: 8, bytes: Buffer.byteLength(third) },
  ]);
});

test("policy bounds preserve original UTF-8 and CRLF bytes and allow the exact ceiling", () => {
  const heading = "## Boundary\r\n";
  const boundary =
    heading + "x".repeat(contextBudgets.directSection - Buffer.byteLength(heading) - 2) + "\r\n";
  const oversized = `## Too Large\r\n${"🧭".repeat(2050)}\r\n`;
  const content = `# Policy\r\n${boundary}${oversized}`;
  const { reference, findings } = inspectContextReference("instructions.md", content);

  assert.equal(Buffer.byteLength(boundary), contextBudgets.directSection);
  assert.equal(reference.largestDirectSectionBytes, Buffer.byteLength(oversized));
  assert.equal(
    reference.largestDirectSections.reduce((total, section) => total + section.bytes, 0),
    Buffer.byteLength(content),
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0], /instructions\.md.*1 section\(s\).*"Too Large".*lines 4-6/u);
});

test("large product references remain available while their direct read cost stays visible", () => {
  const content = `# Requirements\n## Detailed Contract\n${"Requirement.\n".repeat(2000)}`;
  const { reference, findings } = inspectContextReference("docs/requirements.md", content);

  assert.deepEqual(findings, []);
  assert.equal(reference.bytes, Buffer.byteLength(content));
  assert.ok(reference.largestDirectSectionBytes > contextBudgets.directSection);
  assert.equal(reference.largestDirectSections[0].heading, "Detailed Contract");
  assert.equal(reference.largestDirectSections[0].start, 2);
});

// A heading-only inventory left unheaded policy bytes outside the enforced direct-body budget.
test("unheaded policy and preambles count original bytes toward the direct-body limit", () => {
  const prefix = `${"é".repeat(4500)}\r\n`;
  for (const suffix of ["", "# Policy\r\nSmall body.\r\n"]) {
    const content = prefix + suffix;
    const { reference, findings } = inspectContextReference("instructions.md", content);
    assert.equal(reference.directSectionCount, suffix ? 2 : 1);
    assert.equal(reference.largestDirectSectionBytes, Buffer.byteLength(prefix));
    assert.equal(reference.largestDirectSections[0].heading, "(unheaded content)");
    assert.equal(
      reference.largestDirectSections.reduce((total, section) => total + section.bytes, 0),
      Buffer.byteLength(content),
    );
    assert.equal(findings.length, 1);
    assert.match(findings[0], /instructions\.md.*1 section\(s\).*unheaded content/u);
  }
  assert.deepEqual(
    inspectContextReference("instructions.md", "x".repeat(contextBudgets.directSection)).findings,
    [],
  );
  assert.equal(inspectContextReference("instructions.md", "").reference.directSectionCount, 0);
});

// The canonical fence parser must not let sample headings divide one oversized policy body.
test("fenced sample headings cannot split an oversized direct policy body", () => {
  const fence = "`".repeat(4);
  const body =
    `## Example\n${fence}markdown\n${"a".repeat(5000)}\n${"`".repeat(3)}\n` +
    `## Literal example heading\n${"b".repeat(5000)}\n${fence}\n`;
  const { reference, findings } = inspectContextReference("instructions.md", `# Policy\n${body}`);
  assert.equal(reference.directSectionCount, 2);
  assert.equal(reference.largestDirectSectionBytes, Buffer.byteLength(body));
  assert.equal(reference.largestDirectSections[0].heading, "Example");
  assert.equal(findings.length, 1);
  assert.match(findings[0], /instructions\.md.*1 section\(s\).*"Example"/u);
});
