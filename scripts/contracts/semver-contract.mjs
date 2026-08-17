/** Owns the strict SemVer contract for parsing, comparison, and simple range evaluation. */
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

export function parseSemver(value, label = "version") {
  const match = requiredString(value, label).match(semverPattern);
  if (!match) throw new Error(`${label} must use semantic versioning.`);
  const components = match.slice(1, 4).map(Number);
  if (components.some((component) => !Number.isSafeInteger(component))) {
    throw new Error(`${label} contains an unsupported numeric component.`);
  }
  return {
    build: match[5] ?? "",
    major: components[0],
    minor: components[1],
    patch: components[2],
    prerelease: match[4] ?? "",
    raw: value,
  };
}

export function compareSemver(left, right) {
  const a = typeof left === "string" ? parseSemver(left) : left;
  const b = typeof right === "string" ? parseSemver(right) : right;
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  const leftIdentifiers = a.prerelease.split(".");
  const rightIdentifiers = b.prerelease.split(".");
  const count = Math.max(leftIdentifiers.length, rightIdentifiers.length);
  for (let index = 0; index < count; index += 1) {
    const leftIdentifier = leftIdentifiers[index];
    const rightIdentifier = rightIdentifiers[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/u.test(leftIdentifier);
    const rightNumeric = /^\d+$/u.test(rightIdentifier);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    if (leftNumeric && leftIdentifier.length !== rightIdentifier.length) {
      return leftIdentifier.length < rightIdentifier.length ? -1 : 1;
    }
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

export function versionSatisfiesSimpleRange(version, range) {
  const parsed = parseSemver(version);
  const clauses = requiredString(range, "compatibility range").split(/\s+/u).filter(Boolean);
  if (clauses.length === 0) return false;
  return clauses.every((clause) => {
    const match = clause.match(/^(>=|>|<=|<|=)(.+)$/u);
    if (!match) throw new Error(`Unsupported compatibility range clause: ${clause}.`);
    const comparison = compareSemver(parsed, parseSemver(match[2], "range version"));
    if (match[1] === ">=") return comparison >= 0;
    if (match[1] === ">") return comparison > 0;
    if (match[1] === "<=") return comparison <= 0;
    if (match[1] === "<") return comparison < 0;
    return comparison === 0;
  });
}
