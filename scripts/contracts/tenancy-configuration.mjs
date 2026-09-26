/** Owns tenancy configuration behavior for the versioned framework contract boundary. */
export const tenancyConfigurationPath = "config/tenancy.json";

export const trustedTenantContextSources = Object.freeze([
  "authenticated-membership",
  "control-plane",
  "signed-integration",
  "trusted-job-envelope",
  "verified-domain",
]);

const trustedSourceSet = new Set(trustedTenantContextSources);
const resolutionStrategies = new Set([
  "composed-trusted-sources",
  "pending",
  "single-trusted-source",
]);
const tenantKeyPattern = /^[A-Za-z][A-Za-z0-9_]{1,63}$/u;
const moduleScopes = new Set(["tenant-owned", "tenant-independent", "control-plane"]);

function publicPath(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value) &&
    value.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

function pathList(value, minimum = 0) {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= 64 &&
    value.every(publicPath) &&
    new Set(value).size === value.length
  );
}

function ownershipFindings(value) {
  const findings = [];
  const boundaryRoots = [];
  if (!Array.isArray(value.contextBoundaries) || value.contextBoundaries.length > 64) {
    findings.push("tenancy contextBoundaries must be a bounded list of trusted runtime boundaries");
  } else {
    for (const boundary of value.contextBoundaries) {
      if (
        !exactKeys(boundary, ["root", "resolver", "policy", "publicContract"]) ||
        !Object.values(boundary).every(publicPath) ||
        [boundary.resolver, boundary.policy, boundary.publicContract].some(
          (file) => !file.startsWith(`${boundary.root}/`),
        ) ||
        new Set([boundary.resolver, boundary.policy, boundary.publicContract]).size !== 3 ||
        boundaryRoots.some(
          (root) =>
            root === boundary.root ||
            root.startsWith(`${boundary.root}/`) ||
            boundary.root.startsWith(`${root}/`),
        )
      ) {
        findings.push(
          "tenancy contextBoundaries require non-overlapping roots and distinct contained resolver, policy and publicContract files",
        );
      } else boundaryRoots.push(boundary.root);
    }
  }
  if (!Array.isArray(value.modulePolicies) || value.modulePolicies.length > 256) {
    return [
      ...findings,
      "tenancy modulePolicies must be a bounded list of manifest-owned policies",
    ];
  }
  const modules = new Set();
  for (const entry of value.modulePolicies) {
    if (
      !exactKeys(entry, ["module", "scope", "rationale", "enforcement", "evidence"]) ||
      !publicPath(entry.module) ||
      modules.has(entry.module) ||
      !moduleScopes.has(entry.scope) ||
      typeof entry.rationale !== "string" ||
      !entry.rationale.trim() ||
      entry.rationale.length > 1000 ||
      !pathList(entry.enforcement, entry.scope === "tenant-independent" ? 0 : 1) ||
      entry.enforcement.some((file) => !file.startsWith(`${entry.module}/`)) ||
      !Array.isArray(entry.evidence) ||
      entry.evidence.length > 16 ||
      (entry.scope !== "tenant-independent" && entry.evidence.length === 0) ||
      (entry.scope === "tenant-independent" &&
        (entry.enforcement.length > 0 || entry.evidence.length > 0))
    ) {
      findings.push(
        "tenancy module policy requires a unique module, explicit scope/rationale and scope-appropriate enforcement/evidence",
      );
      continue;
    }
    modules.add(entry.module);
    const commands = new Set();
    for (const evidence of entry.evidence) {
      if (
        !exactKeys(evidence, ["command", "tests"]) ||
        typeof evidence.command !== "string" ||
        !/^[a-z][a-z0-9:-]*$/u.test(evidence.command) ||
        commands.has(evidence.command) ||
        !pathList(evidence.tests, 1)
      ) {
        findings.push(
          `tenancy module ${entry.module} requires unique selected command references and concrete test paths`,
        );
        continue;
      }
      commands.add(evidence.command);
    }
  }
  return findings;
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalSources(value) {
  return [...new Set(value)].sort();
}

export function tenancyConfigurationFindings(content) {
  let value;
  try {
    value = JSON.parse(String(content));
  } catch {
    return [`${tenancyConfigurationPath} must contain valid JSON`];
  }

  if (
    !exactKeys(value, [
      "contextBoundaries",
      "crossTenantOperations",
      "isolation",
      "modulePolicies",
      "schemaVersion",
      "tenantContext",
    ])
  ) {
    return [`${tenancyConfigurationPath} must contain the complete tenant-isolation shape`];
  }

  const findings = [];
  if (value.schemaVersion !== 2) findings.push("tenancy configuration schemaVersion must equal 2");
  findings.push(...ownershipFindings(value));
  if (
    !exactKeys(value.tenantContext, ["key", "required", "resolutionStrategy", "trustedSources"])
  ) {
    findings.push(
      "tenancy configuration tenantContext must own key, required, resolutionStrategy, and trustedSources",
    );
  } else {
    if (!tenantKeyPattern.test(value.tenantContext.key)) {
      findings.push("tenancy configuration tenantContext.key must be a safe explicit identifier");
    }
    if (value.tenantContext.required !== true) {
      findings.push("tenancy configuration tenantContext.required must remain true");
    }
    if (!resolutionStrategies.has(value.tenantContext.resolutionStrategy)) {
      findings.push("tenancy configuration tenantContext.resolutionStrategy is unsupported");
    }
    if (
      !Array.isArray(value.tenantContext.trustedSources) ||
      value.tenantContext.trustedSources.some((source) => !trustedSourceSet.has(source)) ||
      JSON.stringify(value.tenantContext.trustedSources) !==
        JSON.stringify(canonicalSources(value.tenantContext.trustedSources))
    ) {
      findings.push(
        "tenancy configuration tenantContext.trustedSources must be supported, unique, and sorted",
      );
    } else if (value.tenantContext.resolutionStrategy === "pending") {
      if (value.tenantContext.trustedSources.length !== 0) {
        findings.push("pending tenant-context resolution cannot declare trusted sources");
      }
    } else {
      const expectedStrategy =
        value.tenantContext.trustedSources.length === 1
          ? "single-trusted-source"
          : "composed-trusted-sources";
      if (value.tenantContext.trustedSources.length === 0) {
        findings.push("active tenant-context resolution requires at least one trusted source");
      } else if (value.tenantContext.resolutionStrategy !== expectedStrategy) {
        findings.push(
          `tenant-context resolutionStrategy must be ${expectedStrategy} for the configured trusted sources`,
        );
      }
    }
  }

  const expectedIsolation = {
    authorization: "tenant-and-resource",
    cache: "tenant-scoped",
    data: "tenant-scoped",
    files: "tenant-scoped",
    messagesAndJobs: "tenant-scoped",
    observability: "tenant-correlated",
  };
  if (
    !exactKeys(value.isolation, Object.keys(expectedIsolation)) ||
    Object.entries(expectedIsolation).some(([key, expected]) => value.isolation[key] !== expected)
  ) {
    findings.push(
      "tenancy configuration isolation must keep authorization, data, cache, files, messages/jobs, and observability tenant-scoped",
    );
  }

  if (
    !exactKeys(value.crossTenantOperations, ["audited", "default", "requireExplicitCapability"]) ||
    value.crossTenantOperations.default !== "forbidden" ||
    value.crossTenantOperations.requireExplicitCapability !== true ||
    value.crossTenantOperations.audited !== true
  ) {
    findings.push(
      "tenancy configuration crossTenantOperations must be forbidden by default, explicit-capability-only, and audited",
    );
  }

  return [...new Set(findings)];
}

export function parseTenancyConfiguration(content) {
  const findings = tenancyConfigurationFindings(content);
  if (findings.length > 0) {
    throw new Error(
      ["Tenancy configuration failed:", ...findings.map((item) => `- ${item}`)].join("\n"),
    );
  }
  return JSON.parse(String(content));
}

export function serializeTenancyConfiguration(configuration) {
  const value = {
    schemaVersion: 2,
    tenantContext: {
      key: configuration.tenantContext?.key ?? "tenantId",
      required: true,
      resolutionStrategy: configuration.tenantContext?.resolutionStrategy ?? "pending",
      trustedSources: canonicalSources(configuration.tenantContext?.trustedSources ?? []),
    },
    isolation: {
      authorization: "tenant-and-resource",
      data: "tenant-scoped",
      cache: "tenant-scoped",
      files: "tenant-scoped",
      messagesAndJobs: "tenant-scoped",
      observability: "tenant-correlated",
    },
    crossTenantOperations: {
      default: "forbidden",
      requireExplicitCapability: true,
      audited: true,
    },
    contextBoundaries: configuration.contextBoundaries ?? [],
    modulePolicies: configuration.modulePolicies ?? [],
  };
  const content = `${JSON.stringify(value, null, 2)}\n`;
  parseTenancyConfiguration(content);
  return content;
}

export function initialTenancyConfiguration() {
  return serializeTenancyConfiguration({ tenantContext: { trustedSources: [] } });
}
