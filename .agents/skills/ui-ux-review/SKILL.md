---
name: ui-ux-review
description:
  Read-only review of changed interactive surfaces, user flows, states, navigation, styling or
  shared visual components for usability, accessibility, consistency and preservation of existing
  design intent. Use after relevant UI implementation stabilizes or for an explicit UX review; skip
  framework-only work without an affected user interface. This skill never authorizes a redesign.
---

# UI/UX Review

This skill owns experience review of the actual affected flow. Report findings; do not edit files,
change product decisions, run destructive user actions or create a new design system.

## Establish Intent And Evidence

1. Read the request, current inventory and established requirements/design decisions, affected
   components/tokens/copy, and their real consumers. Identify the user task, requested change and
   what should stay intact. Distinguish confirmed decisions from observed existing appearance;
   neither general repo approval nor the absence of a design document authorizes a redesign.
2. Apply [UI Intent](../../../instructions.md#ui-intent-and-change-boundaries). An in-scope bug fix,
   consistency correction or accessibility improvement within the existing direction needs no new
   approval ritual. A material change in visual language, information architecture, navigation,
   central interaction or design system needs a focused user decision before implementation,
   including when a necessary correction has that impact.
3. Use available rendered target evidence and comparable before/after states where meaningful.
   Record target/build, flow, content and viewing/input conditions. If the target is unavailable,
   review source and supplied captures but label the missing observations; static checks or a
   screenshot alone cannot prove that an interaction works.

## Review The Affected Experience

- Follow one representative task from entry to completion and recovery. Inspect relevant loading,
  empty, partial, error, validation, success and disabled states with realistic content. Check that
  actions, feedback and next steps remain understandable without prior developer knowledge.
- Compare hierarchy, legibility, labels, spacing, density, component states and navigation with the
  established direction. Trace shared token/component changes into other consumers; flag unintended
  changes outside the requested flow, not personal aesthetic preferences.
- Apply [Multi-Device Experience](../../../instructions.md#multi-device-experience) for applicable
  mobile, tablet and desktop conditions: reflow, long/localized text, zoom, keyboard/focus, touch
  and pointer behavior, semantics and accessible names, contrast, reduced motion and recovery.
  Choose representative risk-bearing conditions instead of an exhaustive device matrix for every
  edit.
- Check constrained loading and meaningful task completion, not only an attractive isolated screen.
  Do not accept hidden overflow, removed content, unreadably small text or per-screen overrides as a
  remedy for a shared layout defect.
- Route wording to `$native-language-content-review`, generated raster assets to
  `$generated-image-quality-review`, and public search implications to `$search-visibility` only
  when those surfaces changed. Reuse their evidence rather than duplicating their review.

For new UI, verify that a representative coherent direction was made concrete and confirmed before
material design choices spread. For existing UI, do not restart product discovery or silently bless
an unsolicited redesign. No universal screenshot service, browser companion or visual archive is
required by this skill.

## Report

Return material findings with the affected flow/state, file or rendered evidence, user impact,
preserved-intent boundary and smallest proving recheck. Separate defects, missing evidence and
optional suggestions; optional ideas are not implementation authorization. State observations and
unavailable conditions even when no defect was found. The authorized implementation owner applies
repairs through `$project-implementation`; `$task-quality` coordinates final acceptance.
