/** Owns git provider behavior for the Git provider integration boundary. */
import { spawnSyncWithBoundedIo as spawnSync } from "../repository/runtime-process-io.mjs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readToolingConfiguration } from "../contracts/tooling-configuration.mjs";
import {
  cleanGitEnvironment,
  isolatedGitArguments,
  isolatedGitResultCompleted,
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
  const invocationArguments = isolatedGitArguments({ args, ...metadata });
  const result = spawnSync("git", invocationArguments, {
    cwd: root,
    encoding: "utf8",
    env: cleanGitEnvironment(process.env, root),
    input: "",
    maxBuffer: 1024 * 1024,
    stdio: "pipe",
    timeout: 20_000,
  });
  if (!isolatedGitResultCompleted(result, { args: invocationArguments, encoding: "utf8" })) {
    return "";
  }
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

function explicitPlatformEvidence(environment, contract) {
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
  contract = readToolingConfiguration(root),
} = {}) {
  const explicit = explicitPlatformEvidence(environment, contract);
  const remote = remoteEvidence(root, contract);
  if (
    explicit &&
    remote &&
    (explicit.provider !== remote.provider ||
      explicit.hostname !== remote.hostname ||
      explicit.slug !== remote.slug)
  ) {
    throw new Error("Explicit Git platform identity contradicts the selected Git remote.");
  }

  const evidence = remote ?? explicit;
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
      "Git remote host is not assigned to GitHub or GitLab; add the self-hosted domain to .codex/tooling.json.",
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
