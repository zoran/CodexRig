/** Validates the minimal, exact-version mise tool configuration used by portable repositories. */
import { parseSemver } from "./semver-contract.mjs";
export function validateMinimalMiseTools(content) {
  const versions = Object.create(null);
  const versionLists = Object.create(null);
  const errors = [];
  let toolsSectionCount = 0;
  let inToolsSection = false;

  for (const [index, rawLine] of String(content).split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "[tools]") {
      toolsSectionCount += 1;
      inToolsSection = true;
      if (toolsSectionCount > 1) errors.push("must declare [tools] exactly once");
      continue;
    }
    if (line.startsWith("[")) {
      inToolsSection = false;
      errors.push(`line ${index + 1} declares a disallowed section or directive`);
      continue;
    }
    if (!inToolsSection) {
      errors.push(`line ${index + 1} defines a key outside [tools]`);
      continue;
    }
    const match = line.match(/^([a-z][a-z0-9_-]*)\s*=\s*(.+)$/u);
    if (!match) {
      errors.push(`line ${index + 1} is not a safe tool name with an exact semantic version pin`);
      continue;
    }
    const [, tool, literal] = match;
    let value;
    try {
      value = JSON.parse(literal);
    } catch {
      errors.push(`line ${index + 1} requires a quoted exact pin or pin array`);
      continue;
    }
    const pins = Array.isArray(value) ? value : [value];
    const exactPin = (pin) => {
      if (typeof pin !== "string") return false;
      if (tool === "java")
        return /^(?:[a-z][a-z0-9-]*-)?\d+\.\d+\.\d+(?:\+\d+(?:\.\d+)*(?:\.LTS)?)?$/u.test(pin);
      try {
        parseSemver(pin);
        return true;
      } catch {
        return false;
      }
    };
    if (
      !pins.length ||
      pins.length > 16 ||
      new Set(pins).size !== pins.length ||
      pins.some((pin) => !exactPin(pin))
    ) {
      errors.push(`line ${index + 1} requires unique exact version pins for ${tool}`);
      continue;
    }
    if (versions[tool]) errors.push(`${tool} must be declared exactly once`);
    else {
      versions[tool] = pins[0];
      versionLists[tool] = pins;
    }
  }

  if (toolsSectionCount !== 1) errors.push("must declare [tools] exactly once");
  for (const tool of ["node", "pnpm"]) {
    if (!versions[tool]) errors.push(`must declare ${tool} exactly once`);
  }
  return { errors, versions, versionLists };
}

/** A version array declares multiple independent locked runtimes; its first pin is the primary. */
export function miseLockBlocks(content) {
  return [
    ...String(content).matchAll(
      /^\[\[tools\.([a-z0-9_-]+)\]\]\r?\n([\s\S]*?)(?=^\[\[tools\.|$(?![\s\S]))/gmu,
    ),
  ].map(([block, tool]) => ({
    tool,
    block,
    version: /^version = "([^"\r\n]+)"$/mu.exec(block)?.[1] ?? "",
  }));
}

/** Validates all configured runtime pins, including secondary and product-specific tools. */
export function miseLockFindings(content, versionLists) {
  const blocks = miseLockBlocks(content),
    findings = [];
  const expected = Object.entries(versionLists)
    .flatMap(([tool, pins]) => pins.map((version) => `${tool}@${version}`))
    .sort();
  const actual = blocks.map(({ tool, version }) => `${tool}@${version}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    findings.push("mise.lock must contain exactly one entry per configured tool/version pin");
  for (const { tool, version, block } of blocks) {
    const label = `mise.lock ${tool}@${version}`;
    if (!/^backend = "[^"\r\n]+"$/mu.test(block))
      findings.push(`${label} must declare its resolved backend`);
    const platforms = [
      ...block.matchAll(
        /^\[tools\.[a-z0-9_-]+\."platforms\.([^"\r\n]+)"\]\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/gmu,
      ),
    ];
    if (!platforms.length) findings.push(`${label} needs a locked platform artifact`);
    if (new Set(platforms.map((match) => match[1])).size !== platforms.length)
      findings.push(`${label} has duplicate platform artifacts`);
    for (const [, platform, artifact] of platforms) {
      if (!/^checksum = "sha256:[a-f0-9]{64}"$/mu.test(artifact))
        findings.push(`${label} ${platform} needs a SHA-256 checksum`);
      if (!/^url = "https:\/\/[^"\r\n]+"$/mu.test(artifact))
        findings.push(`${label} ${platform} needs an HTTPS URL`);
    }
  }
  return findings;
}
