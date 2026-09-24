# TabCarry

**Save your tabs. Come back ready.**

A local-only Chrome extension for saving and restoring browser windows, tabs and groups. No account, cloud sync, analytics, remote favicons or content scripts.

[Website](https://xnu.app/tabcarry/) · [Privacy policy](https://xnu.app/tabcarry/privacy/)

## What you can do

- Save all normal windows, the current window, or selected tabs with one click.
- Keep window structure, tab order, pinned tabs, active tabs and native tab-group metadata.
- Reopen a session in new windows, append to the original window, or restore selected tabs and groups.
- Open an individual page in a new tab or explicitly replace the original tab.
- Search session names, page titles and URLs; rename and favorite sessions.
- Move sessions to a 30-day trash and restore them, or permanently delete them.
- Export and import versioned JSON backups, with validation, duplicate detection and conflict copies.
- Save and close tabs as a separate, explicit action. Storage must succeed before any tab closes.
- See restore progress, stop subsequent openings and retry unfinished items. Uncertain results are identified separately.
- Use light/dark/system appearance, English/简体中文 and keyboard navigation.

## Install locally

1. Download the source or clone `https://github.com/everettjf/tabcarry.git`.
2. Run `npm ci` then `npm run build` (Node.js 24 recommended).
3. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/`.
4. Pin TabCarry to the toolbar. Click it to save, or open the session library.

Chrome 120+ is required. Configure keyboard shortcuts at `chrome://extensions/shortcuts`. The suggested save shortcut is **Alt+Shift+S**.

`npm run release` creates `releases/TabCarry-1.0.0.zip` with the manifest at its root. This ZIP is the Chrome Web Store upload package; unpack it before using **Load unpacked**.

## Data and limits

Sessions and restore reports are stored in extension-local IndexedDB. Preferences use `chrome.storage.local`. Export an independent backup before uninstalling, clearing extension data or moving to another browser profile. Backups contain page titles and full URLs; keep them private.

TabCarry restores URLs and browser structure, not login tokens, cookies, unsent forms, page contents, back/forward history, scroll positions or media playback. Website loading and existing login state depend on the browser and the website. Management works offline; loading websites may require a connection.

Only HTTP and HTTPS URLs reopen automatically in 1.0.0. Other saved URLs remain available for copying and backup. Incognito and the extension’s own pages are excluded. Large restores require confirmation; original browser IDs, exact display geometry and shared-group collaboration are not restored.

A restored tab count means Chrome created/navigated the tab, not that the website loaded successfully. On interruption, check any items marked uncertain before opening them again. Already opened tabs are not closed by Stop.

## Development and verification

```sh
npm ci
npm run check
npm run build
npx playwright install chromium
npm run test:chrome
```

The browser test creates its own temporary Chrome for Testing profile and local HTTP server. It never reads your everyday Chrome profile. Override `PLAYWRIGHT_BROWSERS_PATH` if using a separate browser cache. Test screenshots/reports default to the operating system temp directory and can be overridden with `TABCARRY_QA_DIR`.

- [Validation results](docs/validation.md)
- [Product plan (中文)](docs/product-plan.md)
- [Name check](docs/naming-check.md)
- [Privacy policy](PRIVACY_POLICY.md)
- [Store publishing checklist](docs/publishing.md)

**Release status:** 1.0.0 built and tested locally; not yet submitted to Chrome Web Store. Automatic snapshots, updating existing sessions and competitor imports are future work.

## Product website

The GitHub Pages workflow builds and deploys `.site/` on each push to `main`. Edit `docs/site/` for the website and `PRIVACY_POLICY.md` for the policy. Run `npm run release` followed by `npm run site:build` to build locally. The build includes actual UI screenshots and the current installable ZIP.
