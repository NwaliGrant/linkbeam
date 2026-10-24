import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import sharp from "sharp";
import { SITE, freshIp, inspect, seedPage, signUp, tab } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", "docs", "evidence", "stage4");
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1440x900", width: 1440, height: 900 },
] as const;
const SCHEMES = ["light", "dark"] as const;
const THEMES = ["forest", "lime", "sunset", "ink", "paper", "mint", "amber", "sky"] as const;

const expectedBackground: Record<(typeof THEMES)[number], string> = {
  forest: "rgb(246, 250, 244)", lime: "rgb(14, 26, 19)", sunset: "rgb(255, 241, 230)", ink: "rgb(21, 21, 26)",
  paper: "rgb(255, 255, 255)", mint: "rgb(223, 245, 227)", amber: "rgb(255, 183, 3)", sky: "rgb(234, 242, 255)",
};

const LINKS = [
  { kind: "url" as const, title: "My portfolio", target: "https://example.com/portfolio" },
  { kind: "whatsapp" as const, title: "Chat with me on WhatsApp", target: "+2348012345678", message: "Hello Ada, I saw your page." },
  { kind: "coffee" as const, title: "Buy me a coffee", target: "https://buymeacoffee.com/your-name" },
  { kind: "call" as const, title: "Call the studio", target: "+2348012345678" },
  { kind: "email" as const, title: "Email me", target: "ada@example.com" },
  { kind: "map" as const, title: "Visit the studio in Yaba", target: "https://maps.google.com/?q=Yaba+Lagos" },
];

async function shot(page: Page, screen: string, viewport: string, scheme: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, `${screen}-${viewport}-${scheme}.png`), fullPage: false });
}

async function addPhoto(page: Page): Promise<void> {
  const jpeg = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 11, g: 107, b: 58 } } })
    .composite([{ input: Buffer.from('<svg width="400" height="400"><circle cx="200" cy="160" r="70" fill="#8BE04E"/><rect x="80" y="260" width="240" height="140" rx="70" fill="#8BE04E"/></svg>'), top: 0, left: 0 }])
    .jpeg()
    .toBuffer();
  const upload = await page.request.post(`${SITE}/api/v1/me/avatar`, { headers: { origin: SITE }, multipart: { file: { name: "a.jpg", mimeType: "image/jpeg", buffer: jpeg } } });
  expect(upload.status()).toBe(201);
}

async function visitorContext(browser: Browser, viewport: (typeof VIEWPORTS)[number], scheme: (typeof SCHEMES)[number]) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: scheme,
    reducedMotion: "reduce",
    extraHTTPHeaders: { "cf-connecting-ip": freshIp() },
  });
  return context;
}

for (const viewport of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    test(`public site screens at ${viewport.name} in ${scheme} mode`, async ({ browser, request }) => {
      test.setTimeout(180_000);
      const v = viewport.name;

      // The owner makes a rich page.
      const ownerContext = await visitorContext(browser, viewport, scheme);
      const owner = await ownerContext.newPage();
      await signUp(owner, request);
      const { username } = await seedPage(owner, {
        display_name: "Ada Obi",
        bio: "Brand designer in Lagos. I help small shops look great online.",
        links: LINKS,
        profile: { theme: scheme === "dark" ? "lime" : "forest" },
      });
      await addPhoto(owner);

      // Share tab, signed in.
      await owner.goto("/dashboard");
      await tab(owner, "Share").click();
      await expect(owner.getByRole("img", { name: /QR code for/ })).toBeVisible();
      await inspect(owner, "share", v, scheme);
      await shot(owner, "share", v, scheme);

      // Signed-out visitor views.
      const visitor = await visitorContext(browser, viewport, scheme);
      const page = await visitor.newPage();
      await page.goto(`/u/${username}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ada Obi");
      await page.evaluate(() => document.fonts.ready);
      await inspect(page, "public", v, scheme);
      await shot(page, "public", v, scheme);

      await page.goto("/");
      await inspect(page, "landing", v, scheme);
      await shot(page, "landing", v, scheme);

      await page.goto("/terms");
      await inspect(page, "terms", v, scheme);
      await shot(page, "terms", v, scheme);

      await page.goto("/privacy");
      await inspect(page, "privacy", v, scheme);
      await shot(page, "privacy", v, scheme);

      await page.goto(`/report?page=${username}`);
      await expect(page.getByRole("heading", { name: "Report this page" })).toBeVisible();
      await inspect(page, "report", v, scheme);
      await shot(page, "report", v, scheme);

      await page.goto("/u/nobody-here");
      await inspect(page, "not-found", v, scheme);
      await shot(page, "not-found", v, scheme);

      await visitor.close();
      await ownerContext.close();
    });
  }
}

test("every theme on the public page is readable and accessible at 360 px, and has screenshots", async ({ browser, request }) => {
  test.setTimeout(240_000);
  const viewport = VIEWPORTS[0];
  const ownerContext = await visitorContext(browser, viewport, "light");
  const owner = await ownerContext.newPage();
  await signUp(owner, request);
  const { username } = await seedPage(owner, { display_name: "Ada Obi", bio: "Brand designer in Lagos.", links: LINKS.slice(0, 4) });

  const visitor = await visitorContext(browser, viewport, "light");
  const page = await visitor.newPage();
  const looks = [
    { font_pair: "friendly", bg_style: "solid", button_shape: "pill" },
    { font_pair: "clean", bg_style: "pattern", button_shape: "rounded" },
    { font_pair: "friendly", bg_style: "gradient", button_shape: "square" },
  ] as const;
  for (const [index, theme] of THEMES.entries()) {
    const look = looks[index % looks.length] ?? looks[0];
    const saved = await owner.request.patch(`${SITE}/api/v1/me`, { headers: { origin: SITE }, data: { theme, ...look } });
    expect(saved.status()).toBe(200);
    await page.goto(`/u/${username}`);
    await expect(page.locator("body")).toHaveCSS("background-color", expectedBackground[theme]);
    await page.evaluate(() => document.fonts.ready);
    await inspect(page, `theme-${theme}`, "360x800", "light");
    await shot(page, `theme-${theme}`, "360x800", "light");
  }
  await visitor.close();
  await ownerContext.close();
});
