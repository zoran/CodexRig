/** Owns secret content scan behavior for the repository verification boundary. */
import { isActionableSecretMatch, secretPatterns } from "../security/secret-patterns.mjs";

// All repository secret signatures are ASCII. Keeping a bounded byte overlap catches a signature
// split across stream chunks without buffering an arbitrarily large Git blob in memory.
const overlapBytes = Math.max(
  4096,
  ...secretPatterns.map(({ label }) => Buffer.byteLength(label, "ascii") * 4),
);

export function createSecretContentScanner() {
  const patterns = secretPatterns.map(({ label, regex }) => ({
    label,
    regex: new RegExp(regex.source, `${regex.flags.replace(/[gy]/gu, "")}g`),
  }));
  const labels = new Set();
  let tail = "";

  return {
    write(chunk) {
      if (!chunk || chunk.length === 0 || labels.size === secretPatterns.length) return;
      const text = tail + Buffer.from(chunk).toString("latin1");
      for (const pattern of patterns) {
        if (labels.has(pattern.label)) continue;
        pattern.regex.lastIndex = 0;
        for (let match = pattern.regex.exec(text); match; match = pattern.regex.exec(text)) {
          if (isActionableSecretMatch(match)) {
            labels.add(pattern.label);
            break;
          }
        }
      }
      tail = text.slice(-overlapBytes);
    },
    findings() {
      return [...labels].sort((left, right) => left.localeCompare(right));
    },
  };
}

export function findSecretLabelsInBuffer(buffer) {
  const scanner = createSecretContentScanner();
  scanner.write(buffer);
  return scanner.findings();
}
