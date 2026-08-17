/** Validates the minimal, exact-version mise tool configuration used by portable repositories. */
export function validateMinimalMiseTools(content) {
  const versions = Object.create(null);
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
    const match = line.match(/^([a-z][a-z0-9_-]*)\s*=\s*"(\d+\.\d+\.\d+)"$/u);
    if (!match) {
      errors.push(`line ${index + 1} is not a safe tool name with an exact semantic version pin`);
      continue;
    }
    const [, tool, version] = match;
    if (versions[tool]) errors.push(`${tool} must be declared exactly once`);
    else versions[tool] = version;
  }

  if (toolsSectionCount !== 1) errors.push("must declare [tools] exactly once");
  for (const tool of ["node", "pnpm"]) {
    if (!versions[tool]) errors.push(`must declare ${tool} exactly once`);
  }
  return { errors, versions };
}
