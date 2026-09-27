/** Resolves publication-only Git identity metadata without importing or changing host configuration. */
import os from "node:os";
import path from "node:path";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import { projectToolEnvironment } from "./project-tool-environment.mjs";
import {
  isTerminalSynchronousProcessResult,
  spawnSyncWithBoundedIo,
} from "./runtime-process-io.mjs";

const maximumBytes = 64 * 1024;
const identityKeys = [
  "user.name",
  "user.email",
  "author.name",
  "author.email",
  "committer.name",
  "committer.email",
];
const identityHelp =
  "Publication needs valid Git author and committer metadata. Configure this project with:\n" +
  '  bash scripts/setup/run-project.sh git config --local user.name "Your Name"\n' +
  '  bash scripts/setup/run-project.sh git config --local user.email "you@example.com"\n' +
  "Also check any explicit project author.name/email or committer.name/email settings.";

function validMetadata(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Buffer.byteLength(value) <= maximumBytes &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

/** Native precedence selects author/committer values; only missing user defaults may consult host metadata. */
export function resolvePublicationIdentity({
  root = toolingRoot,
  userHome = os.userInfo().homedir,
  runGit = spawnSyncWithBoundedIo,
} = {}) {
  try {
    if (typeof userHome !== "string" || !path.isAbsolute(userHome) || userHome.includes("\0"))
      throw new Error();
    const environment = projectToolEnvironment({ root });
    const execute = (args, env = environment) => {
      const result = runGit("git", args, {
        cwd: root,
        env,
        encoding: "utf8",
        stdio: "pipe",
        timeout: 10_000,
        maxBuffer: maximumBytes,
      });
      if (
        !isTerminalSynchronousProcessResult(result, {
          command: "git",
          args,
          encoding: "utf8",
          maximumOutputBytes: maximumBytes,
        })
      )
        throw new Error();
      return result;
    };
    const setting = (key, env = environment, global = false) => {
      const result = execute(
        ["config", ...(global ? ["--global"] : []), "--no-includes", "--null", "--get", key],
        env,
      );
      if (result.status === 1 && result.stdout === "") return null;
      if (result.status !== 0 || !result.stdout.endsWith("\0")) throw new Error();
      const value = result.stdout.slice(0, -1);
      if (!validMetadata(value)) throw new Error();
      return value;
    };
    // Reject malformed explicit values before Git can normalize their control characters away.
    const configured = new Map(identityKeys.map((key) => [key, setting(key)]));
    const nativeIdentity = (argumentsBeforeVar = []) => {
      const selected = {};
      for (const role of ["AUTHOR", "COMMITTER"]) {
        const result = execute([...argumentsBeforeVar, "var", `GIT_${role}_IDENT`]);
        if (result.status !== 0) return null;
        const match = /^([^<>\r\n]+) <([^<>\r\n]+)> [0-9]+ [+-][0-9]{4}\n?$/u.exec(result.stdout);
        if (!match || !validMetadata(match[1]) || !validMetadata(match[2])) return null;
        selected[`GIT_${role}_NAME`] = match[1];
        selected[`GIT_${role}_EMAIL`] = match[2];
      }
      return selected;
    };
    const complete = nativeIdentity();
    if (complete) return Object.freeze(complete);

    // This environment has no ambient Git/account controls. --global plus --no-includes reads
    // only standard OS-user metadata files; no host helper, hook or signing setting is imported.
    const hostEnvironment = {
      ...(environment.PATH ? { PATH: environment.PATH } : {}),
      HOME: userHome,
      USERPROFILE: userHome,
      APPDATA: path.join(userHome, "AppData", "Roaming"),
      XDG_CONFIG_HOME: path.join(userHome, ".config"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_SYSTEM: os.devNull,
      GIT_CONFIG_COUNT: "0",
      GIT_TERMINAL_PROMPT: "0",
    };
    const defaults = [];
    for (const key of ["user.name", "user.email"]) {
      if (configured.get(key) !== null) continue;
      const value = setting(key, hostEnvironment, true);
      if (value !== null) defaults.push("-c", `${key}=${value}`);
    }
    // Git applies command-line user defaults after repository role settings. Restore explicit
    // author/committer fields after those defaults so adding a missing field cannot replace them.
    for (const key of identityKeys.slice(2)) {
      const value = configured.get(key);
      if (value !== null) defaults.push("-c", `${key}=${value}`);
    }
    const resolved = nativeIdentity(defaults);
    if (!resolved) throw new Error();
    return Object.freeze(resolved);
  } catch {
    // Git diagnostics may contain configuration contents; expose only actionable static guidance.
    throw new Error(identityHelp);
  }
}
