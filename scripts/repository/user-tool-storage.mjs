/** Owns reusable, versioned tool payloads outside repositories; never selects account homes. */
import {
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import {
  ensureOwnedDirectoryChain,
  removeOwnedArtifact,
} from "../filesystem/owned-file-operations.mjs";
import { readRepositoryFile } from "../filesystem/repository-files.mjs";
import { parsePortableToml } from "../contracts/portable-toml.mjs";
import { parseSemver } from "../contracts/semver-contract.mjs";
import { claimAndRemove, ensureOwnedPrivateDirectory } from "../filesystem/owned-path-safety.mjs";

export const deferredMiseTrackingErrorCode = "ERR_DEFERRED_MISE_TRACKING";

export function userToolPaths(inherited = process.env) {
  // HOME is intentionally project-private. Use the OS account, or an explicit storage-only
  // relocation (also used by isolated integration fixtures), never ambient HOME/XDG overrides.
  const root =
    inherited.PROJECT_TOOL_STORAGE_HOME ??
    process.env.PROJECT_TOOL_STORAGE_HOME ??
    os.userInfo().homedir;
  if (typeof root !== "string" || !path.isAbsolute(root) || path.resolve(root) !== root)
    throw new Error("User tool storage requires an absolute canonical home.");
  const stats = lstatSync(root);
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    realpathSync.native(root) !== root ||
    (stats.mode & 0o022) !== 0 ||
    (typeof process.getuid === "function" && stats.uid !== process.getuid())
  )
    throw new Error(
      "User tool storage must be a real developer-owned home without foreign write access.",
    );
  const data = path.join(root, ".local", "share");
  const cache = path.join(root, ".cache", "project-tools");
  const lifecycle = path.join(data, "project-tools");
  return Object.freeze({
    root,
    lifecycle,
    tools: path.join(lifecycle, "tools"),
    temporary: path.join(lifecycle, "tmp"),
    miseData: path.join(lifecycle, "mise"),
    miseTrackedConfigs: path.join(lifecycle, "mise-tracked-configs"),
    miseCache: path.join(cache, "mise"),
    pnpmHome: path.join(lifecycle, "pnpm"),
    pnpmStore: path.join(lifecycle, "pnpm", "store"),
    pnpmCache: path.join(cache, "pnpm"),
    npmPrefix: path.join(lifecycle, "npm"),
    npmCache: path.join(cache, "npm"),
    playwrightBrowsers: path.join(cache, "playwright"),
    puppeteerCache: path.join(cache, "puppeteer"),
  });
}

/** Validate every existing parent as well as newly created paths before exposing shared code. */
export function assertUserToolParents(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Managed tool must remain inside its user storage home.");
  let cursor = root;
  for (const part of relative.split(path.sep).slice(0, -1)) {
    cursor = path.join(cursor, part);
    const stats = lstatSync(cursor);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      (stats.mode & 0o022) !== 0 ||
      (typeof process.getuid === "function" && stats.uid !== process.getuid())
    )
      throw new Error(
        "Managed tool parents must be real developer-owned directories without foreign write access.",
      );
  }
}

export function prepareUserToolDirectories(inherited = process.env) {
  const locations = userToolPaths(inherited);
  for (const directory of Object.values(locations)) {
    if (directory === locations.root) continue;
    ensureOwnedDirectoryChain(
      locations.root,
      path.relative(locations.root, directory),
      "user tool storage",
      { createdMode: 0o700 },
    );
    assertUserToolParents(locations.root, path.join(directory, "entry"));
  }
  return locations;
}

/** Shared references describe public pins; each project still owns its stricter execution admission. */
function hasNonExecutingTrackedPins(content) {
  try {
    const parsed = parsePortableToml(content);
    if (
      Object.keys(parsed).some((key) => !["tools", "tool_alias"].includes(key)) ||
      !parsed.tools ||
      Array.isArray(parsed.tools)
    )
      return false;
    if (
      parsed.tool_alias &&
      JSON.stringify(parsed.tool_alias) !== JSON.stringify({ pnpm: { backend: "npm:pnpm" } })
    )
      return false;
    const entries = Object.entries(parsed.tools);
    if (!entries.length || entries.length > 64) return false;
    return entries.every(([tool, value]) => {
      if (!/^(?:[a-z][a-z0-9_-]*|npm:pnpm)$/u.test(tool)) return false;
      const pins = Array.isArray(value) ? value : [value];
      return (
        pins.length > 0 &&
        pins.length <= 16 &&
        new Set(pins).size === pins.length &&
        pins.every((pin) => {
          if (typeof pin !== "string") return false;
          if (tool === "java")
            return /^(?:[a-z][a-z0-9-]*-)?\d+\.\d+\.\d+(?:\+\d+(?:\.\d+)*(?:\.LTS)?)?$/u.test(pin);
          return parseSemver(pin).raw === pin;
        })
      );
    });
  } catch {
    return false;
  }
}

function privateMiseConfig(root, config) {
  return ["mise", "mise-system"].some(
    (name) => config === path.join(root, ".auth/project-tools/config", name, "config.toml"),
  );
}

