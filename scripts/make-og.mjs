// Makes apps/web/public/og-default.png, the picture shown when a Linkbeam link is shared and the
// page has no profile photo. Run it again only if the brand changes: node scripts/make-og.mjs
// Needs Playwright with Chromium (set CHROMIUM_PATH to use one you already have).
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "tests", "e2e", "package.json"));
const { chromium } = require("@playwright/test");
// Fonts are embedded as data, because a page made with setContent cannot open local files.
const font = (name) => `data:font/woff2;base64,${readFileSync(join(root, "apps", "web", "public", "fonts", name)).toString("base64")}`;

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:"Inter";font-weight:100 900;src:url(${font("inter-latin-wght-normal.woff2")})}
@font-face{font-family:"Jakarta";font-weight:200 800;src:url(${font("plus-jakarta-sans-latin-wght-normal.woff2")})}
body{margin:0;width:1200px;height:630px;background:#0E1A13;color:#F6FAF4;font-family:Inter;display:flex;align-items:center;gap:72px;padding:0 96px;box-sizing:border-box}
h1{font:800 84px/1.05 Jakarta;margin:0 0 24px}
h1 span{color:#8BE04E}
p{font-size:34px;line-height:1.35;color:#A9B9AE;margin:0}
.card{flex:0 0 330px;background:#F6FAF4;border-radius:36px;padding:36px 28px;text-align:center;color:#0E1A13}
.face{width:88px;height:88px;border-radius:50%;background:#0B6B3A;color:#fff;margin:0 auto 12px;display:grid;place-items:center;font:800 38px Jakarta}
.card b{font:800 26px Jakarta;display:block;margin-bottom:18px}
.card i{display:block;font-style:normal;font-weight:600;font-size:20px;background:#0B6B3A;color:#fff;border-radius:999px;padding:16px;margin-top:12px}
</style><body><div><h1>Link<span>beam</span></h1><p>One link for everything you do.<br>Free and open source.</p></div>
<div class="card"><div class="face">A</div><b>Ada’s Bakery</b><i>Order on WhatsApp</i><i>Pay for your order</i><i>Find our shop</i></div></body>`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.evaluate(() => Promise.all([document.fonts.load('800 84px Jakarta'), document.fonts.load('400 34px Inter')]));
await page.screenshot({ path: join(root, "apps", "web", "public", "og-default.png") });
await browser.close();
console.log("Wrote apps/web/public/og-default.png");
