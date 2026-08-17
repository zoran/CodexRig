/** Owns verification executor behavior for the repository verification boundary. */
import process from "node:process";
import { spawnRuntimeLifecycleCommand } from "../repository/runtime-lifecycle-process.mjs";
import { currentRuntimeLifecycleCapability } from "../repository/runtime-session-lease.mjs";
import {
  formatContextError,
  sanitizeCommandForTerminal,
  sanitizeForTerminal,
  sanitizeMultilineForTerminal,
} from "../terminal/terminal-output.mjs";
import { root } from "./adaptive-state.mjs";
import {
  resolveVerificationExecutable,
  verificationChildEnvironment,
} from "./verification-runtime-identity.mjs";

const executionPhaseOrder = ["preflight", "broad", "workspace-build", "workspace-test", "delivery"];
const activeVerificationSupervisors = new Set();

export { verificationChildEnvironment };

function printableCommand(command) {
  const executable = command.executable === process.execPath ? "node" : command.executable;
  return { args: command.args, executable };
}

function safePrintableCommand(command) {
  const printable = printableCommand(command);
  return sanitizeCommandForTerminal(printable.executable, printable.args, root);
}

function safeField(value) {
  return sanitizeMultilineForTerminal(sanitizeForTerminal(value), root);
}

function commandsByExecutionPhase(plan) {
  const phases = new Map(executionPhaseOrder.map((phase) => [phase, []]));
  for (const command of [...plan.readOnlyCommands, ...plan.workspaceCommands]) {
    const commands = phases.get(command.phase);
    if (!commands) {
      throw new Error(
        `Verification command ${command.key} uses unsupported phase ${JSON.stringify(command.phase)}.`,
      );
    }
    commands.push(command);
  }
  return phases;
}

export function printPlan(plan) {
  const deliveryEnvironment = plan.options.targetEnvironment ?? "dev";
  const deliveryBinding = plan.deliveryBinding ?? null;
  console.log(`Adaptive verification entry point: ${safeField(plan.options.mode)}`);
  console.log(`Delivery target: ${safeField(deliveryEnvironment)}`);
  console.log(`Artifact identity: ${safeField(deliveryBinding?.artifactDigest || "not bound")}`);
  console.log(
    `Target configuration: ${safeField(deliveryBinding?.configurationDigest || "not bound")}`,
  );
  console.log(`Admission mode: ${safeField(plan.admission.mode)}`);
  console.log(`Verification scope: ${safeField(plan.verificationScope)}`);
  console.log(`Admission reason: ${safeField(plan.admission.reason)}`);
  console.log(
    `Successful basis can advance: ${plan.admission.canAdvanceSuccessfulBasis ? "yes" : "no"}`,
  );

  const phases = commandsByExecutionPhase(plan);
  const commands = executionPhaseOrder.flatMap((phase) => phases.get(phase));
  if (!plan.options.printPlan) {
    console.log(
      `Selected ${commands.length} check(s) for ${plan.classifiedPaths.length} changed path(s).`,
    );
    return;
  }

  console.log(
    `Changed-path source: ${plan.options.simulatedPaths.length > 0 ? "simulated --path input" : plan.gitAvailable ? "Git worktree" : "no Git worktree"}\n`,
  );

  if (plan.classifiedPaths.length === 0) {
    console.log("Changed paths: none");
  } else {
    console.log("Changed paths:");
    for (const entry of plan.classifiedPaths) {
      console.log(`- ${safeField(entry.path)}: ${entry.categories.map(safeField).join(", ")}`);
    }
  }
  console.log(
    `Full-relevant paths: ${plan.admission.fullRelevantPaths.map(safeField).join(", ") || "none"}`,
  );
  console.log(`Unknown paths: ${plan.admission.unknownPaths.map(safeField).join(", ") || "none"}`);
  console.log(
    `Uncovered full-relevant paths: ${plan.admission.uncoveredFullRelevantPaths.map(safeField).join(", ") || "none"}`,
  );
  console.log(
    `Covered named broad risks: ${
      (plan.admission.coveredBroadRisks ?? [])
        .map((risk) => `${safeField(risk.riskId)}@${safeField(risk.path)}`)
        .join(", ") || "none"
    }`,
  );
  console.log(
    `Uncovered named broad risks: ${
      (plan.admission.uncoveredBroadRisks ?? [])
        .map((risk) => `${safeField(risk.riskId)}@${safeField(risk.path)}`)
        .join(", ") || "none"
    }`,
  );
  if (plan.admission.focusedCommandOwners.length === 0) {
    console.log("Focused command owners: none");
  } else {
    console.log("Focused command owners:");
    for (const owner of plan.admission.focusedCommandOwners) {
      console.log(`- ${safeField(owner.path)}: ${owner.ownerKeys.map(safeField).join(", ")}`);
    }
  }

  if (commands.length === 0) {
    console.log(
      "\nSelected checks: none; paths are local/generated or no relevant current surface exists.",
    );
    return;
  }

  console.log("\nSelected checks:");
  for (const command of commands) {
    console.log(`- Would run [${command.phase}]: ${safePrintableCommand(command)}`);
    console.log(`  Reason: ${safeField(command.reason)}`);
  }
}

