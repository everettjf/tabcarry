import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const source = await readFile("public/icons/source.svg", "utf8");
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    const svg = source.replace(
      'width="128" height="128"',
      `width="${size}" height="${size}"`,
    );
    await page.setViewportSize({ width: size, height: size });
    await page.goto(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    );
    await page.screenshot({
      path: `public/icons/${size}.png`,
      omitBackground: true,
    });
    console.log(`Generated ${size} × ${size} icon`);
  }
} finally {
  await browser.close();
}
