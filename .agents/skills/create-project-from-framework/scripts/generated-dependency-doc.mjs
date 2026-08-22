/** Owns generated dependency doc behavior for the portable clean-project generation boundary. */
export const generatedDependencyAgentPolicy = [
  "- Canonical Codex start is deterministic and never mutates dependencies. Run",
  "  `scripts/deps/install-compatible.mjs` explicitly before first use and whenever dependency",
  "  inputs or requested registry freshness change. It resolves the newest stable allowed graph",
  "  under strict peer/engine checks; range changes remain explicit dependency-maintenance work.",
];

export function generatedDependencyReadmePolicy(fence) {
  return [
    "Canonical Codex start uses the already prepared locked runtime and dependency graph without",
    "network or lockfile mutation. For first setup, explicit refresh, or repair, run:",
    "",
    fence + "bash",
    "mise install --locked",
    "mise exec --locked -- node scripts/deps/install-compatible.mjs",
    "mise exec --locked -- pnpm setup",
    fence,
    "",
    "The compatible installer resolves registry versions in isolation, rejects invalid peer or Node.js",
    "engine combinations, atomically refreshes `pnpm-lock.yaml`, and then installs that exact",
    "resolution with lifecycle scripts disabled. Registry or installation failure leaves durable",
    "dependency inputs unchanged. A frozen install reproduces a reviewed lockfile; it does not",
    "establish registry freshness.",
  ];
}

export const generatedDependencyInstructionsPolicy = [
  "## Dependency Installation And Freshness",
  "",
  "Canonical Codex start never resolves or installs dependencies. Use",
  "`mise exec --locked -- node scripts/deps/install-compatible.mjs` before first use and whenever",
  "workspace dependency inputs or requested registry freshness change. The transaction resolves the",
  "newest stable versions allowed by every manifest range, pin, override, and supply-chain rule.",
  "Strict peer and Node.js engine checks define compatibility. Only a successful, source-stable",
  "resolution may atomically replace `pnpm-lock.yaml`; installation then reproduces that lockfile",
  "with lifecycle scripts disabled. Registry or installation failure leaves durable dependency",
  "inputs unchanged. A frozen install proves reproducibility, not registry freshness. Moving beyond",
  "declared ranges requires explicit dependency review and affected consumer evidence.",
];