function outputCaptureLimit() {
  const configured = Number.parseInt(
    verificationChildEnvironment().VERIFY_MAX_CAPTURE_BYTES ?? "2097152",
    10,
  );
  return Number.isInteger(configured) && configured >= 1024
    ? Math.min(configured, 64 * 1024 * 1024)
    : 2 * 1024 * 1024;
}

function boundedOutputCollector() {
  const chunks = [];
  const limit = outputCaptureLimit();
  let capturedBytes = 0;
  let truncated = false;
  return {
    add(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = limit - capturedBytes;
      if (remaining > 0) {
        const captured = buffer.length <= remaining ? buffer : buffer.subarray(0, remaining);
        chunks.push(captured);
        capturedBytes += captured.length;
      }
      if (buffer.length > remaining) truncated = true;
    },
    buffer() {
      const captured = Buffer.concat(chunks);
      if (!truncated) return captured;
      const lastCompleteLine = captured.lastIndexOf(10);
      const safePrefix =
        lastCompleteLine === -1 ? Buffer.alloc(0) : captured.subarray(0, lastCompleteLine + 1);
      return Buffer.concat([
        safePrefix,
        Buffer.from(
          `[verification output truncated after ${limit} bytes; the incomplete final line was redacted]\n`,
        ),
      ]);
    },
  };
}

export async function runHeldVerificationCommand({ command, commandArgs, repositoryRoot }) {
  const environment = verificationChildEnvironment();
  const resolvedCommand = resolveVerificationExecutable(command, {
    cwd: repositoryRoot,
    environment,
  });
  const lifecycleCapability = currentRuntimeLifecycleCapability({
    root: repositoryRoot,
    operation: "verification",
  });
  if (!lifecycleCapability) {
    throw new Error("Held verification command requires the repository verification capability.");
  }
  return await withVerificationSignalForwarding(
    () =>
      new Promise((resolve, reject) => {
        const child = spawnRuntimeLifecycleCommand({
          args: commandArgs,
          command: resolvedCommand,
          lifecycleCapability,
          options: {
            cwd: repositoryRoot,
            env: environment,
            stdio: ["inherit", "inherit", "inherit"],
          },
          repositoryRoot,
          role: "verification-supervisor",
        });
        activeVerificationSupervisors.add(child);
        child.once("error", (error) => {
          activeVerificationSupervisors.delete(child);
          reject(error);
        });
        child.once("close", (status) => {
          activeVerificationSupervisors.delete(child);
          resolve(status ?? 1);
        });
      }),
  );
}

