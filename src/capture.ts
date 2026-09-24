import { uid, type Scope, type Target, type Session } from "./model";
export function isUserTab(t: chrome.tabs.Tab) {
  return (
    !t.incognito &&
    !!(t.pendingUrl || t.url) &&
    !(t.pendingUrl || t.url || "").startsWith(chrome.runtime.getURL(""))
  );
}
export async function resolveTarget(target: Target): Promise<Target> {
  if (target.windowId !== undefined) {
    try {
      const w = await chrome.windows.get(target.windowId);
      if (w.type === "normal" && !w.incognito) return target;
    } catch {}
    throw Error(
      "The original window is closed. Open TabCarry from the window you want to use.",
    );
  }
  const w = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  if (w.id === undefined || w.incognito)
    throw Error("No normal browser window available");
  const tabs = await chrome.tabs.query({ windowId: w.id, active: true });
  return { windowId: w.id, tabId: tabs[0]?.id };
}
export async function queryScope(scope: Scope, target: Target) {
  const windows = await chrome.windows.getAll({
    populate: true,
    windowTypes: ["normal"],
  });
  return windows
    .filter(
      (w) => !w.incognito && (scope === "all" || w.id === target.windowId),
    )
    .map((w) => ({
      ...w,
      tabs: (w.tabs || []).filter(
        (t) => isUserTab(t) && (scope !== "selected" || t.highlighted),
      ),
    }))
    .filter((w) => w.tabs.length);
}
function signature(windows: Awaited<ReturnType<typeof queryScope>>) {
  return JSON.stringify(
    windows.map((w) => [
      w.id,
      w.tabs.map((t) => [
        t.id,
        t.pendingUrl || t.url,
        t.index,
        t.pinned,
        t.groupId,
      ]),
    ]),
  );
}
export async function capture(scope: Scope, target: Target, requestId: string) {
  const actual = scope === "all" ? target : await resolveTarget(target);
  for (let attempt = 0; attempt < 3; attempt++) {
    const windows = await queryScope(scope, actual);
    if (!windows.length) throw Error("There are no eligible tabs to save.");
    const allGroups = await chrome.tabGroups.query({});
    const second = await queryScope(scope, actual);
    if (signature(windows) !== signature(second)) continue;
    const now = Date.now();
    const s: Session = {
      id: requestId,
      schemaVersion: 1,
      name: new Date(now).toLocaleString(),
      createdAt: now,
      updatedAt: now,
      revision: 1,
      favorite: false,
      source: "manual",
      windows: windows.map((w, wi) => {
        const usedGroups = allGroups.filter(
          (g) => g.windowId === w.id && w.tabs.some((t) => t.groupId === g.id),
        );
        const mapping = new Map(usedGroups.map((g) => [g.id, uid()]));
        return {
          id: uid(),
          order: wi,
          focused: w.focused,
          groups: usedGroups.map((g) => ({
            id: mapping.get(g.id)!,
            title: g.title || "",
            color: g.color,
            collapsed: g.collapsed,
          })),
          tabs: w.tabs.map((t, ti) => ({
            id: uid(),
            url: t.pendingUrl || t.url || "",
            title:
              (t.pendingUrl && t.pendingUrl !== t.url
                ? t.pendingUrl
                : t.title) ||
              t.url ||
              "",
            order: ti,
            pinned: !!t.pinned,
            active:
              !!t.active ||
              (!w.tabs.some((x) => x.active) && t.id === target.tabId),
            ...(t.groupId !== undefined && mapping.has(t.groupId)
              ? { groupRef: mapping.get(t.groupId) }
              : {}),
          })),
        };
      }),
    };
    return {
      session: s,
      live: windows.flatMap((w) =>
        w.tabs.map((t) => ({ id: t.id!, url: t.pendingUrl || t.url || "" })),
      ),
    };
  }
  throw Error("Tabs are changing. Wait a moment, then save again.");
}
