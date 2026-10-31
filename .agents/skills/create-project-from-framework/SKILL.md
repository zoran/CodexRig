---
name: create-project-from-framework
description:
  Create a clean sibling project from the CodexRig Framework after the user supplies a project name
  and is proactively invited to develop a detailed product description with Codex. Exclude Git
  history, local runtime/cache state, framework planning history, provider-specific collaboration
  metadata, and framework-only material while preserving both portable CI adapters, project policy,
  and reusable tooling.
---

# Create Project From CodexRig Framework

Require the user's project name. Proactively invite a detailed product description: users/outcomes,
workflows, scope, domains/data/integrations/trust, surfaces/devices, delivery and locales. Explain
that Codex will structure, challenge and refine it at its requirements owner in the child. Reuse
supplied facts and summarize for correction. Only an explicit choice to defer permits creation
without the brief; silence or a tagline is not that choice. The brief becomes an unconfirmed intake
draft, never active module inventory or automatic product implementation authority.

Use current user inputs and current source only. Source/sibling memory, accounts and task history
must not influence the new project. Inspect prepared source tools first; run the maintenance/locked
hydration owner only for genuinely missing or invalid prerequisites, within its authority. A valid
prepared source needs no redundant install before every generation.

```bash
bash -p scripts/setup/run-project.sh node scripts/framework/create-project-from-framework.mjs --name "<Project Name>" --description "<Confirmed Detailed Product Description>"
```

The source recipe `.codexrig/project-tools.json` selects files, commands, dependencies and checks.
Use `--include-untracked` only for selected unpublished files. It is not a working-tree copy.
Creation stages/validates output, rechecks source identity and refuses an existing target. It never
resets source, clears context, initializes Git, commits or pushes.

Default output is `<apps>/<Project Name>/code`, using a safe outer segment or slug. `--directory`
changes the outer folder only when requested. Package identity derives from that folder; `code` is
the tooling root with a real empty `src/`. Real workspace packages or evidenced platform modules may
add Product Roots later; arbitrary directories and empty speculative apps do not.

Generation projects one portable instructions/AGENTS contract, identity-specific README/manifest,
typed product/delivery/tenancy/localization configuration and optional `docs/requirements.md`. It
excludes source Git/runtime/accounts/context, framework-only capabilities and source release
identity. NOTICE permits omission of source LICENSE/NOTICE/credits from generated output;
third-party obligations remain and product licensing belongs to the owner. Memories are enabled only
in the child's own isolated runtime. Both stable CI adapters remain; source experiments do not.

The existing staged validator proves exact selected-byte parity plus declared identity/namespace,
configuration and document transformations, contained imports, trust boundaries and private-state
exclusion. Do not duplicate it with a manual copier or a second verifier. New children must run
without the source checkout and support selective actual check dispatch/reuse through the same
registry. Use fixtures when changing generation; do not run real child maintenance for framework
acceptance.

For an actual authorized creation, prepare the child through its normal maintenance and `pnpm setup`
owners; check necessity/state before repeating them. Compatible freshness and failure-safe lock
publication remain required, not silently replaced by frozen preparation. Report path, package
identity, observed validation and remaining setup/restart limits. First-start intake refines the
requirements at their owner. Source publication guidance grants no commit/push authority.
