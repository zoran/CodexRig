/** Owns portable exact-version mise configuration and native toolchain artifact admission. */
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

/** Native pnpm releases must provide every retained framework platform before admission. */
export function nativePnpmArtifactUrls(version) {
  parseSemver(version, "Native pnpm version");
  const release = `https://github.com/pnpm/pnpm/releases/download/v${version}`;
  return Object.freeze({
    "linux-arm64": `${release}/pnpm-linux-arm64.tar.gz`,
    "linux-arm64-musl": `${release}/pnpm-linux-arm64-musl.tar.gz`,
    "linux-x64": `${release}/pnpm-linux-x64.tar.gz`,
    "linux-x64-musl": `${release}/pnpm-linux-x64-musl.tar.gz`,
    "macos-arm64": `${release}/pnpm-darwin-arm64.tar.gz`,
    "windows-x64": `${release}/pnpm-win32-x64.zip`,
  });
}

function nodeArtifactUrls(version) {
  const release = `https://nodejs.org/dist/v${version}/node-v${version}`;
  const musl = `https://unofficial-builds.nodejs.org/download/release/v${version}/node-v${version}`;
  return {
    "linux-arm64": `${release}-linux-arm64.tar.gz`,
    "linux-arm64-musl": `${musl}-linux-arm64-musl.tar.gz`,
    "linux-x64": `${release}-linux-x64.tar.gz`,
    "linux-x64-musl": `${musl}-linux-x64-musl.tar.gz`,
    "macos-arm64": `${release}-darwin-arm64.tar.gz`,
    "macos-x64": `${release}-darwin-x64.tar.gz`,
    "windows-x64": `${release}-win-x64.zip`,
  };
}

function uniqueLockedField(block, field) {
  const declarations = [...block.matchAll(new RegExp(`^${field}\\s*=.*$`, "gm"))];
  return declarations.length === 1
    ? (new RegExp(`^${field} = "([^"\\r\\n]+)"$`, "u").exec(declarations[0][0])?.[1] ?? "")
    : "";
}

/**
 * Shared candidate/publication and repository-smoke gate for the portable native toolchain.
 * Product-specific tools and secondary runtimes retain their configured lock requirements.
 */
export function candidateMiseLockFindings(content, versionLists) {
  const findings = miseLockFindings(content, versionLists);
  const blocks = miseLockBlocks(content);
  for (const tool of ["node", "pnpm"]) {
    const version = versionLists[tool]?.[0];
    if (!version) {
      findings.push(`mise.lock requires a configured primary ${tool} version`);
      continue;
    }
    const block =
      blocks.find((entry) => entry.tool === tool && entry.version === version)?.block ?? "";
    const platformBlocks = [
      ...block.matchAll(
        new RegExp(
          `^\\[tools\\.${tool}\\."platforms\\.([^"\\r\\n]+)"\\]\\r?\\n([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`,
          "gmu",
        ),
      ),
    ];
    const urls = tool === "pnpm" ? nativePnpmArtifactUrls(version) : nodeArtifactUrls(version);
    if (platformBlocks.map((match) => match[1]).join(",") !== Object.keys(urls).join(","))
      findings.push(`mise.lock ${tool} platforms must match the supported artifact matrix exactly`);
    const backend = tool === "node" ? "core:node" : "aqua:pnpm/pnpm";
    for (const [field, expected] of Object.entries({ version, backend })) {
      if (uniqueLockedField(block, field) !== expected)
        findings.push(`mise.lock ${tool} entry must include exactly one ${field} = "${expected}"`);
    }
    for (const [platform, expectedUrl] of Object.entries(urls)) {
      const artifact = platformBlocks.find((match) => match[1] === platform)?.[2] ?? "";
      const label = `mise.lock ${tool} ${platform}`;
      if (!/^sha256:[a-f0-9]{64}$/u.test(uniqueLockedField(artifact, "checksum")))
        findings.push(`${label} entry must include exactly one SHA-256 checksum`);
      if (uniqueLockedField(artifact, "url") !== expectedUrl)
        findings.push(`${label} URL must match its official versioned artifact exactly once`);
      if (tool !== "pnpm") continue;
      if (uniqueLockedField(artifact, "provenance") !== "github-attestations")
        findings.push(`${label} entry must include exactly one GitHub attestation provenance`);
      if (
        !/^https:\/\/api\.github\.com\/repos\/pnpm\/pnpm\/releases\/assets\/[1-9]\d*$/u.test(
          uniqueLockedField(artifact, "url_api"),
        )
      )
        findings.push(`${label} URL API must identify exactly one official GitHub asset`);
    }
  }
  return findings;
}
