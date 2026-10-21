/** Verifies toolchain releases against every supported native Node and pnpm artifact. */
import assert from "node:assert/strict";
import test from "node:test";
import { readToolchainConfiguration } from "../contracts/toolchain-configuration.mjs";
import { resolveCompatibilityToolchain, resolveToolchainReleases } from "./toolchain-releases.mjs";

function fixture({
  versions = ["11.28.0", "11.28.3"],
  nodeVersions,
  artifact = () => 200,
  nodeArtifact = () => 200,
} = {}) {
  const matrix = readToolchainConfiguration();
  matrix.stable.node.version = "24.22.0";
  matrix.stable.node.range = ">=24.0.0 <25.0.0";
  matrix.stable.pnpm.version = "11.28.0";
  matrix.stable.pnpm.range = ">=11.0.0 <12.0.0";
  const calls = [],
    progress = [];
  const nodeRedirects = new Set();
  const fetchImpl = async (url, options) => {
    const call = { url, options };
    calls.push(call);
    if (options.method === "HEAD") {
      assert.equal(options.redirect, "manual");
      assert.equal(options.credentials, "omit");
      const node =
        url.startsWith("https://nodejs.org/dist/") ||
        url.startsWith("https://unofficial-builds.nodejs.org/download/release/") ||
        nodeRedirects.has(url);
      call.tool = node ? "node" : "pnpm";
      const result = await (node ? nodeArtifact : artifact)(url);
      const response = result instanceof Response ? result : new Response(null, { status: result });
      const location = response.headers.get("location");
      if (node && location) nodeRedirects.add(new URL(location, url).href);
      return response;
    }
    let data;
    const decoded = decodeURIComponent(url);
    if (decoded === "https://nodejs.org/dist/index.json")
      data = (nodeVersions ?? [matrix.stable.node.version]).map((entry) =>
        typeof entry === "string" ? { version: `v${entry}`, lts: "Krypton" } : entry,
      );
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

function probes(state, tool) {
  return state.calls.filter((call) => call.options.method === "HEAD" && call.tool === tool);
}

test("Node retains the current complete release when a newer musl binary is missing", async () => {
  const state = fixture({
    versions: ["11.28.0"],
    nodeVersions: ["24.22.0", "24.22.1"],
    nodeArtifact: (url) =>
      url ===
      "https://unofficial-builds.nodejs.org/download/release/v24.22.1/node-v24.22.1-linux-arm64-musl.tar.gz"
        ? 404
        : 200,
  });
  assert.deepEqual(await resolveToolchainReleases(state.matrix, state.options), state.matrix);
  assert.ok(state.progress.some((line) => /node 24\.22\.1.*linux-arm64-musl/u.test(line)));
  assert.ok(state.progress.some((line) => /Retaining node 24\.22\.0/u.test(line)));
  assert.equal(probes(state, "node").length, 14);
});

test("Node selects the newest complete LTS release within its current range", async () => {
  for (const incompleteLatest of [false, true]) {
    const state = fixture({
      versions: ["11.28.0"],
      nodeVersions: [
        "24.22.0",
        "24.22.1",
        "24.22.2",
        "24.22.3-rc.1",
        { version: "v24.23.0", lts: false },
        "25.0.0",
      ],
      nodeArtifact: (url) =>
        incompleteLatest && url.endsWith("node-v24.22.2-linux-arm64-musl.tar.gz") ? 404 : 200,
    });
    const expected = incompleteLatest ? "24.22.1" : "24.22.2";
    const candidate = await resolveToolchainReleases(state.matrix, state.options);
    assert.equal(candidate.stable.node.version, expected);
    const nodeProbes = probes(state, "node");
    assert.equal(nodeProbes.length, incompleteLatest ? 14 : 7);
    assert.ok(nodeProbes.every(({ url }) => /\/v24\.22\.[12]\//u.test(url)));
    const release = `https://nodejs.org/dist/v${expected}/node-v${expected}`;
    const musl = `https://unofficial-builds.nodejs.org/download/release/v${expected}/node-v${expected}`;
    assert.deepEqual(
      nodeProbes
        .filter(({ url }) => url.includes(`/v${expected}/`))
        .map(({ url }) => url)
        .sort(),
      [
        `${release}-linux-arm64.tar.gz`,
        `${musl}-linux-arm64-musl.tar.gz`,
        `${release}-linux-x64.tar.gz`,
        `${musl}-linux-x64-musl.tar.gz`,
        `${release}-darwin-arm64.tar.gz`,
        `${release}-darwin-x64.tar.gz`,
        `${release}-win-x64.zip`,
      ].sort(),
    );
  }
});

test("Node never downgrades an incomplete current pin or trusts a stale index", async () => {
  for (const nodeVersions of [["24.22.0", "24.22.1"], ["24.22.0"]]) {
    const state = fixture({
      nodeVersions,
      nodeArtifact: (url) => (url.endsWith("node-v24.22.1-linux-arm64-musl.tar.gz") ? 404 : 200),
    });
    state.matrix.stable.node.version = "24.22.1";
    await assert.rejects(resolveToolchainReleases(state.matrix, state.options), /downgrade/u);
    const nodeProbes = probes(state, "node");
    assert.equal(nodeProbes.length, nodeVersions.length === 2 ? 7 : 0);
    assert.ok(nodeProbes.every(({ url }) => url.includes("/v24.22.1/")));
    assert.equal(probes(state, "pnpm").length, 0);
  }
});

test("Node artifact uncertainty outranks a missing binary and cannot retain an older release", async () => {
  for (const failure of [403, 429, 500, 503, new Error("offline")]) {
    const state = fixture({
      nodeVersions: ["24.22.0", "24.22.1"],
      nodeArtifact: (url) => {
        if (url.endsWith("-linux-arm64-musl.tar.gz")) return 404;
        if (failure instanceof Error) throw failure;
        return failure;
      },
    });
    await assert.rejects(resolveToolchainReleases(state.matrix, state.options), /HTTP|offline/u);
    assert.deepEqual(state.progress, []);
    assert.equal(probes(state, "node").length, 7);
    assert.ok(probes(state, "node").every(({ url }) => url.includes("/v24.22.1/")));
  }
});

test("a redirected Node artifact 404 cannot establish an incomplete release", async () => {
  const state = fixture({
    nodeVersions: ["24.22.0", "24.22.1"],
    nodeArtifact: (url) => {
      if (url.endsWith("node-v24.22.1-linux-arm64-musl.tar.gz"))
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.test/expired" },
        });
      return url === "https://cdn.example.test/expired" ? 404 : 200;
    },
  });
  await assert.rejects(resolveToolchainReleases(state.matrix, state.options), /HTTP 404/u);
  assert.deepEqual(state.progress, []);
  assert.ok(probes(state, "node").every(({ url }) => !url.includes("/v24.22.0/")));
});

test("Node compatibility tracks defer incomplete major releases but reject an incomplete exact pin", async () => {
  const state = fixture({
    nodeVersions: ["24.22.0", "24.22.1"],
    nodeArtifact: (url) => (url.endsWith("node-v24.22.1-linux-arm64-musl.tar.gz") ? 404 : 200),
  });
  const track = { node: "24", pnpm: "11.28.0", codex: "latest" };
  const candidate = await resolveCompatibilityToolchain(state.matrix, track, state.options);
  assert.equal(candidate.stable.node.version, "24.22.0");
  await assert.rejects(
    resolveCompatibilityToolchain(state.matrix, { ...track, node: "24.22.1" }, state.options),
    /No complete compatible native node release/u,
  );
});

test("native selection skips incomplete releases and picks the newest complete compatible version", async () => {
  const state = fixture({
    versions: ["11.28.0", "11.28.1", "11.28.2", "11.28.3", "11.29.0-beta.1", "12.0.0"],
    artifact: (url) =>
      url.includes("/v11.28.3/") && url.endsWith("pnpm-linux-arm64-musl.tar.gz") ? 404 : 200,
  });
  const candidate = await resolveToolchainReleases(state.matrix, state.options);
  assert.equal(candidate.stable.pnpm.version, "11.28.2");
  assert.ok(state.progress.some((line) => /11\.28\.3.*linux-arm64-musl/u.test(line)));
  const pnpmProbes = probes(state, "pnpm");
  assert.equal(pnpmProbes.length, 12);
  assert.ok(pnpmProbes.every(({ url }) => /\/v11\.28\.[23]\//u.test(url)));
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
  assert.ok(probes(state, "pnpm").every(({ url }) => url.includes("/v11.28.3/")));
  const stale = fixture({ versions: ["11.27.9"] });
  await assert.rejects(resolveToolchainReleases(stale.matrix, stale.options), /downgrade/u);
  assert.equal(probes(stale, "pnpm").length, 0);
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
    assert.ok(probes(state, "pnpm").every(({ url }) => url.includes("/v11.28.3/")));
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
  assert.equal(probes(state, "pnpm").length, 12);
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
