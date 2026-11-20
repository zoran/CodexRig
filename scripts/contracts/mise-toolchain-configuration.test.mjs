/** Verifies mise toolchain configuration and complete native artifact admission. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateMiseLockFindings,
  nativeNodeArtifactUrls,
  validateMinimalMiseTools,
  pnpmMiseAlias,
} from "./mise-toolchain-configuration.mjs";

const pins = { node: ["24.21.0"], pnpm: ["11.28.0"] };
const checksum = `sha256:${"1".repeat(64)}`;
const nodeArtifacts = {
  "linux-arm64": "https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-arm64.tar.gz",
  "linux-arm64-musl":
    "https://unofficial-builds.nodejs.org/download/release/v24.21.0/node-v24.21.0-linux-arm64-musl.tar.gz",
  "linux-x64": "https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.gz",
  "linux-x64-musl":
    "https://unofficial-builds.nodejs.org/download/release/v24.21.0/node-v24.21.0-linux-x64-musl.tar.gz",
  "macos-arm64": "https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-arm64.tar.gz",
  "macos-x64": "https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-x64.tar.gz",
  "windows-x64": "https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip",
};

function artifactBlock(tool, platform, url) {
  return `[tools.${tool}."platforms.${platform}"]\nchecksum = "${checksum}"\nurl = "${url}"\n${tool === "pnpm" ? 'url_api = "https://api.github.com/repos/pnpm/pnpm/releases/assets/12345"\nprovenance = "github-attestations"\n' : ""}`;
}

function nativeBlock(tool, version, urls) {
  return `[[tools.${tool}]]\nversion = "${version}"\nbackend = "${tool === "pnpm" ? "aqua:pnpm/pnpm" : "core:node"}"\n\n${Object.entries(
    urls,
  )
    .map(([platform, url]) => artifactBlock(tool, platform, url))
    .join("\n")}\n`;
}

function candidate() {
  return (
    nativeBlock("node", pins.node[0], nodeArtifacts) +
    `[[tools.pnpm]]\nversion = "${pins.pnpm[0]}"\nbackend = "npm:pnpm"\naube = { path = ".mise/locks/pnpm/current", digest = "${checksum}" }\n`
  );
}

test("native Node release admission retains all seven exact supported binary URLs", () => {
  assert.deepEqual(nativeNodeArtifactUrls("24.21.0"), nodeArtifacts);
  assert.ok(Object.isFrozen(nativeNodeArtifactUrls("24.21.0")));
  assert.throws(() => nativeNodeArtifactUrls("24.21.0/other"), /version/iu);
});

test("candidate admission rejects a Node source archive in place of a missing musl binary", () => {
  const content = candidate();
  const fallback = content.replace(
    nodeArtifacts["linux-arm64-musl"],
    "https://nodejs.org/dist/v24.21.0/node-v24.21.0.tar.gz",
  );
  assert.match(
    candidateMiseLockFindings(fallback, pins).join("\n"),
    /node linux-arm64-musl URL must match its official versioned artifact exactly once/u,
  );
});

test("pnpm uses one portable backend and integrity-bound graph", () => {
  const content = candidate();
  assert.deepEqual(candidateMiseLockFindings(content, pins), []);
  for (const invalid of [
    content.replace('backend = "npm:pnpm"', 'backend = "aqua:pnpm/pnpm"'),
    content.replace('path = ".mise/locks/pnpm/current"', 'path = "../../foreign"'),
    content.replace(`digest = "${checksum}"`, 'digest = "unchecked"'),
    content + artifactBlock("pnpm", "linux-x64", "https://example.test/pnpm"),
    content.replace('backend = "npm:pnpm"', 'backend = "npm:pnpm"\nbackend = "npm:pnpm"'),
    content.replace('version = "11.28.0"', 'version = "11.28.0"\nversion = "11.28.0"'),
  ])
    assert.notDeepEqual(candidateMiseLockFindings(invalid, pins), [], invalid);
  const config = `[tools]\nnode = "24.21.0"\npnpm = "11.28.0"\n${pnpmMiseAlias}\n`;
  assert.deepEqual(validateMinimalMiseTools(config).errors, []);
  for (const invalid of [
    config.replace("npm:pnpm", "npm:other"),
    config + pnpmMiseAlias,
    config.replace('backend = "npm:pnpm"', 'backend = "npm:pnpm"\npostinstall = "payload"'),
  ])
    assert.notDeepEqual(validateMinimalMiseTools(invalid).errors, []);
});

test("candidate admission preserves secondary runtimes and product tool lock ownership", () => {
  const productPins = {
    ...pins,
    node: [...pins.node, "22.23.2"],
    java: ["temurin-21.0.12+101.0.LTS"],
  };
  const productBlock = (tool, version) =>
    `[[tools.${tool}]]\nversion = "${version}"\nbackend = "core:${tool}"\n${artifactBlock(tool, "linux-x64", "https://example.test/product-artifact")}\n`;
  const secondaryNode = productBlock("node", productPins.node[1]);
  const java = productBlock("java", productPins.java[0]);
  const content = candidate() + secondaryNode + java;
  assert.deepEqual(candidateMiseLockFindings(content, productPins), []);
  for (const invalid of [content.replace(secondaryNode, ""), content + java])
    assert.match(candidateMiseLockFindings(invalid, productPins).join("\n"), /exactly one entry/u);
});
