/** Owns local launcher and Git provider configuration, independent of framework release/upgrade state. */
import {
  normalizeRepositoryPath,
  parseJsonFile,
  toolingRoot,
} from "../filesystem/repository-files.mjs";
import { parseSemver } from "./semver-contract.mjs";

export const toolingConfigurationPath = ".codex/tooling.json";
function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function requiredObject(value, label) {
  if (!plainObject(value)) throw new Error(`${label} must be a JSON object.`);
  return value;
}
function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string.`);
  return value;
}
function requiredInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function stringArray(value, label, { paths = false } = {}) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }
  const normalized = value.map((entry, index) =>
    paths
      ? normalizeRepositoryPath(entry, `${label}[${index}]`)
      : requiredString(entry, `${label}[${index}]`),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return normalized;
}

function normalizedProviderApiBase(value, label, provider, remoteHost) {
  const source = requiredString(value, label);
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw new Error(`${label} must be an absolute HTTPS URL.`);
  }
  const apiHost = parsed.hostname.toLowerCase();
  const officialGithubApi =
    provider === "github" && remoteHost === "github.com" && apiHost === "api.github.com";
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (apiHost !== remoteHost && !officialGithubApi)
  ) {
    throw new Error(`${label} must be a credential-free HTTPS URL owned by ${remoteHost}.`);
  }
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    throw new Error(`${label} contains invalid path encoding.`);
  }
  if (
    decodedPath.includes("//") ||
    decodedPath.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`${label} contains an unsafe API path.`);
  }
  const pathName = parsed.pathname.replace(/\/+$/u, "");
  return `${parsed.origin}${pathName === "/" ? "" : pathName}`;
}

/** Accepts only the current local runtime configuration; provenance grants no maintenance authority. */
export function validateToolingConfiguration(value) {
  const contract = requiredObject(value, "Project tooling configuration");
  if (
    contract.schemaVersion !== 1 ||
    Object.keys(contract).sort().join(",") !==
      "platform,productConfigurationRequired,protocol,schemaVersion,startup"
  ) {
    throw new Error("Unsupported project tooling configuration.");
  }
  if (typeof contract.productConfigurationRequired !== "boolean")
    throw new Error("Project tooling must declare whether product configuration is required.");
  if (!/^[a-z][a-z0-9-]{0,31}$/u.test(contract.protocol?.id ?? ""))
    throw new Error("Unsupported native session protocol.");
  parseSemver(contract.protocol.version, "native session protocol version");
  const startup = requiredObject(contract.startup, "startup");
  const maxAge = requiredInteger(
    startup.attestationMaxAgeSeconds,
    "startup.attestationMaxAgeSeconds",
  );
  if (maxAge < 60 || maxAge > 86_400) {
    throw new Error("startup.attestationMaxAgeSeconds must be between 60 and 86400.");
  }

  const platform = requiredObject(contract.platform, "platform");
  if (!["auto", "github", "gitlab"].includes(platform.provider)) {
    throw new Error("platform.provider must be auto, github, or gitlab.");
  }
  const integrationBranch = requiredString(
    platform.integrationBranch,
    "platform.integrationBranch",
  );
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/u.test(integrationBranch) ||
    integrationBranch.includes("..") ||
    integrationBranch.includes("//") ||
    integrationBranch.includes("@{") ||
    integrationBranch.endsWith(".lock")
  ) {
    throw new Error("platform.integrationBranch must be a safe Git branch name.");
  }
  const hosts = requiredObject(platform.hosts, "platform.hosts");
  for (const provider of ["github", "gitlab"]) {
    const providerHosts = stringArray(hosts[provider], `platform.hosts.${provider}`);
    for (const host of providerHosts) {
      if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(host) || host.includes("..")) {
        throw new Error(`platform.hosts.${provider} contains an invalid host.`);
      }
    }
  }
  const overlappingHosts = hosts.github.filter((host) => hosts.gitlab.includes(host));
  if (overlappingHosts.length > 0) {
    throw new Error("GitHub and GitLab host ownership must not overlap.");
  }
  const apiBaseUrls = requiredObject(platform.apiBaseUrls, "platform.apiBaseUrls");
  for (const provider of ["github", "gitlab"]) {
    const providerUrls = requiredObject(apiBaseUrls[provider], `platform.apiBaseUrls.${provider}`);
    const expectedHosts = new Set(hosts[provider]);
    if (
      Object.keys(providerUrls).length !== expectedHosts.size ||
      Object.keys(providerUrls).some((host) => !expectedHosts.has(host))
    ) {
      throw new Error(`platform.apiBaseUrls.${provider} must map every owned host exactly once.`);
    }
    for (const host of hosts[provider]) {
      providerUrls[host] = normalizedProviderApiBase(
        providerUrls[host],
        `platform.apiBaseUrls.${provider}.${host}`,
        provider,
        host,
      );
    }
  }
  const ci = requiredObject(platform.ci, "platform.ci");
  requiredString(ci.requiredCheck, "platform.ci.requiredCheck");
  const protection = requiredObject(platform.protection, "platform.protection");
  const approvals = requiredInteger(
    protection.requiredApprovals,
    "platform.protection.requiredApprovals",
  );
  if (approvals > 10) throw new Error("platform.protection.requiredApprovals must not exceed 10.");
  if (typeof protection.requireCodeOwnerReview !== "boolean") {
    throw new Error("platform.protection.requireCodeOwnerReview must be boolean.");
  }
  for (const field of [
    "preventAuthorApproval",
    "preventCommitterApproval",
    "preventApprovalRuleOverrides",
    "resetApprovalsOnPush",
  ]) {
    if (typeof protection[field] !== "boolean") {
      throw new Error(`platform.protection.${field} must be boolean.`);
    }
  }
  if (!["disabled", "prefer", "required"].includes(protection.mergeSerialization)) {
    throw new Error(
      "platform.protection.mergeSerialization must be disabled, prefer, or required.",
    );
  }

  return contract;
}

export function readToolingConfiguration(root = toolingRoot) {
  return validateToolingConfiguration(
    parseJsonFile(root, toolingConfigurationPath, "Project tooling configuration"),
  );
}
