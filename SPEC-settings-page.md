# Spec: Settings Page

## Objective

Move detailed customization into a dedicated extension page that opens in a
separate tab and keeps existing non-destructive controls available.

The page must be available in both the Chrome extension and Firefox build.

## Requirements

- Provide controls for saved search counts, wait ranges, search topic, and
  whether post-search activities run.
- Provide schedule counts, wait ranges, frequency, daily time, and schedule
  activation controls.
- Keep run-only activities, simulated device selection, mobile cleanup and
  Rewards-session options, advanced logging, downloads, and simulation controls
  available where they exist today.
- Persist changes through the existing configuration and storage behavior.
- Organize controls into understandable groups with labels, help text, and
  clear save/state feedback.
- Do not show data/history deletion, runtime reset, or extension reset controls.

## Success Criteria

- Every existing non-destructive setting and utility can be reached from the
  settings page.
- A changed setting remains in effect after navigating away, reopening the tab,
  or reopening the popup.
- The page is usable with keyboard navigation and at narrow browser widths.
- Dangerous deletion and reset actions are absent from the refreshed surfaces.

## Boundaries

- Keep the existing configuration schema and defaults.
- Ask first before adding settings or changing schedule semantics.

## Open Questions

- None.
