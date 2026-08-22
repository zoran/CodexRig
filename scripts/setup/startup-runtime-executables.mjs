/** Owns canonical external executable binding for the startup session control plane. */
import { existsSync, lstatSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

function pathIsInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

export function canonicalExternalExecutable(root, requestedExecutable, label) {
  if (!path.isAbsolute(requestedExecutable)) {
    throw new Error(`${label} executable path must be absolute.`);
  }
  const canonicalRoot = realpathSync.native(root);
  if (pathIsInside(canonicalRoot, path.resolve(requestedExecutable))) {
    throw new Error(`${label} executable path must remain outside the writable project root.`);
  }
  const executable = realpathSync.native(requestedExecutable);
  const stats = lstatSync(executable);
  if (stats.isSymbolicLink() || !stats.isFile() || (stats.mode & 0o111) === 0) {
    throw new Error(`${label} executable must resolve to an executable regular file.`);
  }
  if (pathIsInside(canonicalRoot, executable)) {
    throw new Error(`${label} executable must remain outside the writable project root.`);
  }
  return executable;
}

export function externalExecutableSearchPath(root, value = "") {
  const canonicalRoot = realpathSync.native(root);
  const entries = [];
  for (const candidate of value.split(path.delimiter)) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (!existsSync(resolved)) continue;
    const canonical = realpathSync.native(resolved);
    if (!lstatSync(canonical).isDirectory()) continue;
    if (pathIsInside(canonicalRoot, canonical)) continue;
    if (!entries.includes(canonical)) entries.push(canonical);
  }
  if (entries.length === 0) {
    throw new Error("Canonical session controller has no external executable search path.");
  }
  return entries.join(path.delimiter);
}

function executableFromSearchPath(root, executableName, searchPath) {
  for (const directory of searchPath.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, executableName);
    if (!existsSync(candidate)) continue;
    return canonicalExternalExecutable(root, candidate, `Canonical ${executableName}`);
  }
  throw new Error(`Canonical ${executableName} executable is unavailable on the external PATH.`);
}

const shellNames = Object.freeze({
  bash: "bash",
  cmd: "cmd",
  powershell: "powershell",
  sh: "sh",
  zsh: "zsh",
});

function shellNameForExecutable(executable) {
  const basename = path
    .basename(executable)
    .toLowerCase()
    .replace(/\.exe$/u, "");
  if (basename === "pwsh") return shellNames.powershell;
  return Object.values(shellNames).includes(basename) ? basename : null;
}

function optionalExternalExecutable(root, candidate, label) {
  if (!candidate || !path.isAbsolute(candidate) || !existsSync(candidate)) return null;
  try {
    return canonicalExternalExecutable(root, candidate, label);
  } catch {
    return null;
  }
}

function searchShellExecutable(root, searchPath, candidates) {
  for (const candidate of candidates) {
    for (const directory of searchPath.split(path.delimiter)) {
      const executable = optionalExternalExecutable(
        root,
        path.join(directory, candidate),
        `Canonical ${candidate} shell`,
      );
      if (executable) return executable;
    }
  }
  return null;
}

/** Mirrors Codex 0.147's local-shell selection while rejecting a writable-project interpreter. */
export function resolveStartupHookShell({
  root,
  searchPath,
  platform = process.platform,
  userShell = platform === "win32" ? "" : os.userInfo().shell,
} = {}) {
  const externalSearchPath = externalExecutableSearchPath(root, searchPath);
  if (platform !== "win32") {
    const userShellName = shellNameForExecutable(userShell ?? "");
    const canonicalUserShell = optionalExternalExecutable(root, userShell, "Canonical user shell");
    if (userShellName && canonicalUserShell) {
      return Object.freeze({ name: userShellName, path: canonicalUserShell });
    }
  }

  const fallbackNames =
    platform === "win32"
      ? ["pwsh.exe", "pwsh", "powershell.exe", "powershell", "cmd.exe", "cmd"]
      : platform === "darwin"
        ? ["zsh", "bash", "sh"]
        : ["bash", "zsh", "sh"];
  const searched = searchShellExecutable(root, externalSearchPath, fallbackNames);
  const platformFallbacks =
    platform === "win32"
      ? [
          process.env.SystemRoot
            ? path.join(
                process.env.SystemRoot,
                "System32",
                "WindowsPowerShell",
                "v1.0",
                "powershell.exe",
              )
            : "",
          process.env.ComSpec ?? "",
        ]
      : platform === "darwin"
        ? ["/bin/zsh", "/bin/bash", "/bin/sh"]
        : ["/bin/bash", "/usr/bin/bash", "/bin/zsh", "/bin/sh"];
  const executable =
    searched ??
    platformFallbacks
      .map((candidate) => optionalExternalExecutable(root, candidate, "Canonical hook shell"))
      .find(Boolean);
  const name = executable ? shellNameForExecutable(executable) : null;
  if (!executable || !name) {
    throw new Error("Canonical session controller could not bind Codex's external local shell.");
  }
  return Object.freeze({ name, path: executable });
}

/** Resolves the one issue-time executable set used by attestation and every launch transition. */
export function resolveStartupRuntimeExecutables({
  root,
  codexExecutable,
  nodeExecutable = process.execPath,
  searchPath,
}) {
  const externalSearchPath = externalExecutableSearchPath(root, searchPath);
  const hookShell = resolveStartupHookShell({ root, searchPath: externalSearchPath });
  return Object.freeze({
    executables: Object.freeze({
      codex: canonicalExternalExecutable(root, codexExecutable, "Canonical Codex"),
      node: canonicalExternalExecutable(root, nodeExecutable, "Canonical Node"),
      pnpm: executableFromSearchPath(root, "pnpm", externalSearchPath),
      shell: hookShell.path,
    }),
    hookShell,
    searchPath: externalSearchPath,
  });
}

/** Rejects non-canonical, project-local, or partial executable bindings at every consumer. */
export function validateStartupRuntimeExecutables(root, value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !== "codex\nnode\npnpm\nshell"
  ) {
    throw new Error("Startup runtime executable binding is invalid.");
  }
  const codex = canonicalExternalExecutable(root, value.codex, "Canonical Codex");
  const node = canonicalExternalExecutable(root, value.node, "Canonical Node");
  const pnpm = canonicalExternalExecutable(root, value.pnpm, "Canonical pnpm");
  const shell = canonicalExternalExecutable(root, value.shell, "Canonical hook shell");
  if (
    codex !== value.codex ||
    node !== value.node ||
    pnpm !== value.pnpm ||
    shell !== value.shell
  ) {
    throw new Error("Startup runtime executable binding must use canonical absolute paths.");
  }
  return Object.freeze({ codex, node, pnpm, shell });
}
