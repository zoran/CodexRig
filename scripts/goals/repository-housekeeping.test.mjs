/** Verifies repository housekeeping behavior for the goal closure and repository housekeeping boundary. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  deliveryConfigurationPath,
  initialDeliveryConfiguration,
  parseDeliveryConfiguration,
} from "../contracts/delivery-configuration.mjs";
import {
  deliveryManifestEndMarker,
  deliveryManifestStartMarker,
  deliveryReconciliationPlan,
} from "../docs/delivery-manifest.mjs";
import {
  applyHousekeepingWrites,
  recoverInterruptedHousekeepingWrites,
} from "./repository-housekeeping.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "repository-housekeeping-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  write(root, "src/.gitkeep", "");
  write(root, deliveryConfigurationPath, initialDeliveryConfiguration());
  write(
    root,
    "docs/project.md",
    `# Project Manifest

## System Shape

${deliveryManifestStartMarker}
- Configured delivery default: \`dev\`.
- Integrated delivery environments: none.
- Delivery inventory owner: \`config/delivery.json\`.
${deliveryManifestEndMarker}

### Active Module Inventory

No active product modules.

## Maintenance
`,
  );
  return root;
}

function write(root, relativePath, content) {
  const target = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

test("housekeeping detects and atomically projects newly integrated staging and prod targets", (t) => {
  const root = fixture(t);
  write(root, "infra/staging/main.tf", "terraform {}\n");
  write(root, ".github/workflows/release.yml", "jobs:\n  deploy:\n    environment: production\n");
  const relativePaths = [
    ".github/workflows/release.yml",
    "config/delivery.json",
    "docs/project.md",
    "infra/staging/main.tf",
    "src/.gitkeep",
  ];

  const plan = deliveryReconciliationPlan({ root, relativePaths });
  assert.deepEqual(plan.blockingFindings, []);
  assert.equal(plan.writes.length, 2);
  assert.match(plan.driftFindings.join("\n"), /delivery evidence/u);
  applyHousekeepingWrites({ root, writes: plan.writes });

  const configuration = parseDeliveryConfiguration(
    readFileSync(path.join(root, deliveryConfigurationPath), "utf8"),
  );
  assert.deepEqual(configuration.detectedTargets, [
    { evidence: ["infra/staging/main.tf"], target: "staging" },
    { evidence: [".github/workflows/release.yml"], target: "prod" },
  ]);
  assert.match(
    readFileSync(path.join(root, "docs/project.md"), "utf8"),
    /Integrated delivery environments: `staging`, `prod`\./u,
  );
  assert.deepEqual(deliveryReconciliationPlan({ root, relativePaths }).driftFindings, []);
});

test("declared external targets are preserved while stale detected evidence is removed", (t) => {
  const root = fixture(t);
  write(
    root,
    deliveryConfigurationPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        defaultTarget: "dev",
        declaredTargets: ["prod"],
        detectedTargets: [{ evidence: ["infra/staging/main.tf"], target: "staging" }],
      },
      null,
      2,
    )}\n`,
  );
  const relativePaths = [deliveryConfigurationPath, "docs/project.md", "src/.gitkeep"];
  const plan = deliveryReconciliationPlan({ root, relativePaths });
  assert.deepEqual(plan.blockingFindings, []);
  applyHousekeepingWrites({ root, writes: plan.writes });
  const configuration = parseDeliveryConfiguration(
    readFileSync(path.join(root, deliveryConfigurationPath), "utf8"),
  );
  assert.deepEqual(configuration.declaredTargets, ["prod"]);
  assert.deepEqual(configuration.detectedTargets, []);
  assert.match(readFileSync(path.join(root, "docs/project.md"), "utf8"), /`prod`/u);
});

test("ambiguous delivery hints fail closed until their target is explicitly classified", (t) => {
  const root = fixture(t);
  write(root, "ops/check-prod.sh", "#!/bin/sh\n");
  const relativePaths = [
    deliveryConfigurationPath,
    "docs/project.md",
    "ops/check-prod.sh",
    "src/.gitkeep",
  ];
  const plan = deliveryReconciliationPlan({ root, relativePaths });
  assert.match(plan.blockingFindings.join("\n"), /may describe prod delivery/u);

  write(
    root,
    deliveryConfigurationPath,
    initialDeliveryConfiguration().replace('"declaredTargets": []', '"declaredTargets": ["prod"]'),
  );
  assert.deepEqual(deliveryReconciliationPlan({ root, relativePaths }).blockingFindings, []);
});

test("the neutral framework never receives a generated delivery configuration", (t) => {
  const root = fixture(t);
  write(root, ".agents/skills/create-project-from-framework/SKILL.md", "# Generator\n");
  const plan = deliveryReconciliationPlan({
    root,
    relativePaths: [
      ".agents/skills/create-project-from-framework/SKILL.md",
      deliveryConfigurationPath,
      "docs/project.md",
      "src/.gitkeep",
    ],
  });
  assert.match(plan.blockingFindings.join("\n"), /neutral source framework/u);
});

function housekeepingTemporaryPaths(root) {
  const matches = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.name.includes("codexrig-housekeeping")) matches.push(target);
    }
  }
  return matches;
}

function treeSnapshot(root) {
  const records = [];
  const pending = [{ absolute: root, relative: "" }];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current.absolute, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const absolute = path.join(current.absolute, entry.name);
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      const stats = lstatSync(absolute);
      if (entry.isDirectory()) {
        records.push({ mode: stats.mode & 0o777, path: `${relative}/`, type: "directory" });
        pending.push({ absolute, relative });
      } else {
        records.push({
          content: readFileSync(absolute).toString("base64"),
          mode: stats.mode & 0o777,
          path: relative,
          type: "file",
        });
      }
    }
  }
  return records.sort((left, right) => left.path.localeCompare(right.path));
}

function crashChild({ crashIndex = null, hookName, root, writes }) {
  const moduleUrl = new URL("./repository-housekeeping.mjs", import.meta.url).href;
  const childSource = `
    import { applyHousekeepingWrites } from ${JSON.stringify(moduleUrl)};
    const hookName = ${JSON.stringify(hookName)};
    applyHousekeepingWrites({
      root: ${JSON.stringify(root)},
      writes: ${JSON.stringify(writes)},
      testHooks: {
        [hookName](detail = {}) {
          if (${JSON.stringify(crashIndex)} === null || detail.index === ${JSON.stringify(crashIndex)}) {
            process.kill(process.pid, "SIGKILL");
          }
        },
      },
    });
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", childSource], {
    cwd: root,
    encoding: "utf8",
  });
}

function recoveryCrashChild({ hookName, root }) {
  const moduleUrl = new URL("./repository-housekeeping.mjs", import.meta.url).href;
  const childSource = `
    import { recoverInterruptedHousekeepingWrites } from ${JSON.stringify(moduleUrl)};
    const hookName = ${JSON.stringify(hookName)};
    recoverInterruptedHousekeepingWrites(${JSON.stringify(root)}, {
      testHooks: {
        [hookName]() {
          process.kill(process.pid, "SIGKILL");
        },
      },
    });
  `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", childSource], {
    cwd: root,
    encoding: "utf8",
  });
}

test("read-only housekeeping planning preserves every repository byte and mode", (t) => {
  const root = fixture(t);
  write(root, "infra/staging/main.tf", "terraform {}\n");
  chmodSync(path.join(root, "docs/project.md"), 0o640);
  const before = treeSnapshot(root);

  const plan = deliveryReconciliationPlan({
    root,
    relativePaths: [
      deliveryConfigurationPath,
      "docs/project.md",
      "infra/staging/main.tf",
      "src/.gitkeep",
    ],
  });
  assert.equal(plan.writes.length, 2);
  assert.equal(recoverInterruptedHousekeepingWrites(root), false);

  assert.deepEqual(treeSnapshot(root), before);
});

test("housekeeping bounds journal scope and preserves exact modes under a restrictive umask", (t) => {
  const root = fixture(t);
  const excessiveWrites = Array.from({ length: 65 }, (_, index) => ({
    after: "after\n",
    before: "",
    relativePath: `bounded-${index}.txt`,
  }));
  assert.throws(
    () => applyHousekeepingWrites({ root, writes: excessiveWrites }),
    /limited to 64 writes/u,
  );
  assert.equal(existsSync(path.join(root, ".project-state/repository-housekeeping")), false);

  const relativePath = "exact-mode.txt";
  write(root, relativePath, "before\n");
  chmodSync(path.join(root, relativePath), 0o644);
  const moduleUrl = new URL("./repository-housekeeping.mjs", import.meta.url).href;
  const childSource = `
    import { applyHousekeepingWrites } from ${JSON.stringify(moduleUrl)};
    process.umask(0o077);
    applyHousekeepingWrites({
      root: ${JSON.stringify(root)},
      writes: [{ after: "after\\n", before: "before\\n", relativePath: ${JSON.stringify(relativePath)} }],
    });
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", childSource], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(readFileSync(path.join(root, relativePath), "utf8"), "after\n");
  assert.equal(lstatSync(path.join(root, relativePath)).mode & 0o777, 0o644);
});

test(
  "housekeeping refuses a dangling target symlink without replacing repository state",
  { skip: process.platform === "win32" },
  (t) => {
    const root = fixture(t);
    const target = path.join(root, "dangling.txt");
    symlinkSync("missing.txt", target);

    assert.throws(
      () =>
        applyHousekeepingWrites({
          root,
          writes: [{ after: "after\n", before: "", relativePath: "dangling.txt" }],
        }),
      /malformed|non-symlink regular file/u,
    );
    assert.equal(lstatSync(target).isSymbolicLink(), true);
    assert.equal(existsSync(path.join(root, ".project-state/repository-housekeeping")), false);
  },
);

test(
  "housekeeping refuses a logical target-parent swap at the bound rename syscall",
  { skip: process.platform !== "linux" },
  (t) => {
    const root = fixture(t);
    const outside = mkdtempSync(path.join(os.tmpdir(), "repository-housekeeping-outside-"));
    t.after(() => rmSync(outside, { force: true, recursive: true }));
    const parent = path.join(root, "nested");
    const parked = path.join(root, "nested-owned");
    write(root, "nested/target.txt", "before\n");
    writeFileSync(path.join(outside, "target.txt"), "outside\n", "utf8");
    const writes = [{ after: "after\n", before: "before\n", relativePath: "nested/target.txt" }];

    assert.throws(
      () =>
        applyHousekeepingWrites({
          root,
          writes,
          testHooks: {
            beforeBoundTargetRename() {
              renameSync(parent, parked);
              symlinkSync(outside, parent, "dir");
            },
          },
        }),
      /durable recovery stopped safely|logical directory rebind|unsafe parent/u,
    );
    assert.equal(readFileSync(path.join(outside, "target.txt"), "utf8"), "outside\n");
    assert.equal(readFileSync(path.join(parked, "target.txt"), "utf8"), "before\n");
    assert.equal(
      existsSync(path.join(root, ".project-state/repository-housekeeping/journal.json")),
      true,
    );

    unlinkSync(parent);
    renameSync(parked, parent);
    assert.equal(recoverInterruptedHousekeepingWrites(root), true);
    assert.equal(readFileSync(path.join(parent, "target.txt"), "utf8"), "before\n");
  },
);

test(
  "recovery refuses a logical parent swap at the bound target-removal syscall",
  { skip: process.platform !== "linux" },
  (t) => {
    const root = fixture(t);
    const outside = mkdtempSync(path.join(os.tmpdir(), "repository-recovery-outside-"));
    t.after(() => rmSync(outside, { force: true, recursive: true }));
    const parent = path.join(root, "nested");
    const parked = path.join(root, "nested-owned");
    write(root, "nested/.keep", "");
    write(root, "other.txt", "before-other\n");
    writeFileSync(path.join(outside, "new.txt"), "outside\n", "utf8");
    const writes = [
      { after: "after-new\n", before: "", relativePath: "nested/new.txt" },
      {
        after: "after-other\n",
        before: "before-other\n",
        relativePath: "other.txt",
      },
    ];
    const child = crashChild({
      crashIndex: 0,
      hookName: "afterTargetRename",
      root,
      writes,
    });
    assert.equal(child.signal, "SIGKILL", child.stderr);

    assert.throws(
      () =>
        recoverInterruptedHousekeepingWrites(root, {
          testHooks: {
            beforeRecoveryTargetRemove() {
              renameSync(parent, parked);
              symlinkSync(outside, parent, "dir");
            },
          },
        }),
      /logical directory rebind|unsafe parent/u,
    );
    assert.equal(readFileSync(path.join(outside, "new.txt"), "utf8"), "outside\n");
    assert.equal(readFileSync(path.join(parked, "new.txt"), "utf8"), "after-new\n");

    unlinkSync(parent);
    renameSync(parked, parent);
    assert.equal(recoverInterruptedHousekeepingWrites(root), true);
    assert.equal(existsSync(path.join(parent, "new.txt")), false);
    assert.equal(readFileSync(path.join(root, "other.txt"), "utf8"), "before-other\n");
  },
);

test(
  "durable housekeeping recovers every journal, temporary, rename, and finalize crash boundary",
  { skip: process.platform === "win32" },
  (t) => {
    const crashCases = [
      { hookName: "afterJournalTemporaryWrite", outcome: "before" },
      { hookName: "afterJournalLink", outcome: "before" },
      { hookName: "afterJournalPersist", outcome: "before" },
      ...["afterTargetTemporaryWrite", "afterTargetRename", "afterTargetDirectorySync"].flatMap(
        (hookName) =>
          [0, 1, 2].map((crashIndex) => ({
            crashIndex,
            hookName,
            outcome:
              crashIndex === 2 && hookName !== "afterTargetTemporaryWrite" ? "after" : "before",
          })),
      ),
      { hookName: "beforeJournalRemoval", outcome: "after" },
      { hookName: "afterJournalRemoveBeforeSync", outcome: "after" },
    ];
    for (const [caseIndex, crashCase] of crashCases.entries()) {
      const root = mkdtempSync(
        path.join(os.tmpdir(), `repository-housekeeping-crash-${caseIndex}-`),
      );
      t.after(() => rmSync(root, { force: true, recursive: true }));
      const writes = ["one.txt", "nested/two.txt", "three.txt"].map((relativePath, index) => {
        const before = `before-${index}\n`;
        write(root, relativePath, before);
        return { after: `after-${index}\n`, before, relativePath };
      });
      chmodSync(path.join(root, "nested/two.txt"), 0o600);
      const child = crashChild({ root, writes, ...crashCase });
      assert.equal(child.signal, "SIGKILL", child.stderr);
      assert.equal(existsSync(path.join(root, ".project-state/repository-housekeeping")), true);
      assert.equal(recoverInterruptedHousekeepingWrites(root), true);
      for (const [index, writePlan] of writes.entries()) {
        assert.equal(
          readFileSync(path.join(root, writePlan.relativePath), "utf8"),
          `${crashCase.outcome}-${index}\n`,
        );
      }
      assert.equal(lstatSync(path.join(root, "nested/two.txt")).mode & 0o777, 0o600);
      assert.equal(housekeepingTemporaryPaths(root).length, 0);
      assert.equal(existsSync(path.join(root, ".project-state/repository-housekeeping")), false);

      if (crashCase.outcome === "before") applyHousekeepingWrites({ root, writes });
      for (const [index, writePlan] of writes.entries()) {
        assert.equal(
          readFileSync(path.join(root, writePlan.relativePath), "utf8"),
          `after-${index}\n`,
        );
      }
      assert.equal(housekeepingTemporaryPaths(root).length, 0);
    }
  },
);

test(
  "recovery remains restartable when terminated across publication and target unlink boundaries",
  { skip: process.platform === "win32" },
  (t) => {
    {
      const root = fixture(t);
      const before = readFileSync(path.join(root, "docs/project.md"), "utf8");
      const writes = [{ after: `${before}\n`, before, relativePath: "docs/project.md" }];
      const applyCrash = crashChild({ hookName: "afterJournalTemporaryWrite", root, writes });
      assert.equal(applyCrash.signal, "SIGKILL", applyCrash.stderr);

      const recoveryCrash = recoveryCrashChild({
        hookName: "afterPublicationTemporaryRemoveBeforeSync",
        root,
      });
      assert.equal(recoveryCrash.signal, "SIGKILL", recoveryCrash.stderr);
      assert.equal(recoverInterruptedHousekeepingWrites(root), true);
      assert.equal(readFileSync(path.join(root, "docs/project.md"), "utf8"), before);
      assert.equal(existsSync(path.join(root, ".project-state/repository-housekeeping")), false);
    }

    {
      const root = fixture(t);
      write(root, "nested/.keep", "");
      write(root, "other.txt", "before-other\n");
      const writes = [
        { after: "after-new\n", before: "", relativePath: "nested/new.txt" },
        {
          after: "after-other\n",
          before: "before-other\n",
          relativePath: "other.txt",
        },
      ];
      const applyCrash = crashChild({
        crashIndex: 0,
        hookName: "afterTargetRename",
        root,
        writes,
      });
      assert.equal(applyCrash.signal, "SIGKILL", applyCrash.stderr);

      const recoveryCrash = recoveryCrashChild({
        hookName: "afterRecoveryTargetRemoveBeforeSync",
        root,
      });
      assert.equal(recoveryCrash.signal, "SIGKILL", recoveryCrash.stderr);
      assert.equal(existsSync(path.join(root, "nested/new.txt")), false);
      assert.equal(recoverInterruptedHousekeepingWrites(root), true);
      assert.equal(readFileSync(path.join(root, "other.txt"), "utf8"), "before-other\n");
      assert.equal(housekeepingTemporaryPaths(root).length, 0);
    }
  },
);

test(
  "recovery preserves unrelated concurrent target and temporary changes for manual resolution",
  { skip: process.platform === "win32" },
  (t) => {
    for (const tamperTemporary of [false, true]) {
      const root = mkdtempSync(
        path.join(os.tmpdir(), `repository-housekeeping-tamper-${Number(tamperTemporary)}-`),
      );
      t.after(() => rmSync(root, { force: true, recursive: true }));
      const writes = ["one.txt", "two.txt"].map((relativePath, index) => {
        const before = `before-${index}\n`;
        write(root, relativePath, before);
        return { after: `after-${index}\n`, before, relativePath };
      });
      const child = crashChild({
        crashIndex: tamperTemporary ? 1 : 0,
        hookName: tamperTemporary ? "afterTargetTemporaryWrite" : "afterTargetRename",
        root,
        writes,
      });
      assert.equal(child.signal, "SIGKILL", child.stderr);
      let tamperedPath;
      if (tamperTemporary) {
        tamperedPath = housekeepingTemporaryPaths(root).find((candidate) =>
          candidate.endsWith("-1.tmp"),
        );
        assert.ok(tamperedPath);
      } else {
        tamperedPath = path.join(root, "two.txt");
      }
      writeFileSync(tamperedPath, "unrelated\n", "utf8");

      assert.throws(
        () => recoverInterruptedHousekeepingWrites(root),
        /unrelated change|temporary .*unrelated/u,
      );
      assert.equal(readFileSync(tamperedPath, "utf8"), "unrelated\n");
      assert.equal(
        existsSync(path.join(root, ".project-state/repository-housekeeping/journal.json")),
        true,
      );
    }
  },
);

test(
  "a live housekeeping owner cannot be mistaken for recoverable stale state",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = fixture(t);
    const readyPath = path.join(root, "owner-ready");
    const moduleUrl = new URL("./repository-housekeeping.mjs", import.meta.url).href;
    const before = readFileSync(path.join(root, "docs/project.md"), "utf8");
    const writes = [{ after: `${before}\n`, before, relativePath: "docs/project.md" }];
    const childSource = `
      import { writeFileSync } from "node:fs";
      import { applyHousekeepingWrites } from ${JSON.stringify(moduleUrl)};
      applyHousekeepingWrites({
        root: ${JSON.stringify(root)},
        writes: ${JSON.stringify(writes)},
        testHooks: {
          afterJournalPersist() {
            writeFileSync(${JSON.stringify(readyPath)}, ${JSON.stringify("ready\n")}, "utf8");
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
          },
        },
      });
    `;
    const child = spawn(process.execPath, ["--input-type=module", "--eval", childSource], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let childOutput = "";
    child.stdout.on("data", (chunk) => {
      childOutput += chunk;
    });
    child.stderr.on("data", (chunk) => {
      childOutput += chunk;
    });
    const exit = once(child, "exit");
    for (let attempts = 0; attempts < 100 && !existsSync(readyPath); attempts += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(existsSync(readyPath), true, childOutput);

    assert.throws(
      () => applyHousekeepingWrites({ root, writes }),
      /Another repository housekeeping transaction is active/u,
    );
    assert.equal(readFileSync(path.join(root, "docs/project.md"), "utf8"), before);

    child.kill("SIGKILL");
    const [, signal] = await exit;
    assert.equal(signal, "SIGKILL");
    assert.equal(recoverInterruptedHousekeepingWrites(root), true);
    assert.equal(readFileSync(path.join(root, "docs/project.md"), "utf8"), before);
  },
);
