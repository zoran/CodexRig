/** Owns portable toml bootstrap behavior for the versioned framework contract boundary. */
function stripComment(line) {
  let quote = "";
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (line.startsWith('\"\"\"', index)) {
      index += 2;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "#") return line.slice(0, index);
  }
  if (quote) throw new Error("unterminated string");
  return line;
}

function splitArray(value) {
  const entries = [];
  let quote = "";
  let escaped = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === ",") {
      entries.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quote) throw new Error("unterminated array string");
  entries.push(value.slice(start).trim());
  return entries.filter(Boolean);
}

function scalar(value) {
  const source = value.trim();
  if (source === "true") return true;
  if (source === "false") return false;
  if (/^(?:0|[1-9][0-9_]*)$/u.test(source)) return Number(source.replaceAll("_", ""));
  if (source.startsWith('"') && source.endsWith('"')) return JSON.parse(source);
  if (source.startsWith("'") && source.endsWith("'")) {
    const content = source.slice(1, -1);
    if (content.includes("'")) throw new Error("unsupported quote in literal string");
    return content;
  }
  if (source.startsWith("[") && source.endsWith("]")) {
    return splitArray(source.slice(1, -1)).map((entry) => scalar(entry));
  }
  throw new Error("unsupported portable TOML value");
}

function tableAt(root, tablePath, definedTables) {
  const segments = tablePath.split(".");
  if (
    segments.some((segment) => !/^[A-Za-z0-9_-]+$/u.test(segment)) ||
    definedTables.has(tablePath)
  ) {
    throw new Error(`invalid or duplicate table ${tablePath}`);
  }
  let table = root;
  for (const segment of segments) {
    if (!Object.hasOwn(table, segment)) table[segment] = {};
    if (!table[segment] || typeof table[segment] !== "object" || Array.isArray(table[segment])) {
      throw new Error(`table ${tablePath} conflicts with an existing value`);
    }
    table = table[segment];
  }
  definedTables.add(tablePath);
  return table;
}

function assignment(line) {
  const match = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/u.exec(line);
  if (!match) throw new Error("unsupported portable TOML statement");
  return { key: match[1], value: match[2] };
}

export function parsePortableTomlBootstrap(content) {
  const root = {};
  const definedTables = new Set();
  let table = root;
  const lines = String(content)
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const sourceLine = stripComment(lines[index]).trim();
    if (!sourceLine) continue;
    const tableMatch = /^\[([^\]]+)\]$/u.exec(sourceLine);
    if (tableMatch) {
      table = tableAt(root, tableMatch[1].trim(), definedTables);
      continue;
    }
    const { key, value } = assignment(sourceLine);
    if (Object.hasOwn(table, key)) throw new Error(`duplicate key ${key}`);
    if (value.startsWith('"""')) {
      const chunks = [];
      let remainder = value.slice(3);
      let closed = false;
      while (true) {
        const close = remainder.indexOf('"""');
        if (close >= 0) {
          if (remainder.slice(close + 3).trim()) {
            throw new Error(`content follows multiline value ${key}`);
          }
          chunks.push(remainder.slice(0, close));
          closed = true;
          break;
        }
        chunks.push(remainder);
        index += 1;
        if (index >= lines.length) break;
        remainder = lines[index];
      }
      if (!closed) throw new Error(`unterminated multiline value ${key}`);
      table[key] = chunks.join("\n").replace(/^\n/u, "");
    } else {
      table[key] = scalar(value);
    }
  }
  return root;
}
