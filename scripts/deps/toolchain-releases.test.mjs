/** Verifies toolchain releases against every supported native pnpm artifact. */
import assert from "node:assert/strict";
import test from "node:test";
import { readToolchainConfiguration } from "../contracts/toolchain-configuration.mjs";
import { resolveCompatibilityToolchain, resolveToolchainReleases } from "./toolchain-releases.mjs";

function fixture({ versions = ["11.28.0", "11.28.3"], artifact = () => 200 } = {}) {
  const matrix = readToolchainConfiguration();
  matrix.stable.pnpm.version = "11.28.0";
  matrix.stable.pnpm.range = ">=11.0.0 <12.0.0";
  const calls = [],
    progress = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "HEAD") {
      assert.equal(options.redirect, "manual");
      assert.equal(options.credentials, "omit");
      const result = await artifact(url);
      return result instanceof Response ? result : new Response(null, { status: result });
    }
    let data;
    const decoded = decodeURIComponent(url);
    if (decoded === "https://nodejs.org/dist/index.json")
      data = [{ version: `v${matrix.stable.node.version}`, lts: "Krypton" }];
    else if (decoded === "https://registry.npmjs.org/pnpm")
      data = { versions: Object.fromEntries(versions.map((version) => [version, {}])) };
    else if (decoded.startsWith("https://registry.npmjs.org/pnpm/"))
      data = {
        name: "pnpm",
        version: decoded.split("/").at(-1),
        dist: {
          tarball: "https://registry.npmjs.org/pnpm.tgz",
          integrity: matrix.ci.codexNpmPlatformIntegrities["linux-x64"],
        },
      };
    else if (decoded.startsWith("https://registry.npmjs.org/@openai/codex/")) {
      const requested = decoded.split("/").at(-1);
      const platform = requested.match(/-(linux-x64|linux-arm64|darwin-arm64|win32-x64)$/u)?.[1];
      data = {
        name: "@openai/codex",
        version: platform ? requested : matrix.ci.codexVersion,
        dist: {
          tarball: "https://registry.npmjs.org/codex.tgz",
          integrity: matrix.ci.codexNpmPlatformIntegrities[platform ?? "linux-x64"],
        },
      };
    } else if (decoded === "https://mise.jdx.dev/VERSION")
      return new Response(matrix.ci.miseVersion);
    else if (decoded.endsWith("/SHASUMS256.txt"))
      return new Response(
        Object.entries(matrix.ci.miseBinarySha256)
          .map(
            ([platform, digest]) =>
              `${digest}  ./mise-v${matrix.ci.miseVersion}-${platform}${platform.startsWith("windows-") ? ".exe" : ""}`,
          )
          .join("\n"),
      );
    else throw new Error(`Unexpected release request: ${url}`);
    return new Response(JSON.stringify(data));
  };
  return {
    matrix,
    calls,
    progress,
    options: { fetchImpl, onProgress: (line) => progress.push(line) },
  };
}

