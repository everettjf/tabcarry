# TabCarry validation

## Appearance and interface refinement — 2026-10-21

Default light/dark palettes now use warm paper and warm charcoal backgrounds inspired by [OnePage’s palette](https://github.com/ivaneye/OnePage/blob/master/theme.css), with restrained teal accents. Small UI text has stronger contrast than the reference. Sand, Forest, Dusk and Midnight are optional palettes; System follows OS appearance. Settings provide keyboard-accessible radio cards with palette previews. Changes preview immediately, roll back on save failure, persist locally, and synchronize across extension pages.

The 560px popup now groups save controls side by side, uses a separate save card, shows session icons and full-name tooltips, and places library navigation beside the community link. The library uses consistent colors, focus states and selected rows; shortcut hints follow the platform. Theme changes do not interpolate colors.

Validation includes all six palettes in the library and real native toolbar popup, English/Chinese settings layout, cross-page preference synchronization, OS light/dark changes, and browser restart persistence. Automated contrast checks require at least 4.5:1 for body text, muted text, selected-session metadata and primary-button labels. Screenshots are generated for every palette, plus settings and native popups. The existing capture, restore, backups, trash and scale acceptance checks remain part of the suite.

## Native toolbar popup width — 2026-10-21

The previous `.popup { width: 460px; max-width: 100vw }` resolved to a 185px native toolbar viewport in Chrome for Testing. A normal tab with an explicitly set viewport did not detect this. The popup document now declares its own 560px width, and the app fills it.

`npm run test:popup` opens the actual toolbar popup with `chrome.action.openPopup()` in an isolated, visible browser profile, without viewport emulation. English/dark and Chinese/light both measured a 560px viewport and app, no horizontal overflow, a fully visible date-based session title, and single-line metadata. Running the same test against a temporary build with the old width rules reproduced 185px and failed the width assertion. Production build and the existing Chrome acceptance suite also passed after the fix.

Date: 2026-09-24. This report distinguishes isolated browser tests from ongoing personal use.

## Automated tests

31 tests cover:

- JSON round trips: windows, groups, ordering, pinned/active states, unsupported URLs, timestamps and trash.
- Malformed JSON, future schemas, oversized input, duplicate IDs and missing group references.
- Import conflict copies and repeated-import idempotency, independent of JSON property ordering.
- IndexedDB transaction commit, aborted edits and concurrent revision conflicts.
- Capture scope, selected tabs, pending navigation, changing windows, empty selection and incognito/extension exclusions.
- Restore selection, deduplication, explicit destination, native group destination, pinned tabs, partial failures, stop and retry.
- Interrupted creation is marked uncertain; retries do not silently duplicate uncertain or already opened tabs.
- A failed navigation of the initial blank tab is not counted as restored; retry reuses that tab.
- Retry rejects tab references from a previous browser lifetime and leaves tabs that the user moved or navigated unchanged.

## Real browser acceptance

`tests/chrome.mjs` loads the built extension in **Chrome for Testing 153.0.8010.12**, headless, on macOS arm64. It creates its own temporary browser profile and loopback test websites. These are real `chrome.tabs`, `chrome.windows`, `chrome.tabGroups`, runtime messaging and IndexedDB calls, not mocks.

Passed:

- Capture two windows / six tabs with native tab group and pinned state.
- Recreate windows with matching URL order and pinned state; group metadata restored; existing tabs left open.
- Optional exact-URL deduplication when appending to an existing window.
- Rename and search through the actual React UI.
- Valid JSON export/reimport skips duplicates; invalid import preserves existing data.
- Move to trash and put back.
- Light/dark, 600px layout, popup rendering and Simplified Chinese.
- Save-and-close commits the snapshot before closing the isolated test page.
- Individual-page opening in a new tab and explicit replacement of the source tab.
- Import/search/render a 500-tab fixture; create **100 real browser tabs across two windows**. One local run completed creation in about **2.2 seconds**. This measures tab creation, not page load completion, and is not a general performance guarantee.
- Browser shutdown/restart preserves sessions and preferences.
- No UI console or page errors in the acceptance run.

The original test caught Chrome moving new groups to the focused window; restoration now explicitly supplies the new group’s target window. Visual inspection caught menus staying open after actions and colors interpolating during theme changes; both were corrected. Returning to the manager now refreshes restore progress immediately.

## Build and packaging

TypeScript, tests, formatting and production build must pass via `npm run check` and `npm run release`. The ZIP contains the manifest at its root and no development tests or sample sessions. `npm audit` reported zero known vulnerabilities after upgrading the test dependency on this date; this is not a comprehensive security audit.

Screenshots in `docs/store/` show the actual extension with demonstration records. They do not include personal browser sessions.

## Remaining release validation

The planned seven-day personal-use trial has **not** happened. Automated testing used the stated Chrome for Testing version, not every supported Chrome release, OS or extension combination. Chrome Web Store submission/review is not included in this completed build.

Automatic snapshots, updating an existing session, competitor-format migration, exact monitor geometry, shared-group relationships, page contents and login-state restoration are not included in 1.0.0.

## Product website validation

The generated site passed isolated-browser checks at desktop and 390px mobile widths, including dark mode, FAQ interaction, privacy content, local links and ZIP download. No horizontal overflow, unresolved template placeholders, failed asset requests or page errors were found. The website uses local assets and no client-side scripts, analytics or third-party fonts.

## Pre-release review — 2026-09-24

Fixed two edge cases found during source review: expired-trash cleanup now checks and deletes within one IndexedDB transaction, preserving a restore that commits first; restore checks the destination of an existing native tab group before adding further tabs, and does not change the collapsed state of a group moved to another window. Regression tests cover both cases. Dialogs now expose their title to assistive technology and localize the close button.

After these changes, all 31 tests, TypeScript, formatting, release packaging and the isolated native Chrome acceptance suite passed. The latter again covered 500-tab search/render, 100-tab restore, backup round trips and browser restart persistence. This remains automated validation, not a completed daily-use trial or an exhaustive security audit.
