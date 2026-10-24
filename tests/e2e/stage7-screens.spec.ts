import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { freshIp, inspect, seedPage, signUp, tab } from "./helpers";

// Stage 7 evidence: screenshots at three sizes in light and dark, and a short video for the README demo.
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", "docs", "evidence", "stage7");
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1440x900", width: 1440, height: 900 },
] as const;
const SCHEMES = ["light", "dark"] as const;

const LINKS = [
  { kind: "url" as const, title: "My portfolio", target: "https://example.com/portfolio" },
  { kind: "whatsapp" as const, title: "Chat with me on WhatsApp", target: "+2348012345678", message: "Hello Ada, I saw your page." },
  { kind: "coffee" as const, title: "Buy me a coffee", target: "https://buymeacoffee.com/your-name" },
  { kind: "call" as const, title: "Call the studio", target: "+2348012345678" },
];

async function shot(page: Page, screen: string, viewport: string, scheme: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, `${screen}-${viewport}-${scheme}.png`), fullPage: false });
}

for (const viewport of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    test(`Stage 7 screens at ${viewport.name} in ${scheme} mode`, async ({ browser, request }) => {
      test.setTimeout(180_000);
      const v = viewport.name;
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: scheme, reducedMotion: "reduce", extraHTTPHeaders: { "cf-connecting-ip": freshIp() } });
      const page = await context.newPage();
      await signUp(page, request);
      const { username } = await seedPage(page, { display_name: "Ada Obi", bio: "Brand designer in Lagos. I help small shops look great online.", links: LINKS });

      // Offline: the connection goes away while the dashboard is open, and an edit is kept on the device.
      await page.goto("/dashboard");
      await tab(page, "Links").click();
      await expect(page.locator(".link-summary", { hasText: "My portfolio" })).toBeVisible();
      await context.setOffline(true);
      await expect(page.getByTestId("offline-banner")).toBeVisible();
      await page.getByRole("button", { name: "Edit My portfolio" }).click();
      await page.getByLabel("Title").fill("My portfolio (new)");
      await expect(page.getByText("Saved on this device")).toBeVisible();
      await inspect(page, "offline-edit", v, scheme);
      await shot(page, "offline-edit", v, scheme);
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(page.getByTestId("offline-banner")).toHaveCount(0);
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();

      // The friendly website 404 page and the public page that does not exist.
      await page.goto("/no-such-page");
      await expect(page.getByRole("heading", { name: "This page does not exist" })).toBeVisible();
      await inspect(page, "site-404", v, scheme);
      await shot(page, "site-404", v, scheme);

      await page.goto(`/u/${username}`);
      await expect(page.getByRole("link", { name: "Buy me a coffee" })).toBeVisible();
      await inspect(page, "public-page", v, scheme);
      await shot(page, "public-page", v, scheme);

      await page.goto("/");
      await inspect(page, "landing", v, scheme);
      await shot(page, "landing", v, scheme);

      await context.close();
    });
  }
}

test("capture the frames for the README demo", async ({ browser, request }) => {
  test.setTimeout(180_000);
  const setup = await browser.newContext({ viewport: { width: 1280, height: 720 }, extraHTTPHeaders: { "cf-connecting-ip": freshIp() } });
  const seed = await setup.newPage();
  await signUp(seed, request);
  const { username } = await seedPage(seed, { display_name: "Ada Obi", bio: "Brand designer in Lagos. I help small shops look great online.", links: LINKS });
  const state = await setup.storageState();
  await setup.close();

  // Frames are joined into a GIF by scripts/make-demo-gif.sh (it uses ffmpeg). Each frame says how long to stay on screen.
  const dir = join(OUT, "demo-frames");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const holds: string[] = [];
  let n = 0;
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, storageState: state, reducedMotion: "reduce", extraHTTPHeaders: { "cf-connecting-ip": freshIp() } });
  const page = await context.newPage();
  const frame = async (seconds: number): Promise<void> => {
    await page.waitForTimeout(250);
    const name = `f${String(n++).padStart(2, "0")}.png`;
    await page.screenshot({ path: join(dir, name) });
    holds.push(`file '${name}'`, `duration ${seconds}`);
  };

  await page.goto("/dashboard");
  await expect(page.locator(".link-summary", { hasText: "My portfolio" })).toBeVisible();
  await frame(2);
  await page.getByRole("button", { name: "Edit My portfolio" }).click();
  await page.getByLabel("Title").fill("");
  for (const text of ["Ada's", "Ada's design", "Ada's design portfolio"]) {
    await page.getByLabel("Title").fill(text);
    await frame(0.8);
  }
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await frame(1.5);
  await tab(page, "Design").click();
  await frame(1.5);
  await page.getByRole("radio", { name: "Sunset" }).check({ force: true });
  await frame(1.6);
  await page.getByRole("radio", { name: "Ink" }).check({ force: true });
  await frame(1.6);
  await tab(page, "Share").click();
  await frame(2);
  await page.goto(`/u/${username}`);
  await expect(page.getByRole("link", { name: "Buy me a coffee" })).toBeVisible();
  await frame(3);
  // The concat list needs the last file repeated once, or the final duration is ignored.
  holds.push(holds[holds.length - 2] ?? "");
  writeFileSync(join(dir, "frames.txt"), holds.join("\n") + "\n");
  await context.close();
});
