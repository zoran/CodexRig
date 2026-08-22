/** Owns terminal-safe machine and human rendering for repository worktree recovery. */
const terminalUnsafeJsonPattern = /[\u007f-\u009f\p{Cf}\p{Zl}\p{Zp}]/gu;

function escapeJsonCodePoint(character) {
  let escaped = "";
  for (let index = 0; index < character.length; index += 1) {
    escaped += `\\u${character.charCodeAt(index).toString(16).padStart(4, "0")}`;
  }
  return escaped;
}

/** Serializes exact JSON values without emitting terminal-format or bidi control characters. */
export function formatWorktreeRecoveryJson(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Worktree recovery output cannot serialize an undefined value.");
  }
  return serialized.replace(terminalUnsafeJsonPattern, escapeJsonCodePoint);
}

/** Renders one control-character-safe human inventory row while preserving its path value. */
export function formatWorktreeRecoveryLine(worktree) {
  const marker = worktree.current ? "current" : worktree.unfinished ? "unfinished" : "settled";
  const branch =
    worktree.branch === null
      ? "detached"
      : formatWorktreeRecoveryJson(worktree.branch).slice(1, -1);
  return `${marker}\t${branch}\t${worktree.session.status}\t${formatWorktreeRecoveryJson(worktree.path)}`;
}
