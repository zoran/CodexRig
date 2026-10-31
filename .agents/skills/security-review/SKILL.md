---
name: security-review
description:
  Read-only security and privacy review for changes that affect trust boundaries, authentication,
  authorization, secrets, user data, dependencies, shell execution, CI, infrastructure, or runtime
  configuration. Use near handoff when those surfaces changed or when the user explicitly requests a
  security review; skip when the task has no meaningful security surface.
---

# Security Review

Review only; report defects and uncertainty without editing or widening authority. Select relevant
lanes from the changed inputs, principals, data flows and operational powers; do not audit unrelated
account lifecycles for a shell-only change.

- Authentication and authorization are separate: inspect enrollment/binding/recovery/revocation and
  deny-by-default server-side action/resource decisions, horizontal/vertical access and role scope.
  Token presence, UI state and caller claims are not authorization. Follow
  [permission design](../../../instructions.md#permission-design), including operational role cost.
- Account lifecycle and domain profiles are separate: review linking, suspension/deletion,
  retention, administration/impersonation, provider reconciliation and orphan prevention where
  affected.
- Sessions/tokens need appropriate issuance, binding, protected storage, rotation/expiry, logout,
  replay/refresh and CSRF handling. Secrets and sensitive identity must not enter URLs, logs,
  analytics, client-readable storage or errors. Inspect outage/recovery behavior.
- Tenant context comes from verified membership/domain or signed integration/job/control-plane
  sources. Trace immutable request/job context through authorization, queries, caches, files,
  messages, jobs, quotas and data lifecycle. Test cross-tenant and asynchronous denial paths;
  authentication, RLS or network separation alone is insufficient. Global access needs explicit
  purpose, ownership and audit.
- Keep identity-provider SDKs and foreign models behind narrow adapters. Inspect actual trust at
  shell arguments, filesystem/symlink/archive boundaries, hooks, dependencies/install scripts, CI
  and network errors. Infrastructure review includes state/plan exposure, locks, environment
  credentials and destructive/uncertain-change recovery.
- Assess relevant private-data retention/disclosure, encoding, abuse controls and resource
  exhaustion. For evidence stores examine incomplete/tampered/aborted records, identity and
  freshness as well as ordinary success. Local same-user caches are not external cryptographic
  attestations.

Distinguish realistic exploitable defects from optional hardening or hypothetical risk. Return
severity, location, boundary, concrete failure/abuse preconditions, owner-level remedy and smallest
proving check. State inspected scope and remaining evidence limits when no material issue remains;
do not create an open-ended loop or a new security report file.
