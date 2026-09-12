/** Owns generated dependency doc behavior for the portable clean-project generation boundary. */
export const generatedDependencyAgentPolicy = [
  "- Every canonical start inventories worktrees and maintains compatible packages, Node.js, pnpm,",
  "  mise, Codex and CI pins. It stages and installs the candidate under strict peers/engines, then",
  "  atomically publishes unchanged inputs and reproduces offline. Failure stops admission.",
  "  Tool ranges and annotated action majors remain the approved lines; side hooks never update.",
];

export function generatedDependencyReadmePolicy(fence) {
  return [
    "Every canonical start checks official releases and maintains compatible packages, Node.js, pnpm,",
    "mise, Codex and CI pins. The isolated candidate must pass strict peers/engines before a",
    "recoverable input batch and offline installation; failure stops admission. Bootstrap Node.js",
    "must be available before inventory. For first setup or dependency-only refresh, run:",
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
  "Every canonical Codex start checks official releases and maintains compatible packages, Node.js,",
  "pnpm, mise, Codex and CI pins after worktree/recovery inventory and before session admission.",
  "Tools stay within declared compatibility ranges and CI actions within annotated major lines.",
  "Compatibility metadata, mise files and CI adapters are project-owned across framework upgrades.",
  "A complete candidate is installed in isolation, then unchanged inputs permit one recoverable batch",
  "and offline reproduction. Pending plans, unreconciled policies, unsafe writers, registry failure,",
  "changed existing digests/tags or incompatible candidates stop startup. Side hooks never maintain.",
  "Use `mise exec --locked -- node scripts/framework/maintain-toolchain.mjs` for explicit maintenance",
  "inside an authorized slice, or `mise exec --locked -- node scripts/deps/install-compatible.mjs`",
  "for dependency-only refreshes. The dependency transaction resolves the",
  "newest stable versions allowed by every manifest range, pin, override, and supply-chain rule.",
  "Strict peer and Node.js engine checks define compatibility. Only a successful, source-stable",
  "resolution may atomically replace `pnpm-lock.yaml`; installation then reproduces that lockfile",
  "with lifecycle scripts disabled. Registry or installation failure leaves durable dependency",
  "inputs unchanged. A frozen install proves reproducibility, not registry freshness. Moving beyond",
  "declared ranges requires explicit dependency review and affected consumer evidence.",
];
