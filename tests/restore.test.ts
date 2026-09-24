import "fake-indexeddb/auto";
import { it, expect, beforeEach, vi } from "vitest";
import { database, read, writeMany } from "../src/db";
import {
  startRestore,
  interruptOldJobs,
  retryRestore,
  cancelRestore,
} from "../src/restore";
import { type Session, type Job } from "../src/model";
let nextTab = 1,
  nextWindow = 1,
  nextGroup = 1;
let tabs: Map<number, any>, windows: Map<number, any>, groups: Map<number, any>;
const s = (): Session => ({
  id: "s",
  schemaVersion: 1,
  name: "Work",
  createdAt: 1,
  updatedAt: 1,
  revision: 1,
  favorite: false,
  source: "manual",
  windows: [
    {
      id: "w",
      order: 0,
      focused: true,
      groups: [{ id: "g", title: "Group", color: "green", collapsed: true }],
      tabs: [
        {
          id: "a",
          url: "https://a.test",
          title: "A",
          order: 0,
          pinned: false,
          active: true,
          groupRef: "g",
        },
        {
          id: "b",
          url: "https://b.test",
          title: "B",
          order: 1,
          pinned: true,
          active: false,
        },
        {
          id: "c",
          url: "chrome://settings",
          title: "Settings",
          order: 2,
          pinned: false,
          active: false,
        },
      ],
    },
  ],
});
async function finished(id: string) {
  for (let n = 0; n < 200; n++) {
    const job = await read<Job>("jobs", id);
    if (job?.status !== "running") return job!;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("timeout");
}
beforeEach(async () => {
  nextTab = nextWindow = nextGroup = 1;
  tabs = new Map();
  windows = new Map();
  groups = new Map();
  const db = await database();
  await new Promise<void>((r) => {
    const tx = db.transaction("jobs", "readwrite");
    tx.objectStore("jobs").clear();
    tx.oncomplete = () => r();
  });
  vi.stubGlobal("chrome", {
    windows: {
      create: vi.fn(async () => {
        const id = nextWindow++,
          tab = { id: nextTab++, windowId: id, url: "about:blank" };
        tabs.set(tab.id, tab);
        const w = { id, type: "normal", tabs: [tab] };
        windows.set(id, w);
        return w;
      }),
      get: vi.fn(async (id: number) => {
        if (!windows.has(id)) throw Error("Window closed");
        return windows.get(id);
      }),
      update: vi.fn(async () => {}),
    },
    tabs: {
      create: vi.fn(async (value: any) => {
        const t = { ...value, id: nextTab++ };
        tabs.set(t.id, t);
        return t;
      }),
      query: vi.fn(async ({ windowId }: any) =>
        [...tabs.values()].filter((t) => t.windowId === windowId),
      ),
      get: vi.fn(async (id: number) => tabs.get(id)),
      update: vi.fn(async (id: number, p: any) => {
        if (!tabs.has(id)) throw Error("Tab closed");
        Object.assign(tabs.get(id), p);
        return tabs.get(id);
      }),
      group: vi.fn(async (p: any) => {
        if (p.groupId) return p.groupId;
        const id = nextGroup++;
        groups.set(id, { windowId: p.createProperties.windowId });
        return id;
      }),
    },
    tabGroups: {
      get: vi.fn(async (id: number) => {
        if (!groups.has(id)) throw Error("Group gone");
        return groups.get(id);
      }),
      update: vi.fn(async (id: number, p: any) =>
        Object.assign(groups.get(id), p),
      ),
    },
  });
});
it("restores normal pages, groups and pinned state, skips internal URLs with explanation", async () => {
  await startRestore(
    s(),
    { mode: "original", target: {}, skipExisting: false },
    "j",
  );
  const job = await finished("j");
  expect(job.items.map((i) => i.state)).toEqual(["done", "done", "skipped"]);
  expect([...tabs.values()].map((t) => t.url)).toEqual([
    "https://a.test",
    "https://b.test",
  ]);
  expect([...tabs.values()][1].pinned).toBe(true);
  expect([...groups.values()][0]).toMatchObject({
    title: "Group",
    collapsed: true,
  });
});
it("restores selected tabs only", async () => {
  await startRestore(
    s(),
    { mode: "original", target: {}, skipExisting: false, tabIds: ["b"] },
    "j",
  );
  const job = await finished("j");
  expect(job.items).toHaveLength(1);
  expect([...tabs.values()][0].url).toBe("https://b.test");
});
it("deduplicates exact URLs only when requested", async () => {
  windows.set(1, { id: 1, type: "normal" });
  tabs.set(99, { id: 99, windowId: 1, url: "https://a.test" });
  await startRestore(
    s(),
    { mode: "current", target: { windowId: 1 }, skipExisting: true },
    "j",
  );
  expect((await finished("j")).items[0].state).toBe("skipped");
  expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
});
it("does not replace a closed target window", async () => {
  await expect(
    startRestore(
      s(),
      { mode: "current", target: { windowId: 88 }, skipExisting: false },
      "j",
    ),
  ).rejects.toThrow("Window closed");
  expect(chrome.windows.create).not.toHaveBeenCalled();
});
it("retains a report for per-tab failure and retry does not duplicate completed items", async () => {
  vi.mocked(chrome.tabs.create).mockRejectedValueOnce(
    Error("Temporary failure"),
  );
  await startRestore(
    s(),
    { mode: "original", target: {}, skipExisting: false },
    "j",
  );
  expect((await finished("j")).items[1].state).toBe("failed");
  await retryRestore("j");
  expect((await finished("j")).items[1].state).toBe("done");
  expect(
    [...tabs.values()].filter((t) => t.url === "https://a.test"),
  ).toHaveLength(1);
});
it("keeps layout errors separate from tab creation so retry cannot duplicate tabs", async () => {
  vi.mocked(chrome.tabs.group).mockRejectedValueOnce(Error("Group refused"));
  await startRestore(
    s(),
    { mode: "original", target: {}, skipExisting: false },
    "j",
  );
  const job = await finished("j");
  expect(job.items[0].state).toBe("done");
  expect(job.items[0].error).toContain("layout");
});
it("duplicate start request returns the same job", async () => {
  const opts = { mode: "original" as const, target: {}, skipExisting: false };
  await startRestore(s(), opts, "j");
  await finished("j");
  await startRestore(s(), opts, "j");
  expect(chrome.windows.create).toHaveBeenCalledTimes(1);
});
it("marks uncertain creation after restart and does not automatically retry it", async () => {
  await startRestore(
    s(),
    { mode: "original", target: {}, skipExisting: false },
    "j",
  );
  let j = await finished("j");
  j.status = "running";
  j.items[0].state = "opening";
  await writeMany("jobs", [j]);
  await interruptOldJobs();
  j = (await read<Job>("jobs", "j"))!;
  expect(j.status).toBe("interrupted");
  expect(j.items[0].state).toBe("unknown");
  const before = tabs.size;
  await retryRestore("j");
  await finished("j");
  expect(tabs.size).toBe(before);
});
it("stop leaves completed tabs intact", async () => {
  await startRestore(
    s(),
    { mode: "original", target: {}, skipExisting: false },
    "j",
  );
  await cancelRestore("j");
  const job = await finished("j");
  expect(job.status).toBe("cancelled");
  expect(job.items.some((i) => i.state === "pending")).toBe(true);
});
it("a failed navigation of the initial blank tab is not reported as restored", async () => {
  vi.mocked(chrome.tabs.update).mockRejectedValueOnce(
    Error("Navigation refused"),
  );
  await startRestore(
    s(),
    { mode: "original", target: {}, skipExisting: false },
    "j",
  );
  const job = await finished("j");
  expect(job.items[0].state).toBe("failed");
  const before = tabs.size;
  await retryRestore("j");
  expect((await finished("j")).items[0].state).toBe("done");
  expect(tabs.size).toBe(before);
});
it("new groups explicitly target their restored window", async () => {
  await startRestore(
    s(),
    { mode: "original", target: {}, skipExisting: false },
    "j",
  );
  const job = await finished("j");
  expect(chrome.tabs.group).toHaveBeenCalledWith(
    expect.objectContaining({
      createProperties: { windowId: job.windowMap.w },
    }),
  );
});
it("rejects retry with tab references from another browser lifetime", async () => {
  await startRestore(
    s(),
    { mode: "original", target: {}, skipExisting: false },
    "j",
    "old-browser",
  );
  await finished("j");
  await expect(retryRestore("j", "new-browser")).rejects.toThrow(
    "Browser restarted",
  );
});
it("leaves a created tab unchanged when the user navigated it before retry", async () => {
  vi.mocked(chrome.tabs.update).mockRejectedValueOnce(
    Error("Navigation refused"),
  );
  await startRestore(
    s(),
    { mode: "original", target: {}, skipExisting: false },
    "j",
  );
  const job = await finished("j");
  const tabId = job.items[0].tabId!;
  tabs.get(tabId).url = "https://user-work.test";
  await retryRestore("j");
  expect((await finished("j")).items[0].state).toBe("unknown");
  expect(tabs.get(tabId).url).toBe("https://user-work.test");
});

it("does not pull later tabs into a group moved to another window", async () => {
  const session = s();
  session.windows[0].tabs[1].pinned = false;
  session.windows[0].tabs[1].groupRef = "g";
  vi.mocked(chrome.tabGroups.get).mockImplementation(async (id: number) => {
    const group = groups.get(id);
    if (id === 1) group.windowId = 99;
    return group;
  });
  await startRestore(
    session,
    { mode: "original", target: {}, skipExisting: false },
    "moved",
  );
  const job = await finished("moved");
  expect(job.items.slice(0, 2).map((i) => i.state)).toEqual(["done", "done"]);
  expect(chrome.tabs.group).not.toHaveBeenCalledWith(
    expect.objectContaining({ groupId: 1 }),
  );
  expect(groups.size).toBe(2);
  expect(groups.get(1).collapsed).toBeUndefined();
  expect(groups.get(2).windowId).toBe(job.windowMap.w);
});