test("native selection skips incomplete releases and picks the newest complete compatible version", async () => {
  const state = fixture({
    versions: ["11.28.0", "11.28.1", "11.28.2", "11.28.3", "11.29.0-beta.1", "12.0.0"],
    artifact: (url) =>
      url.includes("/v11.28.3/") && url.endsWith("pnpm-linux-arm64-musl.tar.gz") ? 404 : 200,
  });
  const candidate = await resolveToolchainReleases(state.matrix, state.options);
  assert.equal(candidate.stable.pnpm.version, "11.28.2");
  assert.ok(state.progress.some((line) => /11\.28\.3.*linux-arm64-musl/u.test(line)));
  const probes = state.calls.filter(({ options }) => options.method === "HEAD");
  assert.equal(probes.length, 12);
  assert.ok(probes.every(({ url }) => /\/v11\.28\.[23]\//u.test(url)));
  assert.ok(state.calls.every(({ url }) => !url.startsWith("https://api.github.com/")));
});

test("a complete current pin is retained explicitly when newer releases lack required artifacts", async () => {
  const state = fixture({
    versions: ["11.28.0", "11.28.1", "11.28.2", "11.28.3"],
    artifact: (url) =>
      !url.includes("/v11.28.0/") && url.endsWith("pnpm-linux-arm64-musl.tar.gz") ? 404 : 200,
  });
  assert.deepEqual(await resolveToolchainReleases(state.matrix, state.options), state.matrix);
  assert.equal(state.progress.filter((line) => /missing.*linux-arm64-musl/u.test(line)).length, 3);
  assert.ok(state.progress.some((line) => /Retaining.*11\.28\.0/u.test(line)));
});

test("an incomplete current pin never falls back to an older available native release", async () => {
  const state = fixture({ artifact: () => 404 });
  state.matrix.stable.pnpm.version = "11.28.3";
  await assert.rejects(resolveToolchainReleases(state.matrix, state.options), /downgrade/u);
  assert.ok(
    state.calls
      .filter(({ options }) => options.method === "HEAD")
      .every(({ url }) => url.includes("/v11.28.3/")),
  );
  const stale = fixture({ versions: ["11.27.9"] });
  await assert.rejects(resolveToolchainReleases(stale.matrix, stale.options), /downgrade/u);
  assert.equal(
    stale.calls.some(({ options }) => options.method === "HEAD"),
    false,
  );
});

test("indeterminate artifact responses and transport errors cannot become compatible fallbacks", async () => {
  for (const failure of [403, 429, 500, 503, new Error("offline")]) {
    const state = fixture({
      artifact: (url) => {
        if (url.endsWith("pnpm-linux-arm64-musl.tar.gz")) return 404;
        if (failure instanceof Error) throw failure;
        return failure;
      },
    });
    await assert.rejects(resolveToolchainReleases(state.matrix, state.options), /HTTP|offline/u);
    assert.equal(state.progress.length, 0);
    assert.ok(
      state.calls
        .filter(({ options }) => options.method === "HEAD")
        .every(({ url }) => url.includes("/v11.28.3/")),
    );
  }
});

test("artifact HEAD redirects stay bounded and credential-free HTTPS", async () => {
  const state = fixture({
    versions: ["11.28.0"],
    artifact: (url) =>
      url.startsWith("https://github.com/")
        ? new Response(null, {
            status: 302,
            headers: {
              location: `https://release-assets.githubusercontent.com${new URL(url).pathname}`,
            },
          })
        : 200,
  });
  assert.deepEqual(await resolveToolchainReleases(state.matrix, state.options), state.matrix);
  assert.equal(state.calls.filter(({ options }) => options.method === "HEAD").length, 12);
  for (const location of [
    "http://example.invalid/asset",
    "https://user:password@example.invalid/asset",
  ]) {
    const unsafe = fixture({
      artifact: () => new Response(null, { status: 302, headers: { location } }),
    });
    await assert.rejects(resolveToolchainReleases(unsafe.matrix, unsafe.options), /public HTTPS/u);
  }
  const loop = fixture({
    artifact: (url) => new Response(null, { status: 302, headers: { location: url } }),
  });
  await assert.rejects(resolveToolchainReleases(loop.matrix, loop.options), /redirect bound/u);
  const expired = fixture({
    artifact: (url) =>
      url.startsWith("https://github.com/")
        ? new Response(null, {
            status: 302,
            headers: { location: "https://release-assets.githubusercontent.com/expired" },
          })
        : 404,
  });
  await assert.rejects(resolveToolchainReleases(expired.matrix, expired.options), /HTTP 404/u);
});

test("explicit compatibility selectors require complete native artifacts before installation", async () => {
  const state = fixture({
    artifact: (url) => (url.endsWith("pnpm-linux-arm64-musl.tar.gz") ? 404 : 200),
  });
  await assert.rejects(
    resolveCompatibilityToolchain(
      state.matrix,
      { node: state.matrix.stable.node.version, pnpm: "11.28.3", codex: "latest" },
      state.options,
    ),
    /11\.28\.3.*linux-arm64-musl/u,
  );
  const complete = fixture();
  const candidate = await resolveCompatibilityToolchain(
    complete.matrix,
    { node: complete.matrix.stable.node.version, pnpm: "12.0.0-beta.1", codex: "latest" },
    complete.options,
  );
  assert.equal(candidate.stable.pnpm.version, "12.0.0-beta.1");
});
