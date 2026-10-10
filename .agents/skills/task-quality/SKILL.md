---
name: task-quality
description:
  Verify and hand off an authorized slice or goal, prepare publication, or perform an explicitly
  read-only final review. Use near completion to select proportional evidence, coordinate relevant
  reviews and audit acceptance; not for ordinary implementation or a specialized domain review.
---

# Task Quality

This skill owns evidence and review selection at a slice or goal boundary.
[Project Instructions](../../../instructions.md) own authority, coordination, cleanup and
publication.

## Select The Mode And Evidence

- Review-only requests stay read-only: report defects and uncertainty, without editing files,
  planning state, accepting risk or performing external mutations.
- Finish/handoff mode repairs findings only within the authorized implementation scope.
- Recover the task contract and stopping condition from
  [Task Scope And Completion](../../../instructions.md#task-scope-and-completion). Establish changed
  owners/consumers and actual risks; optional improvements cannot extend acceptance. Apply
  [Maintenance Scope And Verification](../../../instructions.md#maintenance-scope-and-verification)
  before command selection. Inspect `pnpm verify:changed -- --print-plan`; use focused checks and
  the [Test Strategy](../../../instructions.md#test-strategy). A failing check is not broad-rerun
  authority.
- Distinguish source/static checks, isolated fixtures, rendered flows, actual targets and native
  model behavior. Claim only what the observed evidence proves. Missing coverage is a finding only
  with a concrete recurrence path or material-risk invariant.
- For infrastructure, select evidence under
  [Infrastructure As Code](../../../instructions.md#infrastructure-as-code); distinguish static
  validation and plans/previews from authorized target, idempotence, drift and recovery evidence.

## Route Review Once Per Concern

The primary composes existing evidence once per concern; delegated reviewers stop at their assigned
result. Their handoff or blocker is input for the primary to resolve while continuing safe
authorized work. A review checkpoint does not end an unfinished outcome. Use the applicable
specialized procedure:

- `$system-coherence`: code quality, root cause, ownership, duplication and representative
  assembled-flow integration for every non-trivial completed slice. It also supports read-only
  review.
- `$security-review`: changed trust, secrets, user data, dependencies, shell, CI or runtime
  surfaces.
- `$ui-ux-review`: changed interactive flows, shared visual components, navigation or styling.
- `$native-language-content-review`: changed user-facing language and documentation.
- `$generated-image-quality-review`: changed generated raster assets and their integration.
- `$search-visibility`: affected public web/search surfaces.

Report findings in the conversation with location, failure mode, evidence and acceptance impact.
Avoid duplicate findings across reviews. When external evidence supports a decision, check current
primary-source applicability. Apply the evidence and relevance criteria from
[Slice Acceptance](../../../instructions.md#best-available-engineering-not-quick-fixes): fix
relevant evidence-backed findings in finish mode, batch by root cause, and repeat only affected
review/evidence until none remains. In review-only mode, report rather than repair; do not call a
known-defective state clean.

Every audit applies
[Repository Efficiency And Effectiveness](../../../instructions.md#repository-efficiency-and-effectiveness):
assess repository-wide outcome preservation, context/runtime/verification/maintenance cost and
coherence from the bounded map and affected consumers. Fix only evidenced in-scope regressions;
report limits and preserve requirements. Static byte checks do not establish model effectiveness.

## Audit And Settle

1. Check [Documentation Currency](../../../instructions.md#documentation-currency) from the slice
   handoffs: integrate outstanding corrections at protected owners before acceptance. Reconcile
   source/declaration headers, dead paths and bounded work context before auditing. Recheck the
   request, plan, manifest, owners/consumers, residual risks and evidence. Apply
   [Documentation Ownership](../../../instructions.md#documentation-ownership): preserve unique
   requirements, stable links and evidence limits at their established owners; do not treat
   structural checks as semantic preservation proof. Check README discovery for both existing and
   newly created documents and reject copied requirements or document summaries. An audit finding
   reopens the owning repair and targeted review.
2. Perform the whole-repository course check and Worktree Settlement from
   [Slice Acceptance](../../../instructions.md#best-available-engineering-not-quick-fixes). A passed
   check or finished intermediate slice is not the complete authorized outcome.
3. At a completed goal, follow the single
   [Closure And Repository Housekeeping](../../../instructions.md#completed-goal-closure-and-repository-housekeeping)
   sequence, including orchestration housekeeping, `repo:housekeeping`, active-document currency,
   critical-document preservation review and fresh audit. Do not copy or reorder that sequence here.
4. Run the scope-appropriate final evidence once on the stable actual integration state under
   [Verification](../../../instructions.md#verification). Follow the repository’s applicable
   cleanup, publication and `pnpm goal:new` gates; never invent additional closure work or
   manufacture completion.
5. Any later repository edit reopens affected evidence, review and audit. Follow
   [Capacity And Drain](../../../instructions.md#guarded-and-critical-drain) before new work; a
   successful critical seal ends all actions immediately.

Continue the remaining authorized outcome under
[Authorized Work](../../../instructions.md#authorized-work-and-native-codex). Return a final handoff
only at the accepted completion condition or a real blocker: state the result, actual evidence,
review/audit status, material limits and exact remaining action. Create no review or completion
document.
