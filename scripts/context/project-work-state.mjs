/** Owns bounded project work-state parsing for continuation and critical-budget handover flows. */
import { lstatSync } from "node:fs";
import path from "node:path";
import {
  closeOwnedDirectoryBinding,
  openOwnedDirectoryBinding,
  ownedDirectoryChildPath,
  readStableOwnedFile,
} from "../filesystem/owned-path-safety.mjs";

export const projectContextRelativePath = "docs/project-context.md";
export const projectContextMaxBytes = 65_536;

const markerMaxBytes = 4_096;
const workStatePattern = /<!-- codexrig-work-state\r?\n([\s\S]*?)\r?\n-->/gu;
const unsafePromptCharacters = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const blockerKinds = new Set(["authority", "safety", "integration", "external"]);

function requireExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has unknown or missing fields`);
  }
}

function requireBoundedText(value, label, maxLength, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    unsafePromptCharacters.test(value)
  ) {
    throw new Error(`${label} must be bounded plain text`);
  }
  return value;
}

export function parseProjectWorkState(content) {
  const matches = [...String(content).matchAll(workStatePattern)];
  if (matches.length === 0) return null;
  if (matches.length !== 1 || Buffer.byteLength(matches[0][1], "utf8") > markerMaxBytes) {
    throw new Error("working context must contain exactly one bounded codexrig-work-state marker");
  }
  if (String(content).slice(0, matches[0].index).trim() !== "") {
    throw new Error("codexrig-work-state marker must be the first non-whitespace content");
  }
  let state;
  try {
    state = JSON.parse(matches[0][1]);
  } catch {
    throw new Error("codexrig-work-state marker is not valid JSON");
  }
  requireExactKeys(
    state,
    [
      "blocker",
      "currentGoal",
      "currentSlice",
      "nextAction",
      "outcome",
      "revision",
      "status",
      "version",
    ],
    "codexrig-work-state",
  );
  if (state.version !== 1) throw new Error("codexrig-work-state version is unsupported");
  if (!Number.isSafeInteger(state.revision) || state.revision < 1) {
    throw new Error("codexrig-work-state revision must be a positive integer");
  }
  if (!new Set(["active", "blocked", "complete"]).has(state.status)) {
    throw new Error("codexrig-work-state status is unsupported");
  }
  requireBoundedText(state.outcome, "outcome", 600);
  requireBoundedText(state.currentGoal, "currentGoal", 600);
  requireBoundedText(state.currentSlice, "currentSlice", 600, { nullable: true });
  if (state.status === "active") {
    requireBoundedText(state.nextAction, "nextAction", 1_000);
    if (state.blocker !== null) throw new Error("active work cannot declare a blocker");
  } else if (state.status === "blocked") {
    if (state.nextAction !== null) throw new Error("blocked work cannot declare a next action");
    requireExactKeys(state.blocker, ["kind", "reason"], "work blocker");
    if (!blockerKinds.has(state.blocker.kind)) throw new Error("work blocker kind is unsupported");
    requireBoundedText(state.blocker.reason, "blocker reason", 800);
  } else if (state.nextAction !== null || state.blocker !== null) {
    throw new Error("complete work cannot declare a next action or blocker");
  }
  return Object.freeze(state);
}

export function readProjectWorkContext(root, { testHooks } = {}) {
  const docsDirectory = path.join(root, "docs");
  try {
    lstatSync(docsDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const directory = openOwnedDirectoryBinding(root, docsDirectory, "working context parent");
  try {
    const basename = path.basename(projectContextRelativePath);
    const contextPath = ownedDirectoryChildPath(directory, basename, "working context");
    try {
      lstatSync(contextPath);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    testHooks?.beforeContextRead?.({ directory, contextPath });
    let content;
    try {
      content = readStableOwnedFile(directory, basename, "working context", {
        maximumBytes: projectContextMaxBytes,
      }).buffer.toString("utf8");
    } catch {
      throw new Error("working context is not a bounded regular file");
    }
    const state = parseProjectWorkState(content);
    if (!state) throw new Error("working context is missing its codexrig-work-state marker");
    return Object.freeze({ content, state });
  } finally {
    closeOwnedDirectoryBinding(directory);
  }
}
