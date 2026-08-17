#!/usr/bin/env node
/** Verifies CodexRig licensing, attribution, generation, and managed-upgrade invariants. */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { formatContextError } from "../terminal/terminal-output.mjs";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const expectedLicenseDigest = "ffcca38841adb694b6f380647e15f17c446a4d1656fed51a1e2041d064c94cc8";
const expectedNoticeDigest = "238e2bb9937bb95048c768fbb3e10acff263718b1529f9c6a78c18b7ad0f3d40";
const expectedLicenseId = "PolyForm-Noncommercial-1.0.0";
const requiredNotice =
  "Required Notice: CodexRig Framework. Copyright © 2026 Zoran Kikic. All noncommercial copies, distributions, and derivative works must retain this notice and the PolyForm Noncommercial License 1.0.0 terms.";

function regularText(root, relativePath, findings) {
  const target = path.join(root, relativePath);
  if (!existsSync(target)) {
    findings.push(`${relativePath}: required licensing file is missing`);
    return null;
  }
  const stats = lstatSync(target);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) {
    findings.push(`${relativePath}: must be a single-link regular file`);
    return null;
  }
  return readFileSync(target, "utf8");
}

function parseJson(content, relativePath, findings) {
  if (content === null) return null;
  try {
    return JSON.parse(content);
  } catch {
    findings.push(`${relativePath}: must contain valid JSON`);
    return null;
  }
}

export function licensingFindings({ root = defaultRoot } = {}) {
  const findings = [];
  const license = regularText(root, "LICENSE", findings);
  if (
    license !== null &&
    createHash("sha256").update(license).digest("hex") !== expectedLicenseDigest
  ) {
    findings.push("LICENSE: must remain the unmodified PolyForm Noncommercial License 1.0.0 text");
  }

  const notice = regularText(root, "NOTICE", findings);
  if (notice !== null) {
    if (createHash("sha256").update(notice).digest("hex") !== expectedNoticeDigest) {
      findings.push("NOTICE: must remain the exact CodexRig licensing and Required Notice text");
    }
    const occurrences = notice.split(requiredNotice).length - 1;
    if (occurrences !== 1) {
      findings.push("NOTICE: must contain the exact CodexRig Required Notice once");
    }
    for (const statement of [
      "must remain in CodexRig itself under every granted license",
      "within that generated project only",
      "No noncommercial license permits their removal",
    ]) {
      if (!notice.includes(statement)) findings.push(`NOTICE: must state ${statement}`);
    }
  }

  const packageJson = parseJson(
    regularText(root, "package.json", findings),
    "package.json",
    findings,
  );
  if (packageJson && packageJson.license !== expectedLicenseId) {
    findings.push(`package.json: license must be ${expectedLicenseId}`);
  }

  const contract = parseJson(
    regularText(root, ".codexrig/framework.json", findings),
    ".codexrig/framework.json",
    findings,
  );
  if (contract) {
    const managedRoots = contract.upgrade?.managedRoots;
    for (const relativePath of ["LICENSE", "NOTICE"]) {
      if (!Array.isArray(managedRoots) || !managedRoots.includes(relativePath)) {
        findings.push(`.codexrig/framework.json: managedRoots must include ${relativePath}`);
      }
    }
  }

  const readme = regularText(root, "README.md", findings);
  const normalizedReadme = readme?.replace(/\s+/gu, " ") ?? null;
  if (
    normalizedReadme !== null &&
    (!readme.includes("## License And Attribution") ||
      !normalizedReadme.includes("Zoran Kikic") ||
      !normalizedReadme.includes("PolyForm Noncommercial License 1.0.0") ||
      !normalizedReadme.includes("Commercial use requires a separate express written license") ||
      !normalizedReadme.includes("does not permit their removal from CodexRig itself"))
  ) {
    findings.push("README.md: must explain the controlling license and attribution boundary");
  }
  return findings.sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const findings = licensingFindings();
    if (findings.length > 0) {
      console.error("License and attribution verification failed:");
      for (const finding of findings) console.error(`- ${finding}`);
      process.exit(1);
    }
    console.log("License and attribution verification passed.");
  } catch (error) {
    console.error(
      `License and attribution verification failed: ${formatContextError(error, defaultRoot)}`,
    );
    process.exit(1);
  }
}
