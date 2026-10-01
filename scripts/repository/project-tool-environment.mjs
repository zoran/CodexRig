/** Owns the clean, repository-bound environment shared by developer tools and their descendants. */
import { lstatSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { ensureOwnedDirectoryChain } from "../filesystem/owned-file-operations.mjs";
import { projectAccountStateDirectory } from "./source-inventory-policy.mjs";

export const projectToolStateDirectory = `${projectAccountStateDirectory}/project-tools`;

// Inheritance is an allowlist, not a catalogue of known credential variable names. A newly added
// provider's ambient token is therefore absent without adding another provider-specific filter.
const inheritedPresentationKeys = new Set([
  "CI",
  "COLORTERM",
  "COMSPEC",
  "FORCE_COLOR",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "NO_COLOR",
  "NUMBER_OF_PROCESSORS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "SYSTEMROOT",
  "TERM",
  "TERM_PROGRAM",
  "TZ",
  "WINDIR",
]);
// Verification semantics must survive the project launcher, publisher and native pre-push hook.
// This is the sole inheritance policy; the verifier still owns normalization and value validation.
const inheritedVerificationControlPattern =
  /^(?:IMAGE_ASSET_[A-Z0-9_]+|NODE_ENV|VERIFY_MAX_CAPTURE_BYTES|VERIFY_MAX_PARALLEL)$/u;

/** Resolves only public path names; never reads account contents or borrows another home's state. */
export function projectToolPaths(root) {
  const requested = path.resolve(root);
  const stats = lstatSync(requested);
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    realpathSync.native(requested) !== requested
  )
    throw new Error("Project tools require a canonical repository directory.");
  const state = path.join(requested, projectToolStateDirectory);
  return Object.freeze({
    root: requested,
    state,
    home: path.join(state, "home"),
    config: path.join(state, "config"),
    data: path.join(state, "data"),
    cache: path.join(state, "cache"),
    persistent: path.join(state, "state"),
    runtime: path.join(state, "run"),
    temporary: path.join(state, "tmp"),
    tools: path.join(state, "tools"),
  });
}

/** Prepares private storage after the caller's inventory/admission, without resetting any account. */
export function prepareProjectToolDirectories(root) {
  const locations = projectToolPaths(root);
  for (const directory of [
    path.join(locations.root, projectAccountStateDirectory),
    ...Object.values(locations),
  ]) {
    if (directory === locations.root) continue;
    ensureOwnedDirectoryChain(
      locations.root,
      path.relative(locations.root, directory),
      "project tool storage",
      { createdMode: 0o700 },
    );
    const stats = lstatSync(directory);
    if (
      (stats.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && stats.uid !== process.getuid())
    )
      throw new Error("Project tool storage must be private and owned by the current developer.");
  }
  assertGitCredentialStore(locations);
  // Umask is process state, not an environment variable. Installers and their descendants
  // must not inherit a host's group/other write allowance; retain stricter caller restrictions.
  process.umask(process.umask() | 0o022);
  return locations;
}

