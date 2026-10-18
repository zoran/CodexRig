/** Owns shared Markdown fence state for document navigation, headings and reference extraction. */

/** Yields original line indices and text outside matching fenced code blocks. */
export function* markdownLinesOutsideFences(lines) {
  let fence = null;
  for (const [index, line] of lines.entries()) {
    const marker = /^\s*(`{3,}|~{3,})(.*)$/u.exec(line);
    if (marker) {
      const delimiter = marker[1];
      if (!fence) fence = delimiter;
      else if (
        delimiter[0] === fence[0] &&
        delimiter.length >= fence.length &&
        marker[2].trim() === ""
      )
        fence = null;
      continue;
    }
    if (!fence) yield [index, line];
  }
}
