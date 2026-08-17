/** Owns secret patterns behavior for the shared security classification boundary. */
export const secretPatterns = Object.freeze([
  {
    label: "private key block",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    label: "AWS access key",
    regex: /AKIA[0-9A-Z]{16}/,
  },
  {
    label: "Google API key",
    regex: /AIza[0-9A-Za-z_-]{35}/,
  },
  {
    label: "OpenAI-style API key",
    regex: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/,
  },
  {
    label: "Slack token",
    regex: /xox[baprs]-[0-9A-Za-z-]{20,}/,
  },
  {
    label: "GitHub token",
    regex: /(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z_]{36,}/,
  },
  {
    label: "GitHub fine-grained token",
    regex: /github_pat_[0-9A-Za-z_]{20,}/,
  },
  {
    label: "GitLab token",
    regex:
      /\b(?:glagent|glcbt|gldt|glffct|glft|glimt|gloas|glpat|glptt|glrtr?|glsoat|glwt)-[0-9A-Za-z_-]{16,}\b/,
  },
  {
    label: "GitLab session cookie",
    regex: /\b_gitlab_session=[0-9A-Za-z%+/_=-]{20,}/,
  },
  {
    label: "literal named credential",
    regex:
      /(?:^|[\s{[(,?&])["']?\b(?:access[-_]?token|api[-_]?key|client[-_]?(?:key|password|secret|token)|credential(?:s|[-_]?(?:key|password|secret|token))?|database[-_]?(?:key|password|secret|token)|gh[-_]?token|github[-_]?token|gitlab[-_]?token|glab[-_]?token|id[-_]?token|jwt|password(?:[-_]?hash)?|private[-_]?(?:key|token)|refresh[-_]?token|secret(?:[-_]?access[-_]?key)?|service[-_]?(?:key|password|secret|token)|session(?:[-_]?(?:cookie|key|password|secret|token))?|signature|token|[A-Z][A-Z0-9]*[-_](?:KEY|PASSWORD|SECRET|TOKEN))\b["']?\s*(?:=|:)\s*(?:(?<credentialQuote>["'])(?<secretValueQuoted>(?!(?:\$|<|\{|0{8}-|CODEXRIG_|dead|dummy|env(?:ironment)?\.|example|fake|fixture|mock|opaque|os\.environ|placeholder|process\.env|redacted|replacement|sample|secretref|stale|symbolic|synthetic|test|vault|(?:[a-z0-9]+[-_])*runtime[-_]?(?:key|password|secret|token)|(?:config|runtime|state)\.))[0-9A-Za-z][0-9A-Za-z._~+/=!@%^*-]{15,})\k<credentialQuote>|(?<secretValueBare>(?!(?:\$|<|\{|0{8}-|CODEXRIG_|dead|dummy|env(?:ironment)?\.|example|fake|fixture|mock|opaque|os\.environ|placeholder|process\.env|redacted|replacement|sample|secretref|stale|synthetic|test|vault))(?=[0-9A-Za-z._~+/=!@%^*-]{16,}(?=["'\s,;)}\]&]|$))(?=[0-9A-Za-z._~+/=!@%^*-]*[-=+/!@%^*])[0-9A-Za-z][0-9A-Za-z._~+/=!@%^*-]{15,}))(?=["'\s,;)}\]&]|$)/iu,
  },
  {
    label: "literal credential CLI value",
    regex:
      /--(?:access[-_]?token|api[-_]?key|authorization|client[-_]?(?:key|password|secret|token)|credential(?:s|[-_]?(?:key|password|secret|token))?|gh[-_]?token|github[-_]?token|gitlab[-_]?token|glab[-_]?token|password|private[-_]?token|refresh[-_]?token|secret|session[-_]?(?:secret|token)|token)(?:=|\s+)["']?(?<secretValue>(?!(?:\$|<|\{|dummy|env(?:ironment)?\.|example|opaque|os\.environ|placeholder|process\.env|redacted|secretref|test|vault))[0-9A-Za-z][0-9A-Za-z._~+/=!@%^&*-]{15,})/iu,
  },
  {
    label: "HTTP authorization credential",
    regex:
      /["']?(?:Authorization|Proxy-Authorization)["']?\s*:\s*["']?(?:Bearer|Basic|Token)\s+(?<secretValue>(?!(?:\$|<|\{|dummy|env(?:ironment)?\.|example|opaque|os\.environ|placeholder|process\.env|redacted|secretref|test|vault))[0-9A-Za-z][0-9A-Za-z._~+/=-]{15,})/iu,
  },
  {
    label: "credential-bearing connection URI",
    regex:
      /\b(?:amqps?|kafka|mariadb|mongodb(?:\+srv)?|mysql|nats|postgres(?:ql)?|rediss?|sqlserver):\/\/[^:@\s/'"]{1,128}:(?<secretValue>(?!(?:\$|<|\{|dummy|env(?:ironment)?\.|example|opaque|os\.environ|placeholder|process\.env|redacted|secretref|test|vault)[^@\s/'"]*@)[^@\s/'"]{8,})@/iu,
  },
]);

const sensitiveUrlParameterPattern =
  /(?:^|[-_.])(?:access[-_.]?token|api[-_.]?key|assertion|auth(?:orization)?|code|credential|id[-_.]?token|jwt|key|password|passwd|refresh[-_.]?token|samlresponse|secret|session|signature|token)(?:$|[-_.])/iu;
const exactSensitiveUrlParameterNames = new Set(["sig"]);
const sensitiveCredentialNameTokens = new Set([
  "assertion",
  "auth",
  "authorization",
  "code",
  "credential",
  "credentials",
  "jwt",
  "key",
  "passwd",
  "password",
  "secret",
  "session",
  "sig",
  "signature",
  "token",
]);

function credentialNameTokens(value) {
  return String(value)
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1-$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

/** Classifies credential-bearing query or fragment parameter names without provider coupling. */
export function isSensitiveUrlParameterName(value) {
  const normalized = String(value).trim().toLowerCase();
  return (
    exactSensitiveUrlParameterNames.has(normalized) ||
    sensitiveUrlParameterPattern.test(normalized) ||
    credentialNameTokens(value).some((token) => sensitiveCredentialNameTokens.has(token))
  );
}

export function redactSecretMatches(
  content,
  replacement = "<redacted-secret>",
  ignoredCharacters = "",
) {
  const source = String(content);
  const ignored = new Set(String(ignoredCharacters));
  const collapsedToSource = [];
  let collapsed = "";
  for (let index = 0; index < source.length; index += 1) {
    if (ignored.has(source[index])) continue;
    collapsedToSource.push(index);
    collapsed += source[index];
  }

  const ranges = [];
  for (const { regex } of secretPatterns) {
    const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
    const matcher = new RegExp(regex.source, flags);
    for (let match = matcher.exec(collapsed); match; match = matcher.exec(collapsed)) {
      if (match[0].length === 0) continue;
      const capturedValue =
        match.groups?.secretValue ??
        match.groups?.secretValueQuoted ??
        match.groups?.secretValueBare;
      const relativeStart = capturedValue ? match[0].lastIndexOf(capturedValue) : 0;
      const collapsedStart = match.index + relativeStart;
      const collapsedEnd = collapsedStart + (capturedValue?.length ?? match[0].length);
      ranges.push([collapsedToSource[collapsedStart], collapsedToSource[collapsedEnd - 1] + 1]);
    }
  }
  if (ranges.length === 0) return source;

  ranges.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }

  let redacted = "";
  let offset = 0;
  for (const [start, end] of merged) {
    redacted += source.slice(offset, start) + replacement;
    offset = end;
  }
  return redacted + source.slice(offset);
}

export function findSecretMatches(content) {
  const matches = [];
  const lines = content.split(/\r?\n/);

  for (const [lineIndex, line] of lines.entries()) {
    for (const pattern of secretPatterns) {
      if (pattern.regex.test(line)) {
        matches.push({
          line: lineIndex + 1,
          label: pattern.label,
        });
      }
    }
  }

  return matches;
}