function assertGitCredentialStore(locations) {
  // The preparation owner has already validated every parent directory without reading accounts.
  let stats;
  try {
    stats = lstatSync(path.join(locations.home, ".git-credentials"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    stats.nlink !== 1 ||
    (stats.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && stats.uid !== process.getuid())
  )
    throw new Error("Git credentials require private project-owned storage.");
}

/**
 * Establishes standard home/config/data/cache defaults for every tool, including unknown future
 * tools. Explicit controls below close nonstandard discovery in current consumers; they are not
 * the set of tools covered by the policy. Account adapters must separately prove that a tool cannot
 * escape to an OS keyring, credential process, agent, metadata identity, or external config include.
 * No caller-supplied account override or ambient secret is accepted by this boundary.
 */
export function projectToolEnvironment({ root, inherited = process.env } = {}) {
  const p = projectToolPaths(root);
  const credentialStore = path.join(p.home, ".git-credentials");
  const environment = {};
  for (const [key, value] of Object.entries(inherited)) {
    const normalizedKey = process.platform === "win32" ? key.toUpperCase() : key;
    if (
      (!inheritedPresentationKeys.has(normalizedKey) &&
        !inheritedVerificationControlPattern.test(normalizedKey)) ||
      typeof value !== "string" ||
      value.includes("\0")
    )
      continue;
    environment[normalizedKey] = value;
  }
  return {
    ...environment,
    HOME: p.home,
    USERPROFILE: p.home,
    APPDATA: p.config,
    LOCALAPPDATA: p.data,
    XDG_CONFIG_HOME: p.config,
    XDG_DATA_HOME: p.data,
    XDG_CACHE_HOME: p.cache,
    XDG_STATE_HOME: p.persistent,
    XDG_RUNTIME_DIR: p.runtime,
    TMPDIR: p.temporary,
    TMP: p.temporary,
    TEMP: p.temporary,
    CODEX_HOME: p.root,
    CLOUDSDK_CONFIG: path.join(p.config, "gcloud"),
    GOOGLE_APPLICATION_CREDENTIALS: path.join(
      p.config,
      "gcloud",
      "application_default_credentials.json",
    ),
    CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK: "true",
    DEV_CLOUD_TOOLS_USER_STATE_ROOT: path.join(p.state, "cloud-tools"),
    AWS_CONFIG_FILE: path.join(p.config, "aws", "config"),
    AWS_SHARED_CREDENTIALS_FILE: path.join(p.config, "aws", "credentials"),
    AWS_EC2_METADATA_DISABLED: "true",
    AZURE_CONFIG_DIR: path.join(p.config, "azure"),
    DOCKER_CONFIG: path.join(p.config, "docker"),
    KUBECONFIG: path.join(p.config, "kube", "config"),
    GH_CONFIG_DIR: path.join(p.config, "gh"),
    GLAB_CONFIG_DIR: path.join(p.config, "glab"),
    GNUPGHOME: path.join(p.config, "gnupg"),
    GIT_CONFIG_GLOBAL: path.join(p.config, "git", "config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "5",
    GIT_CONFIG_KEY_0: "user.useConfigOnly",
    GIT_CONFIG_VALUE_0: "true",
    // Git owns approve/get/reject and its private atomic credential file. Reset lower-priority
    // helpers; only the explicit GitHub/GitLab fallback below may consult a global login.
    GIT_CONFIG_KEY_1: "credential.helper",
    GIT_CONFIG_VALUE_1: "",
    GIT_CONFIG_KEY_2: "credential.helper",
    GIT_CONFIG_VALUE_2: `store --file='${credentialStore.replaceAll("'", "'\\''")}'`,
    GIT_CONFIG_KEY_3: "credential.useHttpPath",
    GIT_CONFIG_VALUE_3: "true",
    GIT_CONFIG_KEY_4: "credential.helper",
    GIT_CONFIG_VALUE_4: `!${[process.execPath, path.join(p.root, "scripts/repository/global-git-credential.mjs")].map((value) => `'${value.replaceAll("'", "'\\''")}'`).join(" ")}`,
    // OpenSSH resolves its default home through the OS account database, not HOME. Git's SSH
    // transport therefore binds keys/known-hosts explicitly and never consults host agents/config.
    GIT_SSH_COMMAND: [
      "ssh",
      "-F",
      "none",
      "-o",
      "IdentityAgent=none",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "IdentityFile=${HOME}/.ssh/id_ed25519",
      "-o",
      "UserKnownHostsFile=${HOME}/.ssh/known_hosts",
      "-o",
      `GlobalKnownHostsFile=${os.devNull}`,
      "-o",
      "GSSAPIAuthentication=no",
    ]
      .map((argument) => `'${argument.replaceAll("'", "'\\''")}'`)
      .join(" "),
    GIT_SSH_VARIANT: "ssh",
    // An empty, unreachable bus prevents implicit use of the host's desktop credential broker.
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(p.runtime, "no-host-keyring")}`,
    MISE_CONFIG_DIR: path.join(p.config, "mise"),
    MISE_GLOBAL_CONFIG_FILE: path.join(p.config, "mise", "config.toml"),
    MISE_SYSTEM_CONFIG_DIR: path.join(p.config, "mise-system"),
    MISE_SYSTEM_CONFIG_FILE: path.join(p.config, "mise-system", "config.toml"),
    MISE_SYSTEM_DATA_DIR: path.join(p.data, "mise-system"),
    // Keep pins outside ancestor auto-discovery so the outer host shell cannot activate them.
    MISE_OVERRIDE_CONFIG_FILENAMES: path.join(p.root, ".codex/mise.toml"),
    MISE_OVERRIDE_TOOL_VERSIONS_FILENAMES: "none",
    // Mise excludes the ceiling directory itself; the project must be below that boundary.
    MISE_CEILING_PATHS: path.dirname(p.root),
    MISE_AUTO_INSTALL: "false",
    MISE_AUTO_UPDATE: "false",
    MISE_NOT_FOUND_SYSTEM_FALLBACK: "false",
    MISE_TRUSTED_CONFIG_PATHS: path.join(p.root, ".codex/mise.toml"),
    MISE_TMP_DIR: p.temporary,
    MISE_DATA_DIR: path.join(p.data, "mise"),
    MISE_CACHE_DIR: path.join(p.cache, "mise"),
    MISE_STATE_DIR: path.join(p.state, "mise"),
    NPM_CONFIG_USERCONFIG: path.join(p.config, "npm", "npmrc"),
    NPM_CONFIG_GLOBALCONFIG: path.join(p.config, "npm", "global-npmrc"),
    NPM_CONFIG_PREFIX: path.join(p.data, "npm"),
    NPM_CONFIG_CACHE: path.join(p.cache, "npm"),
    NPM_CONFIG_IGNORE_PNPMFILE: "true",
    PNPM_CONFIG_IGNORE_PNPMFILE: "true",
    PNPM_CONFIG_STORE_DIR: path.join(p.data, "pnpm", "store"),
    PNPM_HOME: path.join(p.data, "pnpm"),
    GRADLE_USER_HOME: path.join(p.data, "gradle"),
    ANDROID_USER_HOME: path.join(p.data, "android"),
    ADB_VENDOR_KEYS: path.join(p.config, "android", "adbkey"),
    PYTHON_KEYRING_BACKEND: "keyring.backends.null.Keyring",
  };
}
