/** Normalizes source text before static verification evidence is classified. */

function maskedCharacter(character) {
  return character === "\n" || character === "\r" ? character : " ";
}

function maskRange(source, start, end) {
  let masked = "";
  for (let index = start; index < end; index += 1) masked += maskedCharacter(source[index]);
  return masked;
}

/**
 * Removes comments while preserving quoted literals and source offsets.
 *
 * This is intentionally a conservative cross-language lexical pass rather than a parser. It keeps
 * line structure stable so verifier diagnostics and bounded evidence scans remain deterministic.
 */
export function sourceWithoutComments(value) {
  const source = String(value);
  let output = "";
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    const triple = source.slice(index, index + 3);

    if (triple === '"""' || triple === "'''") {
      const end = source.indexOf(triple, index + 3);
      const boundary = end < 0 ? source.length : end + 3;
      output += source.slice(index, boundary);
      index = boundary;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      const quote = character;
      const start = index;
      index += 1;
      let escaped = false;
      while (index < source.length) {
        const current = source[index];
        index += 1;
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === quote) break;
      }
      output += source.slice(start, index);
      continue;
    }
    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      const boundary = end < 0 ? source.length : end + 3;
      output += maskRange(source, index, boundary);
      index = boundary;
      continue;
    }
    if (character === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const boundary = end < 0 ? source.length : end + 2;
      output += maskRange(source, index, boundary);
      index = boundary;
      continue;
    }
    if (character === "/" && next === "/") {
      const end = source.indexOf("\n", index + 2);
      const boundary = end < 0 ? source.length : end;
      output += maskRange(source, index, boundary);
      index = boundary;
      continue;
    }
    if (character === "-" && next === "-") {
      const end = source.indexOf("\n", index + 2);
      const boundary = end < 0 ? source.length : end;
      output += maskRange(source, index, boundary);
      index = boundary;
      continue;
    }
    if (character === "#" && next !== "[" && (index === 0 || /[\s;{}]/u.test(source[index - 1]))) {
      const end = source.indexOf("\n", index + 1);
      const boundary = end < 0 ? source.length : end;
      output += maskRange(source, index, boundary);
      index = boundary;
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

/** Removes comments and literal contents so prose cannot satisfy executable security evidence. */
export function executableSource(value) {
  const source = sourceWithoutComments(value);
  let output = "";
  let index = 0;
  while (index < source.length) {
    const triple = source.slice(index, index + 3);
    if (triple === '"""' || triple === "'''") {
      const end = source.indexOf(triple, index + 3);
      const boundary = end < 0 ? source.length : end + 3;
      output += maskRange(source, index, boundary);
      index = boundary;
      continue;
    }
    const character = source[index];
    if (character === '"' || character === "'" || character === "`") {
      const quote = character;
      const start = index;
      index += 1;
      let escaped = false;
      while (index < source.length) {
        const current = source[index];
        index += 1;
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === quote) break;
      }
      output += maskRange(source, start, index);
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}
