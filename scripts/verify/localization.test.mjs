/** Verifies localization behavior for the repository verification boundary. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  initialLocalizationConfiguration,
  localizationConfigurationFindings,
  localizationConfigurationPath,
  serializeLocalizationConfiguration,
} from "../contracts/localization-configuration.mjs";
import { localizationProjectFindings } from "./localization.mjs";

function fixture(t, prefix = "localization-") {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  return root;
}

function write(root, relativePath, content) {
  const target = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function manifest(languageLine) {
  return `# Project Manifest

## System Shape

- ${languageLine}
- Source code, identifiers, filenames, and technical source documentation use English.
`;
}

test("generated projects begin with truthful pending localization and English source policy", (t) => {
  const root = fixture(t);
  write(root, "src/.gitkeep", "");
  write(root, localizationConfigurationPath, initialLocalizationConfiguration());
  write(root, "docs/project.md", manifest("Product languages and localization: pending."));
  assert.deepEqual(localizationProjectFindings({ root }), []);

  write(root, "src/index.ts", "/** Owns index behavior for the product composition boundary. */\n");
  assert.match(
    localizationProjectFindings({ root }).join("\n"),
    /must be configured before product implementation/u,
  );
});

test("configured single and multilingual locale sets stay canonical and manifest-aligned", (t) => {
  const root = fixture(t);
  const configuration = serializeLocalizationConfiguration({
    userFacing: {
      strategy: "multi-locale",
      defaultLocale: "de-DE",
      fallbackLocale: "en",
      supportedLocales: ["en", "de-DE"],
    },
  });
  assert.deepEqual(localizationConfigurationFindings(configuration), []);
  write(root, "src/index.ts", "/** Owns index behavior for the product composition boundary. */\n");
  write(root, localizationConfigurationPath, configuration);
  write(
    root,
    "docs/project.md",
    manifest(
      "Product languages and localization: multi-locale; default `de-DE`; supported `de-DE`, `en`; fallback `en`.",
    ),
  );
  assert.deepEqual(localizationProjectFindings({ root }), []);

  const invalid = configuration.replace('"fallbackLocale": "en"', '"fallbackLocale": "fr"');
  assert.match(localizationConfigurationFindings(invalid).join("\n"), /fallbackLocale/u);
});

test("explicit localization configuration requires manifest truth even without product files", (t) => {
  const root = fixture(t, "localization-source-");
  write(root, localizationConfigurationPath, initialLocalizationConfiguration());
  assert.match(
    localizationProjectFindings({ root, relativePaths: [localizationConfigurationPath] }).join(
      "\n",
    ),
    /missing localization truth owner: docs\/project\.md/u,
  );
});
