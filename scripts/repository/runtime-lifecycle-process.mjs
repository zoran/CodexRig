#!/usr/bin/env node
/** Supervises lifecycle-bound commands, descendants, process groups, and inherited guard handles. */
import { spawn } from "node:child_process";
import os from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  adoptRuntimeLifecycleDelegation,
  cancelRuntimeLifecycleDelegation,
  createRuntimeLifecycleDelegation,
  registerRuntimeLifecycleDescendant,
  releaseRuntimeLifecycleLock,
  runtimeLifecycleGuardDescriptor,
  unregisterRuntimeLifecycleDescendant,
} from "./runtime-session-lease.mjs";
import { runtimeLifecycleOperationPattern } from "./runtime-lifecycle-schema.mjs";
import { spawnSyncWithBoundedIo as spawnSync } from "./runtime-process-io.mjs";

const supervisorTokenVariable = "CODEXRIG_LIFECYCLE_SUPERVISOR_TOKEN";
const supervisorOperationVariable = "CODEXRIG_LIFECYCLE_SUPERVISOR_OPERATION";
const supervisorRoleVariable = "CODEXRIG_LIFECYCLE_SUPERVISOR_ROLE";
const lifecycleRootVariable = "CODEXRIG_LIFECYCLE_ROOT";
const commandTokenVariable = "CODEXRIG_LIFECYCLE_COMMAND_TOKEN";
const commandOperationVariable = "CODEXRIG_LIFECYCLE_COMMAND_OPERATION";
const commandRoleVariable = "CODEXRIG_LIFECYCLE_COMMAND_ROLE";
const guardDescriptorVariable = "CODEXRIG_LIFECYCLE_GUARD_FD";
const witnessTokenVariable = "CODEXRIG_LIFECYCLE_WITNESS_TOKEN";
const delegatedTokenVariable = "CODEXRIG_LIFECYCLE_DELEGATION_TOKEN";
const delegatedOperationVariable = "CODEXRIG_LIFECYCLE_DELEGATION_OPERATION";
const delegatedRoleVariable = "CODEXRIG_LIFECYCLE_DELEGATION_ROLE";
const delegatedRootVariable = "CODEXRIG_LIFECYCLE_DELEGATION_ROOT";
const privateVariables = [
  supervisorTokenVariable,
  supervisorOperationVariable,
  supervisorRoleVariable,
  lifecycleRootVariable,
  commandTokenVariable,
  commandOperationVariable,
  commandRoleVariable,
  guardDescriptorVariable,
  witnessTokenVariable,
];
const publicDelegationVariables = [
  delegatedTokenVariable,
  delegatedOperationVariable,
  delegatedRoleVariable,
  delegatedRootVariable,
];

function withoutLifecycleDelegationEnvironment(environment) {
  const sanitized = { ...environment };
  for (const name of [...privateVariables, ...publicDelegationVariables]) delete sanitized[name];
  return sanitized;
}

function stdioWithGuard(stdio, descriptor) {
  const base = Array.isArray(stdio)
    ? [...stdio]
    : stdio === "inherit"
      ? ["inherit", "inherit", "inherit"]
      : stdio === "ignore"
        ? ["ignore", "ignore", "ignore"]
        : ["pipe", "pipe", "pipe"];
  while (base.length < 3) base.push("pipe");
  const guardIndex = base.length;
  base.push(descriptor);
  return { guardIndex, stdio: base };
}

function createCommandDelegations({
  commandDelegation,
  lifecycleCapability,
  repositoryRoot,
  role,
}) {
  const supervisor = createRuntimeLifecycleDelegation({
    root: repositoryRoot,
    owner: lifecycleCapability,
    operation: lifecycleCapability.operation,
    role,
  });
  let witness;
  try {
    witness = createRuntimeLifecycleDelegation({
      root: repositoryRoot,
      owner: lifecycleCapability,
      operation: lifecycleCapability.operation,
      role: supervisedCommandRole(role),
    });
    const command = commandDelegation
      ? createRuntimeLifecycleDelegation({
          root: repositoryRoot,
          owner: lifecycleCapability,
          operation: commandDelegation.operation,
          role: commandDelegation.role,
        })
      : null;
    return { command, supervisor, witness };
  } catch (error) {
    for (const delegation of [witness, supervisor]) {
      if (!delegation) continue;
      cancelRuntimeLifecycleDelegation({
        root: repositoryRoot,
        owner: lifecycleCapability,
        token: delegation.token,
      });
    }
    throw error;
  }
}

