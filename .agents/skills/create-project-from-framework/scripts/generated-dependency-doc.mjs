/** Owns generated dependency doc behavior for the portable clean-project generation boundary. */
export const generatedDependencyAgentPolicy = [
  "- Every canonical start inventories worktrees and maintains compatible packages, Node.js, pnpm,",
  "  mise, Codex and CI pins. It stages and installs the candidate under strict peers/engines, then",
  "  atomically publishes unchanged inputs and reproduces offline. Failure stops admission.",
  "  Tool ranges and annotated action majors remain the approved lines; side hooks never update.",
];

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
