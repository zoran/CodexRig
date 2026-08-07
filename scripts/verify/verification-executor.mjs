import { spawn } from "node:child_process";
import process from "node:process";
import { root } from "./adaptive-state.mjs";
import {
  resolveVerificationExecutable,
  verificationChildEnvironment,
} from "./verification-runtime-identity.mjs";

const executionPhaseOrder = ["preflight", "broad", "workspace-build", "workspace-test"];

export { verificationChildEnvironment };

function printableCommand(command) {
  const executable = command.executable === process.execPath ? "node" : command.executable;
  return [executable, ...command.args].join(" ");
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
  console.log(`Adaptive verification entry point: ${plan.options.mode}`);
  console.log(`Admission mode: ${plan.admission.mode}`);
  console.log(`Verification scope: ${plan.verificationScope}`);
  console.log(`Admission reason: ${plan.admission.reason}`);
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
      console.log(`- ${entry.path}: ${entry.categories.join(", ")}`);
    }
  }
  console.log(`Full-relevant paths: ${plan.admission.fullRelevantPaths.join(", ") || "none"}`);
  console.log(`Unknown paths: ${plan.admission.unknownPaths.join(", ") || "none"}`);
  console.log(
    `Uncovered full-relevant paths: ${plan.admission.uncoveredFullRelevantPaths.join(", ") || "none"}`,
  );
  console.log(
    `Covered named broad risks: ${
      (plan.admission.coveredBroadRisks ?? [])
        .map((risk) => `${risk.riskId}@${risk.path}`)
        .join(", ") || "none"
    }`,
  );
  console.log(
    `Uncovered named broad risks: ${
      (plan.admission.uncoveredBroadRisks ?? [])
        .map((risk) => `${risk.riskId}@${risk.path}`)
        .join(", ") || "none"
    }`,
  );
  if (plan.admission.focusedCommandOwners.length === 0) {
    console.log("Focused command owners: none");
  } else {
    console.log("Focused command owners:");
    for (const owner of plan.admission.focusedCommandOwners) {
      console.log(`- ${owner.path}: ${owner.ownerKeys.join(", ")}`);
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
    console.log(`- Would run [${command.phase}]: ${printableCommand(command)}`);
    console.log(`  Reason: ${command.reason}`);
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
      if (truncated) {
        chunks.push(
          Buffer.from(
            `\n[verification output truncated after ${limit} bytes; run the command directly for full output]\n`,
          ),
        );
      }
      return Buffer.concat(chunks);
    },
  };
}

export async function runHeldVerificationCommand({ command, commandArgs, repositoryRoot }) {
  const environment = verificationChildEnvironment();
  const resolvedCommand = resolveVerificationExecutable(command, {
    cwd: repositoryRoot,
    environment,
  });
  return await new Promise((resolve, reject) => {
    const child = spawn(resolvedCommand, commandArgs, {
      cwd: repositoryRoot,
      env: environment,
      stdio: ["inherit", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("close", (status) => resolve(status ?? 1));
  });
}

function runUnsupervisedCommand(command) {
  return new Promise((resolve) => {
    const child = spawn(command.executable, command.args, {
      cwd: root,
      env: verificationChildEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = boundedOutputCollector();
    const stderr = boundedOutputCollector();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
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

function runCommand(command) {
  return runUnsupervisedCommand(command);
}

function writeBuffer(stream, buffer) {
  if (!buffer || buffer.length === 0) return;
  stream.write(buffer);
  if (buffer.at(-1) !== 10) stream.write("\n");
}

function printResult(result) {
  console.log(`\n[${result.command.label}] ${printableCommand(result.command)}`);
  writeBuffer(process.stdout, result.stdout);
  writeBuffer(process.stderr, result.stderr);
  if (result.error) console.error(result.error.message);
  if (result.signal) console.error(`Terminated by signal ${result.signal}.`);
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

async function runArtifactSafeCommands(commands, failurePrefix) {
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
        results[index] = await runCommand(commands[index]);
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
    if (result.error || result.status !== 0) failures.push(result.command.label);
  }
  if (failures.length > 0) {
    throw new Error(`${failurePrefix}: ${failures.join(", ")}`);
  }
  return results.map((result) => result.command.key);
}

export async function runPlan(plan) {
  printPlan(plan);
  if (plan.options.printPlan) return Object.freeze({ successfulCommandKeys: Object.freeze([]) });

  const phases = commandsByExecutionPhase(plan);
  const successfulCommandKeys = [];
  successfulCommandKeys.push(
    ...(await runArtifactSafeCommands(
      phases.get("preflight"),
      "Preflight verification checks failed",
    )),
  );
  successfulCommandKeys.push(
    ...(await runArtifactSafeCommands(phases.get("broad"), "Broad regression checks failed")),
  );
  successfulCommandKeys.push(
    ...(await runArtifactSafeCommands(phases.get("workspace-build"), "Workspace build failed")),
  );
  successfulCommandKeys.push(
    ...(await runArtifactSafeCommands(phases.get("workspace-test"), "Workspace test failed")),
  );
  console.log("\nDeterministic verification passed.");
  return Object.freeze({
    successfulCommandKeys: Object.freeze([...successfulCommandKeys].sort()),
  });
}
