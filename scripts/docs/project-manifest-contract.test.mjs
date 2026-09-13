/** Verifies project manifest contract behavior for the durable documentation contract boundary. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  deliveryConfigurationPath,
  initialDeliveryConfiguration,
} from "../contracts/delivery-configuration.mjs";
import { renderDeliveryManifestProjection } from "./delivery-manifest.mjs";
import { projectDocumentOwners } from "./project-document-owners.mjs";
import { initialProjectManifest } from "./initial-project-manifest.mjs";
import {
  activeFutureModuleOverlapFindings,
  futureModulesDocumentFindings,
  initialFutureModulesDocument,
  projectManifestFindings,
} from "./project-manifest-contract.mjs";

function moduleEntry(name, root, dependencies = "None.") {
  return `#### ${name}

- Root: \`${root}\`
- Responsibility: Owns the ${name} capability.
- Runtime and technology: JavaScript on Node.js ESM for this fixture.
- Public contract: \`${root}/index.mjs\`
- Private internals: Everything else below the module root.
- Owned data and migrations: No persistent data or migrations.
- Tenant isolation: Tenant-scoped by verified tenant context; no global data or cross-tenant operations.
- Allowed dependencies: ${dependencies}
- Focused verifier: \`node --test ${root}\`
- Steward: Product maintainer.`;
}

function manifest(inventory, { sourceFramework = false } = {}) {
  return `# Project Manifest

## System Shape

${renderDeliveryManifestProjection({
  ...(sourceFramework
    ? { sourceFramework: true }
    : { configuration: JSON.parse(initialDeliveryConfiguration()) }),
})}

### Active Module Inventory

${inventory}

## Maintenance
`;
}

function futureCandidate(name) {
  return `${initialFutureModulesDocument().replace(
    "No future module candidates are currently recorded.",
    `### ${name}

- Potential outcome: Provide the ${name} capability.
- Why deferred: The developer chose future consideration only.
- Activation evidence: An explicit current implementation request.`,
  )}`;
}

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "project-manifest-contract-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  mkdirSync(path.join(root, "src"), { recursive: true });
  write(root, deliveryConfigurationPath, initialDeliveryConfiguration());
  return root;
}

function frameworkFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "framework-manifest-contract-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  mkdirSync(path.join(root, "src"), { recursive: true });
  return root;
}

function write(root, relativePath, content) {
  const target = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

test("initialized current and future inventories are explicit and valid", (t) => {
  const root = fixture(t);
  write(root, "src/.gitkeep", "");
  assert.deepEqual(
    projectManifestFindings({
      content: manifest("No active product modules."),
      relativePaths: ["src/.gitkeep"],
      root,
    }),
    [],
  );
  assert.deepEqual(futureModulesDocumentFindings(initialFutureModulesDocument()), []);
  const initial = initialProjectManifest({
    deliveryProjection: renderDeliveryManifestProjection({
      configuration: JSON.parse(initialDeliveryConfiguration()),
    }),
  });
  assert.deepEqual(
    projectManifestFindings({ root, content: initial, relativePaths: ["src/.gitkeep"] }),
    [],
  );
  assert.deepEqual(projectDocumentOwners({ root, content: initial }).entries, []);

  const missingIntentBoundary = initialFutureModulesDocument().replace(
    /Record only explicitly confirmed future candidates\.[\s\S]*?either inventory\.\n\n/u,
    "",
  );
  assert.match(
    futureModulesDocumentFindings(missingIntentBoundary).join("\n"),
    /idea-intent clarification rule/,
  );
});

test("implemented files require exactly one real current module owner", (t) => {
  const root = fixture(t);
  write(root, "src/orders/index.mjs", "export const orders = true;\n");
  const relativePaths = ["src/orders/index.mjs"];

  assert.deepEqual(
    projectManifestFindings({
      content: manifest(moduleEntry("Orders", "src/orders")),
      relativePaths,
      root,
    }),
    [],
  );
  assert.match(
    projectManifestFindings({
      content: manifest("No active product modules."),
      relativePaths,
      root,
    }).join("\n"),
    /missing from the manifest module inventory: src\/orders\/index\.mjs/,
  );
  assert.match(
    projectManifestFindings({
      content: manifest(moduleEntry("Planned Orders", "src/orders")),
      relativePaths,
      root,
    }).join("\n"),
    /future-only language/,
  );
});

test("source-framework Codex policy is inventoried as one visible capability", (t) => {
  const root = frameworkFixture(t);
  write(
    root,
    ".codex/tooling.json",
    readFileSync(new URL("../../.codex/tooling.json", import.meta.url), "utf8"),
  );
  write(root, ".agents/skills/create-project-from-framework/SKILL.md", "# Creator\n");
  write(root, ".codex/config.toml", 'model = "gpt-6-astra"\n');
  write(root, ".codex/agents/default.toml", 'name = "default"\n');
  const relativePaths = [
    ".agents/skills/create-project-from-framework/SKILL.md",
    ".codex/agents/default.toml",
    ".codex/config.toml",
  ];

  assert.deepEqual(
    projectManifestFindings({
      content: manifest(
        `${moduleEntry("Workflow Skills", ".agents/skills")}\n\n${moduleEntry(
          "Codex Session And Agent Policy",
          ".codex",
        )}`,
        { sourceFramework: true },
      ),
      relativePaths,
      root,
    }),
    [],
  );
});

test("actual cross-module imports must be declared and acyclic", (t) => {
  const root = fixture(t);
  write(root, "src/orders/index.mjs", 'import "../billing/index.mjs";\n');
  write(root, "src/billing/index.mjs", 'import "../orders/index.mjs";\n');
  const relativePaths = ["src/billing/index.mjs", "src/orders/index.mjs"];

  const undeclared = projectManifestFindings({
    content: manifest(
      `${moduleEntry("Orders", "src/orders")}\n\n${moduleEntry("Billing", "src/billing")}`,
    ),
    relativePaths,
    root,
  }).join("\n");
  assert.match(undeclared, /imports undeclared module dependency/);

  const cyclic = projectManifestFindings({
    content: manifest(
      `${moduleEntry("Orders", "src/orders", "\`src/billing\`.")}\n\n${moduleEntry(
        "Billing",
        "src/billing",
        "`src/orders`.",
      )}`,
    ),
    relativePaths,
    root,
  }).join("\n");
  assert.match(cyclic, /active module dependency cycle/);
});

test("declared module dependency boundaries must be acyclic before imports use them", (t) => {
  const root = fixture(t);
  write(root, "src/orders/index.mjs", "export const orders = true;\n");
  write(root, "src/billing/index.mjs", "export const billing = true;\n");
  const relativePaths = ["src/billing/index.mjs", "src/orders/index.mjs"];

  const findings = projectManifestFindings({
    content: manifest(
      `${moduleEntry("Orders", "src/orders", "\`src/billing\`.")}\n\n${moduleEntry(
        "Billing",
        "src/billing",
        "`src/orders`.",
      )}`,
    ),
    relativePaths,
    root,
  }).join("\n");
  assert.match(findings, /declared module dependency cycle/);
});

test("one module cannot remain active and future-only at the same time", () => {
  assert.deepEqual(
    activeFutureModuleOverlapFindings(
      manifest(moduleEntry("Orders", "src/orders")),
      futureCandidate("Orders"),
    ),
    [
      "module Orders cannot be both active in docs/project.md and future-only in docs/future-modules.md",
    ],
  );
});

// Documentation ownership regression: specifications and prototypes are distinct artifacts,
// and neither can activate illustrated operations or silently authorize a prose migration.
test("separate HTML requirements and UI reference preserve current inventory and activation", (t) => {
  const root = fixture(t);
  const specification =
    '<!doctype html><title>Requirements</title><h1 id="requirements">Requirements</h1><p>Users must retain offline access; billing is proposed.</p>';
  write(root, "docs/specification.html", specification);
  write(
    root,
    "design/reference.html",
    "<!doctype html><title>Reference</title><h1 id=flow>Static fictional sign-in</h1>",
  );
  const definition = `## Definition

Inspection product. No runtime is implemented.

- Requirements owner: [Requirements](specification.html#requirements).
- UI reference: [Reference](../design/reference.html#flow).

`;
  const current = manifest("No active product modules.").replace(
    "## System Shape",
    definition + "## System Shape",
  );
  assert.deepEqual(projectDocumentOwners({ root, content: current }).entries, [
    { concern: "Requirements owner", path: "docs/specification.html", fragment: "requirements" },
    { concern: "UI reference", path: "design/reference.html", fragment: "flow" },
  ]);
  for (let pass = 0; pass < 2; pass += 1) {
    assert.deepEqual(projectManifestFindings({ root, content: current, relativePaths: [] }), []);
    assert.equal(readFileSync(path.join(root, "docs/specification.html"), "utf8"), specification);
  }
  write(root, "src/inspections/index.mjs", "export const inspections = true;\n");
  const activated = current.replace(
    "No active product modules.",
    moduleEntry("Inspections", "src/inspections"),
  );
  assert.deepEqual(
    projectManifestFindings({
      root,
      content: activated,
      relativePaths: ["src/inspections/index.mjs"],
    }),
    [],
  );
  assert.equal(
    activeFutureModuleOverlapFindings(activated, futureCandidate("Inspections")).length,
    1,
  );
  assert.deepEqual(
    activeFutureModuleOverlapFindings(activated, initialFutureModulesDocument()),
    [],
  );
});

test("pending and minimal definitions need no extra documentation or declaration", (t) => {
  const root = fixture(t);
  for (const content of [
    "# Project Manifest\n\nProduct definition: pending.\n",
    "# Project Manifest\n\n## Definition\n\nA local calculator.\n",
    "# Project Manifest\n\n## Definition\n\nA local calculator.\n\n- Requirements owner: [Definition](#definition).\n",
  ]) {
    assert.deepEqual(projectDocumentOwners({ root, content }).findings, []);
  }
});

test("invalid or ambiguous document owners fail without changing project content", (t) => {
  const root = fixture(t);
  const specification =
    "# Product Requirements\n\n## Offline Access\n\nKeep inspections offline.\n";
  write(root, "docs/spec.md", specification);
  write(
    root,
    "docs/reference.html",
    '<h1 id="flow">Reference</h1><script>const text = \'<div id="invented">\';</script>',
  );
  symlinkSync(path.join(root, "docs/spec.md"), path.join(root, "docs/alias.md"));
  for (const declaration of [
    "- Requirements owner: [Missing](missing.html).",
    "- Requirements owner: [Missing anchor](spec.md#missing).",
    "- Requirements owner: [Invalid](%ZZ).",
    "- Requirements owner: [Outside](../../outside.md).",
    "- Requirements owner: [Outside](%2Ftmp/outside.md).",
    "- Requirements owner: [Symlink](alias.md).",
    "- Requirements owner: [Remote](https://example.invalid/spec).",
    "- Requirements owner: pending.",
    "- Requirements owner: [First](spec.md).\n- Requirements owner: [Second](reference.html).",
    "- Requirements owner: [Both](spec.md) and [Second](reference.html).",
    "- Requirements owner: [Requirements](reference.html).\n- UI reference: [Same artifact](reference.html#flow).",
    "- UI reference: [Script literal](reference.html#invented).",
  ]) {
    const result = projectDocumentOwners({
      root,
      content: `# Project Manifest\n\n${declaration}\n`,
    });
    assert.ok(result.findings.length > 0, declaration);
    assert.equal(readFileSync(path.join(root, "docs/spec.md"), "utf8"), specification);
  }
  assert.deepEqual(
    projectDocumentOwners({
      root,
      content: "- Requirements owner: [Offline](spec.md#offline-access).",
    }).findings,
    [],
  );
});