function childEnvironment({
  commandDelegation,
  environment,
  guardIndex,
  repositoryRoot,
  role,
  supervisor,
  witness,
}) {
  return {
    ...withoutLifecycleDelegationEnvironment(environment),
    [lifecycleRootVariable]: repositoryRoot,
    [supervisorTokenVariable]: supervisor.token,
    [supervisorOperationVariable]: supervisor.operation,
    [supervisorRoleVariable]: role,
    [guardDescriptorVariable]: String(guardIndex),
    [witnessTokenVariable]: witness.token,
    ...(commandDelegation
      ? {
          [commandTokenVariable]: commandDelegation.token,
          [commandOperationVariable]: commandDelegation.operation,
          [commandRoleVariable]: commandDelegation.role,
        }
      : {}),
  };
}

function cancelUnusedDelegations(repositoryRoot, lifecycleCapability, delegations) {
  for (const delegation of [delegations.command, delegations.witness, delegations.supervisor]) {
    if (!delegation) continue;
    try {
      cancelRuntimeLifecycleDelegation({
        root: repositoryRoot,
        owner: lifecycleCapability,
        token: delegation.token,
      });
    } catch {
      // The supervisor may have consumed the token; its durable descendant record is authoritative.
    }
  }
}

function supervisedArguments(command, args) {
  return [fileURLToPath(import.meta.url), "--supervise", "--", command, ...args];
}

function supervisedCommandRole(role) {
  const commandRole = `${role}-command`;
  if (!runtimeLifecycleOperationPattern.test(commandRole)) {
    throw new Error("Lifecycle supervisor role is too long for its command descendant.");
  }
  return commandRole;
}

/** Spawns an asynchronous command whose supervisor and process group remain lifecycle-visible. */
export function spawnRuntimeLifecycleCommand({
  args = [],
  command,
  commandDelegation = null,
  lifecycleCapability,
  options = {},
  repositoryRoot,
  role,
}) {
  supervisedCommandRole(role);
  const descriptor = runtimeLifecycleGuardDescriptor({
    root: repositoryRoot,
    owner: lifecycleCapability,
  });
  const delegations = createCommandDelegations({
    commandDelegation,
    lifecycleCapability,
    repositoryRoot,
    role,
  });
  const { guardIndex, stdio } = stdioWithGuard(options.stdio, descriptor);
  let child;
  try {
    child = spawn(process.execPath, supervisedArguments(command, args), {
      ...options,
      detached: false,
      env: childEnvironment({
        commandDelegation: delegations.command,
        environment: options.env ?? process.env,
        guardIndex,
        repositoryRoot,
        role,
        supervisor: delegations.supervisor,
        witness: delegations.witness,
      }),
      stdio,
    });
  } catch (error) {
    cancelUnusedDelegations(repositoryRoot, lifecycleCapability, delegations);
    throw error;
  }
  child.once("error", () =>
    cancelUnusedDelegations(repositoryRoot, lifecycleCapability, delegations),
  );
  child.once("close", (_status, signal) => {
    if (!signal) cancelUnusedDelegations(repositoryRoot, lifecycleCapability, delegations);
  });
  return child;
}

