import { uid, type Session, type SavedTab, type SavedWindow } from "./model";
export const MAX_BYTES = 25 * 1024 * 1024,
  MAX_TABS = 50000;
const colors = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
];
function check(test: unknown, msg: string): asserts test {
  if (!test) throw new Error(msg);
}
function obj(v: unknown): asserts v is Record<string, unknown> {
  check(
    v && typeof v === "object" && !Array.isArray(v),
    "Invalid object in backup",
  );
}
function str(v: unknown, max = 20000): asserts v is string {
  check(
    typeof v === "string" && v.length <= max,
    "Invalid or oversized text in backup",
  );
}
function num(v: unknown): asserts v is number {
  check(
    typeof v === "number" && Number.isFinite(v) && v >= 0,
    "Invalid number in backup",
  );
}
export function encode(sessions: Session[]) {
  return JSON.stringify(
    {
      format: "tabcarry",
      version: 1,
      exportedAt: new Date().toISOString(),
      sessions,
    },
    null,
    2,
  );
}
export function parseBackup(text: string): Session[] {
  check(
    new TextEncoder().encode(text).length <= MAX_BYTES,
    "Backup exceeds 25 MB",
  );
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw Error("Not a valid JSON backup");
  }
  obj(root);
  check(
    root.format === "tabcarry" && root.version === 1,
    "Unsupported backup format or version",
  );
  check(
    Array.isArray(root.sessions) && root.sessions.length <= 10000,
    "Invalid session list",
  );
  let tabs = 0;
  const sessionIds = new Set<string>();
  return root.sessions.map((raw) => {
    obj(raw);
    check(raw.schemaVersion === 1, "Unsupported session schema");
    str(raw.id, 100);
    check(raw.id && !sessionIds.has(raw.id), "Duplicate or empty session ID");
    sessionIds.add(raw.id);
    str(raw.name, 160);
    num(raw.createdAt);
    num(raw.updatedAt);
    check(
      Array.isArray(raw.windows) && raw.windows.length <= 1000,
      "Invalid windows",
    );
    const windowIds = new Set<string>(),
      tabIds = new Set<string>(),
      groupIds = new Set<string>();
    const windows: SavedWindow[] = raw.windows.map((w, wi) => {
      obj(w);
      str(w.id, 100);
      check(w.id && !windowIds.has(w.id), "Duplicate window ID");
      windowIds.add(w.id);
      check(
        Array.isArray(w.groups) &&
          w.groups.length <= 10000 &&
          Array.isArray(w.tabs),
        "Invalid window contents",
      );
      const localGroups = new Set<string>();
      const groups = w.groups.map((g) => {
        obj(g);
        str(g.id, 100);
        str(g.title, 500);
        check(g.id && !groupIds.has(g.id), "Duplicate group ID");
        groupIds.add(g.id);
        localGroups.add(g.id);
        check(colors.includes(String(g.color)), "Invalid group color");
        check(typeof g.collapsed === "boolean", "Invalid group state");
        return {
          id: g.id,
          title: g.title,
          color: g.color as chrome.tabGroups.TabGroup["color"],
          collapsed: g.collapsed,
        };
      });
      const tabList: SavedTab[] = w.tabs.map((t, ti) => {
        obj(t);
        str(t.id, 100);
        check(t.id && !tabIds.has(t.id), "Duplicate tab ID");
        tabIds.add(t.id);
        str(t.url);
        str(t.title, 10000);
        check(++tabs <= MAX_TABS, "Backup exceeds 50,000 tabs");
        check(
          typeof t.pinned === "boolean" && typeof t.active === "boolean",
          "Invalid tab state",
        );
        if (t.groupRef !== undefined) {
          str(t.groupRef, 100);
          check(localGroups.has(t.groupRef), "Missing tab group");
          check(!t.pinned, "Pinned tabs cannot be grouped");
        }
        return {
          id: t.id,
          url: t.url,
          title: t.title,
          order: ti,
          pinned: t.pinned,
          active: t.active,
          ...(t.groupRef ? { groupRef: t.groupRef } : {}),
        };
      });
      check(
        tabList.filter((t) => t.active).length <= 1,
        "More than one active tab in a window",
      );
      return {
        id: w.id,
        order: wi,
        focused: !!w.focused,
        tabs: tabList,
        groups,
      };
    });
    if (raw.deletedAt !== undefined) num(raw.deletedAt);
    return {
      id: raw.id,
      schemaVersion: 1,
      name: raw.name || "Imported session",
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      revision: 1,
      favorite: !!raw.favorite,
      source: "import",
      windows,
      ...(raw.deletedAt !== undefined
        ? { deletedAt: raw.deletedAt as number }
        : {}),
    };
  });
}
export function contentKey(s: Session) {
  return JSON.stringify({
    name: s.name,
    favorite: s.favorite,
    deletedAt: s.deletedAt,
    windows: s.windows.map((w) => ({
      id: w.id,
      order: w.order,
      focused: w.focused,
      groups: w.groups.map((g) => ({
        id: g.id,
        title: g.title,
        color: g.color,
        collapsed: g.collapsed,
      })),
      tabs: w.tabs.map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title,
        order: t.order,
        pinned: t.pinned,
        active: t.active,
        groupRef: t.groupRef,
      })),
    })),
  });
}
export function mergeBackup(existing: Session[], incoming: Session[]) {
  const byId = new Map(existing.map((s) => [s.id, s])),
    byContent = new Set(existing.map(contentKey));
  let skipped = 0,
    conflicts = 0;
  const added: Session[] = [];
  for (const item of incoming) {
    const key = contentKey(item);
    if (byContent.has(key)) {
      skipped++;
      continue;
    }
    const s = { ...item };
    if (byId.has(s.id)) {
      s.id = uid();
      conflicts++;
    }
    added.push(s);
    byId.set(s.id, s);
    byContent.add(key);
  }
  return { added, skipped, conflicts };
}
