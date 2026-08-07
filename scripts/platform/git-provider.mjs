import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readFrameworkContract } from "../framework/framework-contract.mjs";
import {
  cleanGitEnvironment,
  isolatedGitArguments,
  resolveOwnedGitMetadata,
} from "../repository/git-runtime-isolation.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const platformRoot = path.resolve(scriptDirectory, "..", "..");

function safeSlug(value) {
  const candidate = String(value ?? "")
    .trim()
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\.git$/iu, "");
  const segments = candidate.split("/");
  if (
    segments.length < 2 ||
    segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(segment))
  ) {
    throw new Error("Git platform repository path is invalid.");
  }
  return segments.join("/");
}

function safeHostname(value, label) {
  const hostname = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(hostname) || hostname.includes("..")) {
    throw new Error(`${label} hostname is invalid.`);
  }
  return hostname;
}

function remoteUrlParts(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!["http:", "https:", "ssh:", "git:"].includes(parsed.protocol)) return null;
    if (!parsed.hostname) return null;
    return {
      hostname: safeHostname(parsed.hostname, "Git remote"),
      slug: safeSlug(decodeURIComponent(parsed.pathname)),
    };
  } catch {
    const match = value.match(/^(?:[^@\s/:]+@)?([^:\s/]+):(.+)$/u);
    if (!match) return null;
    return {
      hostname: safeHostname(match[1], "Git remote"),
      slug: safeSlug(match[2]),
    };
  }
}

export function parseGitRemoteUrl(rawUrl) {
  const parsed = remoteUrlParts(rawUrl);
  if (!parsed) throw new Error("Git remote is not a supported network URL.");
  return parsed;
}

function providerForHost(hostname, contract) {
  for (const provider of ["github", "gitlab"]) {
    if (contract.platform.hosts[provider].includes(hostname)) return provider;
  }
  return null;
}

function runGit(root, metadata, args) {
  const result = spawnSync("git", isolatedGitArguments({ args, ...metadata }), {
    cwd: root,
    encoding: "utf8",
    env: cleanGitEnvironment(),
    input: "",
    stdio: "pipe",
  });
  if (result.error || result.status !== 0) return "";
  return result.stdout.trim();
}

function selectedRemoteName(root, metadata) {
  const branch = runGit(root, metadata, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (branch) {
    const configured = runGit(root, metadata, [
      "config",
      "--local",
      "--get",
      `branch.${branch}.remote`,
    ]);
    if (configured && configured !== ".") return configured;
  }
  const names = runGit(root, metadata, ["remote"])
    .split(/\r?\n/u)
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.includes("origin")) return "origin";
  return names.length === 1 ? names[0] : "";
}

function remoteEvidence(root, contract) {
  const metadata = resolveOwnedGitMetadata(root);
  if (!metadata) return null;
  const remoteName = selectedRemoteName(root, metadata);
  if (!remoteName) return null;
  const rawUrl =
    runGit(root, metadata, ["remote", "get-url", "--push", remoteName]) ||
    runGit(root, metadata, ["remote", "get-url", remoteName]);
  if (!rawUrl) return null;
  const parsed = parseGitRemoteUrl(rawUrl);
  const provider = providerForHost(parsed.hostname, contract);
  return { ...parsed, provider, remoteName, source: "git-remote" };
}

