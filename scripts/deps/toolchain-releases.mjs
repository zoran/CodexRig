/** Resolves compatible stable tool and CI releases from their official distribution owners. */
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import { removeOwnedArtifact } from "../filesystem/owned-file-operations.mjs";
import { prepareProjectToolDirectories } from "../repository/project-tool-environment.mjs";
import {
  cleanGitEnvironment,
  isolatedGitResultCompleted,
} from "../repository/git-runtime-isolation.mjs";
import { spawnSyncWithBoundedIo } from "../repository/runtime-process-io.mjs";
import {
  compareSemver,
  parseSemver,
  versionSatisfiesSimpleRange,
  versionMatchesReleaseSelector,
} from "../contracts/semver-contract.mjs";
import {
  codexDistributionPlatforms,
  miseBinaryPlatforms,
  validateToolchainConfiguration,
} from "../contracts/toolchain-configuration.mjs";

/** Reads bounded public metadata or release bytes without credentials or cached fallback. */
export async function releaseBytes(url, maximumBytes, fetchImpl = globalThis.fetch) {
  const address = new URL(url);
  if (address.protocol !== "https:" || address.username || address.password)
    throw new Error("Release sources must use public HTTPS.");
  const response = await fetchImpl(address.href, {
    headers: { Accept: "application/json", "User-Agent": "CodexRig-toolchain-maintenance" },
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok)
    throw new Error(`Release lookup failed: ${address.hostname} returned HTTP ${response.status}.`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximumBytes)
      throw new Error(
        `Release response from ${address.hostname}${address.pathname} exceeded its ${maximumBytes}-byte bound.`,
      );
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function releaseJson(url, fetchImpl) {
  return JSON.parse((await releaseBytes(url, 48 * 1024 * 1024, fetchImpl)).toString("utf8"));
}

function stableVersion(value) {
  try {
    const parsed = parseSemver(value);
    return !parsed.prerelease && !parsed.build;
  } catch {
    return false;
  }
}

/** Chooses the newest stable version inside the current explicit compatibility range. */
export function latestCompatibleVersion(versions, range, current) {
  const selected = versions
    .filter((version) => stableVersion(version) && versionSatisfiesSimpleRange(version, range))
    .sort(compareSemver)
    .at(-1);
  if (!selected || compareSemver(selected, current) < 0)
    throw new Error("Compatible release freshness is indeterminate; refusing a downgrade.");
  return selected;
}

function npmUrl(name, version = "") {
  return `https://registry.npmjs.org/${encodeURIComponent(name)}${version ? `/${encodeURIComponent(version)}` : ""}`;
}

async function npmRelease(name, version, fetchImpl) {
  const data = await releaseJson(npmUrl(name, version), fetchImpl);
  if (
    data.name !== name ||
    (/^\d/u.test(version) && data.version !== version) ||
    !data.dist?.tarball ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(data.dist.integrity ?? "")
  )
    throw new Error(`Official npm release metadata is invalid for ${name}.`);
  const url = new URL(data.dist.tarball);
  if (url.origin !== "https://registry.npmjs.org")
    throw new Error("npm release archive has an unexpected origin.");
  return data;
}

async function verifyArchive(release, fetchImpl) {
  const bytes = await releaseBytes(release.dist.tarball, 256 * 1024 * 1024, fetchImpl);
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (integrity !== release.dist.integrity)
    throw new Error(`Release archive integrity failed for ${release.name}.`);
}

function noDowngrade(next, current, label) {
  if (!stableVersion(next) || compareSemver(next, current) < 0)
    throw new Error(`${label} release is unstable or older than the current pin.`);
}

/** Resolves the exact Codex platform contract; the unused npm JavaScript wrapper is not installed. */
export async function resolveCodexDistribution(
  matrix,
  specification,
  { fetchImpl = globalThis.fetch } = {},
) {
  const release = await npmRelease("@openai/codex", specification, fetchImpl);
  parseSemver(release.version, "Codex release");
  const candidate = structuredClone(matrix);
  candidate.ci.codexVersion = release.version;
  candidate.stable.codex.minimumVersion = release.version;
  for (const target of codexDistributionPlatforms) {
    const platform = await npmRelease("@openai/codex", `${release.version}-${target}`, fetchImpl);
    candidate.ci.codexNpmPlatformIntegrities[target] = platform.dist.integrity;
    if (release.version !== matrix.ci.codexVersion) await verifyArchive(platform, fetchImpl);
  }
  if (
    release.version === matrix.ci.codexVersion &&
    JSON.stringify(candidate.ci.codexNpmPlatformIntegrities) !==
      JSON.stringify(matrix.ci.codexNpmPlatformIntegrities)
  )
    throw new Error("An unchanged Codex version has different archive digests.");
  return candidate;
}

/** Resolves existing explicit compatibility selectors without changing the published stable policy. */
export async function resolveCompatibilityToolchain(
  current,
  track,
  { fetchImpl = globalThis.fetch } = {},
) {
  validateToolchainConfiguration(current);
  const matrix = await resolveCodexDistribution(current, track.codex, { fetchImpl });
  const nodes = await releaseJson("https://nodejs.org/dist/index.json", fetchImpl);
  const requested = /^\d+$/u.test(track.node)
    ? `>=${track.node}.0.0 <${Number(track.node) + 1}.0.0`
    : `>=${track.node} <=${track.node}`;
  matrix.stable.node.version = latestCompatibleVersion(
    nodes.map((entry) => entry.version.replace(/^v/u, "")),
    requested,
    /^\d+$/u.test(track.node) ? `${track.node}.0.0` : track.node,
  );
  const pnpm = await npmRelease("pnpm", track.pnpm, fetchImpl);
  parseSemver(pnpm.version, "Compatibility pnpm");
  if (
    !versionMatchesReleaseSelector(pnpm.version, track.pnpm) ||
    !versionMatchesReleaseSelector(matrix.ci.codexVersion, track.codex)
  )
    throw new Error("Resolved compatibility release does not match its declared selector.");
  matrix.stable.pnpm.version = pnpm.version;
  for (const tool of ["node", "pnpm"])
    matrix.stable[tool].range = `>=${matrix.stable[tool].version} <=${matrix.stable[tool].version}`;
  matrix.reviewedOn = new Date().toISOString().slice(0, 10);
  return validateToolchainConfiguration(matrix);
}

/** Reviews official stable releases before the shared project-local installer consumes them. */
export async function resolveToolchainReleases(current, { fetchImpl = globalThis.fetch } = {}) {
  validateToolchainConfiguration(current);
  const results = await Promise.allSettled([
    releaseJson("https://nodejs.org/dist/index.json", fetchImpl),
    releaseJson(npmUrl("pnpm"), fetchImpl),
    resolveCodexDistribution(current, "latest", { fetchImpl }),
    releaseBytes("https://mise.jdx.dev/VERSION", 128, fetchImpl),
  ]);
  for (const result of results) if (result.status === "rejected") throw result.reason;
  const [nodes, pnpm, matrix, mise] = results.map((result) => result.value);
  matrix.stable.node.version = latestCompatibleVersion(
    nodes.filter((entry) => entry.lts).map((entry) => entry.version.replace(/^v/u, "")),
    current.stable.node.range,
    current.stable.node.version,
  );
  matrix.stable.pnpm.version = latestCompatibleVersion(
    Object.keys(pnpm.versions ?? {}),
    current.stable.pnpm.range,
    current.stable.pnpm.version,
  );
  noDowngrade(matrix.ci.codexVersion, current.ci.codexVersion, "Codex");
  const miseVersion = mise.toString("utf8").trim();
  noDowngrade(miseVersion, current.ci.miseVersion, "Mise");
  const base = `https://github.com/jdx/mise/releases/download/v${miseVersion}`;
  const checksums = (await releaseBytes(`${base}/SHASUMS256.txt`, 128 * 1024, fetchImpl)).toString(
    "utf8",
  );
  const digests = new Map();
  for (const line of checksums.trim().split(/\r?\n/u)) {
    const match = /^([a-f0-9]{64})  \.\/([^\s/]+)$/u.exec(line);
    if (!match || digests.has(match[2]))
      throw new Error("Official Mise checksum manifest is invalid or ambiguous.");
    digests.set(match[2], match[1]);
  }
  matrix.ci.miseVersion = miseVersion;
  for (const platform of miseBinaryPlatforms) {
    const name = `mise-v${miseVersion}-${platform}${platform.startsWith("windows-") ? ".exe" : ""}`;
    const digest = digests.get(name);
    if (!digest)
      throw new Error(`Official Mise release is missing a binary digest for ${platform}.`);
    if (miseVersion === current.ci.miseVersion && digest !== current.ci.miseBinarySha256[platform])
      throw new Error("An unchanged Mise version has different archive digests.");
    matrix.ci.miseBinarySha256[platform] =
      miseVersion !== current.ci.miseVersion && platform === "linux-x64"
        ? await verifiedMiseBinaryDigest(
            { digest: `sha256:${digest}`, browser_download_url: `${base}/${name}` },
            fetchImpl,
          )
        : digest;
  }
  if (JSON.stringify(matrix) !== JSON.stringify(current))
    matrix.reviewedOn = new Date().toISOString().slice(0, 10);
  return validateToolchainConfiguration(matrix);
}

/** Verifies a bounded raw mise executable against its official checksum, independently of npm archives. */
export async function verifiedMiseBinaryDigest(asset, fetchImpl = globalThis.fetch) {
  if (!asset || !/^sha256:[a-f0-9]{64}$/u.test(asset.digest ?? "")) {
    throw new Error("Official mise release has no raw executable digest.");
  }
  const bytes = await releaseBytes(asset.browser_download_url, 256 * 1024 * 1024, fetchImpl);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length === 0 || `sha256:${digest}` !== asset.digest)
    throw new Error("Official mise binary integrity failed.");
  return digest;
}

/** Runs public Git discovery without host/project Git configuration, credentials, hooks or checkout. */
function withPublicGithubGit(root, spawnGit, action) {
  const locations = prepareProjectToolDirectories(root);
  const directory = mkdtempSync(path.join(locations.temporary, "release-refs-"));
  chmodSync(directory, 0o700);
  const identity = lstatSync(directory);
  const environment = {
    ...cleanGitEnvironment(process.env, root),
    HOME: directory,
    USERPROFILE: directory,
    XDG_CONFIG_HOME: directory,
    GIT_CEILING_DIRECTORIES: locations.temporary,
    GIT_CONFIG_COUNT: "0",
    GIT_ALLOW_PROTOCOL: "https",
  };
  const git = (...args) => {
    const result = spawnGit("git", args, {
      cwd: directory,
      env: environment,
      encoding: "utf8",
      input: "",
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: "pipe",
    });
    if (!isolatedGitResultCompleted(result, { args, maximumOutputBytes: 4 * 1024 * 1024 }))
      throw new Error(
        `Public GitHub release lookup failed during git ${args[0]}; freshness is indeterminate.`,
      );
    return result.stdout.trim();
  };
  try {
    return action(git);
  } finally {
    const currentIdentity = lstatSync(directory);
    if (
      currentIdentity.dev !== identity.dev ||
      currentIdentity.ino !== identity.ino ||
      !currentIdentity.isDirectory()
    )
      throw new Error("Public release lookup directory identity changed.");
    removeOwnedArtifact(root, directory, "directory", "public release lookup", {
      expectedIdentity: currentIdentity,
    });
  }
}

/** Updates immutable GitHub action pins from public Git tags, without the account/IP REST quota. */
export async function refreshGithubActions(
  content,
  { root = toolingRoot, spawnGit = spawnSyncWithBoundedIo } = {},
) {
  const pattern =
    /\buses: ([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([a-f0-9]{40}) # v(\d+\.\d+\.\d+)\b/gu;
  const updates = new Map();
  const repositories = new Map();
  for (const match of content.matchAll(pattern)) {
    if (updates.has(match[0])) continue;
    const [, repository, oldSha, current] = match;
    const major = parseSemver(current).major;
    const url = `https://github.com/${repository}.git`;
    if (!repositories.has(repository))
      repositories.set(
        repository,
        withPublicGithubGit(root, spawnGit, (git) => {
          const refs = new Map();
          for (const line of git("ls-remote", "--tags", "--exit-code", url).split("\n")) {
            const record = /^([a-f0-9]{40})\t(refs\/tags\/[^\s]+)$/u.exec(line);
            if (!record || refs.has(record[2]))
              throw new Error("GitHub action tags are invalid or ambiguous.");
            refs.set(record[2], record[1]);
          }
          return refs;
        }),
      );
    const refs = repositories.get(repository);
    const version = latestCompatibleVersion(
      [...refs.keys()].map((ref) => ref.replace(/^refs\/tags\/v/u, "")),
      `>=${current} <${major + 1}.0.0`,
      current,
    );
    const identity = (tag) => refs.get(`${tag}^{}`) ?? refs.get(tag);
    if (identity(`refs/tags/v${current}`) !== oldSha)
      throw new Error(`GitHub action ${repository} moved its existing release tag.`);
    const tag = `refs/tags/v${version}`;
    const sha = identity(tag);
    if (version !== current)
      withPublicGithubGit(root, spawnGit, (git) => {
        git("init", "--bare", "--template=", "--quiet");
        git(
          "fetch",
          "--quiet",
          "--depth=1",
          "--filter=tree:0",
          "--no-tags",
          "--no-recurse-submodules",
          "--no-auto-maintenance",
          url,
          tag,
        );
        if (git("rev-parse", "--verify", "FETCH_HEAD^{commit}") !== sha)
          throw new Error("GitHub action tag changed during lookup or has no commit identity.");
      });
    updates.set(match[0], `uses: ${repository}@${sha} # v${version}`);
  }
  return content.replace(pattern, (match) => updates.get(match));
}
