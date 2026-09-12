/** Verifies documentation language findings across source references and surrounding prose. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { languageVerificationFindings } from "./language.mjs";

function fixture(t, files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "documentation-language-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
  return root;
}

test("English documentation can retain original HTTP and HTTPS reference addresses", (t) => {
  const root = fixture(t, {
    "README.md": "# Reference\n\n[Original guide](https://example.org/deutsch/aktuell.pdf)\n",
    "docs/reference.html":
      '<html lang="en"><a href="http://example.org/für">Original guide</a></html>\n',
  });
  assert.deepEqual(languageVerificationFindings({ root }), []);
});

test("reference addresses do not exempt surrounding Markdown or HTML prose", (t) => {
  const root = fixture(t, {
    "README.md": "# Reference\n\n[Bitte read](https://example.org/deutsch.pdf)\n",
    "docs/reference.html":
      '<html lang="en">\n<a href="https://example.org/deutsch.pdf">Aktuell</a>\n<p>für readers</p>\n</html>\n',
  });
  assert.deepEqual(languageVerificationFindings({ root }).sort(), [
    "README.md:3: contains German marker 'Bitte'",
    "docs/reference.html:2: contains German marker 'Aktuell'",
    "docs/reference.html:3: contains a German-specific character",
  ]);
});