function ciEvidence(environment, contract) {
  const githubActions = environment.GITHUB_ACTIONS === "true";
  const gitlabCi = environment.GITLAB_CI === "true";
  if (githubActions && gitlabCi) {
    throw new Error("GitHub Actions and GitLab CI identity cannot both be active.");
  }
  if (githubActions) {
    const server = new URL(environment.GITHUB_SERVER_URL || "https://github.com");
    const hostname = safeHostname(server.hostname, "GitHub Actions");
    if (server.protocol !== "https:" || providerForHost(hostname, contract) !== "github") {
      throw new Error("GitHub Actions host is not assigned to GitHub in the framework contract.");
    }
    return {
      hostname,
      provider: "github",
      remoteName: "",
      slug: safeSlug(environment.GITHUB_REPOSITORY),
      source: "github-actions",
    };
  }
  if (gitlabCi) {
    const hostname = safeHostname(environment.CI_SERVER_HOST || "gitlab.com", "GitLab CI");
    if (providerForHost(hostname, contract) !== "gitlab") {
      throw new Error("GitLab CI host is not assigned to GitLab in the framework contract.");
    }
    return {
      hostname,
      provider: "gitlab",
      remoteName: "",
      slug: safeSlug(environment.CI_PROJECT_PATH),
      source: "gitlab-ci",
    };
  }
  const explicitProvider = environment.CODEXRIG_GIT_PROVIDER;
  if (explicitProvider && !["github", "gitlab"].includes(explicitProvider)) {
    throw new Error("CODEXRIG_GIT_PROVIDER must be github or gitlab.");
  }
  const explicitHostValue = String(environment.CODEXRIG_GIT_HOST || "").trim();
  const explicitSlug = String(environment.CODEXRIG_GIT_REPOSITORY || "").trim();
  if (!explicitProvider && !explicitHostValue && !explicitSlug) return null;
  if (!explicitProvider || !explicitHostValue || !explicitSlug) {
    throw new Error(
      "Explicit platform selection requires CODEXRIG_GIT_PROVIDER, CODEXRIG_GIT_HOST, and CODEXRIG_GIT_REPOSITORY together.",
    );
  }
  const explicitHost = safeHostname(explicitHostValue, "Explicit Git platform");
  const configured = providerForHost(explicitHost, contract);
  if (configured !== explicitProvider) {
    throw new Error("Explicit Git provider host is not assigned to that provider in the contract.");
  }
  return {
    hostname: explicitHost,
    provider: explicitProvider,
    remoteName: "",
    slug: safeSlug(explicitSlug),
    source: "environment",
  };
}

export function detectGitProvider({
  root = platformRoot,
  environment = process.env,
  contract = readFrameworkContract(root),
} = {}) {
  const ci = ciEvidence(environment, contract);
  const remote = remoteEvidence(root, contract);
  if (ci && remote?.provider && ci.provider !== remote.provider) {
    throw new Error("CI provider contradicts the selected Git remote provider.");
  }
  if (ci && remote?.slug && ci.slug !== remote.slug) {
    throw new Error("CI repository identity contradicts the selected Git remote.");
  }

  const evidence = ci ?? remote;
  const configuredProvider = contract.platform.provider;
  let provider = evidence?.provider ?? null;
  if (configuredProvider !== "auto") {
    if (provider && provider !== configuredProvider) {
      throw new Error("Configured Git provider contradicts detected platform evidence.");
    }
    provider = configuredProvider;
  }
  if (evidence && !provider) {
    throw new Error(
      "Git remote host is not assigned to GitHub or GitLab; add the self-hosted domain to .codexrig/framework.json.",
    );
  }
  if (!evidence) {
    return {
      hostname: "",
      integrationBranch: contract.platform.integrationBranch,
      provider,
      remoteName: "",
      slug: "",
      source: configuredProvider === "auto" ? "unconfigured" : "contract",
    };
  }
  if (provider === "github" && evidence.slug.split("/").length !== 2) {
    throw new Error("GitHub repository identity must contain exactly owner/repository.");
  }
  return {
    hostname: evidence.hostname,
    integrationBranch: contract.platform.integrationBranch,
    provider,
    remoteName: evidence.remoteName,
    slug: evidence.slug,
    source: evidence.source,
  };
}

export function platformCiPath(provider) {
  if (provider === "github") return ".github/workflows/ci.yml";
  if (provider === "gitlab") return ".gitlab-ci.yml";
  return null;
}
