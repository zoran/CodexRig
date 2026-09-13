/** Routes changed categories through the project's selected verification owners. */
import { readVerificationConfiguration } from "./verification-configuration.mjs";
const configuration = readVerificationConfiguration();
export const ownedCategoryConsumers = new Map(Object.entries(configuration.ownedCategories));
export const exactConsumerRegistry = new Map(Object.entries(configuration.exactConsumers));
export const removedFrameworkSourceConsumers = Object.freeze(["repository-smoke"]);
export function effectiveCategories(entry, { verifyOnlyRootManifest }) {
  if (entry.path !== "package.json" || !verifyOnlyRootManifest) return entry.categories;
  return ["framework scripts", "verification orchestration", "verify-only root manifest"];
}

export function categoryConsumerKeys(categories) {
  const keys = new Set();
  const has = (category) => categories.includes(category);
  const add = (...values) => values.forEach((value) => keys.add(value));
  if (has("active documentation"))
    add("docs", "delivery-environments", "secrets", "language", "path-hygiene");
  if (has("script catalog")) add("scripts");
  if (has("context source-policy surface") || has("context workflow")) {
    add("syntax-lint", "scripts", "context-regressions", "patterns");
  }
  if (has("dependency workflow")) {
    add("syntax-lint", "scripts", "dependencies", "patterns");
  }
  if (has("setup workflow")) {
    add("syntax-lint", "scripts", "codex-config", "secrets", "path-hygiene", "patterns");
  }
  if (has("CodexRig framework workflow")) {
    add("syntax-lint", "scripts", "repository-smoke", "codex-config", "patterns");
  }
  if (has("stack workflow") || has("web workflow")) {
    add("syntax-lint", "scripts", "surface-quality", "patterns");
  }
  if (has("image quality surface") || has("image asset surface")) add("surface-quality");
  if (has("project Codex config") || has("Codex runtime boundary")) {
    add("codex-config", "secrets", "path-hygiene");
  }
  if (has("repo-local skill source") || has("skill path boundary")) {
    add("skills", "secrets", "language", "path-hygiene");
  }
  if (has("repo-local skill executable source")) add("syntax-lint");
  if (has("verification orchestration")) add("syntax-lint", "scripts", "patterns");
  if (has("app/package/service/runtime source")) {
    add(
      "syntax-lint",
      "repository-smoke",
      "secrets",
      "language",
      "localization",
      "patterns",
      "path-hygiene",
      "surface-quality",
      "api-security",
      "identity-access",
      "tenant-isolation",
      "white-label",
    );
  }
  if (has("dependency/package manager files")) {
    add("syntax-lint", "scripts", "repository-smoke", "dependencies", "secrets", "patterns");
  }
  if (has("infrastructure/runtime config")) {
    add(
      "syntax-lint",
      "delivery-environments",
      "secrets",
      "patterns",
      "surface-quality",
      "api-security",
      "identity-access",
      "tenant-isolation",
    );
  }
  if (has("identity/access trust boundary")) {
    add("identity-access", "api-security", "secrets", "patterns");
  }
  if (has("tenant-isolation trust boundary")) {
    add("tenant-isolation", "identity-access", "api-security", "secrets", "patterns");
  }
  if (has("repository source-policy surface")) {
    add("codex-config", "path-hygiene", "repository-smoke", "secrets");
  }
  const selected = new Set(configuration.commands.map((command) => command.key));
  return [...keys].filter((key) => selected.has(key));
}