async function withVerificationSignalForwarding(action) {
  let handledSignal = null;
  const handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => {
      if (handledSignal) return;
      handledSignal = signal;
      for (const child of activeVerificationSupervisors) child.kill(signal);
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  try {
    const result = await action();
    if (handledSignal) throw new Error(`Verification interrupted by ${handledSignal}.`);
    return result;
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}

function verificationLifecycleCapability(repositoryRoot) {
  const lifecycleCapability = currentRuntimeLifecycleCapability({
    root: repositoryRoot,
    operation: "verification",
  });
  if (!lifecycleCapability) {
    throw new Error("Verification commands require the repository verification capability.");
  }
  return lifecycleCapability;
}

function runUnsupervisedCommand(command, repositoryRoot) {
  return new Promise((resolve) => {
    const child = spawnRuntimeLifecycleCommand({
      args: command.args,
      command: command.executable,
      lifecycleCapability: verificationLifecycleCapability(repositoryRoot),
      options: {
        cwd: repositoryRoot,
        env: verificationChildEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      },
      repositoryRoot,
      role: "verification-supervisor",
    });
    activeVerificationSupervisors.add(child);
    const stdout = boundedOutputCollector();
    const stderr = boundedOutputCollector();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      activeVerificationSupervisors.delete(child);
      resolve({
        ...result,
        command,
        stderr: stderr.buffer(),
        stdout: stdout.buffer(),
      });
    };
    child.stdout?.on("data", (chunk) => stdout.add(chunk));
    child.stderr?.on("data", (chunk) => stderr.add(chunk));
    child.on("error", (error) => finish({ status: null, error }));
    child.on("close", (status, signal) => finish({ status, signal, error: null }));
  });
}

function runCommand(command, repositoryRoot) {
  return runUnsupervisedCommand(command, repositoryRoot);
}

function writeBuffer(stream, buffer) {
  if (!buffer || buffer.length === 0) return;
  const sanitized = sanitizeMultilineForTerminal(buffer.toString("utf8"), root);
  if (!sanitized) return;
  stream.write(sanitized);
  if (!sanitized.endsWith("\n")) stream.write("\n");
}

function printResult(result) {
  console.log(`\n[${safeField(result.command.label)}] ${safePrintableCommand(result.command)}`);
  writeBuffer(process.stdout, result.stdout);
  writeBuffer(process.stderr, result.stderr);
  if (result.error) console.error(formatContextError(result.error, root));
  if (result.signal) console.error(`Terminated by signal ${safeField(result.signal)}.`);
}

function parallelLimit() {
  const configured = Number.parseInt(verificationChildEnvironment().VERIFY_MAX_PARALLEL ?? "4", 10);
  return Number.isInteger(configured) && configured > 0 ? Math.min(configured, 8) : 4;
}

function artifactOwnerSet(command) {
  return new Set(command.artifactOwners ?? []);
}

function artifactShards(commands) {
  const parents = commands.map((_, index) => index);
  const owners = commands.map(artifactOwnerSet);
  const find = (index) => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  for (let left = 0; left < commands.length; left += 1) {
    if (owners[left].size === 0) continue;
    for (let right = left + 1; right < commands.length; right += 1) {
      if ([...owners[left]].some((owner) => owners[right].has(owner))) union(left, right);
    }
  }
  const groups = new Map();
  for (let index = 0; index < commands.length; index += 1) {
    const group = groups.get(find(index)) ?? [];
    group.push(index);
    groups.set(find(index), group);
  }
  return [...groups.values()].sort((left, right) => left[0] - right[0]);
}

async function runArtifactSafeCommands(commands, failurePrefix, repositoryRoot) {
  if (commands.length === 0) return [];
  const results = new Array(commands.length);
  const shards = artifactShards(commands);
  let nextShard = 0;
  let phaseFailed = false;
  const worker = async () => {
    while (!phaseFailed && nextShard < shards.length) {
      const shard = shards[nextShard++];
      for (const index of shard) {
        if (phaseFailed) break;
        results[index] = await runCommand(commands[index], repositoryRoot);
        if (results[index].error || results[index].status !== 0) {
          phaseFailed = true;
          break;
        }
      }
    }
  };
  const workers = Array.from({ length: Math.min(parallelLimit(), shards.length) }, () => worker());
  await Promise.all(workers);

  const failures = [];
  for (const result of results) {
    if (!result) continue;
    printResult(result);
    if (result.error || result.status !== 0) failures.push(safeField(result.command.label));
  }
  if (failures.length > 0) {
    throw new Error(`${failurePrefix}: ${failures.join(", ")}`);
  }
  return results.map((result) => result.command.key);
}

export async function runPlan(plan, { repositoryRoot = root } = {}) {
  printPlan(plan);
  if (plan.options.printPlan) return Object.freeze({ successfulCommandKeys: Object.freeze([]) });

  const phases = commandsByExecutionPhase(plan);
  const successfulCommandKeys = await withVerificationSignalForwarding(async () => {
    const successful = [];
    successful.push(
      ...(await runArtifactSafeCommands(
        phases.get("preflight"),
        "Preflight verification checks failed",
        repositoryRoot,
      )),
    );
    successful.push(
      ...(await runArtifactSafeCommands(
        phases.get("broad"),
        "Broad regression checks failed",
        repositoryRoot,
      )),
    );
    successful.push(
      ...(await runArtifactSafeCommands(
        phases.get("workspace-build"),
        "Workspace build failed",
        repositoryRoot,
      )),
    );
    successful.push(
      ...(await runArtifactSafeCommands(
        phases.get("workspace-test"),
        "Workspace test failed",
        repositoryRoot,
      )),
    );
    successful.push(
      ...(await runArtifactSafeCommands(
        phases.get("delivery"),
        "Target delivery verification failed",
        repositoryRoot,
      )),
    );
    return successful;
  });
  console.log("\nDeterministic verification passed.");
  return Object.freeze({
    successfulCommandKeys: Object.freeze([...successfulCommandKeys].sort()),
  });
}
