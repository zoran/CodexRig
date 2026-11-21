/** Owns reusable, versioned tool payloads outside repositories; never selects account homes. */
import { lstatSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { ensureOwnedDirectoryChain } from "../filesystem/owned-file-operations.mjs";

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
