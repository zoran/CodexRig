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
      /(?:run: |^- )?node scripts\/deps\/maintain-toolchain\.mjs --locked\s*$/mu,
    ],
    ["isolated-verification", /bash scripts\/setup\/run-project\.sh pnpm verify\s*$/mu],
  ];
  const findings = requirements.filter(([, pattern]) => !pattern.test(job)).map(([id]) => id);
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
