/** Owns sitemap metadata behavior for the public web quality boundary. */
export function parseSitemapEntries(sitemap) {
  return [...sitemap.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)].map((match, index) => {
    const block = match[0];
    return {
      index,
      block,
      loc: textFromTag(block, "loc"),
      lastmod: textFromTag(block, "lastmod"),
    };
  });
}

export function textFromTag(block, tagName) {
  const escapedTagName = escapeRegExp(tagName);
  const match = new RegExp(
    `<${escapedTagName}\\b[^>]*>\\s*([^<]+?)\\s*<\\/${escapedTagName}>`,
    "i",
  ).exec(block);
  return match?.[1].trim() ?? "";
}

export function isIso8601Timestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(
    value,
  );
  if (!match) return false;

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(offsetHourText ?? "0");
  const offsetMinute = Number(offsetMinuteText ?? "0");

  if (
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59 ||
    Number.isNaN(Date.parse(value))
  ) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

export function canonicalUrlFromHtml(content, jsxSelfClosingStarts) {
  for (const [name, tag] of htmlStartTags(content, jsxSelfClosingStarts)) {
    if (name !== "link") continue;
    const relValues = tagAttribute(tag, "rel").toLowerCase().split(/\s+/).filter(Boolean);
    if (relValues.includes("canonical")) return tagAttribute(tag, "href");
  }
  return "";
}

export function hasRobotsNoindex(content, jsxSelfClosingStarts) {
  return metaContentsFromHtml(content, "robots", jsxSelfClosingStarts).some((value) =>
    /\bnoindex\b/iu.test(value),
  );
}

export function hasHtmlDocumentElement(content, jsxSelfClosingStarts) {
  for (const [name] of htmlStartTags(content, jsxSelfClosingStarts))
    if (name === "html") return true;
  return false;
}

/** Returns the first complete title element, excluding attribute and raw-text examples. */
export function titleFromHtml(content, jsxSelfClosingStarts) {
  for (const [name, , index, text] of htmlStartTags(content, jsxSelfClosingStarts))
    if (name === "title") return { text: text ?? "", index };
  return null;
}

/** Static metadata ignores tag literals in attributes, comments and raw-text elements. */
export function metaContentsFromHtml(content, name, jsxSelfClosingStarts) {
  const values = [];
  for (const [tagName, tag] of htmlStartTags(content, jsxSelfClosingStarts)) {
    if (tagName === "meta" && tagAttribute(tag, "name").toLowerCase() === name.toLowerCase())
      values.push(tagAttribute(tag, "content"));
  }
  return values;
}

const rawTextElements = new Set([
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
]);

/** Consume each complete tag before looking for the next, without interpreting source scripts. */
function* htmlStartTags(content, jsxSelfClosingStarts) {
  const opening = /<\/?([a-z][a-z0-9:-]*)(?=[\s/>])/giy;
  let cursor = 0;
  while ((cursor = content.indexOf("<", cursor)) !== -1) {
    if (content.startsWith("<!--", cursor)) {
      const end = content.indexOf("-->", cursor + 4);
      if (end === -1) return;
      cursor = end + 3;
      continue;
    }
    if (content.startsWith("<!", cursor) || content.startsWith("<?", cursor)) {
      const end = htmlTagEnd(content, cursor + 2);
      if (end === -1) return;
      cursor = end + 1;
      continue;
    }
    opening.lastIndex = cursor;
    const match = opening.exec(content);
    if (!match) {
      cursor += 1;
      continue;
    }
    const end = htmlTagEnd(content, opening.lastIndex);
    if (end === -1) return;
    const index = cursor;
    const tag = content.slice(cursor, end + 1);
    cursor = end + 1;
    if (tag.startsWith("</")) continue;
    const name = match[1].toLowerCase();
    // Only a parsed JSX node proves self-closing syntax; an HTML slash does not close raw text.
    const selfClosingJsx = jsxSelfClosingStarts?.has(index) === true;
    if (rawTextElements.has(name) && !selfClosingJsx) {
      const closing = new RegExp(`</${name}(?=[\\s/>])`, "giu");
      closing.lastIndex = cursor;
      const close = closing.exec(content);
      if (!close) return;
      const end = htmlTagEnd(content, closing.lastIndex);
      if (end === -1) return;
      yield [name, tag, index, content.slice(cursor, close.index)];
      cursor = end + 1;
    } else {
      yield [name, tag, index];
      if (name === "plaintext" && !selfClosingJsx) return;
    }
  }
}

function htmlTagEnd(content, start) {
  let quote = "";
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ">") return index;
  }
  return -1;
}

export function tagAttribute(tag, name) {
  // Consume whole values, so attribute-looking text inside another value stays text.
  const attributes = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
  for (const match of tag.matchAll(attributes)) {
    if (match[1].toLowerCase() === name.toLowerCase())
      return (match[2] ?? match[3] ?? match[4] ?? "").trim();
  }
  return "";
}

export function httpUrlOrigin(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : "";
  } catch {
    return "";
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
