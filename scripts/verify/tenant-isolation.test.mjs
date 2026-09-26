/** Verifies tenant isolation ownership, existing test selection and an assembled two-account flow. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  initialTenancyConfiguration,
  serializeTenancyConfiguration,
  tenancyConfigurationFindings,
} from "../contracts/tenancy-configuration.mjs";
import {
  prepareProjectToolDirectories,
  projectToolEnvironment,
} from "../repository/project-tool-environment.mjs";
import { readVerificationConfiguration } from "./verification-configuration.mjs";
import { tenantIsolationProjectFindings } from "./tenant-isolation.mjs";

const boundary = {
  root: "src/account-boundary/trust",
  resolver: "src/account-boundary/trust/resolve.mjs",
  policy: "src/account-boundary/trust/policy.mjs",
  publicContract: "src/account-boundary/trust/public.mjs",
};
const evidence = [{ command: "product-contracts", tests: ["test/isolation.mjs"] }];
const roots = ["src/account-boundary", "src/storage", "src/format"];

function manifest(moduleRoots = roots) {
  return (
    "# Project Manifest\n\n### Active Module Inventory\n\n" +
    moduleRoots
      .map(
        (root, index) => `#### Module ${index + 1}

- Root: \`${root}\`
- Responsibility: Owns the ${root} behavior in the executable fixture.
- Runtime and technology: JavaScript on Node.js ESM.
- Public contract: Explicit exported source contracts.
- Private internals: Remaining source below this root.
- Owned data and migrations: Account storage or stateless values as classified by the policy.
- Tenant isolation: The module policy in config/tenancy.json owns classification and evidence.
- Allowed dependencies: Explicit fixture ports.
- Focused verifier: \`node --test test/isolation.mjs\`
- Steward: Fixture maintainer.
`,
      )
      .join("\n")
  );
}

function fixture(t, { empty = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "tenancy-ownership-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  write("package.json", JSON.stringify({ name: "tenancy-fixture", private: true, type: "module" }));
  write("pnpm-workspace.yaml", "packages: []\n");
  write("src/.gitkeep", "");
  if (empty) {
    write("config/tenancy.json", initialTenancyConfiguration());
    return { root, write };
  }
  const configuration = JSON.parse(
    serializeTenancyConfiguration({
      tenantContext: {
        key: "accountId",
        resolutionStrategy: "single-trusted-source",
        trustedSources: ["authenticated-membership"],
      },
      contextBoundaries: [boundary],
      modulePolicies: roots.map((module, index) => ({
        module,
        scope: index === 2 ? "tenant-independent" : "tenant-owned",
        rationale:
          index === 2
            ? "Pure value formatting has no account state or access decisions."
            : "Trusted account context controls the module's resource operations.",
        enforcement:
          index === 2 ? [] : [index === 0 ? boundary.resolver : "src/storage/database.mjs"],
        evidence: index === 2 ? [] : evidence,
      })),
    }),
  );
  const verification = {
    schemaVersion: 1,
    prePushChecks: [],
    risks: [],
    testConsumers: {},
    exactConsumers: {},
    ownedCategories: {},
    commands: [
      {
        key: "product-contracts",
        label: "existing product contracts",
        executable: "$node",
        args: ["--test", "test/isolation.mjs"],
        phase: "broad",
        artifactOwners: [],
        coveredTestPaths: ["test/isolation.mjs"],
      },
    ],
  };
  const save = () => {
    write("config/tenancy.json", JSON.stringify(configuration));
    write(".codex/verification.json", JSON.stringify(verification));
  };
  save();
  write("docs/project.md", manifest());
  write(
    boundary.resolver,
    `const memberships = new WeakSet();
const contexts = new WeakSet();
export function admittedMembership(accountId) { const membership = Object.freeze({ accountId }); memberships.add(membership); return membership; }
export function resolveContext(membership) { if (!memberships.has(membership)) throw new Error("Untrusted membership"); const context = Object.freeze({ accountId: membership.accountId }); contexts.add(context); return context; }
export function requireContext(context) { if (!contexts.has(context)) throw new Error("Untrusted context"); }
`,
  );
  write(
    boundary.policy,
    `export function requireOwner(context, row) { if (context.accountId !== row.accountId) throw new Error("Forbidden"); }
`,
  );
  write(
    boundary.publicContract,
    'export { requireContext, resolveContext } from "./resolve.mjs"; export { requireOwner } from "./policy.mjs";\n',
  );
  write("src/storage/query.mjs", "export const rowById = (rows, id) => rows.get(id);\n");
  write(
    "src/storage/database.mjs",
    `import { requireContext, requireOwner } from "../account-boundary/trust/public.mjs";
import { rowById } from "./query.mjs";
const rows = new Map();
export function openDatabase(context) { requireContext(context); return {
  write(id, value) { const existing = rowById(rows, id); if (existing) requireOwner(context, existing); rows.set(id, { accountId: context.accountId, value }); },
  read(id) { const row = rowById(rows, id); if (!row) throw new Error("Missing"); requireOwner(context, row); return row.value; },
}; }
`,
  );
  write("src/format/value.mjs", "export const formatValue = (value) => String(value);\n");
  write(
    "test/isolation.mjs",
    `import assert from "node:assert/strict";
import test from "node:test";
import { admittedMembership } from "../src/account-boundary/trust/resolve.mjs";
import { resolveContext } from "../src/account-boundary/trust/public.mjs";
import { openDatabase } from "../src/storage/database.mjs";
test("bound handles preserve independent accounts", () => {
  assert.throws(() => resolveContext({ accountId: "account-a" }));
  assert.throws(() => openDatabase({ accountId: "account-a" }));
  const first = openDatabase(resolveContext(admittedMembership("account-a")));
  const second = openDatabase(resolveContext(admittedMembership("account-b")));
  first.write("record", "original");
  assert.throws(() => second.read("record"));
  assert.throws(() => second.write("record", "changed"));
  assert.equal(first.read("record"), "original");
});
`,
  );
  return { root, write, configuration, verification, save };
}

test("new projects retain truthful pending ownership and reject the retired schema", (t) => {
  const project = fixture(t, { empty: true });
  assert.deepEqual(tenantIsolationProjectFindings(project), []);
  const old = JSON.parse(initialTenancyConfiguration());
  old.schemaVersion = 1;
  assert.ok(
    tenancyConfigurationFindings(JSON.stringify(old)).some((finding) =>
      finding.includes("schemaVersion"),
    ),
  );
  project.write("src/product.mjs", "export const value = 1;\n");
  assert.ok(
    tenantIsolationProjectFindings(project).some((finding) =>
      finding.includes("must be configured"),
    ),
  );
});

test("bound storage, marker-free queries and stateless modules reuse one real negative suite", (t) => {
  const project = fixture(t);
  assert.deepEqual(tenantIsolationProjectFindings(project), []);
  const commands = readVerificationConfiguration(project.root).commands;
  assert.equal(commands.length, 1, "policy references must not add duplicate test executions");
  prepareProjectToolDirectories(project.root);
  const execute = () =>
    spawnSync(process.execPath, commands[0].args, {
      cwd: project.root,
      env: projectToolEnvironment({ root: project.root }),
      encoding: "utf8",
    });
  const passed = execute();
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  // Static owner selection is not security proof: the same selected suite catches broken behavior.
  project.write(boundary.policy, "export function requireOwner() {}\n");
  assert.deepEqual(tenantIsolationProjectFindings(project), []);
  assert.notEqual(execute().status, 0);
});

test("new or retired modules, missing enforcement and stale evidence references fail admission", (t) => {
  const project = fixture(t);
  project.write("src/new-feature/index.mjs", "export const feature = 1;\n");
  project.write("docs/project.md", manifest([...roots, "src/new-feature"]));
  assert.ok(
    tenantIsolationProjectFindings(project).some((finding) =>
      finding.includes("requires a reviewed tenancy module policy"),
    ),
  );
  project.configuration.modulePolicies[0].enforcement = ["src/account-boundary/missing.mjs"];
  project.configuration.modulePolicies[0].evidence = [
    { command: "removed-check", tests: ["test/absent.mjs"] },
  ];
  project.configuration.modulePolicies.push({
    module: "src/retired",
    scope: "tenant-independent",
    rationale: "Former pure module.",
    enforcement: [],
    evidence: [],
  });
  project.save();
  const findings = tenantIsolationProjectFindings(project);
  assert.ok(findings.some((finding) => finding.includes("missing.mjs must resolve")));
  assert.ok(findings.some((finding) => finding.includes("unselected full-verification command")));
  assert.ok(findings.some((finding) => finding.includes("absent.mjs must resolve")));
  assert.ok(
    findings.some((finding) => finding.includes("missing or non-product module src/retired")),
  );
});

test("declared test paths must belong to the selected existing command", (t) => {
  const project = fixture(t);
  project.verification.commands[0].args = ["test/unrelated.mjs"];
  project.verification.commands[0].coveredTestPaths = [];
  project.save();
  assert.ok(
    tenantIsolationProjectFindings(project).some((finding) =>
      finding.includes("not covered by its existing verifier"),
    ),
  );
});

test("the ordinary workspace test lifecycle can own tenancy evidence without a special script", (t) => {
  const project = fixture(t);
  project.write(
    "package.json",
    JSON.stringify({
      name: "tenancy-fixture",
      type: "module",
      scripts: { test: "node --test test/isolation.mjs" },
    }),
  );
  for (const policy of project.configuration.modulePolicies) {
    for (const entry of policy.evidence) entry.command = "workspace:test";
  }
  project.save();
  assert.deepEqual(tenantIsolationProjectFindings(project), []);
});

test("configured context internals stay private through direct and aliased imports", (t) => {
  const project = fixture(t);
  project.write(
    "src/format/direct.mjs",
    'import { requireOwner } from "../account-boundary/trust/policy.mjs";\n',
  );
  project.write(
    "package.json",
    JSON.stringify({
      name: "tenancy-fixture",
      type: "module",
      imports: { "#private-context": "./src/account-boundary/trust/resolve.mjs" },
    }),
  );
  project.write("src/format/aliased.mjs", 'import { resolveContext } from "#private-context";\n');
  const findings = tenantIsolationProjectFindings(project);
  for (const file of ["direct.mjs", "aliased.mjs"]) {
    assert.ok(
      findings.some(
        (finding) => finding.includes(file) && finding.includes("public contract or port"),
      ),
    );
  }
});

test("module policy cannot suppress evidence for tenant-owned or control-plane operations", (t) => {
  const project = fixture(t);
  const value = JSON.parse(readFileSync(path.join(project.root, "config/tenancy.json"), "utf8"));
  for (const scope of ["tenant-owned", "control-plane"]) {
    value.modulePolicies[0].scope = scope;
    value.modulePolicies[0].evidence = [];
    assert.ok(tenancyConfigurationFindings(JSON.stringify(value)).length > 0);
  }
  value.crossTenantOperations.default = "allowed";
  assert.ok(
    tenancyConfigurationFindings(JSON.stringify(value)).some((finding) =>
      finding.includes("forbidden by default"),
    ),
  );
});

test("separate runtime context boundaries retain distinct protected ownership", (t) => {
  const project = fixture(t);
  const second = {
    root: "src/account-boundary/mobile",
    resolver: "src/account-boundary/mobile/resolve.mjs",
    policy: "src/account-boundary/mobile/policy.mjs",
    publicContract: "src/account-boundary/mobile/public.mjs",
  };
  for (const concern of ["resolver", "policy", "publicContract"])
    project.write(
      second[concern],
      readFileSync(path.join(project.root, boundary[concern]), "utf8"),
    );
  project.configuration.contextBoundaries.push(second);
  project.save();
  assert.deepEqual(tenantIsolationProjectFindings(project), []);
  project.write(
    "src/format/private-mobile.mjs",
    'import { requireOwner } from "../account-boundary/mobile/policy.mjs";\n',
  );
  assert.ok(
    tenantIsolationProjectFindings(project).some(
      (finding) =>
        finding.includes("private-mobile.mjs") && finding.includes("public contract or port"),
    ),
  );
  project.configuration.modulePolicies[0] = {
    module: roots[0],
    scope: "tenant-independent",
    rationale: "Incorrect scope for a trust boundary.",
    enforcement: [],
    evidence: [],
  };
  project.save();
  assert.ok(
    tenantIsolationProjectFindings(project).some((finding) =>
      finding.includes("cannot belong to a tenant-independent module"),
    ),
  );
  project.configuration.contextBoundaries.push(boundary);
  assert.ok(
    tenancyConfigurationFindings(JSON.stringify(project.configuration)).some((finding) =>
      finding.includes("non-overlapping roots"),
    ),
  );
});

test("typed public context imports admit source, emitted and extensionless paths without opening internals", (t) => {
  const project = fixture(t);
  const publicContract = "src/account-boundary/trust/entry.ts";
  project.configuration.contextBoundaries[0].publicContract = publicContract;
  project.write(
    "src/storage/database.mjs",
    readFileSync(path.join(project.root, "src/storage/database.mjs"), "utf8").replace(
      "../account-boundary/trust/public.mjs",
      "../account-boundary/trust/entry.js",
    ),
  );
  project.write(publicContract, 'export { resolveContext } from "./resolve.mjs";\n');
  project.write(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@context": [publicContract] } } }),
  );
  project.write(
    "src/format/use.ts",
    [
      'import { resolveContext as direct } from "../account-boundary/trust/entry.ts";',
      'import { resolveContext as emitted } from "../account-boundary/trust/entry.js";',
      'import { resolveContext as bundled } from "../account-boundary/trust/entry";',
      'import { resolveContext as aliased } from "@context";',
    ].join("\n"),
  );
  project.save();
  assert.deepEqual(tenantIsolationProjectFindings(project), []);
  project.write(
    "src/format/private.ts",
    'import { resolveContext } from "../account-boundary/trust/resolve";\n',
  );
  assert.ok(
    tenantIsolationProjectFindings(project).some(
      (finding) => finding.includes("private.ts") && finding.includes("public contract or port"),
    ),
  );
  project.write("src/account-boundary/trust/entry.js", "export const unrelated = true;\n");
  assert.ok(
    tenantIsolationProjectFindings(project).some(
      (finding) => finding.includes("use.ts") && finding.includes("entry.js"),
    ),
  );
});
