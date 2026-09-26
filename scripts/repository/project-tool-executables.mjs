/** Owns private project tool layouts and the integrity of installed native bootstrap bundles. */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { readToolchainConfiguration } from "../contracts/toolchain-configuration.mjs";
import {
  atomicWriteOwnedFile,
  readOptionalOwnedFile,
} from "../filesystem/owned-file-operations.mjs";
import { projectToolPaths } from "./project-tool-environment.mjs";
import {
  captureStableRepositoryFileIdentity,
  scanStableRepositoryFile,
} from "./stable-file-snapshot.mjs";

const receiptName = ".project-installation.json";
const digestCache = new Map();
const nativeCodexTriples = Object.freeze({
  "linux-x64": "x86_64-unknown-linux-musl",
  "linux-arm64": "aarch64-unknown-linux-musl",
  "darwin-arm64": "aarch64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
});
let detectedLibc;

/** Uses Node's runtime report; no host account configuration or executable discovery is involved. */
function linuxLibc() {
  detectedLibc ??= process.report.getReport().header.glibcVersionRuntime ? "glibc" : "musl";
  return detectedLibc;
}

/** Layouts are owned by current toolchain pins, never selected by an inherited account variable. */
export function projectManagedToolLayout(
  root,
  matrix = readToolchainConfiguration(root),
  {
    platform = process.platform,
    arch = process.arch,
    libc = platform === "linux" ? linuxLibc() : null,
  } = {},
) {
  const p = projectToolPaths(root);
  const target = `${platform}-${arch}`;
  const nativeTriple = nativeCodexTriples[target];
  if (!nativeTriple || (platform === "linux" && !["glibc", "musl"].includes(libc)))
    throw new Error(`No reviewed project bootstrap distribution for ${target}.`);
  const miseTarget = `${platform === "darwin" ? "macos" : platform === "win32" ? "windows" : platform}-${arch}${libc === "musl" ? "-musl" : ""}`;
  const suffix = platform === "win32" ? ".exe" : "";
  const bundle = (name, version, executable, integrity, distribution, source) => {
    const directory = path.join(p.tools, name, version, distribution);
    return {
      directory,
      executable: path.join(directory, executable),
      integrity,
      name,
      version,
      source,
    };
  };
  const installs = path.join(p.data, "mise", "installs");
  return {
    mise: bundle(
      "mise",
      matrix.ci.miseVersion,
      `bin/mise${suffix}`,
      `sha256-${matrix.ci.miseBinarySha256[miseTarget]}`,
      miseTarget,
      {
        kind: "binary",
        url: `https://github.com/jdx/mise/releases/download/v${matrix.ci.miseVersion}/mise-v${matrix.ci.miseVersion}-${miseTarget}${suffix}`,
      },
    ),
    codex: bundle(
      "codex",
      matrix.ci.codexVersion,
      `vendor/${nativeTriple}/bin/codex${suffix}`,
      matrix.ci.codexNpmPlatformIntegrities[target],
      target,
      {
        kind: "npm",
        name: matrix.ci.codexNpmPackage,
        version: `${matrix.ci.codexVersion}-${target}`,
      },
    ),
    node: {
      executable: path.join(
        installs,
        "node",
        matrix.stable.node.version,
        platform === "win32" ? "node.exe" : "bin/node",
      ),
    },
    pnpm: { executable: path.join(installs, "pnpm", matrix.stable.pnpm.version, `pnpm${suffix}`) },
  };
}

function privateToolParents(root, target) {
  const p = projectToolPaths(root);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Managed tool must remain inside its project.");
  let cursor = root;
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    cursor = path.join(cursor, segment);
    const stats = lstatSync(cursor);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      (typeof process.getuid === "function" && stats.uid !== process.getuid())
    )
      throw new Error("Managed tool parents must be real developer-owned directories.");
    if ((cursor === path.join(root, ".auth") || cursor === p.state) && (stats.mode & 0o077) !== 0)
      throw new Error("Managed tools require private project account storage.");
  }
}

