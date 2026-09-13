/** Owns setup regression fixtures behavior for the setup, launch, and portable project boundary. */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listPortableTransferFiles } from "../repository/source-inventory.mjs";
import {
  captureStableRepositoryFileIdentity,
  copyStableRepositoryFile,
} from "../repository/stable-file-snapshot.mjs";
import { nonPortableSnapshotPathReason } from "../framework/portable-project-contract.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const temporaryRoots = [];

export function temporaryRoot(prefix) {
  const value = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(value);
  return value;
}

export function cleanupTemporaryRoots() {
  for (const temporaryRootPath of temporaryRoots.splice(0)) {
    rmSync(temporaryRootPath, { force: true, recursive: true });
  }
}

/** Copies current portable test inputs into a new owned target, never the primary's work cache.
 * Production export still rejects nonportable state; callers own their fixture's cleanup and Git.
 */
export function copyPortableSetupFixture(targetRoot, { sourceRoot = root } = {}) {
  const entries = listPortableTransferFiles({ root: sourceRoot, includeUntracked: true })
    .filter((relativePath) => !nonPortableSnapshotPathReason(relativePath))
    .map((relativePath) => ({
      relativePath,
      ...captureStableRepositoryFileIdentity({ repositoryRoot: sourceRoot, relativePath }),
    }));
  mkdirSync(targetRoot, { mode: 0o700 });
  for (const entry of entries) {
    mkdirSync(path.dirname(path.join(targetRoot, entry.relativePath)), { recursive: true });
    copyStableRepositoryFile({
      repositoryRoot: sourceRoot,
      relativePath: entry.relativePath,
      targetRoot,
      expectedIdentity: entry.identity,
    });
  }
}

export function run(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    input: options.input ?? "",
    stdio: "pipe",
    timeout: 30_000,
  });
}

export const validPortableConfig = `# Portable policy; assignments in comments do not count.
developer_instructions = """
Act as the primary orchestrator. Retain exactly one current internal contract per concern. Keep at most four live agents and never pass a model or reasoning override; all use the exact GPT Astra model with ultra reasoning. Register every owned subagent and background task and leave foreign or ambiguous processes untouched. Treat role sandboxes as requested defaults because live parent permission overrides can be reapplied; require each child to report effective runtime permissions before tool work. Read-only roles stop on a broader override; a writer may accept this primary's already-authorized YOLO override only for its exact disjoint repository write set. After every completed slice, run pnpm worktree:status -- --json as the worktree settlement trigger; preservation is a safety state, never completion. At 5% or less, perform the exact Critical Budget Drain and run pnpm handover:create -- --critical as the final repository action. After a successful seal, stop completely and never permit automatic continuation.
"""
project_doc_max_bytes = 32768 # bounded bootstrap context
project_doc_fallback_filenames = ["instructions.md"]
model_reasoning_effort = "ultra"
model_verbosity = "medium"
web_search = "cached"
model = "gpt-6-astra"
approvals_reviewer = "user"
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
network_access = false

[agents]
enabled = true
default_subagent_model = "gpt-6-astra"
default_subagent_reasoning_effort = "ultra"
max_concurrent_threads_per_session = 4
interrupt_message = true

[features]
goals = true
hooks = true
memories = true
network_proxy = true
prevent_idle_sleep = true

[tui]
status_line = ["model-with-reasoning", "run-state", "weekly-limit", "five-hour-limit", "task-progress", "used-tokens"]
status_line_use_colors = true
terminal_title = ["activity", "project-name", "five-hour-limit", "weekly-limit", "task-progress"]
theme = "catppuccin-mocha"
`;

export function writeProjectAgents(projectRoot) {
  const target = path.join(projectRoot, ".codex", "agents");
  mkdirSync(target, { recursive: true });
  for (const name of ["default", "explorer", "worker"]) {
    copyFileSync(
      path.join(root, ".codex", "agents", `${name}.toml`),
      path.join(target, `${name}.toml`),
    );
  }
}

export function writeProjectHookFiles(projectRoot) {
  mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
  copyFileSync(path.join(root, ".gitignore"), path.join(projectRoot, ".gitignore"));
  copyFileSync(
    path.join(root, ".codex", "hooks.json"),
    path.join(projectRoot, ".codex", "hooks.json"),
  );
  const contextDirectory = path.join(projectRoot, "scripts", "context");
  mkdirSync(contextDirectory, { recursive: true });
  copyFileSync(
    path.join(root, "scripts", "context", "session-stop-lifecycle.mjs"),
    path.join(contextDirectory, "session-stop-lifecycle.mjs"),
  );
  const setupDirectory = path.join(projectRoot, "scripts", "setup");
  mkdirSync(setupDirectory, { recursive: true });
  for (const name of [
    "session-control-hook-command.mjs",
    "startup-attestation.mjs",
    "startup-codex-process.mjs",
    "startup-runtime-executables.mjs",
    "startup-session-controller.mjs",
  ]) {
    copyFileSync(path.join(root, "scripts", "setup", name), path.join(setupDirectory, name));
  }
}

export function configFixture(content = validPortableConfig) {
  const fixture = temporaryRoot("codex-config-");
  mkdirSync(path.join(fixture, ".codex"), { recursive: true });
  writeFileSync(path.join(fixture, ".codex", "config.toml"), content, "utf8");
  writeProjectHookFiles(fixture);
  writeProjectAgents(fixture);
  return fixture;
}
