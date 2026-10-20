# Spec: Loading UI

## Objective

Make the extension's intermediate operation screens visually consistent and
clear while browser operations are underway.

## Requirements

- Present a readable operation-specific title and instruction for clear,
  debugger attach, device simulation, debugger detach, and completion.
- Retain the existing `type` query parameter behavior and default message for an
  unknown type.
- Use a responsive layout and the same blue accent, typography, and system
  light/dark theme as the rest of the refreshed interface.
- Keep these screens focused on status; do not add controls that can interrupt
  an in-progress browser operation.

## Success Criteria

- Each supported operation type displays its matching title and explanation.
- Unknown operation types display a useful fallback message.
- Text remains legible at narrow and wide viewport sizes in light and dark
  themes.

## Boundaries

- Preserve operation sequencing and browser/service-worker behavior.
- Ask first before adding controls that change or cancel an operation.

## Open Questions

- None.
