/** Owns bounded ASCII startup presentation without changing admission or terminal input state. */
import { setTimeout as pause } from "node:timers/promises";
import { sanitizeForTerminal } from "./terminal-output.mjs";

const glyphs = {
  A: [" ### ", "#   #", "#####", "#   #", "#   #"],
  B: ["#### ", "#   #", "#### ", "#   #", "#### "],
  C: [" ### ", "#   #", "#    ", "#   #", " ### "],
  O: [" ### ", "#   #", "#   #", "#   #", " ### "],
  D: ["#### ", "#   #", "#   #", "#   #", "#### "],
  E: ["#####", "#    ", "#### ", "#    ", "#####"],
  F: ["#####", "#    ", "#### ", "#    ", "#    "],
  H: ["#   #", "#   #", "#####", "#   #", "#   #"],
  K: ["#   #", "#  # ", "###  ", "#  # ", "#   #"],
  L: ["#    ", "#    ", "#    ", "#    ", "#####"],
  M: ["#   #", "## ##", "# # #", "#   #", "#   #"],
  N: ["#   #", "##  #", "# # #", "#  ##", "#   #"],
  Q: [" ### ", "#   #", "# # #", "#  # ", " ## #"],
  S: [" ####", "#    ", " ### ", "    #", "#### "],
  U: ["#   #", "#   #", "#   #", "#   #", " ### "],
  V: ["#   #", "#   #", "#   #", " # # ", "  #  "],
  W: ["#   #", "#   #", "# # #", "## ##", "#   #"],
  Y: ["#   #", " # # ", "  #  ", "  #  ", "  #  "],
  Z: ["#####", "   # ", "  #  ", " #   ", "#####"],
  X: ["#   #", " # # ", "  #  ", " # # ", "#   #"],
  R: ["#### ", "#   #", "#### ", "#  # ", "#   #"],
  I: ["#####", "  #  ", "  #  ", "  #  ", "#####"],
  G: [" ### ", "#    ", "#  ##", "#   #", " ### "],
  P: ["#### ", "#   #", "#### ", "#    ", "#    "],
  J: ["#####", "   # ", "   # ", "#  # ", " ##  "],
  T: ["#####", "  #  ", "  #  ", "  #  ", "  #  "],
  0: [" ### ", "#  ##", "# # #", "##  #", " ### "],
  1: ["  #  ", " ##  ", "  #  ", "  #  ", " ### "],
  2: [" ### ", "#   #", "   # ", "  #  ", "#####"],
  3: ["#### ", "    #", " ### ", "    #", "#### "],
  4: ["#   #", "#   #", "#####", "    #", "    #"],
  5: ["#####", "#    ", "#### ", "    #", "#### "],
  6: [" ### ", "#    ", "#### ", "#   #", " ### "],
  7: ["#####", "    #", "   # ", "  #  ", "  #  "],
  8: [" ### ", "#   #", " ### ", "#   #", " ### "],
  9: [" ### ", "#   #", " ####", "    #", " ### "],
  "-": ["     ", "     ", "#####", "     ", "     "],
  _: ["     ", "     ", "     ", "     ", "#####"],
  " ": ["     ", "     ", "     ", "     ", "     "],
};

function interactive(stream, environment) {
  return Boolean(
    stream.isTTY &&
    environment.TERM &&
    environment.TERM !== "dumb" &&
    !Object.hasOwn(environment, "NO_COLOR") &&
    !environment.CI,
  );
}

/** Uses at most eight frames/420 ms; never hides the cursor or enters an alternate screen. */
export async function showStartupIntro({
  label,
  stream = process.stderr,
  environment = process.env,
  delay = pause,
} = {}) {
  const title = sanitizeForTerminal(label).slice(0, 40);
  const letters = [...title.toUpperCase()];
  const width = letters.length * 6 - 1;
  if (!interactive(stream, environment) || (stream.columns ?? 80) < 16) {
    stream.write(`\n  >_ ${title} / starting\n\n`);
    return;
  }
  const large = (stream.columns ?? 0) >= width + 4 && letters.every((letter) => glyphs[letter]);
  // The compact reveal uses ASCII only: wide/non-Latin names cannot wrap a redrawn terminal row.
  const rows = large
    ? Array.from({ length: 5 }, (_, row) => letters.map((letter) => glyphs[letter][row]).join(" "))
    : ["[==========]"];
  const renderedWidth = Math.max(...rows.map((row) => row.length));
  stream.write("\n");
  for (let frame = 1; frame <= 8; frame += 1) {
    if (frame > 1) stream.write(`\u001b[${rows.length}A`);
    const visible = Math.ceil((renderedWidth * frame) / 8);
    const color = frame === 8 ? "\u001b[1;36m" : "\u001b[36m";
    for (const row of rows) stream.write(`\u001b[2K  ${color}${row.slice(0, visible)}\u001b[0m\n`);
    if (frame < 8) await delay(60);
  }
  stream.write(`\n  >_ ${title} / starting\n\n`);
}

/** Static text remains sufficient when color or motion is unavailable. */
export function startupStatus(
  phase,
  message,
  { stream = process.stderr, environment = process.env } = {},
) {
  const tag = sanitizeForTerminal(phase);
  const text = sanitizeForTerminal(message);
  const prefix = interactive(stream, environment) ? `\u001b[36m[${tag}]\u001b[0m` : `[${tag}]`;
  stream.write(`  ${prefix} ${text}\n`);
}
