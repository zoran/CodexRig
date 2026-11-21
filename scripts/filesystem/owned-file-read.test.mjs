/** Exercises owned directory initialization, bounded sibling reads and parent replacement refusal. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  openOwnedDirectoryBinding,
  closeOwnedDirectoryBinding,
  ensureOwnedPrivateDirectory,
  readStableOwnedFile,
  readStableOwnedFiles,
} from "./owned-path-safety.mjs";

test("concurrent initialization accepts an existing private directory from its peer", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owned-directory-create-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "runtime");
  const result = ensureOwnedPrivateDirectory(root, directory, "runtime", {
    testHooks: { beforeDirectoryCreate: () => fs.mkdirSync(directory, { mode: 0o700 }) },
  });
  assert.deepEqual(result, { created: false, path: directory });
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owned-file-read-"));
  const directory = path.join(root, "records");
  fs.mkdirSync(directory, { mode: 0o700 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const names = Array.from({ length: 32 }, (_, i) => `${i}.json`);
  for (const name of names) fs.writeFileSync(path.join(directory, name), name, { mode: 0o600 });
  const binding = openOwnedDirectoryBinding(root, directory, "fixture");
  t.after(() => closeOwnedDirectoryBinding(binding));
  return { root, directory, names, binding };
}

test("batch reads retain exact bytes with bounded ancestry work", (t) => {
  const f = fixture(t);
  const original = fs.realpathSync.native;
  let calls = 0;
  fs.realpathSync.native = (...args) => {
    calls++;
    return original(...args);
  };
  try {
    const individual = f.names.map((name) => readStableOwnedFile(f.binding, name, "fixture"));
    const repeated = calls;
    calls = 0;
    const batch = readStableOwnedFiles(f.binding, f.names, "fixture", { maximumBytes: 100 });
    assert.deepEqual(
      batch.map((row) => row.buffer),
      individual.map((row) => row.buffer),
    );
    assert(calls * 16 <= repeated, `ancestry calls: batch ${calls}, individual ${repeated}`);
  } finally {
    fs.realpathSync.native = original;
  }
});

test("batch reads refuse traversal, links, oversize and oversized batches", (t) => {
  const f = fixture(t);
  assert.deepEqual(readStableOwnedFiles(f.binding, ["absent"], "fixture", { optional: true }), [
    null,
  ]);
  assert.throws(() => readStableOwnedFiles(f.binding, ["absent"], "fixture"), { code: "ENOENT" });
  fs.symlinkSync(path.join(f.directory, f.names[0]), path.join(f.directory, "linked"));
  fs.linkSync(path.join(f.directory, f.names[1]), path.join(f.directory, "hardlinked"));
  for (const names of [["../outside"], ["linked"], ["hardlinked"], Array(65).fill(f.names[0])])
    assert.throws(() => readStableOwnedFiles(f.binding, names, "fixture"));
  assert.throws(
    () => readStableOwnedFiles(f.binding, [f.names[0]], "fixture", { maximumBytes: 1 }),
    /oversized/u,
  );
});

test("batch reads never return data after their logical parent is replaced", (t) => {
  const f = fixture(t);
  const original = fs.readFileSync;
  let replaced = false;
  fs.readFileSync = (...args) => {
    const result = original(...args);
    if (!replaced) {
      replaced = true;
      fs.renameSync(f.directory, `${f.directory}-retained`);
      fs.mkdirSync(f.directory, { mode: 0o700 });
    }
    return result;
  };
  syncBuiltinESMExports();
  try {
    assert.throws(() => readStableOwnedFiles(f.binding, f.names, "fixture"), /identity|rebind/u);
  } finally {
    fs.readFileSync = original;
    syncBuiltinESMExports();
  }
});
