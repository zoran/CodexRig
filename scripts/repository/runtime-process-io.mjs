/** Owns bounded synchronous child-process I/O and terminal-result normalization for tooling. */
import { spawnSync as nodeSpawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ownedProcessCancellationModule } from "./runtime-process-cancellation.mjs";

const defaultMaximumOutputBytes = 1024 * 1024;
const capturedStreamNames = Object.freeze(["stdout", "stderr"]);
const maximumCompletionBytes = 4096;

// Serialized from already-loaded code: an admitted session never loads a repository script to
// capture a later command. Only this pump receives the private output and completion descriptors.
async function boundedIoSupervisor(jobDescriptor, cancellationModule) {
  const { spawn } = await import("node:child_process");
  const { closeSync, lstatSync, readFileSync, rmSync, writeSync } = await import("node:fs");
  const { Socket } = await import("node:net");
  const { createOwnedProcessCancellation } = await import(cancellationModule);
  const job = JSON.parse(readFileSync(jobDescriptor, "utf8"));
  closeSync(jobDescriptor);
  let child;
  let failure = null;
  let cancellation;
  let cancelled;
  let deadline;
  let stopping = false;
  let orphaned = false;
  let completion;
  const handlers = new Map();
  const stop = (error, signal = job.killSignal) => {
    failure ??= error;
    if (stopping) return;
    stopping = true;
    // The existing lifecycle supervisor gets its five-second graceful shutdown before this
    // outer I/O owner escalates. Direct-child closure cannot retire descendant cancellation.
    cancelled = cancellation
      ?.cancel(signal)
      .catch((error) => {
        failure = error;
      })
      .finally(() => {
        for (const index of job.captured) child?.stdio[index]?.destroy();
      });
  };
  const parent = new Socket({ fd: job.livenessDescriptor, readable: true, writable: false });
  const parentLost = () => {
    orphaned = true;
    stop(Object.assign(new Error("Synchronous process caller exited."), { code: "EPIPE" }));
  };
  parent.once("end", parentLost);
  parent.once("error", parentLost);
  parent.resume();
  let status = null;
  let signal = null;
  // Arm cancellation before creating a target; no startup window may strand an owned process.
  for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () =>
      stop(
        Object.assign(new Error("Synchronous process capture was interrupted."), {
          code: "EINTR",
        }),
        name,
      );
    handlers.set(name, handler);
    process.on(name, handler);
  }
  try {
    child = spawn(job.command, job.args, {
      ...job.options,
      detached: process.platform !== "win32",
      stdio: Array.from({ length: job.stdioCount }, (_, index) =>
        job.captured.includes(index) ? "pipe" : index,
      ),
    });
    cancellation = createOwnedProcessCancellation(child, { graceMilliseconds: 6000 });
    completion = new Promise((resolve) => {
      child.once("error", (error) => {
        failure ??= error;
      });
      child.once("close", (code, childSignal) => resolve({ code, childSignal }));
    });
    for (const index of job.captured) {
      let written = 0;
      const stream = child.stdio[index];
      stream.on("error", (error) => stop(error));
      stream.on("data", (chunk) => {
        const remaining = job.maximumOutputBytes - written;
        const length = Math.min(chunk.length, remaining);
        try {
          let offset = 0;
          while (offset < length) {
            const count = writeSync(index, chunk, offset, length - offset);
            if (count === 0) throw new Error("Synchronous process output write made no progress.");
            offset += count;
            written += count;
          }
          if (chunk.length > remaining) {
            stop(
              Object.assign(
                new Error(
                  `Synchronous process ${index === 1 ? "stdout" : "stderr"} exceeded its bounded output contract.`,
                ),
                { code: "CODEXRIG_BOUNDED_PROCESS_IO" },
              ),
            );
          }
        } catch (error) {
          stop(error);
        }
      });
    }
    if (job.timeout > 0) {
      deadline = setTimeout(
        () =>
          stop(Object.assign(new Error("Synchronous process timed out."), { code: "ETIMEDOUT" })),
        job.timeout,
      );
    }
    const completed = await completion;
    status = child.pid ? completed.code : null;
    signal = completed.childSignal;
  } catch (error) {
    stop(error);
    if (completion) {
      const completed = await completion;
      status = child.pid ? completed.code : null;
      signal = completed.childSignal;
    }
  } finally {
    clearTimeout(deadline);
    await cancelled;
    for (const [name, handler] of handlers) process.off(name, handler);
    parent.destroy();
  }
  const result = {
    nonce: job.nonce,
    pid: child?.pid ?? 0,
    status,
    signal,
    error: failure
      ? {
          code: typeof failure.code === "string" ? failure.code : "CODEXRIG_BOUNDED_PROCESS_IO",
          errno: typeof failure.errno === "number" ? failure.errno : null,
          message: String(failure.message).slice(0, 1024),
        }
      : null,
  };
  try {
    writeSync(job.completionDescriptor, JSON.stringify(result));
  } finally {
    closeSync(job.completionDescriptor);
    if (orphaned) {
      // The caller cannot run its finally block. Remove only its exact private directory, still
      // bound to the identity recorded before this child was started.
      const current = lstatSync(job.directory.path);
      if (
        current.isDirectory() &&
        current.dev === job.directory.dev &&
        current.ino === job.directory.ino
      ) {
        rmSync(job.directory.path, { force: true, recursive: true });
      }
    }
  }
}

