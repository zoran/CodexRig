/** Verifies local platform lock ownership, journal recovery and explicit retirement. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { readToolingConfiguration } from "../contracts/tooling-configuration.mjs";
import { captureProcessIdentity } from "../repository/runtime-process-identity.mjs";
import { configurePlatform as configureActualPlatform, parseArgs } from "./configure-platform.mjs";
import {
  platformConfigurationState,
  recoverPlatformConfigurationLock,
} from "./platform-configuration-state.mjs";
import {
  abandonPlatformLock,
  configurePlatform,
  githubDetection,
  gitlabDetection,
  interleavePlatformLockRead,
  response,
} from "./platform-lifecycle-harness.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");
const contract = readToolingConfiguration(repositoryRoot);
const temporaryRoots = [];
const lockRelativePath = ".project-state/platform-configuration.lock";
const journalRelativePath = ".project-state/platform-configuration.json";
const plan = { provider: "github", repository: "owner/project" };

after(() => {
  for (const root of temporaryRoots) rmSync(root, { force: true, recursive: true });
});

function temporaryRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "codexrig-platform-state-"));
  temporaryRoots.push(root);
  return root;
}

// Inventory determines mutation identity; it must be serialized with the mutation itself.
test("platform configuration locks before reading the original remote state", async () => {
  for (const detected of [githubDetection(), gitlabDetection()]) {
    const root = temporaryRoot();
    let entered,
      release,
      competingReads = 0;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    const first = assert.rejects(
      configurePlatform({
        apply: true,
        contract,
        detected,
        root,
        fetchImpl: async () => {
          entered();
          await blocked;
          return response(503);
        },
      }),
      /HTTP 503/u,
    );
    await started;
    try {
      await assert.rejects(
        configurePlatform({
          apply: true,
          contract,
          detected,
          root,
          fetchImpl: async () => {
            competingReads++;
            return response(503);
          },
        }),
        /another platform configuration is active/iu,
      );
      assert.equal(competingReads, 0, "no stale pre-lock inventory may escape admission");
    } finally {
      release();
      await first;
    }
  }
});

test("platform state serializes stale takeover before admitting another journal writer", () => {
  const root = temporaryRoot();
  const plan = { provider: "github", repository: "owner/project" };
  const abandoned = abandonPlatformLock(root, plan);
  assert.equal(abandoned.status, 0, abandoned.stderr);
  const first = platformConfigurationState(root, plan);
  const competing = platformConfigurationState(root, plan);
  let competingFailure;
  const interleaved = interleavePlatformLockRead(
    root,
    () => first.acquire(),
    () => {
      try {
        competing.acquire();
      } catch (error) {
        competingFailure = error;
      }
    },
  );
  assert.equal(interleaved, true, "the second caller reaches the stale-owner takeover window");
  assert.ok(competingFailure, "two callers must not both acquire the platform lock");
  assert.throws(() => competing.begin(), /owned lock/u);
  const statePath = path.join(root, ".project-state/platform-configuration.json");
  assert.equal(existsSync(statePath), false, "the rejected caller cannot create a journal");
  assert.deepEqual(first.begin(), { resumed: false, completed: [] });
  first.record("retained owner");
  assert.deepEqual(JSON.parse(readFileSync(statePath, "utf8")).completed, ["retained owner"]);
  first.complete();
});

test("platform state rejects journal mutation and release after its lock is replaced", () => {
  for (const operation of ["begin", "record", "complete", "release"]) {
    const root = temporaryRoot();
    const store = platformConfigurationState(root, {
      provider: "github",
      repository: "owner/project",
    });
    store.acquire();
    store.begin();
    const statePath = path.join(root, ".project-state/platform-configuration.json");
    const lockPath = path.join(root, ".project-state/platform-configuration.lock");
    const stateBefore = readFileSync(statePath, "utf8");
    const replacement = JSON.parse(readFileSync(lockPath, "utf8"));
    replacement.token = randomUUID();
    writeFileSync(lockPath, JSON.stringify(replacement), { mode: 0o600 });
    const lockBefore = readFileSync(lockPath, "utf8");
    assert.throws(() => store[operation]("displaced owner"), /lock ownership changed/u, operation);
    assert.equal(readFileSync(statePath, "utf8"), stateBefore, operation);
    assert.equal(readFileSync(lockPath, "utf8"), lockBefore, operation);
  }
});

test("platform state preserves superseded locks and indeterminate process identities", (t) => {
  if (process.platform !== "linux") return t.skip("Linux namespace-bound process identity");
  const identity = captureProcessIdentity(process.pid);
  const foreignNamespace = identity.startIdentity.replace(
    /^(linux:[^:]+:\d+:)(\d+)(:\d+)$/u,
    (_, prefix, inode, suffix) => `${prefix}${BigInt(inode) + 1n}${suffix}`,
  );
  assert.notEqual(foreignNamespace, identity.startIdentity);
  for (const [record, expected] of [
    [{ schemaVersion: 1, pid: process.pid, token: randomUUID() }, /lock is invalid/u],
    [
      { schemaVersion: 2, identity: { ...identity, startIdentity: null }, token: randomUUID() },
      /owner cannot be verified/u,
    ],
    [
      {
        schemaVersion: 2,
        identity: { ...identity, startIdentity: foreignNamespace },
        token: randomUUID(),
      },
      /owner cannot be verified/u,
    ],
  ]) {
    const root = temporaryRoot();
    const plan = { provider: "github", repository: "owner/project" };
    const store = platformConfigurationState(root, plan);
    store.acquire();
    const lockPath = path.join(root, ".project-state/platform-configuration.lock");
    const content = JSON.stringify(record);
    writeFileSync(lockPath, content, { mode: 0o600 });
    assert.throws(() => platformConfigurationState(root, plan).acquire(), expected);
    assert.equal(readFileSync(lockPath, "utf8"), content);
    assert.equal(existsSync(path.join(root, ".project-state/platform-configuration.json")), false);
  }
});

function opaqueLockFixture(content = "superseded opaque lock\n") {
  const root = temporaryRoot();
  mkdirSync(path.join(root, ".project-state"), { mode: 0o700 });
  const lock = path.join(root, lockRelativePath);
  const journal = path.join(root, journalRelativePath);
  writeFileSync(lock, content, { mode: 0o600 });
  writeFileSync(journal, "journal bytes retained exactly\n\0", { mode: 0o600 });
  return { root, lock, journal };
}

test("lock recovery preview of an absent lock creates no local state", async () => {
  const root = temporaryRoot();
  assert.deepEqual(
    await configureActualPlatform({ root, ...parseArgs(["--recover-lock", "--json"]) }),
    { applied: false, lockPresent: false, fingerprint: null, ownerStatus: "absent" },
  );
  assert.deepEqual(readdirSync(root), []);
});

test("explicit opaque lock retirement preserves the journal and bypasses all provider inputs", async () => {
  const root = temporaryRoot();
  const previous = platformConfigurationState(root, plan);
  previous.acquire();
  previous.begin();
  previous.record("reconcile repository ruleset");
  const journal = path.join(root, journalRelativePath);
  const before = readFileSync(journal);
  const lock = path.join(root, lockRelativePath);
  // Superseded schema bytes are opaque, including the old PID field.
  writeFileSync(lock, '{"schemaVersion":1,"pid":"opaque","token":null}\n', { mode: 0o600 });
  writeFileSync(path.join(root, ".codex/tooling.json"), "invalid provider configuration");
  const environment = new Proxy({}, { get: () => assert.fail("provider environment was read") });
  let providerReads = 0;
  const read = fs.readFileSync;
  fs.readFileSync = (target, ...options) => {
    if (typeof target === "string" && /(?:tooling\.json|git-platform\.json)$/u.test(target)) {
      providerReads += 1;
      assert.fail("provider configuration or credential file was read");
    }
    return read(target, ...options);
  };
  syncBuiltinESMExports();
  let preview;
  try {
    const options = {
      root,
      environment,
      fetchImpl: () => assert.fail("provider API was accessed"),
    };
    preview = await configureActualPlatform({ ...options, ...parseArgs(["--recover-lock"]) });
    assert.equal(preview.ownerStatus, "unknown");
    assert.match(preview.fingerprint, /^[a-f0-9]{64}$/u);
    assert.deepEqual(
      await configureActualPlatform({
        ...options,
        ...parseArgs([
          "--recover-lock",
          "--apply",
          "--confirm-quiescent",
          "--expected-lock-fingerprint",
          preview.fingerprint,
        ]),
      }),
      { applied: true, lockPresent: false, fingerprint: preview.fingerprint },
    );
  } finally {
    fs.readFileSync = read;
    syncBuiltinESMExports();
  }
  assert.equal(providerReads, 0);
  assert.equal(existsSync(path.join(root, ".auth")), false);
  assert.equal(existsSync(lock), false);
  assert.deepEqual(readFileSync(journal), before);
  const resumed = platformConfigurationState(root, plan);
  resumed.acquire();
  assert.deepEqual(resumed.begin(), {
    resumed: true,
    completed: ["reconcile repository ruleset"],
  });
  resumed.complete();
});

test("lock recovery requires both quiescence attestation and the reviewed fingerprint", () => {
  for (const content of [
    "opaque lock bytes",
    JSON.stringify({
      schemaVersion: 2,
      identity: { pid: process.pid, startIdentity: null },
      token: randomUUID(),
    }),
  ]) {
    const { root, lock, journal } = opaqueLockFixture(content);
    const before = readFileSync(journal);
    const { fingerprint } = recoverPlatformConfigurationLock(root);
    for (const [options, expected] of [
      [{ apply: true, expectedFingerprint: fingerprint }, /all platform writers are quiescent/u],
      [{ apply: true, confirmQuiescent: true }, /reviewed expected lock fingerprint/u],
      [{ confirmQuiescent: true }, /explicit --apply/u],
      [{ expectedFingerprint: fingerprint }, /explicit --apply/u],
    ]) {
      assert.throws(() => recoverPlatformConfigurationLock(root, options), expected);
      assert.equal(readFileSync(lock, "utf8"), content);
      assert.deepEqual(readFileSync(journal), before);
    }
  }
});

test("lock recovery rejects changed bytes and identical bytes on a replacement file", () => {
  for (const replacementFile of [false, true]) {
    const { root, lock, journal } = opaqueLockFixture();
    const before = readFileSync(journal);
    const { fingerprint } = recoverPlatformConfigurationLock(root);
    if (replacementFile) {
      writeFileSync(`${lock}.replacement`, readFileSync(lock), { mode: 0o600 });
      renameSync(`${lock}.replacement`, lock);
    } else {
      writeFileSync(lock, "changed opaque lock", { mode: 0o600 });
    }
    const replacement = readFileSync(lock);
    assert.notEqual(recoverPlatformConfigurationLock(root).fingerprint, fingerprint);
    assert.throws(
      () =>
        recoverPlatformConfigurationLock(root, {
          apply: true,
          confirmQuiescent: true,
          expectedFingerprint: fingerprint,
        }),
      /changed after recovery review/u,
    );
    assert.deepEqual(readFileSync(lock), replacement);
    assert.deepEqual(readFileSync(journal), before);
  }
});

test("lock recovery refuses a proven live current owner even with explicit attestation", () => {
  const root = temporaryRoot();
  const store = platformConfigurationState(root, plan);
  store.acquire();
  store.begin();
  const lock = path.join(root, lockRelativePath);
  const journal = path.join(root, journalRelativePath);
  const lockBefore = readFileSync(lock);
  const journalBefore = readFileSync(journal);
  const preview = recoverPlatformConfigurationLock(root);
  assert.equal(preview.ownerStatus, "active");
  assert.throws(
    () =>
      recoverPlatformConfigurationLock(root, {
        apply: true,
        confirmQuiescent: true,
        expectedFingerprint: preview.fingerprint,
      }),
    /refused a live platform configuration owner/u,
  );
  assert.deepEqual(readFileSync(lock), lockBefore);
  assert.deepEqual(readFileSync(journal), journalBefore);
  store.complete();
});

test("lock recovery preserves unsafe links, permissions and oversized records", () => {
  for (const unsafe of ["symlink", "hardlink", "permissions", "oversized"]) {
    const { root, lock, journal } = opaqueLockFixture();
    const journalBefore = readFileSync(journal);
    const { fingerprint } = recoverPlatformConfigurationLock(root);
    const target = path.join(root, "retained-target");
    writeFileSync(target, "retained target bytes", { mode: 0o600 });
    if (unsafe === "symlink" || unsafe === "hardlink") {
      rmSync(lock);
      (unsafe === "symlink" ? symlinkSync : linkSync)(target, lock);
    } else if (unsafe === "permissions") {
      chmodSync(lock, 0o644);
    } else {
      writeFileSync(lock, "x".repeat(4097), { mode: 0o600 });
    }
    const lockBefore = readFileSync(lock);
    for (const options of [
      {},
      { apply: true, confirmQuiescent: true, expectedFingerprint: fingerprint },
    ]) {
      assert.throws(
        () => recoverPlatformConfigurationLock(root, options),
        /unsafe|malformed|hardlink|oversized/iu,
      );
      assert.deepEqual(readFileSync(lock), lockBefore);
      assert.deepEqual(readFileSync(journal), journalBefore);
      assert.equal(readFileSync(target, "utf8"), "retained target bytes");
    }
  }
});

test("platform CLI rejects incomplete or misplaced recovery arguments", async () => {
  const fingerprint = "a".repeat(64);
  assert.throws(() => parseArgs(["--confirm-quiescent"]), /require --recover-lock/u);
  assert.throws(
    () => parseArgs(["--expected-lock-fingerprint", fingerprint]),
    /require --recover-lock/u,
  );
  for (const args of [
    ["--expected-lock-fingerprint"],
    ["--expected-lock-fingerprint", "invalid"],
    ["--expected-lock-fingerprint", fingerprint, "--expected-lock-fingerprint", fingerprint],
  ]) {
    assert.throws(() => parseArgs(["--recover-lock", ...args]), /once as a SHA-256 value/u);
  }
  await assert.rejects(
    configureActualPlatform({ root: temporaryRoot(), confirmQuiescent: true }),
    /require --recover-lock/u,
  );
});
