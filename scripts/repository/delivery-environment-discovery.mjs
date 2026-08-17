/** Owns delivery environment discovery behavior for the repository inventory and filesystem boundary. */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { deliveryTargets } from "../contracts/delivery-configuration.mjs";
import { listActiveFiles } from "./source-inventory.mjs";

const maximumInspectedBytes = 512 * 1024;
const targetAliases = Object.freeze({
  dev: "dev",
  development: "dev",
  stage: "staging",
  staging: "staging",
  prod: "prod",
  production: "prod",
});
const aliasSource = Object.keys(targetAliases).join("|");
const structuralPathPatterns = Object.freeze([
  new RegExp(
    `^(?:infra|infrastructure|deploy|deployment|deployments|ops)/(?:environments?/)?(${aliasSource})(?:[./_-]|/|$)`,
    "iu",
  ),
  new RegExp(`^(?:k8s|kubernetes)/overlays/(${aliasSource})(?:[./_-]|/|$)`, "iu"),
  new RegExp(`^config/environments/(${aliasSource})(?:[./_-]|/|$)`, "iu"),
  new RegExp(`^(?:docker-)?compose[._-](${aliasSource})\\.ya?ml$`, "iu"),
  new RegExp(`^helm/.*/values[._-](${aliasSource})\\.ya?ml$`, "iu"),
  new RegExp(
    `^\\.github/workflows/(?:deploy|release)[^/]*[._-](${aliasSource})(?:[._-][^/]*)?\\.ya?ml$`,
    "iu",
  ),
]);
const likelyDeliveryPathPattern =
  /^(?:\.github\/workflows\/|\.gitlab(?:-ci\.yml|\/)|config\/|deploy(?:ment|ments)?\/|infra(?:structure)?\/|k8s\/|kubernetes\/|ops\/)/iu;
const inspectableHintExtensionPattern = /\.(?:cjs|hcl|js|json|mjs|sh|tf|toml|ts|ya?ml)$/iu;
const ciPathPattern =
  /^(?:\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.yml|\.gitlab\/[^/]+\.ya?ml)$/iu;

function normalizedTarget(value) {
  return targetAliases[String(value).toLocaleLowerCase("en-US")] ?? null;
}

function regularText(root, relativePath) {
  const target = path.join(root, ...relativePath.split("/"));
  if (!existsSync(target)) return null;
  const stats = lstatSync(target);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size > maximumInspectedBytes) return null;
  const bytes = readFileSync(target);
  if (bytes.includes(0)) return null;
  return bytes.toString("utf8");
}

function addEvidence(evidenceByTarget, target, relativePath) {
  if (!target) return;
  evidenceByTarget.get(target).add(relativePath);
}

function pathTarget(relativePath) {
  for (const pattern of structuralPathPatterns) {
    const match = pattern.exec(relativePath);
    if (match) return normalizedTarget(match[1]);
  }
  return null;
}

function ciTargets(content) {
  const targets = new Set();
  const inline = new RegExp(
    `^\\s*environment\\s*:\\s*["']?(${aliasSource})["']?\\s*(?:#.*)?$`,
    "gimu",
  );
  for (const match of content.matchAll(inline)) targets.add(normalizedTarget(match[1]));
  const nested = new RegExp(
    `^([ \\t]*)environment\\s*:\\s*(?:#.*)?\\n\\1[ \\t]+name\\s*:\\s*["']?(${aliasSource})["']?\\s*(?:#.*)?$`,
    "gimu",
  );
  for (const match of content.matchAll(nested)) targets.add(normalizedTarget(match[2]));
  return [...targets].filter(Boolean);
}

function packageScriptTargets(content) {
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    return [];
  }
  const targets = new Set();
  for (const name of Object.keys(value?.scripts ?? {})) {
    const match = new RegExp(
      `^(?:deploy|release)(?::|-)(?:[^:]+(?::|-))?(${aliasSource})$`,
      "iu",
    ).exec(name);
    if (match) targets.add(normalizedTarget(match[1]));
  }
  return [...targets].filter(Boolean);
}

function hintedTargets(relativePath) {
  if (
    !likelyDeliveryPathPattern.test(relativePath) ||
    !inspectableHintExtensionPattern.test(relativePath)
  ) {
    return [];
  }
  const targets = new Set();
  const tokens = relativePath.split(/[^A-Za-z]+/u).filter(Boolean);
  for (const token of tokens) {
    const target = normalizedTarget(token);
    if (target) targets.add(target);
  }
  return [...targets];
}

export function discoverDeliveryEnvironmentEvidence({ root, relativePaths } = {}) {
  const activeFiles = relativePaths ?? listActiveFiles({ root });
  const evidenceByTarget = new Map(deliveryTargets.map((target) => [target, new Set()]));
  const hintsByTarget = new Map(deliveryTargets.map((target) => [target, new Set()]));

  for (const relativePath of activeFiles) {
    const detectedFromPath = pathTarget(relativePath);
    addEvidence(evidenceByTarget, detectedFromPath, relativePath);

    if (ciPathPattern.test(relativePath)) {
      const content = regularText(root, relativePath);
      if (content !== null) {
        for (const target of ciTargets(content))
          addEvidence(evidenceByTarget, target, relativePath);
      }
    } else if (relativePath === "package.json") {
      const content = regularText(root, relativePath);
      if (content !== null) {
        for (const target of packageScriptTargets(content)) {
          addEvidence(evidenceByTarget, target, relativePath);
        }
      }
    }

    for (const target of hintedTargets(relativePath)) {
      if (target !== detectedFromPath) hintsByTarget.get(target).add(relativePath);
    }
  }

  const detectedTargets = deliveryTargets
    .map((target) => ({ evidence: [...evidenceByTarget.get(target)].sort(), target }))
    .filter((entry) => entry.evidence.length > 0);
  const ambiguousHints = deliveryTargets.flatMap((target) =>
    [...hintsByTarget.get(target)]
      .filter((relativePath) => !evidenceByTarget.get(target).has(relativePath))
      .sort()
      .map((relativePath) => ({ path: relativePath, target })),
  );
  return { ambiguousHints, detectedTargets };
}
