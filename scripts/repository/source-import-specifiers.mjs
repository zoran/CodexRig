/** Extracts repository import specifiers across the source languages claimed by architecture checks. */
import path from "node:path";

export const javascriptImportSourceExtensions = Object.freeze([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const javascriptLikeExtensions = new Set(javascriptImportSourceExtensions);

export const architecturalSourceExtensions = Object.freeze([
  ...javascriptImportSourceExtensions,
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".go",
  ".h",
  ".hpp",
  ".java",
  ".kt",
  ".kts",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".swift",
]);

export const embeddedScriptSourceExtensions = Object.freeze([".astro", ".html", ".svelte", ".vue"]);

export const localImportResolvableExtensions = Object.freeze([
  ...architecturalSourceExtensions,
  ...embeddedScriptSourceExtensions,
]);

function addPatternMatches(specifiers, content, patterns) {
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) specifiers.add(match[1]);
    }
  }
}

function copyLiteral(content, start) {
  const rustRaw = /^r(#{0,255})"/u.exec(content.slice(start));
  if (rustRaw) {
    const closing = `"${rustRaw[1]}`;
    const end = content.indexOf(closing, start + rustRaw[0].length);
    return end === -1 ? content.length : end + closing.length;
  }
  if (content.startsWith('R"', start)) {
    const delimiterEnd = content.indexOf("(", start + 2);
    if (delimiterEnd !== -1) {
      const delimiter = content.slice(start + 2, delimiterEnd);
      if (delimiter.length <= 16 && !/[\s\\()]/u.test(delimiter)) {
        const closing = `)${delimiter}"`;
        const end = content.indexOf(closing, delimiterEnd + 1);
        if (end !== -1) return end + closing.length;
      }
    }
  }
  if (content.startsWith('@"', start)) {
    let index = start + 2;
    while (index < content.length) {
      if (content[index] === '"') {
        if (content[index + 1] === '"') index += 2;
        else return index + 1;
      } else index += 1;
    }
    return content.length;
  }
  for (const delimiter of ['"""', "'''", '"', "'", "`"]) {
    if (!content.startsWith(delimiter, start)) continue;
    let index = start + delimiter.length;
    while (index < content.length) {
      if (content.startsWith(delimiter, index)) return index + delimiter.length;
      if (delimiter.length === 1 && content[index] === "\\") index += 2;
      else index += 1;
    }
    return content.length;
  }
  return null;
}

function sourceWithoutCStyleComments(
  content,
  { blockComments = true, hashLineComments = false, slashLineComments = true } = {},
) {
  let output = "";
  for (let index = 0; index < content.length; index += 1) {
    const literalEnd = copyLiteral(content, index);
    if (literalEnd !== null) {
      output += content.slice(index, literalEnd);
      index = literalEnd - 1;
      continue;
    }
    if (blockComments && content[index] === "/" && content[index + 1] === "*") {
      output += "  ";
      index += 2;
      let depth = 1;
      while (index < content.length && depth > 0) {
        if (content[index] === "/" && content[index + 1] === "*") {
          output += "  ";
          index += 2;
          depth += 1;
          continue;
        }
        if (content[index] === "*" && content[index + 1] === "/") {
          output += "  ";
          index += 2;
          depth -= 1;
          continue;
        }
        output += content[index] === "\n" || content[index] === "\r" ? content[index] : " ";
        index += 1;
      }
      index -= 1;
      continue;
    }
    if (
      (slashLineComments && content[index] === "/" && content[index + 1] === "/") ||
      (hashLineComments && content[index] === "#")
    ) {
      const markerLength = content[index] === "#" ? 1 : 2;
      output += " ".repeat(markerLength);
      index += markerLength;
      while (index < content.length && !["\n", "\r"].includes(content[index])) {
        output += " ";
        index += 1;
      }
      if (index < content.length) output += content[index];
      continue;
    }
    output += content[index];
  }
  return output;
}

function decodedJavascriptLiteral(source, start) {
  const delimiter = source[start];
  if (!['"', "'", "`"].includes(delimiter)) return null;
  let value = "";
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === delimiter) return { end: index + 1, value };
    if (delimiter === "`" && character === "$" && source[index + 1] === "{") return null;
    if (character !== "\\") {
      value += character;
      continue;
    }
    index += 1;
    if (index >= source.length) return null;
    const escaped = source[index];
    if (escaped === "\n") continue;
    if (escaped === "\r") {
      if (source[index + 1] === "\n") index += 1;
      continue;
    }
    const simpleEscapes = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" };
    if (Object.hasOwn(simpleEscapes, escaped)) value += simpleEscapes[escaped];
    else if (escaped === "0" && !/\d/u.test(source[index + 1] ?? "")) value += "\0";
    else if (escaped === "x") {
      const digits = source.slice(index + 1, index + 3);
      if (!/^[a-f\d]{2}$/iu.test(digits)) return null;
      value += String.fromCodePoint(Number.parseInt(digits, 16));
      index += 2;
    } else if (escaped === "u") {
      const braced = /^\{([a-f\d]{1,6})\}/iu.exec(source.slice(index + 1));
      const digits = braced?.[1] ?? source.slice(index + 1, index + 5);
      if (!/^[a-f\d]{4}$/iu.test(digits) && !braced) return null;
      const codePoint = Number.parseInt(digits, 16);
      if (codePoint > 0x10ffff) return null;
      value += String.fromCodePoint(codePoint);
      index += braced ? braced[0].length : 4;
    } else value += escaped;
  }
  return null;
}