function validCommand(value) {
  return typeof value === "string" && value.length > 0 && !/[\0\r\n]/u.test(value);
}

function validArguments(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function exactArguments(left, right) {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

function matchingManagedSandboxCompletionError(error, command, args) {
  return (
    error?.code === "EPERM" &&
    error?.path === command &&
    error?.syscall === `spawnSync ${command}` &&
    exactArguments(error?.spawnargs, args)
  );
}

function outputByteLength(value) {
  return Buffer.isBuffer(value) ? value.length : Buffer.byteLength(value, "utf8");
}

/**
 * Returns true only for a terminal synchronous result. Managed process sandboxes may attach one
 * contradictory EPERM marker after an exact child already returned its status and captured output;
 * only that command- and argument-bound marker is accepted. Spawn failures, timeouts, signals,
 * malformed output, changed arguments, and oversized output remain failures.
 */
export function isTerminalSynchronousProcessResult(
  result,
  {
    args,
    capturedStreams = capturedStreamNames,
    command,
    encoding = "utf8",
    maximumOutputBytes,
  } = {},
) {
  if (
    !validCommand(command) ||
    !validArguments(args) ||
    !Array.isArray(capturedStreams) ||
    capturedStreams.some((name) => !capturedStreamNames.includes(name)) ||
    new Set(capturedStreams).size !== capturedStreams.length ||
    !Number.isSafeInteger(result?.pid) ||
    result.pid <= 0 ||
    !Number.isInteger(result.status) ||
    result.status < 0 ||
    result.signal !== null ||
    (result.error && !matchingManagedSandboxCompletionError(result.error, command, args))
  ) {
    return false;
  }
  if (
    maximumOutputBytes !== undefined &&
    (!Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes < 0)
  ) {
    return false;
  }
  const expectsBuffer = encoding === null || encoding === "buffer";
  if (!expectsBuffer && typeof encoding !== "string") return false;
  return capturedStreams.every((name) => {
    const value = result[name];
    if (expectsBuffer ? !Buffer.isBuffer(value) : typeof value !== "string") return false;
    return maximumOutputBytes === undefined || outputByteLength(value) <= maximumOutputBytes;
  });
}

function normalizedStdio(value) {
  if (Array.isArray(value)) {
    const entries = Array.from(value, (entry, index) => entry ?? (index < 3 ? "pipe" : "ignore"));
    while (entries.length < 3) entries.push("pipe");
    return entries;
  }
  const entry = value ?? "pipe";
  if (!["ignore", "inherit", "pipe"].includes(entry)) {
    throw new Error("Synchronous process stdio mode is unsupported.");
  }
  return [entry, entry, entry];
}

function inputBuffer(input, encoding) {
  if (input === undefined || input === null) return Buffer.alloc(0);
  if (typeof input === "string") {
    return Buffer.from(input, encoding === null || encoding === "buffer" ? "utf8" : encoding);
  }
  if (Buffer.isBuffer(input)) return input;
  if (ArrayBuffer.isView(input)) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new Error("Synchronous process input must be text or bytes.");
}

function privateFile(directory, name, flags) {
  return openSync(
    path.join(directory, name),
    flags | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
}

function stableOutputBuffer(descriptor, maximumBytes, label) {
  const before = fstatSync(descriptor, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maximumBytes)) {
    throw new Error(`${label} exceeded its bounded output contract.`);
  }
  const buffer = Buffer.alloc(Number(before.size));
  let offset = 0;
  while (offset < buffer.length) {
    const count = readSync(descriptor, buffer, offset, buffer.length - offset, offset);
    if (count === 0) throw new Error(`${label} ended before its recorded output size.`);
    offset += count;
  }
  const after = fstatSync(descriptor, { bigint: true });
  if (
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    after.size !== before.size ||
    after.mtimeNs !== before.mtimeNs ||
    after.ctimeNs !== before.ctimeNs ||
    after.nlink !== before.nlink
  ) {
    throw new Error(`${label} changed while its output was read.`);
  }
  return buffer;
}

function decodedOutput(buffer, encoding) {
  return encoding === null || encoding === "buffer" ? buffer : buffer.toString(encoding);
}

function boundedIoError(error) {
  const bounded = new Error(error.message);
  bounded.code = "CODEXRIG_BOUNDED_PROCESS_IO";
  return bounded;
}

function capturedProcess(
  command,
  args,
  options,
  stdio,
  directory,
  descriptors,
  maximumOutputBytes,
) {
  const completionDescriptor = privateFile(directory, "completion", constants.O_RDWR);
  descriptors.push(completionDescriptor);
  const jobIndex = stdio.length;
  const completionIndex = jobIndex + 1;
  const livenessIndex = completionIndex + 1;
  const nonce = randomUUID();
  const directoryIdentity = lstatSync(directory);
  const targetOptions = { ...options, env: options.env ?? process.env };
  if (options.cwd instanceof URL) targetOptions.cwd = fileURLToPath(options.cwd);
  else if (Buffer.isBuffer(options.cwd)) targetOptions.cwd = options.cwd.toString();
  for (const name of [
    "input",
    "encoding",
    "maxBuffer",
    "stdio",
    "timeout",
    "killSignal",
    "signal",
  ]) {
    delete targetOptions[name];
  }
  const writer = privateFile(directory, "job", constants.O_WRONLY);
  try {
    writeFileSync(
      writer,
      JSON.stringify({
        command,
        args,
        nonce,
        options: targetOptions,
        captured: [1, 2].filter((index) => normalizedStdio(options.stdio)[index] === "pipe"),
        stdioCount: stdio.length,
        completionDescriptor: completionIndex,
        livenessDescriptor: livenessIndex,
        maximumOutputBytes,
        timeout: options.timeout ?? 0,
        killSignal: options.killSignal ?? "SIGTERM",
        directory: { path: directory, dev: directoryIdentity.dev, ino: directoryIdentity.ino },
      }),
    );
  } finally {
    closeSync(writer);
  }
  const jobDescriptor = openSync(
    path.join(directory, "job"),
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  descriptors.push(jobDescriptor);
  const supervisorArguments = [
    "--input-type=module",
    "--eval",
    `(${boundedIoSupervisor.toString()})(${jobIndex}, ${JSON.stringify(ownedProcessCancellationModule)}).catch(() => { process.exitCode = 1; });`,
  ];
  const environment = { ...process.env };
  // Target preloads belong to the target, never to the trusted descriptor-owning pump.
  for (const name of ["NODE_OPTIONS", "NODE_PATH", "NODE_V8_COVERAGE"]) delete environment[name];
  const supervisor = nodeSpawnSync(process.execPath, supervisorArguments, {
    env: environment,
    stdio: [...stdio, jobDescriptor, completionDescriptor, "pipe"],
    windowsHide: true,
    maxBuffer: maximumOutputBytes,
  });
  const output = supervisor.output?.slice(0, stdio.length) ?? Array(stdio.length).fill(null);
  try {
    if (
      supervisor.status !== 0 ||
      !isTerminalSynchronousProcessResult(supervisor, {
        command: process.execPath,
        args: supervisorArguments,
        capturedStreams: [],
        encoding: null,
      })
    )
      throw new Error("Synchronous process capture did not complete its private protocol.");
    const completed = JSON.parse(
      stableOutputBuffer(
        completionDescriptor,
        maximumCompletionBytes,
        "Synchronous process completion",
      ).toString("utf8"),
    );
    if (
      completed.nonce !== nonce ||
      !Number.isSafeInteger(completed.pid) ||
      completed.pid < 0 ||
      !(
        completed.status === null ||
        (Number.isInteger(completed.status) && completed.status >= 0)
      ) ||
      !(completed.signal === null || Object.hasOwn(os.constants.signals, completed.signal)) ||
      (completed.signal !== null && completed.status !== null) ||
      !(
        completed.error === null ||
        (typeof completed.error?.code === "string" &&
          typeof completed.error.message === "string" &&
          (completed.error.errno === null || Number.isInteger(completed.error.errno)))
      ) ||
      (completed.error === null &&
        (completed.pid === 0 || (completed.status === null && completed.signal === null)))
    ) {
      throw new Error("Synchronous process capture returned invalid terminal evidence.");
    }
    const error =
      completed.error === null
        ? undefined
        : Object.assign(new Error(completed.error.message), {
            // An async target spawn failure has no PID. A later EPERM belongs to capture, never
            // to the outer spawnSync sandbox marker accepted above or by downstream Git owners.
            code:
              completed.error.code === "EPERM" && completed.pid > 0
                ? "CODEXRIG_BOUNDED_PROCESS_IO"
                : completed.error.code,
            ...(completed.error.errno === null ? {} : { errno: completed.error.errno }),
            path: command,
            spawnargs: args,
            syscall: `spawnSync ${command}`,
          });
    return {
      pid: completed.pid,
      status: completed.status,
      signal: completed.signal,
      error,
      output,
      stdout: output[1],
      stderr: output[2],
    };
  } catch (error) {
    return {
      pid: 0,
      status: null,
      signal: null,
      error: boundedIoError(error),
      output,
      stdout: output[1],
      stderr: output[2],
    };
  }
}

/**
 * Runs one synchronous child with private file-backed stdin and a pipe-to-file output pump. This
 * supplies deterministic stdin EOF and preserves descendant output in managed sandboxes. The pump
 * caps each captured file while writing, terminates its owned process group on failure, and reports
 * the target's terminal result through a separate private descriptor. Files are removed before return.
 * The returned shape matches spawnSync and normalizes only an exact proven terminal sandbox EPERM.
 */
export function spawnSyncWithBoundedIo(command, args = [], options = {}) {
  if (!validCommand(command) || !validArguments(args)) {
    throw new Error("Synchronous process command and arguments are invalid.");
  }
  if (options.shell) throw new Error("Bounded synchronous processes do not permit a shell option.");
  if (
    options.timeout !== undefined &&
    (!Number.isSafeInteger(options.timeout) || options.timeout < 0)
  ) {
    throw new Error("Synchronous process timeout must be a nonnegative safe integer.");
  }
  const killSignal = options.killSignal ?? "SIGTERM";
  if (
    !(typeof killSignal === "string"
      ? Object.hasOwn(os.constants.signals, killSignal.toUpperCase())
      : Number.isInteger(killSignal) && Object.values(os.constants.signals).includes(killSignal))
  ) {
    throw new Error("Synchronous process killSignal is invalid.");
  }
  const maximumOutputBytes = options.maxBuffer ?? defaultMaximumOutputBytes;
  if (!Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes < 1) {
    throw new Error("Synchronous process maxBuffer must be a positive safe integer.");
  }
  const encoding = options.encoding === undefined ? null : options.encoding;
  if (
    encoding !== null &&
    encoding !== "buffer" &&
    (typeof encoding !== "string" || !Buffer.isEncoding(encoding))
  ) {
    throw new Error("Synchronous process encoding is invalid.");
  }
  const requestedStdio = normalizedStdio(options.stdio);
  if (options.input !== undefined && requestedStdio[0] !== "pipe") {
    throw new Error("Synchronous process input requires piped stdin.");
  }
  const capturedStreams = [];
  if (requestedStdio[1] === "pipe") capturedStreams.push("stdout");
  if (requestedStdio[2] === "pipe") capturedStreams.push("stderr");

  if (!requestedStdio.slice(0, 3).includes("pipe")) {
    const result = nodeSpawnSync(command, args, options);
    const terminal = isTerminalSynchronousProcessResult(result, {
      args,
      capturedStreams,
      command,
      encoding,
      maximumOutputBytes,
    });
    return {
      ...result,
      error:
        terminal && matchingManagedSandboxCompletionError(result.error, command, args)
          ? undefined
          : result.error,
    };
  }

  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "codexrig-process-io-"));
  chmodSync(temporaryDirectory, 0o700);
  const descriptors = [];
  let result;
  let outputError;
  try {
    const invocationStdio = [...requestedStdio];
    if (requestedStdio[0] === "pipe") {
      const inputWriter = privateFile(temporaryDirectory, "stdin", constants.O_WRONLY);
      try {
        const processInput = inputBuffer(options.input, encoding);
        if (processInput.length > maximumOutputBytes) {
          throw new Error("Synchronous process input exceeded its bounded I/O contract.");
        }
        writeFileSync(inputWriter, processInput);
      } finally {
        closeSync(inputWriter);
      }
      const inputDescriptor = openSync(
        path.join(temporaryDirectory, "stdin"),
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      descriptors.push(inputDescriptor);
      invocationStdio[0] = inputDescriptor;
    }

    const outputDescriptors = new Map();
    for (const [index, name] of [
      [1, "stdout"],
      [2, "stderr"],
    ]) {
      if (requestedStdio[index] !== "pipe") continue;
      const descriptor = privateFile(temporaryDirectory, name, constants.O_RDWR);
      descriptors.push(descriptor);
      outputDescriptors.set(name, descriptor);
      invocationStdio[index] = descriptor;
    }

    const invocationOptions = { ...options, stdio: invocationStdio };
    delete invocationOptions.input;
    result =
      outputDescriptors.size > 0
        ? capturedProcess(
            command,
            args,
            options,
            invocationStdio,
            temporaryDirectory,
            descriptors,
            maximumOutputBytes,
          )
        : nodeSpawnSync(command, args, invocationOptions);

    const captured = new Map();
    for (const [name, descriptor] of outputDescriptors) {
      try {
        captured.set(
          name,
          decodedOutput(
            stableOutputBuffer(descriptor, maximumOutputBytes, `Synchronous process ${name}`),
            encoding,
          ),
        );
      } catch (error) {
        outputError ??= boundedIoError(error);
      }
    }
    const output = Array.isArray(result.output) ? [...result.output] : [null, null, null];
    const stdout = captured.has("stdout") ? captured.get("stdout") : result.stdout;
    const stderr = captured.has("stderr") ? captured.get("stderr") : result.stderr;
    output[1] = stdout;
    output[2] = stderr;
    const candidate = { ...result, output, stderr, stdout };
    const terminal = isTerminalSynchronousProcessResult(candidate, {
      args,
      capturedStreams,
      command,
      encoding,
      maximumOutputBytes,
    });
    return {
      ...candidate,
      error:
        outputError ??
        (outputDescriptors.size === 0 &&
        terminal &&
        matchingManagedSandboxCompletionError(result.error, command, args)
          ? undefined
          : result.error),
    };
  } finally {
    for (const descriptor of descriptors.reverse()) {
      try {
        closeSync(descriptor);
      } catch {
        // The exact private directory cleanup below remains mandatory and authoritative.
      }
    }
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}
