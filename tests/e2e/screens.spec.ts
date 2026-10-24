import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import sharp from "sharp";
import { API, SITE, linkFor, freshEmail, freshIp, inspect, signUp, tab } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", "docs", "evidence", "stage3");
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1440x900", width: 1440, height: 900 },
] as const;
const SCHEMES = ["light", "dark"] as const;

async function shot(page: Page, screen: string, viewport: string, scheme: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, `${screen}-${viewport}-${scheme}.png`), fullPage: false });
}

async function seedRichAccount(page: Page): Promise<void> {
  const username = `lagos${Date.now().toString(36)}`.slice(0, 30);
  const post = (path: string, data: unknown) => page.request.post(`${SITE}/api/v1${path}`, { headers: { origin: SITE }, data });
  const mine = await page.request.patch(`${SITE}/api/v1/me`, {
    headers: { origin: SITE },
    data: { username, display_name: "Ada Obi", bio: "Brand designer in Lagos. I help small shops look great online.", theme: "forest" },
  });
  expect(mine.status()).toBe(200);
  const png = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 11, g: 107, b: 58 } } })
    .composite([{ input: Buffer.from('<svg width="400" height="400"><circle cx="200" cy="160" r="70" fill="#8BE04E"/><rect x="80" y="260" width="240" height="140" rx="70" fill="#8BE04E"/></svg>'), top: 0, left: 0 }])
    .jpeg()
    .toBuffer();
  const avatar = await page.request.post(`${SITE}/api/v1/me/avatar`, { headers: { origin: SITE }, multipart: { file: { name: "a.jpg", mimeType: "image/jpeg", buffer: png } } });
  expect(avatar.status()).toBe(201);
  const ids: string[] = [];
  for (const link of [
    { kind: "url", title: "My portfolio", target: "https://example.com/portfolio" },
    { kind: "whatsapp", title: "Chat with me on WhatsApp", target: "+2348012345678", message: "Hello Ada, I saw your page." },
    { kind: "coffee", title: "Buy me a coffee", target: "https://buymeacoffee.com/your-name" },
    { kind: "call", title: "Call the studio", target: "+2348012345678" },
    { kind: "email", title: "Email me", target: "ada@example.com" },
  ]) {
    const response = await post("/links", link);
    expect(response.status()).toBe(201);
    ids.push(((await response.json()) as { id: string }).id);
  }
  for (let i = 0; i < 14; i++) await post("/track", { page: username });
  for (const [index, count] of [[0, 6], [1, 4], [2, 2]] as const) {
    for (let i = 0; i < count; i++) await post("/track", { page: username, link: ids[index] });
  }
}

async function context(browser: Browser, viewport: (typeof VIEWPORTS)[number], scheme: (typeof SCHEMES)[number]) {
  return browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: scheme, reducedMotion: "reduce" });
}

