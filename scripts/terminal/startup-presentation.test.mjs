/** Verifies bounded startup presentation, project-name animation and quiet terminal modes. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { showStartupIntro, startupStatus } from "./startup-presentation.mjs";

function terminal({ isTTY = true, columns = 80 } = {}) {
  let output = "";
  return {
    isTTY,
    columns,
    write(value) {
      output += value;
    },
    get output() {
      return output;
    },
  };
}

test("each project name uses a bounded animation without changing input or cursor visibility", async () => {
  for (const label of [
    "CodexRig",
    "Kizor",
    "KerdBot",
    "Avatory",
    "Future 27",
    "未来のプロジェクト",
  ]) {
    const stream = terminal(),
      waits = [];
    await showStartupIntro({
      label,
      stream,
      environment: { TERM: "xterm" },
      delay: async (ms) => waits.push(ms),
    });
    assert.ok(stream.output.includes(label));
    assert.deepEqual(waits, Array(7).fill(60));
    assert.doesNotMatch(stream.output, /\u001b\[\?(?:25|1049)/u);
    assert.ok(stream.output.endsWith(`>_ ${label} / starting\n\n`));
  }
});

test("logs, NO_COLOR, CI and dumb terminals keep readable output without animation or escapes", async () => {
  for (const [isTTY, environment] of [
    [false, { TERM: "xterm" }],
    [true, { TERM: "dumb" }],
    [true, { TERM: "xterm", NO_COLOR: "" }],
    [true, { TERM: "xterm", CI: "true" }],
  ]) {
    const stream = terminal({ isTTY });
    await showStartupIntro({
      label: "Project",
      stream,
      environment,
      delay: () => assert.fail("no animation"),
    });
    startupStatus("2/5", "Checking tools.", { stream, environment });
    assert.equal(stream.output, "\n  >_ Project / starting\n\n  [2/5] Checking tools.\n");
  }
});

test("narrow terminals and control-bearing names remain bounded and cannot inject terminal commands", async () => {
  const stream = terminal({ columns: 20 });
  await showStartupIntro({
    label: "Long\u001b[2Jproject\nname",
    stream,
    environment: { TERM: "xterm" },
    delay: async () => {},
  });
  assert.doesNotMatch(stream.output, /\u001b\[2J/u);
  assert.doesNotMatch(stream.output, /\u001b\[5A/u);
  assert.ok(stream.output.includes("Longproject name"));
  const wide = terminal({ columns: 16 });
  await showStartupIntro({
    label: "未来のプロジェクト",
    stream: wide,
    environment: { TERM: "xterm" },
    delay: async () => {},
  });
  assert.ok(wide.output.includes("[==========]"));
  assert.equal(wide.output.split("未来のプロジェクト").length, 2);
});
