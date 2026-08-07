export const generatedDependencyAgentPolicy = [
  "- The canonical Codex launcher runs `scripts/deps/install-compatible.mjs` before every session.",
  "  It resolves the newest stable graph allowed by workspace ranges and explicit pins under strict",
  "  peer and Node.js engine checks, then freezes and installs it. A frozen install alone is not a",
  "  freshness check; range changes remain explicit dependency-maintenance work.",
];

export function generatedDependencyReadmePolicy(fence) {
  return [
    "The canonical launcher installs pinned project tools and resolves the newest compatible",
    "dependency graph before Codex starts. For explicit setup or repair, run:",
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
  "Use `mise exec --locked -- node scripts/deps/install-compatible.mjs` for first installation.",
  "The canonical launcher invokes that same transaction before every Codex session.",
  "It resolves the newest stable versions allowed by every workspace manifest range, explicit pin,",
  "override, and supply-chain rule in isolation.",
  "Strict peer and Node.js engine checks define compatibility. Only a successful, source-stable",
  "resolution may atomically replace `pnpm-lock.yaml`; installation then reproduces that lockfile",
  "with lifecycle scripts disabled. Registry or installation failure leaves durable dependency",
  "inputs unchanged. A frozen install proves reproducibility, not registry freshness. Moving beyond",
  "declared ranges requires explicit dependency review and affected consumer evidence.",
];
