/** Verifies api security behavior for the repository verification boundary. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  initialTenancyConfiguration,
  serializeTenancyConfiguration,
  tenancyConfigurationPath,
} from "../contracts/tenancy-configuration.mjs";
import { importSpecifiersForFile } from "../repository/local-import-resolution.mjs";
import { apiSecurityFindings, isApiSource, readApiFiles } from "./api-security.mjs";
import { identityAccessProjectFindings } from "./identity-access.mjs";
import { tenantIsolationProjectFindings } from "./tenant-isolation.mjs";

function fixture(content, relativePath = "src/routes/account.ts") {
  return { content, relativePath };
}

test("API-like content is recognized independently from ownership", () => {
  assert.equal(isApiSource(fixture("export async function GET() {}")), true);
  assert.equal(
    isApiSource(fixture("router.post('/jobs', handler)", "modules/jobs/worker.ts")),
    true,
  );
});

test("repository API scanning includes declared product roots only", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "api-product-roots-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const write = (relativePath, content) => {
    const target = path.join(root, ...relativePath.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  write("src/routes/root.ts", "router.get('/root', requireAuth(handler))\n");
  write("modules/jobs/routes/ignored.ts", "router.get('/ignored', handler)\n");
  write("pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n");
  write("apps/api/package.json", '{"name":"api"}\n');
  write("apps/api/src/routes/jobs.ts", "router.post('/jobs', requireAuth(handler))\n");
  const files = [
    "src/routes/root.ts",
    "modules/jobs/routes/ignored.ts",
    "pnpm-workspace.yaml",
    "apps/api/package.json",
    "apps/api/src/routes/jobs.ts",
  ];

  assert.deepEqual(
    readApiFiles({ root, files }).map((file) => file.relativePath),
    ["src/routes/root.ts", "apps/api/src/routes/jobs.ts"],
  );
});

test("negative auth statements override unrelated positive keywords", () => {
  const findings = apiSecurityFindings(
    fixture(`
      // Authentication intentionally absent; a token field may be logged for diagnostics.
      router.get('/account', handler)
    `),
  );
  assert.ok(findings.some((finding) => finding.includes("static boundary heuristic")));
  assert.ok(findings.some((finding) => finding.includes("authentication evidence")));
  assert.ok(findings.some((finding) => finding.includes("authorization/policy")));
});

test("authentication and authorization are separate API decisions", () => {
  assert.deepEqual(
    apiSecurityFindings(
      fixture("router.get('/account', requireAuth(requirePermission('account:read', handler)))"),
    ),
    [],
  );
  const internalOnly = apiSecurityFindings(
    fixture("// Internal API behind a trusted network boundary\nrouter.get('/health', handler)"),
  );
  assert.ok(internalOnly.some((finding) => finding.includes("authentication evidence")));
  assert.ok(internalOnly.some((finding) => finding.includes("authorization/policy")));
});

test("an intentionally anonymous API uses an explicit policy and abuse controls", () => {
  assert.deepEqual(
    apiSecurityFindings(
      fixture("router.get('/status', allowAnonymous(rateLimit({ max: 30 }, handler)))"),
    ),
    [],
  );
});

test("public API still requires abuse-control evidence", () => {
  const findings = apiSecurityFindings(
    fixture(
      "// Public API with authentication and authorization policy\nrouter.post('/jobs', requireAuth(requirePermission('jobs:create', handler)))",
    ),
  );
  assert.ok(findings.some((finding) => finding.includes("rate-limit evidence")));
});

test("descriptive headers and string literals are not executable API security evidence", () => {
  for (const content of [
    "/** Owns authentication, authorization, and rate-limit behavior. */\nrouter.get('/admin', handler)",
    "const description = 'authentication authorization rate-limit';\nrouter.get('/admin', handler)",
  ]) {
    const findings = apiSecurityFindings(fixture(content));
    assert.ok(findings.some((finding) => finding.includes("authentication evidence")));
    assert.ok(findings.some((finding) => finding.includes("authorization/policy")));
  }
});

