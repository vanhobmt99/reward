# Tasks: Search Auto UX Refresh

Tasks are ordered by dependency. Complete each task's acceptance criteria and
verification before moving to the next. The plan and risk notes are in
[`tasks/plan.md`](tasks/plan.md).

## Task 1: Add options page shell and browser registration

**Description:** Create the dedicated options page, its initial responsive shell,
and browser registration. Make sure the generated Firefox package includes the
page as well as the shared assets.

**Acceptance criteria:**

- [ ] Chrome opens the options page in a tab through the extension options UI.
- [ ] Firefox's generated manifest and package include the options page.
- [ ] The page follows the approved Vietnamese, blue-accent, light/dark visual
      direction and has a clear page title and section layout.

**Verification:**

- [ ] Run `npm run build:firefox` and confirm `dist/firefox/options.html` and its
      assets exist.
- [ ] Load the options page in Chrome and in a temporary Firefox build.
- [ ] Run `npm run lint` and `npm run format:check`.

**Dependencies:** None

**Files likely touched:**

- `manifest.json`
- `options.html`
- `css/options.css`
- `js/options.js`
- `scripts/build-firefox.cjs`

**Estimated scope:** Medium

## Task 2: Move saved search settings into the options page

**Description:** Add saved desktop/mobile counts, delay ranges, search topic,
and the post-search activity preference to the options page. Load and save them
through the existing configuration helpers without changing defaults or schema.

**Acceptance criteria:**

- [ ] The settings page loads current saved values and persists edits.
- [ ] Existing input limits and range validation are preserved.
- [ ] Search topic choices still match the query categories supported by the
      runtime.

**Verification:**

- [ ] Run the focused settings and topic tests, then `npm test -- --runInBand`.
- [ ] Manually change settings, close/reopen the page, and confirm values remain.

**Dependencies:** Task 1

**Files likely touched:**

- `options.html`
- `js/options.js`
- `tests/settingsPage.test.js`
- `tests/popupNiche.test.js`

**Estimated scope:** Medium

## Task 3: Move schedule controls into the options page

**Description:** Add schedule counts, delay ranges, run frequency, daily time,
schedule activation, and schedule status to the options page. Preserve current
alarm behavior and validation.

**Acceptance criteria:**

- [ ] Existing schedule modes and daily-time controls are available in the
      settings page.
- [ ] Schedule edits and activation use the current storage and alarm behavior.
- [ ] The next scheduled run/status is understandable to the user.

**Verification:**

- [ ] Run focused schedule tests and `npm test -- --runInBand`.
- [ ] Manually set, change, and disable a schedule; verify its saved state.

**Dependencies:** Tasks 1, 2

**Files likely touched:**

- `options.html`
- `js/options.js`
- `tests/settingsPage.test.js`
- `tests/scheduleUtils.test.js`

**Estimated scope:** Medium

## Checkpoint: Settings Foundation

- [ ] `npm test -- --runInBand` passes.
- [ ] `npm run build:firefox` includes the options page.
- [ ] Search and schedule settings persist in Chrome and Firefox.
- [ ] Review the page before migrating the remaining controls.

## Task 4: Move remaining non-destructive controls into settings

**Description:** Move the run-only activities action, device selection,
non-destructive mobile/session toggles, advanced logging, downloads, and
simulation controls into the options page. Leave data/history deletion and
runtime/extension reset actions out of the refreshed interface.

**Acceptance criteria:**

- [ ] Every existing non-destructive setting and utility is available in the
      options page and retains its current behavior.
- [ ] The data/history deletion, runtime reset, and extension reset controls are
      not present in the options page.
- [ ] The settings page disables controls consistently while operations that
      conflict with them are running.

**Verification:**

- [ ] Run focused options tests and `npm test -- --runInBand`.
- [ ] Manually exercise run-only activities, device selection, downloads, and
      simulation in Chrome and Firefox.

**Dependencies:** Tasks 1, 2, 3

**Files likely touched:**

- `options.html`
- `js/options.js`
- `tests/settingsPage.test.js`
- `tests/firefox.test.js`

**Estimated scope:** Medium

## Task 5: Make the popup run from saved settings and show progress/Stop

**Description:** Replace the editable-count run flow with a primary Start action
that reads the saved configuration. Show live progress and Stop while a run is
active. Keep the remaining schedule/settings panels in place until Task 6.

