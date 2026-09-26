# Rendered UI Implementation

This reference owns the implementation skill's conditional UI workflow. Read it only when
implementing or changing an interactive surface.

Use [UI Intent And Change Boundaries](../../../../instructions.md#ui-intent-and-change-boundaries)
before changing an interactive surface. Do not treat general repository approval as a redesign
mandate or existing visuals as retrospectively approved.

1. Identify the affected user task and states, existing navigation/interaction/visual direction,
   presentation owners and shared consumers. State what the change will preserve. Read the actual
   components, tokens, assets and current product decisions; do not impose a new design system.
2. For new UI, make one representative coherent flow concrete early, including important loading,
   empty, error and success states. Show the direction for confirmation before spreading material
   design choices across the product. Do not restart a full design interview for ordinary
   maintenance.
3. For existing UI, preserve established appearance and behavior. In-scope bug fixes, consistency
   corrections and accessibility improvements within that direction need no extra approval ritual.
   Seek a focused decision before a material change in visual language, information architecture,
   navigation, central interaction or design system, including a necessary correction with that
   impact.
4. Implement through the canonical copy/locale, token, component, layout or surface owner. Keep
   views, presentation/navigation state, transport/API clients and domain behavior separate. Fix
   shared causes and inspect affected consumers; do not mask clipping by shrinking text, hiding
   overflow, removing useful content, or adding per-screen style overrides.
5. Inspect the real affected flow and representative states using realistic content and applicable
   viewport/input/zoom/locale conditions. Assume mobile, tablet, and desktop unless scope is
   narrower; apply [Multi-Device Experience](../../../../instructions.md#multi-device-experience).
   Compare before and after for meaningful changes when available. Check hierarchy, legibility,
   wording, spacing, focus, navigation consistency, recovery and completion of the user task, not
   only isolated screens.
6. Separate source/static, simulated, rendered and actual-target evidence. Report unavailable
   browser or target observations rather than claiming visual acceptance from a scanner, mock or
   screenshot alone. Add no universal screenshot infrastructure or mandatory visual ceremony for
   framework work without product UI. In Dev, run relevant evidence beside or after the newest
   developer deploy.

Keep confirmed durable UX decisions at their established requirements/design owner; do not mirror
tokens/components into a new registry. Changed user-facing copy uses
`$native-language-content-review`; changed interactive flows use `$ui-ux-review` before acceptance.
