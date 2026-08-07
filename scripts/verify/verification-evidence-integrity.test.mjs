import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import {
  VerificationEvidenceError,
  readSuccessfulVerificationBasis,
  recordSuccessfulFullEvidence,
  verificationEvidenceCachePath,
} from "./verification-evidence.mjs";
import {
  broadPlan,
  cleanupTemporaryEvidenceRoots,
  fixture,
  inputs,
  overwriteEvidence,
  record,
  runtimeIdentity,
  validate,
} from "./verification-evidence-test-helpers.mjs";
import { captureVerificationGitBasis } from "./verification-git-basis.mjs";
import {
  normalizedVerificationRuntimeIdentity,
  verificationChildEnvironment,
} from "./verification-runtime-identity.mjs";
import { omitAlreadyCoveredPaths } from "./verification-admission.mjs";
import { acquireVerificationSessionLock } from "./verification-session-lock.mjs";

after(cleanupTemporaryEvidenceRoots);

test("runtime identity binds effective verifier limits and resolved tool executables", () => {
  const root = fixture();
  const firstBin = path.join(root, "toolchain-a");
  const secondBin = path.join(root, "toolchain-b");
  for (const directory of [firstBin, secondBin]) {
    mkdirSync(directory);
    for (const command of ["pnpm", "mise", "bash", "git", "shellcheck"]) {
      const executable = path.join(directory, command);
      writeFileSync(executable, "#!/bin/sh\nprintf 'fixture-tool 1.0\\n'\n", "utf8");
      chmodSync(executable, 0o755);
    }
  }
  const previousPath = process.env.PATH;
  const previousLimit = process.env.IMAGE_ASSET_MAX_BYTES;
  try {
    delete process.env.IMAGE_ASSET_MAX_BYTES;
    process.env.PATH = firstBin;
    const baseline = normalizedVerificationRuntimeIdentity(undefined, { cwd: root });
    process.env.IMAGE_ASSET_MAX_BYTES = "9999999";
    const changedLimit = normalizedVerificationRuntimeIdentity(undefined, { cwd: root });
    assert.notEqual(changedLimit.environment, baseline.environment);

    delete process.env.IMAGE_ASSET_MAX_BYTES;
    process.env.PATH = secondBin;
    const changedExecutables = normalizedVerificationRuntimeIdentity(undefined, { cwd: root });
    assert.equal(changedExecutables.pnpm, baseline.pnpm);
    assert.equal(changedExecutables.mise, baseline.mise);
    assert.notEqual(changedExecutables.executables, baseline.executables);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousLimit === undefined) delete process.env.IMAGE_ASSET_MAX_BYTES;
    else process.env.IMAGE_ASSET_MAX_BYTES = previousLimit;
  }
});

test("runtime identity hashes every forwarded semantic child control", () => {
  const root = fixture();
  const unknownName = "VERIFICATION_UNBOUND_TEST_CONTROL";
  const semanticName = "CONTEXT_INDEX_OFFLINE";
  const previousUnknown = process.env[unknownName];
  const previousSemantic = process.env[semanticName];
  try {
    process.env[unknownName] = "first";
    delete process.env[semanticName];
    const baseline = normalizedVerificationRuntimeIdentity(undefined, { cwd: root });
    process.env[unknownName] = "second";
    assert.equal(verificationChildEnvironment()[unknownName], undefined);
    assert.equal(
      normalizedVerificationRuntimeIdentity(undefined, { cwd: root }).environment,
      baseline.environment,
    );

    process.env[semanticName] = "1";
    assert.equal(verificationChildEnvironment()[semanticName], "1");
    assert.notEqual(
      normalizedVerificationRuntimeIdentity(undefined, { cwd: root }).environment,
      baseline.environment,
    );
  } finally {
    if (previousUnknown === undefined) delete process.env[unknownName];
    else process.env[unknownName] = previousUnknown;
    if (previousSemantic === undefined) delete process.env[semanticName];
    else process.env[semanticName] = previousSemantic;
  }
});

