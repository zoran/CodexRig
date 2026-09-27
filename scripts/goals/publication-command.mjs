/** Owns bounded and cancellable execution of publication gates; diagnostics use the terminal owner. */
import { spawn } from "node:child_process";
import process from "node:process";
import { sanitizeMultilineForTerminal } from "../terminal/terminal-output.mjs";

const maximumOutputBytes = 64 * 1024 * 1024;

/** Captures one owned gate; success stays quiet, failures retain useful sanitized diagnostics. */
export async function runPublicationCommand({
  command,
  args,
  root,
  env,
  output,
  timeout = 60 * 60_000,
}) {
  const result = await new Promise((resolve, reject) => {
    const grouped = process.platform !== "win32";
    const child = spawn(command, args, {
      cwd: root,
      env,
      detached: grouped,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let failure;
    let stopping = false;
    let forceTimer;
    const cancel = (signal) => {
      if (!child.pid) return;
      try {
        // This group was created by this exact spawn; never discover or signal other processes.
        if (grouped) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if (error.code !== "ESRCH")
          failure ??= "The owned publication command could not be stopped.";
      }
    };
    const stop = (reason) => {
      failure ??= reason;
      if (stopping) return;
      stopping = true;
      cancel("SIGTERM");
      forceTimer = setTimeout(() => cancel("SIGKILL"), 2000);
    };
    const capture = (stream, chunk) => {
      bytes += chunk.length;
      if (bytes > maximumOutputBytes) stop("Command output exceeded the publication limit.");
      else {
        chunks.push(chunk);
        stream.push(chunk);
      }
    };
    child.stdout.on("data", (chunk) => capture(stdout, chunk));
    child.stderr.on("data", (chunk) => capture(stderr, chunk));
    const handlers = new Map();
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      const handler = () => stop(`Publication interrupted by ${signal}.`);
      handlers.set(signal, handler);
      process.on(signal, handler);
    }
    const timer = setTimeout(() => stop("Publication command timed out."), timeout);
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      for (const [signal, handler] of handlers) process.off(signal, handler);
    };
    child.once("error", (error) => {
      cleanup();
      reject(new Error(`Publication command could not start: ${error.code ?? "unknown error"}.`));
    });
    child.once("close", (status, signal) => {
      cleanup();
      resolve({
        status,
        signal,
        failure,
        text: Buffer.concat(chunks).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
  // Sanitize the complete bounded diagnostic, so split writes cannot hide a credential marker.
  const text = sanitizeMultilineForTerminal(result.text, root);
  output?.detail(text);
  if (result.failure || result.signal || result.status !== 0) {
    // Parallel checks can print successful stdout after the failed check's stderr. Preserve the
    // final stderr summary independently; one merged tail can show only successful Terraform.
    // Each complete stream is sanitized before slicing, including credentials split across writes.
    // A credential can also span streams. Independent tails must not restore text removed from
    // the sanitized chronological capture; ambiguous interleaved fragments stay redacted.
    const tail = (value, lines, characters) =>
      sanitizeMultilineForTerminal(value, root)
        .trim()
        .split("\n")
        .slice(-lines)
        .join("\n")
        .slice(-characters)
        .split("\n")
        .map((line) => (text.includes(line) ? line : "<redacted-interleaved-output>"))
        .join("\n")
        .slice(-characters);
    const stdout = tail(result.stdout, result.stderr.trim() ? 20 : 55, 3000);
    const stderr = tail(result.stderr, 35, 8000);
    const excerpt = [
      stdout ? `Command output (last lines):\n${stdout}` : "",
      stderr ? `Command errors (last lines):\n${stderr}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    throw new Error(
      `${result.failure ?? `Command failed (${result.signal ?? result.status}).`}${excerpt ? `\n${excerpt}` : ""}`,
    );
  }
}
