#!/usr/bin/env node
/** Owns global Git credential fallback for configured GitHub and GitLab hosts. */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { lstatSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import {
  atomicWriteOwnedFile,
  createExclusiveOwnedDirectory,
  readOptionalOwnedFile,
  removeOwnedArtifact,
} from "../filesystem/owned-file-operations.mjs";
import { readToolingConfiguration } from "../contracts/tooling-configuration.mjs";
import { spawnSyncWithBoundedIo as spawnSync } from "./runtime-process-io.mjs";
import {
  prepareProjectToolDirectories,
  projectToolEnvironment,
} from "./project-tool-environment.mjs";

const maximumBytes = 64 * 1024;
const recoveryVariable = "CODEXRIG_GIT_CREDENTIAL_RECOVERY";
const recoveryLabel = "Git credential recovery";

function attributes(input) {
  if (typeof input !== "string" || Buffer.byteLength(input) > maximumBytes || /[\0\r]/u.test(input))
    return null;
  const values = Object.create(null);
  for (const line of input.split("\n")) {
    if (!line) break;
    const separator = line.indexOf("=");
    if (separator < 1) return null;
    const key = line.slice(0, separator);
    if (Object.hasOwn(values, key)) return null;
    values[key] = line.slice(separator + 1);
  }
  return values;
}

function providerRequest(root, input, { allowPassword = false } = {}) {
  const values = attributes(input);
  if (
    !values ||
    values.protocol !== "https" ||
    !/^[a-z0-9][a-z0-9.-]*(?::[0-9]{1,5})?$/iu.test(values.host ?? "") ||
    (!allowPassword && values.password)
  )
    return null;
  const hostname = new URL(`https://${values.host}`).hostname.toLowerCase();
  const { hosts } = readToolingConfiguration(root).platform;
  const provider = ["github", "gitlab"].find((name) => hosts[name].includes(hostname));
  if (!provider) return null;
  const request = Object.fromEntries(
    ["protocol", "host", "path", "username"]
      .filter((key) => values[key])
      .map((key) => [key, values[key]]),
  );
  return { request, provider };
}

function serialized(values) {
  return (
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join("") + "\n"
  );
}

function recoveryFile(root, id) {
  if (!/^[a-f0-9-]{36}$/u.test(id ?? "")) throw new Error("Invalid credential recovery context.");
  return path.join(
    prepareProjectToolDirectories(root).temporary,
    `git-recovery-${id}`,
    "state.json",
  );
}

function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join() === keys.sort().join()
  );
}

function assertRecoveryDirectory(file, binding) {
  const stats = lstatSync(path.dirname(file));
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    (stats.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && stats.uid !== process.getuid()) ||
    String(stats.dev) !== binding.device ||
    String(stats.ino) !== binding.inode
  )
    throw new Error("Credential recovery directory binding changed.");
  return stats;
}

function readRecovery(root, inherited) {
  const descriptor = inherited[recoveryVariable];
  if (!descriptor) return null;
  let binding;
  try {
    if (typeof descriptor !== "string" || descriptor.length > 8192) throw new Error();
    binding = JSON.parse(descriptor);
    if (
      !exactKeys(binding, ["id", "device", "inode", "request", "salt"]) ||
      !/^[0-9]+$/u.test(binding.device) ||
      !/^[0-9]+$/u.test(binding.inode) ||
      !/^[a-f0-9]{64}$/u.test(binding.salt) ||
      !exactKeys(binding.request, ["protocol", "host", "path"]) ||
      binding.request.protocol !== "https" ||
      typeof binding.request.host !== "string" ||
      typeof binding.request.path !== "string" ||
      /[\0\r\n]/u.test(binding.request.path)
    )
      throw new Error();
  } catch {
    throw new Error("Invalid credential recovery context.");
  }
  const file = recoveryFile(root, binding.id);
  assertRecoveryDirectory(file, binding);
  const snapshot = readOptionalOwnedFile(root, file, recoveryLabel, { maximumBytes: 8192 });
  if (
    !snapshot.exists ||
    (snapshot.stats.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && snapshot.stats.uid !== process.getuid())
  )
    throw new Error("Unavailable credential recovery context.");
  const state = JSON.parse(snapshot.buffer.toString("utf8"));
  if (
    !exactKeys(state, ["schemaVersion", "request", "salt", "rejected"]) ||
    state.schemaVersion !== 1 ||
    !/^[a-f0-9]{64}$/u.test(state.salt ?? "") ||
    !Array.isArray(state.rejected) ||
    state.rejected.length > 3 ||
    state.rejected.some((digest) => !/^[a-f0-9]{64}$/u.test(digest)) ||
    new Set(state.rejected).size !== state.rejected.length ||
    state.salt !== binding.salt ||
    !exactKeys(state.request, ["protocol", "host", "path"]) ||
    Object.keys(binding.request).some((key) => state.request[key] !== binding.request[key])
  )
    throw new Error("Invalid credential recovery state.");
  assertRecoveryDirectory(file, binding);
  return { file, state, binding };
}

