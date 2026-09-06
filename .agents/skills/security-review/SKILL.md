---
name: security-review
description:
  Read-only security and privacy review for changes that affect trust boundaries, authentication,
  authorization, secrets, user data, dependencies, shell execution, CI, infrastructure, or runtime
  configuration. Use near handoff when those surfaces changed or when the user explicitly requests a
  security review; skip when the task has no meaningful security surface.
---

# Security Review

Review the implemented change and report findings; do not edit files.

## Review

1. Map the changed inputs, outputs, principals, data flows, trust boundaries and operational powers.
   Select only the relevant lanes below. Identity/account/session and tenant review applies when
   those boundaries or their consumers changed; a shell-only change does not require an unrelated
   full account-lifecycle audit. Trace any shared-boundary effect before ruling a lane out.
2. Review authentication independently from authorization. Check authenticator enrollment, binding,
   recovery, reset, revocation, step-up/reauthentication, throttling and enumeration resistance;
   then check deny-by-default server-side policy decisions for every protected action and resource,
   horizontal and vertical access, tenant/relationship context, least privilege, and revocation.
   Never accept token presence, UI state, caller-supplied user/tenant/role, or network location as
   the authorization decision.
3. Review principal/account and user-management lifecycle separately from domain-specific profile
   data. Check creation, linking, suspension, deletion, retention, impersonation/admin paths, audit,
   provider reconciliation, orphan prevention, and cross-tenant isolation.
4. Review session and token issuance, binding, storage, rotation, expiry, inactivity/absolute
   limits, logout, global/device revocation, refresh/replay handling, CSRF where applicable, and
   failure under provider outage. Credential, token, session-secret, recovery, assertion, and
   sensitive identity values must not enter logs, URLs, client-readable storage, analytics, or error
   output.
5. Confirm provider SDKs and foreign identity models stay in Identity and Access adapters; UI/web,
   public API transports, domain modules, and infrastructure consume narrow public contracts and do
   not deep-import credential, grant, policy, session, persistence, or provider internals.
6. Review tenant isolation as a distinct trust boundary. Confirm tenant context comes only from a
   verified membership/domain or signed integration/job/control-plane source, stays immutable and
   request/job scoped, and is combined with principal, action, and resource authorization. Trace it
   through queries and uniqueness, migrations, cache keys, files/search, events/messages/jobs,
   quotas, observability, integrations, onboarding/offboarding, export/deletion, and backup/restore.
   Test horizontal identifier guessing and asynchronous/cache paths in both directions. Reject raw
   caller tenant IDs, ambient mutable or default tenants, unscoped admin queries, unaudited
   cross-tenant operations, and reliance on authentication, row-level security, network, or siloed
   infrastructure alone. Require explicit ownership, least privilege, and audit for global or
   control-plane behavior.
7. Check remaining secret/private-data exposure, input validation, encoding, retention, logging,
   telemetry, and error disclosure where relevant.
8. Check shell argument handling, paths, symlinks, permissions, archive extraction, hooks, CI,
   dependency provenance, install scripts, and network failure semantics where relevant.
9. For public endpoints, assess abuse controls and resource exhaustion as well as ordinary access
   control.
10. Distinguish exploitable defects from hardening ideas and unsupported hypothetical risks.
11. Confirm security-sensitive assumptions are durable where operators or future changes depend on
    them.

Order findings by severity and include the affected boundary, realistic failure or abuse path,
preconditions, root-cause fix, and smallest proving check. If no material issue remains, state the
reviewed surfaces and residual risks. Do not create an open-ended review loop.
