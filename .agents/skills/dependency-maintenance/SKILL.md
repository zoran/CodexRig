---
name: dependency-maintenance
description:
  Inspect, update, pin, or remediate dependencies across a multi-package workspace while preserving
  each package's current version line, lockfile integrity, migration requirements, and explicit
  network uncertainty. Use for dependency reports, patch/minor/major upgrades, lockfile changes,
  supply-chain incidents, or dependency policy work.
---

# Dependency Maintenance

Apply [maintenance scope](../../../instructions.md#maintenance-scope-and-verification). Reports stay
read-only; framework updates do not authorize product dependency refresh. Distinguish deterministic
manifest/lock consistency from network-dependent freshness.

1. Read root/workspace manifests, lockfile, tool pins and policy. Preserve workspace, section,
   current spec and resolved version identity; never collapse recommendations by package name.
2. Use `pnpm deps:report` or preview `pnpm deps:update:patch`. Patches stay on each current
   major/minor line. Minor changes need user selection; majors additionally need migration review
   and targeted consumer evidence. Apply a reviewed preview with
   `pnpm deps:update -- --level patch --yes --plan-hash <sha256>`.
3. Registry/advisory uncertainty leaves inputs unchanged. Check current primary release/migration
   information. Versioned `patchedDependencies` declares applicability, not a resolution pin:
   preserve reviewed patches and compatible SDK/native constraints; inspect duplicate unpatched
   versions and retire patches only with evidence.
4. Use the existing compatible installer for explicitly authorized graph refresh; frozen install
   proves reproduction, not freshness. Reuse valid prepared state and verified immutable bundles.
   Resolve with scripts disabled unless a reviewed package requires a build step; inspect unexpected
   transitive/native changes.
5. Keep declarations/digests in source, shared installations/package graphs in the admitted tool
   store and accounts private. Relocation tests use isolated `PROJECT_TOOL_STORAGE_HOME`. Existing
   native collectors preserve referenced/live versions; quiescent owners retire legacy copies.
6. Verify lock consistency and actually affected consumers. Use `verify:external` only for required
   current registry/advisory observations; failed external lookups are not a clean result.

Canonical startup uses `maintain-toolchain.mjs --startup` for official tool/CI releases and
compatible packages, isolated validation, transactional publication and offline reproduction.
Complete versioned archives/checksums and usable runtime bin paths are required. `--locked`
separately prepares frozen CI inputs; do not substitute it into the normal launcher. Neither
pre-push nor side hooks update inputs. See
[dependency policy](../../../instructions.md#dependency-installation-and-freshness).

For an active supply-chain incident, confirm the source, affected direct/transitive versions and
actual exposure before selecting a safe version/replacement. Contain through the existing pin,
override, removal or replacement owner and use `$security-review`; state unresolved uncertainty.
Return a compact per-workspace current/wanted/latest/action/uncertainty table and owner/review
condition for consequential pins, not a new maintenance report file.