**Acceptance criteria:**

- [ ] The idle popup offers one primary Start action that reads saved counts
      without requiring count editing.
- [ ] Start launches the existing search and optional activity flow from saved
      values.
- [ ] Reopening the popup during a run shows current progress and Stop.
- [ ] Stop uses the existing cancellation behavior.

**Verification:**

- [ ] Run quick-start tests and `npm test -- --runInBand`.
- [ ] Manually verify start, progress, stop, and reopen-during-run in Chrome and
      Firefox.
- [ ] Run `npm run build:firefox` and `npm run test:firefox`.

**Dependencies:** Tasks 1, 2, 3, 4

**Files likely touched:**

- `popup.html`
- `js/popup.js`
- `css/quick-popup.css`
- `tests/popupQuickStart.test.js`

**Estimated scope:** Medium

## Task 6: Remove popup customization controls and add settings navigation

**Description:** Remove the settings, schedule, utility, delete, and reset
controls from the popup after their safe counterparts are available in the
options page. Add a clear action to open or focus the options tab.

**Acceptance criteria:**

- [ ] The popup contains only the quick run status/actions and a settings link.
- [ ] The settings link opens or focuses the dedicated settings tab.
- [ ] The popup does not contain configuration fields or destructive actions.
- [ ] Existing run start, progress, and stop behavior continues to work.

**Verification:**

- [ ] Run quick-start tests and `npm test -- --runInBand`.
- [ ] Manually inspect the popup in Chrome and Firefox, including the settings
      navigation action.
- [ ] Run `npm run build:firefox` and `npm run test:firefox`.

**Dependencies:** Tasks 1, 2, 3, 4, 5

**Files likely touched:**

- `popup.html`
- `js/popup.js`
- `css/quick-popup.css`
- `tests/popupQuickStart.test.js`

**Estimated scope:** Medium

## Checkpoint: Core Flows

- [ ] `npm test -- --runInBand` and `npm run lint` pass.
- [ ] Start, progress, Stop, and settings navigation work in both browsers.
- [ ] All non-destructive controls remain reachable in the options page.
- [ ] Destructive actions are absent from popup and settings.

## Task 7: Refresh operation loading screens

**Description:** Apply the shared visual direction and responsive layout to the
intermediate screens used for clear, debugger attach/detach, simulation, and
completion operations.

**Acceptance criteria:**

- [ ] Each supported `type` displays its matching title and instruction.
- [ ] Unknown types display the defined fallback message.
- [ ] Text is readable in light/dark themes and at narrow/wide sizes.
- [ ] No controls are added that change or cancel the operation.

**Verification:**

- [ ] Run focused loading UI tests and `npm test -- --runInBand`.
- [ ] Manually inspect all supported types in Chrome and Firefox.
- [ ] Run `npm run format:check`.

**Dependencies:** None

**Files likely touched:**

- `loading.html`
- `js/loading.js`
- `css/loading.css`
- `tests/loadingUi.test.js`

**Estimated scope:** Medium

## Task 8: Update Chrome and Firefox user guides

**Description:** Update the two Vietnamese guides to match the quick-start
popup, separate options tab, progress/stop behavior, and browser-specific
limitations.

**Acceptance criteria:**

- [ ] `manual.html` accurately describes Chrome's refreshed flow.
- [ ] `firefox/manual.html` accurately describes Firefox's refreshed flow and
      retains its Firefox-specific limitations.
- [ ] Moved controls and removed delete/reset controls are described accurately.

**Verification:**

- [ ] Follow each guide to locate Start, progress, Stop, settings, and schedules.
- [ ] Run `npm run format:check` and `npm run build:firefox`.

**Dependencies:** Tasks 2, 3, 4, 5, 6

**Files likely touched:**

- `manual.html`
- `firefox/manual.html`

**Estimated scope:** Small

## Final Verification

- [ ] Run `npm test -- --runInBand`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run format:check`.
- [ ] Run `npm run build:firefox` and `npm run test:firefox`.
- [ ] Manually review popup and settings at narrow/wide sizes, with keyboard
      navigation and light/dark themes, in Chrome and Firefox.
- [ ] Verify all approved success criteria in `SPEC.md`.
