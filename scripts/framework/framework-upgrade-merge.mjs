/** Owns three-way framework upgrade merges and additive comparison of public project configuration. */
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual as equal } from "node:util";
import { removeOwnedArtifact } from "../filesystem/owned-file-operations.mjs";
import { serializeCanonicalJson, sha256 } from "../filesystem/repository-files.mjs";
import { cleanGitEnvironment } from "../repository/git-runtime-isolation.mjs";
import {
  isTerminalSynchronousProcessResult,
  spawnSyncWithBoundedIo,
} from "../repository/runtime-process-io.mjs";

export const absentUpgradeFile = Object.freeze({ exists: false, mode: null, sha256: null });
export function upgradeFileContent(content, mode = 0o644) {
  return { exists: true, content, mode, sha256: sha256(content) };
}
export function sameUpgradeFile(left, right) {
  return left.sha256 === right.sha256 && left.mode === right.mode;
}

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const field = (value, key) => (value && Object.hasOwn(value, key) ? value[key] : undefined);

// Preserve the primary ordering, inserting additional entries before their next known neighbor.
function insertMissing(primary, additional) {
  const order = [...primary];
  let at = order.length;
  for (const key of additional.toReversed()) {
    const existing = order.indexOf(key);
    if (existing < 0) order.splice(at, 0, key);
    else at = existing;
  }
  return order;
}

function keyedEntries(value, key) {
  if (!Array.isArray(value)) return null;
  const entries = value.map((entry) => [field(entry, key), entry]);
  const map = new Map(entries);
  if (entries.some(([id]) => typeof id !== "string" || !id) || map.size !== entries.length)
    return null;
  return map;
}

function mergeJson(file, base, local, source, hasBase) {
  const conflicts = [];
  function conflict(keys, candidate) {
    conflicts.push(
      "/" + keys.map((key) => key.replaceAll("~", "~0").replaceAll("/", "~1")).join("/"),
    );
    return candidate;
  }
  function visit(before, current, desired, keys) {
    if (equal(current, desired) || (hasBase && equal(before, desired))) return current;
    if ((hasBase && equal(before, current)) || (!hasBase && current === undefined)) return desired;
    if (!hasBase && desired === undefined) return current;
    if (
      record(current) &&
      record(desired) &&
      (!hasBase || before === undefined || record(before))
    ) {
      const entries = [];
      for (const key of new Set([...Object.keys(current), ...Object.keys(desired)])) {
        const value = visit(field(before, key), field(current, key), field(desired, key), [
          ...keys,
          key,
        ]);
        if (value !== undefined) entries.push([key, value]);
      }
      return Object.fromEntries(entries);
    }
    if (
      file === ".codex/verification.json" &&
      keys.length === 1 &&
      ["commands", "risks"].includes(keys[0])
    ) {
      const identity = keys[0] === "commands" ? "key" : "path";
      const original = keyedEntries(before ?? [], identity);
      const ours = keyedEntries(current, identity);
      const theirs = keyedEntries(desired, identity);
      if (original && ours && theirs) {
        const shared = (map) =>
          [...map.keys()].filter(
            (key) => ours.has(key) && theirs.has(key) && (!hasBase || original.has(key)),
          );
        const localOrder = shared(ours),
          sourceOrder = shared(theirs);
        let order = insertMissing([...ours.keys()], [...theirs.keys()]);
        if (!equal(localOrder, sourceOrder)) {
          const baseOrder = shared(original);
          if (!hasBase || !equal(sourceOrder, baseOrder)) {
            if (!hasBase || !equal(localOrder, baseOrder)) conflict(keys, desired);
            order = insertMissing([...theirs.keys()], [...ours.keys()]);
          }
        }
        return order.flatMap((key) => {
          const entry = visit(original.get(key), ours.get(key), theirs.get(key), [...keys, key]);
          return entry === undefined ? [] : [entry];
        });
      }
    }
    // Argument order, replacement of an existing consumer list, and competing scalar edits need review.
    return conflict(keys, desired);
  }
  return { value: visit(base, local, source, []), conflicts };
}

