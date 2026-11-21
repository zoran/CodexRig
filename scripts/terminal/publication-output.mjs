/** Owns publication progress and bounded diagnostics; it never decides publication gates. */
import process from "node:process";
import { performance } from "node:perf_hooks";
import { sanitizeMultilineForTerminal } from "./terminal-output.mjs";

const frames = ["|", "/", "-", "\\"];

/** Observes bounded verifier diagnostics; reported progress never establishes acceptance. */
export function createPublicationVerificationProgress(report) {
  const streams = new Map();
  const active = new Map();
  let completed = 0;
  let required = null;
  let failed = "";
  let previous = "";
  const keyPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/u;
  const boundedInteger = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 100_000;
  const show = (message) => {
    const safe = sanitizeMultilineForTerminal(message).replaceAll("\n", " ").slice(0, 320);
    if (safe === previous) return;
    previous = safe;
    report(safe);
  };
  const render = (preferred) => {
    const running = preferred ?? [...active.values()].findLast((entry) => entry.label !== failed);
    const count =
      required === null ? `${completed} completed` : `${completed}/${required} completed`;
    if (failed) {
      show(`Failed ${failed}${running ? `; waiting for ${running.label}` : ""}`);
    } else if (running) {
      show(`Verify ${running.label}${running.detail ? `: ${running.detail}` : ""}; ${count}`);
    } else {
      show(`Verification: ${count}`);
    }
  };
  const start = (id, label) => {
    if (active.has(id) || active.size >= 1024) return;
    const entry = { label, detail: "" };
    active.set(id, entry);
    render(entry);
  };
  const finish = (id, status) => {
    const entry = active.get(id);
    if (!entry) return;
    active.delete(id);
    completed += 1;
    if (status !== "passed") failed ||= entry.label;
    render();
  };
  const line = (text) => {
    const evidence =
      /^Evidence: (\d+) reused; (\d+) required; \d+ missing for complete coverage\.$/u.exec(text);
    if (evidence) {
      if (![Number(evidence[1]), Number(evidence[2])].every(boundedInteger)) return;
      required = Number(evidence[2]);
      show(`Verification: ${evidence[1]} reused; ${required} required`);
      return;
    }
    const started =
      /^\[verification:start\] ([a-zA-Z0-9._:/-]+) \([a-z-]+\)(?: ([a-zA-Z0-9._/-]+))?$/u.exec(
        text,
      );
    if (started && keyPattern.test(started[1])) {
      const [, key, file] = started;
      const label =
        file
          ?.split("/")
          .at(-1)
          .replace(/\.test\.mjs$/u, "") ?? key;
      start(`${key}:${file ?? ""}`, label);
      return;
    }
    const result =
      /^\[verification:(passed|failed)\] ([a-zA-Z0-9._:/-]+) \d+ms(?: ([a-zA-Z0-9._/-]+))?$/u.exec(
        text,
      );
    if (result) {
      const [, status, key, file] = result;
      finish(`${key}:${file ?? ""}`, status);
      return;
    }
    if (!text.startsWith("[verification] ")) return;
    const value = JSON.parse(text.slice("[verification] ".length));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value.key !== "string" ||
      !keyPattern.test(value.key)
    )
      return;
    if (value.event === "command-start") {
      start(value.key, value.key);
    } else if (value.event === "command-complete") {
      if (["passed", "failed", "error"].includes(value.status)) finish(value.key, value.status);
    } else if (
      value.event === "product-step-start" ||
      value.event === "product-native-phase-start"
    ) {
      const entry = active.get(value.key);
      if (!entry || !boundedInteger(value.step) || value.step === 0) return;
      if (
        value.event === "product-native-phase-start" &&
        (!boundedInteger(value.nativePhase) || value.nativePhase === 0)
      )
        return;
      entry.detail = `step ${value.step}${value.event === "product-native-phase-start" ? `, native phase ${value.nativePhase}` : ""}`;
      render(entry);
    } else if (
      value.event === "product-step-complete" &&
      ["failed", "error"].includes(value.status)
    ) {
      const entry = active.get(value.key);
      if (!entry) return;
      failed ||= entry.label;
      render();
    }
  };
  return (chunk, name = "stdout") => {
    if (!["stdout", "stderr"].includes(name)) return;
    const stream = streams.get(name) ?? { pending: Buffer.alloc(0), discarding: false };
    streams.set(name, stream);
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    for (let offset = 0; offset < bytes.length;) {
      const newline = bytes.indexOf(10, offset);
      const end = newline < 0 ? bytes.length : newline;
      if (!stream.discarding) {
        if (stream.pending.length + end - offset > 2048) {
          stream.pending = Buffer.alloc(0);
          stream.discarding = true;
        } else {
          stream.pending = Buffer.concat([stream.pending, bytes.subarray(offset, end)]);
        }
      }
      if (newline < 0) break;
      if (!stream.discarding) {
        try {
          line(stream.pending.toString("utf8").replace(/\r$/u, ""));
        } catch {
          // Malformed diagnostics and unavailable presentation cannot alter the command result.
        }
      }
      stream.pending = Buffer.alloc(0);
      stream.discarding = false;
      offset = newline + 1;
    }
  };
}

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
