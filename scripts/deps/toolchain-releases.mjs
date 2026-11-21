/** Resolves compatible local tool releases from their official distribution owners. */
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
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
import { nativeNodeArtifactUrls } from "../contracts/mise-toolchain-configuration.mjs";

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
    throw Object.assign(
      new Error(`Release lookup failed: ${address.hostname} returned HTTP ${response.status}.`),
      { status: response.status, redirected: response.redirected },
    );
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

async function nativeArtifactAvailable(tool, url, fetchImpl) {
  let address = new URL(url);
  let redirects = 0;
  let retries = 0;
  const signal = AbortSignal.timeout(180_000);
  while (redirects <= 4) {
    signal.throwIfAborted();
    if (address.protocol !== "https:" || address.username || address.password)
      throw new Error(`Native ${tool} artifact sources must use public HTTPS.`);
    const response = await fetchImpl(address.href, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      headers: {
        "User-Agent": "CodexRig-toolchain-maintenance",
        Range: "bytes=0-0",
      },
      signal,
    });
    // A server may ignore Range. Availability never requires downloading the archive.
    await response.body?.cancel();
    if (response.status === 200) return true;
    if (response.status === 206) {
      if (!/^bytes 0-0\/[1-9]\d*$/u.test(response.headers.get("content-range") ?? ""))
        throw new Error(`Native ${tool} artifact range response is invalid.`);
      return true;
    }
    // Only absence at the canonical release URL establishes a missing artifact. A stale
    // redirected CDN URL, rate limit or unavailable service cannot justify an older release.
    if (response.status === 404 && redirects === 0) return false;
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Native ${tool} artifact redirect has no location.`);
      address = new URL(location, address);
      redirects += 1;
      continue;
    }
    if ([502, 503, 504].includes(response.status) && retries < 2) {
      retries += 1;
      await delay(250 * retries, undefined, { signal });
      address = new URL(url);
      continue;
    }
    throw new Error(
      `Native ${tool} artifact lookup returned HTTP ${response.status}; release availability is indeterminate.`,
    );
  }
  throw new Error(`Native ${tool} artifact lookup exceeded its redirect bound.`);
}

async function missingNodeChecksums(artifacts, fetchImpl) {
  const manifests = Map.groupBy(artifacts, ([, url]) => new URL("SHASUMS256.txt", url).href);
  const results = await Promise.allSettled(
    [...manifests].map(async ([url, entries]) => {
      let content;
      try {
        content = (await releaseBytes(url, 128 * 1024, fetchImpl)).toString("utf8");
      } catch (error) {
        if (error.status === 404 && !error.redirected) return entries.map(([platform]) => platform);
        throw error;
      }
      const files = new Set();
      for (const line of content.split(/\r?\n/u).filter(Boolean)) {
        const match = line.match(/^[a-f0-9]{64} [ *]([^\s]+)$/iu);
        if (!match || files.has(match[1]))
          throw new Error(`Node checksum manifest is malformed or ambiguous: ${url}.`);
        files.add(match[1]);
      }
      if (!files.size) throw new Error(`Node checksum manifest is empty: ${url}.`);
      return entries
        .filter(([, artifact]) => !files.has(new URL(artifact).pathname.split("/").at(-1)))
        .map(([platform]) => platform);
    }),
  );
  for (const result of results) if (result.status === "rejected") throw result.reason;
  return new Set(results.flatMap((result) => result.value));
}

async function missingNativePlatforms(tool, version, fetchImpl) {
  const urls = nativeNodeArtifactUrls(version);
  const artifacts = Object.entries(urls);
  const results = await Promise.allSettled([
    ...artifacts.map(([, url]) => nativeArtifactAvailable(tool, url, fetchImpl)),
    missingNodeChecksums(artifacts, fetchImpl),
  ]);
  for (const result of results) if (result.status === "rejected") throw result.reason;
  const missingChecksums = results.at(-1).value;
  return artifacts
    .filter(([platform], index) => !results[index].value || missingChecksums.has(platform))
    .map(([platform]) => platform);
}

async function latestCompatibleNativeVersion(
  tool,
  versions,
  range,
  current,
  { fetchImpl, onProgress },
) {
  // Keep the shared freshness check: absence of a non-older eligible version is indeterminate.
  latestCompatibleVersion(versions, range, current);
  const candidates = versions
    .filter(
      (version) =>
        stableVersion(version) &&
        versionSatisfiesSimpleRange(version, range) &&
        compareSemver(version, current) >= 0,
    )
    .sort((left, right) => compareSemver(right, left));
  let skipped = false;
  for (const version of candidates) {
    const missing = await missingNativePlatforms(tool, version, fetchImpl);
    if (missing.length) {
      onProgress(
        `Skipping ${tool} ${version}: official native artifacts or checksums missing for ${missing.join(", ")}.`,
      );
      skipped = true;
      continue;
    }
    if (skipped && version === current)
      onProgress(`Retaining ${tool} ${current}: all required native artifacts are available.`);
    return version;
  }
  throw new Error(
    `No complete compatible native ${tool} release is available; refusing a downgrade.`,
  );
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
  matrix.stable.node.version = await latestCompatibleNativeVersion(
    "node",
    nodes.map((entry) => entry.version.replace(/^v/u, "")),
    requested,
    /^\d+$/u.test(track.node) ? `${track.node}.0.0` : track.node,
    { fetchImpl, onProgress: () => {} },
  );
  const pnpm = await npmRelease("pnpm", track.pnpm, fetchImpl);
  parseSemver(pnpm.version, "Compatibility pnpm");
  if (
    !versionMatchesReleaseSelector(pnpm.version, track.pnpm) ||
    !versionMatchesReleaseSelector(matrix.ci.codexVersion, track.codex)
  )
    throw new Error("Resolved compatibility release does not match its declared selector.");
  await verifyArchive(pnpm, fetchImpl);
  matrix.stable.pnpm.version = pnpm.version;
  for (const tool of ["node", "pnpm"])
    matrix.stable[tool].range = `>=${matrix.stable[tool].version} <=${matrix.stable[tool].version}`;
  matrix.reviewedOn = new Date().toISOString().slice(0, 10);
  return validateToolchainConfiguration(matrix);
}

/** Resolves official stable releases for installation in the shared host tool store. */
export async function resolveToolchainReleases(
  current,
  { fetchImpl = globalThis.fetch, onProgress = () => {} } = {},
) {
  validateToolchainConfiguration(current);
  const results = await Promise.allSettled([
    releaseJson("https://nodejs.org/dist/index.json", fetchImpl),
    releaseJson(npmUrl("pnpm"), fetchImpl),
    resolveCodexDistribution(current, "latest", { fetchImpl }),
    releaseBytes("https://mise.jdx.dev/VERSION", 128, fetchImpl),
  ]);
  for (const result of results) if (result.status === "rejected") throw result.reason;
  const [nodes, pnpm, matrix, mise] = results.map((result) => result.value);
  matrix.stable.node.version = await latestCompatibleNativeVersion(
    "node",
    nodes.filter((entry) => entry.lts).map((entry) => entry.version.replace(/^v/u, "")),
    current.stable.node.range,
    current.stable.node.version,
    { fetchImpl, onProgress },
  );
  matrix.stable.pnpm.version = latestCompatibleVersion(
    Object.keys(pnpm.versions ?? {}),
    current.stable.pnpm.range,
    current.stable.pnpm.version,
  );
  await verifyArchive(await npmRelease("pnpm", matrix.stable.pnpm.version, fetchImpl), fetchImpl);
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
