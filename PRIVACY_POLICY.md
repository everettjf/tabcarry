# TabCarry Privacy Policy

Effective September 24, 2026 · Version 1.0.0

TabCarry saves browser tab sessions locally. It does not have an account system, developer-operated backend, advertising, analytics or cloud synchronization. It does not send saved page titles or URLs to the developer. The extension uses bundled icons and domain initials rather than requesting a remote favicon service.

## Data stored on your device

Sessions are stored in the extension’s IndexedDB database. They include session names, timestamps, page titles, full URLs, tab order, window structure, pinned and active states, tab-group metadata, favorites and deletion timestamps. Restore reports contain the session data needed to complete a restore, browser tab/window IDs for that operation, status and errors. Preferences are stored in `chrome.storage.local`. A temporary identifier in `chrome.storage.session` prevents old browser tab references from being reused after a restart or extension reload.

Saved sessions remain until you delete them. Deleted sessions are kept in the trash for up to 30 days and are cleared when the extension next checks the library; you can also permanently delete them earlier. Restore reports are separate local records: dismiss a completed, stopped or interrupted report to remove it. Removing a session does not remove an existing restore report for that session. Exported backup files are separate copies that you control.

Uninstalling or clearing extension data can remove this information. Export an independent backup first. Data is local but is not encrypted by TabCarry; someone with access to your browser profile or backup files may be able to read it.

## Actions you control

Saving reads tab information from normal windows in your current browser profile. Incognito windows and TabCarry’s own pages are excluded. Saving does not close pages unless you explicitly choose Save and close tabs. TabCarry does not read page contents, form fields, cookies, passwords or browsing history.

Opening saved pages contacts their websites as ordinary browser navigation. Those websites have their own privacy policies. Import reads a JSON file you choose. Export downloads a JSON file containing your saved sessions and trash, or a selected session; restore reports and preferences are not included. Copy URL writes the selected URL to the system clipboard. The extension does not synchronize these records; your browser or operating system may have separate synchronization or backup behavior.

## Permissions

- `tabs`: read titles, URLs and tab state to capture sessions, and open, update or close tabs when requested.
- `tabGroups`: read and restore group names, colors and collapsed state.
- `storage`: save local preferences.

No host permissions or content scripts are requested. Website contents and login sessions are not backed up or restored.

## Contact

Contact the developer at xnuapp@gmail.com or through https://github.com/everettjf/tabcarry/issues. Do not attach personal session backups or sensitive URLs to public issues.
