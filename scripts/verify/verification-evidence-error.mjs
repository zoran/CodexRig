/** Owns verification evidence error behavior for the repository verification boundary. */
/** Preserves deterministic verification findings as structured failure evidence. */
export class VerificationEvidenceError extends Error {
  constructor(message, findings = []) {
    super(message);
    this.name = "VerificationEvidenceError";
    this.findings = Object.freeze([...findings]);
  }
}

export function failVerificationEvidence(message, findings = []) {
  throw new VerificationEvidenceError(message, findings);
}
