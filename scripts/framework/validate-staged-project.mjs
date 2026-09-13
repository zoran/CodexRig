/** Owns validate staged project behavior for the setup, launch, and portable project boundary. */
import { spawnSyncWithBoundedIo as spawnSync } from "../repository/runtime-process-io.mjs";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assertPortableContextContract } from "../context/portable-context-contract.mjs";
import { formatContextError } from "../terminal/terminal-output.mjs";
import { listStagedTransferFiles } from "../repository/source-inventory.mjs";
import { assertSafeTransferSource } from "../repository/validate-transfer-source.mjs";
import { deliveryEnvironmentFindings } from "../verify/delivery-environments.mjs";
import { identityAccessProjectFindings } from "../verify/identity-access.mjs";
import { localizationProjectFindings } from "../verify/localization.mjs";
import { tenantIsolationProjectFindings } from "../verify/tenant-isolation.mjs";
import { scanRepositorySecrets } from "../verify/secrets.mjs";
import { productSourceBoundaryFindings } from "../verify/path-hygiene.mjs";
import { whiteLabelProjectFindings } from "../verify/white-label.mjs";
import { assertPortableProjectContract } from "./portable-project-contract.mjs";
import { validateCodexConfig } from "../setup/validate-codex-config.mjs";

const modulePath = fileURLToPath(import.meta.url);

function directoryIdentity(stats) {
  return `${stats.dev}:${stats.ino}`;
}

function fileIdentity(stats) {
  return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs, stats.nlink].join(":");
}

function bindStageRoot(candidate) {
  try {
    const stats = lstatSync(candidate, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("unsafe root");
    return {
      identity: directoryIdentity(stats),
      root: realpathSync(candidate),
    };
  } catch {
    throw new Error("Staged project root must be a stable non-symlink directory.");
  }
}

function assertStageRootBinding(binding) {
  try {
    const stats = lstatSync(binding.root, { bigint: true });
    if (
      stats.isSymbolicLink() ||
      !stats.isDirectory() ||
      directoryIdentity(stats) !== binding.identity ||
      realpathSync(binding.root) !== binding.root
    ) {
      throw new Error("changed binding");
    }
  } catch {
    throw new Error("Staged project root identity changed during validation.");
  }
}

function assertStaticModuleImports(binding) {
  const validatorPath = path.join(binding.root, "scripts/setup/validate-static-module-imports.mjs");
  const result = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-vm-modules", validatorPath],
    {
      cwd: binding.root,
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "" },
      input: "",
      stdio: "pipe",
      timeout: 30_000,
    },
  );
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? `${result.stdout}${result.stderr}`.trim();
    throw new Error(detail || "Staged project static module import validation failed.");
  }
}

async function validateBoundStagedProject(binding) {
  assertStageRootBinding(binding);
  validateCodexConfig(binding.root);
  assertStageRootBinding(binding);
  assertPortableContextContract({ repositoryRoot: binding.root });
  assertStageRootBinding(binding);
  const whiteLabelFindings = whiteLabelProjectFindings({ root: binding.root });
  if (whiteLabelFindings.length > 0) {
    throw new Error(
      [
        "Staged project violates the white-label product contract:",
        ...whiteLabelFindings.map((item) => `- ${item}`),
      ].join("\n"),
    );
  }
  assertStageRootBinding(binding);
  const deliveryFindings = deliveryEnvironmentFindings({ root: binding.root });
  if (deliveryFindings.length > 0) {
    throw new Error(
      [
        "Staged project violates the delivery inventory contract:",
        ...deliveryFindings.map((item) => `- ${item}`),
      ].join("\n"),
    );
  }
  assertStageRootBinding(binding);
  const boundaryFindings = productSourceBoundaryFindings({ repositoryRoot: binding.root });
  if (boundaryFindings.length > 0) {
    throw new Error(
      [
        "Staged project violates the Product Roots contract:",
        ...boundaryFindings.map((item) => `- ${item}`),
      ].join("\n"),
    );
  }
  assertStageRootBinding(binding);
  const identityAccessFindings = identityAccessProjectFindings({ root: binding.root });
  if (identityAccessFindings.length > 0) {
    throw new Error(
      [
        "Staged project violates the Identity and Access boundary:",
        ...identityAccessFindings.map((item) => `- ${item}`),
      ].join("\n"),
    );
  }
  assertStageRootBinding(binding);
  const tenantIsolationFindings = tenantIsolationProjectFindings({ root: binding.root });
  if (tenantIsolationFindings.length > 0) {
    throw new Error(
      [
        "Staged project violates the tenant-isolation boundary:",
        ...tenantIsolationFindings.map((item) => `- ${item}`),
      ].join("\n"),
    );
  }
  assertStageRootBinding(binding);
  const localizationFindings = localizationProjectFindings({ root: binding.root });
  if (localizationFindings.length > 0) {
    throw new Error(
      [
        "Staged project violates the localization contract:",
        ...localizationFindings.map((item) => `- ${item}`),
      ].join("\n"),
    );
  }
  assertStageRootBinding(binding);
  const files = listStagedTransferFiles({ root: binding.root });
  assertPortableProjectContract(files);
  assertStageRootBinding(binding);
  assertSafeTransferSource({ root: binding.root, files });
  assertStageRootBinding(binding);
  const findings = await scanRepositorySecrets({ root: binding.root, files });
  assertStageRootBinding(binding);
  if (findings.length > 0) {
    throw new Error(
      [
        "Staged project contains potential secret material:",
        ...findings.map((item) => `- ${item}`),
      ].join("\n"),
    );
  }
  assertStaticModuleImports(binding);
  assertStageRootBinding(binding);
}

export async function validateGeneratedProject(targetRoot) {
  const binding = bindStageRoot(targetRoot);
  await validateBoundStagedProject(binding);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3)
      throw new Error(
        "Usage: node scripts/framework/validate-staged-project.mjs <owned-stage-root>",
      );
    await validateGeneratedProject(process.argv[2]);
    console.log("Generated project policy, imports, paths and secrets passed.");
  } catch (error) {
    console.error(formatContextError(error));
    process.exitCode = 1;
  }
}