function staticJavascriptStringExpression(source) {
  let expression = source.trim();
  while (expression.startsWith("(") && expression.endsWith(")")) {
    let depth = 0;
    let wrapsExpression = true;
    for (let index = 0; index < expression.length; index += 1) {
      const literal = copyLiteral(expression, index);
      if (literal !== null) {
        index = literal - 1;
        continue;
      }
      if (expression[index] === "(") depth += 1;
      else if (expression[index] === ")") {
        depth -= 1;
        if (depth === 0 && index !== expression.length - 1) wrapsExpression = false;
      }
    }
    if (!wrapsExpression || depth !== 0) break;
    expression = expression.slice(1, -1).trim();
  }
  let index = 0;
  let value = "";
  let literalCount = 0;
  while (index < expression.length) {
    while (/\s/u.test(expression[index] ?? "")) index += 1;
    const literal = decodedJavascriptLiteral(expression, index);
    if (!literal) return null;
    value += literal.value;
    literalCount += 1;
    index = literal.end;
    while (/\s/u.test(expression[index] ?? "")) index += 1;
    if (index === expression.length) return literalCount > 0 ? value : null;
    if (expression[index] !== "+") return null;
    index += 1;
  }
  return null;
}

function firstCallArgument(source, openParenthesis) {
  const start = openParenthesis + 1;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const literalEnd = copyLiteral(source, index);
    if (literalEnd !== null) {
      index = literalEnd - 1;
      continue;
    }
    if (["(", "[", "{"].includes(source[index])) depth += 1;
    else if (["]", "}"].includes(source[index])) depth -= 1;
    else if (source[index] === ")") {
      if (depth === 0) return source.slice(start, index);
      depth -= 1;
    } else if (source[index] === "," && depth === 0) return source.slice(start, index);
  }
  return null;
}

