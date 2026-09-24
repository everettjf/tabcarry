import { read, readAll, writeMany, update } from "./db";
import {
  uid,
  supported,
  errorText,
  type Job,
  type Session,
  type RestoreOptions,
  type JobItem,
} from "./model";
const active = new Set<string>();
export async function interruptOldJobs() {
  for (const j of await readAll<Job>("jobs"))
    if (j.status === "running") {
      j.status = "interrupted";
      j.items = j.items.map((i) =>
        i.state === "opening"
          ? {
              ...i,
              state: "unknown",
              error:
                "Opening was interrupted. Check your tabs before opening this page again.",
            }
          : i,
      );
      if (j.creatingWindow)
        j.warnings.push(
          "A window may have been created before interruption. Check open windows.",
        );
      await writeMany("jobs", [j]);
    }
}
export async function startRestore(
  session: Session,
  options: RestoreOptions,
  id: string = uid(),
  browserEpoch?: string,
) {
  const existing = await read<Job>("jobs", id);
  if (existing) return existing;
  if (options.mode === "current") {
    if (options.target.windowId === undefined) throw Error("No target window");
    const w = await chrome.windows.get(options.target.windowId);
    if (w.incognito || w.type !== "normal")
      throw Error("Target must be a normal window");
  }
  const selected = options.tabIds ? new Set(options.tabIds) : undefined;
  const windows = session.windows
    .map((w) => ({
      ...w,
      tabs: w.tabs.filter((t) => !selected || selected.has(t.id)),
    }))
    .filter((w) => w.tabs.length);
  if (!windows.length) throw Error("Select at least one tab");
  const items: JobItem[] = windows.flatMap((w) =>
    w.tabs.map((tab) => ({
      key: tab.id,
      windowRef: w.id,
      tab,
      state: "pending",
    })),
  );
  const now = Date.now();
  const job: Job = {
    browserEpoch,
    id,
    sessionId: session.id,
    name: session.name,
    createdAt: now,
    updatedAt: now,
    status: "running",
    cancel: false,
    options,
    windows,
    items,
    windowMap: {},
    groupMap: {},
    warnings: [],
  };
  await writeMany("jobs", [job]);
  void runRestore(id);
  return job;
}
async function patch(id: string, fn: (j: Job) => void) {
  return update<Job>("jobs", id, (j) => {
    fn(j);
    j.updatedAt = Date.now();
    return j;
  });
}
async function itemPatch(id: string, key: string, value: Partial<JobItem>) {
  return patch(id, (j) => {
    Object.assign(
      j.items.find((i) => i.key === key)!,
      value,
    );
  });
}
export async function cancelRestore(id: string) {
  return patch(id, (j) => {
    j.cancel = true;
  });
}
export async function retryRestore(id: string, browserEpoch?: string) {
  const job = await read<Job>("jobs", id);
  if (!job) throw Error("Restore not found");
  if (browserEpoch && job.browserEpoch !== browserEpoch)
    throw Error(
      "Browser restarted or extension reloaded. Start a fresh restore from the saved session; old tab references cannot be reused.",
    );
  if (active.has(id)) throw Error("Restore is still running");
  if (job.creatingWindow)
    throw Error(
      "Window creation was interrupted. Check your windows and start a new restore.",
    );
  await patch(id, (j) => {
    j.cancel = false;
    j.status = "running";
    j.items = j.items.map((i) =>
      i.state === "failed"
        ? {
            ...i,
            state: i.tabId !== undefined ? "created" : "pending",
            error: undefined,
          }
        : i,
    );
  });
  void runRestore(id);
}
export async function runRestore(id: string) {
  if (active.has(id)) return;
  active.add(id);
  try {
    let job = await read<Job>("jobs", id);
    if (!job) return;
    for (const initial of job.items) {
      job = (await read<Job>("jobs", id))!;
      if (job.cancel) {
        await patch(id, (j) => {
          j.status = "cancelled";
        });
        return;
      }
      let item = job.items.find((i) => i.key === initial.key)!;
      if (!["pending", "created"].includes(item.state)) continue;
      if (!supported(item.tab.url)) {
        await itemPatch(id, item.key, {
          state: "skipped",
          error:
            "Only HTTP and HTTPS pages can be reopened. Copy this URL to open it manually.",
        });
        continue;
      }
      try {
        let windowId =
          job.options.mode === "current"
            ? job.options.target.windowId
            : job.windowMap[item.windowRef];
        if (
          job.options.skipExisting &&
          windowId !== undefined &&
          item.state === "pending"
        ) {
          const tabs = await chrome.tabs.query({ windowId });
          if (tabs.some((t) => (t.pendingUrl || t.url) === item.tab.url)) {
            await itemPatch(id, item.key, {
              state: "skipped",
              error: "This URL is already open in the target window.",
            });
            continue;
          }
        }
        if (windowId === undefined) {
          await patch(id, (j) => {
            j.creatingWindow = item.windowRef;
          });
          // The initial blank tab is reused, so restore never leaves an extra new-tab page.
          const w = await chrome.windows.create({
            url: "about:blank",
            focused: false,
            type: "normal",
          });
          if (w.id === undefined)
            throw Error("Chrome did not return the new window");
          windowId = w.id;
          await patch(id, (j) => {
            j.windowMap[item.windowRef] = windowId!;
            delete j.creatingWindow;
          });
          const first =
            w.tabs?.[0] || (await chrome.tabs.query({ windowId }))[0];
          if (first?.id !== undefined) {
            await itemPatch(id, item.key, {
              state: "created",
              tabId: first.id,
            });
            item = { ...item, state: "created", tabId: first.id };
          }
        }
        // A closed destination is an explicit failure, never replaced by an arbitrary window.
        await chrome.windows.get(windowId);
        let tabId = item.tabId;
        if (item.state !== "created") {
          await itemPatch(id, item.key, { state: "opening", error: undefined });
          const t = await chrome.tabs.create({
            windowId,
            url: item.tab.url,
            active: false,
            pinned: item.tab.pinned,
          });
          if (t.id === undefined) throw Error("Chrome did not return a tab ID");
          tabId = t.id;
          await itemPatch(id, item.key, {
            state: "created",
            tabId,
            urlApplied: true,
          });
        } else {
          if (tabId === undefined) throw Error("Missing created tab ID");
          const existing = await chrome.tabs.get(tabId);
          const existingUrl = existing.pendingUrl || existing.url;
          if (
            existing.windowId !== windowId ||
            (existingUrl !== item.tab.url &&
              (item.urlApplied || existingUrl !== "about:blank"))
          ) {
            await itemPatch(id, item.key, {
              state: "unknown",
              error:
                "This tab moved or navigated after the restore started. It was left unchanged. Open this saved page manually if needed.",
            });
            continue;
          }
          await chrome.tabs.update(tabId, {
            ...(existingUrl !== item.tab.url ? { url: item.tab.url } : {}),
            pinned: item.tab.pinned,
          });
          await itemPatch(id, item.key, { urlApplied: true });
        }
        if (item.tab.groupRef && !item.tab.pinned) {
          job = (await read<Job>("jobs", id))!;
          let gid: number | undefined = job.groupMap[item.tab.groupRef];
          if (gid !== undefined) {
            try {
              const group = await chrome.tabGroups.get(gid);
              if (group.windowId !== windowId) gid = undefined;
            } catch {
              gid = undefined;
            }
          }
          if (gid === undefined) {
            gid = await chrome.tabs.group({
              tabIds: [tabId!],
              createProperties: { windowId },
            });
            const meta = job.windows
              .flatMap((w) => w.groups)
              .find((g) => g.id === item.tab.groupRef);
            await patch(id, (j) => {
              j.groupMap[item.tab.groupRef!] = gid!;
            });
            if (meta)
              await chrome.tabGroups.update(gid, {
                title: meta.title,
                color: meta.color,
              });
          } else await chrome.tabs.group({ groupId: gid, tabIds: [tabId!] });
        }
        await itemPatch(id, item.key, { state: "done", error: undefined });
      } catch (e) {
        const latest = (await read<Job>("jobs", id))!.items.find(
          (i) => i.key === item.key,
        )!;
        // If a tab already exists, a decoration failure must not reopen that URL on retry.
        if (latest.state === "created" && latest.urlApplied)
          await itemPatch(id, item.key, {
            state: "done",
            error: `Page opened; layout could not be fully restored: ${errorText(e)}`,
          });
        else
          await itemPatch(id, item.key, {
            state: "failed",
            error: errorText(e),
          });
      }
    }
    job = (await read<Job>("jobs", id))!;
    for (const w of job.windows) {
      const restored = job.items.filter(
        (i) =>
          i.windowRef === w.id && i.state === "done" && i.tabId !== undefined,
      );
      const chosen = restored.find((i) => i.tab.active) || restored[0];
      if (chosen && job.options.mode === "original") {
        try {
          await chrome.tabs.update(chosen.tabId!, { active: true });
        } catch {
          /* closed by user */
        }
      }
      for (const group of w.groups) {
        const gid = job.groupMap[group.id];
        if (gid !== undefined) {
          try {
            const current = await chrome.tabGroups.get(gid);
            const destination =
              job.options.mode === "original"
                ? job.windowMap[w.id]
                : job.options.target.windowId;
            if (current.windowId === destination)
              await chrome.tabGroups.update(gid, {
                collapsed: group.collapsed,
              });
          } catch (e) {
            await patch(id, (j) => {
              j.warnings.push(errorText(e));
            });
          }
        }
      }
    }
    const focus = job.windows.find((w) => w.focused) || job.windows[0];
    const focusId =
      job.options.mode === "original"
        ? job.windowMap[focus?.id]
        : job.options.target.windowId;
    if (focusId !== undefined) {
      try {
        await chrome.windows.update(focusId, { focused: true });
      } catch {}
    }
    await patch(id, (j) => {
      j.status = j.cancel ? "cancelled" : "complete";
    });
  } catch (e) {
    try {
      await patch(id, (j) => {
        j.status = "interrupted";
        j.warnings.push(errorText(e));
        j.items = j.items.map((i) =>
          i.state === "opening"
            ? {
                ...i,
                state: "unknown",
                error:
                  "Result uncertain. Check your open tabs before retrying manually.",
              }
            : i,
        );
      });
    } catch {
      /* Storage failure remains visible as a running job until next startup. */
    }
  } finally {
    active.delete(id);
  }
}
