/** Owns project-pinned user tool layouts and the integrity of installed native bootstrap bundles. */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { readToolchainConfiguration } from "../contracts/toolchain-configuration.mjs";
import {
  validateMinimalMiseTools,
  candidateMiseLockFindings,
} from "../contracts/mise-toolchain-configuration.mjs";
import { readRepositoryFile } from "../filesystem/repository-files.mjs";
import {
  atomicWriteOwnedFile,
  readOptionalOwnedFile,
} from "../filesystem/owned-file-operations.mjs";
import { userToolPaths, assertUserToolParents } from "./user-tool-storage.mjs";
import {
  projectToolEnvironment,
  prepareProjectToolDirectories,
} from "./project-tool-environment.mjs";
import { spawnSyncWithBoundedIo } from "./runtime-process-io.mjs";
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
    environment = process.env,
    platform = process.platform,
    arch = process.arch,
    libc = platform === "linux" ? linuxLibc() : null,
  } = {},
) {
  const p = userToolPaths(environment);
  const boundEnvironment = { ...environment };
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
      storageRoot: p.root,
      executable: path.join(directory, executable),
      integrity,
      name,
      version,
      source,
    };
  };
  const installs = path.join(p.miseData, "installs");
  const layout = {
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
    pnpm: {
      get executable() {
        // Mise owns graph-dependent installation identities; never guess its hash suffix.
        const config = validateMinimalMiseTools(readRepositoryFile(root, ".codex/mise.toml"));
        if (
          config.errors.length ||
          config.versions.pnpm !== matrix.stable.pnpm.version ||
          candidateMiseLockFindings(
            readRepositoryFile(root, ".codex/mise.lock"),
            config.versionLists,
          ).length
        )
          throw new Error("Pinned pnpm resolution requires the safe current toolchain contract.");
        prepareProjectToolDirectories(root, { inherited: boundEnvironment });
        const result = spawnSyncWithBoundedIo(
          verifyProjectToolBundle(root, layout.mise),
          ["ls", "--current", "--json", "--locked"],
          {
            cwd: root,
            env: projectToolEnvironment({ root, inherited: boundEnvironment }),
            encoding: "utf8",
            input: "",
            stdio: "pipe",
            timeout: 20_000,
            maxBuffer: 1024 * 1024,
          },
        );
        if (result.error || result.signal || result.status !== 0)
          throw new Error("Pinned pnpm installation identity could not be resolved by Mise.");
        const entries = JSON.parse(result.stdout).pnpm;
        if (
          !Array.isArray(entries) ||
          entries.length !== 1 ||
          entries[0].requested_version !== matrix.stable.pnpm.version ||
          entries[0].source?.path !== path.join(root, ".codex/mise.toml") ||
          path.dirname(entries[0].install_path ?? "") !== path.join(installs, "pnpm")
        )
          throw new Error(
            "Pinned pnpm installation identity is outside its declared tool storage.",
          );
        return path.join(
          entries[0].install_path,
          "node_modules",
          ".bin",
          platform === "win32" ? "pnpm.cmd" : "pnpm",
        );
      },
    },
  };
  return layout;
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
  root = tool.storageRoot ?? root;
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
  root = tool.storageRoot ?? root;
  assertUserToolParents(root, tool.executable);
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
  const p = userToolPaths();
  if (
    ![p.tools, path.join(p.miseData, "installs")].some((directory) =>
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
    assertUserToolParents(p.root, tool.executable);
    if (name === "mise" || name === "codex") verifyProjectToolBundle(root, tool);
    else if (resolved !== tool.executable)
      throw new Error("Mise-managed runtime must use its real locked installation path.");
    return true;
  }
  return false;
}
