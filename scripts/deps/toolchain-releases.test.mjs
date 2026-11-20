/** Verifies toolchain releases against every supported native Node artifact and the portable pnpm archive. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readToolchainConfiguration } from "../contracts/toolchain-configuration.mjs";
import { nativeNodeArtifactUrls } from "../contracts/mise-toolchain-configuration.mjs";
import { resolveCompatibilityToolchain, resolveToolchainReleases } from "./toolchain-releases.mjs";

function fixture({
  versions = ["11.28.0", "11.28.3"],
  nodeVersions,
  artifact = () => 200,
  pnpmArchive = () => new Response("portable pnpm fixture"),
  pnpmMetadata = (release) => release,
  nodeArtifact = () => 200,
  nodeChecksums = (_url, content) => new Response(content),
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
    if (
      options.method === "HEAD" ||
      (options.method === "GET" && options.headers.Range === "bytes=0-0")
    ) {
      assert.equal(options.method, "GET");
      assert.equal(options.headers.Range, "bytes=0-0");
      assert.equal(options.redirect, "manual");
      assert.equal(options.credentials, "omit");
      const node =
        url.startsWith("https://nodejs.org/dist/") ||
        url.startsWith("https://unofficial-builds.nodejs.org/download/release/") ||
        nodeRedirects.has(url);
      call.tool = node ? "node" : "pnpm";
      const result = await (node ? nodeArtifact : artifact)(url, options);
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
    else if (decoded === "https://registry.npmjs.org/pnpm.tgz") return pnpmArchive();
    else if (decoded.startsWith("https://registry.npmjs.org/pnpm/"))
      data = pnpmMetadata({
        name: "pnpm",
        version: decoded.split("/").at(-1),
        dist: {
          tarball: "https://registry.npmjs.org/pnpm.tgz",
          integrity: `sha512-${createHash("sha512").update("portable pnpm fixture").digest("base64")}`,
        },
      });
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
    } else if (
      /^https:\/\/(?:nodejs\.org\/dist|unofficial-builds\.nodejs\.org\/download\/release)\/v([^/]+)\/SHASUMS256\.txt$/u.test(
        decoded,
      )
    ) {
      const version = decoded.match(/\/v([^/]+)\//u)[1];
      const content =
        Object.values(nativeNodeArtifactUrls(version))
          .filter((artifact) => new URL("SHASUMS256.txt", artifact).href === decoded)
          .map((artifact) => `${"1".repeat(64)}  ${artifact.split("/").at(-1)}`)
          .join("\n") + "\n";
      return nodeChecksums(decoded, content);
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
  return state.calls.filter((call) => call.tool === tool);
}

test("Node defers a release whose available binaries lack published checksum entries", async () => {
  for (const missingManifest of [false, true]) {
    const state = fixture({
      versions: ["11.28.0"],
      nodeVersions: ["24.22.0", "24.22.1"],
      nodeChecksums: (url, content) =>
        url.includes("unofficial-builds") && url.includes("/v24.22.1/")
          ? new Response(
              missingManifest ? null : `${"2".repeat(64)}  node-v24.22.1-headers.tar.gz\n`,
              { status: missingManifest ? 404 : 200 },
            )
          : new Response(content),
    });
    assert.deepEqual(await resolveToolchainReleases(state.matrix, state.options), state.matrix);
    assert.ok(
      state.progress.some((line) => /24\.22\.1.*linux-arm64-musl, linux-x64-musl/u.test(line)),
    );
    assert.equal(probes(state, "node").length, 14);
  }
});

test("Node checksum corruption or uncertainty cannot be treated as an absent release", async () => {
  for (const failure of ["corrupt\n", "", "duplicate", 403, 429, 503, new Error("offline")]) {
    const state = fixture({
      nodeVersions: ["24.22.0", "24.22.1"],
      nodeArtifact: (url) => (url.endsWith("-linux-arm64-musl.tar.gz") ? 404 : 200),
      nodeChecksums: (_url, content) => {
        if (failure instanceof Error) throw failure;
        if (typeof failure === "number") return new Response(null, { status: failure });
        return new Response(failure === "duplicate" ? content + content : failure);
      },
    });
    await assert.rejects(
      resolveToolchainReleases(state.matrix, state.options),
      /checksum|HTTP|offline/iu,
    );
    assert.deepEqual(state.progress, []);
    assert.equal(probes(state, "node").length, 7);
  }
});

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
  for (const failure of [403, 429, 500, 502, 503, 504, new Error("offline")]) {
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
    const requests = probes(state, "node");
    assert.equal(new Set(requests.map((call) => call.url)).size, 7);
    assert.ok(requests.every(({ url }) => url.includes("/v24.22.1/")));
    for (const url of new Set(requests.map((call) => call.url))) {
      const maximum =
        [502, 503, 504].includes(failure) && !url.endsWith("-linux-arm64-musl.tar.gz") ? 3 : 1;
      assert.equal(requests.filter((call) => call.url === url).length, maximum);
    }
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

test("portable pnpm selects the latest compatible release without native platform probes", async () => {
  const state = fixture({
    versions: ["11.28.0", "11.28.13", "11.29.0-beta.1", "12.0.0"],
    artifact: () => {
      throw new Error("native pnpm artifacts are absent");
    },
  });
  const candidate = await resolveToolchainReleases(state.matrix, state.options);
  assert.equal(candidate.stable.pnpm.version, "11.28.13");
  assert.equal(probes(state, "pnpm").length, 0);
  assert.equal(
    state.calls.filter(({ url }) => url === "https://registry.npmjs.org/pnpm.tgz").length,
    1,
  );
  assert.deepEqual(state.progress, []);
  const stale = fixture({ versions: ["11.27.9"] });
  await assert.rejects(resolveToolchainReleases(stale.matrix, stale.options), /downgrade/u);
});

test("portable pnpm refuses missing, uncertain and altered official distributions", async () => {
  for (const status of [404, 403, 429, 503]) {
    const state = fixture({ pnpmArchive: () => new Response(null, { status }) });
    await assert.rejects(resolveToolchainReleases(state.matrix, state.options), /HTTP/u);
    assert.deepEqual(state.progress, []);
  }
  const altered = fixture({ pnpmArchive: () => new Response("tampered") });
  await assert.rejects(resolveToolchainReleases(altered.matrix, altered.options), /integrity/u);
  const wrongOrigin = fixture({
    pnpmMetadata: (r) => ({
      ...r,
      dist: { ...r.dist, tarball: "https://mirror.invalid/pnpm.tgz" },
    }),
  });
  await assert.rejects(
    resolveToolchainReleases(wrongOrigin.matrix, wrongOrigin.options),
    /origin/u,
  );
});

test("native probes use one-byte ranges and cancel responses without changing releases", async () => {
  for (const tool of ["node"]) {
    const cancelled = [];
    const artifact = (url) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
          },
          cancel() {
            cancelled.push(url);
          },
        }),
        { status: 206, headers: { "Content-Range": "bytes 0-0/16" } },
      );
    const state = fixture({
      nodeVersions: ["24.22.0", "24.22.1"],
      [tool === "node" ? "nodeArtifact" : "artifact"]: artifact,
    });
    const candidate = await resolveToolchainReleases(state.matrix, state.options);
    assert.equal(candidate.stable[tool].version, tool === "node" ? "24.22.1" : "11.28.3");
    const requests = probes(state, tool);
    assert.equal(requests.length, tool === "node" ? 7 : 6);
    assert.equal(new Set(requests.map((request) => request.url)).size, requests.length);
    assert.equal(cancelled.length, requests.length);
    assert.deepEqual(state.progress, []);
  }
});

test("transient native gateway failures retry the same release within the original deadline", async () => {
  for (const status of [502, 503, 504]) {
    const attempts = new Map();
    const state = fixture({
      nodeArtifact: (url) => {
        const count = (attempts.get(url) ?? 0) + 1;
        attempts.set(url, count);
        return count === 1
          ? status
          : new Response(null, {
              status: 206,
              headers: { "Content-Range": "bytes 0-0/16" },
            });
      },
    });
    const candidate = await resolveToolchainReleases(state.matrix, state.options);
    assert.equal(candidate.stable.pnpm.version, "11.28.3");
    for (const [url, count] of attempts) {
      assert.equal(count, 2);
      const requests = probes(state, "node").filter((call) => call.url === url);
      assert.equal(new Set(requests.map((call) => call.options.signal)).size, 1);
    }
    assert.deepEqual(state.progress, []);
  }
});

test("indeterminate artifact responses and transport errors cannot become compatible fallbacks", async () => {
  for (const failure of [403, 429, 500, 502, 503, 504, new Error("offline")]) {
    const state = fixture({
      nodeArtifact: (url) => {
        if (url.endsWith("node-v24.22.0-linux-arm64-musl.tar.gz")) return 404;
        if (failure instanceof Error) throw failure;
        return failure;
      },
    });
    await assert.rejects(resolveToolchainReleases(state.matrix, state.options), /HTTP|offline/u);
    assert.equal(state.progress.length, 0);
    const requests = probes(state, "node");
    assert.ok(requests.every(({ url }) => url.includes("/v24.22.0/")));
    for (const url of new Set(requests.map((call) => call.url))) {
      const maximum =
        [502, 503, 504].includes(failure) && !url.endsWith("node-v24.22.0-linux-arm64-musl.tar.gz")
          ? 3
          : 1;
      assert.equal(requests.filter((call) => call.url === url).length, maximum);
    }
  }
});

test("ranged probes cancel servers that ignore Range and preserve the redirect deadline", async () => {
  const cancelled = [];
  const state = fixture({
    nodeArtifact: (url, options) => {
      if (
        !url.startsWith("https://release-assets.githubusercontent.com/") &&
        !url.startsWith("https://cdn.example.test/")
      )
        return new Response(null, {
          status: 302,
          headers: {
            location: `https://release-assets.githubusercontent.com/${options.method}/${url.split("/").at(-1)}`,
          },
        });
      assert.ok(url.includes("/GET/"));
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled.push(url);
          },
        }),
      );
    },
  });
  const candidate = await resolveToolchainReleases(state.matrix, state.options);
  assert.equal(candidate.stable.pnpm.version, "11.28.3");
  assert.equal(cancelled.length, 7);
  const ranges = state.calls.filter(
    (call) => call.tool === "node" && call.options.method === "GET",
  );
  const originals = ranges.filter(
    ({ url }) =>
      !url.startsWith("https://release-assets.githubusercontent.com/") &&
      !url.startsWith("https://cdn.example.test/"),
  );
  assert.equal(originals.length, 7);
  for (const original of originals) {
    const redirected = ranges.find(
      (call) =>
        call.url ===
        `https://release-assets.githubusercontent.com/GET/${original.url.split("/").at(-1)}`,
    );
    assert.ok(redirected);
    assert.equal(redirected.options.signal, original.options.signal);
  }
  assert.deepEqual(state.progress, []);
});

test("ranged probes refuse malformed partial responses and unsafe redirects", async () => {
  for (const contentRange of [null, "bytes 1-1/16", "bytes 0-0/0"]) {
    const state = fixture({
      nodeArtifact: () =>
        new Response(null, {
          status: 206,
          headers: contentRange === null ? {} : { "Content-Range": contentRange },
        }),
    });
    await assert.rejects(resolveToolchainReleases(state.matrix, state.options), /range response/u);
    assert.deepEqual(state.progress, []);
  }
  for (const location of [
    "http://example.invalid/asset",
    "https://user:password@example.invalid/asset",
  ]) {
    const state = fixture({
      nodeArtifact: () => new Response(null, { status: 302, headers: { location } }),
    });
    await assert.rejects(resolveToolchainReleases(state.matrix, state.options), /public HTTPS/u);
  }
});

test("native gateway recovery cannot renew the redirect allowance", async () => {
  const state = fixture({
    nodeArtifact: (url) => {
      const canonical =
        !url.startsWith("https://release-assets.githubusercontent.com/") &&
        !url.startsWith("https://cdn.example.test/");
      const parts = new URL(url).pathname.split("/");
      const hop = canonical ? 0 : Number(parts.at(-1));
      const file = canonical ? parts.at(-1) : parts.at(-2);
      return hop === 4
        ? 503
        : new Response(null, {
            status: 302,
            headers: { location: `https://cdn.example.test/${file}/${hop + 1}` },
          });
    },
  });
  await assert.rejects(resolveToolchainReleases(state.matrix, state.options), /redirect bound/u);
  assert.deepEqual(state.progress, []);
});

test("artifact ranged GET redirects stay bounded and credential-free HTTPS", async () => {
  const state = fixture({
    versions: ["11.28.0"],
    nodeArtifact: (url) =>
      !url.startsWith("https://release-assets.githubusercontent.com/") &&
      !url.startsWith("https://cdn.example.test/")
        ? new Response(null, {
            status: 302,
            headers: {
              location: `https://release-assets.githubusercontent.com${new URL(url).pathname}`,
            },
          })
        : 200,
  });
  assert.deepEqual(await resolveToolchainReleases(state.matrix, state.options), state.matrix);
  assert.equal(probes(state, "node").length, 14);
  for (const location of [
    "http://example.invalid/asset",
    "https://user:password@example.invalid/asset",
  ]) {
    const unsafe = fixture({
      nodeArtifact: () => new Response(null, { status: 302, headers: { location } }),
    });
    await assert.rejects(resolveToolchainReleases(unsafe.matrix, unsafe.options), /public HTTPS/u);
  }
  const loop = fixture({
    nodeArtifact: (url) => new Response(null, { status: 302, headers: { location: url } }),
  });
  await assert.rejects(resolveToolchainReleases(loop.matrix, loop.options), /redirect bound/u);
  const expired = fixture({
    nodeArtifact: (url) =>
      !url.startsWith("https://release-assets.githubusercontent.com/") &&
      !url.startsWith("https://cdn.example.test/")
        ? new Response(null, {
            status: 302,
            headers: { location: "https://release-assets.githubusercontent.com/expired" },
          })
        : 404,
  });
  await assert.rejects(resolveToolchainReleases(expired.matrix, expired.options), /HTTP 404/u);
});

test("explicit compatibility selectors verify the portable pnpm archive", async () => {
  const complete = fixture();
  const candidate = await resolveCompatibilityToolchain(
    complete.matrix,
    { node: complete.matrix.stable.node.version, pnpm: "12.0.0-beta.1", codex: "latest" },
    complete.options,
  );
  assert.equal(candidate.stable.pnpm.version, "12.0.0-beta.1");
  assert.equal(probes(complete, "pnpm").length, 0);
  const invalid = fixture({ pnpmArchive: () => new Response("corrupt") });
  await assert.rejects(
    resolveCompatibilityToolchain(
      invalid.matrix,
      { node: invalid.matrix.stable.node.version, pnpm: "11.28.13", codex: "latest" },
      invalid.options,
    ),
    /integrity/u,
  );
});
