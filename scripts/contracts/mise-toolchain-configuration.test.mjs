/** Verifies mise toolchain configuration and complete native artifact admission. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateMiseLockFindings,
  nativePnpmArtifactUrls,
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
    nativeBlock("pnpm", pins.pnpm[0], nativePnpmArtifactUrls(pins.pnpm[0]))
  );
}

test("native pnpm release admission retains all six exact supported artifact URLs", () => {
  const release = "https://github.com/pnpm/pnpm/releases/download/v11.28.0";
  assert.deepEqual(nativePnpmArtifactUrls("11.28.0"), {
    "linux-arm64": `${release}/pnpm-linux-arm64.tar.gz`,
    "linux-arm64-musl": `${release}/pnpm-linux-arm64-musl.tar.gz`,
    "linux-x64": `${release}/pnpm-linux-x64.tar.gz`,
    "linux-x64-musl": `${release}/pnpm-linux-x64-musl.tar.gz`,
    "macos-arm64": `${release}/pnpm-darwin-arm64.tar.gz`,
    "windows-x64": `${release}/pnpm-win32-x64.zip`,
  });
  assert.ok(Object.isFrozen(nativePnpmArtifactUrls("11.28.0")));
  assert.throws(() => nativePnpmArtifactUrls("11.28.0/other"), /version/iu);
});

test("candidate admission rejects absent and incomplete non-host pnpm platforms", () => {
  const content = candidate();
  assert.deepEqual(candidateMiseLockFindings(content, pins), []);
  const armMusl = artifactBlock(
    "pnpm",
    "linux-arm64-musl",
    nativePnpmArtifactUrls(pins.pnpm[0])["linux-arm64-musl"],
  );
  assert.match(
    candidateMiseLockFindings(content.replace(armMusl, ""), pins).join("\n"),
    /pnpm platforms must match/u,
  );
  const incomplete =
    '[tools.pnpm."platforms.linux-arm64-musl"]\nprovenance = "github-attestations"\n';
  const findings = candidateMiseLockFindings(content.replace(armMusl, incomplete), pins).join("\n");
  assert.match(findings, /pnpm linux-arm64-musl.*SHA-256/u);
  assert.match(findings, /pnpm linux-arm64-musl.*official versioned artifact/u);
  assert.match(findings, /pnpm linux-arm64-musl.*official GitHub asset/u);
});

test("candidate admission preserves native artifact origin, integrity, provenance and uniqueness", () => {
  const content = candidate();
  const target = artifactBlock(
    "pnpm",
    "linux-arm64",
    nativePnpmArtifactUrls(pins.pnpm[0])["linux-arm64"],
  );
  for (const [label, invalid] of [
    ["checksum", target.replace(checksum, `sha512:${"1".repeat(64)}`)],
    ["URL", target.replace("https://github.com/", "https://mirror.example/")],
    ["provenance", target.replace('provenance = "github-attestations"\n', "")],
    ["API", target.replace("/releases/assets/12345", "/releases/assets/0")],
    ["platform ownership", target.replace("[tools.pnpm.", "[tools.node.")],
    ["duplicate platform", target + target],
    ...["checksum", "url", "url_api", "provenance"].map((field) => {
      const line = target.split("\n").find((entry) => entry.startsWith(`${field} = `));
      return [`duplicate ${field}`, target + line + "\n"];
    }),
  ]) {
    assert.notDeepEqual(
      candidateMiseLockFindings(content.replace(target, invalid), pins),
      [],
      label,
    );
  }
  for (const field of ["version", "backend"]) {
    const line = field === "version" ? 'version = "11.28.0"' : 'backend = "aqua:pnpm/pnpm"';
    assert.notDeepEqual(
      candidateMiseLockFindings(content.replace(line, `${line}\n${line}`), pins),
      [],
      `duplicate ${field}`,
    );
  }
  assert.notDeepEqual(
    candidateMiseLockFindings(
      content.replace('backend = "aqua:pnpm/pnpm"', 'backend = "npm:pnpm"'),
      pins,
    ),
    [],
  );
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
