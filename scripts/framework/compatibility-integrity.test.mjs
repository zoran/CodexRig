/** Proves compatibility-owned mise archives are verified before GitLab installation. */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readCompatibilityMatrix } from "../contracts/framework-contract.mjs";
import {
  codexNpmPackageRecords,
  githubStableCodexInstallStep,
  gitlabChildPipeline,
  gitlabMiseInstallBeforeScript,
  gitlabStableCodexInstallBeforeScript,
  miseNpmPackageRecords,
  verifyCodexArchives,
  verifyMiseArchive,
} from "./compatibility-matrix.mjs";
import {
  ciAdapterContractViolations,
  compatibilityFreshnessWarnings,
} from "./framework-doctor.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");
const matrixScript = fileURLToPath(new URL("./compatibility-matrix.mjs", import.meta.url));
const reviewedIntegrities = {
  arm64:
    "sha512-MOg3B92G0c1xu2wZX5wuJXSpNagxCu9HAv+tfDn+Rp9UF2sO1CVC7UAPOMcp49UNvcLqH9PeoPsMxIy0dC9FNQ==",
  x64: "sha512-FNEhITXrJmfmYfGsQTfldJGiqTXr3JEQlFMTPV0XJyFI7FP/3kOssgFgSkMOlNqJCT3qFqETi0kCO3PsYx9qUw==",
};
const reviewedCodexIntegrities = {
  arm64:
    "sha512-SLC1JXw2TYfr/c3HhrJubyyLelq7vTOLWVmiThFA+z0+WgzCPmaseJ/kzDD3Gge/TO7fCnnj7UcPmC0d2c8XAg==",
  wrapper:
    "sha512-EQLEXecAG2ptxI7UpBMo2TR/ga5596/c/OsYF/0LoUDh5JANZ7IoGqlzBEWbuEVQ76JePIbtTW/ihCkp1a7Z3w==",
  x64: "sha512-0W9MBxPpWW0cSkNqrTDN2jR7rzzT7oNMhQY5446lT2Lw5cz5yhDTck4Va9rjkQEm+HlFzP/dmEMSZbXfJsINmw==",
};

test("root and generated GitLab adapters share the exact reviewed mise verification block", () => {
  const matrix = readCompatibilityMatrix();
  const records = miseNpmPackageRecords(matrix);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(records).map(([architecture, record]) => [architecture, record.integrity]),
    ),
    reviewedIntegrities,
  );

  const expectedBlock = gitlabMiseInstallBeforeScript(matrix).join("\n");
  const rootGithub = readFileSync(
    path.join(repositoryRoot, ".github", "workflows", "ci.yml"),
    "utf8",
  );
  const rootGitlab = readFileSync(path.join(repositoryRoot, ".gitlab-ci.yml"), "utf8");
  const generatedGitlab = gitlabChildPipeline(matrix);
  assert.match(expectedBlock, /npm pack --ignore-scripts --pack-destination/);
  assert.match(expectedBlock, /--verify-mise-archive/);
  assert.match(expectedBlock, /npm install --global "\$mise_archive" --ignore-scripts --offline/);
  assert.equal(rootGitlab.includes(expectedBlock), true);
  assert.equal(
    generatedGitlab.split(expectedBlock).length - 1,
    matrix.canaries.length,
    "every generated compatibility job must use the canonical verified install",
  );
  assert.doesNotMatch(rootGitlab, /npm install --global "\$\{mise_package\}@/u);
  assert.doesNotMatch(generatedGitlab, /npm install --global "\$\{mise_package\}@/u);
  assert.deepEqual(ciAdapterContractViolations("github", rootGithub, matrix), []);
  assert.deepEqual(ciAdapterContractViolations("gitlab", rootGitlab, matrix), []);

  const driftedGitlab = rootGitlab.replace(reviewedIntegrities.x64, `sha512-${"A".repeat(86)}==`);
  assert.deepEqual(ciAdapterContractViolations("gitlab", driftedGitlab, matrix), [
    "verified-mise-install",
  ]);
  const unverifiedGitlab = rootGitlab.replace(
    "      npm pack --ignore-scripts",
    '      npm install --global "${mise_package}@2026.8.6" --ignore-scripts\n      npm pack --ignore-scripts',
  );
  assert.deepEqual(ciAdapterContractViolations("gitlab", unverifiedGitlab, matrix), [
    "verified-mise-install",
    "unverified-mise-install",
  ]);
});

