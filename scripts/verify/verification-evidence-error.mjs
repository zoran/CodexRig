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
