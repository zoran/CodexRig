/** Owns bounded synchronous child-process I/O and terminal-result normalization for tooling. */
import { spawnSync as nodeSpawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const defaultMaximumOutputBytes = 1024 * 1024;
const capturedStreamNames = Object.freeze(["stdout", "stderr"]);

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
    const entries = [...value];
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

/**
 * Runs one synchronous child with private file-backed stdin/stdout/stderr whenever the caller asks
 * for pipes. This supplies deterministic stdin EOF and preserves descendant output in managed
 * sandboxes. Captured files are private, size-bounded, identity-stable, and removed before return.
 * The returned shape matches spawnSync and normalizes only an exact proven terminal sandbox EPERM.
 */
export function spawnSyncWithBoundedIo(command, args = [], options = {}) {
  if (!validCommand(command) || !validArguments(args)) {
    throw new Error("Synchronous process command and arguments are invalid.");
  }
  if (options.shell) throw new Error("Bounded synchronous processes do not permit a shell option.");
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
    result = nodeSpawnSync(command, args, invocationOptions);

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
        (terminal && matchingManagedSandboxCompletionError(result.error, command, args)
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
