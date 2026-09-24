import { chromium } from "playwright";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const profile = await mkdtemp(join(tmpdir(), "tabcarry-assets-"));
const extension = resolve("dist");
await mkdir("docs/store", { recursive: true });
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
  viewport: { width: 1280, height: 800 },
});
try {
  const sw =
    ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  const id = new URL(sw.url()).host;
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/manager.html`);
  const make = (id, name, days, pages) => ({
    id,
    schemaVersion: 1,
    name,
    createdAt: Date.now() - days * 86400000,
    updatedAt: Date.now() - days * 86400000,
    revision: 1,
    favorite: days === 0,
    source: "import",
    windows: [
      {
        id: id + "w",
        order: 0,
        focused: true,
        groups: [
          { id: id + "g", title: "Reference", color: "blue", collapsed: false },
        ],
        tabs: pages.map(([title, url], i) => ({
          id: id + "t" + i,
          title,
          url,
          order: i,
          pinned: i === 0,
          active: i === 1,
          ...(i > 0 ? { groupRef: id + "g" } : {}),
        })),
      },
    ],
  });
  const sessions = [
    make("research", "A fresh start for the browser", 0, [
      ["Design notes & inspiration", "https://www.figma.com/"],
      [
        "Chrome Extensions — Getting started",
        "https://developer.chrome.com/docs/extensions/",
      ],
      ["TypeScript documentation", "https://www.typescriptlang.org/docs/"],
      [
        "React — Thinking in React",
        "https://react.dev/learn/thinking-in-react",
      ],
      ["TabCarry · Project workspace", "https://github.com/everettjf/tabcarry"],
    ]),
    make("weekend", "A weekend away", 1, [
      ["Plan a quiet weekend", "https://www.openstreetmap.org/"],
      ["Reading for the train", "https://en.wikipedia.org/"],
    ]),
    make("launch", "Ready for launch", 2, [
      ["Release checklist", "https://github.com/everettjf/tabcarry"],
      ["Developer dashboard", "https://chrome.google.com/webstore/devconsole/"],
    ]),
    make("reading", "Read when there’s time", 4, [
      ["A few good ideas", "https://developer.mozilla.org/"],
    ]),
  ];
  await page.evaluate(async (sessions) => {
    await chrome.runtime.sendMessage({
      type: "import",
      text: JSON.stringify({ format: "tabcarry", version: 1, sessions }),
    });
    await chrome.runtime.sendMessage({
      type: "prefs",
      value: { language: "en", theme: "light" },
    });
  }, sessions);
  await page.reload();
  await page
    .getByRole("heading", {
      name: "A fresh start for the browser",
      exact: true,
    })
    .waitFor();
  await page.screenshot({ path: "docs/store/library-light.png" });
  await page.getByRole("button", { name: "Open session", exact: true }).click();
  await page.screenshot({ path: "docs/store/restore.png" });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Appearance").selectOption("dark");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.screenshot({ path: "docs/store/library-dark.png" });
  console.log(
    "Saved three 1280 × 800 screenshots of the actual extension with demonstration data.",
  );
} finally {
  await ctx.close();
}
