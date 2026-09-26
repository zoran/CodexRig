/** Owns the repository-bound credential for the explicitly authorized Git platform API adapter. */
import { lstatSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { readOptionalOwnedFile } from "../filesystem/owned-file-operations.mjs";
import { projectAccountStateDirectory } from "../repository/source-inventory-policy.mjs";

export const platformCredentialPath = `${projectAccountStateDirectory}/git-platform.json`;

/** Reads one private credential bound to the selected remote; never consults ambient tokens. */
export function readPlatformCredential(root, detected) {
  const missing = `Configure the project-owned ${platformCredentialPath} credential for the selected remote before applying platform policy.`;
  let directory;
  try {
    directory = lstatSync(path.join(root, projectAccountStateDirectory));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(missing);
    throw error;
  }
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (directory.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && directory.uid !== process.getuid())
  )
    throw new Error("Platform credentials require private project-owned account storage.");
  const file = readOptionalOwnedFile(
    root,
    path.join(root, platformCredentialPath),
    "project platform credential",
    { maximumBytes: 32 * 1024 },
  );
  if (!file.exists) throw new Error(missing);
  if (
    (Number(file.stats.mode) & 0o077) !== 0 ||
    (typeof process.getuid === "function" && Number(file.stats.uid) !== process.getuid())
  )
    throw new Error("Platform credential must be private and owned by the current developer.");
  let value;
  try {
    value = JSON.parse(file.buffer.toString("utf8"));
  } catch {
    throw new Error("Project platform credential must be valid JSON.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !==
      "hostname\nprovider\nrepository\nschemaVersion\ntoken" ||
    value.schemaVersion !== 1 ||
    value.provider !== detected.provider ||
    value.hostname !== detected.hostname ||
    value.repository !== detected.slug ||
    typeof value.token !== "string" ||
    !value.token ||
    value.token.length > 16_384 ||
    /[\s\0]/u.test(value.token)
  )
    throw new Error("Project platform credential is invalid or belongs to a different remote.");
  return value.token;
}