// The framework owns only the selected command and tool fields in a product package.
const packageFields = ["packageManager", "scripts", "devDependencies"];
function packageTools(value) {
  return Object.fromEntries(
    packageFields.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]),
  );
}
function jsonProposal(file, before, current, desired) {
  const pkg = file === "package.json";
  let base, local, source;
  try {
    base = before?.exists ? JSON.parse(before.content) : undefined;
    local = JSON.parse(current.content);
    source = JSON.parse(desired.content);
  } catch (error) {
    if (pkg)
      throw new Error(
        "Migration requires a readable project package manifest to preserve its fields.",
        { cause: error },
      );
    return { next: desired, conflicts: ["/"] };
  }
  if (pkg && ![local, source, ...(before?.exists ? [base] : [])].every(record))
    throw new Error("Migration requires a project package object to preserve its fields.");
  const result = mergeJson(
    file,
    base && pkg ? packageTools(base) : base,
    pkg ? packageTools(local) : local,
    pkg ? packageTools(source) : source,
    Boolean(before),
  );
  let value = result.value;
  if (pkg) {
    const product = { ...local };
    for (const key of packageFields) {
      if (Object.hasOwn(value, key)) product[key] = value[key];
      else delete product[key];
    }
    value = product;
  }
  const content = equal(value, local) ? current.content : serializeCanonicalJson(value);
  return { next: upgradeFileContent(content, current.mode), conflicts: result.conflicts };
}

function mergeText(sourceRoot, before, current, desired) {
  const stage = mkdtempSync(path.join(os.tmpdir(), "framework-upgrade-merge-"));
  try {
    for (const [name, state] of [
      ["local", current],
      ["base", before],
      ["source", desired],
    ])
      writeFileSync(path.join(stage, name), state.content, { flag: "wx", mode: 0o600 });
    const maximumOutputBytes = 16 * 1024 * 1024;
    const compare = (preferSource) => {
      const args = [
        "merge-file",
        "-p",
        ...(preferSource ? ["--theirs"] : []),
        "--",
        "local",
        "base",
        "source",
      ];
      const result = spawnSyncWithBoundedIo("git", args, {
        cwd: stage,
        env: {
          ...cleanGitEnvironment(process.env, sourceRoot),
          GIT_CEILING_DIRECTORIES: path.dirname(stage),
        },
        encoding: "utf8",
        input: "",
        stdio: "pipe",
        maxBuffer: maximumOutputBytes,
        timeout: 20_000,
      });
      if (
        !isTerminalSynchronousProcessResult(result, { command: "git", args, maximumOutputBytes }) ||
        result.status > (preferSource ? 0 : 127)
      )
        throw new Error("Git could not complete the three-way framework upgrade comparison.");
      return result;
    };
    const result = compare(false);
    if (result.status === 0) return { content: result.stdout, conflicts: [] };
    // Source preference resolves only overlapping hunks. After a reorganization Git can
    // report overlap on a previously merged file even when taking those hunks changes nothing.
    const content = compare(true).stdout;
    return { content, conflicts: content === current.content ? [] : ["/"] };
  } finally {
    removeOwnedArtifact(
      path.dirname(stage),
      stage,
      "directory",
      "private framework upgrade merge inputs",
    );
  }
}

/** Uncertain candidates require a bound decision. Never send conflict markers to the target. */
export function compareUpgradeFile({ sourceRoot, file, before, current, desired }) {
  const clean = (next) => ({ next, conflicts: [] });
  const conflict = () => ({ next: desired, conflicts: ["/"] });
  if (sameUpgradeFile(current, desired)) return clean(current);
  // The source package is a projection and never a whole-file replacement.
  if (file === "package.json") return jsonProposal(file, before, current, desired);
  if (before) {
    if (sameUpgradeFile(before, desired)) return clean(current);
    if (sameUpgradeFile(before, current)) return clean(desired);
  } else {
    if (!desired.exists) return clean(current);
    if (!current.exists) return clean(desired);
  }
  if (!current.exists || !desired.exists || (before && !before.exists)) return conflict();
  const modeConflict =
    current.mode !== desired.mode &&
    (!before || (current.mode !== before.mode && desired.mode !== before.mode));
  const mode =
    modeConflict || (before && current.mode === before.mode) ? desired.mode : current.mode;
  const merged = (content, conflicts = []) => ({
    next: upgradeFileContent(content, mode),
    conflicts: modeConflict ? [...new Set([...conflicts, "/"])] : conflicts,
  });
  if (before && (current.sha256 === desired.sha256 || before.sha256 === desired.sha256))
    return merged(current.content);
  if (before && before.sha256 === current.sha256) return merged(desired.content);
  if (file === ".codex/verification.json" || (before && file.endsWith(".json"))) {
    const { next, conflicts } = jsonProposal(file, before, current, desired);
    return merged(next.content, conflicts);
  }
  if (
    !before ||
    /(?:^|\/)(?:[^/]*-lock\.ya?ml|[^/]*\.lock)$/u.test(file) ||
    [before, current, desired].some((state) => state.content.includes("\0"))
  )
    return conflict();
  const { content, conflicts } = mergeText(sourceRoot, before, current, desired);
  return merged(content, conflicts);
}