/** Runs a synchronous command through the same durable supervisor and inherited guard. */
export function spawnRuntimeLifecycleCommandSync({
  args = [],
  command,
  commandDelegation = null,
  lifecycleCapability,
  options = {},
  repositoryRoot,
  role,
}) {
  supervisedCommandRole(role);
  const descriptor = runtimeLifecycleGuardDescriptor({
    root: repositoryRoot,
    owner: lifecycleCapability,
  });
  const delegations = createCommandDelegations({
    commandDelegation,
    lifecycleCapability,
    repositoryRoot,
    role,
  });
  const { guardIndex, stdio } = stdioWithGuard(options.stdio, descriptor);
  let result;
  try {
    result = spawnSync(process.execPath, supervisedArguments(command, args), {
      ...options,
      env: childEnvironment({
        commandDelegation: delegations.command,
        environment: options.env ?? process.env,
        guardIndex,
        repositoryRoot,
        role,
        supervisor: delegations.supervisor,
        witness: delegations.witness,
      }),
      stdio,
    });
  } catch (error) {
    cancelUnusedDelegations(repositoryRoot, lifecycleCapability, delegations);
    throw error;
  }
  if (!result.signal) cancelUnusedDelegations(repositoryRoot, lifecycleCapability, delegations);
  return result;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Lifecycle supervisor is missing ${name}.`);
  return value;
}

function targetEnvironment() {
  const environment = withoutLifecycleDelegationEnvironment(process.env);
  if (process.env[commandTokenVariable]) {
    environment[delegatedTokenVariable] = process.env[commandTokenVariable];
    environment[delegatedOperationVariable] = process.env[commandOperationVariable];
    environment[delegatedRoleVariable] = process.env[commandRoleVariable];
    environment[delegatedRootVariable] = process.env[lifecycleRootVariable];
  }
  return environment;
}

function signalProcessGroup(child, signal) {
  if (!child?.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function signalExitCode(signal) {
  const number = os.constants.signals?.[signal];
  return Number.isInteger(number) ? 128 + number : 1;
}

async function terminateAndReapProcessGroup(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolve) => {
    child.once("close", resolve);
    child.once("error", resolve);
  });
  signalProcessGroup(child, "SIGTERM");
  const graceful = await Promise.race([
    closed.then(() => true),
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 5_000);
      timer.unref();
    }),
  ]);
  if (graceful) return;
  signalProcessGroup(child, "SIGKILL");
  await closed;
}

async function supervise(command, args) {
  const repositoryRoot = requiredEnvironment(lifecycleRootVariable);
  const operation = requiredEnvironment(supervisorOperationVariable);
  const role = requiredEnvironment(supervisorRoleVariable);
  const guardDescriptor = Number(requiredEnvironment(guardDescriptorVariable));
  if (!Number.isSafeInteger(guardDescriptor) || guardDescriptor < 3) {
    throw new Error("Lifecycle supervisor guard descriptor is invalid.");
  }
  const lifecycleCapability = adoptRuntimeLifecycleDelegation({
    root: repositoryRoot,
    operation,
    role,
    token: requiredEnvironment(supervisorTokenVariable),
  });
  let child;
  let registration;
  let shutdownSignal = null;
  let escalation;
  const handlers = new Map();
  try {
    child = spawn(command, args, {
      cwd: process.cwd(),
      detached: process.platform !== "win32",
      env: targetEnvironment(),
      stdio: ["inherit", "inherit", "inherit", guardDescriptor],
    });
    if (child.pid) {
      registration = registerRuntimeLifecycleDescendant({
        allowExisting: Boolean(process.env[commandTokenVariable]),
        root: repositoryRoot,
        owner: lifecycleCapability,
        pid: child.pid,
        role: supervisedCommandRole(role),
      });
    }
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      const handler = () => {
        if (shutdownSignal) return;
        shutdownSignal = signal;
        signalProcessGroup(child, signal);
        escalation = setTimeout(() => signalProcessGroup(child, "SIGKILL"), 5_000);
        escalation.unref();
      };
      handlers.set(signal, handler);
      process.on(signal, handler);
    }
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (status, signal) => resolve({ signal, status }));
    });
    if (shutdownSignal) return signalExitCode(shutdownSignal);
    if (result.signal) return signalExitCode(result.signal);
    return result.status ?? 1;
  } catch (error) {
    await terminateAndReapProcessGroup(child);
    throw error;
  } finally {
    if (escalation) clearTimeout(escalation);
    for (const [signal, handler] of handlers) process.off(signal, handler);
    if (registration) {
      unregisterRuntimeLifecycleDescendant({
        root: repositoryRoot,
        owner: lifecycleCapability,
        registration,
      });
    }
    if (process.env[commandTokenVariable]) {
      try {
        cancelRuntimeLifecycleDelegation({
          root: repositoryRoot,
          owner: lifecycleCapability,
          token: process.env[commandTokenVariable],
        });
      } catch {
        // A command that adopted the delegation owns its durable cleanup.
      }
    }
    try {
      cancelRuntimeLifecycleDelegation({
        root: repositoryRoot,
        owner: lifecycleCapability,
        token: requiredEnvironment(witnessTokenVariable),
      });
    } catch {
      // A killed supervisor leaves the pre-spawn witness durable for fail-closed recovery.
    }
    releaseRuntimeLifecycleLock({ root: repositoryRoot, owner: lifecycleCapability });
  }
}

function parseSupervisorCommand(argv) {
  if (argv[0] !== "--supervise" || argv[1] !== "--" || !argv[2]) {
    throw new Error("Lifecycle supervisor requires --supervise -- <command> [args...].");
  }
  return { args: argv.slice(3), command: argv[2] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = parseSupervisorCommand(process.argv.slice(2));
    process.exitCode = await supervise(command.command, command.args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
