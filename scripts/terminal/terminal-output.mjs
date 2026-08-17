/** Owns terminal output behavior for the safe terminal diagnostics boundary. */
import { isSensitiveUrlParameterName, redactSecretMatches } from "../security/secret-patterns.mjs";

const ansiEscapePattern =
  /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;
const controlPattern = /[\u0000-\u001f\u007f-\u009f]/g;
const multilineControlPattern = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;
const formatControlPattern = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu;
const terminalSeparator = "\ue000";
const credentialHeaderNames = new Set(["cookie", "set-cookie"]);

export function sanitizeForTerminal(value) {
  return String(value)
    .replace(ansiEscapePattern, "")
    .replace(controlPattern, " ")
    .replace(formatControlPattern, "");
}

export function truncateForTerminal(value, maxLength = 180) {
  const sanitized = sanitizeForTerminal(value).trim();
  if (sanitized.length <= maxLength) return sanitized;
  return `${sanitized.slice(0, maxLength - 3)}...`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceKnownRoot(output, candidate) {
  if (!candidate) return output;
  const leftBoundary = "(^|[^A-Za-z0-9._/\\\\])";
  const rightBoundary = "(?=$|[\\\\/\\s\"'`()<>\\[\\]{}:,;])";
  const pattern = new RegExp(`${leftBoundary}${escapeRegExp(candidate)}${rightBoundary}`, "gm");
  return output.replace(pattern, (_match, prefix) => `${prefix}.`);
}

function sanitizeUrlParameters(parameters) {
  let changed = false;
  for (const key of [...parameters.keys()]) {
    if (!isSensitiveUrlParameterName(key)) continue;
    parameters.set(key, "<redacted-secret>");
    changed = true;
  }
  return changed;
}

function sensitiveCredentialName(value) {
  const source = String(value);
  const collapsed = source.replaceAll(terminalSeparator, "");
  if (
    isSensitiveUrlParameterName(collapsed) ||
    credentialHeaderNames.has(collapsed.toLowerCase())
  ) {
    return true;
  }
  return source
    .split(terminalSeparator)
    .filter(Boolean)
    .some(
      (part) => isSensitiveUrlParameterName(part) || credentialHeaderNames.has(part.toLowerCase()),
    );
}

function diagnosticNameBeforeDelimiter(value) {
  let candidate = String(value).replace(/\s+$/u, "");
  const wrapped = /^\s*[\[({]\s*([^\])}]+?)\s*[\])}]\s*$/u.exec(candidate);
  if (wrapped) candidate = wrapped[1];
  else {
    const punctuationBoundary = Math.max(
      candidate.lastIndexOf(":"),
      candidate.lastIndexOf("="),
      candidate.lastIndexOf(","),
      candidate.lastIndexOf(";"),
      candidate.lastIndexOf("{"),
      candidate.lastIndexOf("("),
      candidate.lastIndexOf("["),
      candidate.lastIndexOf("}"),
      candidate.lastIndexOf(")"),
      candidate.lastIndexOf("]"),
    );
    if (punctuationBoundary !== -1) {
      candidate = candidate.slice(punctuationBoundary + 1).trimStart();
    }
  }
  candidate = candidate
    .replace(new RegExp(`^[${terminalSeparator}\\s]+`, "u"), "")
    .replace(/^--/u, "")
    .replace(/^["'\[({]+/u, "")
    .replace(/["'\])}]+$/u, "")
    .trim();
  const labelWords = candidate.replaceAll(terminalSeparator, " ").trim().split(/\s+/u);
  if (labelWords.length > 4 || (labelWords.length > 1 && /[.!?]/u.test(candidate))) return null;
  return new RegExp(`^[A-Za-z][A-Za-z0-9_.\\-${terminalSeparator} ]{0,120}$`, "u").test(candidate)
    ? candidate
    : null;
}

function firstDiagnosticDelimiter(line, { sensitiveOnly = false } = {}) {
  const protectedUrls = safeWebUrlRanges(line);
  for (const delimiter of line.matchAll(/[:=]/gu)) {
    if (protectedUrls.some(([start, end]) => delimiter.index >= start && delimiter.index < end)) {
      continue;
    }
    const name = diagnosticNameBeforeDelimiter(line.slice(0, delimiter.index));
    if (name && (!sensitiveOnly || sensitiveCredentialName(name))) {
      return { delimiterIndex: delimiter.index, name };
    }
  }
  return null;
}

function redactPrivateKeyBlocks(value) {
  const output = [];
  let expectedEnd = null;
  for (const line of String(value).split("\n")) {
    const comparable = line.replaceAll(terminalSeparator, "");
    if (expectedEnd) {
      if (comparable.includes(expectedEnd)) expectedEnd = null;
      output.push("");
      continue;
    }
    const begin = /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----/u.exec(comparable);
    if (!begin) {
      output.push(line);
      continue;
    }
    const sourcePrefixLength = [...line].findIndex((_character, index) => {
      const collapsed = line.slice(0, index).replaceAll(terminalSeparator, "");
      return collapsed.length >= begin.index;
    });
    const prefix = sourcePrefixLength < 0 ? "" : line.slice(0, sourcePrefixLength);
    output.push(`${prefix}<redacted-secret>`);
    const endMarker = `-----END ${begin[1]}-----`;
    if (!comparable.slice(begin.index + begin[0].length).includes(endMarker)) {
      expectedEnd = endMarker;
    }
  }
  return output.join("\n");
}

function multilineCredentialStyle(remainder) {
  const value = String(remainder).trim();
  if (/^[|>][+-]?$/u.test(value)) return { kind: "yaml" };
  if (value.startsWith('"""') && !value.slice(3).includes('"""')) {
    return { delimiter: '"""', kind: "quoted" };
  }
  if (value.startsWith("'''") && !value.slice(3).includes("'''")) {
    return { delimiter: "'''", kind: "quoted" };
  }
  return value ? null : { kind: "continued" };
}

function urlLikeTokenContainsSplitCredential(value) {
  if (!String(value).includes(terminalSeparator)) return false;
  const parameterText = String(value).replace(/^[^?#]*[?#]/u, "");
  for (const parameter of parameterText.split(/[&#]/u)) {
    const delimiter = parameter.indexOf("=");
    if (delimiter === -1) continue;
    const rawName = parameter.slice(0, delimiter);
    let decodedName = rawName;
    try {
      decodedName = decodeURIComponent(rawName);
    } catch {
      return true;
    }
    if (sensitiveCredentialName(decodedName)) return true;
  }
  return false;
}

function redactNamedCredentialDiagnostics(value) {
  const lines = String(value).split("\n");
  const output = [];
  let pendingValue = null;
  for (const line of lines) {
    if (pendingValue) {
      const indentation = /^\s*/u.exec(line)?.[0].length ?? 0;
      const closesQuotedValue =
        pendingValue.kind === "quoted" && line.includes(pendingValue.delimiter);
      const yamlBoundary =
        pendingValue.kind === "yaml" && line.trim() && indentation <= pendingValue.indentation;
      const continuedBoundary =
        pendingValue.kind === "continued" && Boolean(firstDiagnosticDelimiter(line));
      if (!yamlBoundary && !continuedBoundary) {
        output.push(line.trim() ? `${/^\s*/u.exec(line)?.[0] ?? ""}<redacted-secret>` : "");
        if (closesQuotedValue) pendingValue = null;
        continue;
      }
      pendingValue = null;
    }

    const diagnostic = firstDiagnosticDelimiter(line, { sensitiveOnly: true });
    if (diagnostic) {
      const valueOffset = diagnostic.delimiterIndex + 1;
      const remainder = line.slice(valueOffset);
      output.push(`${line.slice(0, valueOffset)}<redacted-secret>`);
      const style = multilineCredentialStyle(remainder);
      pendingValue = style ? { ...style, indentation: /^\s*/u.exec(line)?.[0].length ?? 0 } : null;
      continue;
    }

    output.push(line);
  }
  return output.join("\n");
}

function sanitizeUrlFragment(parsed) {
  const rawFragment = parsed.hash.slice(1);
  if (!rawFragment) return false;
  const queryIndex = rawFragment.indexOf("?");
  const prefix = queryIndex === -1 ? "" : rawFragment.slice(0, queryIndex + 1);
  const parameterText = queryIndex === -1 ? rawFragment : rawFragment.slice(queryIndex + 1);
  if (!parameterText.includes("=")) return false;
  const parameters = new URLSearchParams(parameterText);
  const changed = sanitizeUrlParameters(parameters);
  if (changed) parsed.hash = `${prefix}${parameters.toString()}`;
  return changed;
}

function sanitizeWebUrls(value) {
  return String(value)
    .split("\n")
    .map((line) => {
      const pattern = /https?:\/\/[^\s]+/giu;
      let output = "";
      let cursor = 0;
      for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
        output += line.slice(cursor, match.index);
        const controlSplit = match[0].includes(terminalSeparator);
        if (urlLikeTokenContainsSplitCredential(match[0])) {
          output += "<redacted-url>";
          cursor = match.index + match[0].length;
          continue;
        }
        let parsed;
        try {
          parsed = new URL(match[0].replaceAll(terminalSeparator, ""));
        } catch {
          // A failed parse leaves every later userinfo/query boundary on this line ambiguous.
          return `${output}<redacted-url>`;
        }
        const containedCredentials = Boolean(parsed.username || parsed.password);
        parsed.username = "";
        parsed.password = "";
        const redactedQuery = sanitizeUrlParameters(parsed.searchParams);
        const redactedFragment = sanitizeUrlFragment(parsed);
        output +=
          controlSplit && (containedCredentials || redactedQuery || redactedFragment)
            ? "<redacted-url>"
            : parsed.toString();
        cursor = match.index + match[0].length;
        if (
          (containedCredentials || redactedQuery || redactedFragment) &&
          line.slice(cursor).trim()
        ) {
          // Raw whitespace can split a credential value. Once credentials were observed, the
          // remainder of the diagnostic is not a trustworthy public boundary.
          return output;
        }
      }
      return output + line.slice(cursor);
    })
    .join("\n");
}

function safeWebUrlRanges(line) {
  const ranges = [];
  const pattern = /https?:\/\/[^\s]+/gi;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

function firstUnknownAbsolutePathIndex(line) {
  const protectedRanges = safeWebUrlRanges(line);
  let protectedIndex = 0;
  const isPathLeftBoundary = (index) => index === 0 || !/[A-Za-z0-9._/\\]/.test(line[index - 1]);

  for (let index = 0; index < line.length; index += 1) {
    const range = protectedRanges[protectedIndex];
    if (range && index >= range[1]) {
      protectedIndex += 1;
      index -= 1;
      continue;
    }
    if (range && index >= range[0]) {
      index = range[1] - 1;
      protectedIndex += 1;
      continue;
    }

    const remainder = line.slice(index);
    if (/^file:\/\//i.test(remainder) && isPathLeftBoundary(index)) return index;
    if (/^[A-Za-z]:[\\/]/.test(remainder) && isPathLeftBoundary(index)) return index;
    if (remainder.startsWith("\\\\") || remainder.startsWith("//")) return index;
    if (line[index] === "/" && isPathLeftBoundary(index)) return index;
  }
  return -1;
}

export function redactLocalPaths(value, rootPath = process.cwd()) {
  let output = String(value);
  const rawRoot = String(rootPath).replace(/[\\/]+$/, "");
  const normalizedRoot = rawRoot.replaceAll("\\", "/");
  if (normalizedRoot) {
    const fileRoot = /^[A-Za-z]:\//.test(normalizedRoot)
      ? `file:///${normalizedRoot}`
      : `file://${normalizedRoot}`;
    output = replaceKnownRoot(output, fileRoot);
    for (const candidate of new Set([rawRoot, normalizedRoot])) {
      output = replaceKnownRoot(output, candidate);
    }
  }
  return output
    .split("\n")
    .map((line) => {
      const pathIndex = firstUnknownAbsolutePathIndex(line);
      return pathIndex === -1 ? line : `${line.slice(0, pathIndex)}<local-path>`;
    })
    .join("\n");
}

export function sanitizeMultilineForTerminal(value, rootPath = process.cwd()) {
  const normalized = String(value)
    .replace(/\r\n?/g, "\n")
    .replace(ansiEscapePattern, terminalSeparator)
    .replace(multilineControlPattern, terminalSeparator)
    .replace(formatControlPattern, terminalSeparator);
  const privateKeys = redactPrivateKeyBlocks(normalized);
  const redacted = redactSecretMatches(privateKeys, "<redacted-secret>", terminalSeparator);
  // Keep the sentinel as a source boundary for URL/path fail-closed handling, while the named
  // classifier collapses it only inside credential names. This catches control-split names without
  // turning `prefix<control>/absolute/path` into an apparently harmless relative path.
  const namedCredentials = redactNamedCredentialDiagnostics(redacted);
  const sanitizedUrls = sanitizeWebUrls(namedCredentials).replaceAll(terminalSeparator, " ");
  return redactLocalPaths(sanitizedUrls, rootPath);
}

/** Renders argv without exposing a separate value owned by a long sensitive option. */
export function sanitizeCommandForTerminal(executable, args = [], rootPath = process.cwd()) {
  let redactNext = false;
  const rendered = [executable, ...args].map((value, index) => {
    if (index > 0 && redactNext) {
      redactNext = false;
      return "<redacted-secret>";
    }
    const argument = String(value);
    const sanitizedArgument = sanitizeForTerminal(argument);
    const classificationArgument = sanitizedArgument.replace(/\s+/gu, "");
    const option = /^--([A-Za-z][A-Za-z0-9_.-]{0,80})$/u.exec(classificationArgument);
    if (option && isSensitiveUrlParameterName(option[1])) redactNext = true;
    return sanitizedArgument;
  });
  return sanitizeMultilineForTerminal(rendered.join(" "), rootPath);
}

export function formatContextError(error, rootPath = process.cwd()) {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = sanitizeMultilineForTerminal(message, rootPath);
  return truncateForTerminal(redacted, 500);
}