test("mise archive verification rejects drift before returning an installable path", () => {
  const stage = mkdtempSync(path.join(os.tmpdir(), "codexrig-mise-integrity-"));
  try {
    const archive = path.join(stage, "mise.tgz");
    const reviewedBytes = Buffer.from("reviewed mise archive fixture\n", "utf8");
    const integrity = `sha512-${createHash("sha512").update(reviewedBytes).digest("base64")}`;
    writeFileSync(archive, reviewedBytes, { mode: 0o600 });
    assert.equal(verifyMiseArchive(stage, integrity), archive);

    const cli = spawnSync(
      process.execPath,
      [matrixScript, "--verify-mise-archive", stage, integrity],
      { encoding: "utf8", stdio: "pipe" },
    );
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stdout.trim(), archive);

    writeFileSync(archive, "substituted archive\n", { mode: 0o600 });
    assert.throws(
      () => verifyMiseArchive(stage, integrity),
      /does not match the reviewed integrity/,
    );
    assert.equal(
      spawnSync(process.execPath, [matrixScript, "--verify-mise-archive", stage, integrity], {
        encoding: "utf8",
        stdio: "pipe",
      }).status,
      1,
    );

    writeFileSync(path.join(stage, "second.tgz"), reviewedBytes, { mode: 0o600 });
    assert.throws(() => verifyMiseArchive(stage, integrity), /exactly one \.tgz archive/);
  } finally {
    rmSync(stage, { force: true, recursive: true });
  }
});

test("mise package integrity truth fails closed when an architecture is missing", () => {
  const matrix = structuredClone(readCompatibilityMatrix());
  delete matrix.ci.miseNpmPackageIntegrities.arm64;
  assert.throws(() => miseNpmPackageRecords(matrix), /must own exactly arm64 and x64/);
  assert.throws(
    () => ciAdapterContractViolations("gitlab", "", matrix),
    /must own exactly arm64 and x64/,
  );
});

test("blocking CI uses the exact reviewed Codex wrapper and platform bytes", () => {
  const matrix = readCompatibilityMatrix();
  const records = codexNpmPackageRecords(matrix);
  assert.equal(records.wrapper.integrity, reviewedCodexIntegrities.wrapper);
  assert.equal(records.platforms.x64.integrity, reviewedCodexIntegrities.x64);
  assert.equal(records.platforms.arm64.integrity, reviewedCodexIntegrities.arm64);

  const rootGithub = readFileSync(
    path.join(repositoryRoot, ".github", "workflows", "ci.yml"),
    "utf8",
  );
  const rootGitlab = readFileSync(path.join(repositoryRoot, ".gitlab-ci.yml"), "utf8");
  assert.ok(rootGithub.includes(githubStableCodexInstallStep(matrix).join("\n")));
  assert.ok(rootGitlab.includes(gitlabStableCodexInstallBeforeScript(matrix).join("\n")));
  assert.doesNotMatch(rootGithub, /npm install --global @openai\/codex@latest/u);
  assert.doesNotMatch(rootGitlab, /npm install --global @openai\/codex@latest/u);
  assert.deepEqual(ciAdapterContractViolations("github", rootGithub, matrix), []);
  assert.deepEqual(ciAdapterContractViolations("gitlab", rootGitlab, matrix), []);
});

test("online freshness names the distinct stable and reviewed Codex versions", () => {
  const matrix = readCompatibilityMatrix();
  assert.deepEqual(
    compatibilityFreshnessWarnings(matrix, {
      codex: "0.149.0",
      pnpm: matrix.stable.pnpm.version,
    }),
    [
      {
        code: "online.codex.newer",
        message:
          "Codex stable 0.149.0 is newer than the reviewed blocking-CI version 0.147.0; keep host installations current through the official installer, and separately review and repin the exact CI archives.",
      },
    ],
  );
});

test("Codex archive verification requires both exact reviewed artifacts", () => {
  const stage = mkdtempSync(path.join(os.tmpdir(), "codexrig-codex-integrity-"));
  try {
    const wrapper = Buffer.from("reviewed Codex wrapper fixture\n", "utf8");
    const platform = Buffer.from("reviewed Codex platform fixture\n", "utf8");
    writeFileSync(path.join(stage, "codex-wrapper.tgz"), wrapper, { mode: 0o600 });
    writeFileSync(path.join(stage, "codex-platform.tgz"), platform, { mode: 0o600 });
    const integrity = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    assert.equal(verifyCodexArchives(stage, integrity(wrapper), integrity(platform)).length, 2);
    writeFileSync(path.join(stage, "codex-platform.tgz"), "substituted\n", { mode: 0o600 });
    assert.throws(
      () => verifyCodexArchives(stage, integrity(wrapper), integrity(platform)),
      /do not match the reviewed wrapper and platform bytes/,
    );
  } finally {
    rmSync(stage, { force: true, recursive: true });
  }
});
