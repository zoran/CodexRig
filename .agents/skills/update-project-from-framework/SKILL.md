---
name: update-project-from-framework
description:
  Update an existing child repository from this framework, reconcile portable workflow and tooling
  with current generation, and preserve intentional product adaptations. Use for explicitly
  requested child updates or update feasibility reviews; a review stays read-only.
---

# Update Project From Framework

This source-only procedure owns convergence with the current generated output. Follow
[Repository Update Scope](../../../instructions.md#repository-update-scope). An update does not
license product development or unrelated repairs, deployments, commit or push. Apply
[Maintenance Scope And Verification](../../../instructions.md#maintenance-scope-and-verification) to
every command below, including startup, dependency maintenance, verification and cleanup.

## Bound The Update

State the selected source and targets, framework surfaces, preserved product adaptations and update
acceptance before writing. The result is reconciled tooling/policy, current affected documentation,
focused integration evidence and owned cleanup. Preserve unrelated product work state as recovery
input; do not adopt its next action as this update's next slice. No product roadmap, dependency
refresh or unrelated defect investigation follows from this assignment. Apply
[Task Scope And Completion](../../../instructions.md#task-scope-and-completion) through handoff.

## Reconstruct And Compare

1. Inventory source and every selected target's Git/worktrees, safe recovery and live writers. Stop
   affected writes while any target owner is active or indeterminate. Preserve all developer
   changes. Identify actual product roots, requirements, deployment gates and custom verification.
2. Read source selection `.codexrig/project-tools.json`, relevant current owners and target
   consumers. Preview `pnpm framework:upgrade -- --target <root>`. It compares current generated
   tools and policy with the whole portable target tool surface without pretending the target is a
   pristine baseline. Differences include target-only files, missing tools, policy, package commands
   and configuration. Inventory private paths by name only; a private file outside the migration
   surface is never opened or removed to make a portable-export scan pass.
3. Classify every difference: current framework behavior, intentional product extension, obsolete
   framework behavior or unresolved ownership. Inspect real imports and command consumers before
   retirement. Include AGENTS, instructions, injected policy, roles, skills, startup hooks, package
   commands, verification routing, CI, README, manifest and local tool/config owners in the review.
   A preserved file is not evidence that a framework fix reached it. Reconcile canonical shared
   policies into maintained child instructions as well as generated defaults, including
   [Interpreting Examples And Scope](../../../instructions.md#interpreting-examples-and-scope) and
   the portable maintenance scope, task-completion and documentation-currency boundaries. Named
   examples do not bound the applicable update: trace the underlying rule across affected existing
   consumers and the admission of future ones while respecting the accepted update scope. Reconcile
   the shared tool/account isolation boundary, actual project account adapters and their
   startup/install/verification consumers. Preserve project credentials in place. The canonical
   GitHub/GitLab HTTPS adapter is the only default global-login exception; never borrow other host
   or sibling accounts to make an update pass. Report required local logins without reading secrets.

## Reconcile One Current Contract

4. Prefer current generated implementations; port necessary product extensions onto them at their
   narrow owner. Keep typed project identity, delivery, tenancy, localization and product gates.
   Update old command/contract consumers together, retire proven-obsolete helpers and tests, and
   move child facts out of generic workflow where an established project owner exists. Never replace
   requirements, product data or large specifications with generation defaults. Migrate typed
   contract versions from the target's actual model. For tenancy schema 2, preserve trusted sources
   and deny-by-default policy, bind each existing manifest product module to its reviewed scope, and
   name actual runtime context boundaries and existing negative-test owners. Reuse composed product
   tests; neither empty generation defaults nor artificial per-module test scripts establish
   isolation. Generic scanner defects belong at the source owner, while product boundary repairs
   require the applicable repair authority. Inspect patch/SDK constraints when changing their
   framework consumers; preserve dependency manifests, patches and the lockfile. Use
   `$dependency-maintenance` for separately authorized dependency work. Installing current startup
   tooling does not authorize running its compatible dependency refresh on the target.
5. For each divergent existing file, prepare an ephemeral JSON array of decisions from the preview:
   retain `path`, `currentHash`, `currentMode`, `desiredHash`, `desiredMode`; replace `kind` with
   `action` (`source`, `keep`, `replace` or explicitly reviewed `remove`) and a concrete `reason`. A
   replacement also contains reviewed UTF-8 `content` and integer `mode`. `source` on a target-only
   path explicitly retires it. `keep` requires a product-specific reason; do not use it merely to
   dismiss an upstream change. Maintained README, native README, manifest and bounded work context
   are never template-replaced; their preview `documentBindings` permit explicit `replace` decisions
   in the same transaction. Inspect the final differences and deviations. Unknown ownership remains
   a conflict. Name extra public document/configuration or script owners with repeated
   `--project-path <path>`; they remain unchanged unless an exact bound decision replaces or retires
   them. Never infer deletion from their presence in the review surface.
6. Preview again with `--reconcile <absolute-decisions.json>`, review to clean and audit afresh.
   Changed source/target hashes or modes invalidate decisions. Only then add `--apply`. The target's
   installed current runtime owner must enforce quiescence; one journal covers policy and tool
   changes through cleanup. For an ordinary update, reconcile any child-specific lifecycle modules
   and their transitive local dependencies explicitly; destination staging uses only that admitted
   runtime closure. Do not replace a working child runtime merely to avoid reviewing its extensions.
   Do not manually delete private runtime to force admission. Supported recovery is
   `--target <root> --recover`; never interpret superseded private schemas. For an old target
   without the installed runtime owner, generate a small temporary current child, reconcile existing
   product owners and verification into it, and use explicit `--regenerate` with
   `--confirm-quiescent --apply` only after confirmed stopped writers and a fresh worktree/process
   inventory. The confirmation is an operator attestation, not a lock that fences old launchers.
   Never strip the live target first or copy its dependency, build or native-session directories.
   Regeneration uses the same transaction and holds the destination runtime lock. Interrupted
   regeneration requires `--regenerate --confirm-quiescent --recover`; recovery reads its current
   journal before target code and requires the exact admitted source runtime hash. Preserve that
   source until settlement; source drift fails closed. The regenerated lifecycle owner and its
   transitive dependencies must match the current source exactly so recovery has one contract.
   Product adaptations belong outside that protected closure. An existing broken runtime without
   this transaction is a blocker, not permission to bypass normal upgrade admission. Validate
   necessary native configuration through its current owner as well as tracked policy. Superseded
   portable permission overrides or retired hook trust can block a correctly installed launcher.
   Reconcile only confirmed conflicting entries under the current lifecycle lock and a fresh
   quiescence assertion; bind bytes and mode, preserve unrelated preferences and native
   history/authentication, and validate before releasing ownership. Never relax the validator or
   discard unknown private state to obtain startup success.
7. Reconcile maintained README/manifest and product-owned command consumers within the same accepted
   migration. Apply [Documentation Currency](../../../instructions.md#documentation-currency) within
   each slice; keep factual corrections at their owners before dependent work, not just at final
   handoff. A real pristine generated ancestor may additionally support the `--baseline` three-way
   comparison, but it does not replace policy review or prove product adaptations received current
   fixes. Preserve each target's exact Mise pins and artifact locks when relocating them to
   `.codex/mise.toml` and `.codex/mise.lock`; retire the old discovery paths in the same cutover.
   Keep the target's confirmed name in `.codex/tooling.json` at `startup.displayName` for its
   startup animation, independently of source branding and product identity. Reconcile every
   affected reader and host-shell command, including Git hooks; verify both isolated execution and
   outer-shell discovery after exit.

## Prove Convergence

8. Run context map/check and selected-section reads on real target requirements. Validate changed
   native policy and tooling with existing affected checks; inspect `verify:changed -- --print-plan`
   to assess preserved routing without automatically executing product checks. Establish the causal
   need for each target integration check before running it. Exercise startup/maintenance changes in
   isolated fixtures or a disposable generated project when the target command would exceed update
   scope. Do not run the target's compatible refresh or broad product verification merely to
   complete this update. Preserve product-specific toolchains, secondary runtimes, dependency
   patches and grouped tests; inspect assembled plans for duplicate execution as well as lost
   coverage. Remove obsolete context dependencies only after tracing all consumers. Classify
   unrelated findings without repairing them, and never weaken a check to obtain a green result.
   Distinguish fixture, frozen-install and actual target evidence; a normal launcher run requires
   authority for its side effects. Report an unexecuted gate or required restart, and do not call an
   unverified target start-ready.
9. Run a fresh current-output preview. Every remaining difference needs an explained intentional
   product adaptation; no unexplained old workflow, hidden compatibility branch or retired consumer
   may remain. Reuse the bounded findings in the handoff, not an installation receipt or a second
   tracking system. Apply Repository Efficiency And Effectiveness at every audit and settle target
   and source worktrees. Remove owned ephemeral decisions after successful verification. State any
   unresolved acceptance gate and the required complete launcher restart. Once update acceptance is
   satisfied, report the update result and stop. Do not run `goal:new` to select product work or
   continue a preserved product backlog without a separately accepted task.
