/** Owns product configuration behavior for the versioned framework contract boundary. */
export const productConfigurationPath = "config/product.json";

const maximumConfigurationBytes = 65_536;
const maximumConfigurationDepth = 16;
const reservedSecretKeyPattern =
  /(?:secret|password|passphrase|credential|private[-_]?key|api[-_]?key|api[-_]?token|access[-_]?token|auth(?:entication)?[-_]?token|bearer[-_]?token|id[-_]?token|refresh[-_]?token|session[-_]?token)/iu;
const safeConfigurationKeyPattern = /^[A-Za-z][A-Za-z0-9_-]*$/u;

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function valueFindings(value, label, depth = 0) {
  if (depth > maximumConfigurationDepth) {
    return [`${label} exceeds the maximum configuration depth`];
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return [];
  }
  if (typeof value === "string") {
    const findings = [];

    if (/[\0\r\n]/u.test(value)) findings.push(`${label} contains a control or multiline value`);
    return findings;
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => valueFindings(entry, `${label}[${index}]`, depth + 1));
  }
  if (!plainObject(value)) return [`${label} contains an unsupported value`];

  const findings = [];
  for (const [key, entry] of Object.entries(value)) {
    if (!safeConfigurationKeyPattern.test(key)) {
      findings.push(`${label} contains an unsafe key ${key}`);
    }
    if (reservedSecretKeyPattern.test(key)) {
      findings.push(`${label}.${key} belongs in the secret boundary, not product configuration`);
    }
    findings.push(...valueFindings(entry, `${label}.${key}`, depth + 1));
  }
  return findings;
}

export function productConfigurationFindings(content) {
  const source = String(content);
  if (Buffer.byteLength(source, "utf8") > maximumConfigurationBytes) {
    return [`${productConfigurationPath} exceeds ${maximumConfigurationBytes} bytes`];
  }

  let value;
  try {
    value = JSON.parse(source);
  } catch {
    return [`${productConfigurationPath} must contain valid JSON`];
  }
  const findings = [];
  if (!exactKeys(value, ["brand", "identity", "public", "schemaVersion"])) {
    return [
      `${productConfigurationPath} must contain the complete white-label configuration shape`,
    ];
  }
  if (value.schemaVersion !== 1) findings.push("product configuration schemaVersion must equal 1");
  if (!exactKeys(value.identity, ["applicationIds", "displayName", "organizationName"])) {
    findings.push(
      "product configuration identity must own displayName, organizationName, and applicationIds",
    );
  } else {
    if (
      value.identity.displayName !== null &&
      (typeof value.identity.displayName !== "string" ||
        !value.identity.displayName.trim() ||
        /[\0\r\n]/u.test(value.identity.displayName))
    ) {
      findings.push(
        "product configuration identity.displayName must be null or a non-empty single line",
      );
    }
    if (
      value.identity.organizationName !== null &&
      (typeof value.identity.organizationName !== "string" ||
        !value.identity.organizationName.trim())
    ) {
      findings.push("product configuration identity.organizationName must be null or non-empty");
    }
    if (!plainObject(value.identity.applicationIds)) {
      findings.push("product configuration identity.applicationIds must be an object");
    }
  }
  if (!exactKeys(value.brand, ["assets", "theme"])) {
    findings.push("product configuration brand must own assets and theme maps");
  } else if (!plainObject(value.brand.assets) || !plainObject(value.brand.theme)) {
    findings.push("product configuration brand assets and theme must be objects");
  }
  if (!exactKeys(value.public, ["contacts", "domains", "social", "urls"])) {
    findings.push("product configuration public must own contacts, domains, social, and URL maps");
  } else if (
    !plainObject(value.public.contacts) ||
    !plainObject(value.public.domains) ||
    !plainObject(value.public.social) ||
    !plainObject(value.public.urls)
  ) {
    findings.push(
      "product configuration public contacts, domains, social, and URLs must be objects",
    );
  }
  findings.push(...valueFindings(value, "product configuration"));
  return [...new Set(findings)];
}

export function parseProductConfiguration(content) {
  const findings = productConfigurationFindings(content);
  if (findings.length > 0) {
    throw new Error(["White-label product configuration failed:", ...findings].join("\n- "));
  }
  return JSON.parse(String(content));
}

export function initialProductConfiguration(repositoryName) {
  const value = {
    schemaVersion: 1,
    identity: {
      displayName: null,
      organizationName: null,
      applicationIds: {},
    },
    brand: { assets: {}, theme: {} },
    public: { contacts: {}, domains: {}, social: {}, urls: {} },
  };
  if (!String(repositoryName).trim()) throw new Error("Generated project name must be non-empty.");
  const content = `${JSON.stringify(value, null, 2)}\n`;
  parseProductConfiguration(content);
  return content;
}

function collectStrings(value, values) {
  if (typeof value === "string" && value.length >= 4) values.add(value);
  else if (Array.isArray(value)) value.forEach((entry) => collectStrings(entry, values));
  else if (plainObject(value))
    Object.values(value).forEach((entry) => collectStrings(entry, values));
}

export function configuredProductFacingValues(configuration) {
  const values = new Set();
  collectStrings(configuration.identity, values);
  collectStrings(configuration.brand, values);
  collectStrings(configuration.public, values);
  return [...values].sort();
}