function javascriptImports(content, specifiers) {
  const commentless = sourceWithoutCStyleComments(content);
  addPatternMatches(specifiers, commentless, [
    /\b(?:export|import)\s+(?:[^;"']*?\s+from\s+)?["']([^"']+)["']/gu,
  ]);
  for (const match of commentless.matchAll(
    /\b(?:require\s*\.\s*resolve|import\s*\.\s*meta\s*\.\s*resolve|require|import)\s*(?:\?\.\s*)?\(/gu,
  )) {
    const openParenthesis = match.index + match[0].lastIndexOf("(");
    const argument = firstCallArgument(commentless, openParenthesis);
    if (argument === null) continue;
    const specifier = staticJavascriptStringExpression(argument);
    if (specifier) specifiers.add(specifier);
  }
}

function embeddedJavascriptImports(content, extension, specifiers) {
  if (extension === ".astro") {
    const frontmatter = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u.exec(
      content,
    )?.[1];
    if (frontmatter) javascriptImports(frontmatter, specifiers);
  }
  for (const match of content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)) {
    const sourceMatch = /\bsrc\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/iu.exec(match[1]);
    const source = sourceMatch?.[1] ?? sourceMatch?.[2];
    if (source) specifiers.add(source);
    javascriptImports(match[2], specifiers);
  }
}

function dottedSpecifier(value) {
  const input = String(value).trim();
  const relativePrefix = /^(\.+)/u.exec(input)?.[1] ?? "";
  const tail = input.slice(relativePrefix.length).replaceAll(".", "/");
  if (!relativePrefix) return tail;
  const prefix = relativePrefix.length === 1 ? "./" : "../".repeat(relativePrefix.length - 1);
  return `${prefix}${tail}`.replace(/\/$/u, "");
}

function pythonImports(content, specifiers) {
  const normalized = content.replace(/\\(?:\r\n|\n|\r)/gu, " ");
  for (const match of normalized.matchAll(
    /(?:^|;)\s*from\s+(\.*(?:[A-Za-z_]\w*(?:\.\w+)*)?)\s+import\s+(\([^)]*\)|[^#\n;]+)/gmu,
  )) {
    const moduleName = match[1];
    if (/^\.+$/u.test(moduleName)) {
      const prefix = moduleName.length === 1 ? "./" : "../".repeat(moduleName.length - 1);
      for (const item of match[2].replace(/[()]/gu, "").split(",")) {
        const importedName = /^\s*([A-Za-z_]\w*)/u.exec(item)?.[1];
        if (importedName) specifiers.add(`${prefix}${importedName}`);
      }
    } else {
      specifiers.add(dottedSpecifier(moduleName));
    }
  }
  for (const match of normalized.matchAll(/(?:^|;)\s*import\s+([^#\n;]+)/gmu)) {
    for (const item of match[1].split(",")) {
      const moduleName = /^\s*([A-Za-z_]\w*(?:\.\w+)*)/u.exec(item)?.[1];
      if (moduleName) specifiers.add(dottedSpecifier(moduleName));
    }
  }
  for (const match of normalized.matchAll(
    /\b(?:importlib\s*\.\s*import_module|__import__)\s*\(\s*["']([^"']+)["']/gu,
  )) {
    specifiers.add(dottedSpecifier(match[1]));
  }
}

function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "{") depth += 1;
    else if (value[index] === "}") depth -= 1;
    else if (value[index] === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function expandedRustUseTree(value) {
  const declaration = value.trim();
  const open = declaration.indexOf("{");
  if (open === -1) return [declaration];
  let depth = 0;
  let close = -1;
  for (let index = open; index < declaration.length; index += 1) {
    if (declaration[index] === "{") depth += 1;
    else if (declaration[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close === -1 || declaration.slice(close + 1).trim()) return [];
  const prefix = declaration.slice(0, open).replace(/::?\s*$/u, "");
  return splitTopLevel(declaration.slice(open + 1, close)).flatMap((item) =>
    expandedRustUseTree(item === "self" ? prefix : `${prefix}::${item}`),
  );
}

function rustImports(content, specifiers) {
  for (const match of content.matchAll(
    /(?:^|(?<=;))\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([^;]+);/gmu,
  )) {
    for (const value of expandedRustUseTree(match[1])) {
      const withoutAlias = value
        .replace(/\s+as\s+\w+\s*$/u, "")
        .replace(/::\*$/u, "")
        .replace(/::self$/u, "")
        .replace(/(?:^|::)r#(?=[A-Za-z_])/gu, (prefix) => prefix.replace("r#", ""));
      const segments = withoutAlias.split("::").filter(Boolean);
      let offset = 0;
      while (segments[offset] === "super") offset += 1;
      if (offset > 0) {
        specifiers.add(`${"../".repeat(offset)}${segments.slice(offset).join("/")}`);
      } else if (segments[0] === "self") {
        specifiers.add(`./${segments.slice(1).join("/")}`);
      } else {
        specifiers.add(segments.slice(segments[0] === "crate" ? 1 : 0).join("/"));
      }
    }
  }
  addPatternMatches(specifiers, content, [
    /#\s*\[\s*path\s*=\s*["']([^"']+)["']\s*\]\s*(?:pub\s+)?mod\s+\w+\s*;/gu,
    /\binclude!\s*\(\s*["']([^"']+)["']\s*\)/gu,
    /(?:^|(?<=;))\s*(?:#\s*\[[^\]]+\]\s*)*(?:pub\s+)?extern\s+crate\s+(?:r#)?([A-Za-z_]\w*)(?:\s+as\s+\w+)?\s*;/gmu,
  ]);
  for (const match of content.matchAll(
    /(?:^|(?<=;))\s*(?:#\s*\[[^\]]+\]\s*)*(?:pub(?:\([^)]*\))?\s+)?mod\s+(?:r#)?([A-Za-z_]\w*)\s*;/gmu,
  )) {
    specifiers.add(`./${match[1]}`);
  }
}

function goImports(content, specifiers) {
  addPatternMatches(specifiers, content, [
    /(?:^|;)\s*import\s+(?:[._A-Za-z]\w*\s+)?"([^"]+)"/gmu,
    /(?:^|;)\s*import\s+(?:[._A-Za-z]\w*\s+)?`([^`]+)`/gmu,
  ]);
  for (const block of content.matchAll(/\bimport\s*\(([^)]*)\)/gsu)) {
    addPatternMatches(specifiers, block[1], [
      /^\s*(?:[._A-Za-z]\w*\s+)?"([^"]+)"/gmu,
      /^\s*(?:[._A-Za-z]\w*\s+)?`([^`]+)`/gmu,
    ]);
  }
}

function namespaceImports(content, specifiers, keyword = "import") {
  const segment = "(?:[A-Za-z_]\\w*|`[^`\\r\\n]+`)";
  const pattern = new RegExp(
    `(?:^|;)\\s*${keyword}\\s+(?:static\\s+)?(${segment}(?:\\.${segment})*)`,
    "gmu",
  );
  for (const match of content.matchAll(pattern)) {
    specifiers.add(dottedSpecifier(match[1].replaceAll("`", "")));
  }
}

function csharpImports(content, specifiers) {
  for (const match of content.matchAll(
    /(?:^|;)\s*(?:global\s+)?using\s+(?:static\s+)?(?:@?[A-Za-z_]\w*\s*=\s*)?(@?[A-Za-z_]\w*(?:(?:\.|::)@?[A-Za-z_]\w*)*)/gmu,
  )) {
    specifiers.add(dottedSpecifier(match[1].replace(/^@?[A-Za-z_]\w*::/u, "").replaceAll("@", "")));
  }
}

function phpImports(content, specifiers) {
  for (const match of content.matchAll(
    /(?:^|(?<=;))\s*(?:<\?php\s*)?use\s+(?:function\s+|const\s+)?([^;]+);/gmu,
  )) {
    for (const item of splitTopLevel(match[1])) {
      const group = /^(.*)\\\{([^{}]+)\}$/u.exec(item);
      const values = group
        ? splitTopLevel(group[2]).map((entry) => `${group[1]}\\${entry}`)
        : [item];
      for (const value of values) {
        const owner = value
          .trim()
          .replace(/^\\+/u, "")
          .replace(/\s+as\s+\w+$/iu, "");
        if (owner) specifiers.add(owner.replaceAll("\\", "/"));
      }
    }
  }
  addPatternMatches(specifiers, content, [
    /\b(?:include|include_once|require|require_once)\s*\(?\s*["']([^"']+)["']/gu,
  ]);
  for (const match of content.matchAll(
    /\b(?:include|include_once|require|require_once)\s*\(?\s*__DIR__\s*\.\s*["']([^"']+)["']/gu,
  )) {
    const relative = match[1].startsWith("/") ? `.${match[1]}` : match[1];
    if (relative) specifiers.add(relative);
  }
  for (const match of content.matchAll(
    /\b(?:include|include_once|require|require_once)\s*\(?\s*dirname\s*\(\s*__DIR__\s*\)\s*\.\s*["']([^"']+)["']/gu,
  )) {
    const relative = match[1].replace(/^\/+/, "");
    if (relative) specifiers.add(`../${relative}`);
  }
}

/** Extracts normalized import specifiers for every source language claimed by boundary checks. */
export function importSpecifiersForFile(file) {
  const content = String(file.content);
  const extension = path.posix.extname(file.relativePath).toLowerCase();
  const specifiers = new Set();
  if (javascriptLikeExtensions.has(extension)) javascriptImports(content, specifiers);
  else if (embeddedScriptSourceExtensions.includes(extension)) {
    embeddedJavascriptImports(content, extension, specifiers);
  } else if (extension === ".py") pythonImports(content, specifiers);
  else if (extension === ".rs") rustImports(sourceWithoutCStyleComments(content), specifiers);
  else if ([".c", ".cc", ".cpp", ".h", ".hpp"].includes(extension)) {
    const preprocessed = sourceWithoutCStyleComments(content.replace(/\\(?:\r\n|\n|\r)/gu, ""));
    addPatternMatches(specifiers, preprocessed, [/^\s*#\s*include\s*[<"]([^">]+)[">]/gmu]);
  } else if (extension === ".go") goImports(sourceWithoutCStyleComments(content), specifiers);
  else if ([".java", ".kt", ".kts"].includes(extension)) {
    namespaceImports(sourceWithoutCStyleComments(content), specifiers);
  } else if (extension === ".cs") {
    csharpImports(sourceWithoutCStyleComments(content), specifiers);
  } else if (extension === ".php") {
    phpImports(sourceWithoutCStyleComments(content, { hashLineComments: true }), specifiers);
  } else if (extension === ".rb") {
    const normalized = sourceWithoutCStyleComments(content, {
      blockComments: false,
      hashLineComments: true,
      slashLineComments: false,
    });
    for (const match of normalized.matchAll(
      /(?:^|;)\s*(require_relative|require|load)\s*\(?\s*["']([^"']+)["']\s*\)?/gmu,
    )) {
      specifiers.add(match[1] === "require_relative" ? `./${match[2]}` : match[2]);
    }
  } else if (extension === ".swift") {
    addPatternMatches(specifiers, sourceWithoutCStyleComments(content), [
      /(?:^|;)\s*(?:(?:@\w+(?:\([^)]*\))?|public|internal|package|private|fileprivate|open)\s+)*import\s+(?:\w+\s+)?([A-Za-z_]\w*)/gmu,
    ]);
  }
  return [...specifiers].filter(Boolean).sort();
}