test("architectural import extraction covers every claimed source-language family", () => {
  const cases = [
    [
      "view.ts",
      'import value from "identity-access/sessions/store";',
      "identity-access/sessions/store",
    ],
    [
      "commented-static.ts",
      'import /* reviewed boundary */ "identity-access/sessions/store"; export { value } from /* reviewed boundary */ "tenancy/context/store";',
      "tenancy/context/store",
    ],
    [
      "dynamic.ts",
      'await import(/* webpackChunkName: "private" */ "identity-access/sessions/store", { with: { type: "json" } });',
      "identity-access/sessions/store",
    ],
    [
      "commented-dynamic.ts",
      'await import(// repository-local boundary\n"identity-access/sessions/store", {}); require /* boundary */ ("tenancy/context/store");',
      "tenancy/context/store",
    ],
    [
      "resolved.ts",
      'require?.("identity-access/sessions/store"); require.resolve("identity-access/" + "sessions/store"); import.meta.resolve?.("tenancy/" + "context/store");',
      "tenancy/context/store",
    ],
    [
      "concatenated.ts",
      'await import(("identity-access/" + "sessions/store"), { with: { type: "json" } });',
      "identity-access/sessions/store",
    ],
    [
      "template.ts",
      "await import(`identity-access/sessions/store`);",
      "identity-access/sessions/store",
    ],
    [
      "view.py",
      "from identity_access.sessions.store import sessions",
      "identity_access/sessions/store",
    ],
    ["continued.py", "from identity_access \\\n import sessions", "identity_access"],
    [
      "runtime.py",
      'importlib.import_module("identity_access.sessions.store")',
      "identity_access/sessions/store",
    ],
    ["relative.py", "from .. import identity_access", "../identity_access"],
    [
      "view.rs",
      "use /* boundary */ crate::identity_access::{sessions::{store, token}, public::client};",
      "identity_access/sessions/store",
    ],
    [
      "relative.rs",
      "use super::super::identity_access::sessions;",
      "../../identity_access/sessions",
    ],
    ["module.rs", "mod r#identity_access;", "./identity_access"],
    [
      "included.rs",
      'include!("../identity_access/sessions/store.rs");',
      "../identity_access/sessions/store.rs",
    ],
    ["crate.rs", "extern crate identity_access as identity;", "identity_access"],
    [
      "view.cpp",
      "#include \\\n/* boundary */ <identity-access/sessions/store.hpp>",
      "identity-access/sessions/store.hpp",
    ],
    [
      "view.go",
      'import /* boundary */ "example.test/product/identity-access/sessions/store"',
      "example.test/product/identity-access/sessions/store",
    ],
    [
      "raw.go",
      "import `example.test/product/identity-access/sessions/store`",
      "example.test/product/identity-access/sessions/store",
    ],
    [
      "View.java",
      "import /* boundary */ product.identity_access.sessions.Store;",
      "product/identity_access/sessions/Store",
    ],
    [
      "View.kt",
      "import /* boundary */ product.identity_access.sessions.Store",
      "product/identity_access/sessions/Store",
    ],
    [
      "Escaped.kt",
      "import product.`identity_access`.sessions.Store",
      "product/identity_access/sessions/Store",
    ],
    [
      "View.cs",
      "extern alias Platform; global using /* boundary */ Sessions = Platform::Product.IdentityAccess.Sessions;",
      "Product/IdentityAccess/Sessions",
    ],
    ["Escaped.cs", "using @identity_access.sessions;", "identity_access/sessions"],
    [
      "view.php",
      "use /* boundary */ \\Product\\IdentityAccess\\Sessions\\{Store, Token};",
      "Product/IdentityAccess/Sessions/Store",
    ],
    [
      "child.php",
      "require_once __DIR__ . '/identity_access/sessions/store.php';",
      "./identity_access/sessions/store.php",
    ],
    [
      "parent.php",
      "require_once dirname(__DIR__) . '/identity_access/sessions/store.php';",
      "../identity_access/sessions/store.php",
    ],
    [
      "view.rb",
      'require_relative( # reviewed boundary\n"../identity-access/sessions/store"\n)',
      "./../identity-access/sessions/store",
    ],
    [
      "view.vue",
      '<script type="module" src="../identity-access/sessions/store.js"></script>',
      "../identity-access/sessions/store.js",
    ],
    [
      "View.swift",
      "@_implementationOnly public /* boundary */ import IdentityAccess",
      "IdentityAccess",
    ],
  ];
  for (const [relativePath, content, expected] of cases) {
    assert.ok(
      importSpecifiersForFile({ content, relativePath }).includes(expected),
      `${relativePath} should expose ${expected}`,
    );
  }
});

