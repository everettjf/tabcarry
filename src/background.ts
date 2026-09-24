import { read, readAll, writeMany, update, removeMany } from "./db";
import { capture, queryScope, resolveTarget } from "./capture";
import { encode, parseBackup, mergeBackup } from "./backup";
import {
  interruptOldJobs,
  startRestore,
  cancelRestore,
  retryRestore,
} from "./restore";
import {
  defaults,
  supported,
  errorText,
  type Command,
  type Session,
  type Job,
  type Preferences,
  type Reply,
} from "./model";
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>) {
  const result = queue.then(fn, fn);
  queue = result.catch(() => {});
  return result;
}
const ready = (async () => {
  const stored = await chrome.storage.session.get("browserEpoch");
  const epoch = stored.browserEpoch || crypto.randomUUID();
  await chrome.storage.session.set({ browserEpoch: epoch });
  await interruptOldJobs();
  return epoch as string;
})();
async function prefs(value?: Partial<Preferences>) {
  const stored = await chrome.storage.local.get("preferences");
  const old = { ...defaults, ...stored.preferences };
  if (value) {
    if (value.theme && !["system", "light", "dark"].includes(value.theme))
      throw Error("Invalid theme");
    if (value.language && !["system", "en", "zh"].includes(value.language))
      throw Error("Invalid language");
    if (value.scope && !["all", "window", "selected"].includes(value.scope))
      throw Error("Invalid scope");
    const next = { ...old, ...value };
    await chrome.storage.local.set({ preferences: next });
    return next;
  }
  return old;
}
async function handle(c: Command): Promise<unknown> {
  const epoch = await ready;
  if ("target" in c && c.target?.epoch && c.target.epoch !== epoch) {
    if (c.type === "context") c = { type: "context", target: {} };
    else
      throw Error(
        "The original browser session has ended. Reopen TabCarry from the window you want to use.",
      );
  }
  if (
    c.type === "restore" &&
    c.options.mode === "current" &&
    c.options.target.epoch &&
    c.options.target.epoch !== epoch
  )
    throw Error(
      "The original browser session has ended. Choose new windows or reopen TabCarry.",
    );
  switch (c.type) {
    case "list": {
      const sessions = await readAll<Session>("sessions");
      const expired = sessions
        .filter((s) => s.deletedAt && s.deletedAt < Date.now() - 30 * 86400000)
        .map((s) => s.id);
      if (expired.length) await serial(() => removeMany("sessions", expired));
      return sessions
        .filter((s) => !expired.includes(s.id))
        .sort((a, b) => b.createdAt - a.createdAt);
    }
    case "jobs":
      return (await readAll<Job>("jobs")).sort(
        (a, b) => b.createdAt - a.createdAt,
      );
    case "prefs":
      return c.value ? serial(() => prefs(c.value)) : prefs();
    case "context": {
      const target = { ...(await resolveTarget(c.target || {})), epoch };
      const all = await queryScope("all", target);
      const windows = await queryScope("window", target);
      const selected = await queryScope("selected", target);
      const raw = await chrome.tabs.query({});
      return {
        target,
        all: all.reduce((n, w) => n + w.tabs.length, 0),
        windows: all.length,
        window: windows.reduce((n, w) => n + w.tabs.length, 0),
        selected: selected.reduce((n, w) => n + w.tabs.length, 0),
        excluded:
          raw.filter((t) => !t.incognito).length -
          all.reduce((n, w) => n + w.tabs.length, 0),
      };
    }
    case "save":
    case "saveClose":
      return serial(async () => {
        const existing = await read<Session>("sessions", c.requestId);
        if (existing) return { session: existing, closed: 0, kept: 0 };
        const { session, live } = await capture(c.scope, c.target, c.requestId);
        await writeMany("sessions", [session]);
        let closed = 0,
          kept = 0;
        if (c.type === "saveClose") {
          for (const t of live) {
            try {
              const now = await chrome.tabs.get(t.id);
              if ((now.pendingUrl || now.url) !== t.url) {
                kept++;
                continue;
              }
              await chrome.tabs.remove(t.id);
              closed++;
            } catch {
              kept++;
            }
          }
        }
        return { session, closed, kept };
      });
    case "change":
      return serial(() =>
        update<Session>("sessions", c.id, (s) => {
          if (s.revision !== c.revision)
            throw Error(
              "This session changed in another page. Refresh and try again.",
            );
          const { name, favorite, deletedAt } = c.patch;
          if (name !== undefined) {
            if (!name.trim() || name.length > 160)
              throw Error("Use a name between 1 and 160 characters.");
            s.name = name.trim();
          }
          if (favorite !== undefined) s.favorite = favorite;
          if (deletedAt === null) delete s.deletedAt;
          else if (deletedAt !== undefined) s.deletedAt = Date.now();
          s.updatedAt = Date.now();
          s.revision++;
          return s;
        }),
      );
    case "purge":
      return serial(async () => {
        const sessions = await readAll<Session>("sessions");
        if (
          c.ids.some((id) => sessions.some((s) => s.id === id && !s.deletedAt))
        )
          throw Error("Only deleted sessions can be permanently removed");
        await removeMany("sessions", c.ids);
      });
    case "export":
      return encode(
        (await readAll<Session>("sessions")).filter(
          (s) => !c.ids || c.ids.includes(s.id),
        ),
      );
    case "import":
      return serial(async () => {
        const incoming = parseBackup(c.text);
        const result = mergeBackup(
          await readAll<Session>("sessions"),
          incoming,
        );
        await writeMany("sessions", result.added);
        return {
          added: result.added.length,
          skipped: result.skipped,
          conflicts: result.conflicts,
        };
      });
    case "restore":
      return serial(async () => {
        const s = await read<Session>("sessions", c.id);
        if (!s || s.deletedAt) throw Error("Session no longer available");
        return startRestore(s, c.options, c.requestId, await ready);
      });
    case "cancel":
      return cancelRestore(c.id);
    case "retry":
      return serial(async () => retryRestore(c.id, await ready));
    case "dismissJob": {
      const j = await read<Job>("jobs", c.id);
      if (j?.status === "running")
        throw Error("Stop this restore before dismissing");
      return removeMany("jobs", [c.id]);
    }
    case "library": {
      const p = new URLSearchParams();
      p.set("epoch", epoch);
      if (c.target.windowId !== undefined)
        p.set("window", String(c.target.windowId));
      if (c.target.tabId !== undefined) p.set("tab", String(c.target.tabId));
      await chrome.tabs.create({
        url: chrome.runtime.getURL(`manager.html?${p}`),
      });
      return null;
    }
    case "open": {
      if (!supported(c.url))
        throw Error(
          "This URL cannot be reopened automatically. Copy it to open manually.",
        );
      const target = await resolveTarget(c.target);
      if (c.current) {
        if (target.tabId === undefined) throw Error("Original tab unavailable");
        const tab = await chrome.tabs.get(target.tabId);
        if (
          tab.windowId !== target.windowId ||
          tab.url?.startsWith(chrome.runtime.getURL(""))
        )
          throw Error("Original page unavailable. Open in a new tab instead.");
        await chrome.tabs.update(target.tabId, { url: c.url, active: true });
        await chrome.windows.update(target.windowId!, { focused: true });
      } else
        await chrome.tabs.create({
          windowId: target.windowId,
          url: c.url,
          active: !c.background,
        });
      return null;
    }
  }
}
chrome.runtime.onMessage.addListener(
  (command: Command, sender, sendResponse: (r: Reply) => void) => {
    if (
      sender.id !== chrome.runtime.id ||
      !sender.url?.startsWith(chrome.runtime.getURL(""))
    )
      return false;
    void handle(command).then(
      (data) => sendResponse({ ok: true, data }),
      (e) => sendResponse({ ok: false, error: errorText(e) }),
    );
    return true;
  },
);
chrome.commands.onCommand.addListener((command) => {
  void (async () => {
    try {
      await ready;
      const target = await resolveTarget({});
      if (command === "save-session") {
        await handle({
          type: "save",
          scope: "all",
          target,
          requestId: crypto.randomUUID(),
        });
        await chrome.action.setBadgeText({ text: "✓" });
        await chrome.action.setBadgeBackgroundColor({ color: "#315CCD" });
        await chrome.action.setTitle({ title: "TabCarry — Session saved" });
      } else if (command === "open-library")
        await handle({ type: "library", target });
    } catch (e) {
      await chrome.action.setBadgeText({ text: "!" });
      await chrome.action.setTitle({ title: `TabCarry — ${errorText(e)}` });
    }
  })();
});
