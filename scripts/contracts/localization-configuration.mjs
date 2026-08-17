/** Owns localization configuration behavior for the versioned framework contract boundary. */
export const localizationConfigurationPath = "config/localization.json";

const strategies = new Set(["multi-locale", "pending", "single-locale"]);

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalLocale(value) {
  if (typeof value !== "string" || !value || /[\0\r\n]/u.test(value)) return null;
  try {
    const [canonical] = Intl.getCanonicalLocales(value);
    return canonical ?? null;
  } catch {
    return null;
  }
}

export function localizationConfigurationFindings(content) {
  let value;
  try {
    value = JSON.parse(String(content));
  } catch {
    return [`${localizationConfigurationPath} must contain valid JSON`];
  }
  if (!exactKeys(value, ["codeLanguage", "schemaVersion", "userFacing"])) {
    return [`${localizationConfigurationPath} must contain the complete localization shape`];
  }

  const findings = [];
  if (value.schemaVersion !== 1) findings.push("localization schemaVersion must equal 1");
  if (value.codeLanguage !== "en") {
    findings.push(
      "localization codeLanguage must remain en for source, identifiers, and technical headers",
    );
  }
  if (
    !exactKeys(value.userFacing, [
      "defaultLocale",
      "fallbackLocale",
      "strategy",
      "supportedLocales",
    ])
  ) {
    findings.push(
      "localization userFacing must own strategy, defaultLocale, fallbackLocale, and supportedLocales",
    );
    return findings;
  }

  const { defaultLocale, fallbackLocale, strategy, supportedLocales } = value.userFacing;
  if (!strategies.has(strategy)) findings.push("localization userFacing.strategy is unsupported");
  if (!Array.isArray(supportedLocales)) {
    findings.push("localization supportedLocales must be an array");
    return findings;
  }
  const canonical = supportedLocales.map(canonicalLocale);
  if (
    canonical.some((locale) => !locale) ||
    new Set(canonical).size !== canonical.length ||
    JSON.stringify(canonical) !== JSON.stringify([...canonical].sort()) ||
    JSON.stringify(canonical) !== JSON.stringify(supportedLocales)
  ) {
    findings.push(
      "localization supportedLocales must be canonical, unique, and sorted BCP 47 tags",
    );
  }

  if (strategy === "pending") {
    if (defaultLocale !== null || fallbackLocale !== null || supportedLocales.length !== 0) {
      findings.push("pending localization cannot declare default, fallback, or supported locales");
    }
    return findings;
  }

  const canonicalDefault = canonicalLocale(defaultLocale);
  const canonicalFallback = fallbackLocale === null ? null : canonicalLocale(fallbackLocale);
  if (
    !canonicalDefault ||
    canonicalDefault !== defaultLocale ||
    !supportedLocales.includes(defaultLocale)
  ) {
    findings.push("configured localization defaultLocale must be canonical and supported");
  }
  if (
    fallbackLocale !== null &&
    (!canonicalFallback ||
      canonicalFallback !== fallbackLocale ||
      !supportedLocales.includes(fallbackLocale))
  ) {
    findings.push(
      "configured localization fallbackLocale must be null or a canonical supported locale",
    );
  }
  if (strategy === "single-locale" && supportedLocales.length !== 1) {
    findings.push("single-locale localization requires exactly one supported locale");
  }
  if (strategy === "multi-locale" && supportedLocales.length < 2) {
    findings.push("multi-locale localization requires at least two supported locales");
  }
  return [...new Set(findings)];
}

export function parseLocalizationConfiguration(content) {
  const findings = localizationConfigurationFindings(content);
  if (findings.length > 0) {
    throw new Error(
      ["Localization configuration failed:", ...findings.map((item) => `- ${item}`)].join("\n"),
    );
  }
  return JSON.parse(String(content));
}

export function serializeLocalizationConfiguration(configuration = {}) {
  const supportedLocales = [...new Set(configuration.userFacing?.supportedLocales ?? [])]
    .map((locale) => canonicalLocale(locale) ?? locale)
    .sort();
  const value = {
    schemaVersion: 1,
    codeLanguage: "en",
    userFacing: {
      strategy: configuration.userFacing?.strategy ?? "pending",
      defaultLocale: configuration.userFacing?.defaultLocale ?? null,
      fallbackLocale: configuration.userFacing?.fallbackLocale ?? null,
      supportedLocales,
    },
  };
  const content = `${JSON.stringify(value, null, 2)}\n`;
  parseLocalizationConfiguration(content);
  return content;
}

export function initialLocalizationConfiguration() {
  return serializeLocalizationConfiguration();
}
