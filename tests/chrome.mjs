import { chromium } from "playwright";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const output = process.env.TABCARRY_QA_DIR || join(tmpdir(), "tabcarry-qa");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "tabcarry-chrome-"));
const extension = resolve("dist");
const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    `<html><title>${req.url.includes("design") ? "Design system — Component reference" : req.url.includes("research") ? "Research notes — Browser workflows" : "Project workspace — TabCarry"}</title><body><h1>TabCarry test page</h1><p>${req.url}</p></body></html>`,
  );
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
let ctx;
const logs = [],
  errors = [];
async function launch() {
  return chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
    viewport: { width: 1440, height: 1000 },
  });
}
try {
  ctx = await launch();
  let worker =
    ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  const source = await worker.evaluate(async (origin) => {
    const initial = await chrome.tabs.query({});
    for (const tab of initial)
      if (tab.id) await chrome.tabs.update(tab.id, { url: `${origin}/start` });
    const first = await chrome.windows.getLastFocused({ populate: true });
    const a = await chrome.tabs.create({
      windowId: first.id,
      url: `${origin}/research?q=one#part`,
      active: true,
    });
    const b = await chrome.tabs.create({
      windowId: first.id,
      url: `${origin}/design`,
      active: false,
    });
    const c = await chrome.tabs.create({
      windowId: first.id,
      url: `${origin}/pinned`,
      pinned: true,
      active: false,
    });
    const group = await chrome.tabs.group({ tabIds: [a.id, b.id] });
    await chrome.tabGroups.update(group, {
      title: "Product research",
      color: "blue",
      collapsed: false,
    });
    await chrome.windows.create({
      url: [`${origin}/second`, `${origin}/design`],
      focused: false,
    });
    return { windowId: first.id, tabId: a.id };
  }, origin);
  let page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(
    `chrome-extension://${extensionId}/manager.html?window=${source.windowId}&tab=${source.tabId}`,
  );
  const rpc = async (c) => {
    const r = await page.evaluate((c) => chrome.runtime.sendMessage(c), c);
    assert.equal(r.ok, true, r.error);
    return r.data;
  };
  await page.getByRole("heading", { name: "Your sessions" }).waitFor();
  await page.screenshot({ path: join(output, "01-empty.png"), fullPage: true });
  await page
    .getByRole("button", { name: /Save session/ })
    .first()
    .click();
  await page.getByRole("status").filter({ hasText: "Session saved" }).waitFor();
  let saved = (await rpc({ type: "list" }))[0];
  assert.equal(saved.windows.length, 2);
  assert.equal(saved.windows.flatMap((w) => w.tabs).length, 6);
  assert(
    saved.windows.some((w) =>
      w.groups.some((g) => g.title === "Product research"),
    ),
  );
  logs.push(
    "Native capture: 2 windows, 6 tabs, group metadata, pinned state; extension pages excluded.",
  );
  await page.locator(".detail-actions summary").click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByLabel("Session name").fill("Product research");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await page
    .getByRole("heading", { name: "Product research", exact: true })
    .waitFor();
  saved = (await rpc({ type: "list" }))[0];
  await page.screenshot({
    path: join(output, "02-library-light.png"),
    fullPage: true,
  });
  await page.getByLabel("Search sessions, titles or URLs").fill("design");
  await page.locator(".tab-link").first().waitFor();
  assert.equal(await page.locator(".tab-link").count(), 2);
  await page.getByRole("button", { name: "Clear search" }).click();
  const before = await worker.evaluate(() => chrome.tabs.query({}));
  await page.getByRole("button", { name: "Open session", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Open session", exact: true })
    .click();
  let jobs;
  for (let n = 0; n < 100; n++) {
    jobs = await rpc({ type: "jobs" });
    if (jobs[0]?.status === "complete") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(jobs[0].status, "complete");
  assert.equal(jobs[0].items.filter((i) => i.state === "done").length, 6);
  const after = await worker.evaluate(() => chrome.tabs.query({}));
  assert.equal(after.length - before.length, 6);
  const map = jobs[0].windowMap;
  for (const w of saved.windows) {
    const real = await worker.evaluate(
      (id) => chrome.tabs.query({ windowId: id }),
      map[w.id],
    );
    assert.deepEqual(
      real.map((t) => t.pendingUrl || t.url),
      w.tabs.map((t) => t.url),
    );
    assert.deepEqual(
      real.map((t) => t.pinned),
      w.tabs.map((t) => t.pinned),
    );
  }
  const restoredGroups = await worker.evaluate(() =>
    chrome.tabGroups.query({}),
  );
  assert(
    restoredGroups.filter((g) => g.title === "Product research").length >= 2,
  );
  logs.push(
    "Native restore: new windows, exact URL order, pinned tabs, group metadata, existing tabs preserved.",
  );
  const currentJob = await rpc({
    type: "restore",
    id: saved.id,
    requestId: crypto.randomUUID(),
    options: {
      mode: "current",
      target: source,
      skipExisting: true,
      tabIds: saved.windows.find((w) => w.groups.length).tabs.map((t) => t.id),
    },
  });
  for (let n = 0; n < 100; n++) {
    const list = await rpc({ type: "jobs" });
    const j = list.find((j) => j.id === currentJob.id);
    if (j?.status === "complete") {
      assert(j.items.every((i) => i.state === "skipped"));
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  logs.push("Current-window restore skips exact existing URLs when requested.");
  const exported = await rpc({ type: "export" });
  assert.equal(JSON.parse(exported).sessions.length, 1);
  const imported = await rpc({ type: "import", text: exported });
  assert.equal(imported.added, 0);
  assert.equal(imported.skipped, 1);
  const invalid = await page.evaluate(() =>
    chrome.runtime.sendMessage({
      type: "import",
      text: '{"format":"tabcarry","version":99}',
    }),
  );
  assert.equal(invalid.ok, false);
  assert.equal((await rpc({ type: "list" })).length, 1);
  logs.push(
    "Portable backup round trip, duplicate import skipped, invalid import leaves data unchanged.",
  );
  await rpc({
    type: "change",
    id: saved.id,
    revision: saved.revision,
    patch: { deletedAt: Date.now() },
  });
  let deleted = (await rpc({ type: "list" }))[0];
  assert(deleted.deletedAt);
  await rpc({
    type: "change",
    id: deleted.id,
    revision: deleted.revision,
    patch: { deletedAt: null },
  });
  assert(!(await rpc({ type: "list" }))[0].deletedAt);
  for (const j of await rpc({ type: "jobs" }))
    await rpc({ type: "dismissJob", id: j.id });
  await page.bringToFront();
  await page.waitForFunction(() => !document.hidden);
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Appearance").selectOption("dark");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.screenshot({
    path: join(output, "03-library-dark.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 600, height: 900 });
  await page.locator(".session-item").first().click();
  await page.screenshot({
    path: join(output, "04-narrow.png"),
    fullPage: true,
  });
  assert(
    await page.getByRole("button", { name: "Back to sessions" }).isVisible(),
  );
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 380, height: 700 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole("button", { name: "Open library" }).waitFor();
  await popup.screenshot({
    path: join(output, "05-popup.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Language").selectOption("zh");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.screenshot({
    path: join(output, "06-chinese.png"),
    fullPage: true,
  });
  logs.push(
    "UI: rename, search, light/dark, 600px layout, popup, Chinese language, delete/put-back.",
  );
  // Additional native API checks use only this isolated profile and loopback pages.
  const spare = await worker.evaluate(async (origin) => {
    const w = await chrome.windows.create({
      url: `${origin}/close-me`,
      focused: false,
    });
    return { windowId: w.id, tabId: w.tabs[0].id };
  }, origin);
  const closed = await rpc({
    type: "saveClose",
    scope: "window",
    target: spare,
    requestId: crypto.randomUUID(),
  });
  assert.equal(closed.closed, 1);
  assert.equal(closed.kept, 0);
  assert((await rpc({ type: "list" })).some((s) => s.id === closed.session.id));
  logs.push(
    "Save-and-close: snapshot persisted before the captured test tab closes.",
  );
  await rpc({
    type: "open",
    url: `${origin}/replaced`,
    target: source,
    current: true,
  });
  const replacement = await worker.evaluate(
    (id) => chrome.tabs.get(id),
    source.tabId,
  );
  assert.equal(replacement.pendingUrl || replacement.url, `${origin}/replaced`);
  const nBefore = (await worker.evaluate(() => chrome.tabs.query({}))).length;
  await rpc({
    type: "open",
    url: `${origin}/new-page`,
    target: source,
    background: true,
  });
  assert.equal(
    (await worker.evaluate(() => chrome.tabs.query({}))).length,
    nBefore + 1,
  );
  logs.push(
    "Single page: open in a new tab and explicitly replace the source tab.",
  );
  const large = {
    id: "large-fixture",
    schemaVersion: 1,
    name: "Scale check — 500 tabs",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    revision: 1,
    favorite: false,
    source: "import",
    windows: Array.from({ length: 10 }, (_, wi) => ({
      id: `lw${wi}`,
      order: wi,
      focused: wi === 0,
      groups: [],
      tabs: Array.from({ length: 50 }, (_, ti) => ({
        id: `lt${wi}-${ti}`,
        url: `${origin}/scale/${wi}/${ti}`,
        title: `Reference ${wi}-${ti}`,
        order: ti,
        pinned: false,
        active: ti === 0,
      })),
    })),
  };
  await rpc({
    type: "import",
    text: JSON.stringify({ format: "tabcarry", version: 1, sessions: [large] }),
  });
  await page.reload();
  await page.bringToFront();
  await page
    .getByRole("heading", { name: "Scale check — 500 tabs", exact: true })
    .waitFor();
  assert.equal(await page.locator(".tab-row").count(), 150);
  await page.getByLabel("搜索会话、标题或网址").fill("Reference 9-49");
  assert.equal(await page.locator(".tab-row").count(), 1);
  await page.getByRole("button", { name: "清除搜索" }).click();
  const hundred = large.windows
    .slice(0, 2)
    .flatMap((w) => w.tabs.map((t) => t.id));
  const started = Date.now();
  const scaleJob = await rpc({
    type: "restore",
    id: large.id,
    requestId: crypto.randomUUID(),
    options: {
      mode: "original",
      target: source,
      skipExisting: false,
      tabIds: hundred,
    },
  });
  let scale;
  for (let n = 0; n < 300; n++) {
    scale = (await rpc({ type: "jobs" })).find((j) => j.id === scaleJob.id);
    if (scale.status !== "running") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(scale.status, "complete");
  assert.equal(scale.items.filter((i) => i.state === "done").length, 100);
  assert.equal(Object.keys(scale.windowMap).length, 2);
  logs.push(
    `Scale: 500-tab backup search/render; 100 native tabs restored across 2 windows in ${Date.now() - started}ms.`,
  );
  await worker.evaluate(async (ids) => {
    for (const id of ids) await chrome.windows.remove(id);
  }, Object.values(scale.windowMap));

  await ctx.close();
  ctx = await launch();
  worker = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  page = await ctx.newPage();
  await page.goto(`chrome-extension://${extensionId}/manager.html`);
  const persisted = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: "list" }),
  );
  assert(persisted.data.some((s) => s.name === "Product research"));
  const pref = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: "prefs" }),
  );
  assert.equal(pref.data.theme, "dark");
  assert.equal(pref.data.language, "zh");
  logs.push("Browser restart: sessions and preferences retained.");
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      { browser: ctx.browser()?.version(), logs, errors },
      null,
      2,
    ),
  );
  console.log(logs.join("\n"));
  console.log(`Screenshots and report: ${output}`);
} finally {
  await ctx?.close();
  server.close();
}
