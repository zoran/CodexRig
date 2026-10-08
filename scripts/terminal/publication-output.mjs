/** Owns publication progress and bounded diagnostics; it never decides publication gates. */
import process from "node:process";
import { performance } from "node:perf_hooks";
import { sanitizeMultilineForTerminal } from "./terminal-output.mjs";

const frames = ["|", "/", "-", "\\"];

/** Keeps redirected output readable and leaves credential prompts on their own terminal line. */
export function createPublicationOutput({
  root,
  displayName = "Project",
  verbose = false,
  stream = process.stderr,
  environment = process.env,
  log,
  now = () => performance.now(),
} = {}) {
  const interactive =
    !log && Boolean(stream.isTTY) && environment.TERM !== "dumb" && !environment.CI;
  const color = interactive && environment.NO_COLOR === undefined;
  const started = now();
  let current;
  let activeLine = false;
  let frame = 0;
  const safe = (value) => sanitizeMultilineForTerminal(String(value), root);
  const paint = (value, code) => (color ? `\u001b[${code}m${value}\u001b[0m` : value);
  const elapsed = (since) => `${((now() - since) / 1000).toFixed(1)}s`;
  const clear = () => {
    if (activeLine) stream.write("\r\u001b[2K");
    activeLine = false;
  };
  const line = (value = "") => {
    clear();
    if (log) log(value);
    else stream.write(`${value}\n`);
  };
  const draw = () => {
    if (!interactive || !current || current.prompt) return;
    const width = Math.max(1, (stream.columns || 80) - 1);
    const prefix = `  ${frames[frame++ % frames.length]} [${current.number}/8] `;
    const suffix = ` (${elapsed(current.started)})`;
    const available = Math.max(0, width - prefix.length - suffix.length);
    const task =
      current.task.length > available
        ? `${current.task.slice(0, Math.max(0, available - 3))}...`
        : current.task;
    const value = `${prefix}${task}${suffix}`;
    clear();
    stream.write(paint(value.slice(0, width), "36"));
    activeLine = true;
  };
  return {
    start() {
      line(paint(`\n  ${safe(displayName)}  /  Publish`, "1;36"));
      line("  Prepare > Verify > Commit > Push");
      line("  Sign-in: project credential > global GitHub/GitLab login > prompt.");
      line("  GitHub HTTPS: enter your GitHub username at 'Username'.");
      line("  At 'Password', enter a personal access token (PAT), not your GitHub password.");
      line();
    },
    task(label, { prompt = false } = {}) {
      if (!current) return;
      current.task = safe(label).replaceAll("\n", " ");
      current.prompt = prompt;
      if (interactive && !prompt) draw();
      else line(`    > ${current.task}`);
    },
    detail(output) {
      if (verbose && String(output).trim()) line(safe(output).trimEnd());
    },
    async phase(number, label, operation) {
      current = { number, label, task: "Starting", started: now(), prompt: false };
      if (!interactive) line(`  [${number}/8] ${label}`);
      draw();
      const timer = interactive ? setInterval(draw, 100) : undefined;
      try {
        const result = await operation();
        if (timer) clearInterval(timer);
        line(paint(`  [OK] ${number}/8  ${label}  (${elapsed(current.started)})`, "32"));
        return result;
      } catch (error) {
        if (timer) clearInterval(timer);
        line(paint(`  [FAIL] ${number}/8  ${label} > ${current.task}`, "31"));
        throw error;
      } finally {
        current = undefined;
        clear();
      }
    },
    finish({ commit, remote, branch = "main" }) {
      line();
      line(
        paint(
          `  Published ${safe(commit.slice(0, 12))} to ${safe(remote)}/${safe(branch)}`,
          "1;32",
        ),
      );
      line(`  All 8 phases completed in ${elapsed(started)}.`);
    },
    fail(error) {
      clear();
      const [headline, ...diagnostics] = safe(error.message ?? error).split("\n");
      line(`\n  Publication stopped: ${headline.slice(0, 500)}`);
      if (diagnostics.length) line(diagnostics.slice(-60).join("\n").slice(-12_000));
      line("  Source changes and any local commit are preserved.");
    },
  };
}
