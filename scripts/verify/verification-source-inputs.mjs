/** Owns conservative executable equivalence for the verification evidence source snapshot. */
import { createRequire } from "node:module";
import path from "node:path";
import { digest } from "./verification-record-helpers.mjs";

const parsers = new Map();
const fingerprints = new Map();
const metadata = new Set([
  "start",
  "end",
  "loc",
  "extra",
  "comments",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "__contentEnd",
]);

/** Unknown syntax, unavailable parsers and directive comments retain their exact bytes. */
export function executableFingerprint(root, file, buffer) {
  const raw = digest(buffer);
  const key = `${root}\0${file}\0${raw}`;
  if (fingerprints.has(key)) return fingerprints.get(key);
  let result = raw;
  try {
    const source = buffer.toString("utf8");
    if (file.endsWith(".json")) result = digest(JSON.stringify(JSON.parse(source)));
    else if (/\.(?:[cm]?js|jsx|ts|tsx)$/u.test(file)) {
      if (!parsers.has(root)) {
        const require = createRequire(path.join(root, "package.json"));
        parsers.set(root, require("prettier/plugins/babel").parsers);
      }
      const parser = parsers.get(root)[/\.tsx?$/u.test(file) ? "babel-ts" : "babel"];
      const ast = parser.parse(source);
      // Pragmas can affect typechecking, bundling, coverage, lint and source loading.
      const hasDirectives = (ast.comments ?? []).some((comment) =>
        /[@#!]|eslint|istanbul|\bc8\b|sourceMapping|sourceURL|prettier|webpack|vite|rollup/iu.test(
          comment.value,
        ),
      );
      if (!hasDirectives)
        result = digest(
          JSON.stringify(ast, (name, value) => (metadata.has(name) ? undefined : value)),
        );
    }
  } catch {
    // Failed equivalence is a source change, never permission to skip evidence.
  }
  fingerprints.set(key, result);
  return result;
}
