# Publishing TabCarry 1.0.0

Status: source and ZIP prepared. No Chrome Web Store item has been created or submitted by this task.

## Build

```sh
npm ci
npm run check
npm run release
```

Upload `releases/TabCarry-1.0.0.zip`, not the repository ZIP. The package must contain `manifest.json` at its root. A subsequent upload must use a higher version in both package.json and public/manifest.json, and any displayed version strings.

## Store copy

**Name:** TabCarry — Save & Restore Tabs

**Short description:** Save and restore windows, tabs and groups. Search sessions and keep local backups. No account or cloud.

**Description:**

Save what you have open. Come back when you’re ready.

TabCarry keeps named snapshots of your browser windows and tabs on your own device. Save all windows, just the current window, or selected tabs. Reopen the original window structure or choose only the pages you need.

- Preserve window structure, tab order, pinned tabs and Chrome tab groups.
- Search saved sessions by name, page title or URL.
- Rename and favorite sessions; recover deleted sessions from a 30-day trash.
- Export portable JSON backups and import them with a preview.
- Restore in new windows, add to the current window, or open individual pages.
- Light and dark themes, keyboard support, English and Simplified Chinese.

No account. No analytics. No cloud storage. No remote favicon requests.

TabCarry saves URLs and browser structure, not page contents, login sessions or unsent forms. HTTP and HTTPS pages can be reopened automatically; other URLs can be copied manually. Export a backup before uninstalling or clearing extension data.

## Privacy answers

Single purpose: Save, organize and restore browser tab sessions on the user’s device.

- tabs: Read titles, URLs and tab states when saving sessions, and create/update/close tabs at the user’s request.
- tabGroups: Read and restore native group names, colors and collapsed state.
- storage: Persist preferences locally.
- Remote code: No.

Disclosures must accurately reflect local processing of page titles and full URLs. Do not say “no data stored.” No developer-operated collection or transmission is implemented.

## Assets and public policy

- Icons: `public/icons/128.png` and the smaller sizes.
- Screenshots: `docs/store/` (actual extension UI with demonstration records; not real personal sessions).
- Product/policy HTML: `docs/site/index.html`, `docs/site/privacy/index.html`.
- Product URL: https://xnu.app/tabcarry/
- Privacy URL: https://xnu.app/tabcarry/privacy/
- `.github/workflows/pages.yml` builds and deploys `.site/` on pushes to `main`. Run `npm run release` and `npm run site:build` locally. The policy page is generated from `PRIVACY_POLICY.md`; screenshots and the installable ZIP are included automatically.
- Developer dashboard: https://chrome.google.com/webstore/devconsole/
- Official instructions: https://developer.chrome.com/docs/webstore/publish

Before submission, run a normal daily-use trial for several days. This task completed automated isolated-browser acceptance, not the planned seven-day personal trial. Confirm behavior on your target stable Chrome release and OS. Submit for review only after privacy URL and store disclosures are in place.