function matchesRecovery(recovery, request) {
  return (
    recovery &&
    recovery.state.request.protocol === request.protocol &&
    recovery.state.request.host === request.host.toLowerCase() &&
    recovery.state.request.path === (request.path ?? "")
  );
}

function credentialDigest(recovery, password) {
  return createHmac("sha256", recovery.state.salt).update(password).digest("hex");
}

/** Owns one bound remote operation's private rejection evidence; callers may retry at most twice. */
export function createGitCredentialRecovery({ root = toolingRoot, url } = {}) {
  const inert = { environment: {}, canRetry: () => false, close() {} };
  let destination;
  let destinationPath;
  let destinationHost;
  try {
    destination = new URL(url);
    if (destination.username || destination.password || destination.search || destination.hash)
      return inert;
    // Git keeps explicit default ports and dot segments, while trimming path-edge slashes.
    // WHATWG URL is the syntax check; its normalized host/path cannot bind Git's helper request.
    const literal = /^https:\/\/([^/?#]+)(\/[^?#]*)?$/iu.exec(url);
    if (!literal) return inert;
    destinationHost = decodeURIComponent(literal[1]).toLowerCase();
    destinationPath = decodeURIComponent(literal[2] ?? "").replace(/^\/+|\/+$/gu, "");
    if (/[\0\r\n]/u.test(destinationPath)) return inert;
  } catch {
    return inert;
  }
  const context = providerRequest(
    root,
    serialized({
      protocol: destination.protocol.slice(0, -1),
      host: destinationHost,
      path: destinationPath,
    }),
  );
  if (!context) return inert;
  const id = randomUUID();
  const file = recoveryFile(root, id);
  const directory = path.dirname(file);
  createExclusiveOwnedDirectory(root, directory, recoveryLabel);
  const identity = lstatSync(directory);
  const binding = {
    id,
    device: String(identity.dev),
    inode: String(identity.ino),
    request: {
      protocol: "https",
      host: context.request.host.toLowerCase(),
      path: context.request.path ?? "",
    },
    salt: randomBytes(32).toString("hex"),
  };
  const environment = Object.freeze({ [recoveryVariable]: JSON.stringify(binding) });
  let closed = false;
  const close = () => {
    if (closed) return;
    removeOwnedArtifact(root, directory, "directory", recoveryLabel, {
      expectedIdentity: assertRecoveryDirectory(file, binding),
    });
    closed = true;
  };
  try {
    atomicWriteOwnedFile(
      root,
      file,
      JSON.stringify({
        schemaVersion: 1,
        request: binding.request,
        salt: binding.salt,
        rejected: [],
      }),
      0o600,
      { label: recoveryLabel },
    );
  } catch (error) {
    close();
    throw error;
  }
  let retries = 0;
  let consumed = 0;
  return {
    environment,
    canRetry() {
      if (closed || retries >= 2) return false;
      const count = readRecovery(root, environment).state.rejected.length;
      if (count <= consumed) return false;
      consumed = count;
      retries += 1;
      return true;
    },
    close,
  };
}

/** Only get crosses the authorized host boundary; approval/rejection never reach global accounts. */
export function globalGitCredential({
  root = toolingRoot,
  operation,
  input,
  hostHome = os.userInfo().homedir,
  inherited = process.env,
} = {}) {
  if (!["get", "erase"].includes(operation)) return "";
  const context = providerRequest(root, input, { allowPassword: operation === "erase" });
  if (!context) return "";
  const { request, provider } = context;
  const recovery = readRecovery(root, inherited);
  const boundRecovery = matchesRecovery(recovery, request) ? recovery : null;
  if (operation === "erase") {
    const password = attributes(input).password;
    if (!boundRecovery || !password) return "";
    const digest = credentialDigest(boundRecovery, password);
    if (!boundRecovery.state.rejected.includes(digest) && boundRecovery.state.rejected.length < 3) {
      boundRecovery.state.rejected.push(digest);
      assertRecoveryDirectory(boundRecovery.file, boundRecovery.binding);
      atomicWriteOwnedFile(root, boundRecovery.file, JSON.stringify(boundRecovery.state), 0o600, {
        label: recoveryLabel,
      });
      assertRecoveryDirectory(boundRecovery.file, boundRecovery.binding);
    }
    return "";
  }
  const locations = prepareProjectToolDirectories(root);
  const environment = projectToolEnvironment({ root, inherited });
  for (const key of Object.keys(environment))
    if (
      /^(?:GIT_|GH_|GITHUB_|GLAB_|GITLAB_)/u.test(key) ||
      ["XDG_CONFIG_HOME", "DEV_CLOUD_TOOLS_USER_STATE_ROOT"].includes(key)
    )
      delete environment[key];
  Object.assign(environment, {
    HOME: hostHome,
    USERPROFILE: hostHome,
    APPDATA: path.join(hostHome, "AppData", "Roaming"),
    GH_PROMPT_DISABLED: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    GCM_INTERACTIVE: "never",
    GCM_GUI_PROMPT: "false",
  });
  // Only the credential adapter may access the logged-in user's standard desktop keyring.
  // Other tools retain the unreachable bus and private account home from the shared environment.
  if (process.platform === "linux" && typeof process.getuid === "function") {
    environment.XDG_RUNTIME_DIR = `/run/user/${process.getuid()}`;
    environment.DBUS_SESSION_BUS_ADDRESS = `unix:path=${environment.XDG_RUNTIME_DIR}/bus`;
  }
  environment.PATH = (environment.PATH ?? "")
    .split(path.delimiter)
    .filter(
      (directory) =>
        path.isAbsolute(directory) && directory !== root && !directory.startsWith(root + path.sep),
    )
    .join(path.delimiter);
  const directory = mkdtempSync(path.join(locations.temporary, "git-credential-"));
  // This empty owned directory plus the ceiling excludes all repository-local Git configuration.
  environment.GIT_CEILING_DIRECTORIES = locations.temporary;
  try {
    for (const [command, args] of [
      ["git", ["-c", "credential.interactive=false", "-c", "core.askPass=", "credential", "fill"]],
      [provider === "github" ? "gh" : "glab", ["auth", "git-credential", "get"]],
    ]) {
      const result = spawnSync(command, args, {
        cwd: directory,
        env: environment,
        input: serialized(request),
        encoding: "utf8",
        stdio: "pipe",
        timeout: 10_000,
        maxBuffer: maximumBytes,
      });
      if (result.error || result.signal || result.status !== 0) continue;
      const received = attributes(result.stdout);
      if (
        !received?.username ||
        !received.password ||
        (received.host && received.host.toLowerCase() !== request.host.toLowerCase()) ||
        (received.protocol && received.protocol !== request.protocol) ||
        (request.username &&
          (provider === "github"
            ? received.username.toLowerCase() !== request.username.toLowerCase()
            : received.username !== request.username) &&
          !["x-access-token", "oauth2"].includes(received.username))
      )
        continue;
      if (received.password_expiry_utc && Number(received.password_expiry_utc) <= Date.now() / 1000)
        continue;
      if (
        boundRecovery?.state.rejected.includes(credentialDigest(boundRecovery, received.password))
      )
        continue;
      return serialized({
        username: received.username,
        password: received.password,
        ...(received.password_expiry_utc
          ? { password_expiry_utc: received.password_expiry_utc }
          : {}),
      });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return "";
}

if (
  process.argv[1] === fileURLToPath(import.meta.url) &&
  ["get", "erase"].includes(process.argv[2])
) {
  try {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk.toString("utf8");
      if (Buffer.byteLength(input) > maximumBytes) throw new Error("Credential input limit");
    }
    process.stdout.write(globalGitCredential({ operation: process.argv[2], input }));
  } catch {
    // A missing/unavailable global account falls through to Git's ordinary project sign-in.
    // Credential-helper diagnostics can contain tokens and must never reach the terminal.
  }
}
