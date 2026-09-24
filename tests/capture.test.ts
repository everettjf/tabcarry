import { it, expect, vi, beforeEach } from "vitest";
import { capture, queryScope } from "../src/capture";
let list: chrome.windows.Window[];
beforeEach(() => {
  list = [
    {
      id: 1,
      type: "normal",
      focused: true,
      incognito: false,
      alwaysOnTop: false,
      tabs: [
        {
          id: 1,
          index: 0,
          windowId: 1,
          url: "https://example.test/a",
          title: "A",
          pinned: true,
          active: false,
          highlighted: false,
          incognito: false,
          groupId: -1,
        },
        {
          id: 2,
          index: 1,
          windowId: 1,
          url: "https://example.test/b",
          title: "B",
          pinned: false,
          active: true,
          highlighted: true,
          incognito: false,
          groupId: 3,
        },
        {
          id: 3,
          index: 2,
          windowId: 1,
          url: "chrome-extension://test/manager.html",
          title: "TabCarry",
          pinned: false,
          active: false,
          highlighted: false,
          incognito: false,
          groupId: -1,
        },
      ],
    },
    {
      id: 2,
      type: "normal",
      focused: false,
      incognito: true,
      alwaysOnTop: false,
      tabs: [
        {
          id: 9,
          index: 0,
          windowId: 2,
          url: "https://private.test",
          pinned: false,
          active: true,
          highlighted: true,
          incognito: true,
          groupId: -1,
        },
      ],
    },
  ] as chrome.windows.Window[];
  vi.stubGlobal("chrome", {
    runtime: { getURL: (p: string) => "chrome-extension://test/" + p },
    windows: {
      getAll: vi.fn(async () => structuredClone(list)),
      get: vi.fn(async (id: number) => list.find((w) => w.id === id)),
    },
    tabGroups: {
      query: vi.fn(async () => [
        { id: 3, windowId: 1, title: "Work", color: "blue", collapsed: false },
      ]),
    },
  });
});
it("excludes extension pages and incognito tabs and generates stable snapshot IDs", async () => {
  const { session } = await capture(
    "all",
    { windowId: 1, tabId: 2 },
    "request",
  );
  expect(session.id).toBe("request");
  expect(session.windows).toHaveLength(1);
  expect(session.windows[0].tabs).toHaveLength(2);
  expect(session.windows[0].tabs[1].groupRef).toBe(
    session.windows[0].groups[0].id,
  );
  expect(session.windows[0].tabs[0].pinned).toBe(true);
});
it("selected scope captures highlighted tabs only", async () => {
  expect(
    (await queryScope("selected", { windowId: 1 }))[0].tabs.map((t) => t.id),
  ).toEqual([2]);
});
it("captures pending navigation URL with a matching title fallback", async () => {
  list[0].tabs![1].pendingUrl = "https://next.test";
  const { session } = await capture("all", {}, "s");
  expect(session.windows[0].tabs[1]).toMatchObject({
    url: "https://next.test",
    title: "https://next.test",
  });
});
it("fails instead of silently storing inconsistent windows", async () => {
  let n = 0;
  vi.mocked(chrome.windows.getAll).mockImplementation(async () => {
    const value = structuredClone(list);
    value[0].tabs![0].url = "https://changing.test/" + n++;
    return value;
  });
  await expect(capture("all", {}, "s")).rejects.toThrow("Tabs are changing");
});
it("rejects empty selection", async () => {
  list[0].tabs!.forEach((t) => (t.highlighted = false));
  await expect(capture("selected", { windowId: 1 }, "s")).rejects.toThrow(
    "no eligible",
  );
});
