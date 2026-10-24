// Makes the app icons (PNG) from the logo shape in apps/web/public/favicon.svg.
// Run: node scripts/make-icons.mjs   (needs the Chromium that Playwright uses; set CHROMIUM_PATH if needed)
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "tests", "e2e", "package.json"));
const { chromium } = require("@playwright/test");

const MARK = '<path d="M20 44V20h6v18h18v6z" fill="#8BE04E"/>';
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0B6B3A"/>${MARK}</svg>`;
// "Maskable" icons are cropped by the phone into a circle or square, so the mark sits well inside the safe zone.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0B6B3A"/><g transform="translate(32 32) scale(1.3) translate(-32 -32)">${MARK}</g></svg>`;
// Apple draws its own rounded corners, so the square has no corners of its own.
const apple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0B6B3A"/><g transform="translate(32 32) scale(1.2) translate(-32 -32)">${MARK}</g></svg>`;

const jobs = [
  ["icon-192.png", 192, rounded],
  ["icon-512.png", 512, rounded],
  ["icon-maskable-512.png", 512, maskable],
  ["apple-touch-icon.png", 180, apple],
];

const executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage();
for (const [name, size, svg] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(join(root, "apps", "web", "public", "icons", name), png);
  console.log("wrote", name, png.length, "bytes");
}
await browser.close();