/** Publishes only public pins into native tracking; each project's private tracker stays local. */
export function prepareMiseTracking(root, { migrate = false, inherited = process.env } = {}) {
  if (!existsSync(path.join(root, ".codex/mise.toml"))) return false;
  if (!hasNonExecutingTrackedPins(readRepositoryFile(root, ".codex/mise.toml"))) return false;
  const shared = prepareUserToolDirectories(inherited);
  const directory = path.join(root, ".auth/project-tools/mise/tracked-configs");
  ensureOwnedDirectoryChain(root, ".auth/project-tools/mise", "private Mise state");
  ensureOwnedPrivateDirectory(root, path.join(root, ".auth/project-tools"), "private tool state", {
    repairMode: false,
  });
  ensureOwnedPrivateDirectory(root, path.dirname(directory), "private Mise state");
  const existing = lstatSync(directory, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink()) {
    if (readlinkSync(directory) !== shared.miseTrackedConfigs)
      throw new Error("Mise tracking must bind the admitted user installation registry.");
    if (!migrate) return false;
    removeOwnedArtifact(root, directory, "symlink", "legacy shared Mise tracker", {
      expectedIdentity: existing,
    });
  }
  ensureOwnedPrivateDirectory(root, directory, "private Mise tracking");
  // A migration interrupted after detaching the link resumes here. Copy before retiring the
  // caller's shared private references; foreign references and all configuration bytes survive.
  if (migrate)
    for (const name of readdirSync(shared.miseTrackedConfigs)) {
      const source = path.join(shared.miseTrackedConfigs, name);
      const identity = lstatSync(source);
      if (!identity.isSymbolicLink())
        throw new Error("Mise project reference is not a native link.");
      const target = readlinkSync(source);
      if (!privateMiseConfig(root, target)) continue;
      const destination = path.join(directory, name);
      const previous = lstatSync(destination, { throwIfNoEntry: false });
      if (previous && (!previous.isSymbolicLink() || readlinkSync(destination) !== target))
        throw new Error("Mise tracking has conflicting private project references.");
      if (!previous) symlinkSync(target, destination);
      claimAndRemove({
        ownedRootPath: shared.root,
        artifactPath: source,
        expectedType: "symlink",
        expectedIdentity: identity,
        label: "migrated private Mise reference",
      });
    }
  const config = path.join(root, ".codex/mise.toml");
  const reference = path.join(
    shared.miseTrackedConfigs,
    `project-${createHash("sha256").update(config).digest("hex")}`,
  );
  try {
    symlinkSync(config, reference);
  } catch (error) {
    if (
      error.code !== "EEXIST" ||
      !lstatSync(reference).isSymbolicLink() ||
      readlinkSync(reference) !== config
    )
      throw error;
  }
  return true;
}

/** Admits native GC only for a complete trusted pin inventory; deferred roots are never read. */
export function trackedToolProjects(inherited = process.env) {
  const shared = userToolPaths(inherited);
  assertUserToolParents(shared.root, path.join(shared.miseTrackedConfigs, "entry"));
  const projects = new Set();
  const retentionReasons = new Set();
  const entries = readdirSync(shared.miseTrackedConfigs);
  if (entries.length > 4096) throw new Error("Mise project reference inventory exceeds its bound.");
  for (const name of entries) {
    const reference = path.join(shared.miseTrackedConfigs, name);
    if (!lstatSync(reference).isSymbolicLink())
      throw new Error("Mise project reference is not a native link.");
    const config = readlinkSync(reference);
    if (!existsSync(config)) continue; // Native mise prune owns retirement of disappeared configs.
    if (
      path.isAbsolute(config) &&
      ["mise", "mise-system"].some((name) =>
        config.endsWith(
          `${path.sep}${path.join(".auth", "project-tools", "config", name, "config.toml")}`,
        ),
      )
    ) {
      // Native Mise also tracks private environment/settings files. Never read or execute those
      // through another project's collector, and do not discard references that may retain tools.
      const project = config.slice(0, config.lastIndexOf(`${path.sep}.auth${path.sep}`));
      retentionReasons.add(
        `legacy private Mise configuration for ${JSON.stringify(project)}; run that project's updated startup to migrate its references`,
      );
      continue;
    }
    if (
      !path.isAbsolute(config) ||
      path.basename(config) !== "mise.toml" ||
      path.basename(path.dirname(config)) !== ".codex"
    )
      throw new Error("Shared tool cleanup encountered an unrecognized project configuration.");
    const root = path.dirname(path.dirname(config));
    const stats = lstatSync(root);
    const problems = [];
    if (!stats.isDirectory() || stats.isSymbolicLink() || realpathSync.native(root) !== root)
      problems.push("noncanonical directory");
    if ((stats.mode & 0o022) !== 0) problems.push("group/other-writable directory");
    if (typeof process.getuid === "function" && stats.uid !== process.getuid())
      problems.push("directory owned by another user");
    if (problems.length) {
      // A shared reference cannot authorize this project to read or repair another root. Keep
      // every shared version, but let the caller continue maintenance independent of this GC.
      retentionReasons.add(`${JSON.stringify(root)}: ${problems.join(", ")}`);
      continue;
    }
    assertUserToolParents(root, config);
    if ((lstatSync(config).mode & 0o022) !== 0)
      throw new Error("Shared tool cleanup refused a foreign-writable pin document.");
    if (!hasNonExecutingTrackedPins(readRepositoryFile(root, ".codex/mise.toml")))
      throw new Error("Shared tool cleanup requires non-executing exact project pins.");
    projects.add(root);
  }
  // Retention must never conceal a malformed public reference later in the inventory. Never
  // return a partial project set: it could authorize deleting another project's tool versions.
  if (retentionReasons.size) {
    const error = new Error(
      `Shared runtime collection deferred: ${[...retentionReasons].join("; ")}`,
    );
    error.code = deferredMiseTrackingErrorCode;
    throw error;
  }
  return [...projects];
}