function identityProject(t, entries) {
  const root = mkdtempSync(path.join(os.tmpdir(), "identity-access-boundary-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  for (const [relativePath, content] of Object.entries(entries)) {
    const target = path.join(root, ...relativePath.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return { root, files: Object.keys(entries) };
}

test("Identity and Access concerns remain separated behind public contracts", (t) => {
  const fixture = identityProject(t, {
    "src/identity-access/adapters/providers/clerk.ts":
      'import { createClerkClient } from "@clerk/backend";\nexport const provider = createClerkClient;\n',
    "src/identity-access/authentication/credentials/password.ts":
      'import argon2 from "argon2";\nexport const verifyPassword = argon2.verify;\n',
    "src/identity-access/authorization/policies/can-edit.ts":
      "export const canEdit = () => false;\n",
    "src/identity-access/public/index.ts": "export const identityClient = {};\n",
    "src/identity-access/sessions/tokens/rotate.ts":
      'import { SignJWT } from "jose";\nexport const rotate = SignJWT;\n',
    "src/identity-access/users/lifecycle/create-user.ts": "export const createUser = () => ({});\n",
    "src/ui/account/view.ts":
      'import { identityClient } from "../../identity-access/public/index";\nexport const view = identityClient;\n',
  });

  assert.deepEqual(identityAccessProjectFindings(fixture), []);
});

test("provider SDKs and identity internals cannot leak into UI or domain consumers", (t) => {
  const fixture = identityProject(t, {
    "src/domain/orders/approve.ts":
      'import { sessions } from "../../identity-access/sessions/store";\nexport const approve = sessions;\n',
    "src/identity-access/public/index.ts": "export const identityClient = {};\n",
    "src/identity-access/sessions/store.ts": "export const sessions = {};\n",
    "src/ui/login/view.ts":
      'import { ClerkProvider } from "@clerk/nextjs";\nexport const view = ClerkProvider;\n',
    "src/ui/account/commented.ts":
      'import /* boundary */ { sessions } from /* source */ "../../identity-access/sessions/store";\nexport const view = sessions;\n',
  });

  const findings = identityAccessProjectFindings(fixture);
  assert.ok(findings.some((finding) => finding.includes("provider-adapter directory")));
  assert.ok(findings.some((finding) => finding.includes("may import only its public contract")));
  assert.ok(
    findings.some(
      (finding) =>
        finding.includes("src/ui/account/commented.ts") &&
        finding.includes("may import only its public contract"),
    ),
  );
});

test("hand-rolled Identity implementations and sensitive logs cannot hide outside the boundary", (t) => {
  const fixture = identityProject(t, {
    "src/accounts/login.ts":
      "export function login(password, passwordHash) { console.log(passwordHash); return crypto.subtle.verify('HMAC', key, passwordHash, password); }\n",
    "src/identity-access/public/index.ts":
      "export const identityClient = { authorize: () => false };\n",
    "src/orders/authorize.ts":
      "export function authorize(actor, order) { return actor.permissions.has('orders:write') && actor.tenantId === order.tenantId; }\n",
    "src/ui/account/view.ts":
      'import { identityClient } from "../../identity-access/public/index";\nexport const allowed = identityClient.authorize();\n',
  });

  const findings = identityAccessProjectFindings(fixture);
  assert.ok(
    findings.some(
      (finding) =>
        finding.includes("src/accounts/login.ts") && finding.includes("must not log credential"),
    ),
  );
  for (const relativePath of ["src/accounts/login.ts", "src/orders/authorize.ts"]) {
    assert.ok(
      findings.some(
        (finding) =>
          finding.includes(relativePath) &&
          finding.includes("must live inside the dedicated Identity and Access boundary"),
      ),
      relativePath,
    );
  }
  assert.equal(
    findings.some(
      (finding) =>
        finding.includes("src/ui/account/view.ts") &&
        finding.includes("must live inside the dedicated Identity and Access boundary"),
    ),
    false,
  );
});

test("package imports distinguish external, blocked, and conditional local mappings", (t) => {
  const fixture = identityProject(t, {
    "package.json": JSON.stringify({
      name: "@product/root",
      imports: {
        "#blocked": null,
        "#conditional": {
          node: "some-external-package",
          default: "./src/identity-access/public/index.ts",
        },
        "#external": "some-external-package",
      },
    }),
    "src/identity-access/public/index.ts": "export const identityClient = {};\n",
    "src/ui/external-view.ts":
      'import "#blocked";\nimport "#conditional";\nimport "#external";\nexport const view = true;\n',
  });

  assert.deepEqual(identityAccessProjectFindings(fixture), []);
});

test("Identity and Access contracts cannot be bypassed through aliases or workspace packages", (t) => {
  const fixture = identityProject(t, {
    "tsconfig.base.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["src/*"], "internal/*": ["src/*"] },
      },
    }),
    "tsconfig.strict.json": JSON.stringify({ compilerOptions: { strict: true } }),
    "tsconfig.json": JSON.stringify({
      extends: ["./tsconfig.base.json", "./tsconfig.strict.json"],
    }),
    "package.json": JSON.stringify({
      name: "@product/root",
      imports: { "#internal/*": "./src/*" },
      exports: { ".": { default: "./src/identity-access/sessions/store.ts" } },
    }),
    "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
    "packages/accounts/package.json": JSON.stringify({
      name: "@product/accounts",
      exports: {
        "./private/*": { import: ["./src/identity-access/*"] },
        "./session": { default: "./src/identity-access/sessions/store.ts" },
      },
    }),
    "packages/accounts/src/identity-access/public/index.ts": "export const identityClient = {};\n",
    "packages/accounts/src/identity-access/sessions/store.ts": "export const sessions = {};\n",
    "src/identity-access/public/index.ts": "export const identityClient = {};\n",
    "src/identity-access/sessions/store.ts": "export const sessions = {};\n",
    "src/ui/alias-view.ts":
      'import { sessions } from "@/identity-access/sessions/store";\nexport const view = sessions;\n',
    "src/ui/inherited-alias-view.ts":
      'import { sessions } from "internal/identity-access/sessions/store";\nexport const view = sessions;\n',
    "src/ui/package-view.ts":
      'import { sessions } from "@product/accounts/session";\nexport const view = sessions;\n',
    "src/ui/pattern-export-view.ts":
      'import { sessions } from "@product/accounts/private/sessions/store";\nexport const view = sessions;\n',
    "src/ui/package-import-view.ts":
      'import { sessions } from "#internal/identity-access/sessions/store";\nexport const view = sessions;\n',
    "src/ui/root-export-view.ts":
      'import { sessions } from "@product/root";\nexport const view = sessions;\n',
  });

  const findings = identityAccessProjectFindings(fixture);
  assert.ok(
    findings.some(
      (finding) =>
        finding.includes("src/ui/alias-view.ts") &&
        finding.includes("may import only its public contract"),
    ),
  );
  for (const relativePath of [
    "src/ui/inherited-alias-view.ts",
    "src/ui/pattern-export-view.ts",
    "src/ui/root-export-view.ts",
  ]) {
    assert.ok(
      findings.some(
        (finding) =>
          finding.includes(relativePath) && finding.includes("may import only its public contract"),
      ),
      relativePath,
    );
  }
  assert.ok(
    findings.some(
      (finding) =>
        finding.includes("src/ui/package-view.ts") &&
        finding.includes("may import only its public contract"),
    ),
  );
  assert.ok(
    findings.some(
      (finding) =>
        finding.includes("src/ui/package-import-view.ts") &&
        finding.includes("may import only its public contract"),
    ),
  );
});

test("baseUrl-only and non-JavaScript imports cannot bypass Identity and Access contracts", (t) => {
  const fixture = identityProject(t, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "src" } }),
    "src/identity-access/sessions/store.ts": "export const sessions = {};\n",
    "src/identity_access/sessions/store.py": "sessions = {}\n",
    "src/IdentityAccess/Sessions/Store.cs": "namespace Product.IdentityAccess.Sessions;\n",
    "src/ui/base-url-view.ts":
      'import { sessions } from "identity-access/sessions/store";\nexport const view = sessions;\n',
    "src/ui/python_view.py": "from identity_access.sessions import store\nview = store\n",
    "src/UI/View.cs": "global using Sessions = Product.IdentityAccess.Sessions;\n",
  });

  const findings = identityAccessProjectFindings(fixture);
  for (const relativePath of [
    "src/ui/base-url-view.ts",
    "src/ui/python_view.py",
    "src/UI/View.cs",
  ]) {
    assert.ok(
      findings.some(
        (finding) =>
          finding.includes(relativePath) && finding.includes("may import only its public contract"),
      ),
      relativePath,
    );
  }
});

test("C++ and Swift imports cannot bypass Identity and Access contracts", (t) => {
  const fixture = identityProject(t, {
    "src/identity-access/sessions/store.hpp": "#pragma once\n",
    "src/IdentityAccess/Sessions/Store.swift": "public struct Store {}\n",
    "src/UI/View.cpp": "#include <identity-access/sessions/store.hpp>\n",
    "src/UI/View.swift": "@preconcurrency public import IdentityAccess\n",
    "src/UI/Login.vue":
      '<script setup>const sessions = import(/* private */ "../identity-access/sessions/store", {});</script>\n',
    "src/UI/Remote.html":
      '<script type="module" src="../identity-access/sessions/store.js"></script>\n',
    "src/UI/View.cs":
      "extern alias Platform; global using Sessions = Platform::Product.IdentityAccess.Sessions;\n",
    "src/UI/View.go": "import `product/identity-access/sessions`\n",
    "src/UI/View.php": "<?php use \\Product\\IdentityAccess\\Sessions\\{Store, Token};\n",
    "src/UI/Child.php": "<?php require_once __DIR__ . '/../identity_access/sessions/store.php';\n",
    "src/UI/View.py": "from .. import identity_access\n",
    "src/UI/View.rb": 'require_relative("../identity-access/sessions/store")\n',
    "src/UI/nested/View.rs": "use super::super::identity_access::sessions;\n",
    "src/UI/Included.rs": 'include!("../identity_access/sessions/store.rs");\n',
    "src/UI/Resolved.ts":
      'export const privatePath = require?.("../identity-access/" + "sessions/store");\n',
    "src/identity_access/sessions/store.rs": "pub struct Store;\n",
    "src/identity_access/__init__.py": "",
    "src/identity_access/sessions/__init__.py": "",
    "src/identity_access/sessions/store.rb": "module Store; end\n",
    "src/identity-access/sessions/store.js": "export const sessions = {};\n",
    "src/IdentityAccess/Sessions/Store.php": "<?php final class Store {}\n",
    "src/identity_access/sessions/store.php": "<?php final class LocalStore {}\n",
    "src/IdentityAccess/Sessions/Store.cs": "namespace Product.IdentityAccess.Sessions;\n",
  });

  const findings = identityAccessProjectFindings(fixture);
  for (const relativePath of [
    "src/UI/Login.vue",
    "src/UI/Remote.html",
    "src/UI/View.cpp",
    "src/UI/View.cs",
    "src/UI/View.go",
    "src/UI/View.php",
    "src/UI/Child.php",
    "src/UI/View.py",
    "src/UI/View.rb",
    "src/UI/View.swift",
    "src/UI/nested/View.rs",
    "src/UI/Included.rs",
    "src/UI/Resolved.ts",
  ]) {
    assert.ok(
      findings.some(
        (finding) =>
          finding.includes(relativePath) && finding.includes("may import only its public contract"),
      ),
      relativePath,
    );
  }
});

test("umbrella auth modules require concern directories and reject sensitive logging", (t) => {
  const fixture = identityProject(t, {
    "src/auth.ts": "export const auth = {};\n",
    "src/auth/login.ts": "export const login = () => {};\n",
    "src/auth/sessions/create.ts":
      "export function create(sessionToken) { console.info(sessionToken); }\n",
  });

  const findings = identityAccessProjectFindings(fixture);
  assert.ok(findings.some((finding) => finding.includes("Product Root-level mixed file")));
  assert.ok(findings.some((finding) => finding.includes("explicit authentication")));
  assert.ok(findings.some((finding) => finding.includes("must not log credential")));
});

const tenantEvidencePath = "src/tenancy/isolation/tenant-isolation.test.ts";

function tenancyManifest() {
  return `# Project Manifest

### Active Module Inventory

#### Product Runtime

- Root: \`src\`
- Responsibility: Owns the product runtime in this tenant-isolation fixture.
- Runtime and technology: TypeScript on Node.js ESM.
- Public contract: \`src/tenancy/public/index.ts\`
- Private internals: Everything else below the module root.
- Owned data and migrations: Tenant-scoped runtime data; no fixture migrations.
- Tenant isolation: Tenant-scoped by verified tenant context; cross-tenant access is denied.
- Allowed dependencies: None.
- Focused verifier: \`node --test ${tenantEvidencePath}\`
- Steward: Product maintainer.
`;
}

function tenantEvidenceSource() {
  return `import assert from "node:assert/strict";
const allowsTenant = (actor, resource) => actor.tenantId === resource.tenantId;
assert.equal(allowsTenant({ tenantId: "tenant-a" }, { tenantId: "tenant-b" }), false);
`;
}

function tenancyProject(t, entries, configuration = initialTenancyConfiguration()) {
  const productImplementation = Object.keys(entries).some(
    (relativePath) =>
      relativePath.startsWith("src/") &&
      relativePath !== "src/.gitkeep" &&
      !/(?:^|\/)(?:[^/]+\.)?(?:source\.)?(?:spec|test)\.[^/]+$/iu.test(relativePath),
  );
  const suppliedPackage = entries["package.json"]
    ? JSON.parse(entries["package.json"])
    : { name: "tenant-fixture", private: true };
  if (suppliedPackage.scripts === undefined) {
    suppliedPackage.scripts = {
      "test:tenant-isolation": `node --test ${tenantEvidencePath}`,
    };
  }
  const fixture = identityProject(t, {
    "package.json": JSON.stringify(suppliedPackage),
    "pnpm-workspace.yaml": "packages: []\n",
    "src/.gitkeep": "",
    [tenancyConfigurationPath]: configuration,
    ...(productImplementation
      ? {
          "docs/project.md": tenancyManifest(),
          [tenantEvidencePath]: tenantEvidenceSource(),
        }
      : {}),
    ...entries,
  });
  return fixture;
}

function activeTenancyConfiguration(...trustedSources) {
  return serializeTenancyConfiguration({
    tenantContext: {
      key: "tenantId",
      resolutionStrategy:
        trustedSources.length === 1 ? "single-trusted-source" : "composed-trusted-sources",
      trustedSources,
    },
  });
}

test("an empty generated project starts with a truthful pending tenant contract", (t) => {
  const fixture = tenancyProject(t, {});
  assert.deepEqual(tenantIsolationProjectFindings(fixture), []);
});

test("product implementation requires trusted tenant resolution and separated concerns", (t) => {
  const pending = tenancyProject(t, {
    "src/orders/public/index.ts": "export const listOrders = () => [];\n",
  });
  const pendingFindings = tenantIsolationProjectFindings(pending);
  assert.ok(pendingFindings.some((finding) => finding.includes("must be configured")));
  assert.ok(pendingFindings.some((finding) => finding.includes("dedicated tenancy boundary")));

  const active = tenancyProject(
    t,
    {
      "src/orders/persistence/repository.ts":
        "export const ordersFor = (tenantId) => ({ tenantId });\n",
      "src/tenancy/context/resolve.ts":
        "export const resolveTenantContext = (membership) => ({ tenantId: membership.tenantId });\n",
      "src/tenancy/policy/isolate.ts":
        "export const allowsTenant = (tenantContext, resource) => tenantContext.tenantId === resource.tenantId;\n",
      "src/tenancy/public/index.ts":
        "export const requireTenant = (tenantContext) => tenantContext.tenantId;\n",
    },
    activeTenancyConfiguration("authenticated-membership"),
  );
  assert.deepEqual(tenantIsolationProjectFindings(active), []);
});

test("active product modules require executable negative cross-tenant lifecycle evidence", (t) => {
  const missingScenario = tenancyProject(
    t,
    {
      "src/orders/persistence/repository.ts":
        "export const ordersFor = (tenantId) => ({ tenantId });\n",
      "src/tenancy/context/resolve.ts":
        "export const resolveTenantContext = (membership) => ({ tenantId: membership.tenantId });\n",
      "src/tenancy/policy/isolate.ts":
        "export const allowsTenant = (tenantContext, resource) => tenantContext.tenantId === resource.tenantId;\n",
      "src/tenancy/public/index.ts":
        "export const requireTenant = (tenantContext) => tenantContext.tenantId;\n",
      [tenantEvidencePath]:
        '// assert.equal(check("tenant-a", "tenant-b"), false) is not executable evidence.\n',
    },
    activeTenancyConfiguration("authenticated-membership"),
  );
  assert.ok(
    tenantIsolationProjectFindings(missingScenario).some((finding) =>
      finding.includes("negative cross-tenant test/spec"),
    ),
  );

  const unselectedLifecycle = tenancyProject(
    t,
    {
      "package.json": JSON.stringify({ name: "tenant-fixture", private: true, scripts: {} }),
      "src/orders/persistence/repository.ts":
        "export const ordersFor = (tenantId) => ({ tenantId });\n",
      "src/tenancy/context/resolve.ts":
        "export const resolveTenantContext = (membership) => ({ tenantId: membership.tenantId });\n",
      "src/tenancy/policy/isolate.ts":
        "export const allowsTenant = (tenantContext, resource) => tenantContext.tenantId === resource.tenantId;\n",
      "src/tenancy/public/index.ts":
        "export const requireTenant = (tenantContext) => tenantContext.tenantId;\n",
    },
    activeTenancyConfiguration("authenticated-membership"),
  );
  assert.ok(
    tenantIsolationProjectFindings(unselectedLifecycle).some((finding) =>
      finding.includes("no owning test:tenant-isolation lifecycle selected by full verification"),
    ),
  );

  const noOpLifecycle = tenancyProject(
    t,
    {
      "package.json": JSON.stringify({
        name: "tenant-fixture",
        private: true,
        scripts: { "test:tenant-isolation": `echo ${tenantEvidencePath}` },
      }),
      "src/orders/persistence/repository.ts":
        "export const ordersFor = (tenantId) => ({ tenantId });\n",
      "src/tenancy/context/resolve.ts":
        "export const resolveTenantContext = (membership) => ({ tenantId: membership.tenantId });\n",
      "src/tenancy/policy/isolate.ts":
        "export const allowsTenant = (tenantContext, resource) => tenantContext.tenantId === resource.tenantId;\n",
      "src/tenancy/public/index.ts":
        "export const requireTenant = (tenantContext) => tenantContext.tenantId;\n",
    },
    activeTenancyConfiguration("authenticated-membership"),
  );
  assert.ok(
    tenantIsolationProjectFindings(noOpLifecycle).some((finding) =>
      finding.includes("directly named by its test:tenant-isolation runner"),
    ),
  );

  const unrelatedAssertion = tenancyProject(
    t,
    {
      "src/orders/persistence/repository.ts":
        "export const ordersFor = (tenantId) => ({ tenantId });\n",
      "src/tenancy/context/resolve.ts":
        "export const resolveTenantContext = (membership) => ({ tenantId: membership.tenantId });\n",
      "src/tenancy/policy/isolate.ts":
        "export const allowsTenant = (tenantContext, resource) => tenantContext.tenantId === resource.tenantId;\n",
      "src/tenancy/public/index.ts":
        "export const requireTenant = (tenantContext) => tenantContext.tenantId;\n",
      [tenantEvidencePath]:
        'const tenantA = { tenantId: "tenant-a" };\nconst tenantB = { tenantId: "tenant-b" };\nassert.equal(false, false);\n',
    },
    activeTenancyConfiguration("authenticated-membership"),
  );
  assert.ok(
    tenantIsolationProjectFindings(unrelatedAssertion).some((finding) =>
      finding.includes("tenant-coupled denial assertion"),
    ),
  );
});

test("tenant isolation rejects caller context, defaults, ambient state, deep imports, and unscoped data", (t) => {
  const fixture = tenancyProject(
    t,
    {
      "src/orders/handler.ts":
        'import { resolveTenantContext } from "../tenancy/context/resolve";\nconst tenantId = request.headers.tenantId || "default";\nexport const handle = resolveTenantContext;\n',
      "src/orders/jobs/rebuild.ts": "export const rebuild = () => true;\n",
      "src/tenancy/context/ambient.ts": "let currentTenant = null;\nexport { currentTenant };\n",
      "src/tenancy/context/resolve.ts":
        "export const resolveTenantContext = (membership) => ({ tenantId: membership.tenantId });\n",
      "src/tenancy/policy/isolate.ts":
        "export const allowsTenant = (tenantContext, resource) => tenantContext.tenantId === resource.tenantId;\n",
      "src/tenancy/public/index.ts":
        "export const requireTenant = (tenantContext) => tenantContext.tenantId;\n",
    },
    activeTenancyConfiguration("authenticated-membership"),
  );
  const findings = tenantIsolationProjectFindings(fixture);
  assert.ok(findings.some((finding) => finding.includes("caller-controlled")));
  assert.ok(findings.some((finding) => finding.includes("default/global fallback")));
  assert.ok(findings.some((finding) => finding.includes("mutable ambient global state")));
  assert.ok(findings.some((finding) => finding.includes("public contract or port")));
  assert.ok(findings.some((finding) => finding.includes("must carry explicit tenant scope")));
});

test("tenant contracts cannot be bypassed through aliases or workspace packages", (t) => {
  const fixture = tenancyProject(
    t,
    {
      "tsconfig.base.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
      }),
      "tsconfig.json": JSON.stringify({ extends: "./tsconfig.base.json" }),
      "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
      "packages/platform/package.json": JSON.stringify({
        name: "@product/platform",
        exports: { "./context": { default: "./src/tenancy/context/resolve.ts" } },
      }),
      "packages/platform/src/tenancy/context/resolve.ts":
        "export const resolveTenantContext = (membership) => ({ tenantId: membership.tenantId });\n",
      "packages/platform/src/tenancy/policy/isolate.ts":
        "export const allowsTenant = (tenantContext, resource) => tenantContext.tenantId === resource.tenantId;\n",
      "packages/platform/src/tenancy/public/index.ts":
        "export const requireTenant = (tenantContext) => tenantContext.tenantId;\n",
      "src/orders/alias-handler.ts":
        'import { resolveTenantContext } from "@/tenancy/context/resolve";\nexport const handle = resolveTenantContext;\n',
      "src/orders/package-handler.ts":
        'import { resolveTenantContext } from "@product/platform/context";\nexport const handle = resolveTenantContext;\n',
      "src/tenancy/context/resolve.ts":
        "export const resolveTenantContext = (membership) => ({ tenantId: membership.tenantId });\n",
      "src/tenancy/policy/isolate.ts":
        "export const allowsTenant = (tenantContext, resource) => tenantContext.tenantId === resource.tenantId;\n",
      "src/tenancy/public/index.ts":
        "export const requireTenant = (tenantContext) => tenantContext.tenantId;\n",
    },
    activeTenancyConfiguration("authenticated-membership"),
  );

  const findings = tenantIsolationProjectFindings(fixture);
  assert.ok(
    findings.some(
      (finding) =>
        finding.includes("src/orders/alias-handler.ts") &&
        finding.includes("public contract or port"),
    ),
  );
  assert.ok(
    findings.some(
      (finding) =>
        finding.includes("src/orders/package-handler.ts") &&
        finding.includes("public contract or port"),
    ),
  );
});