for (const viewport of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    test(`screens and accessibility at ${viewport.name} in ${scheme} mode`, async ({ browser }) => {
      test.setTimeout(180_000);
      const ctx = await context(browser, viewport, scheme);
      const page = await ctx.newPage();
      const request = ctx.request;
      const v = viewport.name;

      // ---- Signed out ----
      await page.goto("/signin");
      await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeEnabled();
      await inspect(page, "signin", v, scheme);
      await shot(page, "signin", v, scheme);

      await page.goto("/signin?error=invalid_link");
      await expect(page.getByRole("alert")).toBeVisible();
      await inspect(page, "signin-error", v, scheme);
      await shot(page, "signin-error", v, scheme);

      const email = freshEmail();
      await ctx.setExtraHTTPHeaders({ "cf-connecting-ip": freshIp() });
      await page.goto("/signin");
      await page.getByLabel("Email address").fill(email);
      await page.getByRole("button", { name: "Email me a sign-in link" }).click();
      await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
      await inspect(page, "signin-sent", v, scheme);
      await shot(page, "signin-sent", v, scheme);

      // ---- New account: setup steps ----
      await page.goto(await linkFor(email));
      await expect(page.getByRole("heading", { name: "Choose your username" })).toBeVisible();
      await inspect(page, "onboarding-1", v, scheme);
      await shot(page, "onboarding-1", v, scheme);
      await page.getByRole("button", { name: "Skip this step" }).click();
      await expect(page.getByRole("heading", { name: "Your name and photo" })).toBeVisible();
      await inspect(page, "onboarding-2", v, scheme);
      await shot(page, "onboarding-2", v, scheme);
      await page.getByRole("button", { name: "Skip this step" }).click();
      await expect(page.getByRole("heading", { name: "Add your first link" })).toBeVisible();
      await inspect(page, "onboarding-3", v, scheme);
      await shot(page, "onboarding-3", v, scheme);
      await page.getByRole("button", { name: "Skip setup" }).click();
      await expect(page.getByText("No links yet")).toBeVisible();
      await inspect(page, "editor-empty", v, scheme);
      await shot(page, "editor-empty", v, scheme);
      await ctx.close();

      // ---- Account with a finished page ----
      const rich = await context(browser, viewport, scheme);
      const richPage = await rich.newPage();
      await signUp(richPage, rich.request);
      await seedRichAccount(richPage);
      await richPage.goto("/dashboard");
      await expect(richPage.getByText("My portfolio").first()).toBeVisible();
      await inspect(richPage, "links", v, scheme);
      await shot(richPage, "links", v, scheme);

      await richPage.getByRole("button", { name: /Edit\s+Chat with me on WhatsApp/ }).click();
      await expect(richPage.getByLabel("First message (optional)")).toBeVisible();
      await inspect(richPage, "links-edit", v, scheme);
      await shot(richPage, "links-edit", v, scheme);

      await richPage.getByRole("button", { name: "Add link" }).click();
      await inspect(richPage, "links-add", v, scheme);
      await shot(richPage, "links-add", v, scheme);

      await tab(richPage, "Design").click();
      await expect(richPage.getByRole("heading", { name: "Design" })).toBeVisible();
      await inspect(richPage, "design", v, scheme);
      await shot(richPage, "design", v, scheme);
      await richPage.getByLabel("Button colour", { exact: true }).fill("#777777");
      await expect(richPage.getByText(/hard to read/)).toBeVisible();
      await inspect(richPage, "design-warning", v, scheme);
      await shot(richPage, "design-warning", v, scheme);

      if (viewport.width < 1024) {
        await tab(richPage, "Preview").click();
        await expect(richPage.locator(".phone")).toBeVisible();
        await inspect(richPage, "preview", v, scheme);
        await shot(richPage, "preview", v, scheme);
      }

      await tab(richPage, "Stats").click();
      await expect(richPage.getByText("Views per day")).toBeVisible();
      await inspect(richPage, "stats", v, scheme);
      await shot(richPage, "stats", v, scheme);

      await tab(richPage, "Settings").click();
      await expect(richPage.getByRole("heading", { name: "Settings" })).toBeVisible();
      await inspect(richPage, "settings", v, scheme);
      await shot(richPage, "settings", v, scheme);

      // The undo message
      await tab(richPage, "Links").click();
      await richPage.getByRole("button", { name: /Delete\s+Email me/ }).click();
      await expect(richPage.getByText(/was deleted/)).toBeVisible();
      await inspect(richPage, "undo-toast", v, scheme);
      await shot(richPage, "undo-toast", v, scheme);
      await rich.close();
      void request;
      void API;
    });
  }
}

test("the dashboard works at 320 px wide", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const page = await ctx.newPage();
  await signUp(page, ctx.request);
  await seedRichAccount(page);
  await page.goto("/dashboard");
  await expect(page.getByText("My portfolio").first()).toBeVisible();
  for (const name of ["Links", "Design", "Stats", "Settings"]) {
    await tab(page, name).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `sideways scroll on ${name} at 320px`).toBeLessThanOrEqual(0);
  }
  await ctx.close();
});
