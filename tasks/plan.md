# Implementation Plan: Search Auto UX Refresh

## Overview

Deliver the approved quick-start and separate settings experience across Chrome
and Firefox, then update the shared loading pages and browser-specific guides.
Keep the current storage schema, run orchestration, schedule semantics, and
browser API behavior intact. The extension uses shared popup HTML/JavaScript,
while Firefox packages its own manifest and guide through the build script.

## Architecture Decisions

- Register a dedicated `options.html` page as the browser's options UI and open
  it in a tab. Share its HTML/CSS/JavaScript across Chrome and Firefox.
- Keep saved values in the existing extension storage model and use
  `js/config-defaults.js`, `js/utils.js`, and existing runtime messages as the
  source of truth.
- Keep the popup focused on Start, progress, Stop, and the settings link; move
  configuration and non-destructive utilities to the options page.
- Keep destructive deletion and reset controls out of the refreshed user
  surfaces without changing underlying service behavior.
- Keep operation-specific loading text and the `type` query parameter contract.
- Update both `manual.html` and `firefox/manual.html`; the Firefox build replaces
  the shared guide with the Firefox-specific one.

## Dependency Graph

```text
Options page shell and browser packaging
  ├── Saved search settings ──┐
  ├── Schedule settings ──────┼── Quick-start popup
  └── Safe utilities ─────────┘          │
                                         └── User guides

Loading UI refresh (independent; shared by Chrome and Firefox)
```

## Task List

### Phase 1: Settings Foundation

- [ ] Task 1: Add options page shell and browser registration
- [ ] Task 2: Move saved search settings into the options page
- [ ] Task 3: Move schedule controls into the options page

### Checkpoint: Settings Foundation

- [ ] Options page loads in Chrome and the generated Firefox build.
- [ ] Search and schedule values persist through existing storage behavior.
- [ ] Review the settings structure before removing controls from the popup.

### Phase 2: Complete the User Flows

- [ ] Task 4: Move remaining non-destructive controls into settings
- [ ] Task 5: Make the popup run from saved settings and show progress/Stop
- [ ] Task 6: Remove popup customization controls and add settings navigation

### Checkpoint: Core Flows

- [ ] Start, progress, Stop, and settings navigation work in Chrome and Firefox.
- [ ] All non-destructive controls remain available in the settings page.
- [ ] Destructive delete/reset controls are absent from the refreshed UI.

### Phase 3: Documentation and Final Review

- [ ] Task 7: Refresh operation loading screens
- [ ] Task 8: Update Chrome and Firefox user guides
- [ ] Run the verification matrix in `TASKS.md` and review the complete interface.

### Checkpoint: Complete

- [ ] Unit tests, lint, formatting, Firefox build, and Firefox smoke test pass.
- [ ] Popup, settings, loading screens, and guides meet the approved success
      criteria.
- [ ] Human review is complete before implementation is considered done.

## Risks and Mitigations

| Risk                                                                                       | Impact | Mitigation                                                                                                     |
| ------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------- |
| `js/popup.js` currently binds many settings and utilities directly to popup DOM selectors. | High   | Move one settings group at a time, add page-level coverage, then remove obsolete popup bindings.               |
| The Firefox build derives its manifest and page list from Chrome source files.             | Medium | Update the build script with the options page and verify the generated Firefox package.                        |
| Popup windows close between interactions, so run state must be reloaded reliably.          | High   | Continue reading runtime state from persisted config/messages and verify by reopening the popup mid-run.       |
| Hiding dangerous controls could accidentally remove unrelated safe utilities.              | Medium | Assert that all non-destructive controls remain in settings and the four excluded destructive controls do not. |

## Open Questions

- None. Scope and module order were approved; Firefox coverage is included because
  the project builds and supports a Firefox variant from the shared source.

## Task List Target

The user requested a root `TASKS.md`; that file is the task list target for this
initiative.
