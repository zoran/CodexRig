/** Owns bounded and cancellable execution of publication gates; diagnostics use the terminal owner. */
import { spawn } from "node:child_process";
import process from "node:process";
import { createOwnedProcessCancellation } from "../repository/runtime-process-cancellation.mjs";
import { sanitizeMultilineForTerminal } from "../terminal/terminal-output.mjs";
import { createPublicationVerificationProgress } from "../terminal/publication-output.mjs";

const maximumOutputBytes = 64 * 1024 * 1024;

/** Captures one owned gate; success stays quiet, failures retain useful sanitized diagnostics. */
export async function runPublicationCommand({
  command,
  args,
  root,
  env,
  output,
  verificationProgress = false,
  timeout = 60 * 60_000,
}) {
  const observe = verificationProgress
    ? createPublicationVerificationProgress((message) => output?.task(message))
    : null;
  const result = await new Promise((resolve, reject) => {
    const grouped = process.platform !== "win32";
    const child = spawn(command, args, {
      cwd: root,
      env,
      detached: grouped,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const cancellation = createOwnedProcessCancellation(child, { graceMilliseconds: 2000 });
    const chunks = [];
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let failure;
    let stopping = false;
    let cancelled;
    const stop = (reason) => {
      failure ??= reason;
      if (stopping) return;
      stopping = true;
      cancelled = cancellation.cancel("SIGTERM").catch((error) => {
        failure = `${failure} ${error.message}`;
      });
    };
    const capture = (stream, chunk) => {
      bytes += chunk.length;
      if (bytes > maximumOutputBytes) stop("Command output exceeded the publication limit.");
      else {
        chunks.push(chunk);
        stream.push(chunk);
        observe?.(chunk, stream === stdout ? "stdout" : "stderr");
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
      for (const [signal, handler] of handlers) process.off(signal, handler);
    };
    child.once("error", async (error) => {
      clearTimeout(timer);
      await cancelled;
      cleanup();
      reject(new Error(`Publication command could not start: ${error.code ?? "unknown error"}.`));
    });
    child.once("close", async (status, signal) => {
      clearTimeout(timer);
      // Direct-child closure does not establish that its owned descendants have stopped.
      await cancelled;
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
    const excerpt = (value, lines, characters, preferFailure = false) => {
      const sanitized = sanitizeMultilineForTerminal(value, root).trim().split("\n");
      // Native test failures are written to stdout. Later successful peers must not displace the
      // failed command and its first diagnostic, even when its stack trace exceeds the tail limit.
      const failed = preferFailure
        ? sanitized.findIndex((line) => /^\[verification:failed\] /u.test(line))
        : -1;
      const selected =
        failed < 0
          ? sanitized.slice(-lines).join("\n").slice(-characters)
          : sanitized
              .slice(failed, failed + lines)
              .join("\n")
              .slice(0, characters);
      return selected
        .split("\n")
        .map((line) => (text.includes(line) ? line : "<redacted-interleaved-output>"))
        .join("\n")
        .slice(-characters);
    };
    const stdout = excerpt(
      result.stdout,
      result.stderr.trim() ? 20 : 55,
      3000,
      verificationProgress,
    );
    const stderr = excerpt(result.stderr, 35, 8000);
    const diagnostic = [
      stdout ? `Command output (excerpt):\n${stdout}` : "",
      stderr ? `Command errors (last lines):\n${stderr}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    throw new Error(
      `${result.failure ?? `Command failed (${result.signal ?? result.status}).`}${diagnostic ? `\n${diagnostic}` : ""}`,
    );
  }
}
