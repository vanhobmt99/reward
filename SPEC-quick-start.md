# Spec: Quick Start Popup

## Objective

Let a user launch Search Auto from the extension popup with one primary action,
using the saved configuration, then monitor or stop the active run.

The shared popup must provide this flow in both the Chrome and Firefox builds.

## Requirements

- Present Start as the popup's primary action when idle.
- Do not require editing desktop/mobile counts in the popup before a run.
- Start the same search and optional post-search activity flow currently
  controlled by the saved configuration.
- While running, show current progress and a Stop action.
- Reflect progress and run state after closing and reopening the popup.
- Provide a clear action to open the settings page in a separate browser tab.
- Keep the popup compact and legible in the browser's popup window.

## Success Criteria

- One activation of Start begins a run using saved configuration values.
- Opening the popup during a run shows progress and Stop; Stop delegates to the
  existing cancellation behavior.
- Opening settings from the popup creates or focuses the customization tab.
- Keyboard users can operate the primary and settings actions, and progress is
  announced through an accessible live region.

## Boundaries

- Preserve the existing run orchestration and settings model.
- Ask first before changing what a run includes or how cancellation works.

## Open Questions

- None.
