/** Owns project document policy behavior for the durable documentation contract boundary. */
import path from "node:path";
import { markdownFileLinks } from "./document-references.mjs";
import { projectContextPath } from "./document-scope.mjs";

export const initialRequirementsPath = "docs/requirements.md";

const generatedDocumentPaths = [
  "AGENTS.md",
  "README.md",
  "docs/future-modules.md",
  "docs/project.md",
  "instructions.md",
];

export const generatedProjectDocumentPaths = Object.freeze(generatedDocumentPaths);

/** Requires discovery of current and later durable Markdown/HTML docs without copying their text. */
export function readmeDocumentationFindings({ readme, relativePaths }) {
  const linked = new Set(
    markdownFileLinks(readme).flatMap((reference) => {
      if (/^[a-z][a-z0-9+.-]*:/iu.test(reference)) return [];
      try {
        return [path.posix.normalize(decodeURIComponent(reference.split("#")[0]))];
      } catch {
        return [];
      }
    }),
  );
  return relativePaths
    .filter(
      (relativePath) =>
        relativePath.startsWith("docs/") &&
        /\.(?:mdx?|html?)$/iu.test(relativePath) &&
        relativePath !== projectContextPath &&
        !linked.has(relativePath),
    )
    .map(
      (relativePath) =>
        `README.md must link to ${relativePath}; add a discovery link without duplicating its content`,
    );
}
