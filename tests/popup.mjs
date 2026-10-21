import { chromium } from "playwright";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const output = process.env.TABCARRY_QA_DIR || join(tmpdir(), "tabcarry-qa");
await mkdir(output, { recursive: true });
const extension = resolve(process.env.TABCARRY_EXTENSION_DIR || "dist");
const context = await chromium.launchPersistentContext(
  await mkdtemp(join(tmpdir(), "tabcarry-popup-")),
  {
    channel: "chromium",
    headless: false,
    viewport: null,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  },
);

try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const page = context.pages()[0];
  const cdp = await context.newCDPSession(page);
  let requestId = 0;
  // Toolbar popups are not exposed as ordinary Playwright pages.
  async function command(sessionId, method, params = {}) {
    const id = ++requestId;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cdp.off("Target.receivedMessageFromTarget", handler);
        reject(new Error(`Popup command timed out: ${method}`));
      }, 10000);
      const handler = (event) => {
        if (event.sessionId !== sessionId) return;
        const message = JSON.parse(event.message);
        if (message.id !== id) return;
        clearTimeout(timer);
        cdp.off("Target.receivedMessageFromTarget", handler);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      };
      cdp.on("Target.receivedMessageFromTarget", handler);
    });
    await cdp.send("Target.sendMessageToTarget", {
      sessionId,
      message: JSON.stringify({ id, method, params }),
    });
    return response;
  }

  await worker.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("tabcarry", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction("sessions", "readwrite");
        tx.objectStore("sessions").put({
          id: "popup-width-fixture",
          schemaVersion: 1,
          name: "10/21/2026, 9:10:00 AM",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          revision: 1,
          favorite: false,
          source: "manual",
          windows: [
            {
              id: "window",
              order: 0,
              focused: true,
              groups: [],
              tabs: [
                {
                  id: "tab",
                  url: "https://example.com/",
                  title: "Example",
                  order: 0,
                  pinned: false,
                  active: true,
                },
              ],
            },
          ],
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });

  for (const [language, theme] of [
    ["en", "light"],
    ["en", "dark"],
    ["en", "sand"],
    ["en", "forest"],
    ["en", "dusk"],
    ["en", "midnight"],
    ["zh", "light"],
  ]) {
    await worker.evaluate(
      async ({ language, theme }) => {
        await chrome.storage.local.set({
          preferences: { language, theme, scope: "all" },
        });
      },
      { language, theme },
    );
    await page.bringToFront();
    await worker.evaluate(() => chrome.action.openPopup());
    const { targetInfos } = await cdp.send("Target.getTargets");
    const target = targetInfos.find((t) => t.url.endsWith("/popup.html"));
    assert(target, "Chrome must open a real toolbar popup");
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: false,
    });
    const result = await command(sessionId, "Runtime.evaluate", {
      expression: `new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        function check() {
          const item = document.querySelector('.recent-item');
          if (item && document.documentElement.dataset.theme === ${JSON.stringify(theme)}) {
            resolve({
              width: innerWidth,
              appWidth: document.querySelector('.popup').getBoundingClientRect().width,
              scrollWidth: document.documentElement.scrollWidth,
              titleFits: item.querySelector('b').scrollWidth <= item.querySelector('b').clientWidth,
              metadataFits: item.querySelector('small').getBoundingClientRect().height < 20,
            });
          } else if (Date.now() > deadline) reject(new Error('Popup did not render fixture'));
          else requestAnimationFrame(check);
        }
        check();
      })`,
      awaitPromise: true,
      returnByValue: true,
    });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    const metrics = result.result.value;
    console.log(`${language}/${theme}: ${JSON.stringify(metrics)}`);
    assert.equal(metrics.width, 560, "Native popup viewport must be 560px");
    assert.equal(metrics.appWidth, 560);
    assert.equal(
      metrics.scrollWidth,
      560,
      "Popup must not overflow horizontally",
    );
    assert(metrics.titleFits, "Date-based session title must fit");
    assert(
      metrics.metadataFits,
      "Recent session metadata must fit on one line",
    );
    const screenshot = await command(sessionId, "Page.captureScreenshot");
    await writeFile(
      join(output, `native-popup-${language}-${theme}.png`),
      Buffer.from(screenshot.data, "base64"),
    );
    if (theme === "light") {
      await command(sessionId, "Runtime.evaluate", {
        expression: `document.querySelector('button[aria-label="${language === "zh" ? "设置" : "Settings"}"]').click()`,
      });
      const settings = await command(sessionId, "Runtime.evaluate", {
        expression: `new Promise((resolve, reject) => {
          const deadline = Date.now() + 5000;
          function check() {
            const dialog = document.querySelector('dialog[open]');
            if (dialog) resolve({
              options: dialog.querySelectorAll('input[name="theme"]').length,
              fits: dialog.scrollWidth <= dialog.clientWidth,
              heightFits: dialog.getBoundingClientRect().height <= innerHeight,
            });
            else if (Date.now() > deadline) reject(new Error('Settings did not open'));
            else requestAnimationFrame(check);
          }
          check();
        })`,
        awaitPromise: true,
        returnByValue: true,
      });
      assert(
        !settings.exceptionDetails,
        JSON.stringify(settings.exceptionDetails),
      );
      assert.equal(settings.result.value.options, 7);
      assert(
        settings.result.value.fits,
        "Popup settings must not overflow horizontally",
      );
      assert(
        settings.result.value.heightFits,
        "Popup settings must fit its native viewport",
      );
      const shot = await command(sessionId, "Page.captureScreenshot");
      await writeFile(
        join(output, `native-settings-${language}.png`),
        Buffer.from(shot.data, "base64"),
      );
    }
    await command(sessionId, "Runtime.evaluate", {
      expression: "window.close()",
    });
  }
} finally {
  await context.close();
}
