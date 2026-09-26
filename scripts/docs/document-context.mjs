/** Owns bounded navigation of public reference documents without deleting or summarizing their truth. */
import { normalizeRepositoryPath, readRepositoryFile } from "../filesystem/repository-files.mjs";

export const contextOutputByteLimit = 16_384;

/** Reads only public documentation; owned file reads reject symlinks and unsafe ancestors. */
export function readContextDocument(root, requestedPath) {
  const file = normalizeRepositoryPath(requestedPath);
  if (
    !/\.(?:md|html?)$/iu.test(file) ||
    !/^(?:AGENTS\.md$|README\.md$|instructions\.md$|docs\/|design\/|\.agents\/skills\/|\.codex\/README\.md$)/u.test(
      file,
    )
  )
    throw new Error(
      "Context reads require a public repository document, not private runtime or credentials.",
    );
  return { file, content: readRepositoryFile(root, file) };
}

/** Navigation entries use original physical lines. HTML is inspected as text, never executed. */
export function documentContextSections(file, content) {
  const lines = content.split(/\r?\n/u);
  const headings = [];
  let fence = null;
  for (const [index, line] of lines.entries()) {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const markdown = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    const html = /\.(?:html?)$/iu.test(file) ? /<h([1-6])\b[^>]*>(.*?)<\/h\1>/iu.exec(line) : null;
    if (markdown || html)
      headings.push({
        heading: (markdown?.[2] ?? html[2]).replace(/<[^>]+>/gu, "").trim(),
        level: markdown ? markdown[1].length : Number(html[1]),
        start: index + 1,
      });
  }
  return headings.map((entry, index) => ({
    ...entry,
    end:
      headings.slice(index + 1).find((next) => next.level <= entry.level)?.start - 1 ||
      lines.length,
  }));
}

export function boundedContextOutput(text) {
  if (Buffer.byteLength(text, "utf8") > contextOutputByteLimit)
    throw new Error(
      `Context output exceeds ${contextOutputByteLimit} bytes; use --outline, a narrower --section, or --lines. Nothing was truncated.`,
    );
  return text;
}

/** A section must be unique; a line selection is inclusive and never silently clamped. */
export function documentContextExcerpt(
  { file, content },
  { section, lines, outline = false, offset = 0 } = {},
) {
  const sourceLines = content.split(/\r?\n/u);
  const sections = documentContextSections(file, content);
  const header = `${file}: ${Buffer.byteLength(content)} bytes, ${sourceLines.length} lines.\n`;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid outline offset.");
  if (outline) {
    const page = sections.slice(offset, offset + 40);
    return boundedContextOutput(
      header +
        page
          .map((entry) => `${entry.start}-${entry.end} ${"#".repeat(entry.level)} ${entry.heading}`)
          .join("\n") +
        `\nOutline entries ${offset + 1}-${offset + page.length} of ${sections.length}.` +
        (offset + page.length < sections.length
          ? ` Next: --outline --offset ${offset + page.length}.`
          : "") +
        "\nRead the relevant section; an outline is navigation, not substantive evidence.\n",
    );
  }
  if (offset) throw new Error("--offset requires --outline.");
  if (section && lines) throw new Error("Choose either --section or --lines.");
  let start = 1,
    end = sourceLines.length;
  if (section) {
    const matches = sections.filter((entry) => entry.heading === section);
    if (matches.length !== 1)
      throw new Error("Section must match exactly one heading; inspect --outline.");
    ({ start, end } = matches[0]);
  } else if (lines) {
    const range = /^(\d+):(\d+)$/u.exec(lines);
    if (!range) throw new Error("Use --lines <first>:<last>.");
    start = Number(range[1]);
    end = Number(range[2]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < start ||
      end > sourceLines.length
    )
      throw new Error("Line range is outside the document.");
  }
  return boundedContextOutput(
    header +
      `Lines ${start}-${end}; remaining text is not loaded.\n` +
      sourceLines.slice(start - 1, end).join("\n") +
      "\n",
  );
}
