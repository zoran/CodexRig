/** Guards the portable pnpm graph across native locking, publication and generated consumers. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { toolingRoot } from "../filesystem/repository-files.mjs";
import { readToolchainConfiguration } from "../contracts/toolchain-configuration.mjs";
import {
  pnpmGraphPaths,
  projectPnpmToolchainGraph,
  readPnpmToolchainGraph,
} from "./pnpm-toolchain-graph.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "portable-pnpm-graph-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of [".codex/mise.lock", ...pnpmGraphPaths]) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), readFileSync(path.join(toolingRoot, file)));
  }
  const lock = readFileSync(path.join(root, ".codex/mise.lock"), "utf8");
  const version = readToolchainConfiguration().stable.pnpm.version;
  return { root, lock, version };
}

test("portable graph rejects missing, altered, ambiguous and escaping publication inputs", (t) => {
  const { root, lock, version } = fixture(t);
  assert.ok(readPnpmToolchainGraph(root, lock, version).digest);
  for (const replacement of ["../../private", ".mise/locks/pnpm/other", ".mise/locks/pnpm/.."])
    assert.throws(() =>
      readPnpmToolchainGraph(root, lock.replace(".mise/locks/pnpm/current", replacement), version),
    );
  const graph = path.join(root, pnpmGraphPaths[1]);
  const original = readFileSync(graph, "utf8");
  writeFileSync(graph, original + "# changed\n");
  assert.throws(() => readPnpmToolchainGraph(root, lock, version), /integrity/u);
  writeFileSync(graph, original.replaceAll("\n", "\r\n"));
  assert.ok(readPnpmToolchainGraph(root, lock, version).digest);
  writeFileSync(
    path.join(root, pnpmGraphPaths[0]),
    JSON.stringify({
      private: true,
      dependencies: { pnpm: version },
      scripts: { install: "payload" },
    }),
  );
  assert.throws(() => readPnpmToolchainGraph(root, lock, version), /manifest/u);
  rmSync(graph);
  assert.throws(() => readPnpmToolchainGraph(root, lock, version));
});

test("native graph projection carries the same bytes and integrity into the canonical transaction", (t) => {
  const { root, lock, version } = fixture(t);
  const native = `.mise/locks/pnpm/${version}`;
  for (const file of pnpmGraphPaths) {
    const destination = path.join(root, ".codex", native, path.basename(file));
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(path.join(root, file)));
    rmSync(path.join(root, file));
  }
  writeFileSync(
    path.join(root, ".codex/mise.lock"),
    lock.replace(".mise/locks/pnpm/current", native),
  );
  projectPnpmToolchainGraph(root, version);
  assert.equal(readFileSync(path.join(root, ".codex/mise.lock"), "utf8"), lock);
  for (const file of pnpmGraphPaths)
    assert.deepEqual(
      readFileSync(path.join(root, file)),
      readFileSync(path.join(toolingRoot, file)),
    );
  projectPnpmToolchainGraph(root, version);
  assert.equal(readFileSync(path.join(root, ".codex/mise.lock"), "utf8"), lock);
});