function bundleFiles(root, directory) {
  const files = [];
  let bytes = 0;
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      if (current === directory && name === receiptName) continue;
      const target = path.join(current, name);
      const stats = lstatSync(target);
      if (stats.isSymbolicLink())
        throw new Error("Installed native bundle contains a symbolic link.");
      if (stats.isDirectory()) {
        walk(target);
        continue;
      }
      if (
        !stats.isFile() ||
        stats.nlink !== 1 ||
        files.length >= 4096 ||
        (bytes += stats.size) > 1024 * 1024 * 1024
      )
        throw new Error("Installed native bundle exceeds its regular-file boundary.");
      const relativePath = path.relative(root, target);
      const snapshot = captureStableRepositoryFileIdentity({ repositoryRoot: root, relativePath });
      const cacheKey = `${target}\0${JSON.stringify(snapshot)}`;
      let digest = digestCache.get(cacheKey);
      if (!digest) {
        const hash = createHash("sha256");
        scanStableRepositoryFile({
          repositoryRoot: root,
          relativePath,
          expectedIdentity: snapshot.identity,
          onChunk: (chunk) => hash.update(chunk),
        });
        digest = hash.digest("hex");
        digestCache.set(cacheKey, digest);
      }
      files.push({ path: path.relative(directory, target), mode: stats.mode & 0o777, digest });
    }
  };
  walk(directory);
  return files;
}

/** Called only by the lifecycle-owned installer after checking the complete public archive. */
export function sealProjectToolBundle(root, directory, tool) {
  const value = {
    schemaVersion: 1,
    name: tool.name,
    version: tool.version,
    integrity: tool.integrity,
    files: bundleFiles(root, directory),
  };
  atomicWriteOwnedFile(
    root,
    path.join(directory, receiptName),
    `${JSON.stringify(value)}\n`,
    0o600,
    { label: "project tool installation" },
  );
}

/** Verifies the whole native resource tree, including code-mode hosts and bundled shell resources. */
export function verifyProjectToolBundle(root, tool) {
  privateToolParents(root, tool.executable);
  const receipt = readOptionalOwnedFile(
    root,
    path.join(tool.directory, receiptName),
    "project tool installation",
    { maximumBytes: 1024 * 1024 },
  );
  if (!receipt.exists)
    throw new Error(
      "Project tool has no verified installation; run canonical startup maintenance.",
    );
  const expected = {
    schemaVersion: 1,
    name: tool.name,
    version: tool.version,
    integrity: tool.integrity,
    files: bundleFiles(root, tool.directory),
  };
  let actual;
  try {
    actual = JSON.parse(receipt.buffer.toString("utf8"));
  } catch {
    throw new Error("Project tool installation receipt is invalid.");
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error("Project tool installation changed; preserve it for lifecycle-owned repair.");
  const stats = lstatSync(tool.executable);
  if (!stats.isFile() || (stats.mode & 0o111) === 0)
    throw new Error("Managed project tool is not an executable regular file.");
  return tool.executable;
}

/** Admits only exact current managed paths; arbitrary project PATH entries remain untrusted. */
export function isProjectManagedExecutable(root, executable) {
  const p = projectToolPaths(root);
  if (
    ![p.tools, path.join(p.data, "mise", "installs")].some((directory) =>
      executable.startsWith(`${directory}${path.sep}`),
    )
  )
    return false;
  if (!existsSync(path.join(root, ".codex", "toolchain.json"))) return false;
  const layout = projectManagedToolLayout(root);
  for (const [name, tool] of Object.entries(layout)) {
    if (!existsSync(tool.executable)) continue;
    const resolved = realpathSync.native(tool.executable);
    if (resolved !== executable) continue;
    privateToolParents(root, tool.executable);
    if (name === "mise" || name === "codex") verifyProjectToolBundle(root, tool);
    else if (resolved !== tool.executable)
      throw new Error("Mise-managed runtime must use its real locked installation path.");
    return true;
  }
  return false;
}