test("baseUrl-only and non-JavaScript imports cannot bypass tenant contracts", (t) => {
  const fixture = tenancyProject(
    t,
    {
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "src" } }),
      "src/orders/base-url-handler.ts":
        'import { resolveTenantContext } from "tenancy/context/resolve";\nexport const handle = resolveTenantContext;\n',
      "src/orders/python_handler.py":
        "from tenancy.context import resolve\nhandle = resolve.resolve_tenant_context\n",
      "src/orders/runtime_handler.py":
        'import importlib\nhandle = importlib.import_module("tenancy.context.resolve")\n',
      "src/Orders/Handler.cs": "using TenantContext = Product.Tenancy.Context;\n",
      "src/Tenancy/Context/Resolve.cs": "namespace Product.Tenancy.Context;\n",
      "src/tenancy/context/resolve.py":
        "def resolve_tenant_context(membership):\n    return {'tenantId': membership.tenantId}\n",
      "src/tenancy/context/resolve.ts":
        "export const resolveTenantContext = (membership) => ({ tenantId: membership.tenantId });\n",
      "src/tenancy/policy/isolate.ts":
        "export const allowsTenant = (tenantContext, resource) => tenantContext.tenantId === resource.tenantId;\n",
      "src/tenancy/public/index.ts":
        "export const requireTenant = (tenantContext) => tenantContext.tenantId;\n",
    },
    activeTenancyConfiguration("authenticated-membership"),
  );

  const findings = tenantIsolationProjectFindings(fixture);
  for (const relativePath of [
    "src/orders/base-url-handler.ts",
    "src/orders/python_handler.py",
    "src/orders/runtime_handler.py",
    "src/Orders/Handler.cs",
  ]) {
    assert.ok(
      findings.some(
        (finding) => finding.includes(relativePath) && finding.includes("public contract or port"),
      ),
      relativePath,
    );
  }
});