test("child verification disables npm user and global config through distinct absent paths", () => {
  const environment = verificationChildEnvironment();
  assert.notEqual(environment.NPM_CONFIG_GLOBALCONFIG, environment.NPM_CONFIG_USERCONFIG);
  for (const configPath of [
    environment.NPM_CONFIG_GLOBALCONFIG,
    environment.NPM_CONFIG_USERCONFIG,
  ]) {
    assert.throws(() => lstatSync(configPath), { code: "ENOENT" });
  }
  const npm = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"], {
    encoding: "utf8",
    env: environment,
    input: "",
    stdio: "pipe",
  });
  assert.equal(npm.status, 0, npm.stderr);
});

test("tool versions are probed once per process, repository, executable, and environment", () => {
  const root = fixture();
  const toolDirectory = path.join(root, "counted-tools");
  const counter = path.join(root, "version-probes.txt");
  mkdirSync(toolDirectory);
  for (const command of ["pnpm", "mise", "bash", "git", "shellcheck"]) {
    const executable = path.join(toolDirectory, command);
    const body =
      command === "pnpm" || command === "mise"
        ? `#!/bin/sh\nprintf 'probe\\n' >> ${JSON.stringify(counter)}\nprintf 'secret-like-tool-output\\n'\n`
        : "#!/bin/sh\nprintf 'fixture-tool\\n'\n";
    writeFileSync(executable, body, "utf8");
    chmodSync(executable, 0o755);
  }
  const previousPath = process.env.PATH;
  try {
    process.env.PATH = toolDirectory;
    const first = normalizedVerificationRuntimeIdentity(undefined, { cwd: root });
    const second = normalizedVerificationRuntimeIdentity(undefined, { cwd: root });
    assert.deepEqual(second, first);
    assert.equal(readFileSync(counter, "utf8").trim().split("\n").length, 2);
    assert.equal(JSON.stringify(first).includes("secret-like-tool-output"), false);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
});

test("sequential workspace command order changes the broad plan digest", () => {
  const root = fixture();
  const unit = {
    args: ["--recursive", "run", "test:unit"],
    executable: "pnpm",
    key: "workspace:test:unit",
    phase: "workspace-test",
  };
  const integration = {
    args: ["--recursive", "run", "test:integration"],
    executable: "pnpm",
    key: "workspace:test:integration",
    phase: "workspace-test",
  };
  const first = inputs(root, {
    broadPlan: [broadPlan[0], unit, integration],
  });
  const reversed = inputs(root, {
    broadPlan: [broadPlan[0], integration, unit],
  });
  assert.notEqual(first.planDigest, reversed.planDigest);
});

test("parallel command order is canonicalized for evidence reuse", () => {
  const root = fixture();
  const first = {
    args: ["--test", "src/first.test.mjs"],
    executable: "node",
    key: "first-regressions",
    phase: "broad",
  };
  const second = {
    args: ["--test", "src/second.test.mjs"],
    executable: "node",
    key: "second-regressions",
    phase: "broad",
  };
  const publishedPlan = [first, second, broadPlan[1]];
  const reorderedPlan = [second, first, broadPlan[1]];
  assert.equal(
    inputs(root, { broadPlan: publishedPlan }).planDigest,
    inputs(root, { broadPlan: reorderedPlan }).planDigest,
  );
  record(root, publishedPlan);
  assert.equal(readSuccessfulVerificationBasis({ broadPlan: reorderedPlan, root }).trusted, true);
  assert.equal(validate(root, { broadPlan: reorderedPlan }).valid, true);
});

test("permission-only source drift remains stale when Git has no classified delta", () => {
  for (const { label, mode, disableFileMode } of [
    { label: "0644 to 0600", mode: 0o600 },
    { label: "executable bit with core.fileMode false", mode: 0o755, disableFileMode: true },
  ]) {
    const root = fixture();
    const source = path.join(root, "src", "product.mjs");
    chmodSync(source, 0o644);
    record(root);
    const baseline = validate(root).inputs;
    if (disableFileMode) {
      const configured = spawnSync("git", ["config", "core.fileMode", "false"], {
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
      });
      assert.equal(configured.status, 0, configured.stderr);
    }
    chmodSync(source, mode);
    assert.equal(lstatSync(source).mode & 0o777, mode, label);
    const changed = inputs(root);
    assert.notEqual(changed.exactFingerprint, baseline.exactFingerprint, label);
    const gitBasis = captureVerificationGitBasis({ repositoryRoot: root });
    assert.deepEqual(gitBasis.dirtyPaths, [], label);
    const drift = omitAlreadyCoveredPaths({
      basis: readSuccessfulVerificationBasis({ broadPlan, root }),
      changedScope: {
        basisChanged: false,
        incomplete: false,
        paths: gitBasis.dirtyPaths,
        reason: "",
      },
      expectedInputs: changed,
    });
    assert.equal(drift.incomplete, true, label);
    assert.throws(
      () => validate(root),
      (error) =>
        error instanceof VerificationEvidenceError &&
        error.findings.includes("current repository state is not attested"),
      label,
    );
  }
});

test("ignored cache and local runtime writes do not change source fingerprints", () => {
  const root = fixture();
  record(root);
  const before = validate(root).inputs;
  mkdirSync(path.join(root, ".codex", "runtime", "cache", "other-runtime"), {
    recursive: true,
  });
  writeFileSync(
    path.join(root, ".codex", "runtime", "cache", "other-runtime", "state.json"),
    "{}\n",
    "utf8",
  );
  mkdirSync(path.join(root, ".context-index"), { recursive: true });
  writeFileSync(path.join(root, ".context-index", "manifest.json"), "{}\n", "utf8");
  const after = validate(root).inputs;
  assert.equal(after.exactFingerprint, before.exactFingerprint);
  assert.equal(after.broadFingerprint, before.broadFingerprint);
});

test("recording fails when source state changes after the pre-gate snapshot", () => {
  const root = fixture();
  const expectedInputs = inputs(root);
  const expectedGitBasis = captureVerificationGitBasis({ repositoryRoot: root });
  record(root);
  const previousEvidence = readFileSync(verificationEvidenceCachePath(root));
  writeFileSync(path.join(root, "docs/project.md"), "# Changed during gate\n", "utf8");
  const lock = acquireVerificationSessionLock({ repositoryRoot: root });
  try {
    assert.throws(
      () =>
        recordSuccessfulFullEvidence({
          root,
          broadPlan,
          expectedGitBasis,
          expectedInputs,
          runtimeIdentity,
          successfulCommandKeys: broadPlan.map((command) => command.key),
        }),
      /changed during complete verification|changed during complete/i,
    );
  } finally {
    lock.release();
  }
  assert.deepEqual(readFileSync(verificationEvidenceCachePath(root)), previousEvidence);
});

test("corrupt, oversized, and incomplete evidence records fail closed", () => {
  for (const content of ["{not-json\n", '{"schemaVersion":1}\n', "x".repeat(1025 * 1024)]) {
    const root = fixture();
    record(root);
    overwriteEvidence(root, content);
    assert.throws(() => validate(root), VerificationEvidenceError);
  }
});

test("symlinked and hardlinked evidence files fail closed", () => {
  {
    const root = fixture();
    record(root);
    const evidencePath = verificationEvidenceCachePath(root);
    const replacement = path.join(path.dirname(evidencePath), "replacement.json");
    writeFileSync(replacement, readFileSync(evidencePath));
    rmSync(evidencePath);
    symlinkSync(replacement, evidencePath);
    assert.throws(() => validate(root), /unsafe/i);
  }
  {
    const root = fixture();
    record(root);
    const evidencePath = verificationEvidenceCachePath(root);
    const replacement = path.join(path.dirname(evidencePath), "replacement.json");
    writeFileSync(replacement, readFileSync(evidencePath));
    rmSync(evidencePath);
    linkSync(replacement, evidencePath);
    assert.throws(() => validate(root), /unsafe/i);
  }
});

test("symlinked or writable evidence directories fail closed", () => {
  {
    const root = fixture();
    record(root);
    const evidenceDirectory = path.dirname(verificationEvidenceCachePath(root));
    const replacement = path.join(root, "replacement-evidence-directory");
    mkdirSync(replacement);
    rmSync(evidenceDirectory, { recursive: true });
    symlinkSync(replacement, evidenceDirectory);
    assert.throws(() => validate(root), /unsafe.*verification cache directory/i);
  }
  {
    const root = fixture();
    record(root);
    const evidenceDirectory = path.dirname(verificationEvidenceCachePath(root));
    chmodSync(evidenceDirectory, 0o777);
    assert.throws(() => validate(root), /unsafe.*verification cache directory/i);
  }
});
