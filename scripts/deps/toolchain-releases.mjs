/** Resolves compatible stable tool and CI releases from their official distribution owners. */
import { createHash } from "node:crypto";
import {
  compareSemver,
  parseSemver,
  versionSatisfiesSimpleRange,
} from "../contracts/semver-contract.mjs";
import { validateToolchainConfiguration } from "../contracts/toolchain-configuration.mjs";

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
    (version !== "latest" && data.version !== version) ||
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
  const bytes = await releaseBytes(release.dist.tarball, 160 * 1024 * 1024, fetchImpl);
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (integrity !== release.dist.integrity)
    throw new Error(`Release archive integrity failed for ${release.name}.`);
}

function noDowngrade(next, current, label) {
  if (!stableVersion(next) || compareSemver(next, current) < 0)
    throw new Error(`${label} release is unstable or older than the current pin.`);
}

/** Reviews tool versions and archive digests before any project or host update. */
export async function resolveToolchainReleases(current, { fetchImpl = globalThis.fetch } = {}) {
  const matrix = structuredClone(validateToolchainConfiguration(current));
  const results = await Promise.allSettled([
    releaseJson("https://nodejs.org/dist/index.json", fetchImpl),
    releaseJson(npmUrl("pnpm"), fetchImpl),
    npmRelease("@openai/codex", "latest", fetchImpl),
    npmRelease("@jdxcode/mise-linux-x64", "latest", fetchImpl),
  ]);
  for (const result of results) if (result.status === "rejected") throw result.reason;
  const [nodes, pnpm, codex, mise] = results.map((result) => result.value);
  matrix.stable.node.version = latestCompatibleVersion(
    nodes.filter((entry) => entry.lts).map((entry) => entry.version.replace(/^v/u, "")),
    matrix.stable.node.range,
    matrix.stable.node.version,
  );
  matrix.stable.pnpm.version = latestCompatibleVersion(
    Object.keys(pnpm.versions ?? {}),
    matrix.stable.pnpm.range,
    matrix.stable.pnpm.version,
  );
  noDowngrade(codex.version, current.ci.codexVersion, "Codex");
  noDowngrade(mise.version, current.ci.miseVersion, "mise");
  const codexChanged = codex.version !== current.ci.codexVersion;
  const miseChanged = mise.version !== current.ci.miseVersion;
  matrix.ci.codexVersion = codex.version;
  matrix.ci.codexNpmPackageIntegrity = codex.dist.integrity;
  matrix.stable.codex.minimumVersion = codex.version;
  matrix.ci.miseVersion = mise.version;
  const archives = [codex];
  for (const architecture of ["x64", "arm64"]) {
    const platform = await npmRelease(
      "@openai/codex",
      `${codex.version}-linux-${architecture}`,
      fetchImpl,
    );
    const misePlatform =
      architecture === "x64"
        ? mise
        : await npmRelease(`@jdxcode/mise-linux-${architecture}`, mise.version, fetchImpl);
    matrix.ci.codexNpmPlatformIntegrities[architecture] = platform.dist.integrity;
    matrix.ci.miseNpmPackageIntegrities[architecture] = misePlatform.dist.integrity;
    if (codexChanged) archives.push(platform);
    if (miseChanged) await verifyArchive(misePlatform, fetchImpl);
  }
  if (
    !codexChanged &&
    (matrix.ci.codexNpmPackageIntegrity !== current.ci.codexNpmPackageIntegrity ||
      JSON.stringify(matrix.ci.codexNpmPlatformIntegrities) !==
        JSON.stringify(current.ci.codexNpmPlatformIntegrities))
  )
    throw new Error("An unchanged Codex version has different archive digests.");
  if (
    !miseChanged &&
    JSON.stringify(matrix.ci.miseNpmPackageIntegrities) !==
      JSON.stringify(current.ci.miseNpmPackageIntegrities)
  )
    throw new Error("An unchanged mise version has different archive digests.");
  if (codexChanged) for (const archive of archives) await verifyArchive(archive, fetchImpl);
  if (miseChanged) {
    const release = await releaseJson(
      `https://api.github.com/repos/jdx/mise/releases/tags/v${mise.version}`,
      fetchImpl,
    );
    const asset = release.assets?.find((entry) => entry.name === `mise-v${mise.version}-linux-x64`);
    matrix.ci.miseLinuxX64Sha256 = await verifiedMiseBinaryDigest(asset, fetchImpl);
  }
  if (JSON.stringify(matrix) !== JSON.stringify(current))
    matrix.reviewedOn = new Date().toISOString().slice(0, 10);
  return validateToolchainConfiguration(matrix);
}

/** Verifies a raw mise executable against its official asset size and digest, independently of compressed npm archives. */
export async function verifiedMiseBinaryDigest(asset, fetchImpl = globalThis.fetch) {
  if (
    !asset ||
    !/^sha256:[a-f0-9]{64}$/u.test(asset.digest ?? "") ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    asset.size > 256 * 1024 * 1024
  ) {
    throw new Error("Official mise release has no bounded raw executable size and digest.");
  }
  const bytes = await releaseBytes(asset.browser_download_url, asset.size, fetchImpl);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== asset.size || `sha256:${digest}` !== asset.digest)
    throw new Error("Official mise binary size or integrity failed.");
  return digest;
}

/** Updates SHA-pinned GitHub actions within each annotated stable major line. */
export async function refreshGithubActions(content, { fetchImpl = globalThis.fetch } = {}) {
  const pattern =
    /\buses: ([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([a-f0-9]{40}) # v(\d+\.\d+\.\d+)\b/gu;
  const updates = new Map();
  for (const match of content.matchAll(pattern)) {
    if (updates.has(match[0])) continue;
    const [, repository, oldSha, current] = match;
    const major = parseSemver(current).major;
    const refs = await releaseJson(
      `https://api.github.com/repos/${repository}/git/matching-refs/tags/v${major}.`,
      fetchImpl,
    );
    if (!Array.isArray(refs)) throw new Error("GitHub action tags could not be inspected.");
    const version = latestCompatibleVersion(
      refs.map((ref) => ref.ref?.replace(/^refs\/tags\/v/u, "")),
      `>=${current} <${major + 1}.0.0`,
      current,
    );
    let object = refs.find((ref) => ref.ref === `refs/tags/v${version}`)?.object;
    for (let depth = 0; object?.type === "tag" && depth < 4; depth += 1)
      object = (
        await releaseJson(
          `https://api.github.com/repos/${repository}/git/tags/${object.sha}`,
          fetchImpl,
        )
      ).object;
    if (object?.type !== "commit" || !/^[a-f0-9]{40}$/u.test(object.sha))
      throw new Error("GitHub action tag has no bounded commit identity.");
    if (version === current && oldSha !== object.sha)
      throw new Error(`GitHub action ${repository} moved its existing release tag.`);
    updates.set(match[0], `uses: ${repository}@${object.sha} # v${version}`);
  }
  return content.replace(pattern, (match) => updates.get(match));
}