test("C++ and Swift imports cannot bypass tenant contracts", (t) => {
  const fixture = tenancyProject(
    t,
    {
      "src/orders/Handler.cpp": "#include <tenancy/context/resolve.hpp>\n",
      "src/Orders/Handler.swift": "import Tenancy\n",
      "src/orders/Dashboard.astro":
        "---\nawait import(`../tenancy/context/resolve`, {});\n---\n<main />\n",
      "src/orders/Included.rs": 'include!("../tenancy/context/resolve.rs");\n',
      "src/orders/Commented.rs": "use /* reviewed boundary */ crate::tenancy::context::resolve;\n",
      "src/orders/Loaded.rb": 'require( # reviewed boundary\n"tenancy/context/resolve"\n)\n',
      "src/tenancy/context/resolve.hpp": "// tenantId\n",
      "src/Tenancy/Context/Resolve.swift": "public struct TenantContext {}\n",
      "src/tenancy/context/resolve.ts":
        "export const resolveTenantContext = (membership) => ({ tenantId: membership.tenantId });\n",
      "src/tenancy/context/resolve.rs": "pub struct TenantContext;\n",
      "src/tenancy/policy/isolate.ts":
        "export const allowsTenant = (tenantContext, resource) => tenantContext.tenantId === resource.tenantId;\n",
      "src/tenancy/public/index.ts":
        "export const requireTenant = (tenantContext) => tenantContext.tenantId;\n",
    },
    activeTenancyConfiguration("authenticated-membership"),
  );

  const findings = tenantIsolationProjectFindings(fixture);
  for (const relativePath of [
    "src/orders/Dashboard.astro",
    "src/orders/Included.rs",
    "src/orders/Commented.rs",
    "src/orders/Loaded.rb",
    "src/orders/Handler.cpp",
    "src/Orders/Handler.swift",
  ]) {
    assert.ok(
      findings.some(
        (finding) => finding.includes(relativePath) && finding.includes("public contract or port"),
      ),
      relativePath,
    );
  }
});
