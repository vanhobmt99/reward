# Spec: Search Auto UX Refresh

## Objective

Redesign the extension's user-facing interface so a user can open the popup and
start a run immediately, while keeping detailed customization in a separate tab.
The popup uses the saved configuration. During a run it shows progress and a
Stop action. The broader refresh covers the options page, Vietnamese user guide,
and the intermediate loading pages used during browser operations.

Primary user: a Search Auto user who wants to run the saved setup quickly and
only open detailed controls when they need to change something.

## Capability Map

| Module id       | Responsibility                                                               | Depends on                     |
| --------------- | ---------------------------------------------------------------------------- | ------------------------------ |
| `quick-start`   | Minimal popup for starting/stopping a run and viewing progress               | —                              |
| `settings-page` | Separate tab for saved run settings, schedules, and non-destructive controls | —                              |
| `help-guide`    | Vietnamese instructions that explain the refreshed popup and settings flows  | `quick-start`, `settings-page` |
| `loading-ui`    | Clear, consistent intermediate screens for browser operations                | —                              |

Build order: `quick-start` and `settings-page` first; `help-guide` follows their
final flows. `loading-ui` can be delivered alongside the first two modules.

The module boundaries and build order were reviewed and approved by the user on
2026-10-14.

## Tech Stack

- Chrome Manifest V3 extension and Firefox Manifest V2 build from the shared
  source tree.
- HTML, CSS, and JavaScript modules; no UI framework.
- Configuration and runtime state are stored through the existing extension
  storage and service worker flows.
- Jest is used for unit and integration tests; Playwright is used for the claim
  flow.

## Commands

- Unit/integration tests: `npm test`
- End-to-end claim flow: `npm run test:claim`
- Firefox package build: `npm run build:firefox`
- Firefox smoke test: `npm run test:firefox`
- Lint: `npm run lint`
- Formatting check: `npm run format:check`

## Project Structure

- `popup.html`, `js/popup.js`, `css/quick-popup.css` — shared quick popup for Chrome
  and Firefox.
- `options.html`, `js/options.js`, `css/options.css` — dedicated settings page.
- `js/config-defaults.js`, `js/utils.js`, `js/service.js` — configuration,
  storage helpers, and run orchestration.
- `manual.html` and `firefox/manual.html` — Vietnamese user guides for Chrome
  and Firefox.
- `scripts/build-firefox.cjs` — builds the Firefox manifest and copies shared
  extension pages.
- `loading.html`, `js/loading.js`, `css/loading.css` — intermediate operation
  screens.
- `tests/` — Jest unit and integration tests.
- `e2e/` — Playwright end-to-end scenarios.

## Code Style

Use the existing JavaScript module style, descriptive camelCase names, and the
repo's Prettier settings (two spaces, semicolons, trailing commas). Keep default
configuration values in `js/config-defaults.js` as the single source of truth.

```js
export function createDefaultConfig() {
  return {
    search: {
      desk: 31,
      mob: 21,
      min: 7,
      max: 14,
    },
  };
}
```

## Testing Strategy

- Add Jest coverage for popup/options behavior that reads or persists settings,
  updates run state, and opens the settings page.
- Check every existing non-destructive setting remains editable and persists
  after reopening the options tab.
- Use the Playwright flow where the change affects the run experience.
- Manually review popup, options, guide, and loading screens at narrow and wide
  viewport sizes, in light and dark color schemes, and with keyboard navigation.
- Keep status and progress announcements accessible to assistive technology.

## Boundaries

- Always: preserve existing run semantics and saved configuration; make Start
  use the current saved configuration; keep the popup usable while a run is in
  progress; retain all non-destructive controls.
- Ask first: add a dependency or browser permission; change the configuration
  schema, schedule behavior, or underlying search/activity behavior.
- Never: expose data deletion, history deletion, runtime reset, or extension
  reset controls in the refreshed user interface; silently change saved values
  or run behavior.

## Success Criteria

- The popup's primary action starts a run from the saved configuration without
  requiring a user to edit counts first.
- Chrome and Firefox expose the same quick-start and customization flows from
  their respective browser action popups.
- Reopening the popup during a run shows the current progress and a Stop action;
  stopping uses the existing run cancellation flow.
- A clear popup control opens the customization page in a separate browser tab.
- Every existing non-destructive configuration and utility control is available
  in the customization page, including scheduling and run-only activities.
- The refreshed interface does not show data deletion, history deletion,
  runtime reset, or extension reset actions.
- The Vietnamese guide describes the new quick-start and customization flows.
- Both the shared guide and Firefox-specific guide describe the updated flows.
- Loading screens retain their operation-specific messages and are visually
  consistent across clear, debugger, simulation, detach, and completion steps.
- All four surfaces support readable light/dark themes, keyboard operation, and
  announced status/progress; no horizontal overflow occurs at their target
  viewport sizes.

## Open Questions

- None blocking. Visual direction assumption: retain Search Auto's blue accent,
  Vietnamese copy, and system light/dark theme behavior while simplifying layout.

## Module Specifications

- [Quick Start](SPEC-quick-start.md)
- [Settings Page](SPEC-settings-page.md)
- [Help Guide](SPEC-help-guide.md)
- [Loading UI](SPEC-loading-ui.md)
