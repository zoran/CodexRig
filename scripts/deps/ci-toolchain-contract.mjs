/** Owns CI toolchain admission to the common private installer and command boundary. */
export function ciAdapterContractViolations(provider, content) {
  if (!["github", "gitlab"].includes(provider))
    throw new Error(`Unsupported CI adapter provider: ${provider}.`);
  const job =
    provider === "github"
      ? content.match(/^  verify:\n[\s\S]*?(?=^  [A-Za-z][\w-]*:|$(?![\s\S]))/mu)?.[0]
      : content.match(/^verify:\n[\s\S]*?(?=^[A-Za-z][\w-]*:|$(?![\s\S]))/mu)?.[0];
  if (!job) return ["stable-verification-job"];
  const requirements = [
    [
      "reviewed-local-install",
      /^\s*(?:-\s+)?(?:run:\s+)?env -u NODE_OPTIONS -u NODE_PATH node scripts\/deps\/maintain-toolchain\.mjs --locked\s*$/mu,
    ],
    ["isolated-verification", /bash -p scripts\/setup\/run-project\.sh pnpm verify\s*$/mu],
  ];
  const findings = requirements.filter(([, pattern]) => !pattern.test(job)).map(([id]) => id);
  // Source-only matrix jobs run before the common project environment exists. Generated product
  // adapters omit these jobs, so their absence is intentional rather than a missing requirement.
  const matrixJob =
    provider === "github"
      ? content.match(/^  compatibility-matrix:\n[\s\S]*?(?=^  [A-Za-z][\w-]*:|$(?![\s\S]))/mu)?.[0]
      : content.match(/^compatibility-matrix:\n[\s\S]*?(?=^[A-Za-z][\w-]*:|$(?![\s\S]))/mu)?.[0];
  const matrixInvocation =
    provider === "github"
      ? /\$\(\s*env\s+-u\s+NODE_OPTIONS\s+-u\s+NODE_PATH\s+node\s+scripts\/framework\/compatibility-matrix\.mjs\s+--github-matrix\s*\)/u
      : /^\s*-\s+env\s+-u\s+NODE_OPTIONS\s+-u\s+NODE_PATH\s+node\s+scripts\/framework\/compatibility-matrix\.mjs\s+--gitlab-child\s+>\s+compatibility-child\.yml\s*$/mu;
  if (matrixJob && !matrixInvocation.test(matrixJob)) findings.push("isolated-matrix-generation");
  const pythonProvision = /\bapt-get\s+install\b[^\n;&|]*\s+python3(?:\s|$)/mu;
  const bootstrapLines = content
    .split("\n")
    .filter((line) => /\bapt-get\s+install\b[^\n;&|]*\bripgrep\s+shellcheck\b/u.test(line));
  if (!pythonProvision.test(job) || bootstrapLines.some((line) => !pythonProvision.test(line)))
    findings.push("linux-cancellation-prerequisite");
  if (!content.includes(provider === "github" ? "merge_group:" : "merge_request_event"))
    findings.push("merge-event");
  if (
    /\b(?:npm|pnpm)\s+(?:install|add)\b[^\n]*(?:--global|-g\b)|\b(?:mise|pnpm)\/action|jdx\/mise-action@/u.test(
      content,
    )
  )
    findings.push("global-tool-install");
  return findings;
}
