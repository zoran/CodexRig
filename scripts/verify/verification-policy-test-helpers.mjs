/** Builds stable source snapshots for focused verification-input regressions. */
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listPortableTransferFiles } from "../repository/source-inventory.mjs";
import { discoverProductLayout } from "../repository/product-roots.mjs";
import { digest } from "./verification-record-helpers.mjs";
import { executableFingerprint } from "./verification-source-inputs.mjs";

export const receipt = ([key, fingerprint]) => ({
  key,
  fingerprint,
  completedAt: new Date().toISOString(),
  elapsedMs: 1,
});

// Exercise shipped policy against stable, real inputs without mutating this checkout. A synthetic
// digest cannot prove the executable import closure that scoped static commands now require.
export function policyFixture(t) {
  const sourceRoot = path.resolve(import.meta.dirname, "..", "..");
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "verification-policy-"));
  t.after(() => rmSync(repositoryRoot, { recursive: true, force: true }));
  const snapshot = (file, content) => {
    const mode = lstatSync(path.join(repositoryRoot, file)).mode & 0o7777;
    return {
      path: file,
      fingerprint: digest(`${mode}\0${digest(content)}`),
      semanticFingerprint: digest(
        `${mode & 0o111}\0${executableFingerprint(sourceRoot, file, content)}`,
      ),
    };
  };
  const sourceFiles = listPortableTransferFiles({ root: sourceRoot, includeUntracked: true })
    .sort()
    .map((file) => {
      const target = path.join(repositoryRoot, file);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(sourceRoot, file), target);
      return snapshot(file, readFileSync(target));
    });
  const productLayout = discoverProductLayout({
    repositoryRoot,
    relativePaths: sourceFiles.map((file) => file.path),
  });
  return { repositoryRoot, snapshot, sourceFiles, productLayout };
}
