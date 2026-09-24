import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { encode, parseBackup, mergeBackup } from "../src/backup";
import {
  database,
  read,
  readAll,
  writeMany,
  update,
  removeMany,
} from "../src/db";
import { supported, matches, type Session } from "../src/model";
const sample = (): Session => ({
  id: "s1",
  schemaVersion: 1,
  name: "Research",
  createdAt: 1,
  updatedAt: 2,
  revision: 1,
  favorite: true,
  source: "manual",
  windows: [
    {
      id: "w1",
      order: 0,
      focused: true,
      groups: [{ id: "g1", title: "Reading", color: "blue", collapsed: true }],
      tabs: [
        {
          id: "t1",
          title: "A 中文 title",
          url: "https://example.test/p?a=1#part",
          order: 0,
          pinned: false,
          active: true,
          groupRef: "g1",
        },
        {
          id: "t2",
          title: "Other",
          url: "chrome://settings/",
          order: 1,
          pinned: false,
          active: false,
        },
      ],
    },
  ],
});
beforeEach(async () => {
  const db = await database();
  for (const store of ["sessions", "jobs"])
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
});
describe("portable backups", () => {
  it("round trips windows, groups, order, unsupported URLs, timestamps and trash", () => {
    const s = sample();
    s.deletedAt = 10;
    const [got] = parseBackup(encode([s]));
    expect({ ...got, source: "manual" }).toEqual(s);
  });
  it("rejects malformed JSON and future formats", () => {
    expect(() => parseBackup("{")).toThrow("valid JSON");
    expect(() =>
      parseBackup('{"format":"tabcarry","version":2,"sessions":[]}'),
    ).toThrow("Unsupported");
  });
  it("rejects dangling and duplicate group references", () => {
    const s = sample();
    s.windows[0].tabs[0].groupRef = "missing";
    expect(() => parseBackup(encode([s]))).toThrow("Missing tab group");
    const a = sample();
    a.windows[0].groups.push({ ...a.windows[0].groups[0] });
    expect(() => parseBackup(encode([a]))).toThrow("Duplicate group");
  });
  it("rejects duplicate tab IDs across windows", () => {
    const s = sample();
    s.windows.push({
      ...structuredClone(s.windows[0]),
      id: "w2",
      groups: [],
      tabs: [{ ...s.windows[0].tabs[1] }],
    });
    expect(() => parseBackup(encode([s]))).toThrow("Duplicate tab ID");
  });
  it("rejects oversized content without writing data", async () => {
    expect(() => parseBackup("x".repeat(25 * 1024 * 1024 + 1))).toThrow(
      "25 MB",
    );
    expect(await readAll("sessions")).toEqual([]);
  });
  it("does not execute dangerous URLs and keeps originals for backup", () => {
    const s = sample();
    s.windows[0].tabs[0].url = "javascript:alert(1)";
    expect(parseBackup(encode([s]))[0].windows[0].tabs[0].url).toBe(
      "javascript:alert(1)",
    );
    expect(supported("javascript:alert(1)")).toBe(false);
    expect(supported("https://example.test/?secret=a#b")).toBe(true);
  });
  it("skips identical imports, preserves conflicting copies, repeated import stays idempotent", () => {
    const s = sample();
    expect(mergeBackup([s], parseBackup(encode([s]))).skipped).toBe(1);
    const changed = sample();
    changed.name = "Changed";
    const r = mergeBackup([s], [changed]);
    expect(r.conflicts).toBe(1);
    expect(r.added[0].id).not.toBe(s.id);
    expect(mergeBackup([s, ...r.added], [changed]).skipped).toBe(1);
  });
  it("searches case-insensitive words over names, titles, URLs including Chinese", () => {
    const s = sample();
    expect(matches(s, s.windows[0].tabs[0], "research 中文 part")).toBe(true);
    expect(matches(s, s.windows[0].tabs[0], "missing")).toBe(false);
  });
});
describe("transactional storage", () => {
  it("commits durable snapshots and deletes only explicit records", async () => {
    await writeMany("sessions", [sample(), { ...sample(), id: "s2" }]);
    expect((await read<Session>("sessions", "s1"))?.windows).toEqual(
      sample().windows,
    );
    await removeMany("sessions", ["s1"]);
    expect((await readAll<Session>("sessions")).map((s) => s.id)).toEqual([
      "s2",
    ]);
  });
  it("aborts failed edits without changing stored record", async () => {
    await writeMany("sessions", [sample()]);
    await expect(
      update<Session>("sessions", "s1", (s) => {
        s.name = "wrong";
        throw Error("conflict");
      }),
    ).rejects.toThrow("conflict");
    expect((await read<Session>("sessions", "s1"))?.name).toBe("Research");
  });
  it("serializes simultaneous revision checks so only one edit succeeds", async () => {
    await writeMany("sessions", [sample()]);
    const edit = (name: string) =>
      update<Session>("sessions", "s1", (s) => {
        if (s.revision !== 1) throw Error("conflict");
        s.name = name;
        s.revision++;
        return s;
      });
    const results = await Promise.allSettled([edit("One"), edit("Two")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await read<Session>("sessions", "s1"))?.revision).toBe(2);
  });
});
